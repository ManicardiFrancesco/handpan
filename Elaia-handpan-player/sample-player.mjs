import { SAMPLE_BANKS } from './samples.mjs';
import { fieldGeometry } from './geometry.mjs';

const midiOf = note => {
  const [, letter, accidental, octave] = /^([A-G])([#b]?)(-?\d+)$/.exec(note);
  return (+octave + 1) * 12 + { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[letter]
    + (accidental === '#' ? 1 : accidental === 'b' ? -1 : 0);
};
const catalogs = new Map();

export function sampleFor(layout, field) {
  const key = Object.hasOwn(SAMPLE_BANKS, layout.arrangement) ? layout.arrangement : 'd-aegean-18';
  if (!catalogs.has(key)) catalogs.set(key, Object.entries(SAMPLE_BANKS[key])
    .map(([note, entry]) => ({ ...entry, note, midi: midiOf(note) })));
  const bank = catalogs.get(key), original = fieldGeometry(field.geometry);
  const originalMidi = original && midiOf(original.note);
  const wanted = original && field.midi === originalMidi + layout.transpose ? originalMidi : field.midi;
  const entry = bank.reduce((best, entry) => Math.abs(entry.midi - wanted) < Math.abs(best.midi - wanted) ? entry : best);
  return { ...entry, rate: 2 ** ((field.midi - entry.midi) / 12) * layout.a4 / 440 };
}

export class SamplePlayer {
  constructor(engine, onStatus = () => {}) {
    this.engine = engine; this.onStatus = onStatus;
    this.cache = new Map(); this.pending = new Map(); this.failed = new Set();
    this.voices = new Set(); this.queue = []; this.loading = 0;
    this.bytes = 0; this.budget = 32 * 1024 * 1024;
    this.entries = [];
  }

  connect() {
    if (this.bus) return;
    const ctx = this.engine.ctx;
    this.bus = ctx.createGain(); this.bus.gain.value = 0.65;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -7; limiter.knee.value = 9; limiter.ratio.value = 5;
    limiter.attack.value = 0.003; limiter.release.value = 0.17;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 140;
    this.bus.connect(limiter); limiter.connect(this.engine.dry);
    limiter.connect(hp); hp.connect(this.engine.conv);
  }

  configure(layout) {
    this.layout = layout; this.damp();
    this.entries = layout.sound === 'ayasa' ? layout.fields.map(f => sampleFor(layout, f)) : [];
    const wanted = new Map(this.entries.map(e => [e.url, e]));
    this.queue = [...wanted.values()].filter(e => !this.cache.has(e.url) && !this.pending.has(e.url) && !this.failed.has(e.url));
    this.pump(); this.status();
  }

  status() {
    const urls = new Set(this.entries.map(e => e.url));
    this.onStatus({ total: urls.size, ready: [...urls].filter(url => this.cache.has(url)).length,
      failed: [...urls].filter(url => this.failed.has(url)).length });
  }

  pump() {
    while (this.loading < 3 && this.queue.length) {
      const entry = this.queue.shift();
      if (!this.cache.has(entry.url) && !this.pending.has(entry.url)) this.load(entry);
    }
  }

  load(entry) {
    if (this.pending.has(entry.url)) return this.pending.get(entry.url);
    this.loading++;
    const task = (async () => {
      try {
        const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 12000);
        let data;
        try {
          const response = await fetch(entry.url, { credentials: 'omit', signal: controller.signal });
          if (!response.ok) throw new Error('Preview unavailable');
          data = await response.arrayBuffer();
        } finally { clearTimeout(timer); }
        const buffer = await this.engine.ctx.decodeAudioData(data);
        const bytes = buffer.length * buffer.numberOfChannels * 4;
        if (bytes <= this.budget) {
          while (this.bytes + bytes > this.budget && this.cache.size) {
            const [key, old] = this.cache.entries().next().value;
            this.cache.delete(key); this.bytes -= old.bytes;
          }
          this.cache.set(entry.url, { buffer, bytes }); this.bytes += bytes;
        }
      } catch { this.failed.add(entry.url); }
      finally {
        this.pending.delete(entry.url); this.loading--; this.pump(); this.status();
      }
    })();
    this.pending.set(entry.url, task);
    return task;
  }

  strike(field, velocity) {
    if (this.layout.sound !== 'ayasa') return false;
    const entry = sampleFor(this.layout, field), cached = this.cache.get(entry.url);
    if (!cached) {
      if (!this.failed.has(entry.url) && !this.pending.has(entry.url)) {
        this.queue = [entry, ...this.queue.filter(e => e.url !== entry.url)]; this.pump();
      }
      return false;
    }
    // Refresh LRU order without retaining a second decoded copy.
    this.cache.delete(entry.url); this.cache.set(entry.url, cached);
    this.connect();
    const ctx = this.engine.ctx, source = ctx.createBufferSource(), gain = ctx.createGain(), pan = ctx.createStereoPanner();
    source.buffer = cached.buffer; source.playbackRate.value = entry.rate;
    gain.gain.value = Math.max(0.02, Math.min(1, velocity)) ** 1.15 * (field.side === 'bottom' ? 0.85 : 1);
    pan.pan.value = Math.max(-0.7, Math.min(0.7, field.x * 0.7));
    source.connect(gain); gain.connect(pan); pan.connect(this.bus);
    const voice = { source, gain, pan, id: field.id, rate: entry.rate };
    this.voices.add(voice);
    source.onended = () => {
      this.voices.delete(voice); source.disconnect(); gain.disconnect(); pan.disconnect();
    };
    source.start(0, Math.min(entry.offset, source.buffer.duration - 0.001));
    if (this.voices.size > 32) this.stop(this.voices.values().next().value);
    return true;
  }

  stop(voice) {
    this.voices.delete(voice);
    const now = this.engine.ctx.currentTime;
    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.setTargetAtTime(0, now, 0.008);
    try { voice.source.stop(now + 0.04); } catch {}
  }

  damp() { for (const voice of this.voices) this.stop(voice); }

  setPans(layout) {
    this.layout = layout;
    for (const voice of this.voices) {
      const field = layout.fields.find(f => f.id === voice.id);
      if (field) voice.pan.pan.setTargetAtTime(Math.max(-0.7, Math.min(0.7, field.x * 0.7)),
        this.engine.ctx.currentTime, 0.02);
    }
  }
}
