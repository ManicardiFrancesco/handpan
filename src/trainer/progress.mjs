// Accuracy history and speedrun records. Storage is injected so this whole file
// runs under node; pass null for an in-memory session.
export const HISTORY_KEY = 'handpanvoice.history.v1';
export const RUNS_KEY = 'handpanvoice.runs.v1';
export const LEVEL_KEY = 'handpanvoice.level.v1';
export const OUTLIER_CENTS = 150;
export const MIN_SAMPLES = 6;

export function safeStorage() {
  try {
    const storage = globalThis.localStorage;
    storage.getItem(HISTORY_KEY);
    return storage;
  } catch { return null; }
}
const read = (storage, key, fallback) => {
  if (!storage) return fallback;
  try {
    const raw = storage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch { return fallback; }
};
const write = (storage, key, value) => {
  if (!storage) return false;
  try { storage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
};
export const readNumber = (key, fallback, storage = safeStorage()) => {
  const value = read(storage, key, null);
  return value === null || value === '' || !Number.isFinite(+value) ? fallback : +value;
};
export const writeNumber = (key, value, storage = safeStorage()) => write(storage, key, value);
export const formatDuration = ms => {
  const seconds = Math.max(0, ms) / 1000;
  return seconds < 60 ? `${seconds.toFixed(1)}s`
    : `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(1).padStart(4, '0')}`;
};
export const runKey = (scale, octave, level) => `${scale}|${octave}|${level}`;

// Collects one target note's worth of pitch error. Samples further than the gate
// are dropped: they are a wrong note or a detection glitch, not an attempt at
// this note, and averaging them in would bury real progress.
export class AttemptMeter {
  constructor({ gate = OUTLIER_CENTS, minSamples = MIN_SAMPLES } = {}) {
    this.gate = gate; this.minSamples = minSamples; this.reset();
  }
  reset() { this.kept = []; this.dropped = 0; this.startedAt = null; this.voicedMs = 0; this.lastVoiced = null; }
  add(now, cents) {
    if (this.startedAt === null) this.startedAt = now;
    if (this.lastVoiced !== null) this.voicedMs += Math.min(now - this.lastVoiced, 250);
    this.lastVoiced = now;
    if (!Number.isFinite(cents) || Math.abs(cents) > this.gate) { this.dropped++; return false; }
    this.kept.push(cents);
    return true;
  }
  silence() { this.lastVoiced = null; }
  result(now = 0) {
    if (this.kept.length < this.minSamples) return null;
    const rms = Math.sqrt(this.kept.reduce((sum, c) => sum + c * c, 0) / this.kept.length);
    return {
      rms, best: Math.min(...this.kept.map(Math.abs)), samples: this.kept.length, dropped: this.dropped,
      voicedMs: this.voicedMs, durationMs: this.startedAt === null ? 0 : Math.max(0, now - this.startedAt),
    };
  }
}

// Least squares over the sample index. Improvement is the fitted drop across the
// window, as a share of where the fit started.
export function trendOf(values) {
  const n = values.length;
  if (n < 3) return null;
  const meanX = (n - 1) / 2;
  const meanY = values.reduce((sum, v) => sum + v, 0) / n;
  let covariance = 0, variance = 0;
  values.forEach((value, i) => { covariance += (i - meanX) * (value - meanY); variance += (i - meanX) ** 2; });
  const slope = variance ? covariance / variance : 0;
  const from = meanY - slope * meanX, to = from + slope * (n - 1);
  return { slope, from, to, changePct: from > 0 ? (from - to) / from * 100 : 0 };
}

export class History {
  constructor({ storage = safeStorage(), key = HISTORY_KEY, limit = 400 } = {}) {
    this.storage = storage; this.key = key; this.limit = limit;
    const stored = read(storage, key, []);
    this.entries = Array.isArray(stored) ? stored.filter(e => e && Number.isFinite(e.cents) && Number.isFinite(e.at)) : [];
  }
  add(entry) {
    this.entries.push(entry);
    if (this.entries.length > this.limit) this.entries = this.entries.slice(-this.limit);
    write(this.storage, this.key, this.entries);
    return entry;
  }
  clear() { this.entries = []; write(this.storage, this.key, this.entries); }
  recent(size = Infinity) { return Number.isFinite(size) ? this.entries.slice(-Math.max(0, size)) : this.entries.slice(); }
  since(time) { return this.entries.filter(entry => entry.at >= time).length; }
  summary(size = Infinity) {
    const entries = this.recent(size);
    const cents = entries.map(entry => entry.cents);
    return {
      count: entries.length, total: this.entries.length,
      average: cents.length ? cents.reduce((sum, c) => sum + c, 0) / cents.length : null,
      best: cents.length ? Math.min(...cents) : null,
      trend: trendOf(cents),
    };
  }
}

export class Records {
  constructor({ storage = safeStorage(), key = RUNS_KEY } = {}) {
    this.storage = storage; this.key = key;
    const stored = read(storage, key, {});
    this.runs = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
  }
  best(key) { const record = this.runs[key]; return record && Number.isFinite(record.ms) ? record : null; }
  submit(key, ms, at = Date.now()) {
    const previous = this.best(key);
    const improved = !previous || ms < previous.ms;
    this.runs[key] = { ms: improved ? ms : previous.ms, at: improved ? at : previous.at, count: (previous?.count ?? 0) + 1 };
    write(this.storage, this.key, this.runs);
    return { ms, best: this.runs[key].ms, previous: previous?.ms ?? null, improved, count: this.runs[key].count };
  }
  clear() { this.runs = {}; write(this.storage, this.key, this.runs); }
}
