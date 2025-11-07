import { Midi } from '@tonejs/midi'

const BUILT_IN = [
  {
    id: 'twinkle',
    title: '작은 별 (4/4, C 메이저, ♩=120)',
    tempoBpm: 120,
    timeSig: [4, 4],
    key: 'C',
    // beats-based notes: { startBeat, durationBeats, midi }
    // 10마디(40박) 간단 편곡 버전
    lyrics: [
      { beat: 0, text: '반' }, { beat: 1, text: '짝' }, { beat: 2, text: '반' }, { beat: 3, text: '짝' },
      { beat: 4, text: '작' }, { beat: 5, text: '은' }, { beat: 6, text: '별' },
      { beat: 8, text: '아' }, { beat: 9, text: '름' }, { beat: 10, text: '답' }, { beat: 11, text: '게' },
      { beat: 12, text: '비' }, { beat: 13, text: '치' }, { beat: 14, text: '네' },
      { beat: 16, text: '동' }, { beat: 17, text: '쪽' }, { beat: 18, text: '하' }, { beat: 19, text: '늘' },
      { beat: 20, text: '에' }, { beat: 21, text: '서' }, { beat: 22, text: '도' },
      { beat: 24, text: '서' }, { beat: 25, text: '쪽' }, { beat: 26, text: '하' }, { beat: 27, text: '늘' },
      { beat: 28, text: '에' }, { beat: 29, text: '서' }, { beat: 30, text: '도' },
      { beat: 32, text: '반' }, { beat: 33, text: '짝' }, { beat: 34, text: '반' }, { beat: 35, text: '짝' },
      { beat: 36, text: '작' }, { beat: 37, text: '은' }, { beat: 38, text: '별' }
    ],
    notes: [
      // 1마디: C C G G
      { startBeat: 0, durationBeats: 1, midi: 60 },
      { startBeat: 1, durationBeats: 1, midi: 60 },
      { startBeat: 2, durationBeats: 1, midi: 67 },
      { startBeat: 3, durationBeats: 1, midi: 67 },
      // 2마디: A A G(2)
      { startBeat: 4, durationBeats: 1, midi: 69 },
      { startBeat: 5, durationBeats: 1, midi: 69 },
      { startBeat: 6, durationBeats: 2, midi: 67 },

      // 3마디: F F E E
      { startBeat: 8, durationBeats: 1, midi: 65 },
      { startBeat: 9, durationBeats: 1, midi: 65 },
      { startBeat: 10, durationBeats: 1, midi: 64 },
      { startBeat: 11, durationBeats: 1, midi: 64 },
      // 4마디: D D C(2)
      { startBeat: 12, durationBeats: 1, midi: 62 },
      { startBeat: 13, durationBeats: 1, midi: 62 },
      { startBeat: 14, durationBeats: 2, midi: 60 },

      // 5마디: G G F F
      { startBeat: 16, durationBeats: 1, midi: 67 },
      { startBeat: 17, durationBeats: 1, midi: 67 },
      { startBeat: 18, durationBeats: 1, midi: 65 },
      { startBeat: 19, durationBeats: 1, midi: 65 },
      // 6마디: E E D(2)
      { startBeat: 20, durationBeats: 1, midi: 64 },
      { startBeat: 21, durationBeats: 1, midi: 64 },
      { startBeat: 22, durationBeats: 2, midi: 62 },

      // 7마디: G G F F
      { startBeat: 24, durationBeats: 1, midi: 67 },
      { startBeat: 25, durationBeats: 1, midi: 67 },
      { startBeat: 26, durationBeats: 1, midi: 65 },
      { startBeat: 27, durationBeats: 1, midi: 65 },
      // 8마디: E E D(2)
      { startBeat: 28, durationBeats: 1, midi: 64 },
      { startBeat: 29, durationBeats: 1, midi: 64 },
      { startBeat: 30, durationBeats: 2, midi: 62 },

      // 9마디: C C G G
      { startBeat: 32, durationBeats: 1, midi: 60 },
      { startBeat: 33, durationBeats: 1, midi: 60 },
      { startBeat: 34, durationBeats: 1, midi: 67 },
      { startBeat: 35, durationBeats: 1, midi: 67 },
      // 10마디: A A G(2)
      { startBeat: 36, durationBeats: 1, midi: 69 },
      { startBeat: 37, durationBeats: 1, midi: 69 },
      { startBeat: 38, durationBeats: 2, midi: 67 },
    ]
  }
]

export function getBuiltInSongs() {
  return BUILT_IN
}

export async function loadReference(songId) {
  const built = BUILT_IN.find(s => s.id === songId)
  if (built) return normalizeReference(built)
  // If later we support external MIDI files under public/midi/: fetch and parse
  throw new Error('Unknown song id')
}

export function normalizeReference(ref) {
  // Build an array sampled per 0.05 beat for drawing line
  const beatStep = 0.05
  const totalBeats = Math.max(...ref.notes.map(n => n.startBeat + n.durationBeats))
  const samples = []
  for (let b = 0; b <= totalBeats; b += beatStep) {
    const active = ref.notes.find(n => b >= n.startBeat && b < n.startBeat + n.durationBeats)
    samples.push({ beat: b, midi: active ? active.midi : null })
  }
  return { ...ref, totalBeats, beatStep, samples }
}

export function midiToNoteLabel(midi) {
  const names = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']
  const name = names[midi % 12]
  const octave = Math.floor(midi / 12) - 1
  return `${name}${octave}`
}

export function midiToNaturalName(midi) {
  // Map sharps/flats to nearest natural (no accidentals) for labeling grid only
  const naturals = ['C','D','E','F','G','A','B']
  const semitoneToNatural = {
    0: 'C', 1: 'C', 2: 'D', 3: 'D', 4: 'E', 5: 'F', 6: 'F', 7: 'G', 8: 'G', 9: 'A', 10: 'A', 11: 'B'
  }
  const octave = Math.floor(midi / 12) - 1
  const natural = semitoneToNatural[midi % 12]
  return `${natural}${octave}`
}

export function buildYAxisTicks() {
  // C2 (midi 36) to F5 (midi 77)
  const ticks = []
  for (let m = 36; m <= 77; m++) {
    const label = midiToNaturalName(m)
    if (/^[A-G][0-9]+$/.test(label)) ticks.push({ value: m, label })
  }
  // De-duplicate labels that appear across sharps mapped to same natural
  const seen = new Set()
  return ticks.filter(t => {
    const key = t.label
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// Build Y ticks only from reference notes
export function buildYAxisTicksFromReference(reference) {
  const mids = Array.from(new Set(reference.notes.map(n => n.midi))).sort((a,b)=>a-b)
  const ticks = mids.map(m => ({ value: m, label: midiToNaturalName(m) }))
  // Ensure labels are unique in string form
  const seen = new Set()
  return ticks.filter(t => {
    if (seen.has(t.label)) return false
    seen.add(t.label)
    return true
  })
}


