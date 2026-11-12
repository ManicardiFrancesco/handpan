import { pc } from '../src/model/notes.js';

/** One ascending arpeggio containing every physical field in the chord. */
export function chordArpeggio(chord, notes) {
  return { ...chord, symbol: chord.plainSymbol,
    notes: notes.filter(note => note.midi !== null && chord.pcs.includes(pc(note.midi)))
      .sort((a, b) => a.midi - b.midi) };
}

/** Includes every physical field, including equal-pitch fields on either shell. */
export function demoFields(layout, side) {
  if (!['top', 'bottom', 'all'].includes(side)) throw new Error('Choose top, bottom, or all notes.');
  return layout.fields.filter(f => f.midi !== null && (side === 'all' || f.side === side)).sort((a, b) => a.midi - b.midi);
}
