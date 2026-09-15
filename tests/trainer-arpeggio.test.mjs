import assert from 'node:assert/strict';
import { buildRound, phaseAt, stepIndexAt, laneWindow, laneOffset, stepMsFor, holdMsFor, pickPattern, pickStart, roundScore, PATTERNS, GAP_MS, TAIL_MS } from '../src/trainer/arpeggio.mjs';
import { LEVELS } from '../src/trainer/difficulty.mjs';

// D Kurd in the original register.
const midis = [50, 57, 58, 60, 62, 64, 65, 67, 69];
assert.ok(stepMsFor(0) > stepMsFor(LEVELS.length - 1), 'Easier levels give longer notes');
assert.equal(holdMsFor(3), Math.round(stepMsFor(3) * 0.4));
assert.equal(pickPattern(0), PATTERNS[0]);
assert.equal(pickPattern(PATTERNS.length + 1), PATTERNS[1], 'Patterns cycle');
assert.equal(pickStart(0, 9, 5), 0);
assert.equal(pickStart(1, 9, 5), 2, 'Each round starts further up the scale');
assert.equal(pickStart(9, 9, 5), 3, 'The start wraps inside the scale');
assert.ok(pickStart(7, 3, 5) === 0, 'A pattern wider than the scale still starts in range');

const round = buildRound({ midis, round: 0, level: 3 });
assert.deepEqual(round.steps.map(step => step.index), [0, 2, 4], 'Triad up on the first round');
assert.deepEqual(round.steps.map(step => step.midi), [50, 58, 62]);
assert.equal(round.stepMs, stepMsFor(3));
assert.equal(round.tolerance, LEVELS[3].tolerance);
assert.equal(round.listenMs, 3 * round.stepMs);
assert.equal(round.singAt, round.listenMs + GAP_MS);
assert.equal(round.endsAt, round.singAt + round.listenMs + TAIL_MS);
assert.deepEqual(round.steps.map(step => step.at), [0, round.stepMs, 2 * round.stepMs]);
assert.ok(buildRound({ midis: [50, 57], round: 5, level: 0 }).steps.every(step => step.midi <= 57),
  'A short layout never asks for a note it does not have');

assert.equal(phaseAt(round, 0).phase, 'listen');
assert.equal(phaseAt(round, round.listenMs - 1).phase, 'listen');
assert.equal(phaseAt(round, round.listenMs).phase, 'sing');
assert.equal(phaseAt(round, round.listenMs).at, -GAP_MS, 'The gap is the run-in before the first note');
assert.equal(phaseAt(round, round.singAt).at, 0, 'Singing starts as the first note reaches the line');
assert.equal(phaseAt(round, round.endsAt).phase, 'done');
assert.equal(stepIndexAt(round.steps, -100), -1, 'Nothing to sing during the run-in');
assert.equal(stepIndexAt(round.steps, 0), 0);
assert.equal(stepIndexAt(round.steps, round.stepMs - 1), 0);
assert.equal(stepIndexAt(round.steps, round.stepMs), 1);
assert.equal(stepIndexAt(round.steps, 3 * round.stepMs), -1, 'The phrase is over');

// The lane window frames the phrase with room above and below.
const window = laneWindow(round.steps);
assert.ok(window.span >= 700, 'A narrow phrase still gets a readable span');
assert.equal(window.center, (5000 + 6200) / 2, 'Centred between the lowest and highest note');
assert.ok(laneOffset(6200 + 170, window) <= 1 && laneOffset(5000 - 170, window) >= -1);
assert.equal(laneOffset(window.center, window), 0);
assert.equal(laneOffset(window.center + 99999, window), 1, 'Far above the window clamps to the top');
assert.equal(laneOffset(window.center - 99999, window), -1);
const wide = laneWindow([{ midi: 50 }, { midi: 74 }]);
assert.equal(wide.span, 2400 + 340);
assert.ok(laneOffset(7400, wide) > 0 && laneOffset(5000, wide) < 0, 'Higher notes sit higher in the lane');
assert.ok(laneOffset(7400, wide) < 1, 'The padding keeps the top note off the edge');

assert.deepEqual(roundScore(['hit', 'miss', 'hit']), { hits: 2, total: 3 });
assert.deepEqual(roundScore([]), { hits: 0, total: 0 });
console.log('Arpeggio checks passed: patterns, round timing, phases, step lookup and lane geometry.');
