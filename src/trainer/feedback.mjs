// Stabilize guidance only: accuracy and exercise completion use raw pitch.
export class StableFeedback {
  constructor() { this.reset(); }
  reset() { this.state = 'idle'; this.pending = null; this.since = 0; }
  update(now, cents, tolerance) {
    const boundary = tolerance + (this.state === 'tuned' ? 6 : 0);
    const next = cents === null ? 'idle' : Math.abs(cents) <= boundary ? 'tuned' : cents > 0 ? 'high' : 'low';
    if (next === this.state) { this.pending = null; return this.state; }
    if (next !== this.pending) { this.pending = next; this.since = now; }
    const delay = next === 'idle' ? 500 : this.state === 'tuned' ? 350 : 220;
    if (now - this.since >= delay) { this.state = next; this.pending = null; }
    return this.state;
  }
}
