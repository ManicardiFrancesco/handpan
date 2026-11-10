import { pc, pcName } from '../src/model/notes.js';

/** Every available root register, voiced using real fields on this instrument. */
export function chordVoicings(chord, notes) {
  const available = new Map();
  for (const note of notes) {
    if (note.midi === null) continue;
    const pitch = pc(note.midi);
    if (!available.has(pitch)) available.set(pitch, []);
    available.get(pitch).push(note);
  }
  for (const fields of available.values()) fields.sort((a, b) => a.midi - b.midi);
  const seen = new Set(), voicings = [];
  for (const root of available.get(chord.root) || []) {
    const chosen = [root];
    for (const pitch of chord.pcs.slice(1)) {
      const fields = available.get(pitch);
      if (!fields?.length) break;
      chosen.push(fields.find(f => f.midi >= root.midi) || fields.at(-1));
    }
    if (chosen.length !== chord.pcs.length) continue;
    chosen.sort((a, b) => a.midi - b.midi);
    const key = chosen.map(f => f.midi).join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    const bass = chosen[0], inverted = pc(bass.midi) !== chord.root;
    voicings.push({
      ...chord, notes: chosen, bass, inverted,
      rootMidi: root.midi, octave: Math.floor(root.midi / 12) - 1,
      spread: chosen.at(-1).midi - bass.midi,
      symbol: chord.plainSymbol + (inverted ? '/' + pcName(pc(bass.midi)) : ''),
    });
  }
  return voicings;
}

/** Includes every physical field, including equal-pitch fields on either shell. */
export function demoFields(layout, side) {
  if (!['top', 'bottom', 'all'].includes(side)) throw new Error('Choose top, bottom, or all notes.');
  return layout.fields.filter(f => f.midi !== null && (side === 'all' || f.side === side)).sort((a, b) => a.midi - b.midi);
}
