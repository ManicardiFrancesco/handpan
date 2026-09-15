// One ladder for both knobs: an easier level widens the tolerance *and* shortens
// the hold, so "make it easier" moves the whole exercise, not one number.
export const LEVELS = [
  { name: 'Very gentle', tolerance: 40, hold: 1000 },
  { name: 'Gentle', tolerance: 30, hold: 1200 },
  { name: 'Relaxed', tolerance: 25, hold: 1500 },
  { name: 'Balanced', tolerance: 15, hold: 2000 },
  { name: 'Precise', tolerance: 8, hold: 2500 },
  { name: 'Exacting', tolerance: 5, hold: 3000 },
];
export const DEFAULT_LEVEL = 3;
export const SPEEDRUN_HOLD = 800;
export const clampLevel = level =>
  Math.min(LEVELS.length - 1, Math.max(0, Number.isFinite(+level) ? Math.round(+level) : DEFAULT_LEVEL));
// A speedrun keeps the level's tolerance but caps the hold: the clock is the challenge.
export const holdFor = (level, mode) =>
  mode === 'speedrun' ? Math.min(LEVELS[clampLevel(level)].hold, SPEEDRUN_HOLD) : LEVELS[clampLevel(level)].hold;
export const levelLabel = level => {
  const { name, tolerance, hold } = LEVELS[clampLevel(level)];
  return `${name} · ±${tolerance} cents · ${(hold / 1000).toFixed(1)} s hold`;
};

// Watches how the last few notes went and offers one nudge, quietly.
export const STUCK_MS = 25000, SLOW_MS = 18000, QUICK_MS = 6000, EASY_RATIO = 0.6;
export class StruggleWatch {
  constructor(cooldown = 45000) { this.cooldown = cooldown; this.reset(); }
  reset() { this.notes = []; this.quietUntil = 0; }
  quiet(now, ms = this.cooldown) { this.quietUntil = Math.max(this.quietUntil, now + ms); }
  // One entry per target note left behind, completed or not. durationMs counts
  // only time with a voice detected, so a paused tab never looks like a struggle.
  finish({ completed, durationMs, rms = null }) {
    this.notes.push({ completed, durationMs, rms });
    if (this.notes.length > 3) this.notes.shift();
  }
  suggest(now, { voicedMs = 0, tolerance, canEasier = true, canHarder = true }) {
    if (now < this.quietUntil) return null;
    if (canEasier && voicedMs >= STUCK_MS) return 'easier';
    if (this.notes.length < 3) return null;
    if (canEasier && this.notes.every(n => !n.completed || n.durationMs > SLOW_MS)) return 'easier';
    if (canHarder && this.notes.every(n =>
      n.completed && n.durationMs < QUICK_MS && n.rms !== null && n.rms <= tolerance * EASY_RATIO)) return 'harder';
    return null;
  }
}
