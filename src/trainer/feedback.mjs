// Stabilize guidance only: accuracy and exercise completion use raw pitch.
// LEAVE_TUNED_MS is the slowest the coaching line ever is to admit you have
// drifted, so the hold bank's own patience is measured against it.
export const IDLE_DELAY_MS = 500, LEAVE_TUNED_MS = 350, SETTLE_MS = 220, TUNED_MARGIN = 6;
export class StableFeedback {
  constructor() { this.reset(); }
  reset() { this.state = 'idle'; this.pending = null; this.since = 0; }
  update(now, cents, tolerance) {
    const boundary = tolerance + (this.state === 'tuned' ? TUNED_MARGIN : 0);
    const next = cents === null ? 'idle' : Math.abs(cents) <= boundary ? 'tuned' : cents > 0 ? 'high' : 'low';
    if (next === this.state) { this.pending = null; return this.state; }
    if (next !== this.pending) { this.pending = next; this.since = now; }
    const delay = next === 'idle' ? IDLE_DELAY_MS : this.state === 'tuned' ? LEAVE_TUNED_MS : SETTLE_MS;
    if (now - this.since >= delay) { this.state = next; this.pending = null; }
    return this.state;
  }
}
