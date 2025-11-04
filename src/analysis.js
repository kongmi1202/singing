// Utilities
function freqToMidi(freq) {
  if (!freq || freq <= 0) return null
  return 69 + 12 * Math.log2(freq / 440)
}

export async function analyzeAgainstReference(reference, pitchTrack) {
  const { tempoBpm } = reference
  const secondsPerBeat = 60 / tempoBpm
  const userMidiSeries = pitchTrack.times.map((t, i) => ({
    beat: t / secondsPerBeat,
    midi: freqToMidi(pitchTrack.f0[i])
  }))

  // Build comparable sampled reference array keyed by beat
  const refByBeat = reference.samples
  // 그래프 범위는 기준 멜로디 길이에 맞춘다 (필요시 약간 여유)
  const maxBeat = reference.totalBeats + reference.beatStep

  // Create arrays for plotting aligned on beatStep
  const beatStep = reference.beatStep
  const beats = []
  const refMidi = []
  const userMidi = []
  const incorrectMask = []

  const pitchToleranceSemis = 0.5 // within ±50 cents OK
  for (let b = 0; b <= maxBeat; b += beatStep) {
    beats.push(b)
    const refPoint = refByBeat.find(p => Math.abs(p.beat - b) < beatStep / 2)
    const rMidi = refPoint ? refPoint.midi : null
    refMidi.push(rMidi)
    // find nearest user sample by time/beat
    const hopSeconds = pitchTrack.hopSize / pitchTrack.sampleRate
    const idx = Math.round((b * secondsPerBeat) / hopSeconds)
    let uMidi = (idx >= 0 && idx < pitchTrack.f0.length) ? freqToMidi(pitchTrack.f0[idx]) : null
    // 무성/실패 프레임은 null 처리
    if (!isFinite(uMidi) || uMidi <= 0) uMidi = null
    userMidi.push(uMidi)
    const wrong = (rMidi != null && uMidi != null) ? Math.abs(uMidi - rMidi) > pitchToleranceSemis : false
    incorrectMask.push(wrong)
  }

  // 1) 이동평균/중앙값 스무딩으로 급격한 튐 보정
  function median(arr, i, w){
    const half = Math.floor(w/2)
    const vals = []
    for(let k=-half;k<=half;k++){
      const v = arr[i+k]
      if (v!=null) vals.push(v)
    }
    if (!vals.length) return arr[i]
    vals.sort((a,b)=>a-b)
    return vals[Math.floor(vals.length/2)]
  }
  for(let i=0;i<userMidi.length;i++){
    if (userMidi[i]==null) continue
    userMidi[i] = median(userMidi, i, 9) // 윈도 더 확대 (7→9, 더 부드럽게)
    // Yield every 100 samples to keep UI responsive
    if (i % 100 === 0) await new Promise(r => setTimeout(r, 0))
  }

  // 2) 옥타브 보정: 기준과 12semitone 배수 차이는 가장 가까운 옥타브로 이동
  for(let i=0;i<userMidi.length;i++){
    if (userMidi[i]==null || refMidi[i]==null) continue
    const u = userMidi[i]
    const r = refMidi[i]
    let best = u
    let bestDiff = Math.abs(u - r)
    for (let k=-2;k<=2;k++){
      const cand = u + 12*k
      const d = Math.abs(cand - r)
      if (d < bestDiff){ bestDiff = d; best = cand }
    }
    userMidi[i] = best
  }

  // 3) 범위 클램프 (C2~F5) 및 급격한 단발성 스파이크 제거 (임계값 완화)
  for(let i=0;i<userMidi.length;i++){
    if (userMidi[i]==null) continue
    userMidi[i] = Math.max(36, Math.min(77, userMidi[i]))
    const prev = userMidi[i-1]
    const next = userMidi[i+1]
    if (prev!=null && next!=null){
      if (Math.abs(userMidi[i]-prev)>8 && Math.abs(userMidi[i]-next)>8){ // 6→8 완화
        userMidi[i] = null
      }
    }
  }

  // 4) 기준 유도 클램프 제거 (사람 목소리는 자연스러운 편차 허용)
  // 이전: ±5반음 클램프 → 제거

  // 5) 지수 스무딩(EMA)로 잔떨림 완화 (알파값 더 낮춰서 매우 부드럽게)
  const alpha = 0.2 // 0.3→0.2: 이전 값을 80% 반영, 새 값 20%만 반영
  for (let i=1;i<userMidi.length;i++){
    if (userMidi[i]==null || userMidi[i-1]==null) continue
    userMidi[i] = alpha*userMidi[i] + (1-alpha)*userMidi[i-1]
  }

  // 보정 후 오차 마스크 재계산
  for (let i=0;i<incorrectMask.length;i++){
    const r = refMidi[i]
    const u = userMidi[i]
    incorrectMask[i] = (r!=null && u!=null) ? Math.abs(u - r) > pitchToleranceSemis : false
  }

  // Compute simple scores
  const comparable = refMidi.map((r, i) => ({ r, u: userMidi[i] })).filter(x => x.r != null && x.u != null)
  const correctCount = comparable.filter(x => Math.abs(x.u - x.r) <= pitchToleranceSemis).length
  const pitchScore = comparable.length ? Math.round(100 * correctCount / comparable.length) : 0

  // Rhythm: compare note start beats vs energy changes (simple proxy from pitch availability)
  const refOnsets = reference.notes.map(n => n.startBeat)
  const userOnsets = detectUserOnsets(userMidiSeries)
  const rhythmScore = computeRhythmScore(refOnsets, userOnsets)

  const totalScore = Math.round((pitchScore * 0.6) + (rhythmScore * 0.4))
  const verdict = totalScore >= 90 ? '참 잘했어요' : totalScore >= 75 ? '좋아요' : totalScore >= 60 ? '괜찮아요' : '더 연습해요'

  return { beats, refMidi, userMidi, incorrectMask, pitchScore, rhythmScore, totalScore, verdict }
}

// Build bar data and per-note deviations for piano-roll-like visualization
export function buildNoteComparisons(reference, pitchTrack) {
  const secondsPerBeat = 60 / reference.tempoBpm
  const hopSeconds = pitchTrack.hopSize / pitchTrack.sampleRate
  
  // Auto-align: detect first voiced frame
  let firstVoicedSec = 0
  for (let i=0;i<pitchTrack.f0.length;i++){
    if (pitchTrack.f0[i] > 60){
      firstVoicedSec = pitchTrack.times[i]
      break
    }
  }
  const firstRefBeat = reference.notes[0]?.startBeat || 0
  const offsetBeats = firstVoicedSec / secondsPerBeat - firstRefBeat
  
  // Store offset for playback
  const result = { barsRef: [], barsUser: [], issues: [], offsetBeats }
  
  // helper to sample user midi at beat (now with alignment offset)
  function sampleUserAtBeat(b){
    const adjustedB = b + offsetBeats
    const idx = Math.round((adjustedB * secondsPerBeat) / hopSeconds)
    if (idx < 0 || idx >= pitchTrack.f0.length) return null
    const f = pitchTrack.f0[idx]
    if (!f || f <= 0) return null
    return 69 + 12 * Math.log2(f / 440)
  }

  // 교육적 허용 범위: ±50 Cent (반음의 절반), ±100ms (약 0.2박@120BPM)
  const tolCents = 50 // ±50 Cent: 사람 귀로 구분 어려운 수준
  const tolPitch = tolCents / 100 // 0.5 semitones
  const tolMs = 100 // ±100ms
  const tolBeats = (tolMs / 1000) * (reference.tempoBpm / 60) // ~0.2 beats @ 120BPM

  for (const n of reference.notes) {
    const start = n.startBeat
    const end = n.startBeat + n.durationBeats
    result.barsRef.push({ x0: start, x1: end, midi: n.midi })

    // Estimate user's pitch during this note: median of samples in window
    const samples = []
    const step = 0.05
    for (let b=start; b<end; b+=step){
      const u = sampleUserAtBeat(b)
      if (u!=null) samples.push(u)
    }
    let uMidi = null
    if (samples.length) {
      samples.sort((a,b)=>a-b)
      uMidi = samples[Math.floor(samples.length/2)]
    }
    // Estimate timing: first/last beat where voiced near the window
    let uStart = null, uEnd = null
    for (let b=start-0.5; b<end+0.5; b+=step){
      const u = sampleUserAtBeat(b)
      if (u!=null){ uStart = b; break; }
    }
    for (let b=end+0.5; b>start-0.5; b-=step){
      const u = sampleUserAtBeat(b)
      if (u!=null){ uEnd = b; break; }
    }
    // Fallbacks
    if (uStart==null) uStart = start
    if (uEnd==null) uEnd = end
    result.barsUser.push({ x0: uStart, x1: uEnd, midi: uMidi })

    const pitchDiff = (uMidi==null) ? null : (uMidi - n.midi)
    const startDiff = uStart - start
    const endDiff = uEnd - end
    const isIssue = (pitchDiff!=null && Math.abs(pitchDiff) > tolPitch) || Math.abs(startDiff) > tolBeats || Math.abs(endDiff) > tolBeats
    if (isIssue){
      result.issues.push({ beat: start, midi: n.midi, pitchDiff, startDiff, endDiff })
    }
  }

  return result
}

function detectUserOnsets(series) {
  const threshold = 0.8
  const win = 4
  const onsets = []
  for (let i = 1; i < series.length; i++) {
    const prev = series[i - 1].midi
    const cur = series[i].midi
    if (prev == null && cur != null) onsets.push(series[i].beat)
    else if (prev != null && cur != null && Math.abs(cur - prev) > 1.5) onsets.push(series[i].beat)
  }
  // Deduplicate close onsets within 0.2 beat
  const dedup = []
  for (const b of onsets) {
    if (!dedup.length || Math.abs(b - dedup[dedup.length - 1]) > 0.2) dedup.push(b)
  }
  return dedup
}

function computeRhythmScore(refOnsets, userOnsets) {
  if (!refOnsets.length || !userOnsets.length) return 0
  const tol = 0.25 // quarter-beat tolerance
  let matched = 0
  const used = new Set()
  for (const r of refOnsets) {
    let bestIdx = -1
    let bestDiff = Infinity
    for (let i = 0; i < userOnsets.length; i++) {
      if (used.has(i)) continue
      const d = Math.abs(userOnsets[i] - r)
      if (d < bestDiff) { bestDiff = d; bestIdx = i }
    }
    if (bestIdx >= 0 && bestDiff <= tol) { matched++; used.add(bestIdx) }
  }
  return Math.round(100 * matched / refOnsets.length)
}


