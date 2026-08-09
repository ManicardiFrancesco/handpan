/* Chord visualiser panel: lists every chord the current layout can play, and
 * identifies whatever is being held. Clicking a chord highlights its notes on
 * the 3D shell and can strum it. */

import { findChords, identify, describeScale, groupByRoot } from '../theory/chords.js';
import { pc, pcName } from '../model/notes.js';

export class ChordPanel {
  constructor (root, opts) {
    this.root = root;
    this.onHighlight = opts.onHighlight || (() => {});
    this.onPlay = opts.onPlay || (() => {});
    this.chords = [];
    this.filter = 'all';
    this.selected = null;
    this.root.innerHTML =
      '<div class="cp-head">' +
        '<div class="cp-mode" id="cp-mode"></div>' +
        '<div class="cp-filters" id="cp-filters"></div>' +
      '</div>' +
      '<div class="cp-live" id="cp-live"><span class="cp-dim">play notes together to identify a chord</span></div>' +
      '<div class="cp-list" id="cp-list"></div>';
    this.elMode = root.querySelector('#cp-mode');
    this.elFilters = root.querySelector('#cp-filters');
    this.elLive = root.querySelector('#cp-live');
    this.elList = root.querySelector('#cp-list');

    const FILTERS = [
      ['all',    'All'],
      ['triads', 'Triads'],
      ['7th',    '7ths'],
      ['ext',    '9/11/13'],
    ];
    this.elFilters.innerHTML = FILTERS.map(([k, l]) =>
      '<button data-f="' + k + '"' + (k === 'all' ? ' class="on"' : '') + '>' + l + '</button>').join('');
    this.elFilters.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      this.filter = b.dataset.f;
      [...this.elFilters.children].forEach(x => x.classList.toggle('on', x === b));
      this.renderList();
    });

    this.elList.addEventListener('click', (e) => {
      const it = e.target.closest('.cp-item');
      if (!it) return;
      const c = this.chords[+it.dataset.i];
      if (!c) return;
      this.selected = c;
      [...this.elList.querySelectorAll('.cp-item')].forEach(x => x.classList.toggle('sel', x === it));
      this.onHighlight(c.notes.map(n => n.index));
      this.onPlay(c);
    });
    this.elList.addEventListener('mouseleave', () => {
      if (!this.selected) this.onHighlight([]);
    });
  }

  /** Recompute for a new layout. */
  update (inst) {
    const notes = inst.notes.map(n => ({ index: n.ni, midi: n.midi, name: n.name }));
    this.tonicPc = pc(inst.notes[0].midi);
    this.chords = findChords(notes, { tonicPc: this.tonicPc });
    this.selected = null;
    const d = describeScale(notes, inst.notes[0].midi);
    const pcs = [...new Set(notes.map(n => pc(n.midi)))].sort((a, b) => a - b);
    this.elMode.innerHTML =
      '<b>' + pcName(this.tonicPc) + ' ' + d.name + '</b>' +
      '<span class="cp-dim"> · ' + pcs.length + ' pitch classes · ' +
      this.chords.length + ' chords</span>' +
      '<div class="cp-pcs">' + pcs.map(p => '<i>' + pcName(p) + '</i>').join('') + '</div>';
    this.renderList();
  }

  renderList () {
    const f = this.filter;
    const keep = (c) => {
      const n = c.type.iv.length;
      if (f === 'triads') return n === 3;
      if (f === '7th') return n === 4;
      if (f === 'ext') return n >= 5;
      return true;
    };
    const shown = this.chords.map((c, i) => ({ c, i })).filter(x => keep(x.c));
    if (!shown.length) {
      this.elList.innerHTML = '<div class="cp-empty">No chords of this type in this layout.</div>';
      return;
    }
    const groups = new Map();
    for (const x of shown) {
      if (!groups.has(x.c.rootName)) groups.set(x.c.rootName, []);
      groups.get(x.c.rootName).push(x);
    }
    let html = '';
    for (const [rootName, items] of groups) {
      html += '<div class="cp-group"><h4>' + rootName +
              (items[0].c.degree ? ' <em>' + items[0].c.degree + '</em>' : '') + '</h4>';
      for (const { c, i } of items) {
        html += '<div class="cp-item" data-i="' + i + '" title="' + c.fullName +
                ' — ' + c.notes.map(n => n.name).join(' ') + '">' +
                '<span class="cp-sym">' + c.symbol + '</span>' +
                '<span class="cp-notes">' + c.notes.map(n => n.name).join(' ') + '</span>' +
                '</div>';
      }
      html += '</div>';
    }
    this.elList.innerHTML = html;
  }

  /** Show what the currently sounding notes spell. */
  setHeld (heldNotes) {
    if (!heldNotes.length) {
      this.elLive.innerHTML = '<span class="cp-dim">play notes together to identify a chord</span>';
      return;
    }
    const names = heldNotes.map(n => n.name).join(' ');
    const cands = identify(heldNotes.map(n => ({ midi: n.midi, name: n.name })));
    if (!cands.length) {
      this.elLive.innerHTML = '<span class="cp-played">' + names + '</span>' +
        '<span class="cp-dim"> · no standard chord</span>';
      return;
    }
    const best = cands[0];
    const tag = best.exact ? '' : (best.missing ? ' <em>(partial)</em>' : ' <em>(+added)</em>');
    this.elLive.innerHTML =
      '<span class="cp-big">' + best.symbol + '</span>' + tag +
      '<span class="cp-played">' + names + '</span>' +
      (cands[1] ? '<span class="cp-dim"> · or ' + cands[1].symbol + '</span>' : '');
  }

  clearSelection () {
    this.selected = null;
    [...this.elList.querySelectorAll('.cp-item')].forEach(x => x.classList.remove('sel'));
  }
}
