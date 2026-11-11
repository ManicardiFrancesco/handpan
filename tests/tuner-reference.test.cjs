const assert = require('node:assert/strict');
const H = require('./dsp-harness.cjs');
const scale = H.SCALES.find((s) => s.id === 'd-aegean-18');
const expected = [
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
  'E3',
  'G#3',
  'B3',
  'E4',
  'E5',
  'B4',
  'B2',
];
const inst = H.build(scale, { idealPartials: true });
assert.deepEqual(
  Array.from(inst.notes, (n) => n.name),
  expected,
);
assert.equal(inst.notes.filter((n) => n.bottom).length, 7);
assert.equal(inst.notes[17].midi, 47);
for (const note of inst.notes) {
  [0, 2, 4].forEach((mode, i) => assert.equal(note.modes[mode].f, note.f0 * (i + 1)));
  assert.ok(note.modes[1].f !== note.f0, 'Split fundamental preserves physical beating');
}
const out = H.render(1, [{ t: 0, i: 0, v: 0.5, p: 0.15 }], { sustain: 1 });
assert.ok(
  out.some((x) => Math.abs(x) > 0.0001),
  'Real modal processor produces audible reference energy',
);
const original = H.build(scale);
assert.ok(
  original.notes.some((n) => n.modes[2].f !== n.f0 * 2),
  'Uncalibrated playground keeps its original mode variation',
);
const calibrated = H.build(scale, { idealPartials: true, a4: 432 });
assert.equal(calibrated.a4, 432);
assert.equal(calibrated.notes[7].f0, 432);
console.log(
  'Modal reference: owner layout, all 54 calibrated modes, physical split pairs, real DSP output and A4 calibration passed.',
);
