import { noteName, midiToFreq } from '../src/model/notes.js';
import { PUBLISHED_LAYOUTS } from './layouts.mjs';
import { geometryReference, fieldGeometry, fieldShape, portRadius } from './geometry.mjs';

export const MAX_FIELDS = 48;
export const MIDI_MIN = 18;
export const MIDI_MAX = 96;
export const PRESETS = [
  ...Object.entries(PUBLISHED_LAYOUTS).sort(([a], [b]) =>
    Number(b === 'd-aegean-18') - Number(a === 'd-aegean-18')).map(([key, profile]) => {
    const ordered = ['top', 'bottom'].flatMap(side => profile.fields.filter(f => f[1] === side)
      .sort((a, b) => midiOf(a[0]) - midiOf(b[0])));
    const root = midiOf(ordered[0][0]);
    return {
      id: key === 'fis-low-pygmy-21' ? key : `ayasa-${key}`, profile: key,
      title: profile.name.replace('#', '♯'), name: `${profile.name} · Ayasa`,
      family: 'Ayasa', root, bottomFrom: ordered.filter(f => f[1] === 'top').length,
      iv: ordered.map(f => midiOf(f[0]) - root), flatNames: false,
      note: 'Ayasa · Measured positions, contours, sizes and convex/concave fields.',
    };
  }),
];

function midiOf(note) {
  const [, letter, accidental, octave] = /^([A-G])([#b]?)(-?\d+)$/.exec(note);
  return (+octave + 1) * 12 + { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[letter]
    + (accidental === '#' ? 1 : accidental === 'b' ? -1 : 0);
}

export const clone = value => JSON.parse(JSON.stringify(value));
export const nameOf = midi => noteName(midi, false).replace('#', '♯');
export const frequencyOf = (midi, a4) => midiToFreq(midi, a4);

export function createLayout(preset = PRESETS[0]) {
  const fields = preset.iv.map((iv, i) => ({
    id: `n${i}`, midi: preset.root + iv,
    side: i >= (preset.bottomFrom ?? Infinity) ? 'bottom' : 'top',
    x: 0, z: 0, size: i === 0 ? 0.26 : 0.16, angle: 0, aspect: 0.82,
  }));
  const profile = PUBLISHED_LAYOUTS[preset.profile];
  if (!profile) throw new Error('Choose a published Ayasa instrument.');
  fields.forEach(f => {
    const row = profile.fields.find(row => row[1] === f.side && midiOf(row[0]) === f.midi);
    const geometry = geometryReference(preset.profile, row[0], f.side);
    Object.assign(f, { x: row[2], z: row[3], size: row[4], angle: row[5], aspect: row[6], geometry });
    f.shape = fieldShape(f);
  });
  return {
    version: 1, title: preset.title, description: preset.note || '',
    preset: preset.id, arrangement: preset.profile, custom: false, transpose: 0, a4: 440,
    finish: 'ember', sound: 'ayasa', fields,
  };
}

export function validateLayout(input) {
  if (!input || input.version !== 1 || !Array.isArray(input.fields)
      || input.fields.length < 1 || input.fields.length > MAX_FIELDS) {
    throw new Error('This is not a valid Elaia layout (1–48 tone fields).');
  }
  if (![440, 432].includes(input.a4)) throw new Error('Concert pitch must be 440 or 432 Hz.');
  if (input.sound !== undefined && !['ayasa', 'modeled'].includes(input.sound)) throw new Error('Unknown sound source.');
  const ids = new Set();
  const fields = input.fields.map(f => {
    if (!f || typeof f.id !== 'string' || !/^[\w-]{1,40}$/.test(f.id) || ids.has(f.id)
        || !Number.isInteger(f.midi) || f.midi < MIDI_MIN || f.midi > MIDI_MAX
        || !['top', 'bottom'].includes(f.side)
        || ![f.x, f.z, f.size, f.angle].every(Number.isFinite)
        || f.size < 0.07 || f.size > 0.4
        || !Number.isFinite(f.aspect ?? 0.82) || (f.aspect ?? 0.82) < 0.4 || (f.aspect ?? 0.82) > 1.3
        || footprint(f).some(p => Math.hypot(...p) > 1.02)
        || Math.abs(f.angle) > Math.PI * 100) {
      throw new Error('A tone field has an invalid note, position, size, or ID.');
    }
    if (f.geometry !== undefined && !fieldGeometry(f.geometry)) throw new Error('Unknown tone field geometry.');
    if (f.shape !== undefined && !['dome', 'dimple', 'pure'].includes(f.shape)) throw new Error('Unknown tone field shape.');
    if (f.side === 'bottom' && portBlocked(f, f.x, f.z, portRadius(input) - 0.002)) {
      throw new Error('Bottom fields must leave the central sound port clear.');
    }
    ids.add(f.id);
    return { id: f.id, midi: f.midi, side: f.side, x: f.x, z: f.z, size: f.size, angle: f.angle,
      ...(f.aspect !== undefined ? { aspect: f.aspect } : {}),
      ...(f.geometry !== undefined ? { geometry: f.geometry } : {}),
      ...(f.shape !== undefined ? { shape: f.shape } : {}) };
  });
  return {
    version: 1, title: String(input.title || 'My handpan').slice(0, 64),
    description: String(input.description || '').slice(0, 240),
    preset: typeof input.preset === 'string' ? input.preset.slice(0, 60) : '',
    ...(typeof input.arrangement === 'string' ? { arrangement: input.arrangement.slice(0, 60) } : {}),
    custom: !!input.custom, transpose: Number.isInteger(input.transpose) ? input.transpose : 0,
    a4: input.a4, finish: ['ember', 'silver', 'rose'].includes(input.finish) ? input.finish : 'ember',
    ...(input.sound !== undefined ? { sound: input.sound } : {}),
    fields,
  };
}

export function transposeLayout(layout, delta) {
  if (!Number.isInteger(delta) || layout.fields.some(f => f.midi + delta < MIDI_MIN || f.midi + delta > MIDI_MAX)) {
    throw new Error('That would move a note outside the supported F♯0–C7 range.');
  }
  const next = clone(layout);
  next.fields.forEach(f => { f.midi += delta; });
  next.transpose += delta;
  return next;
}

export function footprint(field, x = field.x, z = field.z, scale = 1) {
  const c = Math.cos(field.angle || 0), s = Math.sin(field.angle || 0);
  return Array.from({ length: 32 }, (_, i) => {
    const t = i / 32 * Math.PI * 2, u = Math.cos(t) * field.size * (field.aspect ?? 0.82) * scale;
    const v = Math.sin(t) * field.size * scale;
    return [x + u * c - v * s, z + u * s + v * c];
  });
}

function portBlocked(field, x, z, margin) {
  const c = Math.cos(field.angle || 0), s = Math.sin(field.angle || 0);
  const originRadius = Math.hypot((x * c + z * s) / (field.size * (field.aspect ?? 0.82)),
    (-x * s + z * c) / field.size);
  return originRadius <= 1 || Math.hypot(x, z) < margin
    || footprint(field, x, z).some(p => Math.hypot(...p) < margin);
}

export function fits(layout, field, x = field.x, z = field.z) {
  const outline = footprint(field, x, z);
  if (outline.some(p => Math.hypot(...p) > 0.99)) return false;
  if (field.side === 'bottom' && portBlocked(field, x, z, portRadius(layout) + 0.002)) return false;
  return layout.fields.every(f => {
    if (f.id === field.id || f.side !== field.side) return true;
    const dx = f.x - x, dz = f.z - z;
    if (Math.hypot(dx, dz) > (field.size * Math.max(1, field.aspect ?? 0.82)
        + f.size * Math.max(1, f.aspect ?? 0.82)) * 0.92) return true;
    // Analytic ellipse support avoids allocating thousands of polygon
    // projections while searching slots or dragging on a phone.
    const support = (ellipse, axis) => {
      const angle = axis - (ellipse.angle || 0);
      return ellipse.size * 0.92 * Math.hypot(Math.cos(angle) * (ellipse.aspect ?? 0.82), Math.sin(angle));
    };
    for (let i = -3; i < 32; i++) {
      const angle = i === -3 ? Math.atan2(dz, dx) : i === -2 ? field.angle || 0 : i === -1 ? f.angle || 0 : i / 32 * Math.PI;
      if (Math.abs(dx * Math.cos(angle) + dz * Math.sin(angle)) >= support(field, angle) + support(f, angle)) return true;
    }
    return false;
  });
}

export function automaticField(layout, { id, midi, side }) {
  for (const size of [0.125, 0.105, 0.085]) {
    const field = { id, midi, side, x: 0, z: 0, size, angle: 0, aspect: 0.82, shape: 'dimple' };
    let best = null;
    for (const radius of [0.68, 0.48, 0.8, 0.34]) for (let i = 0; i < 48; i++) {
      const angle = Math.PI / 2 + i / 48 * Math.PI * 2;
      const x = Math.cos(angle) * radius, z = Math.sin(angle) * radius;
      field.angle = angle;
      if (!fits(layout, field, x, z)) continue;
      const clearance = Math.min(...layout.fields.filter(f => f.side === side).map(f =>
        Math.hypot(f.x - x, f.z - z) - f.size), 0.99 - radius);
      const score = clearance - Math.abs(radius - 0.68) * 1.2;
      if (!best || score > best.score) best = { score, field: { ...field, x, z } };
    }
    if (best) return best.field;
  }
  return null;
}

export function arrangementInfo(layout) {
  if (layout.custom) return 'Custom layout';
  if (Object.hasOwn(PUBLISHED_LAYOUTS, layout.arrangement)) return 'Ayasa · Published layout';
  return 'Digital alternating layout';
}

export function restoreCurrent(input) {
  const layout = validateLayout(input);
  if (layout.custom) return layout;
  const legacyTitles = ['D Kurd', 'D Celtic Minor', 'D Amara', 'F Low Pygmy', 'C# Annaziska',
    'E La Sirena', 'D Hijaz', 'F Aegean', 'D Sabye', 'C# Raga Desi', 'F Blues', 'G Oxalis',
    'E Equinox', 'B Shang Diao', 'F Low Pygmy', 'D Kurd', 'D Kurd', 'E Integral',
    'C Harmonic Minor', 'D1 Abyss', 'C1 Leviathan', 'A0 Tectonic', 'F#0 Gravity Well'];
  const oldIndex = /^scale-(\d+)$/.exec(layout.preset)?.[1];
  const legacyFactory = layout.arrangement === 'alternating' && ((layout.preset === 'd-aegean-18' && layout.title === 'D Aegean')
    || (oldIndex !== undefined && layout.title === legacyTitles[+oldIndex]));
  const preset = PRESETS.find(p => p.id === layout.preset)
    || PRESETS.find(p => p.profile === layout.arrangement);
  if (!legacyFactory) {
    if (!preset || layout.title !== preset.title) return layout;
    const factory = createLayout(preset);
    if (layout.fields.length !== factory.fields.length || layout.fields.some(f => {
      const g = factory.fields.find(g => g.id === f.id);
      return !g || f.midi !== g.midi + layout.transpose || f.side !== g.side
        || Math.abs(f.x - g.x) > 1e-5 || Math.abs(f.z - g.z) > 1e-5
        || Math.abs(f.angle - g.angle) > 1e-5 || Math.abs((f.aspect ?? 0.82) - g.aspect) > 1e-5
        || (Math.abs(f.size - g.size) > 1e-5 && Math.abs(f.size - g.size * 0.94) > 1e-5)
        || (f.geometry && f.geometry !== g.geometry) || (f.shape && f.shape !== g.shape);
    })) return layout;
  }
  // Refresh untouched factory instruments. Never migrate imported/shared files
  // or named saved instruments: those represent a specific user document.
  const next = createLayout(preset || PRESETS[0]);
  const tuned = layout.transpose ? transposeLayout(next, layout.transpose) : next;
  tuned.a4 = layout.a4; tuned.finish = layout.finish;
  if (layout.sound) tuned.sound = layout.sound;
  return tuned;
}

export function audioLayout(layout) {
  const fields = layout.fields.filter(f => f.side === 'top').concat(layout.fields.filter(f => f.side === 'bottom'));
  const root = fields[0].midi;
  return {
    fields,
    scale: { root, iv: fields.map(f => f.midi - root), flatNames: false,
      bottomFrom: fields.filter(f => f.side === 'top').length },
  };
}

export function encodeLayout(layout) {
  const bytes = new TextEncoder().encode(JSON.stringify(validateLayout(layout)));
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function decodeLayout(code) {
  if (typeof code !== 'string' || code.length > 24000) throw new Error('The shared layout is too large.');
  try {
    const bytes = Uint8Array.from(atob(code.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
    return validateLayout(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
  } catch (error) {
    throw new Error('This layout link is invalid or damaged. ' + error.message);
  }
}

export function loadStorage(storage, key, fallback) {
  try { return JSON.parse(storage.getItem(key)) ?? fallback; } catch { return fallback; }
}

export const KEYS = [' ', 'a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', ';', 'q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p', 'z', 'x', 'c', 'v', 'b', 'n', ',', '.', '/'];
