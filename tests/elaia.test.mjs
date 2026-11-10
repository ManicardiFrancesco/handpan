import assert from 'node:assert/strict';
import { buildInstrument } from '../src/model/instrument.js';
import {
  PRESETS, MAX_FIELDS, MIDI_MIN, MIDI_MAX, createLayout, validateLayout,
  transposeLayout, fits, audioLayout, encodeLayout, decodeLayout, clone,
  automaticField, arrangementInfo, restoreCurrent,
} from '../Elaia-handpan-player/model.mjs';
import { fieldGeometry, shellGeometry } from '../Elaia-handpan-player/geometry.mjs';
import { HandpanSurface } from '../Elaia-handpan-player/surface.mjs';
import { sampleFor } from '../Elaia-handpan-player/sample-player.mjs';

let assertions = 0;
const check = (condition, message) => { assert.ok(condition, message); assertions++; };
check(PRESETS.length === 15 && PRESETS.every(p => p.family === 'Ayasa' && p.profile), 'Only the fifteen published Ayasa instruments are selectable');
check(PRESETS.filter(p => p.title === 'D Aegean 18').length === 1 && PRESETS[0].profile === 'd-aegean-18', 'D Aegean 18 is the unambiguous default');
for (const preset of PRESETS) {
  const layout = createLayout(preset);
  assert.deepEqual(validateLayout(layout), layout); assertions++;
  assert.deepEqual(decodeLayout(encodeLayout(layout)), layout); assertions++;
  check(layout.fields.every(f => fits(layout, f)), `${preset.name}: every field fits without overlap`);
  const surface = new HandpanSurface(layout);
  layout.fields.forEach(f => {
    const g = fieldGeometry(f.geometry), p = surface.sample(f.x, f.z, f.side);
    check(!!g && g.side === f.side && g.boundary.length >= 48 && g.inner.length >= 40, 'Every factory field retains the published contours and physical geometry');
    check(p.every(Number.isFinite) && Math.abs(Math.hypot(...p.slice(3)) - 1) < 1e-6, 'Every measured cap has a finite unit normal');
    const sample = sampleFor(layout, f);
    check(sample.midi === f.midi && sample.rate === 1 && sample.url.includes('.mp3'), 'Every factory field has the exact published preview sample mapping');
  });
  const { scale, fields } = audioLayout(layout);
  const instrument = buildInstrument(scale, { a4: 432, idealPartials: true });
  assert.deepEqual(instrument.notes.map(n => n.midi), fields.map(f => f.midi)); assertions++;
  check(instrument.notes.filter(n => n.bottom).length === layout.fields.filter(f => f.side === 'bottom').length, 'Audio preserves shell assignment');
  instrument.notes.forEach(note => {
    check(Math.abs(note.f0 - 432 * 2 ** ((note.midi - 69) / 12)) < 1e-8, '432 Hz concert pitch reaches every field');
    check(note.modes[2].f === note.f0 * 2 && note.modes[4].f === note.f0 * 3, 'Physical octave and twelfth stay tuned');
  });
}
const original = createLayout();
const aegean = createLayout(PRESETS.find(p => p.id === 'ayasa-d-aegean-18'));
check(aegean.fields.filter(f => f.side === 'top').length === 11 && aegean.fields.filter(f => f.side === 'bottom').length === 7, 'Published D Aegean 18 has eleven top and seven bottom fields');
const lowestRing = aegean.fields.find(f => f.midi === 54 && f.side === 'top');
check(Math.abs(lowestRing.x - 8.26 / 265) < 0.00001 && Math.abs(lowestRing.z - 191.7 / 265) < 0.00001, 'D Aegean F#3 preserves the published centre, not an equal-angle ring');
check(aegean.fields.find(f => f.midi === 47).side === 'bottom', 'D Aegean B2 belongs to the underside');
check(aegean.fields[0].z !== 0 && arrangementInfo(aegean).includes('Published'), 'Published offset ding and provenance survive the layout');
check(Math.abs(lowestRing.size * 530 - 147.4142) < 0.01, 'F#3 retains its full measured field width, without the old six percent shrink');
check(aegean.fields.filter(f => f.shape === 'dome' && f.side === 'top').map(f => f.midi).join(',') === '50,54', 'D3 and F#3 are both convex fields on the top shell');
check(aegean.fields.filter(f => f.shape === 'dome' && f.side === 'bottom').map(f => f.midi).join(',') === '47,52,56', 'B2, E3 and G#3 are convex fields on the bottom shell');
check(aegean.fields.find(f => f.midi === 78).shape === 'pure', 'The small F#5 field preserves its published pure type');
check(fieldGeometry(lowestRing.geometry).tier1.Ru === 38.75 && fieldGeometry(lowestRing.geometry).h1 === 6.25, 'Convex tier radii and heights come from the source');
check(Math.abs(shellGeometry('d-aegean-18').port - 70.5 / 265) < 1e-6, 'The gu opening uses its real source radius');
const sourceSurface = new HandpanSurface(aegean);
check(Math.abs(sourceSurface.base(0, 0, 'top')[0] - (278.467674457 - 137.63585) / 265) < 0.00001, 'Shell height uses the measured profile');
const convex = sourceSurface.fields.find(f => f.midi === 54 && f.side === 'top');
const convexPoint = sourceSurface.sample(convex.O[0], convex.O[2], 'top');
check(convexPoint[1] > convex.py && convexPoint[0] !== convex.O[0], 'A convex cap rises and moves along the tilted field normal');
const concave = sourceSurface.fields.find(f => f.midi === 57 && f.side === 'top');
check(sourceSurface.sample(concave.O[0], concave.O[2], 'top')[1] < concave.py, 'A concave cap depresses the plane');
const sourceRetuned = transposeLayout(aegean, 1); sourceRetuned.a4 = 432;
check(Math.abs(sampleFor(sourceRetuned, sourceRetuned.fields[0]).rate - 2 ** (1 / 12) * 432 / 440) < 1e-10, 'Recorded previews follow semitone transpose and concert pitch');
assert.deepEqual(restoreCurrent(aegean), aegean); assertions++;
const oldAegean = clone(aegean); oldAegean.title = 'D Aegean'; oldAegean.preset = 'd-aegean-18'; oldAegean.arrangement = 'alternating';
oldAegean.fields = [{ id: 'n0', midi: 50, side: 'top', x: 0, z: 0, size: 0.26, angle: 0, aspect: 0.82 }];
check(restoreCurrent(oldAegean).preset === aegean.preset && restoreCurrent(oldAegean).fields.length === 18, 'The obsolete unedited Aegean session migrates to Ayasa');
const oldCustom = clone(oldAegean); oldCustom.custom = true;
assert.deepEqual(restoreCurrent(oldCustom), oldCustom); assertions++;
const renamedFactory = clone(aegean); renamedFactory.title = 'My evening pan';
assert.deepEqual(restoreCurrent(renamedFactory), renamedFactory); assertions++;
const importedFactoryEdit = clone(aegean); importedFactoryEdit.fields[0].midi++;
assert.deepEqual(restoreCurrent(importedFactoryEdit), importedFactoryEdit); assertions++;
const oldPublished = clone(aegean); oldPublished.fields.forEach(f => { f.size *= 0.94; delete f.geometry; delete f.shape; });
assert.deepEqual(restoreCurrent(oldPublished), aegean); assertions++;
const pygmy = createLayout(PRESETS.find(p => p.id === 'fis-low-pygmy-21'));
check(pygmy.fields[0].midi === 54, 'Ayasa F# Low Pygmy 21 has an F#3 ding');
check(pygmy.fields.filter(f => f.side === 'bottom').map(f => f.midi).join(',') === '50,52,59,62,71,74,81,83,85', 'Pygmy underside matches the manufacturer pitch inventory');
const growing = clone(original);
for (const side of ['bottom', 'top']) {
  const added = automaticField(growing, { id: `auto-${side}`, midi: 63, side });
  check(!!added && fits(growing, added), `Automatic ${side} placement avoids existing fields, rim and sound port`);
  growing.fields.push(added);
}
assert.deepEqual(decodeLayout(encodeLayout(growing)), growing); assertions++;
const raised = transposeLayout(original, 1);
check(raised.fields.every((f, i) => f.midi === original.fields[i].midi + 1), 'Every note transposes together');
assert.deepEqual(transposeLayout(raised, -1), original); assertions++;
check(original.fields[0].midi === 50, 'Transpose does not mutate the original');
check(!fits(original, { id: 'new', side: 'top', size: 0.125 }, 0, 0), 'Cannot add a field over the ding');
check(!fits(original, { id: 'new', side: 'bottom', size: 0.125 }, 0, 0), 'Bottom sound port is protected');
const emptyBottom = clone(original); emptyBottom.fields = emptyBottom.fields.filter(f => f.side === 'top');
check(fits(emptyBottom, { id: 'new', side: 'bottom', size: 0.125 }, 0.5, 0), 'Same XY on another shell is allowed');
check(!fits(original, { id: 'new', side: 'bottom', size: 0.125 }, 0.95, 0), 'Cannot extend past the rim');
const enclosingPort = { id: 'port-cover', midi: 48, side: 'bottom', x: 0.2, z: 0, size: 0.4, aspect: 1, angle: 0 };
check(!fits(original, enclosingPort), 'A large field cannot enclose the sound port even when its perimeter misses the port');
assert.throws(() => validateLayout({ ...clone(original), fields: [enclosingPort] })); assertions++;
const legacy = clone(original); legacy.fields = [legacy.fields[0]]; delete legacy.arrangement; delete legacy.sound; legacy.fields.forEach(f => { delete f.aspect; delete f.geometry; delete f.shape; });
assert.deepEqual(decodeLayout(encodeLayout(legacy)), legacy); assertions++;

const changed = clone(original);
changed.title = 'Élaia 🌿 — “Night / <script>”';
changed.fields[0].midi = 63;
changed.fields.push({ id: 'custom-bottom', midi: 44, side: 'bottom', x: 0.52, z: -0.1, size: 0.125, angle: 1.2 });
changed.a4 = 432; changed.finish = 'rose'; changed.custom = true;
assert.deepEqual(decodeLayout(encodeLayout(changed)), changed); assertions++;
const ordered = audioLayout(changed);
check(ordered.fields.at(-1).id === 'custom-bottom', 'Custom positions and bottom identity survive audio sorting');
const reordered = clone(changed); reordered.fields.unshift(reordered.fields.pop());
check(audioLayout(reordered).fields.find(f => f.id === 'custom-bottom').side === 'bottom' && audioLayout(reordered).fields.findIndex(f => f.id === 'custom-bottom') >= audioLayout(reordered).scale.bottomFrom, 'Bottom fields are voiced correctly regardless of document order');

for (const mutate of [
  l => { l.version = 2; },
  l => { l.fields = []; },
  l => { l.fields = Array(MAX_FIELDS + 1).fill(l.fields[0]); },
  l => { l.fields[1].id = l.fields[0].id; },
  l => { l.fields[0].id = '<img src=x>'; },
  l => { l.fields[0].midi = MIDI_MAX + 1; },
  l => { l.fields[0].midi = MIDI_MIN - 1; },
  l => { l.fields[0].midi = 60.5; },
  l => { l.fields[0].size = -0.1; },
  l => { l.fields[0].x = NaN; },
  l => { l.fields[0].x = 1.5; },
  l => { l.fields[0].side = 'other'; },
  l => { l.fields[0].side = 'bottom'; },
  l => { l.a4 = 441; },
  l => { l.sound = 'unknown'; },
  l => { l.fields[0].geometry = 'unknown/0'; },
  l => { l.fields[0].shape = 'unknown'; },
]) {
  const invalid = clone(original); mutate(invalid);
  assert.throws(() => validateLayout(invalid)); assertions++;
}
assert.throws(() => transposeLayout(original, 100)); assertions++;
assert.throws(() => transposeLayout(original, 0.5)); assertions++;
assert.throws(() => decodeLayout('%%%')); assertions++;
assert.throws(() => decodeLayout('a'.repeat(24001))); assertions++;
console.log(`Elaia model: ${assertions} assertions passed across ${PRESETS.length} presets, custom layouts, concert pitch, transpose, sharing, placement, and malformed inputs.`);
