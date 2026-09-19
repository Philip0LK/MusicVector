export const PIANO_DYNAMICS = Object.freeze({
  soft: Object.freeze({ velocity: 3, gain: 0.72 }),
  medium: Object.freeze({ velocity: 6, gain: 0.84 }),
  strong: Object.freeze({ velocity: 8, gain: 0.95 }),
});

const SAMPLE_MIDI_NOTES = Array.from({ length: 30 }, (_, index) => 21 + index * 3);
const NOTE_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
];

export function pianoSampleForMidi(midi, dynamic = "medium") {
  const numericMidi = Number(midi);
  if (!Number.isFinite(numericMidi)) {
    throw new TypeError("MIDI 音高必须是数字。");
  }

  const preset = PIANO_DYNAMICS[dynamic] || PIANO_DYNAMICS.medium;
  const sampleMidi = SAMPLE_MIDI_NOTES.reduce((nearest, candidate) =>
    Math.abs(candidate - numericMidi) < Math.abs(nearest - numericMidi)
      ? candidate
      : nearest,
  );
  const filename = `${midiToNoteName(sampleMidi)}v${preset.velocity}.ogg`;

  return {
    sampleMidi,
    velocity: preset.velocity,
    gain: preset.gain,
    url: `/assets/piano/${dynamic in PIANO_DYNAMICS ? dynamic : "medium"}/${encodeURIComponent(filename.replace('#', 's'))}`,
  };
}

export function retryableCachedLoad(cache, key, loader) {
  if (cache.has(key)) return cache.get(key);

  let pending;
  pending = Promise.resolve()
    .then(loader)
    .catch((error) => {
      if (cache.get(key) === pending) cache.delete(key);
      throw error;
    });
  cache.set(key, pending);
  return pending;
}

function midiToNoteName(midi) {
  const octave = Math.floor(midi / 12) - 1;
  return `${NOTE_NAMES[midi % 12]}${octave}`;
}
