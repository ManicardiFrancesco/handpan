import { Engine } from '../src/audio/engine.js';
import { audioLayout } from './model.mjs';
import { SamplePlayer } from './sample-player.mjs';
import { ShellTap } from './shell-tap.mjs';

export class ElaiaAudio {
  constructor() {
    this.engine = new Engine();
    this.layout = null; this.indices = new Map();
    this.volume = 0.7; this.space = 'room';
    this.sampleStatus = { total: 0, ready: 0, failed: 0 };
    this.samples = new SamplePlayer(this.engine, status => {
      this.sampleStatus = status; this.onStatus?.(status);
    });
  }
  get started() { return this.engine.started; }
  async start() {
    if (!this.engine.started) {
      if (!this.starting) this.starting = this.initialize().finally(() => { this.starting = null; });
      await this.starting;
    }
    if (this.engine.ctx.state === 'suspended') await this.engine.ctx.resume();
  }
  async initialize() {
    try {
      await this.engine.start();
    } catch (error) {
      // Engine caches its first startup promise; allow a gesture to retry.
      this.engine.starting = null;
      if (this.engine.ctx) await this.engine.ctx.close().catch(() => {});
      this.engine = new Engine();
      this.samples.engine = this.engine;
      throw error;
    }
    this.shellTap = new ShellTap(this.engine);
    this.build(this.layout);
    this.mix();
  }
  build(layout) {
    this.layout = layout;
    if (!layout) return;
    const { fields, scale } = audioLayout(layout);
    this.indices = new Map(fields.map((f, i) => [f.id, i]));
    this.samples.configure(layout);
    if (!this.started) return;
    if (!fields.length) { this.engine.silence(); this.engine.inst = null; return; }
    const instrument = this.engine.build(scale, { a4: layout.a4, idealPartials: true, seed: 19 });
    instrument.notes.forEach((note, i) => { note.pan = fields[i].x * 0.7; });
    this.engine.setPans(instrument.notes);
    this.engine.param({ sustain: 1, kappa: 0.0032 });
  }
  setPans(layout) {
    this.layout = layout;
    this.samples?.setPans(layout);
    if (!this.started) return;
    if (!this.engine.inst) return;
    this.engine.inst.notes.forEach(n => {
      const f = layout.fields.find(f => this.indices.get(f.id) === n.ni);
      n.pan = f ? f.x * 0.7 : 0;
    });
    this.engine.setPans(this.engine.inst.notes);
  }
  mix() {
    if (!this.started) return;
    const wet = { dry: 0, room: 0.24, hall: 0.52 }[this.space];
    const now = this.engine.ctx.currentTime;
    this.engine.wet.gain.setTargetAtTime(wet * 0.9, now, 0.02);
    this.engine.dry.gain.setTargetAtTime(1 - wet * 0.35, now, 0.02);
    this.engine.master.gain.setTargetAtTime(this.volume ** 1.6 * 1.6, now, 0.02);
  }
  strike(id, velocity = 0.64, position = 0.14) {
    const field = this.layout.fields.find(f => f.id === id);
    if (!field || field.midi === null) return;
    if (!this.samples?.strike(field, velocity)) this.engine.strike(this.indices.get(id), velocity, position);
  }
  async prepare(id) {
    const field = this.layout.fields.find(f => f.id === id);
    if (field) await this.samples.ready(field);
  }
  tak(velocity = 0.72, x = 0, side = 'top') { this.shellTap?.strike(velocity, x, side); }
  damp() { this.engine.silence(); this.samples?.damp(); this.shellTap?.damp(); }
}
