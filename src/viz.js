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
    
    // 🎯 음고 오류만 X표시 (리듬 오류는 제외)
    noteView.issues.forEach((iss, idx)=>{
      if (iss.beat>=windowStart && iss.beat<=windowStart+windowBeats){
        crosses.push({ x: iss.beat, y: iss.midi, meta: iss })
        crossIndexMap.push(idx)
        
        // 🎯 음고 오류 레이블 표시 (±75 Cent 초과만 X표시되므로)
        const parts = []
        if (iss.pitchDiff != null){
          const cents = Math.abs(iss.pitchDiff) * 100
          if (cents > 75) { // 75 Cent 이상만 심각한 오류
            parts.push(iss.pitchDiff > 0 ? `${cents.toFixed(0)}센트 높음` : `${cents.toFixed(0)}센트 낮음`)
          }
        }
        
        // 리듬 정보는 참고용으로만 표시 (X표시 기준은 아님)
        const tempo = reference.tempoBpm || 120
        const startMs = iss.startDiff != null ? Math.abs(iss.startDiff) * (60000 / tempo) : 0
        if (startMs > 150){
          parts.push(`(참고: ${iss.startDiff > 0 ? '늦게' : '빠르게'} 시작)`)
        }
        
        if (parts.length) errorLabels.push({ x: iss.beat, y: iss.midi + 0.8, text: parts.join(' ') })
      }
    })
    
    console.log('[X표시] 음고 오류 개수:', crosses.length)
    return { linesRef, linesUser, crosses, errorLabels, crossIndexMap }
  }

  function render(){
    const { linesRef, linesUser, crosses, errorLabels, crossIndexMap } = buildSlice()
    document.getElementById('pageInfo').textContent = pageInfoText()
    
    // 🎵 가사를 현재 윈도우에서 필터링
    const lyricsInWindow = (reference.lyrics || []).filter(l => l.beat >= windowStart && l.beat < windowStart + windowBeats)
    
    if (chart) chart.destroy()
    
    globalChart = chart = new Chart(ctx, {
      type: 'line',
      data: { datasets: [
        { label:'정답', data: linesRef, parsing:{xAxisKey:'x',yAxisKey:'y'}, borderColor:'#3a86ff', backgroundColor:'rgba(58,134,255,0.6)', borderWidth:5, pointRadius:0, spanGaps:false, segment:{ borderDash: [] } },
        { label:'사용자', data: linesUser, parsing:{xAxisKey:'x',yAxisKey:'y'}, borderColor:'#ff8c00', backgroundColor:'rgba(255,140,0,0.6)', borderWidth:5, pointRadius:0, spanGaps:false, segment:{ borderDash: [] } },
        { label:'오차', data: crosses, parsing:{xAxisKey:'x',yAxisKey:'y'}, type:'scatter', pointStyle:'crossRot', pointBackgroundColor:'#ff4d4f', pointBorderColor:'#ff4d4f', pointRadius:10, pointBorderWidth:2, hitRadius:15, hoverRadius:12, showLine:false }
      ]},
      plugins: [{
        id: 'lyricsPlugin',
        afterDatasetsDraw: (chart) => {
          const ctx = chart.ctx
          const xScale = chart.scales.x
          const yScale = chart.scales.y
          
          // 🎵 각 가사를 해당 음표 막대 바로 아래에 그리기
          lyricsInWindow.forEach(lyric => {
            const xPixel = xScale.getPixelForValue(lyric.beat)
            const yBottom = yScale.bottom + 8 // 그래프 하단에서 약간 아래
            
            ctx.save()
            ctx.font = 'bold 13px sans-serif'
            ctx.fillStyle = '#333'
            ctx.textAlign = 'center'
            ctx.textBaseline = 'top'
            
            // 🎯 가사 텍스트를 음표 시작 위치(X좌표)에 정확히 동기화
            ctx.fillText(lyric.text, xPixel, yBottom)
            
            // 연결선 (막대에서 가사로)
            ctx.strokeStyle = 'rgba(0,0,0,0.2)'
            ctx.lineWidth = 1
            ctx.beginPath()
            ctx.moveTo(xPixel, yScale.bottom)
            ctx.lineTo(xPixel, yBottom - 2)
            ctx.stroke()
            
            ctx.restore()
          })
        }
      }],
      options: {
        animation:false, maintainAspectRatio:false,
        layout: { padding: { bottom: 30 } }, // 🎵 가사 공간 확보
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
              // 🎯 음고 평가 기준: ±75 Cent 이내면 양호, 초과하면 오류
              const pitchDesc = cents > 75 ? `${Math.abs(cents).toFixed(0)}센트 높음 ⚠️` 
                              : cents < -75 ? `${Math.abs(cents).toFixed(0)}센트 낮음 ⚠️` 
                              : '음정 양호 ✓'
              return `사용자: ${midiToNaturalName(Math.round(y0))} | ${pitchDesc}`
            }
            if (ctx.dataset.label==='오차') {
              const pt = crosses[ctx.dataIndex]
              if (!pt?.meta) return '음고 오류'
              const lbl = errorLabels.find(e => Math.abs(e.x - pt.x) < 0.01 && Math.abs(e.y - pt.y - 0.8) < 0.1)
              return lbl?.text || '음고 오류'
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
  // 🎵 캔버스 기반 가사 하이라이트: 차트 강조 효과로 대체
  // 해당 박 주변을 시각적으로 강조하는 효과는 highlightErrorBar에서 처리됨
  console.log('[highlightLyrics] beat:', beat, 'duration:', durationMs)
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


