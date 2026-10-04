const NATURAL_STEPS = {C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11};

// Keep the signed offset: Cb is below C, and B# belongs to the next octave.
export function tonicSemitoneOffset(tonic) {
  const match = /^([A-Ga-g])([#b]?)$/.exec(String(tonic ?? ''));
  if (!match) return null;
  const accidental = match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0;
  return NATURAL_STEPS[match[1].toUpperCase()] + accidental;
}
