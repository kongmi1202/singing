# 🎯 X표시 로직 최종 개선 - 교육적 유연성 극대화

## 📋 개요
빨간색 X표시가 **'반드시 고쳐야 할 심각한 음정 오류'에만** 나타나도록 로직을 근본적으로 개선했습니다.  
리듬 오류는 완전히 제거하고, 음고 오류 판단 기준을 명확히 했습니다.

---

## 🛑 근본 원인 분석

### 문제 1: 음고 측정 방식의 오류
**기존 문제**:
- 음표 전체를 평가할 때 순간적인 F₀ 변동도 오류로 간주
- 중앙값을 계산했지만, X표시 판단에 제대로 반영되지 않음

**해결**:
- 음표의 **중앙 60% 구간**에서 추출한 **F₀ 중앙값**이 ±75 Cent 범위를 벗어났을 때만 X표시

### 문제 2: 리듬 판단의 과도한 엄격성
**기존 문제**:
- 사람은 기계처럼 정확한 박자를 맞추기 어려움
- 150ms 이상의 자연스러운 타이밍 변화도 오류로 표시

**해결**:
- 리듬 오류로 인한 X표시 **완전 제거**
- 리듬 정보는 참고용으로만 저장

---

## 🎯 최종 X표시 기준

### ✅ X표시가 나타나는 경우 (음고 오류만)

```
조건: 중앙 60% 구간의 F₀ 중앙값이 MIDI 음가 대비 ±75 Cent 초과
```

**예시**:
- MIDI 정답: C4 (261.63 Hz)
- 허용 범위: C4 ± 75 Cent
- 학생 중앙값: C4 + 80 Cent → ❌ **X표시**
- 학생 중앙값: C4 + 70 Cent → ✅ **양호** (X표시 없음)

### ❌ X표시가 나타나지 않는 경우

1. **음고가 ±75 Cent 이내**: 자연스러운 비브라토, 떨림 허용
2. **리듬 오류**: 아무리 늦거나 빨라도 X표시 없음
3. **순간적 스파이크**: 중앙 60% 구간 외의 불안정성은 무시

---

## 🔧 구현 세부사항

### 1. 음고 중앙값 계산 (`src/analysis.js` 200-220번 줄)

```javascript
// 🎯 중앙 60% 구간만 사용
const margin = duration * 0.2  // 시작/끝 각 20% 제거
const stableStart = start + margin
const stableEnd = end - margin

// 안정 구간의 샘플 수집
const samples = []
for (let b=stableStart; b<stableEnd; b+=step){
  const u = sampleUserAtBeat(b)
  if (u!=null) samples.push(u)
}

// 🧠 중앙값(Median) 계산
let uMidi = null
if (samples.length) {
  samples.sort((a,b)=>a-b)
  uMidi = samples[Math.floor(samples.length / 2)]
}
```

**효과**:
- 어택/릴리즈 구간 제외
- 순간적 스파이크 무시
- 학생의 진정한 의도 파악

---

### 2. X표시 판단 로직 (`src/analysis.js` 240-247번 줄)

```javascript
const pitchDiff = (uMidi==null) ? null : (uMidi - n.midi)
const startDiff = uStart - start
const endDiff = uEnd - end

// 🎯 X표시 기준 최종 강화: 음고 오류만 표시, 리듬 오류는 완전 제거
const isPitchError = (pitchDiff != null && Math.abs(pitchDiff) > tolPitch)  // tolPitch = 0.75

if (isPitchError) {
  // ⏱️ 리듬 정보는 저장하되, X표시 판단에는 사용하지 않음
  result.issues.push({ beat: start, midi: n.midi, pitchDiff, startDiff, endDiff })
}
```

**변경사항**:
- **Before**: `|| Math.abs(startDiff) > tolBeats || Math.abs(endDiff) > tolBeats`
- **After**: 리듬 조건 완전 제거

---

### 3. 시각화 개선 (`src/viz.js` 75-99번 줄)

```javascript
// 🎯 음고 오류만 X표시 (리듬 오류는 제외)
noteView.issues.forEach((iss, idx)=>{
  if (iss.beat>=windowStart && iss.beat<=windowStart+windowBeats){
    crosses.push({ x: iss.beat, y: iss.midi, meta: iss })
    crossIndexMap.push(idx)
    
    // 🎯 음고 오류 레이블 표시
    const parts = []
    if (iss.pitchDiff != null){
      const cents = Math.abs(iss.pitchDiff) * 100
      if (cents > 75) {
        parts.push(iss.pitchDiff > 0 ? `${cents.toFixed(0)}센트 높음` : `${cents.toFixed(0)}센트 낮음`)
      }
    }
    
    // 리듬 정보는 참고용으로만 표시
    const startMs = iss.startDiff != null ? Math.abs(iss.startDiff) * (60000 / tempo) : 0
    if (startMs > 150){
      parts.push(`(참고: ${iss.startDiff > 0 ? '늦게' : '빠르게'} 시작)`)
    }
    
    if (parts.length) errorLabels.push({ x: iss.beat, y: iss.midi + 0.8, text: parts.join(' ') })
  }
})
```

**변경사항**:
- 테스트 X 제거
- 음고 오류만 crosses 배열에 추가
- 리듬은 참고 정보로만 표시

---

### 4. 툴팁 개선 (`src/viz.js` 178-200번 줄)

```javascript
// 🎯 음고 평가 기준: ±75 Cent 이내면 양호, 초과하면 오류
const pitchDesc = cents > 75 ? `${Math.abs(cents).toFixed(0)}센트 높음 ⚠️` 
                : cents < -75 ? `${Math.abs(cents).toFixed(0)}센트 낮음 ⚠️` 
                : '음정 양호 ✓'
return `사용자: ${midiToNaturalName(Math.round(y0))} | ${pitchDesc}`
```

**변경사항**:
- ±75 Cent 기준 명확히 표시
- 리듬 정보 제거 (시각적 혼란 방지)
- 양호/오류 상태를 명확히 구분

---

## 📊 변경 전후 비교

### Before (v2.0)

| 조건 | X표시 | 문제점 |
|------|-------|--------|
| 음고 ±50 Cent 초과 | ✅ | 너무 엄격 |
| 리듬 ±100ms 초과 | ✅ | 자연스러운 표현도 오류 |
| 순간적 스파이크 | ✅ | 평균값 왜곡 |

**결과**: X표시가 과도하게 많음 → 학생 동기 저하

---

### After (v2.5 - 현재)

| 조건 | X표시 | 개선 사항 |
|------|-------|----------|
| 음고 중앙값 ±75 Cent 초과 | ✅ | 진정한 음정 오류만 감지 |
| 리듬 오류 | ❌ | **완전 제거** |
| 순간적 스파이크 | ❌ | 중앙값으로 무시 |
| 어택/릴리즈 불안정 | ❌ | 중앙 60%만 사용 |

**결과**: X표시가 **'심각한 음정 오류'에만** 나타남 → 교육적 효과 극대화

---

## 🎓 교육적 철학

### X표시의 의미
1. **음정이 틀렸음**: 반음의 3/4 이상 벗어남
2. **반드시 교정 필요**: 듣는 사람이 틀렸다고 느낄 수준
3. **집중 연습 대상**: 해당 구간을 중점적으로 연습

### 리듬 평가
- X표시로 표시하지 않음
- 점수 계산에는 반영 (rhythmScore)
- AI 코칭 텍스트로만 피드백
- **이유**: 감정 표현과 음악적 자유 허용

---

## 📈 기대 효과

### 1. 학생 동기 향상
- ✅ 과도한 X표시 제거
- ✅ 성취감 증대
- ✅ 학습 지속성 향상

### 2. 교육 효과 극대화
- ✅ 진짜 문제 구간에 집중
- ✅ 불필요한 좌절감 제거
- ✅ 음악적 표현력 존중

### 3. 기술적 정확성
- ✅ 중앙값 기반 견고한 통계
- ✅ 불안정 구간 자동 제거
- ✅ 의도 기반 평가

---

## 🧪 테스트 시나리오

### 시나리오 1: 자연스러운 비브라토
```
음표: C4 (260Hz)
학생: C4 ± 60 Cent 비브라토
결과: ✅ X표시 없음 (중앙값이 ±75 Cent 이내)
```

### 시나리오 2: 순간적 스파이크
```
음표: C4
학생: 대부분 C4, 한순간 D4로 튐
결과: ✅ X표시 없음 (중앙값은 C4 근처)
```

### 시나리오 3: 리듬 밀림
```
음표: 1박에 시작
학생: 1.2박에 시작 (200ms 늦음)
결과: ✅ X표시 없음 (리듬은 평가 대상 아님)
```

### 시나리오 4: 실제 음정 오류
```
음표: C4
학생: C#4 (100 Cent 높음)
결과: ❌ X표시 (±75 Cent 초과)
```

---

## 🔗 관련 로직

### 허용 범위 설정
```javascript
// src/analysis.js
const tolCents = 75        // ±75 Cent
const tolPitch = 0.75      // semitones
const tolMs = 150          // ±150ms (참고용, X표시에는 미사용)
```

### 중앙 구간 설정
```javascript
const margin = duration * 0.2  // 시작/끝 각 20% 제거 → 중앙 60%
```

---

## 📝 변경된 파일

1. ✅ `src/analysis.js` - X표시 판단 로직 (음고만)
2. ✅ `src/viz.js` - 시각화 및 툴팁 개선
3. ✅ `ERROR_DETECTION_LOGIC.md` - 이 문서

---

## 🎯 핵심 메시지

> **X표시 = 반드시 고쳐야 할 심각한 음정 오류**
> 
> 리듬, 비브라토, 자연스러운 표현은 모두 허용됩니다!

---

**버전**: v2.5  
**날짜**: 2024년  
**상태**: ✅ 적용 완료  
**목표**: 학생 동기 유지 (소프트웨어 우수성 10점)

