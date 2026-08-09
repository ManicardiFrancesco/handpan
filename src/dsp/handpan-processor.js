/* Handpan modal resonator bank (AudioWorklet).
 *
 * One two-pole resonator per mode. Resonator states are NEVER reset between
 * strikes, so fast playing interacts with still-ringing modes and sympathetic
 * energy accumulates the way it does on a real shell.
 *
 * Excitation is a compliant-contact force pulse: a unit impulse through two
 * cascaded one-poles, h(t) = (t/T^2)e^(-t/T). Unit area, monotone -12 dB/oct
 * rolloff above 1/(2*pi*T) and no spectral nulls, so contact time controls
 * brightness smoothly. (A Hann pulse's nulls make individual partials vanish
 * at particular velocities, which is unphysical.)
 *
 * Resonator states and coefficients are Float64: "impossible" sub-bass dings
 * put poles extremely close to z=1, where float32 loses precision and the
 * filters drift.
 */

const ENERGY_INTERVAL = 8;      // blocks between per-note energy reports

class HandpanProcessor extends AudioWorkletProcessor {
  constructor () {
    super();
    this.fs = sampleRate;
    this.ready = false;
    this.master = 0.2;
    this.sustain = 1;
    this.kappa = 0.05;
    this.glDec = Math.exp(-128 / (this.fs * 0.08));   // 80 ms pitch settling
    this.blockCount = 0;

    // contact tick: fixed band-pass around 2.6 kHz
    this.nz1 = 0; this.nz2 = 0; this.tickEnv = 0;
    this.tickDec = Math.exp(-1 / (this.fs * 0.006));
    const w = 2 * Math.PI * 2600 / this.fs, r = Math.exp(-Math.PI * 2400 / this.fs);
    this.ta1 = -2 * r * Math.cos(w); this.ta2 = r * r; this.tb0 = (1 - r) * Math.sin(w);

    // DC blocker: the force pulse is positive-only, so every resonator has a
    // small nonzero DC response that would otherwise eat output headroom.
    this.dcR = Math.exp(-2 * Math.PI * 8 / this.fs);
    this.dxL = 0; this.dyL = 0; this.dxR = 0; this.dyR = 0;

    // Program limiter. tanh alone is fine for the occasional peak, but very
    // dense playing on a 21-note layout can drive it several times over full
    // scale, where it stops sounding like saturation and starts sounding like
    // distortion. A shared gain that ducks fast (2 ms) and recovers slowly
    // (400 ms) keeps that under control without touching normal dynamics.
    this.lim = 1;
    this.limAtk = Math.exp(-1 / (this.fs * 0.002));
    this.limRel = Math.exp(-1 / (this.fs * 0.4));
    this.limCeil = 0.86;

    this.port.onmessage = (e) => this.onmsg(e.data);
  }

  onmsg (m) {
    switch (m.type) {
      case 'setup':  this.setup(m); break;
      case 'strike': this.strike(m); break;
      case 'pan':
        if (!this.ready) return;
        for (let n = 0; n < m.idx.length; n++) {
          const i = m.idx[n];
          this.pL[i] = m.pL[n]; this.pR[i] = m.pR[n];
        }
        break;
      case 'param':
        if (m.master !== undefined) this.master = m.master;
        if (m.sustain !== undefined) this.sustain = m.sustain;
        if (m.kappa !== undefined) this.kappa = m.kappa;
        if (this.ready) this.recalc();
        break;
      case 'silence':
        if (!this.ready) return;
        this.y1.fill(0); this.y2.fill(0);
        this.eOn.fill(0); this.e1.fill(0); this.e2.fill(0);
        this.e.fill(0); this.inp.fill(0);
        this.drv.fill(0); this.gl.fill(0); this.tickEnv = 0;
        this.nz1 = this.nz2 = 0;
        // the DC blocker is a filter too: leaving its state would ring on
        this.dxL = this.dyL = this.dxR = this.dyR = 0;
        this.lim = 1;
        this.recalc();
        break;
    }
  }

  setup (m) {
    const N = m.f.length;
    this.N = N;
    this.f    = Float64Array.from(m.f);
    this.t60  = Float64Array.from(m.t60);
    this.src  = Int32Array.from(m.src);
    this.noteOf = Int32Array.from(m.noteOf);
    this.pL = Float32Array.from(m.pL);
    this.pR = Float32Array.from(m.pR);
    this.a1 = new Float64Array(N); this.a2 = new Float64Array(N);
    this.y1 = new Float64Array(N); this.y2 = new Float64Array(N);
    this.sw = new Float64Array(N); this.omr = new Float64Array(N);
    this.drv = new Float64Array(N); this.inp = new Float64Array(N);
    this.gl = new Float32Array(N);

    this.cd = Int32Array.from(m.cd);
    this.cs = Int32Array.from(m.cs);
    this.ck = Float32Array.from(m.ck);
    this.cg = new Float64Array(this.cd.length);

    const S = m.slots;
    this.S = S;
    this.eOn = new Uint8Array(S); this.eP = new Int32Array(S);
    this.eL = new Int32Array(S);  this.e = new Float64Array(S);
    this.ec = new Float64Array(S);
    this.e1 = new Float64Array(S); this.e2 = new Float64Array(S);

    this.nNotes = m.nNotes;
    this.energy = new Float32Array(m.nNotes);
    this.eAcc   = new Float32Array(m.nNotes);

    this.recalc();
    this.ready = true;
  }

  coef (i) {
    const t = Math.max(0.02, Math.min(14, this.t60[i] * this.sustain));
    const r = Math.exp(-6.907755 / (t * this.fs));
    let w = 2 * Math.PI * this.f[i] * Math.pow(2, this.gl[i] / 1200) / this.fs;
    if (w > 2.9) w = 2.9;
    this.a1[i] = -2 * r * Math.cos(w);
    this.a2[i] = r * r;
    this.sw[i] = Math.sin(w);
    this.omr[i] = 1 - r;
  }

  recalc () {
    for (let i = 0; i < this.N; i++) this.coef(i);
    for (let c = 0; c < this.cd.length; c++)
      this.cg[c] = 2 * this.omr[this.cd[c]] * this.ck[c] * this.kappa;
  }

  /** Magnitude of the DC-normalised two-pole contact filter at angular freq w. */
  cmag (w, c) { return (1 - c) * (1 - c) / (1 - 2 * c * Math.cos(w) + c * c); }

  strike (m) {
    if (!this.ready) return;
    const idx = m.idx, amp = m.amp;
    // The pulse already imposes cmag(w, c) on every mode, so the drive only
    // pre-compensates for the REFERENCE contact time. Net modal amplitude is
    // amp * cmag(w,c)/cmag(w,ref): exactly the gain table at reference
    // contact, tilting darker or brighter as contact time changes.
    const cr = Math.exp(-1 / Math.max(1.2, m.ref));
    for (let n = 0; n < idx.length; n++) {
      const i = idx[n];
      const w = 2 * Math.PI * this.f[i] / this.fs;
      this.drv[i] = w > 3.0 ? 0 : amp[n] * this.sw[i] / this.cmag(w, cr);
    }
    if (m.gidx) {
      for (let n = 0; n < m.gidx.length; n++) {
        const i = m.gidx[n];
        this.gl[i] = m.gcent[n];
        this.coef(i);
      }
    }
    for (let n = 0; n < m.slot.length; n++) {
      const s = m.slot[n];
      const T = Math.max(1.2, m.len[n]);
      const c = Math.exp(-1 / T);
      this.ec[s] = c;
      this.eOn[s] = 1; this.eP[s] = 0;
      this.eL[s] = Math.ceil(T * 12) + 8;
      this.e1[s] += (1 - c) * (1 - c);       // additive: overlapping strikes sum
    }
    if (m.tick) this.tickEnv = m.tick;
  }

  process (inputs, outputs) {
    const out = outputs[0], L = out[0], R = out[1] || out[0];
    const nf = L.length;
    if (!this.ready) { L.fill(0); if (R !== L) R.fill(0); return true; }

    // per-block: nonlinear pitch settling
    for (let i = 0; i < this.N; i++) {
      if (this.gl[i] !== 0) {
        this.gl[i] *= this.glDec;
        if (Math.abs(this.gl[i]) < 0.03) this.gl[i] = 0;
        this.coef(i);
      }
    }

    const N = this.N, S = this.S, nc = this.cd.length;
    const e = this.e, eOn = this.eOn, eP = this.eP, eL = this.eL;
    const ec = this.ec, e1 = this.e1, e2 = this.e2;
    const inp = this.inp, drv = this.drv, src = this.src;
    const a1 = this.a1, a2 = this.a2, y1 = this.y1, y2 = this.y2;
    const cd = this.cd, cs = this.cs, cg = this.cg;
    const pL = this.pL, pR = this.pR, noteOf = this.noteOf, eAcc = this.eAcc;

    for (let n = 0; n < nf; n++) {
      // 1. excitation: two cascaded one-poles = compliant contact pulse
      for (let s = 0; s < S; s++) {
        if (eOn[s]) {
          const c = ec[s];
          e2[s] = e2[s] * c + e1[s];
          e1[s] *= c;
          e[s] = e2[s];
          if (++eP[s] >= eL[s]) { eOn[s] = 0; e1[s] = 0; e2[s] = 0; }
        } else e[s] = 0;
      }
      // 2. resonator inputs: direct drive plus sympathetic coupling
      for (let i = 0; i < N; i++) inp[i] = e[src[i]] * drv[i];
      for (let c = 0; c < nc; c++) inp[cd[c]] += y1[cs[c]] * cg[c];
      // 3. run the bank
      let l = 0, r = 0;
      for (let i = 0; i < N; i++) {
        const y = inp[i] - a1[i] * y1[i] - a2[i] * y2[i];
        y2[i] = y1[i]; y1[i] = y;
        l += y * pL[i]; r += y * pR[i];
      }
      // 4. contact tick, straight to the output
      if (this.tickEnv > 1e-5) {
        const x = (Math.random() * 2 - 1) * this.tickEnv;
        const t = this.tb0 * x - this.ta1 * this.nz1 - this.ta2 * this.nz2;
        this.nz2 = this.nz1; this.nz1 = t;
        this.tickEnv *= this.tickDec;
        l += t; r += t;
      }
      const g = this.master, dr = this.dcR;
      const yl = l * g - this.dxL + dr * this.dyL; this.dxL = l * g; this.dyL = yl;
      const yr = r * g - this.dxR + dr * this.dyR; this.dxR = r * g; this.dyR = yr;
      // 5. limiter, then tanh for the last bit of softening
      const mag = (yl < 0 ? -yl : yl) > (yr < 0 ? -yr : yr)
        ? (yl < 0 ? -yl : yl) : (yr < 0 ? -yr : yr);
      const want = mag > this.limCeil ? this.limCeil / mag : 1;
      this.lim = want < this.lim
        ? want + (this.lim - want) * this.limAtk
        : want + (this.lim - want) * this.limRel;
      L[n] = Math.tanh(yl * this.lim);
      R[n] = Math.tanh(yr * this.lim);
    }

    // Per-note vibrational energy, for visuals. This is real modal energy, so
    // sympathetically excited fields light up on their own.
    for (let i = 0; i < N; i++) {
      const nt = noteOf[i];
      if (nt >= 0) {
        const a = y1[i] < 0 ? -y1[i] : y1[i];
        if (a > eAcc[nt]) eAcc[nt] = a;
      }
    }
    if (++this.blockCount >= ENERGY_INTERVAL) {
      this.blockCount = 0;
      this.port.postMessage({ type:'energy', e:this.eAcc });
      this.eAcc.fill(0);
    }
    return true;
  }
}

registerProcessor('handpan', HandpanProcessor);
