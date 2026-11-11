// Peak interpolation on the browser's Blackman-windowed FFT. Search each
// partial independently: a missing fundamental must not invent an octave.
export const RATIOS = [1, 2, 3];
export const DEFAULT_TOP = ['D3', 'F#3', 'A3', 'C#4', 'D4', 'F#4', 'G#4', 'A4', 'C#5', 'D5', 'F#5'];
// Owner-confirmed Lombardo D Aegean 18, in their physical field order.
export const DEFAULT_BOTTOM = ['E3', 'G#3', 'B3', 'E4', 'E5', 'B4', 'B2'];
const PCS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
export function parseNote(name) {
  const m = /^([A-G])([#b]?)([1-6])$/.exec(name);
  if (!m) return null;
  const midi = (Number(m[3]) + 1) * 12 + PCS[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  return { name, midi };
}
export const frequency = (midi, a4 = 440) => a4 * 2 ** ((midi - 69) / 12);
export const cents = (measured, target) => 1200 * Math.log2(measured / target);
// Require three coherent observations, without averaging the measured pitch.
// This suppresses FFT startup transients and fleeting narrow noise peaks.
export function confirmPartials(readings, candidates) {
  return readings.map((reading, i) => {
    if (!reading) {
      candidates[i] = null;
      return null;
    }
    const previous = candidates[i];
    const count = previous && Math.abs(reading.cents - previous.cents) < 2 ? previous.count + 1 : 1;
    candidates[i] = { cents: reading.cents, count };
    return count >= 3 ? reading : null;
  });
}
export function detectPartials(spectrum, sampleRate, fftSize, target, rms) {
  if (rms < 0.00012) return RATIOS.map(() => null);
  const binHz = sampleRate / fftSize;
  return RATIOS.map((ratio) => {
    const ideal = target * ratio;
    const lo = Math.max(3, Math.ceil((ideal * 2 ** (-85 / 1200)) / binHz));
    const hi = Math.min(spectrum.length - 4, Math.floor((ideal * 2 ** (85 / 1200)) / binHz));
    let peak = -1,
      level = -Infinity;
    for (let i = lo; i <= hi; i++) {
      if (spectrum[i] > level && spectrum[i] > spectrum[i - 1] && spectrum[i] >= spectrum[i + 1]) {
        peak = i;
        level = spectrum[i];
      }
    }
    if (peak < 0 || level < -78) return null;
    // Reject broad background noise; a coherent partial has a narrow peak.
    const background = Math.max(spectrum[peak - 3], spectrum[peak + 3]);
    if (level - background < 9) return null;
    const a = spectrum[peak - 1],
      b = spectrum[peak],
      c = spectrum[peak + 1];
    const denominator = a - 2 * b + c;
    const offset =
      Number.isFinite(denominator) && denominator < -0.01
        ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / denominator))
        : 0;
    const hz = (peak + offset) * binHz;
    return { hz, cents: cents(hz, ideal), level };
  });
}
