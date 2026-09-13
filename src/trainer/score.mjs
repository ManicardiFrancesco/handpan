export class PitchScore {
  constructor() { this.samples = []; }
  reset() { this.samples = []; }
  update(now, cents = null) {
    this.samples = this.samples.filter(s => s.time > now - 2000);
    if (Number.isFinite(cents)) this.samples.push({time: now, cents});
    if (!this.samples.length) return null;
    const n = this.samples.length;
    const mean = this.samples.reduce((sum, s) => sum + s.cents, 0) / n;
    const rms = Math.sqrt(this.samples.reduce((sum, s) => sum + s.cents ** 2, 0) / n);
    const deviation = Math.sqrt(this.samples.reduce((sum, s) => sum + (s.cents - mean) ** 2, 0) / n);
    return { rms, deviation, score: Math.round(100 * Math.exp(-rms / 50)), seconds: Math.min(2, (now - this.samples[0].time) / 1000) };
  }
}
