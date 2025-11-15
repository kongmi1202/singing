import Pitchfinder from 'pitchfinder'

export async function decodeAudioFile(file) {
  const arrayBuffer = await file.arrayBuffer()
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)()
  const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer)
  return audioBuffer
}

// Preprocess: mono, band-pass(HP 70Hz + LP 2kHz), normalize, offline-rendered
async function preprocessBuffer(buffer) {
  const sampleRate = buffer.sampleRate
  const length = buffer.length
  const offline = new OfflineAudioContext(1, length, sampleRate)
  const src = offline.createBufferSource()
  // Downmix to mono if needed
  const mono = offline.createBuffer(1, length, sampleRate)
  const dst = mono.getChannelData(0)
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch)
    for (let i = 0; i < length; i++) dst[i] += data[i] / buffer.numberOfChannels
  }
  src.buffer = mono
  const hp = offline.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 70
  const lp = offline.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2000
  const gain = offline.createGain(); gain.gain.value = 1.0
  src.connect(hp).connect(lp).connect(gain).connect(offline.destination)
  src.start()
  const rendered = await offline.startRendering()
  // Normalize to -1..1 peak 0.9
  const ch0 = rendered.getChannelData(0)
  let peak = 0
  for (let i=0;i<ch0.length;i++) peak = Math.max(peak, Math.abs(ch0[i]))
  if (peak > 0) {
    const s = 0.9 / peak
    for (let i=0;i<ch0.length;i++) ch0[i] *= s
  }
  return rendered
}

export async function analyzePitchTrack(audioBuffer) {
  const processed = await preprocessBuffer(audioBuffer)
  const channelData = processed.getChannelData(0)
  const sampleRate = processed.sampleRate
  // 🎯 Frame config: 더 큰 프레임으로 저음역 안정성 향상
  const frameSize = 8192 // 4096→8192: 낮은 음도 정확하게 감지
  const hopSize = 512 // 256→512: 시간 해상도 유지하면서 계산 효율 향상
  const detector = Pitchfinder.YIN({ 
    sampleRate, 
    threshold: 0.15 // 0.1→0.15: 더 엄격하게 (노이즈를 피치로 오인하지 않도록)
  })
  const times = []
  const f0 = []
  const confidence = [] // 각 프레임의 신뢰도 저장
  const totalFrames = Math.floor((channelData.length - frameSize) / hopSize)
  
  // Process in chunks to avoid blocking the UI
  const chunkSize = 50 // frames per yield
  for (let i = 0; i + frameSize < channelData.length; i += hopSize) {
    const slice = channelData.subarray(i, i + frameSize)
    let freq = detector(slice) || 0
    
    // 🎯 확장된 유효 주파수 범위 (아동~성인 전 음역 커버)
    // C2(65Hz) ~ B5(988Hz) 범위로 확장
    if (freq < 65 || freq > 1000) freq = 0
    
    // 🎯 신호 강도(RMS) 기반 신뢰도 계산
    let rms = 0
    for (let j = 0; j < slice.length; j++) {
      rms += slice[j] * slice[j]
    }
    rms = Math.sqrt(rms / slice.length)
    const conf = Math.min(1.0, rms * 10) // 0~1 범위로 정규화
    
    // 신뢰도가 너무 낮으면 무성음으로 처리
    if (conf < 0.1) freq = 0
    
    times.push(i / sampleRate)
    f0.push(freq)
    confidence.push(conf)
    
    // Yield to browser every chunkSize frames
    if (times.length % chunkSize === 0) {
      await new Promise(resolve => setTimeout(resolve, 0))
    }
  }
  // 🎯 RMS 배열 추가 (음절 경계 감지용)
  const rmsArray = confidence.map(c => c / 10) // 원래 RMS 값 복원
  
  // 🎵 Onset Detection: 에너지 + F0 변화 기반 음절 경계 감지 (개선 버전)
  const onsets = detectOnsets(rmsArray, times, f0)
  
  return { sampleRate, frameSize, hopSize, times, f0, confidence, rms: rmsArray, onsets }
}

// 🎵 Onset Detection: 에너지 + F0 변화 기반 음절/음표 경계 감지 (개선 버전)
// 발음이 바뀌는 부분을 정확히 감지하기 위해 RMS와 F0를 모두 사용
function detectOnsets(rms, times, f0) {
  const onsets = []
  const minGap = 0.08 // 최소 onset 간격 (0.08초)
  
  // 방법 1: RMS 기반 onset detection (에너지 변화)
  const rmsOnsets = []
  const delta = []
  for (let i = 1; i < rms.length; i++) {
    delta.push(rms[i] - rms[i - 1])
  }
  
  const rmsThreshold = 0.003 // RMS 변화 임계값
  
  for (let i = 2; i < delta.length - 2; i++) {
    // 급격한 증가 감지
    if (delta[i] > rmsThreshold && delta[i] > delta[i - 1] && delta[i] > delta[i + 1]) {
      const t = times[i]
      if (rmsOnsets.length === 0 || t - rmsOnsets[rmsOnsets.length - 1] > minGap) {
        rmsOnsets.push(t)
      }
    }
  }
  
  // 방법 2: F0 기반 onset detection (음정 변화 = 발음 변화)
  // 발음이 바뀌면 음정도 바뀌므로, F0 변화를 감지하면 발음 변화를 감지할 수 있음
  const f0Onsets = []
  for (let i = 1; i < f0.length; i++) {
    const prevF0 = f0[i - 1]
    const currF0 = f0[i]
    
    // 유효한 F0 값이 있고, 음정이 크게 바뀌는 지점 감지
    if (prevF0 > 0 && currF0 > 0) {
      const prevMidi = 69 + 12 * Math.log2(prevF0 / 440)
      const currMidi = 69 + 12 * Math.log2(currF0 / 440)
      const midiDiff = Math.abs(currMidi - prevMidi)
      
      // 반음(0.8 semitone) 이상 변화하면 발음이 바뀐 것으로 간주
      if (midiDiff >= 0.8) {
        const t = times[i]
        if (f0Onsets.length === 0 || t - f0Onsets[f0Onsets.length - 1] > minGap) {
          f0Onsets.push(t)
        }
      }
    } else if (prevF0 <= 0 && currF0 > 0) {
      // 무성음에서 유성음으로 전환 (새 음절 시작)
      const t = times[i]
      if (f0Onsets.length === 0 || t - f0Onsets[f0Onsets.length - 1] > minGap) {
        f0Onsets.push(t)
      }
    }
  }
  
  // 방법 3: RMS와 F0 onset 병합 (더 정확한 감지)
  const allOnsets = [...rmsOnsets, ...f0Onsets].sort((a, b) => a - b)
  
  // 중복 제거 및 정리
  for (const t of allOnsets) {
    if (onsets.length === 0 || t - onsets[onsets.length - 1] > minGap) {
      onsets.push(t)
    }
  }
  
  console.log(`[Onset Detection] RMS: ${rmsOnsets.length}개, F0: ${f0Onsets.length}개, 병합: ${onsets.length}개`)
  console.log(`[Onset Detection] onsets:`, onsets.slice(0, 15).map(t => t.toFixed(2)))
  return onsets
}

