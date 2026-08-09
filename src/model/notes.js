/* Note-name and frequency helpers shared by the model, theory and UI layers. */

export const PC_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const PC_FLAT  = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

/** MIDI note number -> scientific pitch name, e.g. 50 -> "D3". */
export function noteName (midi, flat = true) {
  const t = flat ? PC_FLAT : PC_NAMES;
  return t[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
}

/** Pitch class 0-11 -> name without octave. */
export function pcName (pc, flat = true) {
  return (flat ? PC_FLAT : PC_NAMES)[((pc % 12) + 12) % 12];
}

/** Equal-tempered frequency for a MIDI note at a given concert pitch. */
export function midiToFreq (midi, a4 = 440) {
  return a4 * Math.pow(2, (midi - 69) / 12);
}

export const pc = (midi) => ((midi % 12) + 12) % 12;

/** Deterministic PRNG (mulberry32) so a given seed always builds the same instrument. */
export function rng (seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const dB = (d) => Math.pow(10, d / 20);
