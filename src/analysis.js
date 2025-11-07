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

  const pitchToleranceSemis = 0.75 // within ±75 cents OK (교육적 허용 범위 확장)
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

  // 1) 🎯 음표별 안정 구간 기반 스무딩: 불안정한 어택/릴리즈 강력 제거
  // 각 음표의 중앙 60% 구간에서 중앙값을 추출하여 전체 음표에 적용
  for (const note of reference.notes) {
    const noteStartIdx = Math.round((note.startBeat * secondsPerBeat) / (pitchTrack.hopSize / pitchTrack.sampleRate))
    const noteEndIdx = Math.round(((note.startBeat + note.durationBeats) * secondsPerBeat) / (pitchTrack.hopSize / pitchTrack.sampleRate))
    
    if (noteStartIdx < 0 || noteEndIdx >= userMidi.length) continue
    
    // 🧠 중앙 60% 구간 계산 (시작/끝 각 20% 제거)
    const noteDuration = noteEndIdx - noteStartIdx
    const margin = Math.floor(noteDuration * 0.2)
    const stableStart = noteStartIdx + margin
    const stableEnd = noteEndIdx - margin
    
    if (stableStart >= stableEnd) continue
    
    // 안정 구간의 유효한 F0 값들만 수집
    const stableSamples = []
    for (let i = stableStart; i < stableEnd; i++) {
      if (userMidi[i] != null && isFinite(userMidi[i])) {
        stableSamples.push(userMidi[i])
      }
    }
    
    // 🧠 안정 구간의 중앙값(Median)으로 전체 음표 구간을 대표
    // 평균 대신 중앙값 사용으로 이상치(outlier) 영향 최소화
    if (stableSamples.length > 0) {
      stableSamples.sort((a, b) => a - b)
      const stableMedian = stableSamples[Math.floor(stableSamples.length / 2)]
      // 음표 전체 구간에 안정값 적용 (단, 원래 null이 아닌 위치만)
      for (let i = noteStartIdx; i < noteEndIdx; i++) {
        if (userMidi[i] != null) {
          userMidi[i] = stableMedian
        }
      }
    }
  }
  
  // 2) 추가 중앙값 필터로 남은 노이즈 제거
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
    userMidi[i] = median(userMidi, i, 5) // 윈도 축소 (9→5, 이미 안정화되어 있으므로)
    // Yield every 100 samples to keep UI responsive
    if (i % 100 === 0) await new Promise(r => setTimeout(r, 0))
  }

  // 3) 옥타브 보정: 기준과 12semitone 배수 차이는 가장 가까운 옥타브로 이동
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

  // 4) 범위 클램프 (C2~F5) 및 급격한 단발성 스파이크 제거 (임계값 완화)
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

  // 5) 기준 유도 클램프 제거 (사람 목소리는 자연스러운 편차 허용)
  // 이전: ±5반음 클램프 → 제거

  // 6) 지수 스무딩(EMA)로 잔떨림 완화 (안정화 후 가벼운 스무딩만)
  const alpha = 0.3 // 이미 안정화되어 있으므로 좀 더 높은 값 사용
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

  // 🎯 교육적 허용 범위 확장: 자연스러운 표현을 허용하면서 심각한 오류만 감지
  const tolCents = 75 // ±75 Cent: 반음(100 Cent)의 3/4, 비브라토 등 자연스러운 떨림 허용
  const tolPitch = tolCents / 100 // 0.75 semitones
  
  // 🎵 BPM 기반 동적 리듬 오차 계산: 16분음표 길이의 150% (R=1.5)
  const bpm = reference.tempoBpm || 120
  const sixteenthNoteDuration = 60000 / (bpm * 4) // 16분음표 길이 (ms)
  const tolMs = sixteenthNoteDuration * 1.5 // 동적 허용 범위 (R=1.5, 심각한 오류만 선별)
  const tolBeats = (tolMs / 1000) * (bpm / 60)

  for (const n of reference.notes) {
    const start = n.startBeat
    const end = n.startBeat + n.durationBeats
    result.barsRef.push({ x0: start, x1: end, midi: n.midi })

    // 🎯 중앙 60% 구간만 사용하여 불안정한 어택/릴리즈 구간 강력 제거
    const duration = end - start
    const margin = duration * 0.2 // 시작/끝 각 20% 제거 → 중앙 60%만 사용
    const stableStart = start + margin
    const stableEnd = end - margin

    // Estimate user's pitch during STABLE portion of note only
    const samples = []
    const step = 0.05
    for (let b=stableStart; b<stableEnd; b+=step){
      const u = sampleUserAtBeat(b)
      if (u!=null) samples.push(u)
    }
    let uMidi = null
    if (samples.length) {
      samples.sort((a,b)=>a-b)
      // 🧠 중앙값(Median) 사용: 순간적 스파이크나 노이즈의 영향 최소화
      uMidi = samples[Math.floor(samples.length / 2)]
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

    const pitchDiff = (uMidi==null) ? null : (uMidi - n.midi)
    const startDiff = uStart - start
    const endDiff = uEnd - end
    
    // 🎯 X표시 기준 최종 확정: 음고 오류 OR 리듬 오류 (음표 시작점만)
    // 음고: 중앙 60% 구간 F0 중앙값이 ±75 Cent 초과
    // 리듬: 음표 시작점 오차가 Δt (16분음표 길이, R=1.5) 초과
    //       ※ 종료 시점/길이 오차는 X표시 기준에서 제외 (교육적 동기 부여)
    const isPitchError = (pitchDiff != null && Math.abs(pitchDiff) > tolPitch)
    const isRhythmError = (Math.abs(startDiff) > tolBeats) // 시작점만 체크
    
    // ✅ 통합 정답 플래그: 음고와 리듬 모두 통과했을 때만 true
    const isCorrect = !isPitchError && !isRhythmError && uMidi != null
    
    if (isPitchError || isRhythmError) {
      result.issues.push({ beat: start, midi: n.midi, pitchDiff, startDiff, endDiff })
    }
    
    // 🎨 시각적 일치 보정: 정답이면 막대를 정답과 완벽히 일치시켜 저장
    if (isCorrect) {
      result.barsUser.push({ x0: start, x1: end, midi: n.midi, isCorrect: true })
    } else {
      result.barsUser.push({ x0: uStart, x1: uEnd, midi: uMidi, isCorrect: false })
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


