import { Chart, LineController, LineElement, PointElement, BarController, BarElement, LinearScale, CategoryScale, Tooltip, Legend, ScatterController } from 'chart.js'
import { buildYAxisTicksFromReference } from './midi.js'
import * as Tone from 'tone'
import OpenAI from 'openai'

Chart.register(LineController, LineElement, PointElement, BarController, BarElement, LinearScale, CategoryScale, Tooltip, Legend, ScatterController)

// OpenAI 클라이언트 초기화
let openaiClient = null
function initOpenAI() {
  const apiKey = import.meta.env.VITE_OPENAI_API_KEY
  if (apiKey && apiKey !== 'your_openai_api_key_here') {
    openaiClient = new OpenAI({
      apiKey: apiKey,
      dangerouslyAllowBrowser: true // 브라우저에서 사용하기 위해 필요
    })
    return true
  }
  return false
}

// OpenAI를 사용한 연습 전략 생성
async function generatePracticeStrategy(errorInfo, reference) {
  if (!openaiClient) {
    if (!initOpenAI()) {
      return null // API 키가 없으면 null 반환
    }
  }

  try {
    const { pitchDiff, startDiff, durationDiff, isRhythmStartError, isRhythmDurationError, beat } = errorInfo
    
    // 오류 정보를 설명하는 프롬프트 생성
    let errorDescription = ''
    const refNote = reference.notes.find(n => Math.abs(n.startBeat - beat) < 0.01)
    const noteName = refNote ? ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][Math.round(refNote.midi) % 12] + Math.floor(Math.round(refNote.midi) / 12 - 1) : '음표'
    
    if (pitchDiff != null && Math.abs(pitchDiff) > 1.0) {
      const direction = pitchDiff > 0 ? '높게' : '낮게'
      const semitones = Math.abs(pitchDiff)
      errorDescription += `음고 오류: ${noteName} 음을 정답보다 ${semitones.toFixed(1)}반음 ${direction} 불렀습니다. `
    }
    
    if (isRhythmStartError) {
      const direction = startDiff > 0 ? '늦게' : '빠르게'
      errorDescription += `리듬 시작 오류: ${Math.abs(startDiff).toFixed(2)}박만큼 ${direction} 시작했습니다. `
    }
    
    if (isRhythmDurationError) {
      const direction = durationDiff > 0 ? '길게' : '짧게'
      errorDescription += `리듬 길이 오류: 정답보다 ${Math.abs(durationDiff).toFixed(2)}박 ${direction} 불렀습니다. `
    }

    const response = await openaiClient.chat.completions.create({
      model: 'gpt-4o-mini', // 더 저렴한 모델 사용
      messages: [
        {
          role: 'system',
          content: '당신은 음악 교육 전문가입니다. 학생의 노래 연습을 위한 구체적이고 실용적인 조언을 제공합니다.'
        },
        {
          role: 'user',
          content: `다음 오류가 발생했습니다: ${errorDescription}\n\n이 오류를 개선하기 위한 구체적이고 실용적인 연습 방법을 한 문장으로 제시해주세요. 예: "메트로놈을 60 BPM으로 설정하고, 정답 멜로디를 3번 듣고 나서 정확한 박자에 맞춰 천천히 따라 불러보세요."`
        }
      ],
      max_tokens: 100,
      temperature: 0.7
    })

    return response.choices[0].message.content.trim()
  } catch (error) {
    console.error('[OpenAI] 연습 전략 생성 실패:', error)
    return null
  }
}

export async function renderResults({ reference, pitchTrack, analysis, noteView, audioUrl, studentInfo }) {
  // Store globally for playback functions
  globalNoteView = noteView
  globalReference = reference
  console.log('[renderResults] noteView.issues:', noteView?.issues?.length)
  
  // OpenAI 연습 전략 캐시 (issue 인덱스를 키로 사용)
  const practiceStrategyCache = new Map()
  
  // 모든 issue에 대해 연습 전략 미리 생성 (비동기)
  if (noteView?.issues) {
    const strategyPromises = noteView.issues.map(async (iss, idx) => {
      try {
        const strategy = await generatePracticeStrategy({
          pitchDiff: iss.pitchDiff,
          startDiff: iss.startDiff,
          durationDiff: iss.durationDiff,
          isRhythmStartError: iss.isRhythmStartError,
          isRhythmDurationError: iss.isRhythmDurationError,
          beat: iss.beat
        }, reference)
        if (strategy) {
          practiceStrategyCache.set(idx, strategy)
        }
      } catch (error) {
        console.error(`[OpenAI] Issue ${idx} 전략 생성 실패:`, error)
      }
    })
    // 백그라운드에서 실행 (차트는 먼저 렌더링)
    Promise.all(strategyPromises).then(() => {
      // 전략이 생성되면 차트 업데이트
      if (chart) {
        render()
      }
    })
  }
  
  const results = document.getElementById('results')
  results.innerHTML = `
    <div style="margin-bottom:16px;padding:16px;background:rgba(100,108,255,0.1);border-radius:10px;border-left:4px solid #646cff;">
      <h2 style="margin:0 0 8px 0;">📝 분석 결과 - ${studentInfo?.name || '학생'} (${studentInfo?.id || '-'})</h2>
      <p style="margin:0;opacity:0.8;font-size:14px;">${new Date().toLocaleString('ko-KR')}</p>
    </div>
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
        <div class="box" style="background:#f8f9fa;border-left:4px solid #3a86ff;">
          <h3>📊 그래프 분석 가이드</h3>
          <ul style="font-size:13px;line-height:1.6;">
            <li><strong>📏 그래프 X축 (가로축)</strong>: <strong>박 (4/4)</strong> - 시간이 흐르는 순서를 나타냅니다. 왼쪽에서 오른쪽으로 갈수록 노래가 진행됩니다. 각 마디는 4박으로 나뉘어 있어요.</li>
            <li><strong>🎵 그래프 Y축 (세로축)</strong>: <strong>음고</strong> - 노래의 높낮이를 나타냅니다. 위로 갈수록 높은 음, 아래로 갈수록 낮은 음이에요. C4, D4, E4 같은 음표 이름으로 표시됩니다.</li>
            <li><strong style="color:#3a86ff;">파란색 막대 (정답)</strong>: 정답 악보에서 나와야 하는 목표 음정과 길이를 보여줍니다. 이 막대처럼 노래하면 정답이에요!</li>
            <li><strong style="color:#ff8c00;">주황색 막대 (사용자)</strong>: 실제로 노래한 음정과 길이를 보여줍니다. 파란색 막대와 비교해서 얼마나 정확하게 불렀는지 확인할 수 있어요.</li>
            <li><strong style="color:#ff4d4f;">빨간색 X표 (오류)</strong>:
              <br>1. X표에 마우스를 올리면 내가 틀린 부분과 연습 전략이 나와요.
              <br>2. X표를 클릭하면 해당 마디 전체의 정답 멜로디와 내 노래가 동시에 재생돼요. 내 노래와 정답을 비교해 보세요.
              <br>• <strong>음고 오류</strong>: 정답보다 반음 이상 높거나 낮게 불렀을 때 나타나요.
              <br>• <strong>리듬 오류</strong>: 박자를 맞추지 못했을 때 나타나요.</li>
          </ul>
        </div>
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
    // ✅ 사용자 막대 렌더링: 항상 실제 분석된 값 표시
    // Y축(midi): isPitchCorrectOnly=true이면 정답과 일치
    // X축(x0, x1): 항상 실제 시작/종료 위치 (리듬 오류 시각화)
    noteView?.barsUser?.forEach((b, idx)=>{ 
      if (b.midi!=null) {
        pushLine(linesUser, b)
      }
    })
    
    // 🎯 음고 또는 리듬 오류가 있는 음표에 X표시
    noteView.issues.forEach((iss, idx)=>{
      if (iss.beat>=windowStart && iss.beat<=windowStart+windowBeats){
        crosses.push({ x: iss.beat, y: iss.midi, meta: iss })
        crossIndexMap.push(idx)
        
        // 🎯 오류 레이블 표시: 음고 및 리듬(시작점만) 오류 표시
        const parts = []
        const tempo = reference.tempoBpm || 120
        const sixteenthNoteDuration = 60000 / (tempo * 4)
        const tolMs = sixteenthNoteDuration * 1.3 // 16분음표 × 1.3배
        
        // 오차를 음표 단위로 환산하는 헬퍼 함수
        const convertToMusicalUnit = (errorBeats) => {
          const absError = Math.abs(errorBeats)
          
          // 음표 단위 정의 (박 기준)
          const quarter = 1.0      // 4분음표
          const eighth = 0.5       // 8분음표
          const sixteenth = 0.25   // 16분음표
          
          // 가장 가까운 음표 단위 찾기 (80% 이상 일치하면 해당 단위로 인정)
          if (absError >= quarter * 0.8) {
            return '4분음표'
          } else if (absError >= eighth * 0.8) {
            return '8분음표'
          } else if (absError >= sixteenth * 0.8) {
            return '16분음표'
          } else {
            return '약간'
          }
        }
        
        // 정답 음표 찾기 (교육적 피드백용)
        const refNote = reference.notes.find(n => Math.abs(n.startBeat - iss.beat) < 0.01)
        const expectedBeats = refNote ? refNote.durationBeats : 1.0
        
        // 🎵 음고 오류 체크 - 음악 용어 기반 피드백
        if (iss.pitchDiff != null){
          const cents = Math.abs(iss.pitchDiff) * 100
          if (cents > 100) { // 100 Cent 이상은 음고 오류
            const semitones = Math.abs(iss.pitchDiff)
            const direction = iss.pitchDiff > 0 ? '높음' : '낮음'
            
            // 반음 단위로 환산하여 교육적 코칭 메시지 생성
            if (semitones >= 2.0 * 0.8) {
              parts.push(`⚠️ 음고: 온음(2반음) 정도 ${direction}! 음정을 크게 틀렸어요`)
            } else if (semitones >= 1.0 * 0.8) {
              parts.push(`음고: 반음 정도 ${direction}. 정답 음정에 집중하세요`)
            } else {
              parts.push(`음고: 약간 ${direction}`)
            }
          }
        }
        
        // 🎵 리듬 오류 체크 (시작점 + 길이) - 음악 용어 기반 피드백
        // 시작점 오류
        if (iss.isRhythmStartError) {
          const unit = convertToMusicalUnit(iss.startDiff)
          const direction = iss.startDiff > 0 ? '늦게' : '빠르게'
          
          // 명령형 코칭 메시지
          if (unit === '4분음표') {
            parts.push(`⚠️ 시작: 4분음표만큼 ${direction}! 박자를 정확히 맞춰야 해요`)
          } else if (unit === '8분음표') {
            parts.push(`시작: 8분음표 ${direction}. 박자에 집중하세요`)
          } else if (unit === '16분음표') {
            parts.push(`시작: 16분음표 ${direction}`)
          } else {
            parts.push(`시작: 약간 ${direction}`)
          }
        }
        
        // 길이 오류
        if (iss.isRhythmDurationError) {
          const unit = convertToMusicalUnit(iss.durationDiff)
          const direction = iss.durationDiff > 0 ? '길게' : '짧게'
          
          // 정답 박자 표시 (예: "1박", "2박")
          const expectedBeatsStr = expectedBeats === 1.0 ? '1박' 
                                 : expectedBeats === 0.5 ? '8분음표(0.5박)'
                                 : expectedBeats === 2.0 ? '2박'
                                 : `${expectedBeats.toFixed(1)}박`
          
          // 명령형 코칭 메시지
          if (unit === '4분음표') {
            parts.push(`⚠️ 길이: 정답보다 4분음표 ${direction} 불렀어요. ${expectedBeatsStr}으로 불러보세요`)
          } else if (unit === '8분음표') {
            parts.push(`길이: 정답보다 8분음표 ${direction} 불렀어요. ${expectedBeatsStr}으로 불러야 해요`)
          } else if (unit === '16분음표') {
            parts.push(`길이: 정답보다 16분음표 ${direction}. 거의 정확해요!`)
          } else {
            parts.push(`길이: 약간 ${direction}`)
          }
        }
        
        // 🎯 연습 전략은 오류 메시지 수집 후 한 번만 추가
        if (parts.length) {
          const aiStrategy = practiceStrategyCache.get(idx)
          if (aiStrategy) {
            parts.push(`💡 연습: ${aiStrategy}`)
          } else {
            // 기본 연습 전략: 오류 유형에 따라 적절한 메시지 선택
            if (iss.pitchDiff != null && Math.abs(iss.pitchDiff) * 100 > 100) {
              parts.push(`💡 연습: 정답 멜로디를 듣고 정확한 음정을 맞춰보세요`)
            } else if (iss.isRhythmStartError || iss.isRhythmDurationError) {
              const expectedBeatsStr = expectedBeats === 1.0 ? '1박' 
                                     : expectedBeats === 0.5 ? '8분음표(0.5박)'
                                     : expectedBeats === 2.0 ? '2박'
                                     : `${expectedBeats.toFixed(1)}박`
              if (iss.isRhythmDurationError) {
                parts.push(`💡 연습: 정답 멜로디의 길이를 정확히 듣고 ${expectedBeatsStr}만큼만 불러보세요`)
              } else {
                parts.push(`💡 연습: 정답 멜로디의 박자를 손으로 치며 따라 불러보세요`)
              }
            }
          }
          
          // 말풍선 텍스트 생성 (줄바꿈 처리)
          const text = parts.join('\n') // 줄바꿈으로 구분
          errorLabels.push({ x: iss.beat, y: iss.midi + 0.8, text, idx })
        }
      }
    })
    
    console.log('[X표시] 음고/리듬 오류 개수:', crosses.length)
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
        { label:'정답', data: linesRef, parsing:{xAxisKey:'x',yAxisKey:'y'}, borderColor:'#3a86ff', backgroundColor:'rgba(58,134,255,0.6)', borderWidth:5, pointRadius:0, spanGaps:false, segment:{ borderDash: [] }, tooltip: { enabled: false } },
        { label:'사용자', data: linesUser, parsing:{xAxisKey:'x',yAxisKey:'y'}, borderColor:'#ff8c00', backgroundColor:'rgba(255,140,0,0.6)', borderWidth:5, pointRadius:0, spanGaps:false, segment:{ borderDash: [] }, tooltip: { enabled: false } },
        { label:'오류 (X표시)', data: crosses, parsing:{xAxisKey:'x',yAxisKey:'y'}, type:'scatter', pointStyle:'crossRot', pointBackgroundColor:'#ff4d4f', pointBorderColor:'#ff4d4f', pointRadius:10, pointBorderWidth:2, hitRadius:15, hoverRadius:12, showLine:false }
      ]},
      plugins: [{
        id: 'lyricsPlugin',
        afterDatasetsDraw: (chart) => {
          const ctx = chart.ctx
          const xScale = chart.scales.x
          const yScale = chart.scales.y
          
          // 🎵 각 가사를 해당 음표 막대바 바로 아래에 그리기
          lyricsInWindow.forEach(lyric => {
            // 해당 가사와 일치하는 음표 찾기
            const note = reference.notes.find(n => Math.abs(n.startBeat - lyric.beat) < 0.01)
            if (!note) return
            
            const xPixel = xScale.getPixelForValue(lyric.beat)
            // 🎯 Y좌표를 음표의 MIDI 값 기준으로 막대 바로 아래에 배치
            const midiPixel = yScale.getPixelForValue(note.midi)
            const yBottom = midiPixel + 22 // 막대 바로 아래 22px (가독성 개선)
            
            ctx.save()
            ctx.font = 'bold 16px "맑은 고딕", sans-serif'
            ctx.fillStyle = '#1a1a1a'
            ctx.textAlign = 'center'
            ctx.textBaseline = 'top'
            
            // 🎯 가사 텍스트를 음표 시작 위치(X좌표)에 정확히 동기화
            // 배경 박스로 가독성 향상
            const textWidth = ctx.measureText(lyric.text).width
            ctx.fillStyle = 'rgba(255, 255, 255, 0.85)'
            ctx.fillRect(xPixel - textWidth/2 - 4, yBottom - 2, textWidth + 8, 20)
            
            ctx.fillStyle = '#1a1a1a'
            ctx.fillText(lyric.text, xPixel, yBottom)
            
            // 연결선 (막대에서 가사로) - 짧고 명확하게
            ctx.strokeStyle = 'rgba(0,0,0,0.25)'
            ctx.lineWidth = 1.5
            ctx.setLineDash([2, 2])
            ctx.beginPath()
            ctx.moveTo(xPixel, midiPixel + 4)
            ctx.lineTo(xPixel, yBottom - 2)
            ctx.stroke()
            ctx.setLineDash([])
            
            ctx.restore()
          })
        }
      }],
      options: {
        animation:false, maintainAspectRatio:false,
        layout: { padding: { bottom: 10 } }, // 가사가 그래프 내부에 있으므로 최소 여백
        onHover: (event, activeElements) => {
          // 🎵 그래프 위에서는 항상 포인터 커서 표시
          event.native.target.style.cursor = 'pointer'
        },
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
          y: { type:'linear', min: Math.min(...yTicks.map(t=>t.value)) - 1, max: Math.max(...yTicks.map(t=>t.value)) + 3,
               ticks:{ callback:(v)=>{ const t=yTicks.find(t=>t.value===v); return t? t.label : '' }, stepSize:1 }, title:{display:true,text:'음고'} }
        },
        plugins: { 
          tooltip:{ 
            enabled:true, 
            mode:'nearest', 
            intersect:true, // X표에 정확히 마우스를 올려야 tooltip이 표시되도록
            // 🎯 말풍선 크기 조정
            maxWidth: 280, // 최대 너비 제한 (그래프 내부에 맞게 조정)
            padding: 10, // 내부 여백
            titleFont: { size: 14, weight: 'bold' },
            bodyFont: { size: 12 }, // 폰트 크기 약간 축소
            titleSpacing: 6,
            bodySpacing: 4,
            // 말풍선이 그래프 영역 내에 표시되도록 위치 조정
            position: 'nearest',
            // X표 데이터셋만 tooltip 표시
            filter: function(tooltipItem) {
              return tooltipItem.dataset.label === '오류 (X표시)'
            },
            callbacks:{
              title:(items)=>{ 
                // X표만 표시되므로 첫 번째 항목이 X표임
                const x = items[0].parsed?.x ?? items[0].raw?.x
                if (x==null) return ''
                const m=Math.floor(x/4)+1; const bi=Math.floor(x%4)+1
                return `마디 ${m}, 박 ${bi}`
              },
              label:(ctx)=>{ 
                // 이 callback은 X표에 대해서만 호출됨 (filter로 필터링됨)
                if (ctx.dataset.label==='오류 (X표시)') {
                  try {
                    const pt = crosses[ctx.dataIndex]
                    if (!pt?.meta) {
                      console.warn('[tooltip] No meta for cross at index', ctx.dataIndex)
                      return ['오류']
                    }
                    const lbl = errorLabels.find(e => Math.abs(e.x - pt.x) < 0.01 && Math.abs(e.y - pt.y - 0.8) < 0.1)
                    if (!lbl) {
                      console.warn('[tooltip] No label found for cross at', pt.x, pt.y)
                      return ['오류']
                    }
                    // 줄바꿈 처리된 텍스트를 배열로 변환하여 여러 줄로 표시
                    return lbl.text.split('\n')
                  } catch (error) {
                    console.error('[tooltip] Error in label callback:', error)
                    return ['오류']
                  }
                }
                return ''
              }
            }
          }, 
          legend:{ position:'top' } 
        },
        onClick: async (evt, elements) => {
          console.log('[CLICK] elements:', elements)
          const crossDatasetIdx = chart.data.datasets.length - 1
          
          // 🎵 요소를 클릭한 경우
          if (elements && elements.length > 0) {
            const el = elements[0]
            if (el.datasetIndex === crossDatasetIdx) {
              // X표를 클릭: A/B 비교 재생
              const scatterPointIdx = el.index
              const aIdx = crossIndexMap[scatterPointIdx]
              console.log('[CLICK X] aIdx:', aIdx, 'issue:', noteView?.issues?.[aIdx])
              const issue = noteView?.issues?.[aIdx]
              const beat = issue?.beat ?? crosses[scatterPointIdx]?.x
              if (beat != null) await playAB(reference, audioUrl, beat)
              return
            }
          }
          
          // 🎵 그래프 영역 아무 곳이나 클릭: 해당 위치의 beat로 A/B 비교 재생
          const xScale = evt.chart.scales.x
          const canvasPosition = Chart.helpers.getRelativePosition(evt, evt.chart)
          const beat = xScale.getValueForPixel(canvasPosition.x)
          
          console.log('[CLICK GRAPH AREA] beat:', beat)
          
          // 클릭한 위치에 해당하는 음표 찾기
          const note = reference.notes.find(n => 
            beat >= n.startBeat && beat < n.startBeat + n.durationBeats
          )
          
          if (note) {
            console.log('[CLICK GRAPH] note found:', note)
            // 🎨 시각적 피드백: 캔버스 깜박임
            const canvas = evt.chart.canvas
            canvas.style.opacity = '0.7'
            setTimeout(() => { canvas.style.opacity = '1' }, 100)
            
            await playAB(reference, audioUrl, note.startBeat)
          } else {
            console.log('[CLICK GRAPH] no note found at beat:', beat)
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
    const note = reference.notes.find(n => beat >= n.startBeat && beat < n.startBeat + n.durationBeats)
    
    // 🎵 마디 단위 재생: 클릭한 음표가 속한 마디 전체를 재생
    const beatsPerMeasure = reference.timeSig ? reference.timeSig[0] : 4 // 4/4 박자
    const measureStart = Math.floor(beat / beatsPerMeasure) * beatsPerMeasure
    const measureDuration = beatsPerMeasure // 마디 길이 (박 단위)
    
    // 🎯 Pre-Attack 포함: 마디 시작점보다 500ms 앞에서 재생 시작
    const preAttackSeconds = 0.5 // 500ms
    const measureStartSec = (measureStart + offsetBeats) * secondsPerBeat
    const tSecWithPreAttack = Math.max(0, measureStartSec - preAttackSeconds)
    const durWithPreAttack = (measureDuration * secondsPerBeat) + preAttackSeconds
    
    console.log('[playAB] tempo:', tempo, 'offsetBeats:', offsetBeats)
    console.log('[playAB] measure:', measureStart, 'durBeats:', measureDuration, 'note:', note)
    console.log('[playAB] tSec:', tSecWithPreAttack, 'dur:', durWithPreAttack)
    
    // Visual feedback (마디 전체 + pre-attack)
    highlightErrorBar(measureStart, durWithPreAttack * 1000)
    // 🎯 재생선: pre-attack 구간을 고려하여 실제 오디오 재생 시작점과 동기화
    // 그래프는 이미 offsetBeats가 적용된 좌표계이므로 measureStart가 실제 노래 시작과 일치
    const playheadStartBeat = measureStart - (preAttackSeconds / secondsPerBeat)
    console.log('[playAB] playhead: start beat:', playheadStartBeat, 'duration:', durWithPreAttack, 'sec')
    startPlaybackPointer(playheadStartBeat, durWithPreAttack, tempo)
    highlightLyrics(measureStart, durWithPreAttack * 1000)
    
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
    
    // Seek to position (Pre-Attack 포함)
    const seekTo = Math.max(0, Math.min(tSecWithPreAttack, audio.duration - durWithPreAttack))
    audio.currentTime = seekTo
    console.log('[playAB] seeked to:', seekTo, 'will play for:', durWithPreAttack, 'sec')
    
    // 🎵 동시 재생: 사용자 오디오와 마디 전체의 정답 멜로디를 완벽히 동기화
    try {
      await Tone.start()
      
      // 🎼 마디에 속한 모든 음표들의 정답 멜로디 생성
      const synth = new Tone.PolySynth(Tone.Synth, {
        volume: -6 // 정답 소리를 약간 작게 (사용자 소리와 구분)
      }).toDestination()
      
      // 마디 내의 모든 음표 찾기
      const notesInMeasure = reference.notes.filter(n => 
        n.startBeat >= measureStart && n.startBeat < measureStart + measureDuration
      )
      
      console.log('[playAB] ▶ SIMULTANEOUS PLAYBACK: measure', measureStart / beatsPerMeasure + 1)
      console.log('[playAB] notes in measure:', notesInMeasure.length)
      
      // Step 1: 사용자 오디오 재생 시작
      await audio.play()
      
      // Step 2: 마디의 각 음표를 정확한 타이밍에 재생
      notesInMeasure.forEach(n => {
        const noteDelay = (n.startBeat - measureStart) * secondsPerBeat + preAttackSeconds
        const noteDur = n.durationBeats * secondsPerBeat
        const freq = midiToFreq(n.midi)
        
        setTimeout(() => {
          synth.triggerAttackRelease(freq, noteDur)
        }, noteDelay * 1000)
      })
      
      // Step 3: 마디 전체 재생 후 사용자 오디오 중지
      setTimeout(() => {
        audio.pause()
        console.log('[playAB] ⏸ simultaneous playback ended')
      }, durWithPreAttack * 1000)
      
    } catch (e) {
      console.error('[playAB] synth error:', e)
      // synth 실패 시에도 사용자 오디오는 재생
      await audio.play()
      setTimeout(() => audio.pause(), durWithPreAttack * 1000)
    }
    
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
  
  // 🎯 재생선 시작/종료 위치 계산
  const startX = xScale.getPixelForValue(beat)
  const endBeat = beat + durationSec * tempo / 60
  const endX = xScale.getPixelForValue(endBeat)
  const deltaX = endX - startX
  
  // 🎯 부드러운 애니메이션 (60fps 기준)
  const steps = Math.max(30, Math.floor(durationSec * 30)) // 최소 30 스텝
  const interval = (durationSec * 1000) / steps
  let step = 0
  pointer.style.left = `${startX}px`
  
  console.log('[playbackPointer] beat:', beat, '→', endBeat, '| pixels:', startX, '→', endX, '| duration:', durationSec, 's')
  
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


