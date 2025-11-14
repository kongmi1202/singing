import { getBuiltInSongs, loadReference } from './midi.js'
import { decodeAudioFile, analyzePitchTrack } from './audio.js'
import { analyzeAgainstReference, buildNoteComparisons } from './analysis.js'
import { renderResults } from './viz.js'

let selectedSongId = null
let uploadedFile = null
let audioUrl = null
let studentInfo = { id: '학생', name: '분석 결과' } // 기본값

export function initUI() {
  showStudentInfoScreen()
}

function showStudentInfoScreen() {
  const app = document.querySelector('#app')
  app.innerHTML = `
    <div class="container" style="max-width:500px;margin:0 auto;">
      <h1>🎵 AI 노래 분석</h1>
      <div style="text-align:center;margin-bottom:30px;opacity:0.8;">
        <p>노래 실력을 AI가 분석하고 피드백을 제공합니다</p>
      </div>
      <section class="panel" style="background:rgba(255,255,255,0.05);padding:24px;border-radius:12px;">
        <h3 style="margin-top:0;">학생 정보 입력</h3>
        <div style="margin-bottom:16px;">
          <label for="studentId" style="display:block;margin-bottom:6px;">학번</label>
          <input id="studentId" type="text" placeholder="예: 10131" 
                 style="width:100%;padding:10px;font-size:16px;border-radius:6px;border:1px solid #444;background:#2a2a2a;color:#fff;" />
        </div>
        <div style="margin-bottom:24px;">
          <label for="studentName" style="display:block;margin-bottom:6px;">이름</label>
          <input id="studentName" type="text" placeholder="예: 홍길동" 
                 style="width:100%;padding:10px;font-size:16px;border-radius:6px;border:1px solid #444;background:#2a2a2a;color:#fff;" />
        </div>
        <button id="startBtn" style="width:100%;padding:14px;font-size:18px;font-weight:bold;">
          시작하기 →
        </button>
        <p style="margin-top:16px;font-size:13px;opacity:0.6;text-align:center;">
          💡 입력한 정보는 분석 결과 저장에만 사용됩니다
        </p>
      </section>
    </div>
  `
  
  const studentIdInput = document.getElementById('studentId')
  const studentNameInput = document.getElementById('studentName')
  const startBtn = document.getElementById('startBtn')
  
  startBtn.addEventListener('click', () => {
    const id = studentIdInput.value.trim()
    const name = studentNameInput.value.trim()
    
    if (!id || !name) {
      alert('학번과 이름을 모두 입력해 주세요.')
      return
    }
    
    studentInfo.id = id
    studentInfo.name = name
    showAnalysisScreen()
  })
  
  // Enter 키로도 진행 가능
  studentNameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') startBtn.click()
  })
}

function showAnalysisScreen() {
  const app = document.querySelector('#app')
  app.innerHTML = `
    <div class="container">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
        <h1>노래 분석</h1>
        <div style="text-align:right;opacity:0.8;">
          <p style="margin:0;font-size:14px;">👤 ${studentInfo.name} (${studentInfo.id})</p>
        </div>
      </div>
      <section class="panel">
        <label for="songSelect">악곡 선택</label>
        <select id="songSelect"></select>
      </section>
      <section class="panel">
        <label for="audioInput">노래 업로드 (wav/mp3)</label>
        <input id="audioInput" type="file" accept="audio/*" />
        <audio id="player" controls style="display:none;margin-top:12px;"></audio>
      </section>
      <section class="panel">
        <button id="analyzeBtn" disabled>분석하기</button>
      </section>
      <section id="results" class="results" style="display:none;"></section>
    </div>
  `

  // Populate songs
  const select = document.getElementById('songSelect')
  const songs = getBuiltInSongs()
  songs.forEach(s => {
    const opt = document.createElement('option')
    opt.value = s.id
    opt.textContent = s.title
    select.appendChild(opt)
  })
  selectedSongId = songs[0]?.id || null

  select.addEventListener('change', (e) => {
    selectedSongId = e.target.value
    updateAnalyzeEnabled()
  })

  const input = document.getElementById('audioInput')
  const player = document.getElementById('player')
  input.addEventListener('change', async (e) => {
    const file = e.target.files?.[0]
    uploadedFile = file || null
    if (uploadedFile) {
      if (audioUrl) URL.revokeObjectURL(audioUrl)
      audioUrl = URL.createObjectURL(uploadedFile)
      player.src = audioUrl
      player.style.display = 'block'
    } else {
      player.removeAttribute('src')
      player.style.display = 'none'
    }
    updateAnalyzeEnabled()
  })

  const analyzeBtn = document.getElementById('analyzeBtn')
  analyzeBtn.addEventListener('click', async () => {
    if (!uploadedFile || !selectedSongId) return
    analyzeBtn.disabled = true
    analyzeBtn.textContent = '분석 중...'
    
    // 🎨 로딩 오버레이 표시
    showLoadingOverlay()
    
    try {
      // Basic validation: very short audio
      if (uploadedFile.size < 16 * 1024) {
        throw new Error('오디오 길이가 너무 짧습니다. 1초 이상 녹음해 주세요.')
      }
      
      updateLoadingMessage('📁 악보 데이터를 불러오고 있어요! 곧 시작됩니다 ✨')
      const reference = await loadReference(selectedSongId)
      
      updateLoadingMessage('🎙️ 멋진 목소리를 디코딩하는 중... 기대되네요! 😊')
      let audioBuffer
      try {
        audioBuffer = await decodeAudioFile(uploadedFile)
      } catch (e) {
        throw new Error(`오디오 디코딩 실패: ${e.message || e}. 브라우저가 m4a 코덱을 지원하지 않으면 wav/mp3로 변환해 주세요.`)
      }
      
      updateLoadingMessage('🎼 음정을 하나하나 세밀하게 분석 중... 거의 다 왔어요! 🎵')
      const pitchTrack = await analyzePitchTrack(audioBuffer)
      
      updateLoadingMessage(`🎯 리듬감을 체크하고 있어요! (BPM ${reference.tempoBpm}) 좋은 느낌이에요 💫`)
      const analysis = await analyzeAgainstReference(reference, pitchTrack)
      
      updateLoadingMessage('📊 어떤 부분을 더 연습하면 좋을지 찾고 있어요! 🔍')
      const noteView = buildNoteComparisons(reference, pitchTrack)
      
      updateLoadingMessage('✨ 결과를 예쁘게 정리하고 있어요... 조금만 더! 🎉')
      renderResults({ reference, pitchTrack, analysis, noteView, audioUrl, studentInfo })
      
      // 🎉 최종 완료 단계
      updateLoadingMessage('🎊 완료되었습니다! 최고예요! 🎊')
      
      // 🎉 분석 완료 알림
      await new Promise(r => setTimeout(r, 500)) // 완료 메시지 표시 시간
      hideLoadingOverlay()
      showCompletionNotification(analysis.verdict, studentInfo.name)
      
      document.getElementById('results').style.display = 'block'
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' })
    } catch (err) {
      console.error('[분석 오류]', err)
      hideLoadingOverlay()
      alert(`분석 중 오류가 발생했습니다.\n\n${err.message || err}`)
    } finally {
      analyzeBtn.disabled = false
      analyzeBtn.textContent = '분석하기'
    }
  })
}

function updateAnalyzeEnabled() {
  const btn = document.getElementById('analyzeBtn')
  btn.disabled = !(uploadedFile && selectedSongId)
}

// 🎨 로딩 오버레이 함수들

function showLoadingOverlay() {
  const overlay = document.createElement('div')
  overlay.id = 'loadingOverlay'
  overlay.innerHTML = `
    <div class="loading-content">
      <!-- AI 코치 캐릭터 -->
      <div class="ai-coach-character">
        <div class="coach-avatar">
          <div class="music-note note-1">♪</div>
          <div class="music-note note-2">♫</div>
          <div class="coach-face">🎤</div>
          <div class="music-note note-3">♬</div>
        </div>
      </div>
      
      <!-- 말풍선 메시지 -->
      <div class="speech-bubble">
        <p id="loadingMessage">와! 멋진 노래네요! 지금부터 꼼꼼하게 분석해 드릴게요 🎶</p>
      </div>
      
      <!-- 재미있는 팁 메시지 (순환) -->
      <div id="loadingTips" style="margin-top:15px;padding:12px;background:rgba(255,255,255,0.05);border-radius:8px;min-height:60px;transition:opacity 0.5s;">
        <p style="margin:0;font-size:14px;text-align:center;opacity:0.9;">💡 분석이 진행되는 동안 잠시만 기다려 주세요...</p>
      </div>
      
      <h2 style="margin:20px 0 10px 0;font-size:22px;">🎵 AI가 노래를 분석하고 있습니다</h2>
      
      <div style="margin-top:20px;padding:12px;background:rgba(255,255,255,0.05);border-radius:8px;border-left:3px solid #646cff;">
        <p style="margin:0;font-size:14px;opacity:0.9;">⏱️ <strong>분석에는 1~2분 정도 소요됩니다</strong></p>
        <p style="margin:5px 0 0 0;font-size:13px;opacity:0.7;">음고, 리듬, 음표별 오류를 세밀하게 분석하는 중입니다. 조금만 기다려 주세요!</p>
      </div>
      
      <div style="margin-top:20px;padding:12px;background:rgba(255,77,77,0.15);border-radius:8px;border-left:3px solid #ff4d4d;">
        <p style="margin:0;font-size:14px;opacity:0.95;font-weight:500;">⚠️ <strong>분석이 완료될 때까지 이 화면을 닫거나 나가지 마십시오.</strong></p>
      </div>
    </div>
  `
  document.body.appendChild(overlay)
  
  // 애니메이션 시작
  setTimeout(() => overlay.classList.add('show'), 10)
  
  // 🎯 재미있는 팁 순환 애니메이션 시작
  startTipsRotation()
}

// 🎨 재미있는 팁 순환 애니메이션
let tipsInterval = null
const funTips = [
  '🎵 AI가 여러분의 목소리를 하나하나 분석하고 있어요!',
  '🎼 음정과 리듬을 세밀하게 체크하는 중입니다...',
  '✨ 완벽하지 않아도 괜찮아요! 연습이 실력을 만듭니다 💪',
  '🎤 좋은 노래는 감정이 담겨있는 노래랍니다!',
  '🎶 호흡을 잘 조절하면 더 안정적인 소리가 나와요!',
  '🌟 매일 조금씩 연습하면 금방 늘어요!',
  '🎵 음정보다 리듬이 더 중요할 때도 있답니다!',
  '💫 거의 다 왔어요! 조금만 더 기다려 주세요!'
]

function startTipsRotation() {
  let currentTipIndex = 0
  const tipsEl = document.getElementById('loadingTips')
  
  if (!tipsEl) return
  
  tipsInterval = setInterval(() => {
    currentTipIndex = (currentTipIndex + 1) % funTips.length
    
    // 페이드 아웃
    tipsEl.style.opacity = '0'
    
    setTimeout(() => {
      // 텍스트 변경
      tipsEl.innerHTML = `<p style="margin:0;font-size:14px;text-align:center;opacity:0.9;">${funTips[currentTipIndex]}</p>`
      
      // 페이드 인
      tipsEl.style.opacity = '1'
    }, 300)
  }, 4000) // 4초마다 변경
}

function updateLoadingMessage(message) {
  const messageEl = document.getElementById('loadingMessage')
  
  if (messageEl) {
    messageEl.style.opacity = '0'
    setTimeout(() => {
      messageEl.textContent = message
      messageEl.style.opacity = '1'
    }, 150)
  }
}

function hideLoadingOverlay() {
  // 팁 순환 애니메이션 중지
  if (tipsInterval) {
    clearInterval(tipsInterval)
    tipsInterval = null
  }
  
  const overlay = document.getElementById('loadingOverlay')
  if (overlay) {
    overlay.classList.remove('show')
    setTimeout(() => overlay.remove(), 300)
  }
}

function showCompletionNotification(verdict, studentName) {
  const notification = document.createElement('div')
  notification.id = 'completionNotification'
  notification.innerHTML = `
    <div class="notification-content">
      <div class="notification-icon">🎉</div>
      <h2>분석 완료!</h2>
      <p>${studentName}님, ${verdict}! 멋진 연주를 확인해 보세요 ✨</p>
    </div>
  `
  document.body.appendChild(notification)
  
  setTimeout(() => notification.classList.add('show'), 10)
  setTimeout(() => {
    notification.classList.remove('show')
    setTimeout(() => notification.remove(), 300)
  }, 3000)
}


