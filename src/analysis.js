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

  const pitchToleranceSemis = 1.0 // within ±100 cents OK (반음 경계선까지 허용)
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

  // Rhythm: compare note start beats vs energy changes (RMS + F0 기반 onset 사용)
  const refOnsets = reference.notes.map(n => n.startBeat)
  // 🎯 pitchTrack.onsets 사용: RMS(에너지) + F0 기반으로 계산된 정교한 onset
  // 이전 detectUserOnsets는 F0만 사용했지만, pitchTrack.onsets는 에너지 정보도 포함하여 더 정확함
  const userOnsets = pitchTrack.onsets && pitchTrack.onsets.length > 0
    ? pitchTrack.onsets.map(t => t / secondsPerBeat)  // 초 단위를 beat 단위로 변환
    : detectUserOnsets(userMidiSeries)  // 폴백: onsets가 없으면 기존 방식 사용
  const rhythmScore = computeRhythmScore(refOnsets, userOnsets)

  const totalScore = Math.round((pitchScore * 0.6) + (rhythmScore * 0.4))
  const verdict = totalScore >= 90 ? '참 잘했어요' : totalScore >= 75 ? '좋아요' : totalScore >= 60 ? '괜찮아요' : '더 연습해요'

  return { beats, refMidi, userMidi, incorrectMask, pitchScore, rhythmScore, totalScore, verdict }
}

// Build bar data and per-note deviations for piano-roll-like visualization
export function buildNoteComparisons(reference, pitchTrack) {
  const secondsPerBeat = 60 / reference.tempoBpm
  const hopSeconds = pitchTrack.hopSize / pitchTrack.sampleRate
  
  // 🎯 Auto-align: 첫 유성음 감지 (숨소리/노이즈 제외, 연속된 실제 노래 시작점 탐지)
  let firstVoicedSec = 0
  const minFreq = 100 // 100Hz 이상 (숨소리/노이즈 제외)
  const consecutiveFrames = 5 // 연속 5프레임 이상 유지되어야 실제 노래로 인정
  
  for (let i = 0; i < pitchTrack.f0.length - consecutiveFrames; i++) {
    // 연속된 프레임들이 모두 유효한 주파수인지 확인
    let allValid = true
    for (let j = 0; j < consecutiveFrames; j++) {
      if (pitchTrack.f0[i + j] <= minFreq) {
        allValid = false
        break
      }
    }
    
    if (allValid) {
      // 연속된 유성음의 시작점을 첫 노래 시작으로 간주
      firstVoicedSec = pitchTrack.times[i]
      break
    }
  }
  
  const firstRefBeat = reference.notes[0]?.startBeat || 0
  const offsetBeats = firstVoicedSec / secondsPerBeat - firstRefBeat
  
  console.log('[Auto-align] firstVoicedSec:', firstVoicedSec, 'offsetBeats:', offsetBeats)
  
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

  // 🎯 교육적 허용 범위 극대화: 반음 경계선까지 관대하게 허용
  const tolCents = 100 // ±100 Cent: 반음 경계선까지 허용, 반음을 완전히 틀렸을 때만 오류
  const tolPitch = tolCents / 100 // 1.0 semitones
  
  // 🎵 BPM 기반 동적 리듬 오차 계산: 16분음표 × 1.3배 (교육적 균형)
  const bpm = reference.tempoBpm || 120
  const sixteenthNoteDuration = 60000 / (bpm * 4) // 16분음표 길이 (ms)
  const tolMs = sixteenthNoteDuration * 1.3 // 16분음표 × 1.3 = 적절한 리듬 오류 감지
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
    // 🎯 리듬 판정: Onset Detection 기반 음절 경계 감지
    let uStart = start, uEnd = end
    
    // 🎵 시작점: MIDI 근처의 onset 또는 F0 시작점
    const startSearchStart = start - 0.4
    const startSearchEnd = start + 0.4
    
    // 1) 먼저 onset 찾기 (에너지 변화 급증 = 새 음절 시작)
    if (pitchTrack.onsets) {
      const onsetsInRange = pitchTrack.onsets.filter(t => {
        const b = (t - offsetBeats * secondsPerBeat) / secondsPerBeat
        return b >= startSearchStart && b <= startSearchEnd
      })
      if (onsetsInRange.length > 0) {
        const closestOnset = onsetsInRange.reduce((prev, curr) => {
          const prevDiff = Math.abs((prev - offsetBeats * secondsPerBeat) / secondsPerBeat - start)
          const currDiff = Math.abs((curr - offsetBeats * secondsPerBeat) / secondsPerBeat - start)
          return currDiff < prevDiff ? curr : prev
        })
        uStart = (closestOnset - offsetBeats * secondsPerBeat) / secondsPerBeat
        console.log(`  🎵 Onset 시작점: ${uStart.toFixed(2)}박`)
      }
    }
    
    // 2) onset 없으면 F0 기반 찾기
    if (uStart === start) {
      for (let b = startSearchStart; b <= startSearchEnd; b += step) {
        const u = sampleUserAtBeat(b)
        if (u != null && Math.abs(u - n.midi) <= 1.5) {
          uStart = b
          break
        }
      }
    }
    
    // 🎵 종료점: 다음 onset 직전 또는 실제 F0 끝 (같은 음정 연속 구간 고려)
    const nextNote = reference.notes[reference.notes.indexOf(n) + 1]
    const endSearchEnd = nextNote ? nextNote.startBeat + nextNote.durationBeats + 0.5 : end + 1.0
    
    // 같은 음정이 연속되는지 확인
    const isSamePitchAsNext = nextNote && Math.abs(nextNote.midi - n.midi) < 0.5
    
    // 1) 현재 감지된 시작점 이후 첫 번째 onset 찾기
    // 같은 음정이 연속될 때는 더 넓은 범위에서 검색
    const minGapAfterStart = isSamePitchAsNext ? 0.05 : 0.15 // 같은 음정이면 더 가까운 onset도 허용
    const searchStart = uStart + minGapAfterStart
    
    if (pitchTrack.onsets) {
      const nextOnsets = pitchTrack.onsets.filter(t => {
        const b = (t - offsetBeats * secondsPerBeat) / secondsPerBeat
        return b > searchStart && b <= endSearchEnd
      }).sort((a, b) => a - b)
      
      if (nextOnsets.length > 0) {
        // 같은 음정이 연속될 때는 예상 종료점에 가장 가까운 onset 선택
        let nextOnset
        if (isSamePitchAsNext) {
          // 예상 종료점에 가장 가까운 onset 찾기
          const expectedEnd = end
          nextOnset = nextOnsets.reduce((prev, curr) => {
            const prevBeat = (prev - offsetBeats * secondsPerBeat) / secondsPerBeat
            const currBeat = (curr - offsetBeats * secondsPerBeat) / secondsPerBeat
            const prevDiff = Math.abs(prevBeat - expectedEnd)
            const currDiff = Math.abs(currBeat - expectedEnd)
            return currDiff < prevDiff ? curr : prev
          })
        } else {
          // 다른 음정이면 첫 번째 onset 사용
          nextOnset = nextOnsets[0]
        }
        
        const nextOnsetBeat = (nextOnset - offsetBeats * secondsPerBeat) / secondsPerBeat
        uEnd = nextOnsetBeat - 0.05 // onset 직전까지
        console.log(`  🎵 다음 Onset ${nextOnsetBeat.toFixed(2)}박 → 종료: ${uEnd.toFixed(2)}박 (같은음정: ${isSamePitchAsNext})`)
      }
    }
    
    // 2) onset 없으면 F0 기반 찾기 (같은 음정일 때는 더 넓은 범위 검색)
    if (uEnd === end) {
      const searchRange = isSamePitchAsNext ? 0.5 : 0.3 // 같은 음정이면 더 넓게
      const endSearchStart = end - searchRange
      const maxEnd = nextNote ? Math.min(end + searchRange, nextNote.startBeat - 0.05) : end + searchRange
      
      // 예상 종료점 주변에서 F0가 유지되는 마지막 지점 찾기
      let lastValidBeat = null
      for (let b = maxEnd; b >= endSearchStart; b -= step) {
        const u = sampleUserAtBeat(b)
        if (u != null && Math.abs(u - n.midi) <= 1.5) {
          lastValidBeat = b
        } else if (lastValidBeat !== null) {
          // F0가 끊긴 지점 = 종료점
          uEnd = lastValidBeat
          break
        }
      }
      
      if (uEnd === end && lastValidBeat !== null) {
        uEnd = lastValidBeat
      }
    }

    const pitchDiff = (uMidi == null) ? null : (uMidi - n.midi)
    const startDiff = uStart - start
    const endDiff = uEnd - end
    const actualDuration = uEnd - uStart
    const expectedDuration = end - start
    const durationDiff = actualDuration - expectedDuration
    
    // 🔍 디버깅: 음표별 감지 결과 출력
    const noteName = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][Math.round(n.midi) % 12]
    const octave = Math.floor(Math.round(n.midi) / 12) - 1
    console.log(`[음표] ${noteName}${octave} (${start.toFixed(2)}~${end.toFixed(2)}박) → 감지: ${uStart.toFixed(2)}~${uEnd.toFixed(2)}박, 길이차: ${durationDiff.toFixed(2)}박`)
    
    // 🎯 X표시 기준 최종 확정: 음고 오류 OR 리듬 오류 (시작점 + 길이)
    // 음고: 중앙 60% 구간 F0 중앙값이 ±100 Cent 초과 (반음 경계선 초과)
    // 리듬: 
    //   - 시작점 오차가 16분음표 × 1.3배 초과 (시작이 너무 빠르거나 늦음)
    //   - 또는 길이 오차가 16분음표 × 1.3배 초과 (너무 길거나 짧게 부름)
    const isPitchError = (pitchDiff != null && Math.abs(pitchDiff) > tolPitch)
    const isRhythmStartError = Math.abs(startDiff) > tolBeats // 시작점 오차
    const isRhythmDurationError = Math.abs(durationDiff) > tolBeats // 길이 오차
    const isRhythmError = isRhythmStartError || isRhythmDurationError
    
    // ✅ 음고 정답 플래그 (리듬과 독립적): 음고만 맞았는지 판단 (Y축 시각화용)
    const isPitchCorrectOnly = !isPitchError && uMidi != null
    
    // ✅ 리듬 정답 플래그 (음고와 독립적): 리듬만 맞았는지 판단 (X축 시각화용)
    const isRhythmCorrectOnly = !isRhythmError && uMidi != null
    
    // ✅ 통합 정답 플래그: 음고와 리듬 모두 통과했을 때만 true (X표 기준)
    const isCorrect = !isPitchError && !isRhythmError && uMidi != null
    
    if (isPitchError || isRhythmError) {
      result.issues.push({ 
        beat: start, 
        midi: n.midi, 
        pitchDiff, 
        startDiff, 
        endDiff,
        durationDiff: durationDiff,
        expectedDuration: expectedDuration, // 정답 길이 (퍼센트 계산용)
        actualDuration: actualDuration, // 실제 길이 (퍼센트 계산용)
        isRhythmStartError,
        isRhythmDurationError
      })
    }
    
    // 🎨 시각화: 실제 분석값 표시 (오차를 명확히 시각화)
    // Y축(midi): 음고가 맞으면 정답 MIDI, 틀리면 실제 MIDI
    // X축(x0, x1): 실제 시작/종료 위치 (리듬 오차를 명확히 시각화)
    const displayMidi = isPitchCorrectOnly ? n.midi : uMidi
    const displayX0 = uStart  // 실제 시작 위치
    const displayX1 = uEnd    // 실제 종료 위치
    
    result.barsUser.push({ 
      x0: displayX0, 
      x1: displayX1, 
      midi: displayMidi, 
      isCorrect: isCorrect,
      isPitchCorrectOnly: isPitchCorrectOnly,
      isRhythmCorrectOnly: isRhythmCorrectOnly
    })
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


