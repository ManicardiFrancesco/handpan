/* Application shell: wires the engine, the 3D view and the chord panel. */

import { Engine } from '../audio/engine.js';
import { SCALES, FAMILIES } from '../model/scales.js';
import { noteName, midiToFreq } from '../model/notes.js';
import { Renderer3D } from './renderer3d.js';
import { ChordPanel } from './chordpanel.js';

const HELD_WINDOW = 0.9;      // seconds a note counts as "held" for chord ID

class App {
  constructor () {
    this.engine = new Engine();
    this.seed = 7;
    this.damped = false;
    this.demoTimer = null;
    this.held = [];           // {note, t}
    this.highlight = new Set();
    this.el = {};
  }

  init () {
    const ids = ['view','scale','root','a4','a4v','force','forcev','contact','contactv',
      'pos','posv','sus','susv','coup','coupv','helm','helmv','wet','wetv','vol','volv',
      'damp','demo','reseed','status','gate','scaleNote','chords','notes','autorot',
      'strum','resetview'];
    ids.forEach(id => this.el[id] = document.getElementById(id));

    // scale picker, grouped by family
    const sel = this.el.scale;
    for (const fam of FAMILIES) {
      const g = document.createElement('optgroup');
      g.label = fam;
      SCALES.forEach((s, i) => {
        if (s.family !== fam) return;
        const o = new Option(s.name, String(i));
        g.appendChild(o);
      });
      sel.appendChild(g);
    }
    for (let m = 16; m <= 64; m++) this.el.root.add(new Option(noteName(m) + '  (' + midiToFreq(m).toFixed(1) + ' Hz)', String(m)));

    this.renderer = new Renderer3D(this.el.view);
    this.chordPanel = new ChordPanel(this.el.chords, {
      onHighlight: (idxs) => { this.highlight = new Set(idxs); },
      onPlay: (c) => this.strum(c),
    });

    this.bindControls();
    this.bindPointer();
    this.bindKeys();
    addEventListener('resize', () => this.resize());
    this.resize();

    this.engine.onEnergy = (e) => {
      const inst = this.engine.inst;
      if (!inst) return;
      for (let i = 0; i < inst.nNotes && i < e.length; i++) inst.notes[i].energy = e[i];
    };

    const boot = () => this.boot();
    addEventListener('pointerdown', boot, true);
    addEventListener('keydown', boot, true);

    this.rebuild();
    requestAnimationFrame((t) => this.frame(t));
  }

  async boot () {
    if (this.engine.starting) {
      if (this.engine.ctx && this.engine.ctx.state === 'suspended') this.engine.ctx.resume();
      return;
    }
    this.el.status.textContent = 'loading engine…';
    try {
      await this.engine.start();
    } catch (err) {
      this.el.status.textContent = 'audio unavailable';
      this.el.gate.querySelector('b').textContent = 'Audio unavailable';
      this.el.gate.querySelector('small').textContent = err.message;
      return;
    }
    this.el.gate.style.display = 'none';
    this.el.status.textContent = Math.round(this.engine.ctx.sampleRate / 1000) + ' kHz · ready';
    this.rebuild();
    this.pushBody();
    this.pushMix();
  }

  bindControls () {
    this.el.scale.onchange = () => {
      const s = SCALES[+this.el.scale.value];
      this.el.root.value = String(s.root);
      this.rebuild();
    };
    this.el.root.onchange = () => this.rebuild();
    this.el.a4.oninput = () => {
      this.el.a4v.textContent = this.el.a4.value + ' Hz';
      this.rebuild();
    };
    this.el.helm.oninput = () => {
      this.el.helmv.textContent = this.el.helm.value + ' Hz';
      this.rebuild();
    };
    this.el.reseed.onclick = () => {
      this.seed = (Math.random() * 1e6) | 0;
      this.rebuild();
    };
    const bind = (k, fn) => {
      this.el[k].oninput = () => {
        this.el[k + 'v'].textContent = (+this.el[k].value).toFixed(2);
        fn();
      };
      this.el[k].oninput();
    };
    bind('force', () => {});
    bind('contact', () => {});
    bind('pos', () => {});
    bind('sus', () => this.pushBody());
    bind('coup', () => this.pushBody());
    bind('wet', () => this.pushMix());
    bind('vol', () => this.pushMix());

    this.el.damp.onclick = () => this.setDamp(!this.damped);
    this.el.demo.onclick = () => this.toggleDemo();
    this.el.autorot.onclick = () => {
      this.autorot = !this.autorot;
      this.el.autorot.classList.toggle('on', this.autorot);
    };
    this.el.resetview.onclick = () => {
      this.renderer.yaw = -0.35;
      this.renderer.pitch = -0.62;
      this.renderer.dist = 3.05;
    };
    this.el.strum.onclick = () => {
      if (this.chordPanel.selected) this.strum(this.chordPanel.selected);
    };
  }

  rebuild () {
    const s = SCALES[+this.el.scale.value];
    const inst = this.engine.build(s, {
      a4: +this.el.a4.value,
      rootMidi: +this.el.root.value,
      helmF: +this.el.helm.value,
      seed: this.seed,
    });
    this.renderer.layout(inst);
    this.engine.setPans(inst.notes);
    this.chordPanel.update(inst);
    this.highlight.clear();
    this.held = [];
    this.el.scaleNote.textContent = s.note || '';
    this.renderNoteList(inst);
  }

  renderNoteList (inst) {
    this.el.notes.innerHTML = inst.notes.map((n, i) =>
      '<div class="nl' + (n.bottom ? ' bot' : '') + '">' +
      '<span class="k">' + (i === 0 ? 'ding' : (n.bottom ? 'btm' : '#' + i)) + '</span>' +
      '<b>' + n.name + '</b><i>' + n.f0.toFixed(1) + ' Hz</i></div>').join('');
  }

  pushBody () {
    this.engine.param({
      sustain: (this.damped ? 0.12 : 1) * +this.el.sus.value,
      // At the 0.42 default this puts an exactly coincident neighbour (the
      // strongest possible link) at about -25 dB of the struck note, and a
      // typical link near -30 dB: the measured range for a real shell.
      kappa: 0.0076 * +this.el.coup.value,
    });
  }

  pushMix () {
    if (!this.engine.ctx) return;
    const w = +this.el.wet.value;
    this.engine.wet.gain.value = w * 0.9;
    this.engine.dry.gain.value = 1 - w * 0.35;
    this.engine.master.gain.value = Math.pow(+this.el.vol.value, 1.6) * 1.6;
  }

  setDamp (on) {
    this.damped = on;
    this.el.damp.classList.toggle('on', on);
    this.pushBody();
  }

  resize () {
    const st = this.el.view.parentElement.getBoundingClientRect();
    const w = Math.max(240, st.width);
    const h = Math.max(240, st.height);
    this.renderer.resize(w, h, Math.min(2, devicePixelRatio || 1));
  }

  /* ------------------------------------------------------------- input -- */
  velFrom (ev) {
    let v = +this.el.force.value;
    if (ev && ev.pointerType && ev.pointerType !== 'mouse' && ev.pressure > 0.01)
      v = 0.18 + 0.82 * ev.pressure;
    if (ev && ev.shiftKey) v *= 0.45;
    if (ev && ev.altKey) v = Math.min(1, v * 1.45 + 0.2);
    return v;
  }

  bindPointer () {
    const cv = this.el.view;
    let drag = null;
    cv.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      cv.setPointerCapture(ev.pointerId);
      const b = cv.getBoundingClientRect();
      const x = ev.clientX - b.left, y = ev.clientY - b.top;
      const hit = this.renderer.pick(x, y);
      if (hit && ev.button === 0) {
        this.hitNote(hit.nt, this.velFrom(ev), hit.pos);
        drag = { mode: 'none' };
        return;
      }
      drag = { mode: 'orbit', x: ev.clientX, y: ev.clientY, moved: 0 };
    });
    cv.addEventListener('pointermove', (ev) => {
      if (!drag || drag.mode !== 'orbit') return;
      const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
      drag.x = ev.clientX; drag.y = ev.clientY;
      drag.moved += Math.abs(dx) + Math.abs(dy);
      this.renderer.rotate(dx * 0.008, dy * 0.006);
    });
    cv.addEventListener('pointerup', (ev) => {
      // A click on bare shell that did not turn into an orbit is a "tak".
      if (drag && drag.mode === 'orbit' && drag.moved < 5) {
        const b = cv.getBoundingClientRect();
        if (this.renderer.onShell(ev.clientX - b.left, ev.clientY - b.top))
          this.engine.tak(this.velFrom(ev) * 0.8);
      }
      drag = null;
    });
    cv.addEventListener('pointercancel', () => { drag = null; });
    cv.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      this.renderer.zoom(ev.deltaY > 0 ? 1.08 : 0.93);
    }, { passive: false });
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** Remember a note as sounding, so the panel can identify what is held. */
  pushHeld (nt) {
    const now = this.engine.ctx ? this.engine.ctx.currentTime : 0;
    this.held = this.held.filter(h => h.note.ni !== nt.ni);
    this.held.push({ note: nt, t: now });
    this.heldDirty = true;
  }

  hitNote (nt, vel, pos) {
    this.engine.strike(nt.ni, vel, pos, +this.el.contact.value);
    this.pushHeld(nt);
    this.chordPanel.clearSelection();
  }

  bindKeys () {
    const ROW1 = ' asdfghjkl;';
    const ROW2 = 'qwertyuiop';
    const held = new Set();
    addEventListener('keydown', (ev) => {
      const inst = this.engine.inst;
      if (!inst || ev.metaKey || ev.ctrlKey) return;
      const k = ev.key.length === 1 ? ev.key.toLowerCase() : ev.key;
      if (k === 'm') { this.setDamp(!this.damped); return; }
      if (k === 't') { this.engine.tak(this.velFrom(ev)); return; }
      if (k === 'r') { this.el.resetview.click(); return; }
      let i = ROW1.indexOf(k);
      if (i < 0) {
        const j = ROW2.indexOf(k);
        if (j >= 0) i = ROW1.length + j;
      }
      if (i < 0 || i >= inst.nNotes) return;
      ev.preventDefault();
      if (held.has(k)) return;
      held.add(k);
      this.hitNote(inst.notes[i], this.velFrom(ev), +this.el.pos.value);
    });
    addEventListener('keyup', (ev) =>
      held.delete(ev.key.length === 1 ? ev.key.toLowerCase() : ev.key));
  }

  /** Play a chord as a quick ascending strum. */
  strum (chord) {
    const inst = this.engine.inst;
    if (!inst || !this.engine.node) return;
    const v = +this.el.force.value;
    chord.notes.forEach((n, k) => {
      setTimeout(() => {
        this.engine.strike(n.index, v * (0.82 + 0.18 * Math.random()),
                           +this.el.pos.value, +this.el.contact.value);
        const nt = inst.notes[n.index];
        if (nt) this.pushHeld(nt);
      }, k * 62);
    });
  }

  toggleDemo () {
    if (this.demoTimer) {
      clearTimeout(this.demoTimer);
      this.demoTimer = null;
      this.el.demo.classList.remove('on');
      return;
    }
    this.el.demo.classList.add('on');
    let k = 0;
    const step = () => {
      const inst = this.engine.inst;
      if (!inst) return;
      const n = inst.nNotes;
      const pat = [0, 3, 5, 2, 6, 1, 4, 7, 0, 5, 3, 8];
      const i = pat[k % pat.length] % n;
      const accent = (k % 4 === 0);
      this.hitNote(inst.notes[i], accent ? 0.86 : 0.34 + Math.random() * 0.28,
                   Math.random() * 0.35);
      k++;
      this.demoTimer = setTimeout(step, 300 + Math.random() * 150 + (k % 4 === 0 ? 110 : 0));
    };
    step();
  }

  /* -------------------------------------------------------------- frame -- */
  frame (ts) {
    const inst = this.engine.inst;
    if (inst) {
      if (this.autorot) this.renderer.yaw += 0.0035;
      for (const nt of inst.notes) {
        nt.flash *= 0.90;
        nt.energy *= 0.86;
        nt.highlight = this.highlight.has(nt.ni);
      }
      // expire held notes for chord identification
      const now = this.engine.ctx ? this.engine.ctx.currentTime : 0;
      const before = this.held.length;
      this.held = this.held.filter(h => now - h.t < HELD_WINDOW);
      if (this.held.length !== before || this.heldDirty) {
        this.chordPanel.setHeld(this.held.map(h => h.note));
        this.heldDirty = false;
      }
      this.renderer.draw({ font: getComputedStyle(document.body).fontFamily, highlight: this.highlight });
    }
    requestAnimationFrame((t) => this.frame(t));
  }
}

const app = new App();
if (document.readyState === 'loading')
  document.addEventListener('DOMContentLoaded', () => app.init());
else app.init();
window.__app = app;      // handy for testing in the console
