/* Chord analysis for an arbitrary handpan layout.
 *
 * Given the set of pitch classes a layout can sound, find every standard
 * Western chord that is fully playable, and report which physical notes voice
 * it. Two independent questions are answered:
 *
 *   1. Which chords EXIST in the layout?          -> findChords()
 *   2. What is the user currently holding?        -> identify()
 *
 * Chord spelling follows the usual convention: a chord is named from its root,
 * and an inversion is the same chord with a different note lowest. Because a
 * handpan cannot re-voice freely (each pitch exists only at fixed octaves), we
 * report the actual lowest sounding note as the bass and use slash notation
 * when that is not the root.
 */

import { pcName, pc } from '../model/notes.js';

/* Interval sets are given in semitones above the root. Order matters only for
 * display; matching is set-based. `weight` biases the ranking so that common
 * triads surface before exotic extensions. */
export const CHORD_TYPES = [
  // triads
  { sym:'',       name:'major',            iv:[0,4,7],        weight:100 },
  { sym:'m',      name:'minor',            iv:[0,3,7],        weight:100 },
  { sym:'dim',    name:'diminished',        iv:[0,3,6],        weight:62 },
  { sym:'aug',    name:'augmented',         iv:[0,4,8],        weight:58 },
  { sym:'sus2',   name:'suspended 2nd',     iv:[0,2,7],        weight:74 },
  { sym:'sus4',   name:'suspended 4th',     iv:[0,5,7],        weight:76 },
  { sym:'5',      name:'power chord',       iv:[0,7],          weight:40 },
  // sixths
  { sym:'6',      name:'major 6th',         iv:[0,4,7,9],      weight:70 },
  { sym:'m6',     name:'minor 6th',         iv:[0,3,7,9],      weight:68 },
  // sevenths
  { sym:'maj7',   name:'major 7th',         iv:[0,4,7,11],     weight:88 },
  { sym:'7',      name:'dominant 7th',      iv:[0,4,7,10],     weight:90 },
  { sym:'m7',     name:'minor 7th',         iv:[0,3,7,10],     weight:92 },
  { sym:'mMaj7',  name:'minor-major 7th',   iv:[0,3,7,11],     weight:48 },
  { sym:'m7b5',   name:'half-diminished',   iv:[0,3,6,10],     weight:64 },
  { sym:'dim7',   name:'diminished 7th',    iv:[0,3,6,9],      weight:52 },
  { sym:'aug7',   name:'augmented 7th',     iv:[0,4,8,10],     weight:36 },
  { sym:'7sus4',  name:'dominant 7 sus4',   iv:[0,5,7,10],     weight:54 },
  // ninths and beyond
  { sym:'add9',   name:'added 9th',         iv:[0,4,7,14],     weight:66 },
  { sym:'madd9',  name:'minor added 9th',   iv:[0,3,7,14],     weight:64 },
  { sym:'9',      name:'dominant 9th',      iv:[0,4,7,10,14],  weight:60 },
  { sym:'maj9',   name:'major 9th',         iv:[0,4,7,11,14],  weight:62 },
  { sym:'m9',     name:'minor 9th',         iv:[0,3,7,10,14],  weight:66 },
  { sym:'m11',    name:'minor 11th',        iv:[0,3,7,10,17],  weight:50 },
  { sym:'maj7#11',name:'major 7 #11',       iv:[0,4,7,11,18],  weight:34 },
  { sym:'13',     name:'dominant 13th',     iv:[0,4,7,10,21],  weight:32 },
];

/* Roman-numeral degree labels for diatonic function display. */
const ROMAN = ['I','bII','II','bIII','III','IV','bV','V','bVI','VI','bVII','VII'];

/**
 * Every chord fully playable on a layout.
 *
 * @param {Array<{midi:number, name:string, index:number}>} notes  layout notes
 * @param {{minNotes?:number, maxResults?:number, tonicPc?:number}} opts
 * @returns {Array<Object>} ranked chord descriptors
 */
export function findChords (notes, opts = {}) {
  const minNotes  = opts.minNotes  ?? 3;
  const tonicPc   = opts.tonicPc;
  const available = new Map();          // pitch class -> note entries, low->high
  for (const n of notes) {
    const p = pc(n.midi);
    if (!available.has(p)) available.set(p, []);
    available.get(p).push(n);
  }
  for (const list of available.values()) list.sort((a, b) => a.midi - b.midi);

  const out = [];
  for (let root = 0; root < 12; root++) {
    if (!available.has(root)) continue;             // root must be soundable
    for (const type of CHORD_TYPES) {
      if (type.iv.length < minNotes) continue;
      const needed = type.iv.map(iv => pc(root + iv));
      if (!needed.every(p => available.has(p))) continue;

      // Voice it: pick the lowest available octave of each pitch class, then
      // prefer a voicing that ascends where the layout allows it.
      const voices = voice(needed, available);
      if (!voices) continue;

      const bass = voices.reduce((a, b) => (a.midi <= b.midi ? a : b));
      const spread = Math.max(...voices.map(v => v.midi)) - bass.midi;
      const rootName = pcName(root);
      const inverted = pc(bass.midi) !== root;
      out.push({
        root, rootName, type,
        symbol: rootName + type.sym + (inverted ? '/' + pcName(bass.midi) : ''),
        plainSymbol: rootName + type.sym,
        fullName: rootName + ' ' + type.name,
        pcs: needed,
        notes: voices.slice().sort((a, b) => a.midi - b.midi),
        bass, inverted, spread,
        degree: tonicPc === undefined ? null : ROMAN[pc(root - tonicPc)],
        // Rank: common chord types first, then compact voicings, then root
        // position ahead of inversions.
        score: type.weight - spread * 0.35 - (inverted ? 12 : 0),
      });
    }
  }
  out.sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol));
  return opts.maxResults ? out.slice(0, opts.maxResults) : out;
}

/* Choose one physical note per required pitch class, keeping the total span
 * tight so the suggested voicing is actually playable by two hands. */
function voice (pcs, available) {
  const first = available.get(pcs[0]);
  if (!first) return null;
  let best = null;
  for (const rootNote of first) {
    const chosen = [rootNote];
    let ok = true;
    for (let i = 1; i < pcs.length; i++) {
      const cands = available.get(pcs[i]);
      if (!cands) { ok = false; break; }
      // nearest at or above the root, else nearest overall
      let pick = cands.find(c => c.midi >= rootNote.midi) || cands[cands.length - 1];
      chosen.push(pick);
    }
    if (!ok) continue;
    const span = Math.max(...chosen.map(c => c.midi)) - Math.min(...chosen.map(c => c.midi));
    if (!best || span < best.span) best = { chosen, span };
  }
  return best ? best.chosen : null;
}

/**
 * Identify what a held set of notes spells. Returns candidates best-first;
 * exact matches rank above supersets (added notes) and subsets (partial).
 */
export function identify (heldNotes) {
  if (!heldNotes.length) return [];
  const pcs = [...new Set(heldNotes.map(n => pc(n.midi)))].sort((a, b) => a - b);
  const bass = heldNotes.reduce((a, b) => (a.midi <= b.midi ? a : b));
  const set = new Set(pcs);
  const cands = [];
  for (let root = 0; root < 12; root++) {
    for (const type of CHORD_TYPES) {
      const needed = new Set(type.iv.map(iv => pc(root + iv)));
      let missing = 0, extra = 0;
      for (const p of needed) if (!set.has(p)) missing++;
      for (const p of set) if (!needed.has(p)) extra++;
      if (missing > 0 && !(missing === 1 && needed.size >= 4)) continue;
      if (extra > 1) continue;
      const inverted = pc(bass.midi) !== root;
      const rootName = pcName(root);
      cands.push({
        symbol: rootName + type.sym + (inverted ? '/' + pcName(bass.midi) : ''),
        fullName: rootName + ' ' + type.name,
        exact: missing === 0 && extra === 0,
        missing, extra,
        score: type.weight - missing * 40 - extra * 25 - (inverted ? 8 : 0),
      });
    }
  }
  cands.sort((a, b) => b.score - a.score);
  return cands.slice(0, 5);
}

/** Group chords by root for compact display. */
export function groupByRoot (chords) {
  const m = new Map();
  for (const c of chords) {
    if (!m.has(c.rootName)) m.set(c.rootName, []);
    m.get(c.rootName).push(c);
  }
  return m;
}

/** Summarise which scale/mode the layout's pitch-class set matches. */
const MODES = [
  { name:'major (Ionian)',  iv:[0,2,4,5,7,9,11] },
  { name:'Dorian',          iv:[0,2,3,5,7,9,10] },
  { name:'Phrygian',        iv:[0,1,3,5,7,8,10] },
  { name:'Lydian',          iv:[0,2,4,6,7,9,11] },
  { name:'Mixolydian',      iv:[0,2,4,5,7,9,10] },
  { name:'natural minor',   iv:[0,2,3,5,7,8,10] },
  { name:'Locrian',         iv:[0,1,3,5,6,8,10] },
  { name:'harmonic minor',  iv:[0,2,3,5,7,8,11] },
  { name:'melodic minor',   iv:[0,2,3,5,7,9,11] },
  { name:'Phrygian dominant', iv:[0,1,4,5,7,8,10] },
  { name:'double harmonic', iv:[0,1,4,5,7,8,11] },
  { name:'minor pentatonic',iv:[0,3,5,7,10] },
  { name:'major pentatonic',iv:[0,2,4,7,9] },
  { name:'blues',           iv:[0,3,5,6,7,10] },
  { name:'whole tone',      iv:[0,2,4,6,8,10] },
];

export function describeScale (notes, dingMidi) {
  const set = new Set(notes.map(n => pc(n.midi)));
  const tonic = pc(dingMidi);
  let best = null;
  for (const m of MODES) {
    const iv = new Set(m.iv.map(x => pc(tonic + x)));
    let miss = 0, extra = 0;
    for (const p of iv) if (!set.has(p)) miss++;
    for (const p of set) if (!iv.has(p)) extra++;
    const score = -miss - extra * 2;
    if (!best || score > best.score) best = { score, name:m.name, miss, extra };
  }
  return best;
}
