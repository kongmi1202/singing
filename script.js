// Minimal SPA state
const qs = (s) => document.querySelector(s);
const qsa = (s) => Array.from(document.querySelectorAll(s));

const pages = {
  start: qs('#page-start'),
  upload: qs('#page-upload'),
  results: qs('#page-results')
};

function showPage(key){
  Object.values(pages).forEach(p => p.classList.remove('active'));
  pages[key].classList.add('active');
}

// Local storage keys
const LS = {
  name: 'asc_name',
  id: 'asc_student_id',
  offset: 'asc_offset',
};

// UI refs
const inputName = qs('#input-name');
const inputId = qs('#input-student-id');
const btnStart = qs('#btn-start');
const btnBack1 = qs('#btn-back-1');
const btnBack2 = qs('#btn-back-2');
const btnDark1 = qs('#btn-darkmode');
const btnDark2 = qs('#btn-darkmode-2');
const selectMidi = qs('#select-midi');
const inputAudio = qs('#input-audio');
const audio1 = qs('#audio-player');
const audio2 = qs('#audio-player-2');
const btnAnalyze = qs('#btn-analyze');
const loading = qs('#loading');
const btnDemo = qs('#btn-demo');
const offsetDisplay = qs('#offset-display');
const offsetButtons = qsa('#page-upload [data-offset]');

// Results refs
const mAcc = qs('#m-acc');
const mRhythm = qs('#m-rhythm');
const mWrongs = qs('#m-wrongs');
const mOffset = qs('#m-offset');
const coachingList = qs('#coaching-list');
const chartCanvas = qs('#chart');
const lyricsDiv = qs('#lyrics');

// Global state
let audioBuffer = null;
let audioUrl = null;
let midiData = null; // normalized: { notes: [{midi, time, duration, beatStart, beatEnd, name}] , tempo, PPQ, lyrics: [...] }
let analysis = null; // computed analysis
let chart = null;
let detectedOffset = 0;

// Pitch categories for X axis (white keys from A2 to G5)
const WHITE_MIDI = (() => {
  const white = new Set([0,2,4,5,7,9,11]);
  const res = [];
  for (let n = 45; n <= 79; n++) { // A2(45) .. G5(79)
    if (white.has(n % 12)) res.push(n);
  }
  return res;
})();

const MIDI_TO_NAME = (n) => {
  const names = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  const name = names[n % 12];
  const octave = Math.floor(n / 12) - 1;
  return `${name}${octave}`;
};

const WHITE_NAMES = WHITE_MIDI.map(MIDI_TO_NAME);

// Simple utilities
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const clamp = (v,min,max)=>Math.max(min,Math.min(max,v));

// Dark mode toggle
function toggleDark(){
  document.documentElement.classList.toggle('light');
}
btnDark1.addEventListener('click', toggleDark);
btnDark2.addEventListener('click', toggleDark);

// Start page
inputName.value = localStorage.getItem(LS.name) || '';
inputId.value = localStorage.getItem(LS.id) || '';

btnStart.addEventListener('click', () => {
  const name = inputName.value.trim();
  const id = inputId.value.trim();
  if (!id) {
    alert('학번을 입력하세요.');
    return;
    }
  localStorage.setItem(LS.name, name);
  localStorage.setItem(LS.id, id);
  showPage('upload');
});

btnBack1.addEventListener('click', ()=> showPage('start'));
btnBack2.addEventListener('click', ()=> showPage('upload'));

// Offset controls
let manualOffset = parseFloat(localStorage.getItem(LS.offset) || '0') || 0;
function updateOffsetDisplay(){
  const t = (detectedOffset + manualOffset);
  mOffset.textContent = `${t>=0?'+':''}${t.toFixed(2)}s`;
  offsetDisplay.textContent = `Offset: ${t>=0?'+':''}${t.toFixed(2)}s`;
}
offsetButtons.forEach(b => b.addEventListener('click', () => {
  const delta = parseFloat(b.dataset.offset);
  manualOffset = clamp(manualOffset + delta, -2, 2);
  localStorage.setItem(LS.offset, String(manualOffset));
  updateOffsetDisplay();
}));

// Audio loading & playback
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

inputAudio.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  audioUrl = URL.createObjectURL(file);
  audio1.src = audioUrl;
  audio2.src = audioUrl;
  const arr = await file.arrayBuffer();
  audioBuffer = await audioCtx.decodeAudioData(arr);
});

btnDemo.addEventListener('click', async () => {
  // Built-in short beep-like sample generated via WebAudio if no file exists
  const duration = 3.0;
  const sr = audioCtx.sampleRate;
  const ab = audioCtx.createBuffer(1, Math.floor(sr*duration), sr);
  const ch = ab.getChannelData(0);
  // synth: three notes approximating twinkle (C C G)
  function writeTone(start, freq, len){
    for(let i=0;i<len;i++){
      const t = i/sr;
      const env = Math.min(1, (i)/(sr*0.02)) * Math.max(0, 1 - i/(len*1.05));
      ch[start+i] += Math.sin(2*Math.PI*freq*t)*0.2*env;
    }
  }
  writeTone(0, 261.63, Math.floor(0.6*sr)); // C4
  writeTone(Math.floor(0.7*sr), 261.63, Math.floor(0.6*sr));
  writeTone(Math.floor(1.4*sr), 392.00, Math.floor(0.8*sr)); // G4
  audioBuffer = ab;
  const wavUrl = bufferToWavUrl(ab);
  audioUrl = wavUrl;
  audio1.src = wavUrl;
  audio2.src = wavUrl;

  // Prefer built-in demo midi (fallback to select value)
  selectMidi.value = '/assets/midi/twinkle.mid';
});

// WAV export helper for demo audio
function bufferToWavUrl(buffer){
  const numOfChan = buffer.numberOfChannels;
  const length = buffer.length * numOfChan * 2 + 44;
  const bufferArray = new ArrayBuffer(length);
  const view = new DataView(bufferArray);
  // RIFF/WAVE header
  writeUTFBytes(view, 0, 'RIFF');
  view.setUint32(4, length - 8, true);
  writeUTFBytes(view, 8, 'WAVE');
  writeUTFBytes(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numOfChan, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * 2 * numOfChan, true);
  view.setUint16(32, numOfChan * 2, true);
  view.setUint16(34, 16, true);
  writeUTFBytes(view, 36, 'data');
  view.setUint32(40, length - 44, true);
  // PCM samples
  let offset = 44;
  for (let i = 0; i < buffer.length; i++){
    for (let ch = 0; ch < numOfChan; ch++){
      let sample = buffer.getChannelData(ch)[i];
      sample = Math.max(-1, Math.min(1, sample));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
      offset += 2;
    }
  }
  return URL.createObjectURL(new Blob([view], {type: 'audio/wav'}));
}
function writeUTFBytes(view, offset, str){
  for (let i = 0; i < str.length; i++) view.setUint8(offset+i, str.charCodeAt(i));
}

// MIDI loading
async function loadMidi(url){
  try{
    const { Midi } = await import('@tonejs/midi');
    const res = await fetch(url);
    if (!res.ok) throw new Error('MIDI 로드 실패');
    const arr = await res.arrayBuffer();
    const midi = new Midi(arr);
    const track = midi.tracks[0];
    const tempo = midi.header.tempos?.[0]?.bpm || 120;
    const PPQ = midi.header.ppq || 480;
    const notes = track.notes.map(n => ({
      midi: n.midi,
      time: n.time,
      duration: n.duration,
      beatStart: n.ticks / PPQ,
      beatEnd: (n.ticks + n.durationTicks) / PPQ,
      name: n.name
    }));
    const lyrics = track.lyrics?.map(l => ({ beat: (l.ticks||0)/PPQ, text: l.text })) || [];
    return { notes, tempo, PPQ, lyrics };
  } catch (e) {
    console.warn('MIDI 파싱 실패, 데모 멜로디 사용', e);
    // Fallback: simple demo melody (C C G) in beats
    const tempo = 120, PPQ = 480;
    const demo = [
      { midi: 60, beatStart: 0, beatEnd: 1, time: 0, duration: 0.5, name: 'C4' },
      { midi: 60, beatStart: 1, beatEnd: 2, time: 0.5, duration: 0.5, name: 'C4' },
      { midi: 67, beatStart: 2, beatEnd: 4, time: 1.0, duration: 1.0, name: 'G4' },
    ];
    const lyrics = [ { beat: 0, text: '반' }, { beat: 1, text: '짝' }, { beat: 2, text: '반짝' } ];
    return { notes: demo, tempo, PPQ, lyrics };
  }
}

// Simple pitch detection via autocorrelation
function estimatePitchTrack(buffer, hopMs=10, frameMs=30){
  const sr = buffer.sampleRate;
  const hop = Math.floor(sr * hopMs/1000);
  const size = Math.floor(sr * frameMs/1000);
  const channel = buffer.getChannelData(0);
  const total = Math.floor((channel.length - size) / hop);
  const f0 = new Float32Array(total);
  const t = new Float32Array(total);
  for (let i=0;i<total;i++){
    const s = i*hop;
    let bestLag=0, bestCorr=0;
    // search 80Hz..1000Hz
    const minLag = Math.floor(sr/1000);
    const maxLag = Math.floor(sr/80);
    for (let lag=minLag; lag<=maxLag; lag++){
      let sum=0;
      for (let j=0;j<size;j++) sum += channel[s+j]*channel[s+j-lag]||0;
      if (sum>bestCorr){bestCorr=sum; bestLag=lag;}
    }
    f0[i] = bestLag>0 ? sr/bestLag : 0;
    t[i] = s/sr;
  }
  return { f0, t };
}

function freqToMidi(freq){
  return 69 + 12*Math.log2(freq/440);
}

function snapToWhiteKey(midi){
  if (!isFinite(midi)) return null;
  let best=null, dist=1e9;
  for(const w of WHITE_MIDI){
    const d = Math.abs(w - midi);
    if (d < dist){dist=d; best=w;}
  }
  return best;
}

// Auto align: estimate start of singing via energy threshold
function detectOnset(buffer){
  const sr = buffer.sampleRate;
  const ch = buffer.getChannelData(0);
  const win = Math.floor(sr*0.02);
  const hop = Math.floor(sr*0.01);
  let rmsBase = 0;
  const N = Math.min(ch.length, sr*2);
  for (let i=0;i<N;i++) rmsBase += ch[i]*ch[i];
  rmsBase = Math.sqrt(rmsBase/N);
  const thr = Math.max(0.02, rmsBase*0.6);
  for (let i=0;i<ch.length-win;i+=hop){
    let sum=0;
    for(let j=0;j<win;j++) sum += ch[i+j]*ch[i+j];
    const rms = Math.sqrt(sum/win);
    if (rms > thr) return i/sr;
  }
  return 0;
}

// Cross-correlation between pitch sequences to fine-tune offset
function fineAlign(audioSeqTimes, audioSeqMidi, midiNoteTimes){
  if (audioSeqTimes.length===0 || midiNoteTimes.length===0) return 0;
  // convert to binary events per 10ms
  const step=0.01;
  const maxT = Math.max(audioSeqTimes[audioSeqTimes.length-1], midiNoteTimes[midiNoteTimes.length-1]) + 1;
  const L = Math.floor(maxT/step)+1;
  const a = new Uint8Array(L);
  const b = new Uint8Array(L);
  for (const tt of audioSeqTimes){ a[Math.floor(tt/step)] = 1; }
  for (const tt of midiNoteTimes){ b[Math.floor(tt/step)] = 1; }
  // try shifts in +- 500ms
  let bestShift = 0, bestScore = -1;
  const maxShift = 50; // 50*10ms = 0.5s
  for (let s=-maxShift; s<=maxShift; s++){
    let score=0;
    for (let i=0;i<L;i++){
      const j = i+s;
      if (j>=0 && j<L) score += a[i] & b[j];
    }
    if (score>bestScore){bestScore=score; bestShift=s;}
  }
  return bestShift*step;
}

// Compute metrics
function computeMetrics(midiNotes, audioFrames){
  const tolCents = 50; // ±50c
  const tolMs = 120; // ±120ms
  let correctPitch = 0, totalPitch = 0;
  let rhythmErrMs = 0, wrongs = 0;
  const issues = [];

  // Build sequences of snapped white keys from audio frames
  const audioEvents = [];
  for (let i=0;i<audioFrames.f0.length;i++){
    const f = audioFrames.f0[i];
    if (f<60) continue;
    const m = freqToMidi(f);
    const snapped = snapToWhiteKey(m);
    if (snapped!=null){
      audioEvents.push({ t: audioFrames.t[i]+detectedOffset+manualOffset, midi: snapped });
    }
  }

  // Compare each midi note against nearest audio event in time
  for(const n of midiNotes){
    const targetT = n.time + detectedOffset + manualOffset;
    const nearest = audioEvents.reduce((best, e) => {
      const d = Math.abs(e.t - targetT);
      if (!best || d < best.d) return { e, d };
      return best;
    }, null);
    if (!nearest){ wrongs++; issues.push({ type:'miss', note:n }); continue; }
    const cents = 100*(nearest.e.midi - n.midi);
    totalPitch++;
    if (Math.abs(cents) <= tolCents) correctPitch++; else { wrongs++; issues.push({ type:'pitch', cents, note:n }); }
    const ms = 1000*Math.abs(nearest.e.t - targetT);
    rhythmErrMs += ms;
    if (ms > tolMs) issues.push({ type:'rhythm', ms, note:n });
  }

  const pitchAcc = totalPitch>0 ? Math.round(100*correctPitch/totalPitch) : 0;
  const avgRhythmMs = Math.round(rhythmErrMs / Math.max(1,totalPitch));

  return { pitchAcc, avgRhythmMs, wrongs, issues, audioEvents };
}

// Chart rendering
function renderChart(midiNotes, audioEvents, issues){
  const ctx = chartCanvas.getContext('2d');
  if (chart) { chart.destroy(); }
  const dataBlue = midiNotes.map(n => ({ x: MIDI_TO_NAME(n.midi), y: n.beatStart }));
  const dataOrange = audioEvents.map(e => ({ x: MIDI_TO_NAME(e.midi), y: e.t * (midiData?.tempo||120)/60 }));
  const xs = WHITE_NAMES;
  chart = new Chart(ctx, {
    type: 'scatter',
    data: {
      datasets: [
        { label: '정답', data: dataBlue, pointBackgroundColor: '#3a86ff', borderColor: '#3a86ff', showLine: false },
        { label: '사용자', data: dataOrange, pointBackgroundColor: '#ffa500', borderColor: '#ffa500', showLine: false },
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      parsing: false,
      scales: {
        x: { type: 'category', labels: xs, title: { display: true, text: '음정 (흰 건반, A2~G5)' } },
        y: { type: 'linear', title: { display: true, text: '시간 (박)' }, grid: { color: c => (c.tick.value%4===0?'#3a3f5a':'#1e2638'), lineWidth: c => (c.tick.value%4===0?1.5:1) } }
      },
      plugins: {
        legend: { position: 'bottom' },
        tooltip: { callbacks: { label: (ctx) => `박: ${ctx.parsed.y.toFixed(2)} / 음정: ${ctx.parsed.x}` } }
      },
      onClick: (evt, elements) => {
        if (!audio2 || !elements?.length) return;
        const el = elements[0];
        const pt = chart.getDatasetMeta(el.datasetIndex).data[el.index].parsed;
        // Seek by beat → seconds
        const sec = pt.y * 60 / (midiData?.tempo||120) - (detectedOffset+manualOffset);
        audio2.currentTime = Math.max(0, sec);
        audio2.play();
      }
    }
  });

  // Red X marks for issues beyond tolerance: plot as annotation-like dataset
  const crosses = issues.filter(i => i.type==='pitch' || i.type==='rhythm').map(i => ({ x: MIDI_TO_NAME(i.note.midi), y: i.note.beatStart }));
  if (crosses.length){
    chart.data.datasets.push({ label:'오차', data: crosses, pointStyle: 'crossRot', pointRadius: 6, pointBackgroundColor: '#ff4d4f' });
    chart.update();
  }
}

function renderLyrics(lyrics){
  if (!lyrics || !lyrics.length){ lyricsDiv.textContent = ''; return; }
  const spans = lyrics.map(l => `<span style="margin-right:12px">${l.text}</span>`);
  lyricsDiv.innerHTML = spans.join('');
}

// Coaching tips
function generateCoachingTips(metrics, issues){
  const tips = [];
  if (metrics.pitchAcc < 80) tips.push('고음에서 음이 조금 흔들려요. 호흡을 길게 가져가 보세요.');
  if (metrics.avgRhythmMs > 100) tips.push('박자가 약간 빨라요. 메트로놈과 함께 연습해 보세요.');
  if (metrics.wrongs > 3) tips.push('어려운 구간은 느리게 반복해서 정확도를 높여보세요.');
  if (!tips.length) tips.push('전체적으로 안정적이에요. 현재 템포로 한 번 더 반복해 보세요.');
  return tips.slice(0,5);
}

// Analyze button
btnAnalyze.addEventListener('click', async () => {
  if (!audioBuffer){
    alert('오디오 파일을 업로드하세요.');
    return;
  }
  loading.classList.remove('hidden');
  await sleep(100);
  try{
    midiData = await loadMidi(selectMidi.value);
    // Onset and alignment
    const tSing = detectOnset(audioBuffer);
    const tMidi0 = (midiData.notes[0]?.time)||0;
    const dt0 = tSing - tMidi0;

    // Pitch track
    const frames = estimatePitchTrack(audioBuffer);
    // Times where valid pitches exist
    const frameTimes = [];
    const framePitches = [];
    for (let i=0;i<frames.f0.length;i++){
      if (frames.f0[i] > 60){ frameTimes.push(frames.t[i]); framePitches.push(frames.f0[i]); }
    }
    const midiOnsets = midiData.notes.map(n => n.time);
    const dtStar = fineAlign(frameTimes, framePitches, midiOnsets);
    detectedOffset = dt0 + dtStar;
    updateOffsetDisplay();

    // Metrics
    const metrics = computeMetrics(midiData.notes, frames);
    analysis = metrics;
    mAcc.textContent = metrics.pitchAcc + '%';
    mRhythm.textContent = metrics.avgRhythmMs + ' ms';
    mWrongs.textContent = String(metrics.wrongs);

    // Chart
    renderChart(midiData.notes, metrics.audioEvents, metrics.issues);
    renderLyrics(midiData.lyrics);

    // Coaching
    const tips = generateCoachingTips(metrics, metrics.issues);
    coachingList.innerHTML = tips.map(t => `<li>${t}</li>`).join('');

    // Move to results
    showPage('results');
  } catch (e){
    console.error(e);
    alert('분석 중 오류가 발생했습니다. 다른 파일로 시도해 주세요.');
  } finally {
    loading.classList.add('hidden');
  }
});

// Export buttons
qs('#btn-export-png').addEventListener('click', () => {
  if (!chart) return;
  const a = document.createElement('a');
  a.href = chart.toBase64Image('image/png', 1);
  a.download = 'analysis.png';
  a.click();
});

qs('#btn-export-json').addEventListener('click', () => {
  const data = {
    student: { name: localStorage.getItem(LS.name), id: localStorage.getItem(LS.id) },
    midi: midiData,
    metrics: analysis,
    offset: detectedOffset + manualOffset,
    generatedAt: new Date().toISOString()
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'analysis.json'; a.click();
  URL.revokeObjectURL(url);
});

qs('#btn-export-pdf').addEventListener('click', () => {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  doc.setFontSize(16);
  doc.text('AI 가창 분석 코치 - 요약 리포트', 40, 40);
  doc.setFontSize(12);
  doc.text(`학생: ${localStorage.getItem(LS.name)||''} (${localStorage.getItem(LS.id)||''})`, 40, 70);
  doc.text(`음고 정확도: ${mAcc.textContent}`, 40, 90);
  doc.text(`리듬 오차: ${mRhythm.textContent}`, 40, 110);
  doc.text(`틀린 음 개수: ${mWrongs.textContent}`, 40, 130);
  doc.text(`Detected Offset: ${mOffset.textContent}`, 40, 150);
  doc.text('코칭:', 40, 180);
  const tips = Array.from(coachingList.querySelectorAll('li')).map(li => `- ${li.textContent}`);
  let y = 200;
  tips.forEach(t => { doc.text(t, 60, y); y+=18; });
  // chart snapshot
  if (chart){
    const img = chart.toBase64Image('image/png', 1);
    doc.addImage(img, 'PNG', 40, y+10, 520, 300);
    y += 320;
  }
  doc.save('analysis.pdf');
});

// Init
updateOffsetDisplay();
showPage('start');


