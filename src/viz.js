import { Chart, LineController, LineElement, PointElement, BarController, BarElement, LinearScale, CategoryScale, Tooltip, Legend, ScatterController } from 'chart.js'
import { buildYAxisTicksFromReference } from './midi.js'
import * as Tone from 'tone'

Chart.register(LineController, LineElement, PointElement, BarController, BarElement, LinearScale, CategoryScale, Tooltip, Legend, ScatterController)

export function renderResults({ reference, pitchTrack, analysis, noteView, audioUrl }) {
  // Store globally for playback functions
  globalNoteView = noteView
  globalReference = reference
  console.log('[renderResults] noteView.issues:', noteView?.issues?.length)
  
  const results = document.getElementById('results')
  results.innerHTML = `
    <div class="results-grid">
      <div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;gap:8px;">
          <button id="pagePrev">←</button>
          <div id="pageInfo" style="opacity:0.8;font-size:14px;">-</div>
          <button id="pageNext">→</button>
        </div>
        <div class="chart-wrap" style="position:relative;">
          <canvas id="pitchChart"></canvas>
          <div id="playbackPointer" style="position:absolute;top:0;bottom:0;width:2px;background:#ff4d4f;opacity:0;transition:opacity 0.2s;pointer-events:none;z-index:10;"></div>
          <div id="lyricsRow" style="position:absolute;bottom:4px;left:0;right:0;padding:6px 8px;background:rgba(0,0,0,0.6);border-radius:4px;min-height:20px;font-size:13px;color:#e0e0e0;z-index:5;"></div>
        </div>
      </div>
      <div class="side">
        <div class="box">
          <h3>분석 요약</h3>
          <p>음정 점수: <b>${analysis.pitchScore}</b></p>
          <p>리듬 점수: <b>${analysis.rhythmScore}</b></p>
          <p>종합 점수: <b>${analysis.totalScore}</b> — ${analysis.verdict}</p>
        </div>
        <div class="box">
          <h3>연습 전략</h3>
          <ul>
            <li>긴 음에서 음정 흔들림을 줄여보세요.</li>
            <li>음이 바뀔 때 호흡을 정리하고 박을 맞추세요.</li>
            <li>느린 템포로 먼저 정확히 맞춘 뒤 빠르게 올리세요.</li>
          </ul>
        </div>
        <audio id="userPlayback" controls src="${audioUrl}"></audio>
      </div>
    </div>
  `
  const ctx = document.getElementById('pitchChart').getContext('2d')
  const yTicks = buildYAxisTicksFromReference(reference)

  const windowBeats = 16 // 4마디씩 보기
  let windowStart = 0
  let chart

  function pageInfoText(){
    const m1 = Math.floor(windowStart/4)+1
    const m2 = Math.min(Math.floor((windowStart+windowBeats-0.0001)/4)+1, Math.floor(reference.totalBeats/4))
    return `${m1}마디 ~ ${m2}마디`
  }

  function buildSlice(){
    const linesRef = []
    const linesUser = []
    const crosses = []
    const errorLabels = []
    const crossIndexMap = []
    function pushLine(arr, bar){
      if (bar.x1 < windowStart || bar.x0 > windowStart+windowBeats) return
      const x0 = Math.max(windowStart, bar.x0)
      const x1 = Math.min(windowStart+windowBeats, bar.x1)
      if (x1 <= x0) return
      arr.push({ x: x0, y: bar.midi }, { x: x1, y: bar.midi }, { x: null, y: null })
    }
    noteView?.barsRef?.forEach(b=>pushLine(linesRef,b))
    noteView?.barsUser?.forEach(b=>{ if (b.midi!=null) pushLine(linesUser,b) })
    
    console.log('[DEBUG] noteView.issues:', noteView?.issues?.length || 0, noteView?.issues)
    
    // Force at least one test X if no issues (for debugging)
    if (!noteView?.issues || noteView.issues.length === 0) {
      crosses.push({ x: windowStart + 2, y: 60, meta: { pitchDiff: -3, startDiff: 0 } })
      crossIndexMap.push(0)
      errorLabels.push({ x: windowStart + 2, y: 61, text: '테스트 오차' })
    } else {
      noteView.issues.forEach((iss, idx)=>{
        if (iss.beat>=windowStart && iss.beat<=windowStart+windowBeats){
          crosses.push({ x: iss.beat, y: iss.midi, meta: iss })
          crossIndexMap.push(idx)
          // Build error label text (툴팁용, 허용범위 초과만)
          const parts = []
          if (iss.pitchDiff != null){
            const cents = Math.abs(iss.pitchDiff) * 100
            if (cents > 50) parts.push(iss.pitchDiff > 0 ? `${cents.toFixed(0)}센트↑` : `${cents.toFixed(0)}센트↓`)
          }
          const tempo = reference.tempoBpm || 120
          const startMs = iss.startDiff != null ? Math.abs(iss.startDiff) * (60000 / tempo) : 0
          const endMs = iss.endDiff != null ? Math.abs(iss.endDiff) * (60000 / tempo) : 0
          if (startMs > 100){
            parts.push(iss.startDiff > 0 ? `${startMs.toFixed(0)}ms 늦음` : `${startMs.toFixed(0)}ms 빠름`)
          }
          if (endMs > 100){
            parts.push(`끝${endMs.toFixed(0)}ms ${iss.endDiff>0?'늦음':'빠름'}`)
          }
          if (parts.length) errorLabels.push({ x: iss.beat, y: iss.midi + 0.8, text: parts.join(', ') })
        }
      })
    }
    
    console.log('[DEBUG] crosses in window:', crosses.length, crosses)
    return { linesRef, linesUser, crosses, errorLabels, crossIndexMap }
  }

  function render(){
    const { linesRef, linesUser, crosses, errorLabels, crossIndexMap } = buildSlice()
    document.getElementById('pageInfo').textContent = pageInfoText()
    
    // Render lyrics for current window
    const lyricsInWindow = (reference.lyrics || []).filter(l => l.beat >= windowStart && l.beat < windowStart + windowBeats)
    const lyricsHTML = lyricsInWindow.map(l => {
      const m = Math.floor(l.beat / 4) + 1
      const b = Math.floor(l.beat % 4) + 1
      return `<span style="margin-right:16px;opacity:0.8;">${m}|${b}: ${l.text}</span>`
    }).join('')
    document.getElementById('lyricsRow').innerHTML = lyricsHTML || '<span style="opacity:0.5;">가사 없음</span>'
    
    if (chart) chart.destroy()
    
    globalChart = chart = new Chart(ctx, {
      type: 'line',
      data: { datasets: [
        { label:'정답', data: linesRef, parsing:{xAxisKey:'x',yAxisKey:'y'}, borderColor:'#3a86ff', backgroundColor:'rgba(58,134,255,0.6)', borderWidth:5, pointRadius:0, spanGaps:false, segment:{ borderDash: [] } },
        { label:'사용자', data: linesUser, parsing:{xAxisKey:'x',yAxisKey:'y'}, borderColor:'#ff8c00', backgroundColor:'rgba(255,140,0,0.6)', borderWidth:5, pointRadius:0, spanGaps:false, segment:{ borderDash: [] } },
        { label:'오차', data: crosses, parsing:{xAxisKey:'x',yAxisKey:'y'}, type:'scatter', pointStyle:'crossRot', pointBackgroundColor:'#ff4d4f', pointBorderColor:'#ff4d4f', pointRadius:10, pointBorderWidth:2, hitRadius:15, hoverRadius:12, showLine:false }
      ]},
      options: {
        animation:false, maintainAspectRatio:false,
        scales: {
          x: { type:'linear', min:windowStart, max:windowStart+windowBeats, title:{display:true,text:'박 (4/4)'}, ticks:{
              stepSize: 1,
              callback:(value)=>{
                if (Math.abs(value - Math.round(value)) > 1e-6) return ''
                const measure = Math.floor(value/4)+1
                const beatIn = Math.floor(value%4)+1
                return `${measure}|${beatIn}`
              }, maxRotation:0, autoSkip:false },
              grid:{ color:(c)=>{ const v=c.tick.value||0; return (Math.abs(v%4)<1e-6)?'#cfd8dc':'#e9eef1' }, lineWidth:(c)=>{ const v=c.tick.value||0; return (Math.abs(v%4)<1e-6)?1.5:0.6 } }
          },
          y: { type:'linear', min: Math.min(...yTicks.map(t=>t.value)) - 1, max: Math.max(...yTicks.map(t=>t.value)) + 1,
               ticks:{ callback:(v)=>{ const t=yTicks.find(t=>t.value===v); return t? t.label : '' }, stepSize:1 }, title:{display:true,text:'음고'} }
        },
        plugins: { tooltip:{ enabled:true, mode:'nearest', intersect:true, callbacks:{
          title:(items)=>{ 
            const x = items[0].parsed?.x ?? items[0].raw?.x
            if (x==null) return ''
            const m=Math.floor(x/4)+1; const bi=Math.floor(x%4)+1
            return `마디 ${m}, 박 ${bi}`
          },
          label:(ctx)=>{
            if (ctx.dataset.label==='사용자'){
              const x0 = ctx.parsed.x
              const y0 = ctx.parsed.y
              if (x0==null || y0==null) return '사용자'
              const note = reference.notes.find(n => x0>=n.startBeat-0.5 && x0<n.startBeat+n.durationBeats+0.5)
              if (!note) return `사용자: ${midiToNaturalName(Math.round(y0))}`
              const pitchDiff = y0 - note.midi
              const cents = pitchDiff * 100
              const pitchDesc = cents > 50 ? `${Math.abs(cents).toFixed(0)}센트 높음` : cents < -50 ? `${Math.abs(cents).toFixed(0)}센트 낮음` : '양호'
              const userIssue = noteView?.issues?.find(iss => Math.abs(iss.beat - note.startBeat)<0.1)
              const startDesc = userIssue?.startDiff ? (userIssue.startDiff>0 ? `${(userIssue.startDiff).toFixed(2)}박 늦음` : `${Math.abs(userIssue.startDiff).toFixed(2)}박 빠름`) : '리듬 OK'
              return `사용자: ${midiToNaturalName(Math.round(y0))} | ${pitchDesc} | ${startDesc}`
            }
            if (ctx.dataset.label==='오차') {
              const pt = crosses[ctx.dataIndex]
              if (!pt?.meta) return '오차'
              const lbl = errorLabels.find(e => Math.abs(e.x - pt.x) < 0.01 && Math.abs(e.y - pt.y - 0.8) < 0.1)
              return lbl?.text || '오차'
            }
            return `${ctx.dataset.label}: ${midiToNaturalName(Math.round(ctx.parsed.y))}`
          }
        } }, legend:{ position:'top' } },
        onClick: async (evt, elements) => {
          console.log('[CLICK] elements:', elements)
          if (!elements || !elements.length) return
          const el = elements[0]
          const crossDatasetIdx = chart.data.datasets.length - 1
          if (el.datasetIndex === crossDatasetIdx) {
            // Clicked on red X: play A/B
            const scatterPointIdx = el.index
            const aIdx = crossIndexMap[scatterPointIdx]
            console.log('[CLICK X] aIdx:', aIdx, 'issue:', noteView?.issues?.[aIdx])
            const issue = noteView?.issues?.[aIdx]
            const beat = issue?.beat ?? crosses[scatterPointIdx]?.x
            if (beat != null) await playAB(reference, audioUrl, beat)
          } else {
            // Clicked on bar: play user at that beat
            const beat = el.element?.x ?? evt.chart.scales.x.getValueForPixel(evt.x)
            console.log('[CLICK BAR] beat:', beat)
            if (beat != null) await playUserAtBeat(audioUrl, beat, reference.tempoBpm)
          }
        },
        onHover: async (_, elements) => {
          if (!elements || !elements.length) return
          const el = elements[0]
          const crossDatasetIdx = chart.data.datasets.length - 1
          if (el.datasetIndex === crossDatasetIdx) {
            const scatterPointIdx = el.index
            const aIdx = crossIndexMap[scatterPointIdx]
            console.log('[HOVER X] aIdx:', aIdx)
            const issue = noteView?.issues?.[aIdx]
            const beat = issue?.beat ?? crosses[scatterPointIdx]?.x
            if (beat != null) await playAB(reference, audioUrl, beat)
          }
        }
      }
    })
  }

  document.getElementById('pagePrev').addEventListener('click', ()=>{
    windowStart = Math.max(0, windowStart - windowBeats)
    render()
  })
  document.getElementById('pageNext').addEventListener('click', ()=>{
    const maxStart = Math.max(0, Math.floor(reference.totalBeats - windowBeats))
    windowStart = Math.min(maxStart, windowStart + windowBeats)
    render()
  })

  render()
}

let abDebounce = 0
let playbackAnimation = null
let audioElement = null
let globalNoteView = null
let globalReference = null
let globalChart = null

async function playAB(reference, audioUrl, beat) {
  console.log('[playAB] ===== START ===== beat:', beat)
  const nowMs = performance.now()
  if (nowMs - abDebounce < 400) {
    console.log('[playAB] debounced, skipping')
    return
  }
  abDebounce = nowMs
  
  if (!audioUrl) {
    console.error('[playAB] CRITICAL: no audioUrl')
    alert('오디오 URL이 없습니다')
    return
  }
  
  try {
    const tempo = reference.tempoBpm || 120
    const secondsPerBeat = 60 / tempo
    const offsetBeats = globalNoteView?.offsetBeats || 0
    const tSec = (beat + offsetBeats) * secondsPerBeat
    const dur = 0.6
    const note = reference.notes.find(n => beat >= n.startBeat && beat < n.startBeat + n.durationBeats)
    
    console.log('[playAB] tempo:', tempo, 'offsetBeats:', offsetBeats, 'tSec:', tSec, 'note:', note)
    
    // Visual feedback
    highlightErrorBar(beat, dur * 2 * 1000)
    startPlaybackPointer(beat, dur * 2, tempo)
    highlightLyrics(beat, dur * 2 * 1000)
    
    // Create fresh audio element each time
    const audio = new Audio(audioUrl)
    console.log('[playAB] Audio created, src:', audio.src)
    
    // Wait for metadata
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Metadata timeout')), 3000)
      audio.addEventListener('loadedmetadata', () => {
        clearTimeout(timeout)
        console.log('[playAB] metadata loaded, duration:', audio.duration)
        resolve()
      }, { once: true })
      audio.load()
    })
    
    // Seek to position
    const seekTo = Math.max(0, Math.min(tSec, audio.duration - dur))
    audio.currentTime = seekTo
    console.log('[playAB] seeked to:', seekTo)
    
    // Step 1: Play user clip
    await audio.play()
    console.log('[playAB] ▶ USER AUDIO PLAYING')
    
    setTimeout(() => {
      audio.pause()
      console.log('[playAB] ⏸ user audio paused')
      
      // Step 2: Play correct tone after 100ms gap
      setTimeout(async () => {
        try {
          await Tone.start()
          const synth = new Tone.Synth().toDestination()
          if (note) {
            const freq = midiToFreq(note.midi)
            synth.triggerAttackRelease(freq, dur)
            console.log('[playAB] ▶ SYNTH PLAYING freq:', freq)
          } else {
            console.warn('[playAB] no note found for beat:', beat)
          }
        } catch (e) {
          console.error('[playAB] synth error:', e)
        }
      }, 100)
    }, dur * 1000)
    
  } catch (e) {
    console.error('[playAB] CRITICAL ERROR:', e)
    alert(`재생 오류: ${e.message}`)
  }
}

function highlightErrorBar(beat, durationMs) {
  // Flash effect on canvas
  const canvas = document.getElementById('pitchChart')
  if (!canvas) return
  let blinks = 0
  const maxBlinks = Math.floor(durationMs / 400)
  const blinkInterval = setInterval(() => {
    canvas.style.filter = (blinks % 2 === 0) ? 'brightness(1.25) saturate(1.3)' : 'brightness(1.0)'
    blinks++
    if (blinks > maxBlinks * 2) {
      clearInterval(blinkInterval)
      canvas.style.filter = ''
    }
  }, 200)
}

function startPlaybackPointer(beat, durationSec, tempo) {
  if (playbackAnimation) clearInterval(playbackAnimation)
  const pointer = document.getElementById('playbackPointer')
  if (!pointer || !globalChart) {
    console.warn('[playbackPointer] no pointer or chart')
    return
  }
  const xScale = globalChart.scales.x
  pointer.style.opacity = '0.8'
  const startX = xScale.getPixelForValue(beat)
  const endBeat = beat + durationSec * tempo / 60
  const endX = xScale.getPixelForValue(endBeat)
  const deltaX = endX - startX
  const steps = 30
  const interval = (durationSec * 1000) / steps
  let step = 0
  pointer.style.left = `${startX}px`
  console.log('[playbackPointer] start:', startX, 'end:', endX)
  playbackAnimation = setInterval(() => {
    step++
    const x = startX + (deltaX * step / steps)
    pointer.style.left = `${x}px`
    if (step >= steps) {
      clearInterval(playbackAnimation)
      pointer.style.opacity = '0'
    }
  }, interval)
}

function highlightLyrics(beat, durationMs) {
  const lyricsRow = document.getElementById('lyricsRow')
  if (!lyricsRow) return
  const spans = lyricsRow.querySelectorAll('span')
  spans.forEach(span => {
    const text = span.textContent || ''
    const match = text.match(/^(\d+)\|(\d+):/)
    if (match) {
      const m = parseInt(match[1])
      const b = parseInt(match[2])
      const lyricBeat = (m - 1) * 4 + (b - 1)
      if (Math.abs(lyricBeat - beat) < 0.5) {
        span.style.color = '#ff8c00'
        span.style.fontWeight = 'bold'
        setTimeout(() => {
          span.style.color = ''
          span.style.fontWeight = ''
        }, durationMs)
      }
    }
  })
}

let userDebounce = 0
async function playUserAtBeat(audioUrl, beat, tempo) {
  console.log('[playUserAtBeat] called with beat:', beat, 'audioUrl:', audioUrl)
  const nowMs = performance.now()
  if (nowMs - userDebounce < 150) return
  userDebounce = nowMs
  if (!audioUrl) { console.warn('[playUserAtBeat] no audioUrl'); return }
  
  try {
    const secondsPerBeat = 60 / tempo
    const offsetBeats = globalNoteView?.offsetBeats || 0
    const tSec = (beat + offsetBeats) * secondsPerBeat
    const dur = 0.5
    console.log('[playUserAtBeat] tSec:', tSec, 'dur:', dur, 'offsetBeats:', offsetBeats)
    
    // HTML5 Audio with metadata wait
    if (!audioElement) {
      audioElement = new Audio()
      audioElement.preload = 'auto'
    }
    audioElement.src = audioUrl
    
    await new Promise((resolve) => {
      const onReady = () => {
        audioElement.removeEventListener('loadedmetadata', onReady)
        audioElement.currentTime = Math.max(0, Math.min(tSec, audioElement.duration - dur))
        console.log('[playUserAtBeat] seeked to:', audioElement.currentTime)
        resolve()
      }
      if (audioElement.readyState >= 1) {
        onReady()
      } else {
        audioElement.addEventListener('loadedmetadata', onReady)
      }
    })
    
    await audioElement.play()
    console.log('[playUserAtBeat] playing')
    setTimeout(() => audioElement.pause(), dur * 1000)
  } catch (e) {
    console.error('[playUserAtBeat] error:', e)
  }
}

function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12)
}

function midiToNaturalName(midi) {
  const names = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']
  const name = names[midi % 12]
  const octave = Math.floor(midi / 12) - 1
  return `${name}${octave}`
}


