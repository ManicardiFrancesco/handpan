import assert from 'node:assert/strict';
import { LEVELS, DEFAULT_LEVEL, clampLevel, holdFor, levelLabel, StruggleWatch, STUCK_MS, SLOW_MS, QUICK_MS } from '../src/trainer/difficulty.mjs';

// The ladder only ever moves in one direction: easier means looser and shorter.
LEVELS.forEach((level, i) => {
  if (!i) return;
  assert.ok(level.tolerance < LEVELS[i - 1].tolerance, `${level.name} is tighter than ${LEVELS[i - 1].name}`);
  assert.ok(level.hold > LEVELS[i - 1].hold, `${level.name} holds longer than ${LEVELS[i - 1].name}`);
});
assert.equal(LEVELS[DEFAULT_LEVEL].tolerance, 15, 'The default matches the trainer’s original balanced setting');
assert.equal(LEVELS[DEFAULT_LEVEL].hold, 2000);
assert.equal(clampLevel(-3), 0);
assert.equal(clampLevel(99), LEVELS.length - 1);
assert.equal(clampLevel('2'), 2);
assert.equal(clampLevel(2.4), 2);
assert.equal(clampLevel(undefined), DEFAULT_LEVEL, 'A missing stored level falls back to the default');
assert.equal(holdFor(DEFAULT_LEVEL, 'guided'), 2000);
assert.equal(holdFor(5, 'guided'), 3000);
assert.equal(holdFor(5, 'speedrun'), 800, 'A speedrun caps the hold but keeps the tolerance');
assert.equal(holdFor(0, 'speedrun'), 800);
assert.ok(levelLabel(3).includes('±15 cents') && levelLabel(3).includes('2.0 s'));

const tolerance = LEVELS[DEFAULT_LEVEL].tolerance;
const watch = new StruggleWatch();
const middle = { tolerance, canEasier: true, canHarder: true };
assert.equal(watch.suggest(0, { voicedMs: 5000, ...middle }), null, 'No nudge while a note is going normally');
assert.equal(watch.suggest(0, { voicedMs: STUCK_MS, ...middle }), 'easier', 'Singing at one note for a long time asks for easier');
assert.equal(watch.suggest(0, { voicedMs: STUCK_MS, ...middle, canEasier: false }), null, 'Nothing to suggest at the gentlest level');
watch.reset();
for (let i = 0; i < 3; i++) watch.finish({ completed: true, durationMs: SLOW_MS + 1000, rms: 22 });
assert.equal(watch.suggest(0, middle), 'easier', 'Three slow notes in a row asks for easier');
watch.reset();
watch.finish({ completed: false, durationMs: 4000 });
watch.finish({ completed: true, durationMs: 2000, rms: 5 });
watch.finish({ completed: true, durationMs: 2000, rms: 5 });
assert.equal(watch.suggest(0, middle), null, 'One abandoned note among quick ones is not a verdict either way');
watch.reset();
for (let i = 0; i < 3; i++) watch.finish({ completed: true, durationMs: QUICK_MS - 1000, rms: tolerance * 0.5 });
assert.equal(watch.suggest(0, middle), 'harder', 'Three quick, accurate notes asks for harder');
assert.equal(watch.suggest(0, { ...middle, canHarder: false }), null, 'Nothing to suggest at the tightest level');
watch.finish({ completed: true, durationMs: QUICK_MS - 1000, rms: tolerance * 0.9 });
assert.equal(watch.suggest(0, middle), null, 'Accurate but only just: no nudge');
watch.reset();
for (let i = 0; i < 3; i++) watch.finish({ completed: true, durationMs: SLOW_MS + 1000, rms: 22 });
watch.quiet(1000, 45000);
assert.equal(watch.suggest(2000, middle), null, 'A dismissed nudge stays quiet');
assert.equal(watch.suggest(46001, middle), 'easier', 'The nudge returns after the cooldown');
console.log('Difficulty checks passed: ladder ordering, clamping, speedrun hold and the struggle nudge.');
