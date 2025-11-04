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
  // Frame config (더 안정적이도록 큰 프레임/작은 홉)
  const frameSize = 4096
  const hopSize = 256
  const detector = Pitchfinder.YIN({ sampleRate, threshold: 0.1 })
  const times = []
  const f0 = []
  const totalFrames = Math.floor((channelData.length - frameSize) / hopSize)
  
  // Process in chunks to avoid blocking the UI
  const chunkSize = 50 // frames per yield
  for (let i = 0; i + frameSize < channelData.length; i += hopSize) {
    const slice = channelData.subarray(i, i + frameSize)
    let freq = detector(slice) || 0
    // Valid range for adult singing
    if (freq < 80 || freq > 1000) freq = 0
    times.push(i / sampleRate)
    f0.push(freq)
    
    // Yield to browser every chunkSize frames
    if (times.length % chunkSize === 0) {
      await new Promise(resolve => setTimeout(resolve, 0))
    }
  }
  return { sampleRate, frameSize, hopSize, times, f0 }
}


