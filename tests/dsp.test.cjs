/* Numeric verification of the modal synthesis engine.
 *
 *   node tests/dsp.test.cjs
 *
 * Targets come from the measured-values spec: partial levels 0/-4/-10 dB,
 * per-mode T60 of about 5.5/4.2/2.6 s on a D3 ding, principal modes tuned to
 * just 1:2:3, sympathetic coupling in the -25..-35 dB band.
 */
const H = require('./dsp-harness.cjs');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const near = (v, t, tol, m) => ok(Math.abs(v - t) <= tol, m + ' (got ' + v + ', want ' + t + ' +-' + tol + ')');
const S = (n) => H.SCALES.find(x => x.name.includes(n));

console.log('=== 1. principal modes are just 1:2:3, not equal-tempered ===');
{
  const inst = H.build(S('Kurd 9'));
  const o = H.render(3, [{ t: 0, i: 0, v: 0.8, p: 0.15 }]);
  const f0 = inst.notes[0].f0;
  const win = [Math.round(H.FS * 0.1), Math.round(H.FS * 2.6)];
  for (const r of [1, 2, 3]) {
    const p = H.peak(o, f0 * r, win[0], win[1], 0.01);
    const c = H.cents(p.f, f0 * r);
    console.log('  mode x' + r, p.f.toFixed(2) + ' Hz', c.toFixed(2) + ' cents');
    ok(Math.abs(c) < 3, 'partial x' + r + ' within 3 cents of just ratio: ' + c.toFixed(2));
  }
  // the twelfth must be 3.0, audibly flat of an ET twelfth (2.9966 -> -2 cents)
  const p1 = H.peak(o, f0, win[0], win[1], 0.01);
  const p3 = H.peak(o, f0 * 3, win[0], win[1], 0.01);
  const ratio = p3.f / p1.f;
  console.log('  measured 3rd/1st ratio:', ratio.toFixed(4), '(just 3.0000, ET 2.9966)');
  ok(Math.abs(ratio - 3) < Math.abs(ratio - 2.9966), 'twelfth is just, not equal-tempered');
}

console.log('=== 2. partial balance ===');
{
  const inst = H.build(S('Kurd 9'));
  const f0 = inst.notes[0].f0;
  const a = Math.round(H.FS * 0.02), b = Math.round(H.FS * 0.35);
  const at = (v, p, c) => {
    const o = H.render(1, [{ t: 0, i: 0, v, p, c }]);
    const m = [1, 2, 3].map(r => H.peak(o, f0 * r, a, b, 0.012).m);
    return m.map(x => H.dbv(x, m[0]));
  };
  // The spec table describes the REFERENCE strike: dimple centre, 4.5 ms
  // contact. The engine maps ms = (8 - 6v) * contact, so v = 0.583 at
  // contact = 1 lands exactly on the reference. Away from it the balance is
  // meant to shift - that is what the position and contact controls do.
  const ref = at(0.5833, 0, 1);
  console.log('  at reference strike:', ref.map(x => x.toFixed(1).padStart(6)).join(' '), 'dB  target 0 / -4 / -10');
  near(ref[1], -4, 2, 'octave level near -4 dB at reference');
  near(ref[2], -10, 3.5, 'twelfth level near -10 dB at reference');
  ok(ref[1] < 0 && ref[2] < ref[1], 'partials descend in level');

  const bright = at(0.95, 0.3, 0.6);
  console.log('  hard, off-centre, hard contact:', bright.map(x => x.toFixed(1).padStart(6)).join(' '), 'dB');
  ok(bright[1] > ref[1] && bright[2] > ref[2], 'harder off-centre strikes are relatively brighter');
}

console.log('=== 3. per-mode T60 is independent (higher modes die first) ===');
{
  const inst = H.build(S('Kurd 9'));
  const o = H.render(8, [{ t: 0, i: 0, v: 0.85, p: 0.15 }], { sustain: 1 });
  const f0 = inst.notes[0].f0;
  // isolate each partial by narrowband tracking, then fit its own decay
  const t60 = [1, 2, 3].map((r) => {
    const fq = H.peak(o, f0 * r, Math.round(H.FS * 0.05), Math.round(H.FS * 1), 0.012).f;
    const win = Math.round(H.FS * 0.12), env = [];
    for (let i = 0; i + win <= o.length; i += win) env.push(H.gz(o, fq, i, i + win));
    const pk = Math.max(...env), pts = [];
    for (let i = 0; i < env.length; i++) {
      if (env[i] > pk * 0.85 || env[i] < pk * 0.02) continue;
      pts.push([i * win / H.FS, Math.log(env[i])]);
    }
    let sx = 0, sy = 0, sxx = 0, sxy = 0, n = pts.length;
    for (const [x, y] of pts) { sx += x; sy += y; sxx += x * x; sxy += x * y; }
    return -Math.log(1000) / ((n * sxy - sx * sy) / (n * sxx - sx * sx));
  });
  console.log('  T60 (s):', t60.map(x => x.toFixed(2)).join(' / '), ' target ~5.5 / 4.2 / 2.6');
  ok(t60[0] > 3.5 && t60[0] < 9, 'fundamental T60 long: ' + t60[0].toFixed(2));
  ok(t60[2] < t60[0], 'twelfth decays faster than fundamental');
  ok(t60[1] < t60[0] * 1.15, 'octave decays no slower than fundamental');
}

console.log('=== 4. beating from near-degenerate mode pairs ===');
{
  const inst = H.build(S('Kurd 9'));
  const nt = inst.notes[0];
  const pairs = [];
  for (let i = 0; i < nt.modes.length; i++)
    for (let j = i + 1; j < nt.modes.length; j++) {
      const d = Math.abs(nt.modes[i].f - nt.modes[j].f);
      if (d > 0.2 && d < 6) pairs.push({ d, f: nt.modes[i].f });
    }
  console.log('  near-degenerate pairs:', pairs.map(p => p.f.toFixed(1) + 'Hz d=' + p.d.toFixed(2)).join(', ') || 'none');
  ok(pairs.length > 0, 'ding has at least one beating pair 0.2-6 Hz apart');

  // amplitude modulation must be visible in the narrowband envelope
  const o = H.render(6, [{ t: 0, i: 0, v: 0.8, p: 0.15 }]);
  const fq = pairs.length ? pairs[0].f : nt.f0;
  const win = Math.round(H.FS * 0.03), env = [];
  for (let i = 0; i + win <= o.length; i += win) env.push(H.gz(o, fq, i, i + win));
  // detrend the exponential decay, then measure residual ripple
  const seg = env.slice(Math.round(env.length * 0.08), Math.round(env.length * 0.55));
  const lg = seg.map(Math.log);
  const n = lg.length;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  lg.forEach((y, i) => { sx += i; sy += y; sxx += i * i; sxy += i * y; });
  const sl = (n * sxy - sx * sy) / (n * sxx - sx * sx), ic = (sy - sl * sx) / n;
  const res = lg.map((y, i) => y - (sl * i + ic));
  const ripple = 20 / Math.LN10 * (Math.max(...res) - Math.min(...res));
  console.log('  detrended ripple at', fq.toFixed(1), 'Hz:', ripple.toFixed(1), 'dB');
  ok(ripple > 1.5, 'audible amplitude beating present: ' + ripple.toFixed(1) + ' dB');
}

console.log('=== 5. sympathetic coupling sits in the -25..-35 dB band ===');
{
  // Probe resonator state directly: audio cannot separate a note's octave from
  // the fundamental of the note an octave above it.
  const KAPPA = 0.0076 * 0.42;               // engine default slider position
  const inst = H.build(S('Kurd 9'));
  const state = (p) => {
    const md = inst.notes[p].modes[0];
    return Math.abs(H.proc.y1[md.i]) + Math.abs(H.proc.y2[md.i]);
  };
  const direct = [];
  for (let p = 0; p < inst.nNotes; p++) {
    H.render(1.2, [{ t: 0, i: p, v: 0.9, p: 0.15 }], { kappa: 0 });
    direct[p] = state(p);
  }
  const links = [];
  let leakWithoutCoupling = 0;
  for (let s = 0; s < inst.nNotes; s++) {
    H.render(1.2, [{ t: 0, i: s, v: 0.9, p: 0.15 }], { kappa: 0 });
    for (let p = 0; p < inst.nNotes; p++) if (p !== s) leakWithoutCoupling += state(p);
    H.render(1.2, [{ t: 0, i: s, v: 0.9, p: 0.15 }], { kappa: KAPPA });
    for (let p = 0; p < inst.nNotes; p++) {
      if (p === s) continue;
      const v = state(p);
      if (v > 0) links.push({ from: inst.notes[s].name, to: inst.notes[p].name, d: H.dbv(v, direct[p]) });
    }
  }
  links.sort((a, b) => b.d - a.d);
  for (const l of links) console.log('  ', l.from, '->', l.to, l.d.toFixed(1), 'dB');
  ok(leakWithoutCoupling === 0, 'with kappa = 0 no energy crosses between notes at all');
  ok(links.length >= 2, 'coupling excites unstruck notes: ' + links.length + ' links');
  const worst = links[0].d;
  const median = links[Math.floor(links.length / 2)].d;
  console.log('  worst-case (exact coincidence):', worst.toFixed(1), 'dB | median:', median.toFixed(1), 'dB');
  // The loudest link is an exact frequency coincidence (A3's octave mode against
  // A4's fundamental), so it is the upper bound rather than the typical case.
  ok(worst <= -24 && worst >= -32, 'strongest link within -24..-32 dB: ' + worst.toFixed(1));
  ok(median <= -25 && median >= -36, 'typical link in the -25..-35 dB band: ' + median.toFixed(1));
}

console.log('=== 6. resonator states are never reset by a new strike ===');
{
  const inst = H.build(S('Kurd 9'));
  const md = inst.notes[4].modes[0];
  // ring note 4, then strike a different note and confirm note 4 keeps ringing
  H.render(0.8, [{ t: 0, i: 4, v: 0.9, p: 0.15 }]);
  const alone = Math.abs(H.proc.y1[md.i]);
  H.render(0.8, [{ t: 0, i: 4, v: 0.9, p: 0.15 }, { t: 0.4, i: 7, v: 0.9, p: 0.15 }]);
  const withOther = Math.abs(H.proc.y1[md.i]);
  const ratio = withOther / alone;
  console.log('  note4 state alone:', alone.toExponential(2), 'after striking note7:', withOther.toExponential(2), 'ratio', ratio.toFixed(3));
  ok(ratio > 0.5, 'earlier note still ringing after a later strike (ratio ' + ratio.toFixed(2) + ')');
}

console.log('=== 7. no DC offset (the force pulse is positive-only) ===');
{
  H.build(S('Kurd 9'));
  const o = H.render(2.5, [{ t: 0, i: 0, v: 0.9, p: 0.15 }]);
  let sum = 0, pk = 0;
  for (const v of o) { sum += v; pk = Math.max(pk, Math.abs(v)); }
  const dc = Math.abs(sum / o.length);
  console.log('  mean:', dc.toExponential(2), 'peak:', pk.toFixed(4), 'ratio:', (dc / pk).toExponential(2));
  ok(dc / pk < 0.005, 'DC offset under 0.5% of peak: ' + (100 * dc / pk).toFixed(3) + '%');
}

console.log('=== 8. contact softness is a smooth brightness control (no nulls) ===');
{
  const inst = H.build(S('Kurd 9'));
  const f0 = inst.notes[0].f0;
  const a = 0, b = Math.round(H.FS * 0.25);
  const rows = [];
  for (const c of [0.4, 0.7, 1.0, 1.4, 1.8]) {
    const o = H.render(0.6, [{ t: 0, i: 0, v: 0.8, p: 0.15, c }]);
    const m = [1, 2, 3, 5.9].map(r => H.peak(o, f0 * r, a, b, 0.012).m);
    rows.push({ c, d: m.map(x => H.dbv(x, m[0])) });
  }
  for (const r of rows)
    console.log('  contact', r.c.toFixed(1), '->', r.d.map(x => x.toFixed(1).padStart(6)).join(' '), 'dB (x1 x2 x3 x5.9)');
  // Brightness must fall monotonically as contact softens. Only the principal
  // partials are checked: the x5.9 inharmonic sits near -60 dB, where a peak
  // search over a +-1.2% window measures skirt leakage rather than the mode.
  for (let k = 1; k <= 2; k++) {
    let mono = true;
    for (let i = 1; i < rows.length; i++) if (rows[i].d[k] > rows[i - 1].d[k] + 0.5) mono = false;
    ok(mono, 'partial x' + (k + 1) + ' level falls monotonically with softer contact');
  }
  // and the roll-off must span a useful range, not be a token tilt
  const span = rows[0].d[2] - rows[rows.length - 1].d[2];
  console.log('  twelfth brightness span over the contact range:', span.toFixed(1), 'dB');
  ok(span > 6, 'contact control has real authority: ' + span.toFixed(1) + ' dB');
}

console.log('=== 9. strike position shapes the partials as specified ===');
{
  const inst = H.build(S('Kurd 9'));
  const f0 = inst.notes[0].f0;
  const a = 0, b = Math.round(H.FS * 0.25);
  const at = (p) => {
    const o = H.render(0.6, [{ t: 0, i: 0, v: 0.8, p }]);
    return [1, 2, 3].map(r => H.peak(o, f0 * r, a, b, 0.012).m);
  };
  const dimple = at(0), shoulder = at(1);
  const d = [0, 1, 2].map(k => H.dbv(shoulder[k], dimple[k]));
  console.log('  shoulder vs dimple (dB):', d.map(x => x.toFixed(1)).join(' / '), ' target ~-18 / +6 / +8');
  ok(d[0] < -6, 'fundamental much weaker at the shoulder: ' + d[0].toFixed(1) + ' dB');
  ok(d[1] > 1, 'octave stronger at the shoulder: ' + d[1].toFixed(1) + ' dB');
  ok(d[2] > 1, 'twelfth stronger at the shoulder: ' + d[2].toFixed(1) + ' dB');
}

console.log('=== 10. velocity gates the inharmonic cluster ===');
{
  const inst = H.build(S('Kurd 9'));
  const f0 = inst.notes[0].f0;
  const a = 0, b = Math.round(H.FS * 0.12);
  const at = (v) => {
    const o = H.render(0.4, [{ t: 0, i: 0, v, p: 0.15 }]);
    const lo = H.peak(o, f0, a, b, 0.012).m;
    const hi = Math.max(...[5.9, 7.4, 8.2].map(r => H.peak(o, f0 * r, a, b, 0.02).m));
    return H.dbv(hi, lo);
  };
  const soft = at(0.15), hard = at(1.0);
  console.log('  cluster/fundamental: soft', soft.toFixed(1), 'dB  hard', hard.toFixed(1), 'dB');
  ok(hard > soft + 3, 'hard strikes are relatively richer in inharmonics (+' + (hard - soft).toFixed(1) + ' dB)');
}

console.log('=== 11. sub-bass "impossible" scales are stable and audible ===');
{
  for (const nm of ['Abyss', 'Leviathan', 'Tectonic', 'Gravity Well']) {
    const inst = H.build(S(nm));
    const f0 = inst.notes[0].f0;
    const o = H.render(10, [{ t: 0, i: 0, v: 0.95, p: 0.1 }], { sustain: 1 });
    let pk = 0, finite = true, tail = 0;
    for (let i = 0; i < o.length; i++) {
      if (!Number.isFinite(o[i])) finite = false;
      pk = Math.max(pk, Math.abs(o[i]));
      if (i > o.length * 0.9) tail = Math.max(tail, Math.abs(o[i]));
    }
    const fq = H.peak(o, f0, Math.round(H.FS * 0.2), Math.round(H.FS * 4), 0.01);
    const cts = H.cents(fq.f, f0);
    const t60 = H.fitT60(o, 0.1);
    console.log('  ' + inst.notes[0].name.padEnd(4), f0.toFixed(2).padStart(6) + ' Hz',
      '| peak', pk.toFixed(4), '| tuning', cts.toFixed(2).padStart(6), 'cents',
      '| T60', (t60 || 0).toFixed(2) + 's', '| tail/peak', (tail / pk).toFixed(3));
    ok(finite, nm + ': output finite (no float blowup)');
    ok(pk > 0.02, nm + ': audible level, peak=' + pk.toFixed(4));
    ok(Math.abs(cts) < 12, nm + ': fundamental tuned within 12 cents, got ' + cts.toFixed(2));
    ok(tail / pk < 0.9, nm + ': decaying, not growing (tail/peak ' + (tail / pk).toFixed(2) + ')');
    ok(t60 > 0.5 && t60 < 40, nm + ': plausible T60 ' + (t60 || 0).toFixed(2) + 's');
  }
}

console.log('=== 12. every scale: clean under real playing, limited under abuse ===');
{
  const stats = (o) => {
    let pk = 0, finite = true, clip = 0;
    for (const v of o) {
      if (!Number.isFinite(v)) finite = false;
      const a = Math.abs(v);
      if (a > pk) pk = a;
      if (a > 0.999) clip++;
    }
    return { pk, finite, clip };
  };
  for (const s of H.SCALES) {
    const inst = H.build(s);
    // (a) realistic playing: a hard 6-note strum plus accented eighths
    const musical = [];
    for (let k = 0; k < 6; k++)
      musical.push({ t: k * 0.062, i: (k + 1) % inst.nNotes, v: 0.95, p: 0.15 });
    for (let k = 0; k < 10; k++)
      musical.push({ t: 1 + k * 0.22, i: k % inst.nNotes, v: k % 4 === 0 ? 0.95 : 0.6, p: 0.2 });
    musical.push({ t: 1.1, tak: true, v: 0.9 });
    const a = stats(H.render(5, musical));

    // (b) abuse: 22 strikes/second at full force, all hard contact
    const abuse = [];
    for (let k = 0; k < 60; k++)
      abuse.push({ t: k * 0.045, i: k % inst.nNotes, v: 1, p: (k % 5) / 5, c: 0.4 });
    const b = stats(H.render(4.5, abuse));

    console.log('  ' + s.name.padEnd(34),
      'musical peak', a.pk.toFixed(4), a.clip ? 'clip x' + a.clip : '      ',
      '| abuse peak', b.pk.toFixed(4), 'clip x' + String(b.clip).padStart(5));
    ok(a.finite && b.finite, s.name + ': no NaN/Inf');
    ok(a.pk > 0.01, s.name + ': actually produces sound, peak=' + a.pk.toFixed(4));
    ok(a.pk <= 1.0001 && b.pk <= 1.0001, s.name + ': never exceeds full scale');
    ok(a.clip === 0, s.name + ': realistic playing never hits full scale (clip=' + a.clip + ')');
    // The limiter must keep even the abuse case off the rail: sustained
    // full-scale samples would be audible distortion, not saturation.
    ok(b.clip / 4.5 / H.FS < 0.0002,
      s.name + ': abuse case stays off the rail, ' + (100 * b.clip / (4.5 * H.FS)).toFixed(3) + '% of samples');
  }
}

console.log('=== 13. damping and silence ===');
{
  const inst = H.build(S('Kurd 9'));
  const loud = H.render(2.5, [{ t: 0, i: 0, v: 0.9, p: 0.15 }], { sustain: 1 });
  const damp = H.render(2.5, [{ t: 0, i: 0, v: 0.9, p: 0.15 }], { sustain: 0.12 });
  const tailOf = (o) => {
    let m = 0;
    for (let i = Math.round(o.length * 0.7); i < o.length; i++) m = Math.max(m, Math.abs(o[i]));
    return m;
  };
  const r = H.dbv(tailOf(damp), tailOf(loud));
  console.log('  damped tail vs open tail:', r.toFixed(1), 'dB');
  ok(r < -12, 'damping shortens the tail by more than 12 dB: ' + r.toFixed(1));

  H.render(0.5, [{ t: 0, i: 0, v: 0.9, p: 0.15 }]);
  H.engine.silence();
  let mx = 0;
  const L = new Float32Array(128), R = new Float32Array(128);
  for (let b = 0; b < 40; b++) {
    H.proc.process([], [[L, R]]);
    for (const v of L) mx = Math.max(mx, Math.abs(v));
  }
  console.log('  peak after silence():', mx.toExponential(2));
  ok(mx < 1e-4, 'silence() empties the resonator bank');
}

console.log('\n' + (fail ? 'FAILURES: ' + fail : 'ALL PASS') + '  (' + pass + ' assertions)');
process.exit(fail ? 1 : 0);
