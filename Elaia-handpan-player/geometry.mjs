import { GEOMETRY_DATA } from './geometry-data.mjs';

const decoded = new Map();
const shells = new Map();

function unpack(code, floating = false) {
  const bytes = Uint8Array.from(atob(code), c => c.charCodeAt(0));
  const view = new DataView(bytes.buffer), stride = floating ? 4 : 2;
  return Array.from({ length: bytes.length / stride / 2 }, (_, i) => [0, 1].map(j =>
    floating ? view.getFloat32((i * 2 + j) * stride, true) : view.getInt16((i * 2 + j) * stride, true) / 100));
}

export function geometryReference(profile, note, side) {
  const index = GEOMETRY_DATA[profile]?.fields.findIndex(f => f.note === note && f.side === side);
  return index >= 0 ? `${profile}/${index}` : undefined;
}

export function fieldGeometry(reference) {
  if (typeof reference !== 'string') return null;
  if (decoded.has(reference)) return decoded.get(reference);
  const [key, index] = reference.split('/');
  const model = Object.hasOwn(GEOMETRY_DATA, key) ? GEOMETRY_DATA[key] : null, source = model?.fields[+index];
  if (!source || String(+index) !== index) return null;
  const result = { ...source, radius: model.radius, rimZ: model.rimZ,
    boundary: unpack(source.boundary), inner: unpack(source.inner) };
  decoded.set(reference, result);
  return result;
}

export function shellGeometry(profile) {
  if (shells.has(profile)) return shells.get(profile);
  const source = Object.hasOwn(GEOMETRY_DATA, profile) ? GEOMETRY_DATA[profile] : GEOMETRY_DATA['d-aegean-18'];
  const result = Object.fromEntries(['top', 'bottom'].map(side => [side,
    unpack(source.shells[side], true).map(([r, y]) => [r / source.radius, (y - source.rimZ) / source.radius])]));
  result.port = result.bottom[0][0];
  shells.set(profile, result);
  return result;
}

export function fieldShape(field, layout) {
  if (field.shape) return field.shape;
  const source = fieldGeometry(field.geometry);
  return source?.tier1 ? 'dome' : source?.type === 'pure' ? 'pure'
    : !source && layout?.fields.find(f => f.side === 'top')?.id === field.id ? 'dome' : 'dimple';
}

export function portRadius(layout) {
  // Use a compact gu mouth; the wider published profile joins its collar.
  // At a 530 mm shell diameter, this gives a 95.4 mm opening.
  return layout.fields.some(f => f.geometry) ? Math.min(shellGeometry(layout.arrangement).port, 0.18) : 0.18;
}

export function bodyDiameter(layout) {
  return (GEOMETRY_DATA[layout.arrangement]?.radius || GEOMETRY_DATA['d-aegean-18'].radius) * 2;
}
