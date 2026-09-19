import assert from 'node:assert/strict';
import { HoldMeter, zoneOf, drainRate, driftEdge, DRAIN_NEAR, DRAIN_FAR, DRAIN_SILENT, DRIFT_FLOOR, DRIFT_CEILING, OFF_GRACE_MS } from '../src/trainer/hold.mjs';
import { LEVELS } from '../src/trainer/difficulty.mjs';
import { LEAVE_TUNED_MS } from '../src/trainer/feedback.mjs';

// The coaching line is the slowest thing on screen to admit a drift, so nothing
// is ever taken away before you have been told about it.
assert.ok(OFF_GRACE_MS >= LEAVE_TUNED_MS, `The bank waits at least as long as the guidance (${OFF_GRACE_MS} vs ${LEAVE_TUNED_MS})`);

// ---- The three zones ----
assert.equal(zoneOf(0, 15), 'good');
assert.equal(zoneOf(-15, 15), 'good', 'The tolerance is inclusive on both sides');
assert.equal(zoneOf(16, 15), 'drift');
assert.equal(zoneOf(-49, 15), 'drift');
assert.equal(zoneOf(51, 15), 'off', 'Past the drift edge is a different note');
assert.equal(zoneOf(null, 15), 'silent');
assert.equal(zoneOf(NaN, 15), 'silent');

// Every rung keeps real room between "in tune" and "wrong note", and never
// stretches past the 150-cent gate the accuracy history discards.
LEVELS.forEach(level => {
  const edge = driftEdge(level.tolerance);
  assert.ok(edge > level.tolerance, `${level.name} has a drift band`);
  assert.ok(edge >= DRIFT_FLOOR && edge <= DRIFT_CEILING, `${level.name} drift edge ${edge} is sane`);
  assert.equal(zoneOf(level.tolerance + 1, level.tolerance), 'drift', `${level.name} forgives one cent over`);
});
assert.equal(driftEdge(5), DRIFT_FLOOR, 'The tightest level still gets a quarter tone of drift');
assert.equal(driftEdge(40), 120, 'A wide tolerance scales its drift band with it');
assert.equal(driftEdge(70), DRIFT_CEILING, 'The band stops at the outlier gate');

// ---- The drain slope ----
assert.equal(drainRate(15, 15), DRAIN_NEAR, 'Just outside the tolerance barely costs anything');
assert.equal(drainRate(50, 15), DRAIN_FAR, 'At the far edge it drains twice as fast as it fills');
assert.ok(drainRate(30, 15) > DRAIN_NEAR && drainRate(30, 15) < DRAIN_FAR, 'The slope is continuous between them');
assert.equal(drainRate(200, 15), DRAIN_FAR, 'Beyond the band the rate is clamped, not extrapolated');

const meter = new HoldMeter();
const sing = (cents, ms, tolerance = 15, target = 2000) => meter.update({ elapsed: ms, cents, tolerance, target });

// ---- Good: progress accrues at real time, and stops at the target ----
assert.equal(sing(0, 500).held, 500);
assert.equal(sing(10, 500).progress, 0.5, 'Anywhere inside the tolerance fills at the same rate');
let result = sing(0, 1200);
assert.equal(result.held, 2000, 'The bank stops at the hold target');
assert.equal(result.completed, true);
assert.equal(sing(0, 500).completed, false, 'Completion fires once, not every frame after');

// ---- Drift: a slip is a setback, not a restart ----
meter.reset();
assert.equal(meter.held, 0);
sing(0, 1000);
assert.ok(Math.abs(sing(16, 100).held - 946) < 1, 'A tenth of a second one cent off costs about 54 ms');
assert.ok(sing(16, 60).zone === 'drift');
meter.reset(); sing(0, 1000);
assert.equal(sing(50, 100).held, 800, 'Drifting to the far edge costs double');
// The original behaviour: one frame outside the tolerance wiped the whole hold.
// A 60 ms slip now keeps better than 97% of a full Balanced bank.
meter.reset(); sing(0, 2000);
assert.ok(sing(20, 60).held / 2000 > 0.97, 'A single frame off pitch is survivable');

// ---- Off: emptied, but only once the glitch persists ----
meter.reset(); sing(0, 1500);
result = sing(400, 60);
assert.equal(result.zone, 'off');
assert.equal(result.held, 1500, 'One glitchy frame of detection costs nothing at all');
assert.equal(result.emptied, false, 'An octave misdetection does not reset the attempt');
assert.equal(sing(0, 60).zone, 'good');
assert.equal(meter.offMs, 0, 'Coming back in tune forgets the glitch');
meter.reset(); sing(0, 1500);
let off = 0;
while (off < OFF_GRACE_MS) { off += 60; result = sing(400, 60); }
assert.equal(result.held, 0, 'A sustained wrong note empties the bank');
assert.equal(result.emptied, true);
assert.equal(result.lost, 1500, 'The whole bank is reported lost, so the ring can say so');
assert.equal(result.progress, 0);
assert.equal(sing(400, 600).emptied, false, 'Staying on the wrong note has nothing left to empty');

// ---- Silence: a breath drains gently instead of resetting ----
meter.reset(); sing(0, 1000);
result = sing(null, 400);
assert.equal(result.zone, 'silent');
assert.equal(result.held, 1000 - 400 * DRAIN_SILENT, 'Breathing costs the gentlest drift rate');
assert.equal(sing(null, 100000).held, 0, 'A long silence still ends at zero');
assert.equal(meter.update({ elapsed: 500, cents: null, tolerance: 15, target: 2000 }).held, 0, 'The bank never goes negative');

// ---- Frozen frames ----
meter.reset(); sing(0, 800);
assert.equal(sing(0, 0).held, 800, 'A zero-length frame changes nothing');
assert.equal(sing(999, 0).held, 800, 'Neither does an off-pitch one while the bank is frozen');
assert.equal(meter.update({ cents: 0, tolerance: 15, target: 2000 }).held, 800, 'elapsed defaults to frozen');
assert.equal(sing(0, NaN).held, 800, 'A bad frame time is ignored, not propagated');
assert.equal(sing(0, -500).held, 800, 'So is a clock that went backwards');

// ---- A whole wobbly attempt still lands ----
meter.reset();
const wobble = [[0, 300], [22, 120], [0, 400], [-18, 60], [3, 500], [30, 120], [-2, 1100]];
const wobbleMs = wobble.reduce((sum, [, ms]) => sum + ms, 0);
wobble.forEach(([cents, ms]) => { result = sing(cents, ms); });
assert.equal(result.completed, true, 'Ordinary human wobble reaches a 2 s hold');
assert.ok(wobbleMs < 2700, `It took ${wobbleMs} ms of singing, not a fresh start each slip`);
console.log('Hold checks passed: zone boundaries, drain slope, glitch grace, silence decay and a wobbly hold landing.');
