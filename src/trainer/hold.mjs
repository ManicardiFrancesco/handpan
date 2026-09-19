// Holding a note is a bank, not a switch. Three zones decide what one frame does
// to it: inside the tolerance it fills at real time, outside it drains at a rate
// that grows with the distance, and far enough out — a different note, not this
// one — it empties. A millisecond of wobble costs a fraction of a millisecond of
// banked progress, so a brief slip is a setback rather than a restart.
export const DRIFT_FACTOR = 3;    // the drift band reaches this multiple of the tolerance
export const DRIFT_FLOOR = 50;    // ...but never closer in than a quarter tone
export const DRIFT_CEILING = 150; // ...and never past the accuracy outlier gate
export const DRAIN_NEAR = 0.5;    // drain per millisecond just outside the tolerance
export const DRAIN_FAR = 2;       // ...and at the outer edge of the drift band, where it drains faster than it fills
export const DRAIN_SILENT = 0.5;  // a breath costs the same as the gentlest drift
// A detection glitch has to persist this long to empty the bank. It outlasts the
// coaching line's own hysteresis on purpose, so you are always told you have gone
// wrong before the ring takes anything away from you.
export const OFF_GRACE_MS = 360;

// Where the drift band ends and "that is a different note" begins. Tight levels
// would otherwise call a semitone's worth of wobble a wrong note, so the floor
// keeps a quarter tone of room at every rung of the ladder.
export const driftEdge = tolerance =>
  Math.min(DRIFT_CEILING, Math.max(DRIFT_FLOOR, Math.max(0, tolerance) * DRIFT_FACTOR));

export function zoneOf(cents, tolerance) {
  if (!Number.isFinite(cents)) return 'silent';
  const distance = Math.abs(cents);
  if (distance <= tolerance) return 'good';
  return distance <= driftEdge(tolerance) ? 'drift' : 'off';
}

// Gentle at the edge of the tolerance, steep where the note stops being this
// note, so the drift band feels like one slope instead of a second cliff.
export function drainRate(cents, tolerance) {
  const edge = driftEdge(tolerance);
  const span = edge - tolerance;
  const share = span > 0 ? (Math.abs(cents) - tolerance) / span : 1;
  return DRAIN_NEAR + (DRAIN_FAR - DRAIN_NEAR) * Math.min(1, Math.max(0, share));
}

export class HoldMeter {
  constructor() { this.reset(); }
  reset() { this.held = 0; this.zone = 'silent'; this.offMs = 0; this.complete = false; }
  // elapsed is the real milliseconds this frame is worth; pass 0 to freeze the
  // bank while the reference note is still sounding. cents is null for silence.
  update({ elapsed = 0, cents = null, tolerance = 0, target = 0 } = {}) {
    const zone = zoneOf(cents, tolerance);
    const step = Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0;
    const before = this.held;
    if (zone === 'off') {
      // The grace is there so one glitchy frame of detection cannot undo a hold,
      // so it costs nothing at all. Once it runs out you are simply singing a
      // different note, and the bank empties in one go.
      this.offMs += step;
      if (this.offMs >= OFF_GRACE_MS) this.held = 0;
    } else {
      this.offMs = 0;
      if (zone === 'good') this.held = Math.min(target, this.held + step);
      else this.held = Math.max(0, this.held - step * (zone === 'silent' ? DRAIN_SILENT : drainRate(cents, tolerance)));
    }
    this.zone = zone;
    const reached = target > 0 && this.held >= target;
    const result = {
      zone, held: this.held,
      progress: target > 0 ? Math.min(1, this.held / target) : 0,
      completed: reached && !this.complete,
      emptied: before > 0 && this.held === 0,
      lost: before - this.held,
    };
    this.complete = reached;
    return result;
  }
}
