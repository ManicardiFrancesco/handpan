import { PUBLISHED_LAYOUTS } from './layouts.mjs';
import { fieldGeometry, geometryReference, bodyDiameter } from './geometry.mjs';

export const MIDI_MIN = 41; // F2
export const MIDI_MAX = 88; // E6
export const BOTTOM_MIN = 44; // G♯2
export const OMITTED_NOTE = 70; // B♭4

export function allowedNote(midi, side = 'top') {
  return ['top', 'bottom'].includes(side) && (midi === null || Number.isInteger(midi) && midi >= (side === 'bottom' ? BOTTOM_MIN : MIDI_MIN)
    && midi <= MIDI_MAX && midi !== OMITTED_NOTE);
}

export function stepNote(midi, direction, side = 'top') {
  if (midi === null || ![-1, 1].includes(direction)) return null;
  for (let next = midi + direction; next >= MIDI_MIN && next <= MIDI_MAX; next += direction) {
    if (allowedNote(next, side)) return next;
  }
  return null;
}

// Elaia's supplied dimensions, in millimetres: minor × major axes.
// The written specification places E5 in the oval group; pure tones start at F5.
const DIMENSIONS = [
  [41, 44, [202, 225], [100, 120]],
  [45, 47, [190, 220], [90, 110]],
  [49, 50, [160, 180], [85, 100]],
  [51, 52, [145, 165], [75, 85]],
  [53, 55, [135, 160], [70, 80]],
  [56, 58, [125, 145], [60, 75]],
  [59, 61, [105, 140], [50, 65]],
  [62, 64, [100, 130], [45, 60]],
  [65, 67, [85, 120], [40, 55]],
  [68, 71, [80, 110], [35, 45]],
  [72, 74, [65, 95], [25, 30]],
  [75, 76, [60, 90], [25, 30]],
  [77, 79, [70, 70], [25, 25]],
  [81, 84, [60, 60], [25, 25]],
  [85, 88, [50, 50], [20, 20]],
];
const pitchOf = note => {
  const [, letter, accidental, octave] = /^([A-G])([#b]?)(\d+)$/.exec(note);
  return (+octave + 1) * 12 + { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[letter]
    + (accidental === '#' ? 1 : accidental === 'b' ? -1 : 0);
};
const fallbackDimensions = new Map();

export function noteDimensions(midi) {
  if (!allowedNote(midi) || midi === null) return null;
  const row = DIMENSIONS.find(([low, high]) => midi >= low && midi <= high);
  if (row) return { tonefield: [...row[2]], dimple: [...row[3]], source: 'Elaia' };
  if (fallbackDimensions.has(midi)) return fallbackDimensions.get(midi);
  // C3 and G♯5 are missing from the supplied table. Retain an existing
  // manufacturer's measurement until Elaia supplies these two rows.
  for (const [profile, layout] of Object.entries(PUBLISHED_LAYOUTS)) {
    const field = layout.fields.find(f => f[1] === 'top' && pitchOf(f[0]) === midi);
    if (!field) continue;
    const geometry = fieldGeometry(geometryReference(profile, field[0], field[1]));
    const core = geometry.dimple || geometry.tier1;
    const major = field[4] * geometry.radius * 2;
    const result = {
      tonefield: midi > 76 ? [major, major] : [major * field[6], major],
      dimple: [Math.min(core.Ru, core.Rv) * 2, Math.max(core.Ru, core.Rv) * 2],
      source: 'Ayasa · provisional',
    };
    fallbackDimensions.set(midi, result);
    return result;
  }
  return null;
}

export function rimAngle(field, x = field.x, z = field.z) {
  // Field.angle is the minor-axis angle. Low fields' major axes follow the
  // tangent; B3–E5 major axes point towards the rim. Circular fields need no axis.
  return Math.atan2(z, x) - (field.midi !== null && field.midi >= 59 ? Math.PI / 2 : 0);
}

export function sizeForNote(layout, field) {
  const dimensions = noteDimensions(field.midi);
  if (!dimensions) return { ...field, size: 95 / bodyDiameter(layout), aspect: 65 / 95,
    dimpleSize: 30 / bodyDiameter(layout), dimpleAspect: 25 / 30, shape: 'dimple' };
  const [minor, major] = dimensions.tonefield, [innerMinor, innerMajor] = dimensions.dimple;
  const next = { ...field, size: major / bodyDiameter(layout), aspect: minor / major,
    dimpleSize: innerMajor / bodyDiameter(layout), dimpleAspect: innerMinor / innerMajor,
    shape: field.midi > 76 ? 'pure' : field.midi <= 58 ? 'dome' : 'dimple' };
  delete next.geometry; delete next.autoSize; delete next.lowerGeometry;
  next.angle = rimAngle(next);
  return next;
}

export function dragAngle(field, x, z) {
  if (Math.hypot(x, z) < 0.01) return field.angle;
  if (Math.hypot(field.x, field.z) < 0.01) return rimAngle(field, x, z);
  const quarterTurn = Math.PI / 2;
  const orientation = Math.round((field.angle - Math.atan2(field.z, field.x)) / quarterTurn) * quarterTurn;
  const angle = Math.atan2(z, x) + orientation;
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}
