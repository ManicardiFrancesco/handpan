import { LEVELS, DEFAULT_LEVEL, clampLevel } from './difficulty.mjs';
// Arpeggio rounds: the handpan plays a short phrase, then the phrase scrolls at
// you and you sing it back. One round is listen → gap → sing → tail.
export const PATTERNS = [
  { name: 'Triad up', degrees: [0, 2, 4] },
  { name: 'Triad up and back', degrees: [0, 2, 4, 2] },
  { name: 'Neighbours', degrees: [0, 1, 0, 2] },
  { name: 'Wave', degrees: [0, 2, 1, 3] },
  { name: 'Ladder', degrees: [0, 1, 2, 3] },
  { name: 'Open fourths', degrees: [0, 3, 1, 4] },
];
export const GAP_MS = 1100;
export const TAIL_MS = 700;
export const LOOKAHEAD_MS = 3000;
export const HIT_SHARE = 0.4;
// Easier levels give you longer notes as well as a wider target.
export const stepMsFor = level => 2000 - clampLevel(level) * 220;
export const holdMsFor = level => Math.round(stepMsFor(level) * HIT_SHARE);
export const pickPattern = round => PATTERNS[((round % PATTERNS.length) + PATTERNS.length) % PATTERNS.length];
// Walk the starting degree up the scale so rounds do not repeat the same notes.
export const pickStart = (round, count, span) => {
  const room = Math.max(1, count - span + 1);
  return (Math.max(0, round) * 2) % room;
};
export function laneWindow(steps, { pad = 170, minSpan = 700 } = {}) {
  const cents = steps.map(step => step.midi * 100);
  const low = Math.min(...cents) - pad, high = Math.max(...cents) + pad;
  const center = (low + high) / 2;
  return { center, span: Math.max(minSpan, high - low) };
}
export function buildRound({ midis, round = 0, level = DEFAULT_LEVEL }) {
  const pattern = pickPattern(round);
  const span = Math.max(...pattern.degrees) + 1;
  const start = pickStart(round, midis.length, span);
  const stepMs = stepMsFor(level);
  const steps = pattern.degrees.map((degree, i) => {
    const index = Math.min(midis.length - 1, start + degree);
    return { index, midi: midis[index], at: i * stepMs, duration: stepMs };
  });
  const listenMs = steps.length * stepMs;
  const singAt = listenMs + GAP_MS;
  return {
    round, pattern: pattern.name, steps, stepMs, listenMs, singAt,
    endsAt: singAt + listenMs + TAIL_MS, hold: holdMsFor(level),
    tolerance: LEVELS[clampLevel(level)].tolerance, window: laneWindow(steps),
  };
}
// Negative time inside the sing phase is the run-in: notes are still off to the right.
export function phaseAt(round, elapsed) {
  if (elapsed < round.listenMs) return { phase: 'listen', at: elapsed };
  if (elapsed >= round.endsAt) return { phase: 'done', at: elapsed - round.singAt };
  return { phase: 'sing', at: elapsed - round.singAt };
}
export const stepIndexAt = (steps, at) => steps.findIndex(step => at >= step.at && at < step.at + step.duration);
// Where a pitch sits in the lane: -1 at the bottom edge, +1 at the top.
export const laneOffset = (cents, window) =>
  Math.max(-1, Math.min(1, (cents - window.center) / (window.span / 2)));
export const roundScore = results => ({
  hits: results.filter(result => result === 'hit').length, total: results.length,
});
