/* Offline DSP harness: loads the real AudioWorklet processor and instrument
 * model outside a browser so the modal bank can be measured numerically.
 *
 * Renders blocks by hand, so results are bit-identical to what the worklet
 * produces in the browser at the same sample rate.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FS = 48000;

/* -- load the worklet as a plain script in a fake AudioWorkletGlobalScope -- */
let Proc = null;
const wctx = vm.createContext({
  sampleRate: FS,
  registerProcessor: (n, c) => { Proc = c; },
  Math, Float32Array, Float64Array, Int32Array, Uint8Array, Array, Object, console,
});
wctx.AudioWorkletProcessor = class {
  constructor () { this.port = { postMessage () {}, onmessage: null }; }
};
vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/dsp/handpan-processor.js'), 'utf8'), wctx);

/* --------------------------------------------- load ES modules for models -- */
// Tiny ESM loader: strips import/export syntax and evaluates in one shared
// context, so model code can be exercised from CommonJS without a bundler.
const loaded = new Map();
function loadModule (rel) {
  const abs = path.resolve(ROOT, rel);
  if (loaded.has(abs)) return loaded.get(abs);
  let src = fs.readFileSync(abs, 'utf8');
  const deps = {};
  src = src.replace(/import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]\s*;?/g, (_, names, from) => {
    const dep = loadModule(path.join(path.dirname(rel), from));
    const binds = names.split(',').map(s => s.trim()).filter(Boolean);
    for (const b of binds) {
      const [orig, as] = b.split(/\s+as\s+/).map(s => s.trim());
      deps[as || orig] = dep[orig];
    }
    return '';
  });
  const names = [];
  src = src.replace(/export\s+(?=(?:const|let|function|class)\s)/g, (m, off) => '');
  for (const m of src.matchAll(/^(?:const|let|function|class)\s+([A-Za-z_$][\w$]*)/gm)) names.push(m[1]);
  // `import.meta.url` only exists in a real module; the worklet URL is unused
  // here because the processor is loaded directly (above).
  src = src.replace(/import\.meta\.url/g, JSON.stringify('file://' + abs));
  const ctx = vm.createContext({ Math, console, JSON, Object, Array, Map, Set, Number, String,
    Float32Array, Float64Array, Int32Array, URL, isNaN, parseFloat, parseInt, ...deps });
  vm.runInContext(src + '\n;globalThis.__EX={' + names.map(n => n + ':typeof ' + n + '!=="undefined"?' + n + ':undefined').join(',') + '};', ctx);
  const ex = ctx.__EX;
  loaded.set(abs, ex);
  return ex;
}

const scales = loadModule('src/model/scales.js');
const instMod = loadModule('src/model/instrument.js');
const notes = loadModule('src/model/notes.js');
const engineMod = loadModule('src/audio/engine.js');

/* ------------------------------------------------------- render machinery --
 * Drive the real Engine so the strike/pan/param message protocol under test is
 * exactly the one the browser uses; only the AudioContext is stubbed out. */
const proc = new Proc();
proc.port.postMessage = () => {};
const send = (m) => proc.onmsg(m);

const engine = new engineMod.Engine();
engine.ctx = { sampleRate: FS, currentTime: 0, state: 'running' };
engine.node = { port: { postMessage: send } };

/** Build an instrument and hand its tables to the processor. */
function build (scale, opts = {}) {
  const inst = engine.build(scale, {
    a4: 440, rootMidi: scale.root, helmF: 85, seed: 7, fs: FS, ...opts,
  });
  engine.setPans(inst.notes);
  return inst;
}

function reset () {
  proc.y1.fill(0); proc.y2.fill(0);
  proc.e1.fill(0); proc.e2.fill(0);
  proc.ec.fill(0); proc.e.fill(0);
  proc.drv.fill(0); proc.inp.fill(0);
  if (proc.gl) proc.gl.fill(0);
  proc.tickEnv = 0;
  proc.dcX = proc.dcY = 0;
  if (proc.energy) proc.energy.fill(0);
}

/**
 * @param {number} sec         seconds to render
 * @param {Array}  strikes     [{t, i, v, p, c}] or {t, tak:true, v}
 * @param {Object} params      {sustain, kappa, master}
 * @returns {Float32Array}     mono-left, with .R for right
 */
function render (sec, strikes, params = {}) {
  engine.param({ sustain: 1, kappa: 0.0076 * 0.42, ...params });
  reset();
  const n = Math.round(FS * sec);
  const L = new Float32Array(128), R = new Float32Array(128);
  const out = new Float32Array(n), outR = new Float32Array(n);
  const q = strikes.slice().sort((a, b) => a.t - b.t);
  for (let b = 0; b * 128 < n; b++) {
    const t = b * 128 / FS;
    while (q.length && q[0].t <= t) {
      const s = q.shift();
      if (s.tak) engine.tak(s.v);
      else engine.strike(s.i, s.v, s.p || 0, s.c || 1);
    }
    proc.process([], [[L, R]]);
    const m = Math.min(128, n - b * 128);
    out.set(L.subarray(0, m), b * 128);
    outR.set(R.subarray(0, m), b * 128);
  }
  out.R = outR;
  return out;
}

/* ------------------------------------------------------------- measurement -- */
/** Goertzel magnitude of frequency f over samples [a,b). */
function gz (o, f, a, b) {
  const w = 2 * Math.PI * f / FS, c = 2 * Math.cos(w);
  let s1 = 0, s2 = 0;
  for (let i = a; i < b; i++) { const s = o[i] + c * s1 - s2; s2 = s1; s1 = s; }
  return Math.hypot(s1 - s2 * Math.cos(w), s2 * Math.sin(w)) / (b - a) * 2;
}

/** Search +-tol around fn for the true partial (modes carry build jitter). */
function peak (o, fn, a, b, tol = 0.02) {
  let best = 0, bf = fn;
  for (let f = fn * (1 - tol); f <= fn * (1 + tol); f += fn * 0.0003) {
    const m = gz(o, f, a, b);
    if (m > best) { best = m; bf = f; }
  }
  return { m: best, f: bf };
}

/** RMS envelope in `win`-second frames. */
function envelope (o, win = 0.05) {
  const N = Math.round(FS * win), out = [];
  for (let i = 0; i + N <= o.length; i += N) {
    let s = 0;
    for (let j = i; j < i + N; j++) s += o[j] * o[j];
    out.push(Math.sqrt(s / N));
  }
  return out;
}

/** Least-squares T60 from the log-RMS envelope between two amplitude bounds. */
function fitT60 (o, win = 0.05, hi = 0.7, lo = 0.02) {
  const env = envelope(o, win);
  const pk = Math.max(...env);
  const pts = [];
  let started = false;
  for (let i = 0; i < env.length; i++) {
    if (env[i] >= pk * hi) started = true;
    if (!started) continue;
    if (env[i] < pk * lo) break;
    pts.push([i * win, Math.log(env[i])]);
  }
  if (pts.length < 4) return NaN;
  const n = pts.length;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const [x, y] of pts) { sx += x; sy += y; sxx += x * x; sxy += x * y; }
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  return -Math.log(1000) / slope;      // 60 dB = ln(1000)
}

const dbv = (x, ref) => 20 * Math.log10(x / ref);
const cents = (f, fr) => 1200 * Math.log2(f / fr);

module.exports = {
  FS, proc, send, engine, build, render, reset, gz, peak, envelope, fitT60, dbv, cents,
  SCALES: scales.SCALES, instMod, notes,
};
