import assert from 'node:assert/strict';
import {
  DEFAULT_TOP,
  DEFAULT_BOTTOM,
  parseNote,
  frequency,
  cents,
  detectPartials,
  confirmPartials,
} from '../src/tuner/detection.mjs';
assert.deepEqual(DEFAULT_TOP, [
  'D3',
  'F#3',
  'A3',
  'C#4',
  'D4',
  'F#4',
  'G#4',
  'A4',
  'C#5',
  'D5',
  'F#5',
]);
assert.deepEqual(DEFAULT_BOTTOM, ['E3', 'G#3', 'B3', 'E4', 'E5', 'B4', 'B2']);
assert.equal(frequency(parseNote('A4').midi), 440);
assert.equal(frequency(parseNote('A4').midi, 432), 432);
assert.equal(parseNote('Bb3').midi, 58);
assert.equal(parseNote('<script>'), null);
assert.equal(parseNote('D99'), null);
assert.ok(Math.abs(cents(440 * 2 ** (5 / 1200), 440) - 5) < 1e-9);
const silence = new Float32Array(16384).fill(-Infinity);
assert.deepEqual(detectPartials(silence, 48000, 32768, 146.832, 0), [null, null, null]);
assert.deepEqual(detectPartials(new Float32Array(16384).fill(-50), 48000, 32768, 146.832, 0.1), [
  null,
  null,
  null,
]);
const candidates = [null, null, null];
const coherent = [{ hz: 147, cents: 2.2, level: -20 }, null, null];
assert.equal(confirmPartials(coherent, candidates)[0], null);
assert.equal(confirmPartials(coherent, candidates)[0], null);
assert.equal(confirmPartials(coherent, candidates)[0], coherent[0]);
assert.equal(
  confirmPartials([{ hz: 149, cents: 25, level: -20 }, null, null], candidates)[0],
  null,
);
assert.deepEqual(confirmPartials([null, null, null], candidates), [null, null, null]);
assert.deepEqual(candidates, [null, null, null]);
console.log(
  'Tuner: preset, concert pitch, note validation, silence, broad noise and transient coherence passed.',
);
