/** A short finger slap: filtered contact noise, a low body, and a crisp fingertip. */
export class ShellTap {
  constructor(engine) {
    this.engine = engine;
    this.voices = new Set();
    const ctx = engine.ctx;
    this.noise = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.18), ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.reverbFilter = ctx.createBiquadFilter();
    this.reverbFilter.type = 'highpass'; this.reverbFilter.frequency.value = 180;
    this.reverbFilter.connect(engine.conv);
  }

  strike(velocity = 0.72, x = 0, side = 'top') {
    const ctx = this.engine.ctx, now = ctx.currentTime;
    const v = Math.max(0.12, Math.min(1, velocity));
    const out = ctx.createGain(), pan = ctx.createStereoPanner();
    out.gain.value = v ** 1.3 * (side === 'bottom' ? 0.42 : 0.5);
    pan.pan.value = Math.max(-0.65, Math.min(0.65, x * 0.65));
    out.connect(pan); pan.connect(this.engine.dry); pan.connect(this.reverbFilter);
    const sources = [], nodes = [out, pan];
    const envelope = (source, filter, level, seconds) => {
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(level, now + 0.001);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + seconds);
      source.connect(filter || gain);
      if (filter) { filter.connect(gain); nodes.push(filter); }
      gain.connect(out); nodes.push(source, gain); sources.push(source);
      source.start(now); source.stop(now + seconds + 0.012);
    };
    const contact = ctx.createBufferSource(), band = ctx.createBiquadFilter();
    contact.buffer = this.noise;
    band.type = 'bandpass'; band.frequency.value = 1350 + v * 1450; band.Q.value = 0.8;
    envelope(contact, band, 0.95, 0.095);
    const body = ctx.createOscillator();
    body.type = 'triangle';
    body.frequency.setValueAtTime(side === 'bottom' ? 168 : 195, now);
    body.frequency.exponentialRampToValueAtTime(side === 'bottom' ? 90 : 105, now + 0.08);
    envelope(body, null, 0.8, 0.13);
    const fingertip = ctx.createBufferSource(), highpass = ctx.createBiquadFilter();
    fingertip.buffer = this.noise;
    highpass.type = 'highpass'; highpass.frequency.value = 4800;
    envelope(fingertip, highpass, 0.25 * v, 0.035);
    const voice = { out, sources, nodes };
    this.voices.add(voice);
    let ended = 0;
    for (const source of sources) source.onended = () => {
      if (++ended !== sources.length) return;
      this.voices.delete(voice);
      for (const node of nodes) node.disconnect();
    };
    if (this.voices.size > 12) this.stop(this.voices.values().next().value);
  }

  stop(voice) {
    this.voices.delete(voice);
    const now = this.engine.ctx.currentTime;
    voice.out.gain.cancelScheduledValues(now);
    voice.out.gain.setTargetAtTime(0, now, 0.005);
    for (const source of voice.sources) {
      try { source.stop(now + 0.025); } catch {}
    }
  }

  damp() { for (const voice of this.voices) this.stop(voice); }
}
