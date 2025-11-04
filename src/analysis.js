// Utilities
function freqToMidi(freq) {
  if (!freq || freq <= 0) return null
  return 69 + 12 * Math.log2(freq / 440)
}

export function analyzeAgainstReference(reference, pitchTrack) {
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
    userMidi[i] = median(userMidi, i, 5)
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

  // 3) 범위 클램프 (C2~F5) 및 급격한 단발성 스파이크 제거
  for(let i=0;i<userMidi.length;i++){
    if (userMidi[i]==null) continue
    userMidi[i] = Math.max(36, Math.min(77, userMidi[i]))
    const prev = userMidi[i-1]
    const next = userMidi[i+1]
    if (prev!=null && next!=null){
      if (Math.abs(userMidi[i]-prev)>6 && Math.abs(userMidi[i]-next)>6){
        userMidi[i] = null
      }
    }
  }

  // 4) 기준 유도 클램프: 기준과의 편차를 ±5반음으로 제한하여 과도한 이탈 방지
  for (let i=0;i<userMidi.length;i++){
    if (userMidi[i]==null || refMidi[i]==null) continue
    const r = refMidi[i]
    const u = userMidi[i]
    const dev = Math.max(-5, Math.min(5, u - r))
    userMidi[i] = r + dev
  }

  // 5) 지수 스무딩(EMA)로 잔떨림 완화
  const alpha = 0.45
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


