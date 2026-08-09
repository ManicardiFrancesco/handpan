/* Web Audio wiring: worklet lifecycle, graph, and strike dispatch. */

import { buildInstrument, strikeAmplitudes } from '../model/instrument.js';

const WORKLET_URL = new URL('../dsp/handpan-processor.js', import.meta.url);

export class Engine {
  constructor () {
    this.ctx = null;
    this.node = null;
    this.inst = null;
    this.starting = null;
    this.started = false;
    this.onEnergy = null;
  }

  async start () {
    if (this.starting) return this.starting;
    this.starting = this._start();
    return this.starting;
  }

  async _start () {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) throw new Error('Web Audio is not available in this browser');
    this.ctx = new Ctx({ latencyHint: 'interactive' });
    if (!this.ctx.audioWorklet) throw new Error('AudioWorklet is not supported');

    await this.loadModule();

    this.node = new AudioWorkletNode(this.ctx, 'handpan', { outputChannelCount: [2] });
    this.node.port.onmessage = (e) => {
      if (e.data.type === 'energy' && this.onEnergy) this.onEnergy(e.data.e);
    };

    // graph: dry + convolution reverb -> master
    this.master = this.ctx.createGain();
    this.dry = this.ctx.createGain();
    this.wet = this.ctx.createGain();
    this.conv = this.ctx.createConvolver();
    this.conv.buffer = this.makeIR(2.9);
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 140;          // keep sub energy out of the reverb

    this.node.connect(this.dry).connect(this.master);
    this.node.connect(hp).connect(this.conv).connect(this.wet).connect(this.master);
    this.master.connect(this.ctx.destination);

    if (this.ctx.state === 'suspended') await this.ctx.resume();
    this.started = true;
  }

  /* A classic module fetch works when served over http(s). When the page is
   * opened straight from disk, module loading is blocked, so fall back to
   * inlining the source as a data: URL. (A blob: URL inherits a null origin
   * under file:// and Chromium then refuses it as a worklet module.) */
  async loadModule () {
    try {
      await this.ctx.audioWorklet.addModule(WORKLET_URL);
      return;
    } catch (err) {
      if (location.protocol !== 'file:') throw err;
    }
    const src = await (await fetch(WORKLET_URL)).text();
    await this.ctx.audioWorklet.addModule(
      'data:application/javascript;base64,' + btoa(unescape(encodeURIComponent(src))));
  }

  makeIR (dur) {
    const fs = this.ctx.sampleRate, n = Math.floor(fs * dur);
    const buf = this.ctx.createBuffer(2, n, fs);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < n; i++) {
        const t = i / fs;
        const env = Math.exp(-3.6 * t / dur) * Math.min(1, t / 0.012);
        lp += 0.42 * ((Math.random() * 2 - 1) - lp);     // darken the tail
        d[i] = lp * env;
      }
    }
    return buf;
  }

  /** Build a scale and push the resonator table to the DSP. */
  build (scale, opts) {
    this.inst = buildInstrument(scale, opts);
    const r = this.inst.resonators;
    if (this.node) {
      this.node.port.postMessage({
        type: 'setup',
        f: Float64Array.from(r.f),
        t60: Float64Array.from(r.t60),
        src: Int32Array.from(r.src),
        noteOf: Int32Array.from(r.noteOf),
        pL: Float32Array.from(r.f.map(() => 0.7)),
        pR: Float32Array.from(r.f.map(() => 0.7)),
        cd: Int32Array.from(r.cd),
        cs: Int32Array.from(r.cs),
        ck: Float32Array.from(r.ck),
        slots: this.inst.nNotes + 1,
        nNotes: this.inst.nNotes,
      });
    }
    return this.inst;
  }

  /** Per-note stereo placement, derived from the drawn layout. */
  setPans (notes) {
    if (!this.node || !this.inst) return;
    const idx = [], pL = [], pR = [];
    for (const nt of notes) {
      const p = Math.max(-0.7, Math.min(0.7, nt.pan));
      const a = (p + 1) * Math.PI / 4;
      // Bottom-shell notes radiate away from the listener: slightly quieter
      // and duller in the mix.
      const g = nt.bottom ? 0.78 : 1;
      for (const md of nt.modes) {
        idx.push(md.i);
        pL.push(Math.cos(a) * g);
        pR.push(Math.sin(a) * g);
      }
    }
    this.node.port.postMessage({
      type: 'pan',
      idx: Int32Array.from(idx),
      pL: Float32Array.from(pL),
      pR: Float32Array.from(pR),
    });
  }

  param (o) {
    if (this.node) this.node.port.postMessage(Object.assign({ type: 'param' }, o));
  }

  silence () {
    if (this.node) this.node.port.postMessage({ type: 'silence' });
  }

  /** Strike a tone field. `pos` 0 = dimple, 1 = shoulder. */
  strike (noteIdx, vel, pos, contact = 1) {
    if (!this.node || !this.inst) return;
    const inst = this.inst;
    const nt = inst.notes[noteIdx];
    if (!nt) return;
    const { idx, amp, gidx, gcent } = strikeAmplitudes(inst, noteIdx, vel, pos);
    const v = Math.max(0.02, Math.min(1, vel));
    // Contact time 8 ms (soft) -> 2 ms (hard); the filter time constant is
    // about a fifth of the visible contact duration.
    const sr = this.ctx.sampleRate;
    const ms = (8 - 6 * v) * contact;
    const len = Math.max(2, Math.round(ms * 0.001 * sr / 5));
    const ref = Math.round(0.0045 * sr / 5);
    this.node.port.postMessage({
      type: 'strike',
      idx: Int32Array.from(idx), amp: Float32Array.from(amp),
      gidx: Int32Array.from(gidx), gcent: Float32Array.from(gcent),
      slot: Int32Array.from([nt.slot, inst.GLOBAL_SLOT]),
      len: Int32Array.from([len, len * 3]),
      ref,
      tick: 0.05 * v * v / contact,
    });
    nt.flash = 1;
  }

  /** Bare-shell "tak": broadband tick plus the shell/cavity modes only. */
  tak (vel) {
    if (!this.node || !this.inst) return;
    const v = Math.max(0.05, Math.min(1, vel));
    const idx = [], amp = [];
    for (const g of this.inst.globals) { idx.push(g.i); amp.push(g.amp * v * 2.2); }
    const sr = this.ctx.sampleRate;
    this.node.port.postMessage({
      type: 'strike',
      idx: Int32Array.from(idx), amp: Float32Array.from(amp),
      slot: Int32Array.from([this.inst.GLOBAL_SLOT]),
      len: Int32Array.from([Math.max(2, Math.round(0.0015 * sr / 5))]),
      ref: Math.round(0.0045 * sr / 5),
      tick: 0.16 * v,
    });
  }
}
