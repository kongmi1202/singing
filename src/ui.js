import { getBuiltInSongs, loadReference } from './midi.js'
import { decodeAudioFile, analyzePitchTrack } from './audio.js'
import { analyzeAgainstReference, buildNoteComparisons } from './analysis.js'
import { renderResults } from './viz.js'

let selectedSongId = null
let uploadedFile = null
let audioUrl = null

export function initUI() {
  const app = document.querySelector('#app')
  app.innerHTML = `
    <div class="container">
      <h1>노래 분석</h1>
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
      
      updateLoadingMessage('🎵 MIDI 파일에서 정답 데이터를 불러오는 중...')
      const reference = await loadReference(selectedSongId)
      
      updateLoadingMessage('🎙️ 오디오 파일을 디코딩하는 중...')
      let audioBuffer
      try {
        audioBuffer = await decodeAudioFile(uploadedFile)
      } catch (e) {
        throw new Error(`오디오 디코딩 실패: ${e.message || e}. 브라우저가 m4a 코덱을 지원하지 않으면 wav/mp3로 변환해 주세요.`)
      }
      
      updateLoadingMessage('🎼 음고 분석을 위해 F₀ 데이터를 추출 중...')
      const pitchTrack = await analyzePitchTrack(audioBuffer)
      
      updateLoadingMessage(`🎯 BPM ${reference.tempoBpm}을 확인하고 리듬 오차 범위를 설정 중...`)
      const analysis = await analyzeAgainstReference(reference, pitchTrack)
      
      updateLoadingMessage('📊 음표별 오류 지점을 비교 분석하는 중...')
      const noteView = buildNoteComparisons(reference, pitchTrack)
      
      updateLoadingMessage('✨ 결과 화면을 준비하는 중...')
      renderResults({ reference, pitchTrack, analysis, noteView, audioUrl })
      
      // 🎉 분석 완료 알림
      hideLoadingOverlay()
      showCompletionNotification(analysis.verdict)
      
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
      <div class="spinner"></div>
      <h2>🎵 AI가 노래를 분석하고 있습니다</h2>
      <p id="loadingMessage">분석을 시작합니다...</p>
      <div class="loading-bar">
        <div class="loading-bar-fill"></div>
      </div>
      <small style="opacity:0.7;margin-top:10px;">잠시만 기다려 주세요 ☕</small>
    </div>
  `
  document.body.appendChild(overlay)
  
  // 애니메이션 시작
  setTimeout(() => overlay.classList.add('show'), 10)
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
  const overlay = document.getElementById('loadingOverlay')
  if (overlay) {
    overlay.classList.remove('show')
    setTimeout(() => overlay.remove(), 300)
  }
}

function showCompletionNotification(verdict) {
  const notification = document.createElement('div')
  notification.id = 'completionNotification'
  notification.innerHTML = `
    <div class="notification-content">
      <div class="notification-icon">🎉</div>
      <h2>분석 완료!</h2>
      <p>${verdict}! 멋진 연주를 확인해 보세요 ✨</p>
    </div>
  `
  document.body.appendChild(notification)
  
  setTimeout(() => notification.classList.add('show'), 10)
  setTimeout(() => {
    notification.classList.remove('show')
    setTimeout(() => notification.remove(), 300)
  }, 3000)
}


