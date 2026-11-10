import { PRESETS, MIDI_MIN, MIDI_MAX, MAX_FIELDS, createLayout, clone, fits, automaticField } from './model.mjs';

const presetFor = layout => PRESETS.find(p => p.id === layout.preset) || PRESETS.find(p => p.profile === layout.arrangement);
export function originalLayout(layout) {
  const next = createLayout(presetFor(layout) || PRESETS[0]);
  next.a4 = layout.a4; next.finish = layout.finish;
  return next;
}
function factory(layout) {
  const preset = presetFor(layout);
  if (!preset) return null;
  const source = createLayout(preset);
  source.fields.forEach(f => { f.midi += layout.transpose; });
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
    return original && samePosition(f, original);
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
    const available = missing.find(f => f.midi >= MIDI_MIN && f.midi <= MIDI_MAX);
    if (available) return available.midi;
  }
  const pitches = scalePitches(layout);
  if (!pitches.length) return null;
  const fields = layout.fields.filter(f => f.side === side && f.midi !== null);
  const start = Math.max(MIDI_MIN - 1, after ?? Math.max(...fields.map(f => f.midi), source?.fields[0].midi ?? 48));
  for (let midi = start + 1; midi <= MIDI_MAX; midi++) if (pitches.includes(midi % 12)) return midi;
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
  for (const scale of [1, 0.94, 0.88, 0.82, 0.76, 0.7, 0.64, 0.58]) {
    for (const stretch of [1, 1.06, 0.94, 1.12]) for (const offset of [0, -0.02, 0.02, -0.04, 0.04]) {
      const trial = fields.map((f, i) => {
        const [x, z] = points[i], autoSize = f.autoSize ?? f.size;
        return { ...f, x: x * stretch, z: z + offset, angle: Math.atan2(z, x),
          size: Math.max(0.07, autoSize * scale), autoSize, autoSlot: 'mutant' };
      });
      const proposed = { ...layout, fields: layout.fields.map(f => trial.find(t => t.id === f.id) || f) };
      if (!trial.every(f => fits(proposed, f))) continue;
      layout.fields = proposed.fields; return true;
    }
  }
  return false;
}
export function addToneField(layout, { id, midi, side }) {
  if (layout.fields.length >= MAX_FIELDS) return null;
  const next = clone(layout), source = factory(layout), automatic = canAutoArrange(layout);
  let field;
  if (automatic) {
    const slots = missingSlots(layout, source, side, side !== 'top');
    const slot = slots.find(f => f.midi === midi) || slots[0];
    if (slot) field = { ...slot, id, midi, autoSlot: slot.id };
    else if (side === 'top') {
      if (mutants(layout, source).length >= 5) return null;
      const missing = missingSlots(layout, source, 'top').find(f => f.midi === midi);
      if (missing) field = { ...missing, id, midi, autoSlot: 'mutant' };
      else {
        const reference = source.fields.filter(f => f.side === 'top')
          .reduce((best, f) => Math.abs(f.midi - (midi ?? 78)) < Math.abs(best.midi - (midi ?? 78)) ? f : best);
        const size = Math.max(0.075, Math.min(0.17, reference.size * 2 ** ((reference.midi - (midi ?? reference.midi)) / 24)));
        field = { id, midi, side, x: 0, z: -0.47, size, aspect: 0.82, angle: -Math.PI / 2, shape: 'dimple', autoSlot: 'mutant' };
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
