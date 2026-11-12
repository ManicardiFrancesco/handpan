import assert from 'node:assert/strict';
import { buildInstrument } from '../src/model/instrument.js';
import {
  PRESETS, MAX_FIELDS, MIDI_MIN, MIDI_MAX, createLayout, validateLayout,
  transposeLayout, fits, audioLayout, encodeLayout, decodeLayout, clone,
  automaticField, arrangementInfo, restoreCurrent, titleFor, nextTranspose,
} from '../Elaia-handpan-player/model.mjs';
import { fieldGeometry, shellGeometry, portRadius, bodyDiameter } from '../Elaia-handpan-player/geometry.mjs';
import { HandpanSurface } from '../Elaia-handpan-player/surface.mjs';
import { sampleFor } from '../Elaia-handpan-player/sample-player.mjs';
import { findChords } from '../src/theory/chords.js';
import { chordArpeggio, demoFields } from '../Elaia-handpan-player/playback.mjs';
import { addToneField, removeToneField, nextNote, scalePitches, canAutoArrange, placementStatus, originalLayout, setPlayingPosition } from '../Elaia-handpan-player/arrangement.mjs';
import { allowedNote, noteDimensions, sizeForNote, rimAngle, dragAngle, stepNote } from '../Elaia-handpan-player/tonefields.mjs';

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
  for (const chord of findChords(layout.fields, { minNotes: 3, maxResults: 9 })) {
    const arpeggio = chordArpeggio(chord, layout.fields);
    assert.deepEqual(arpeggio.notes, layout.fields.filter(f => chord.pcs.includes(f.midi % 12)).sort((a, b) => a.midi - b.midi)); assertions++;
    check(arpeggio.notes.every(f => layout.fields.includes(f)), 'Chord arpeggios include every matching physical field across both shells');
    check(arpeggio.notes.every((f, i, fields) => !i || f.midi >= fields[i - 1].midi), 'Chord arpeggios ascend across all registers');
  }
  for (const side of ['top', 'bottom', 'all']) {
    const sequence = demoFields(layout, side);
    check(sequence.length === layout.fields.filter(f => side === 'all' || f.side === side).length, 'Demos include every field on the chosen shell');
    check(sequence.every((f, i) => layout.fields.includes(f) && (!i || f.midi >= sequence[i - 1].midi)), 'Demo sequences use real fields from low to high');
  }
}
const original = createLayout();
for (const preset of PRESETS) {
  const stock = createLayout(preset), inner = stock.fields.filter(f => f.side === 'top' && f.id !== 'n0' && Math.hypot(f.x, f.z) < 0.6);
  const outer = stock.fields.filter(f => f.side === 'top' && !inner.includes(f));
  let expanded = clone(stock), additions = 0;
  while (!placementStatus(expanded, 'top').full) {
    const midi = nextNote(expanded, 'top');
    if (midi === null) break;
    check(allowedNote(midi) && scalePitches(stock).includes(midi % 12), 'Rapid additions follow the selected instrument scale within the supported range');
    const next = addToneField(expanded, { id: `series-${additions}`, midi, side: 'top' });
    if (!next) break; // Real dimensions can exhaust physical space before five slots.
    additions++;
    check(!!next && next.fields.length === expanded.fields.length + 1, 'Each automatic addition adds exactly one field');
    expanded = validateLayout(next);
    check(expanded.fields.every(f => fits(expanded, f)) && canAutoArrange(expanded), 'Every automatic cluster fits and stays automatic');
    for (const field of outer) {
      assert.deepEqual(expanded.fields.find(f => f.id === field.id), field); assertions++;
    }
    const cluster = expanded.fields.filter(f => f.autoSlot === 'mutant');
    const centres = cluster.map(f => f.x).sort((a, b) => a - b);
    check(centres.every((x, i) => Math.abs(x + centres[centres.length - i - 1]) < 1e-8), 'Automatic inner clusters have symmetric centres');
  }
  check(additions <= 5 - inner.length && addToneField(expanded, { id: 'outside-range', midi: 90, side: 'top' }) === null, 'Automatic top layouts respect physical capacity, five slots, and E6');
  assert.deepEqual(originalLayout(expanded), stock); assertions++;
  assert.deepEqual(decodeLayout(encodeLayout(expanded)), expanded); assertions++;
  if (additions) {
    const reduced = removeToneField(expanded, `series-${additions - 1}`);
    check(reduced.fields.length === expanded.fields.length - 1 && reduced.fields.every(f => fits(reduced, f)), 'Removing a cluster note rearranges the remaining fields without overlap');
    const frozen = { ...expanded, manualPlacement: true };
    const manuallyAdded = addToneField(frozen, { id: 'manual-extra', midi: 88, side: 'top' });
    if (manuallyAdded) {
      for (const field of frozen.fields) {
        assert.deepEqual(manuallyAdded.fields.find(f => f.id === field.id), field); assertions++;
      }
      check(!canAutoArrange(manuallyAdded), 'Manual placement remains manual after adding and sharing');
      assert.deepEqual(decodeLayout(encodeLayout(manuallyAdded)), manuallyAdded); assertions++;
    }
  }
  const missingRing = clone(stock), slot = outer[1];
  missingRing.fields = missingRing.fields.filter(f => f.id !== slot.id);
  check(nextNote(missingRing, 'top') === slot.midi, 'A removed published outer note is suggested before higher extensions');
  const filled = addToneField(missingRing, { id: 'restored-slot', midi: slot.midi, side: 'top' });
  if (filled) {
    const restored = filled.fields.find(f => f.id === 'restored-slot');
    check(['x', 'z'].every(key => restored[key] === slot[key])
      && Math.abs(restored.size * bodyDiameter(stock) - noteDimensions(slot.midi).tonefield[1]) < 1e-8, 'A vacant default slot uses its published centre and the supplied note dimensions');
  } else check(!fits(missingRing, sizeForNote(missingRing, { ...slot, id: 'restored-slot' })), 'A full-size field is rejected when it cannot fit a vacant default position');
}
const blank = addToneField(original, { id: 'blank', midi: null, side: 'top' });
check(blank.fields.at(-1).midi === null && sampleFor(blank, blank.fields.at(-1)) === null, 'Unassigned fields have no placeholder note or recording');
check(audioLayout(blank).fields.length === original.fields.length && demoFields(blank, 'all').length === original.fields.length, 'Unassigned fields are excluded from audio and demo sequences');
assert.deepEqual(decodeLayout(encodeLayout(blank)), blank); assertions++;
check(transposeLayout(blank, 3).fields.at(-1).midi === null, 'Transposition leaves unassigned fields unassigned');
const allBlank = { ...clone(original), preset: '', arrangement: '', custom: true };
allBlank.fields.forEach(f => { f.midi = null; });
check(nextNote(allBlank, 'top') === null && !scalePitches(allBlank).length && audioLayout(allBlank).fields.length === 0, 'A layout without a known scale offers empty fields rather than inventing pitches');
const shiftedDefaults = transposeLayout(original, 3);
check(nextNote(shiftedDefaults, 'top') === nextNote(original, 'top') + 3, 'Scale-following additions transpose with the instrument');
const inferredManual = clone(original); inferredManual.fields[1].angle += 0.01;
check(!canAutoArrange(inferredManual), 'Older custom files with moved or rotated fields are recognized without requiring new metadata');
const manualFactory = { ...clone(original), manualPlacement: true };
assert.deepEqual(restoreCurrent(manualFactory), manualFactory); assertions++;
const minor = findChords(original.fields).find(c => c.plainSymbol === 'Bm');
assert.deepEqual(chordArpeggio(minor, original.fields).notes.map(f => f.midi), [
  47, 50, 54, 59, 62, 66, 71, 74, 78,
]); assertions++;
const repeatedPitch = { fields: [
  { id: 'high', midi: 74, side: 'top' }, { id: 'low', midi: 47, side: 'bottom' },
  { id: 'top-d', midi: 62, side: 'top' }, { id: 'bottom-d', midi: 62, side: 'bottom' },
] };
const repeatedBefore = clone(repeatedPitch);
assert.deepEqual(demoFields(repeatedPitch, 'all').map(f => f.id), ['low', 'top-d', 'bottom-d', 'high']); assertions++;
assert.deepEqual(repeatedPitch, repeatedBefore); assertions++;
check(demoFields({ fields: repeatedPitch.fields.filter(f => f.side === 'top') }, 'bottom').length === 0, 'An empty shell has no demo notes');
assert.throws(() => demoFields(original, 'both')); assertions++;
const retuned = transposeLayout({ ...original, a4: 432 }, -2);
const frequencies = demoFields(retuned, 'all').map(f => retuned.a4 * 2 ** ((f.midi - 69) / 12));
check(frequencies.every((f, i) => !i || f >= frequencies[i - 1]), 'Demo ordering remains ascending after transposition and concert-pitch changes');
for (const [profile, delta, expected] of [
  ['d-aegean-18', -2, 'C Aegean 18'],
  ['fis-kurd-22', 3, 'A Kurd 22'],
  ['b2-aavartan-17', 1, 'C3 Aavartan 17'],
  ['fis2-nordlys-16', 1, 'G2 Nordlys 16'],
]) {
  const source = createLayout(PRESETS.find(p => p.profile === profile));
  check(titleFor(transposeLayout(source, delta)) === expected, 'Transpose changes only the complete root-note token, preserving prefixes, octaves, model names, and counts');
  check(titleFor(transposeLayout(transposeLayout(source, delta), -delta)) === source.title, 'Transposing back restores the original title');
}
const named = transposeLayout({ ...original, title: 'Elements of my evening' }, 3);
check(titleFor(named) === named.title, 'Transpose preserves a renamed instrument title');
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
check(Math.abs(shellGeometry('d-aegean-18').port - 70.5 / 265) < 1e-6, 'The original underside profile retains its measured inner edge');
const sourceSurface = new HandpanSurface(aegean);
check(sourceSurface.port === 0.18 && portRadius(aegean) === sourceSurface.port, 'The compact gu mouth agrees with the editor collision boundary');
check(Number.isFinite(sourceSurface.base(sourceSurface.port, 0, 'bottom')[0])
  && sourceSurface.base(sourceSurface.port, 0, 'bottom')[0] > sourceSurface.base(shellGeometry(aegean.arrangement).port, 0, 'bottom')[0],
  'The smaller opening has an inward rolled collar instead of a flat cutoff');
for (const preset of PRESETS) {
  const layout = createLayout(preset), surface = new HandpanSurface(layout);
  check(surface.port === 0.18 && surface.port < shellGeometry(layout.arrangement).port, `${preset.name} has a compact opening inside its original shell profile`);
  for (const r of [0.18, 0.2, 0.24, 0.28, 0.32]) {
    check(surface.sample(r, 0, 'bottom').every(Number.isFinite), `${preset.name} collar samples stay finite`);
  }
  for (const field of layout.fields) {
    const normal = surface.sample(field.x, field.z, field.side).slice(3, 6);
    for (const [dx, dz] of [[1e-7, 0], [-1e-7, 0], [0, 1e-7], [0, -1e-7]]) {
      const nearby = surface.sample(field.x + dx, field.z + dz, field.side).slice(3, 6);
      check(normal.reduce((sum, v, i) => sum + v * nearby[i], 0) > 0.999,
        `${preset.name} ${field.id} keeps a continuous surface normal across its exact centre`);
    }
  }
}
check(Math.abs(sourceSurface.base(0, 0, 'top')[0] - (278.467674457 - 137.63585) / 265) < 0.00001, 'Shell height uses the measured profile');
const convex = sourceSurface.fields.find(f => f.midi === 54 && f.side === 'top');
const convexPoint = sourceSurface.sample(convex.O[0], convex.O[2], 'top');
check(convexPoint[1] > convex.py && convexPoint[0] !== convex.O[0], 'A convex cap rises and moves along the tilted field normal');
const concave = sourceSurface.fields.find(f => f.midi === 57 && f.side === 'top');
check(sourceSurface.sample(concave.O[0], concave.O[2], 'top')[1] < concave.py, 'A concave cap depresses the plane');
const sourceRetuned = transposeLayout(aegean, 3); sourceRetuned.a4 = 432;
check(Math.abs(sampleFor(sourceRetuned, sourceRetuned.fields[0]).rate - 2 ** (3 / 12) * 432 / 440) < 1e-10, 'Recorded previews follow supported transposition and concert pitch');
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
const raised = transposeLayout(original, 3);
check(raised.fields.every((f, i) => f.midi === original.fields[i].midi + 3), 'Every note transposes together');
assert.deepEqual(transposeLayout(raised, -3), original); assertions++;
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

for (let midi = MIDI_MIN; midi <= MIDI_MAX; midi++) {
  if (midi === 70) { check(!allowedNote(midi), 'B♭4 is excluded'); continue; }
  const dimensions = noteDimensions(midi);
  check(dimensions?.tonefield.length === 2 && dimensions.dimple.length === 2, 'Every supported pitch has dimensions');
  const field = sizeForNote(original, { id: 'sizing', midi, side: 'top', x: 0.4, z: 0.4, angle: 0 });
  check(Math.abs(field.size * 530 - dimensions.tonefield[1]) < 1e-8
    && Math.abs(field.size * field.aspect * 530 - dimensions.tonefield[0]) < 1e-8, 'Tonefield dimensions match the specification in millimetres');
  const surface = new HandpanSurface({ ...original, fields: [field] }), cap = surface.fields[0].caps[0];
  check(Math.abs(cap.Ru * 530 - dimensions.dimple[0]) < 1e-8
    && Math.abs(cap.Rv * 530 - dimensions.dimple[1]) < 1e-8, 'Rendered dimple dimensions match both supplied axes');
  if (midi > 76) check(field.aspect === 1 && field.shape === 'pure', 'Every pitch above E5 is circular and pure');
  const radial = Math.atan2(field.z, field.x);
  check(Math.abs(field.angle - radial - (midi >= 59 ? -Math.PI / 2 : 0)) < 1e-8, 'New notes use the correct pitch-dependent rim orientation');
  const movedAngle = dragAngle({ ...field, angle: field.angle + 0.17 }, -0.5, 0.3);
  check(Math.abs(Math.sin(2 * (movedAngle - Math.atan2(0.3, -0.5)))) < 1e-8, 'Dragging snaps to and follows a rim-parallel or perpendicular axis');
}
assert.deepEqual(noteDimensions(41).tonefield, [202, 225]); assertions++;
assert.deepEqual(noteDimensions(76).tonefield, [60, 90]); assertions++;
assert.deepEqual(noteDimensions(77).tonefield, [70, 70]); assertions++;
check(noteDimensions(48).source.includes('provisional') && noteDimensions(80).source.includes('provisional'), 'Missing C3 and G♯5 dimensions use attributed existing Ayasa measurements');
check(!allowedNote(43, 'bottom') && allowedNote(44, 'bottom') && !allowedNote(40) && !allowedNote(89), 'Top and bottom pitch boundaries are enforced');
check(stepNote(69, 1) === 71 && stepNote(71, -1) === 69, 'Pitch steppers skip B♭4 in both directions');
check(nextTranspose(original, 1) === 3 && nextTranspose(original, -1) === -2, 'Whole-instrument transposition skips keys containing B♭4');
check(raised.fields.filter(f => f.midi > 76).every(f => f.shape === 'pure' && f.aspect === 1), 'Transposition also enforces circular high fields');
assert.deepEqual(decodeLayout(encodeLayout(raised)), raised); assertions++;
const importedHigh = clone(original);
const highField = importedHigh.fields.find(f => f.midi > 76);
Object.assign(highField, { aspect: 0.82, shape: 'dimple' });
const migratedHigh = validateLayout(importedHigh).fields.find(f => f.id === highField.id);
check(migratedHigh.aspect === 1 && migratedHigh.shape === 'pure', 'Older imported high fields are normalized to circular pure geometry');
const invalidCache = clone(raised);
invalidCache.fields.find(f => f.lowerGeometry).lowerGeometry.size = NaN;
assert.throws(() => validateLayout(invalidCache)); assertions++;
assert.throws(() => transposeLayout(original, 1)); assertions++;
const lowBottom = addToneField(emptyBottom, { id: 'real-c3', midi: 48, side: 'bottom' });
check(lowBottom && lowBottom.fields.at(-1).size > 0.3 && lowBottom.fields.at(-1).shape === 'dome', 'C3 additions use a realistic large oval field');
assert.deepEqual(decodeLayout(encodeLayout(lowBottom)), lowBottom); assertions++;
check(addToneField(emptyBottom, { id: 'too-low', midi: 43, side: 'bottom' }) === null, 'Model additions reject notes below G♯2 on the bottom');
for (const preset of PRESETS) {
  const stock = createLayout(preset), position2 = setPlayingPosition(stock, 2);
  check(position2.fields.every(f => fits(position2, f)) && canAutoArrange(position2), `${preset.title}: Position 2 fits and preserves automatic placement`);
  check(position2.fields.filter(f => f.midi > 76).every(f => f.shape === 'pure' && f.aspect === 1), 'Factory high notes are circular pure fields');
  assert.deepEqual(decodeLayout(encodeLayout(position2)), position2); assertions++;
  const roundtrip = setPlayingPosition(position2, 1);
  check(stock.fields.filter(f => f.side === 'bottom').every(f => {
    const restored = roundtrip.fields.find(g => g.id === f.id);
    return Math.hypot(restored.x - f.x, restored.z - f.z) < 1e-8 && Math.abs(restored.angle - f.angle) < 1e-8;
  }), 'Position changes preserve and restore underside geometry');
}
const duplicateChord = { plainSymbol: 'Dm', root: 2, pcs: [2, 5, 9] };
const equalFields = [{ id: 'd-top', midi: 62 }, { id: 'd-bottom', midi: 62 }, { id: 'f', midi: 65 }, { id: 'a', midi: 69 }, { id: 'blank', midi: null }, { id: 'g', midi: 67 }];
assert.deepEqual(chordArpeggio(duplicateChord, equalFields).notes.map(f => f.id), ['d-top', 'd-bottom', 'f', 'a']); assertions++;
console.log(`Elaia model: ${assertions} assertions passed across ${PRESETS.length} presets, custom layouts, concert pitch, transpose, sharing, placement, and malformed inputs.`);
