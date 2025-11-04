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
    try {
      // Basic validation: very short audio
      if (uploadedFile.size < 16 * 1024) {
        throw new Error('오디오 길이가 너무 짧습니다. 1초 이상 녹음해 주세요.')
      }
      const reference = await loadReference(selectedSongId)
      let audioBuffer
      try {
        audioBuffer = await decodeAudioFile(uploadedFile)
      } catch (e) {
        throw new Error(`오디오 디코딩 실패: ${e.message || e}. 브라우저가 m4a 코덱을 지원하지 않으면 wav/mp3로 변환해 주세요.`)
      }
      const pitchTrack = await analyzePitchTrack(audioBuffer)
      const analysis = await analyzeAgainstReference(reference, pitchTrack)
      const noteView = buildNoteComparisons(reference, pitchTrack)
      renderResults({ reference, pitchTrack, analysis, noteView, audioUrl })
      document.getElementById('results').style.display = 'block'
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' })
    } catch (err) {
      console.error('[분석 오류]', err)
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


