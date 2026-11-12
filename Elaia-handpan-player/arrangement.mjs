import { PRESETS, MIDI_MIN, MIDI_MAX, MAX_FIELDS, createLayout, clone, fits, automaticField, transposeLayout } from './model.mjs';
import { allowedNote, sizeForNote, rimAngle } from './tonefields.mjs';

const presetFor = layout => PRESETS.find(p => p.id === layout.preset) || PRESETS.find(p => p.profile === layout.arrangement);
export function originalLayout(layout) {
  const next = createLayout(presetFor(layout) || PRESETS[0]);
  next.a4 = layout.a4; next.finish = layout.finish;
  return next;
}
function factory(layout) {
  const preset = presetFor(layout);
  if (!preset) return null;
  let source = createLayout(preset);
  if (layout.transpose) {
    try { source = transposeLayout(source, layout.transpose); }
    catch { source.fields.forEach(f => { f.midi += layout.transpose; }); }
  }
  if (layout.position === 2) orientPosition(source, 2);
  return source;
}
function sourceField(field, source) {
  return source.fields.find(f => f.id === (field.autoSlot || field.id))
    || source.fields.find(f => f.geometry && f.geometry === field.geometry);
}
function innerFields(source) {
  const top = source.fields.filter(f => f.side === 'top');
  return top.filter(f => f !== top[0] && Math.hypot(f.x, f.z) < 0.6);
}

// Mudra's public player uses one front-centred ring field in Position 1 and
// two front fields in Position 2. Offset the ring by half its first interval;
// retain the player-facing ding and mutant group. Both shells share the turn.
// Reference: https://player.mudrahandpan.com/ (custom-9 / custom-9-pos2 SVGs).
function positionTurn(layout) {
  const source = createLayout(presetFor(layout) || PRESETS[0]);
  const inner = new Set(innerFields(source).map(f => f.id));
  const ring = source.fields.filter(f => f.side === 'top' && f.id !== source.fields[0].id && !inner.has(f.id));
  if (ring.length < 2) return 0;
  const [a, b] = ring;
  const delta = Math.atan2(a.x * b.z - a.z * b.x, a.x * b.x + a.z * b.z);
  return -delta / 2;
}

function orientPosition(layout, position) {
  const turn = positionTurn(layout) * (position - (layout.position || 1));
  const source = createLayout(presetFor(layout) || PRESETS[0]);
  const inner = new Set([source.fields[0].id, ...innerFields(source).map(f => f.id)]);
  const c = Math.cos(turn), s = Math.sin(turn);
  for (const field of layout.fields) {
    const slot = field.autoSlot || field.id;
    if (field.side === 'top' && (slot === 'mutant' || inner.has(slot))) continue;
    const { x, z } = field;
    field.x = x * c - z * s; field.z = x * s + z * c;
    field.angle += turn;
  }
  layout.position = position;
  return layout;
}

export function setPlayingPosition(layout, position) {
  if (![1, 2].includes(position)) throw new Error('Choose playing position 1 or 2.');
  if ((layout.position || 1) === position) return clone(layout);
  const next = orientPosition(clone(layout), position);
  if (!next.fields.every(f => fits(next, f))) {
    if (!canAutoArrange(layout) || !arrangeCluster(next, factory(next)) || !next.fields.every(f => fits(next, f))) {
      throw new Error('That playing position needs more space around the inner notes. Move a field first.');
    }
  }
  return next;
}
function samePosition(a, b) {
  return a.side === b.side && ['x', 'z', 'size', 'angle', 'aspect']
    .every(key => Math.abs((a[key] ?? 0.82) - (b[key] ?? 0.82)) < 1e-5);
}
export function canAutoArrange(layout) {
  const source = factory(layout);
  if (layout.manualPlacement || !source) return false;
  return layout.fields.every(f => {
    if (f.autoSlot === 'mutant' || (f.side === 'bottom' && f.autoSlot === 'free')) return true;
    const original = sourceField(f, source);
    return original && (samePosition(f, original) || f.autoSlot && f.side === original.side
      && Math.hypot(f.x - original.x, f.z - original.z) < 1e-5);
  });
}
function missingSlots(layout, source, side, includeInner = true) {
  const inner = new Set(innerFields(source).map(f => f.id));
  return source.fields.filter(f => f.side === side && (includeInner || !inner.has(f.id))
    && !layout.fields.some(current => sourceField(current, source)?.id === f.id));
}
export function scalePitches(layout) {
  const source = factory(layout);
  const pitches = [...new Set((source || layout).fields.filter(f => f.midi !== null).map(f => f.midi % 12))];
  return source || pitches.length >= 3 ? pitches : [];
}
export function nextNote(layout, side, after) {
  const source = factory(layout);
  if (source && canAutoArrange(layout)) {
    const missing = missingSlots(layout, source, side);
    const available = missing.find(f => allowedNote(f.midi, side));
    if (available) return available.midi;
  }
  const pitches = scalePitches(layout);
  if (!pitches.length) return null;
  const fields = layout.fields.filter(f => f.side === side && f.midi !== null);
  const start = Math.max(MIDI_MIN - 1, after ?? Math.max(...fields.map(f => f.midi), source?.fields[0].midi ?? 48));
  for (let midi = start + 1; midi <= MIDI_MAX; midi++) if (allowedNote(midi, side) && pitches.includes(midi % 12)) return midi;
  return null;
}

// The cluster opens toward the player. Its centres remain symmetric;
// individual field sizes retain their pitch-dependent proportions.
const CLUSTERS = [
  [],
  [[0, -0.47]],
  [[-0.2, -0.46], [0.2, -0.46]],
  [[0, -0.47], [-0.35, -0.29], [0.35, -0.29]],
  [[-0.17, -0.48], [0.17, -0.48], [-0.42, -0.16], [0.42, -0.16]],
  [[0, -0.47], [-0.34, -0.29], [0.34, -0.29], [-0.47, 0.045], [0.47, 0.045]],
];
function mutants(layout, source) {
  const inner = new Set(innerFields(source).map(f => f.id));
  return layout.fields.filter(f => f.side === 'top'
    && (f.autoSlot === 'mutant' || inner.has(sourceField(f, source)?.id)))
    .sort((a, b) => (a.midi ?? Infinity) - (b.midi ?? Infinity));
}
export function placementStatus(layout, side) {
  if (!canAutoArrange(layout)) return { automatic: false, full: false, label: 'Manual layout' };
  const source = factory(layout);
  if (side === 'bottom' || missingSlots(layout, source, side, false).length) {
    return { automatic: true, full: false, label: 'Default positions' };
  }
  const count = mutants(layout, source).length;
  return { automatic: true, full: count >= 5, label: `Inner cluster · ${count}/5` };
}
function arrangeCluster(layout, source) {
  const fields = mutants(layout, source), points = CLUSTERS[fields.length];
  if (!points) return false;
  if (!fields.length) return true;
  for (const stretch of [1, 1.06, 0.94, 1.12, 1.18]) for (const offset of [0, -0.02, 0.02, -0.04, 0.04, -0.06, 0.08, 0.1, 0.12]) {
    const trial = fields.map((f, i) => {
      const [x, z] = points[i], next = { ...f, x: x * stretch, z: z + offset, autoSlot: 'mutant' };
      next.angle = rimAngle(next);
      return next;
    });
    const proposed = { ...layout, fields: layout.fields.map(f => trial.find(t => t.id === f.id) || f) };
    if (!trial.every(f => fits(proposed, f))) continue;
    layout.fields = proposed.fields; return true;
  }
  return false;
}
export function addToneField(layout, { id, midi, side }) {
  if (layout.fields.length >= MAX_FIELDS || !allowedNote(midi, side)) return null;
  const next = clone(layout), source = factory(layout), automatic = canAutoArrange(layout);
  let field;
  if (automatic) {
    const slots = missingSlots(layout, source, side, side !== 'top');
    const slot = slots.find(f => f.midi === midi) || slots[0];
    if (slot) {
      field = sizeForNote(layout, { ...slot, id, midi, autoSlot: slot.id });
      if (!fits(layout, field)) return null;
    }
    else if (side === 'top') {
      if (mutants(layout, source).length >= 5) return null;
      const missing = missingSlots(layout, source, 'top').find(f => f.midi === midi);
      if (missing) field = sizeForNote(layout, { ...missing, id, midi, autoSlot: 'mutant' });
      else {
        field = sizeForNote(layout, { id, midi, side, x: 0, z: -0.47, angle: 0, autoSlot: 'mutant' });
      }
    }
  }
  if (!field) {
    field = automaticField(layout, { id, midi, side });
    if (!field) return null;
    if (automatic && side === 'bottom') field.autoSlot = 'free';
    else next.manualPlacement = true;
  }
  next.fields.push(field); next.custom = true;
  if (automatic && side === 'top' && field.autoSlot === 'mutant' && !arrangeCluster(next, source)) return null;
  return next;
}
export function removeToneField(layout, id) {
  const next = clone(layout);
  next.fields = next.fields.filter(f => f.id !== id);
  if (canAutoArrange(layout)) {
    const source = factory(layout);
    if (mutants(next, source).length !== mutants(layout, source).length) arrangeCluster(next, source);
  }
  return next;
}
