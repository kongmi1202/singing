import { Chart, LineController, LineElement, PointElement, BarController, BarElement, LinearScale, CategoryScale, Tooltip, Legend, ScatterController } from 'chart.js'
import { buildYAxisTicksFromReference } from './midi.js'
import * as Tone from 'tone'

Chart.register(LineController, LineElement, PointElement, BarController, BarElement, LinearScale, CategoryScale, Tooltip, Legend, ScatterController)

export function renderResults({ reference, pitchTrack, analysis, noteView, audioUrl }) {
  const results = document.getElementById('results')
  results.innerHTML = `
    <div class="results-grid">
      <div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;gap:8px;">
          <button id="pagePrev">←</button>
          <div id="pageInfo" style="opacity:0.8;font-size:14px;">-</div>
          <button id="pageNext">→</button>
        </div>
        <div class="chart-wrap">
          <canvas id="pitchChart"></canvas>
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
    noteView?.issues?.forEach((iss, idx)=>{
      if (iss.beat>=windowStart && iss.beat<=windowStart+windowBeats){
        crosses.push({ x: iss.beat, y: iss.midi, meta: iss })
        crossIndexMap.push(idx)
      }
    })
    return { linesRef, linesUser, crosses, crossIndexMap }
  }

  function render(){
    const { linesRef, linesUser, crosses, crossIndexMap } = buildSlice()
    document.getElementById('pageInfo').textContent = pageInfoText()
    if (chart) chart.destroy()
    chart = new Chart(ctx, {
      type: 'line',
      data: { datasets: [
        { label:'정답', data: linesRef, parsing:{xAxisKey:'x',yAxisKey:'y'}, borderColor:'#3a86ff', backgroundColor:'rgba(58,134,255,0.6)', borderWidth:5, pointRadius:0, spanGaps:false, segment:{ borderDash: [] } },
        { label:'사용자', data: linesUser, parsing:{xAxisKey:'x',yAxisKey:'y'}, borderColor:'#ff8c00', backgroundColor:'rgba(255,140,0,0.6)', borderWidth:5, pointRadius:0, spanGaps:false, segment:{ borderDash: [] } },
        { label:'오차', data: crosses, parsing:{xAxisKey:'x',yAxisKey:'y'}, type:'scatter', pointStyle:'crossRot', pointBackgroundColor:'#ff4d4f', pointBorderColor:'#ff4d4f', pointRadius:6, hitRadius:8, hoverRadius:7, showLine:false, borderWidth:0 }
      ]},
      options: {
        animation:false, maintainAspectRatio:false,
        scales: {
          x: { type:'linear', min:windowStart, max:windowStart+windowBeats, title:{display:true,text:'박 (4/4)'}, ticks:{
              callback:(value)=>{
                if (Math.abs(value - Math.round(value)) > 1e-6) return ''
                const measure = Math.floor(value/4)+1
                const beatIn = Math.floor(value%4)+1
                return `${measure}|${beatIn}`
              }, maxRotation:0, autoSkip:true },
              grid:{ color:(c)=>{ const v=c.tick.value||0; return (Math.abs(v%4)<1e-6)?'#cfd8dc':'#e9eef1' }, lineWidth:(c)=>{ const v=c.tick.value||0; return (Math.abs(v%4)<1e-6)?1.5:0.6 } }
          },
          y: { type:'linear', min: Math.min(...yTicks.map(t=>t.value)) - 1, max: Math.max(...yTicks.map(t=>t.value)) + 1,
               ticks:{ callback:(v)=>{ const t=yTicks.find(t=>t.value===v); return t? t.label : '' }, stepSize:1 }, title:{display:true,text:'음고'} }
        },
        plugins: { tooltip:{ enabled:true, mode:'nearest', intersect:true, callbacks:{
          title:(items)=>{ const x = (Array.isArray(items[0].raw?.x)? items[0].raw.x[0]: items[0].parsed.x); const m=Math.floor(x/4)+1; const bi=Math.floor(x%4)+1; return `마디 ${m}, 박 ${bi}` },
          label:(ctx)=>{
            if (ctx.dataset.label==='사용자'){
              const x0 = Array.isArray(ctx.raw.x) ? ctx.raw.x[0] : ctx.parsed.x
              const note = reference.notes.find(n => x0>=n.startBeat-0.5 && x0<n.startBeat+n.durationBeats+0.5)
              let pitchDiff = null, startDiff = null
              if (note){ pitchDiff = (ctx.raw.y - note.midi).toFixed(2); startDiff = (x0 - note.startBeat).toFixed(2) }
              return `사용자: MIDI ${Number(ctx.raw.y).toFixed(2)} (피치Δ ${pitchDiff ?? '-'}, 시작Δ ${startDiff ?? '-'} 박)`
            }
            return `${ctx.dataset.label}`
          }
        } }, legend:{ position:'top' } },
        onHover: (_, elements) => {
          if (!elements || !elements.length) return
          const el = elements[0]
          const crossDatasetIdx = chart.data.datasets.length - 1
          if (el.datasetIndex !== crossDatasetIdx) return
          const scatterPointIdx = el.index
          const aIdx = crossIndexMap[scatterPointIdx]
          if (aIdx == null) return
          const issue = noteView.issues[aIdx]
          const beat = issue?.beat ?? labels[el.index]
          playAB(reference, audioUrl, beat)
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
async function playAB(reference, audioUrl, beat) {
  const nowMs = performance.now()
  if (nowMs - abDebounce < 250) return
  abDebounce = nowMs
  await Tone.start()
  const tempo = reference.tempoBpm || 120
  const secondsPerBeat = 60 / tempo
  const tSec = beat * secondsPerBeat
  const dur = 0.5

  // A: reference tone (sine)
  const synth = new Tone.Synth().toDestination()
  const note = reference.notes.find(n => beat >= n.startBeat && beat < n.startBeat + n.durationBeats)
  if (note) synth.triggerAttackRelease(midiToFreq(note.midi), dur, `+0.00`)

  // small gap then B: user slice
  if (audioUrl) {
    const player = new Tone.Player(audioUrl).toDestination()
    await player.load(audioUrl)
    player.start(`+${Math.max(0.1, dur + 0.05)}`, tSec, dur)
  }
}

function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12)
}


