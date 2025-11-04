import { Chart, LineController, LineElement, PointElement, LinearScale, CategoryScale, Tooltip, Legend, ScatterController } from 'chart.js'
import { buildYAxisTicksFromReference } from './midi.js'
import * as Tone from 'tone'

Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Tooltip, Legend, ScatterController)

export function renderResults({ reference, pitchTrack, analysis, audioUrl }) {
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
    const labels = []
    const refData = []
    const userData = []
    const crossData = []
    const crossIndexMap = []
    for (let i=0;i<analysis.beats.length;i++){
      const b = analysis.beats[i]
      if (b < windowStart || b > windowStart + windowBeats) continue
      labels.push(b)
      refData.push(analysis.refMidi[i] == null ? NaN : analysis.refMidi[i])
      userData.push(analysis.userMidi[i] == null ? NaN : analysis.userMidi[i])
      if (analysis.incorrectMask[i] && analysis.refMidi[i] != null && analysis.userMidi[i] != null){
        crossIndexMap.push(i)
        crossData.push({ x: labels.length-1, y: analysis.refMidi[i] })
      }
    }
    return { labels, refData, userData, crossData, crossIndexMap }
  }

  function render(){
    const { labels, refData, userData, crossData, crossIndexMap } = buildSlice()
    document.getElementById('pageInfo').textContent = pageInfoText()
    if (chart) chart.destroy()
    chart = new Chart(ctx, {
      type: 'line',
      data: { labels, datasets: [
        { label:'정답', data: refData, spanGaps:true, borderColor:'#4caf50', pointRadius:0, borderWidth:2 },
        { label:'사용자', data: userData, spanGaps:true, borderColor:'#2196f3', pointRadius:0, borderWidth:2 },
        { label:'오차', data: crossData, parsing:{xAxisKey:'x',yAxisKey:'y'}, type:'scatter', pointStyle:'crossRot', pointBackgroundColor:'#ff4d4f', pointBorderColor:'#ff4d4f', pointRadius:6, hitRadius:8, hoverRadius:7, showLine:false, borderWidth:0 }
      ]},
      options: {
        animation:false, maintainAspectRatio:false,
        scales: {
          x: { title:{display:true,text:'마디-박 (4/4)'}, ticks:{
              callback:(value, index)=>{
                const b = labels[index]
                if (Math.abs(b - Math.round(b)) > 1e-6) return ''
                const measure = Math.floor(b/4)+1
                const beatIn = Math.floor(b%4)+1
                return `${measure}|${beatIn}`
              }, maxRotation:0, autoSkip:true },
              grid:{ color:(c)=>{ const b=labels[c.index]||0; return (Math.abs(b%4)<1e-6)?'#cfd8dc':'#e9eef1' }, lineWidth:(c)=>{ const b=labels[c.index]||0; return (Math.abs(b%4)<1e-6)?1.5:0.6 } }
          },
          y: { ticks:{ callback:(v)=>{ const t=yTicks.find(t=>t.value===v); return t? t.label : '' }, stepSize:1 }, title:{display:true,text:'음'} }
        },
        plugins: { tooltip:{ enabled:true, mode:'index', intersect:false, callbacks:{
          title:(items)=>{ const b=labels[items[0].dataIndex]; const m=Math.floor(b/4)+1; const bi=Math.floor(b%4)+1; return `마디 ${m}, 박 ${bi} (b=${b.toFixed(2)})` },
          label:(ctx)=> `${ctx.dataset.label}: ${Number(ctx.parsed.y).toFixed(2)} MIDI`
        } }, legend:{ position:'top' } },
        onHover: (_, elements) => {
          if (!elements || !elements.length) return
          const el = elements[0]
          const crossDatasetIdx = chart.data.datasets.length - 1
          if (el.datasetIndex !== crossDatasetIdx) return
          const scatterPointIdx = el.index
          const aIdx = crossIndexMap[scatterPointIdx]
          if (aIdx == null) return
          playAB(reference, audioUrl, analysis.beats[aIdx])
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


