/* Builds a complete modal parameter set for a scale: every tone field's mode
 * table, the global shell/cavity resonators, and the coupling matrix.
 *
 * Pure data - no audio objects - so it can be unit tested and reused.
 */

import { midiToFreq, noteName, rng, dB } from './notes.js';
import { isBottom } from './scales.js';

/* Per-tone-field mode template.
 *
 * Modes 1-3 are the principal structural modes, tuned to JUST 1:2:3 (not the
 * equal-tempered twelfth). Each is paired with a near-degenerate partner a few
 * Hz away: that pair IS the beating, not a chorus effect. Mode 4 sits near
 * 4*f0; modes 5-7 are a deliberately inharmonic high cluster that only appears
 * on hard strikes.
 *
 * `t60` values are for a D3 reference (146.83 Hz) and scale as 1/sqrt(f0).
 */
export const MODE_TEMPLATE = [
  { p:1, ratio:1.000, db:  0, t60:6.0, beat:0,    gate:0    },
  { p:1, ratio:1.000, db:-12, t60:5.0, beat:+1.2, gate:0    },
  { p:2, ratio:2.000, db: -4, t60:4.0, beat:0,    gate:0    },
  { p:2, ratio:2.000, db:-16, t60:3.5, beat:+1.8, gate:0    },
  { p:3, ratio:3.000, db:-10, t60:2.5, beat:0,    gate:0    },
  { p:3, ratio:3.000, db:-20, t60:2.0, beat:-2.5, gate:0    },
  { p:4, ratio:3.980, db:-22, t60:1.2, beat:0,    gate:0    },
  { p:5, ratio:5.900, db:-28, t60:0.5, beat:0,    gate:0.45 },
  { p:6, ratio:7.400, db:-30, t60:0.4, beat:0,    gate:0.45 },
  { p:7, ratio:8.200, db:-32, t60:0.3, beat:0,    gate:0.45 },
];

/** Indices of the three principal (unpartnered) modes: used for coupling. */
export const PRINCIPAL = [0, 2, 4];

const T60_REF_HZ = 146.83;

/**
 * @param {Object} scale     entry from the scale library
 * @param {Object} opts      {a4, rootMidi, helmF, seed, maxT60}
 * @returns {Object}         instrument description
 */
export function buildInstrument (scale, opts = {}) {
  const a4       = opts.a4 ?? 440;
  const rootMidi = opts.rootMidi ?? scale.root;
  const seed     = opts.seed ?? 7;
  const R        = rng(seed * 2654435761 + 12345);

  const notes = [];
  scale.iv.forEach((iv, ni) => {
    const midi = rootMidi + iv;
    const f0 = midiToFreq(midi, a4);
    // Very low fields would otherwise ring for an unusable length of time.
    const tScale = Math.min(2.6, Math.sqrt(T60_REF_HZ / f0));
    const modes = MODE_TEMPLATE.map((m, mi) => {
      // Ratio jitter: real tone fields deviate a few tenths of a percent from
      // exact 1:2:3. Mode 1 is NOT jittered - it carries the perceived pitch
      // and must land on the tempered fundamental. Modes 2-3 drift slightly
      // (the tuner's compromise); the high cluster is strongly inharmonic.
      const jit = mi === 0 ? 1
                : mi < 7  ? 1 + (R() - 0.5) * 0.004
                          : 1 + (R() - 0.5) * 0.09;
      const beat = m.beat === 0 ? 0 : m.beat * (0.6 + R() * 0.9);
      const freq = f0 * m.ratio * jit + beat;
      // Radiation efficiency: very high modes couple to air less well.
      const rad = 1 / Math.sqrt(1 + Math.pow(freq / 3600, 2));
      return {
        f: freq,
        amp: dB(m.db) * rad,
        t60: m.t60 * tScale * (0.88 + R() * 0.24),
        gate: m.gate,
        p: m.p,
        i: 0,                       // resonator index, assigned below
      };
    });
    notes.push({
      ni, midi, f0, name: noteName(midi), modes,
      bottom: isBottom(scale, ni),
      slot: ni,
      // geometry, filled in by the layout pass
      x:0, y:0, z:0, r:0, pan:0, flash:0, energy:0,
    });
  });

  /* ---- flatten to resonator arrays ------------------------------------- */
  const f = [], t60 = [], src = [], noteOf = [];
  notes.forEach(nt => nt.modes.forEach(md => {
    md.i = f.length;
    f.push(md.f); t60.push(md.t60); src.push(nt.slot); noteOf.push(nt.ni);
  }));

  /* ---- global modes: Helmholtz cavity + two weak shell modes ------------
   * Excited weakly by every strike, and the same for all notes. */
  const GLOBAL_SLOT = notes.length;
  const dingF = notes[0].f0;
  const helmF = opts.helmF ?? 85;
  const globals = [
    { f: helmF,        amp: dB(-25), t60: 1.5, label:'Helmholtz' },
    { f: dingF * 1.42, amp: dB(-33), t60: 0.9, label:'shell 1' },
    { f: dingF * 2.31, amp: dB(-35), t60: 0.6, label:'shell 2' },
  ];
  globals.forEach(g => {
    g.i = f.length;
    f.push(g.f); t60.push(g.t60); src.push(GLOBAL_SLOT); noteOf.push(-1);
  });

  /* ---- coupling: fields sharing a partial frequency drive each other ----
   * Emergent, not hardcoded: on a D-based layout this reproduces the published
   * PANArt skeleton (D3 octave partial -> D4 fundamental, and so on). */
  const cd = [], cs = [], ck = [];
  for (let i = 0; i < notes.length; i++) {
    for (let j = 0; j < notes.length; j++) {
      if (i === j) continue;
      for (const a of PRINCIPAL) {
        for (const b of PRINCIPAL) {
          const fa = notes[i].modes[a].f, fb = notes[j].modes[b].f;
          const tol = Math.max(3.5, 0.008 * fb);
          const d = Math.abs(fa - fb);
          if (d > tol) continue;
          cd.push(notes[j].modes[b].i);
          cs.push(notes[i].modes[a].i);
          ck.push(1 - d / tol);
        }
      }
    }
  }

  return {
    scale, notes, globals, a4, rootMidi, helmF, seed,
    nNotes: notes.length,
    GLOBAL_SLOT,
    resonators: { f, t60, src, noteOf, cd, cs, ck },
  };
}

/**
 * Modal excitation amplitudes for one strike.
 * Returns {idx, amp, gidx, gcent} ready to post to the DSP.
 */
export function strikeAmplitudes (inst, noteIdx, vel, pos) {
  const v = Math.max(0.02, Math.min(1, vel));
  const p = Math.max(0, Math.min(1, pos));
  const nt = inst.notes[noteIdx];
  const idx = [], amp = [], gidx = [], gcent = [];

  // Strike position: at the dimple the fundamental dominates; toward the
  // shoulder it is suppressed and the octave/twelfth take over (the physical
  // "harmonic isolation" a player uses deliberately).
  const posDb = { 1: -18 * Math.pow(p, 1.6), 2: 6 * Math.pow(p, 0.7),
                  3: 8 * Math.pow(p, 1.2) };

  for (const md of nt.modes) {
    let g = md.amp * Math.pow(v, 1.15) *
            dB(posDb[md.p] !== undefined ? posDb[md.p] : 4 * p);
    if (md.gate > 0) {
      // Inharmonic cluster is silent below the gate, then rises steeply.
      if (v <= md.gate) g = 0;
      else g *= Math.pow((v - md.gate) / (1 - md.gate), 2);
    }
    idx.push(md.i); amp.push(g);
    // Nonlinear pitch settling: hard strikes start a few cents sharp.
    if (md.p <= 2 && v > 0.55) {
      gidx.push(md.i);
      gcent.push((v - 0.55) / 0.45 * 7 * (md.p === 1 ? 1 : 0.6));
    }
  }
  for (const g of inst.globals) { idx.push(g.i); amp.push(g.amp * v); }
  return { idx, amp, gidx, gcent };
}
