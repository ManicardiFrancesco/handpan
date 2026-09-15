import assert from 'node:assert/strict';
import { AttemptMeter, History, Records, trendOf, formatDuration, runKey, readNumber, writeNumber, OUTLIER_CENTS } from '../src/trainer/progress.mjs';

// Far-off moments are dropped, not averaged in.
const meter = new AttemptMeter();
assert.equal(meter.result(0), null, 'Too few samples to score an attempt');
for (let i = 0; i < 6; i++) meter.add(i * 60, 20);
assert.equal(meter.add(400, OUTLIER_CENTS + 1), false, 'A sample beyond the gate is discarded');
meter.add(460, -OUTLIER_CENTS - 400);
let attempt = meter.result(520);
assert.equal(attempt.rms, 20, 'Discarded samples do not move the score');
assert.equal(attempt.samples, 6); assert.equal(attempt.dropped, 2);
assert.equal(attempt.best, 20); assert.equal(attempt.durationMs, 520);
assert.ok(attempt.voicedMs <= 520 && attempt.voicedMs > 0);
meter.silence();
meter.add(20520, 20);
assert.ok(meter.result(20520).voicedMs < 1000, 'A silent gap is not counted as singing');
meter.reset();
assert.equal(meter.result(0), null);
meter.add(0, -30); meter.add(60, 30);
for (let i = 2; i < 6; i++) meter.add(i * 60, 0);
assert.ok(Math.abs(meter.result(360).rms - Math.sqrt((900 + 900) / 6)) < 1e-9, 'RMS over kept samples');
assert.equal(meter.result(360).best, 0);

// A falling series reads as improvement; a flat one does not.
assert.equal(trendOf([10, 8]), null, 'Two points are not a trend');
const better = trendOf([40, 30, 20, 10]);
assert.ok(better.slope < 0 && better.changePct > 50, 'Halving the error shows as a large improvement');
assert.equal(trendOf([20, 20, 20]).slope, 0);
assert.equal(trendOf([20, 20, 20]).changePct, 0);
assert.ok(trendOf([10, 20, 30]).changePct < 0, 'Getting worse is a negative change');

// History survives a reload through storage and keeps only valid entries.
class MemoryStorage {
  constructor(seed = {}) { this.data = { ...seed }; }
  getItem(key) { return key in this.data ? this.data[key] : null; }
  setItem(key, value) { this.data[key] = String(value); }
}
const storage = new MemoryStorage();
let history = new History({ storage, limit: 3 });
assert.equal(history.summary().count, 0);
assert.equal(history.summary().average, null);
[30, 20, 10, 5].forEach((cents, i) => history.add({ at: 1000 + i, cents, note: 'D3' }));
assert.deepEqual(history.recent().map(e => e.cents), [20, 10, 5], 'Oldest entries fall off the limit');
history = new History({ storage, limit: 3 });
assert.deepEqual(history.recent().map(e => e.cents), [20, 10, 5], 'Reloaded from storage');
assert.deepEqual(history.recent(2).map(e => e.cents), [10, 5]);
assert.equal(history.since(1002), 2);
const summary = history.summary();
assert.equal(summary.best, 5); assert.equal(summary.count, 3); assert.equal(summary.total, 3);
assert.ok(Math.abs(summary.average - 35 / 3) < 1e-9);
assert.ok(summary.trend.changePct > 0, 'Falling deviation is reported as progress');
history.clear();
assert.equal(new History({ storage }).recent().length, 0);
assert.equal(new History({ storage: new MemoryStorage({ 'handpanvoice.history.v1': 'not json' }) }).recent().length, 0);
const memoryOnly = new History({ storage: null });
memoryOnly.add({ at: 1, cents: 2 });
assert.equal(memoryOnly.recent().length, 1);
assert.equal(new History({ storage: null }).recent().length, 0, 'Without storage, history stays in memory only');

// Speedrun records keep the fastest time per scale, register and difficulty.
const records = new Records({ storage: new MemoryStorage() });
const key = runKey('D Kurd', 0, 3);
assert.equal(records.best(key), null);
let outcome = records.submit(key, 42000, 5);
assert.deepEqual([outcome.improved, outcome.previous, outcome.best, outcome.count], [true, null, 42000, 1]);
outcome = records.submit(key, 51000, 6);
assert.deepEqual([outcome.improved, outcome.previous, outcome.best, outcome.count], [false, 42000, 42000, 2]);
outcome = records.submit(key, 39500, 7);
assert.deepEqual([outcome.improved, outcome.best, outcome.count], [true, 39500, 3]);
assert.equal(records.best(runKey('D Kurd', 0, 4)), null, 'A different difficulty is a different record');
assert.equal(records.best(key).at, 7);

// A missing setting must fall back, not read as zero.
const settings = new MemoryStorage();
assert.equal(readNumber('handpanvoice.level.v1', 3, settings), 3, 'Nothing stored means the default');
writeNumber('handpanvoice.level.v1', 0, settings);
assert.equal(readNumber('handpanvoice.level.v1', 3, settings), 0, 'A stored zero is a real value');
writeNumber('handpanvoice.level.v1', 5, settings);
assert.equal(readNumber('handpanvoice.level.v1', 3, settings), 5);
assert.equal(readNumber('missing', 2, null), 2, 'Without storage the default stands');

assert.equal(formatDuration(0), '0.0s');
assert.equal(formatDuration(39500), '39.5s');
assert.equal(formatDuration(59949), '59.9s');
assert.equal(formatDuration(60000), '1:00.0');
assert.equal(formatDuration(95400), '1:35.4');
assert.equal(formatDuration(-5), '0.0s');
console.log('Progress checks passed: outlier gating, attempt statistics, trend, stored history and speedrun records.');
