/* Software 3D renderer for the handpan shell.
 *
 * Canvas2D rather than WebGL: the geometry is small (a few hundred quads) and
 * this keeps the whole thing dependency-free and portable. Painter's algorithm
 * with per-quad depth sorting is sufficient because the shell is convex.
 *
 * The shell is a UV sphere-ish dome: the top is a shallow spherical cap, the
 * rim rolls over, and the bottom is a deeper dome with the Helmholtz port at
 * its pole. Tone fields are dimpled inward and drawn as their own ellipses on
 * top of the shading.
 */

const TAU = Math.PI * 2;

/* ---------------------------------------------------------------- vectors -- */
const v3 = (x, y, z) => ({ x, y, z });
const sub = (a, b) => v3(a.x - b.x, a.y - b.y, a.z - b.z);
const cross = (a, b) => v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
function norm (a) {
  const l = Math.hypot(a.x, a.y, a.z) || 1;
  return v3(a.x / l, a.y / l, a.z / l);
}

export class Renderer3D {
  constructor (canvas) {
    this.cv = canvas;
    this.cx = canvas.getContext('2d');
    this.yaw = -0.35;
    this.pitch = -0.62;        // looking down at the top shell
    this.dist = 3.05;
    this.dpr = 1;
    this.W = 0; this.H = 0;
    this.quads = [];
    this.notePos = [];         // screen positions of tone fields, per frame
    this.inst = null;
    this.showBottom = false;
  }

  resize (w, h, dpr) {
    this.dpr = dpr;
    this.W = w; this.H = h;
    this.cv.width = Math.round(w * dpr);
    this.cv.height = Math.round(h * dpr);
    this.cv.style.width = w + 'px';
    this.cv.style.height = h + 'px';
    this.cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // The shell is a wide, shallow disc: seen from a typical camera it needs
    // roughly twice the width it needs height. Scaling by min(W,H) would waste
    // most of the width on a tall phone viewport, so fit both axes to the
    // projected footprint instead.
    this.fit = Math.min(w * 0.46, h * 0.46 / 0.58);
  }

  /* --------------------------------------------------------- shell mesh -- */
  /** Build the shell geometry once per instrument layout. */
  buildMesh (inst) {
    this.inst = inst;
    const NU = 48, NV = 26;       // around, and pole-to-rim
    this.quads = [];

    // A tone field pulls the surface inward near its centre; this returns the
    // radial displacement at a point on the top shell.
    const dimple = (x, z, notes) => {
      let d = 0;
      for (const nt of notes) {
        if (nt.bottom) continue;
        const dx = x - nt.gx, dz = z - nt.gz;
        const r2 = (dx * dx + dz * dz) / (nt.gr * nt.gr);
        if (r2 < 4) d -= nt.depth * Math.exp(-r2 * 1.4);
      }
      return d;
    };

    const surf = (u, v) => {
      // v: 0 = top pole, 1 = rim, 2 = bottom pole (v in 0..2)
      const th = u * TAU;
      let y, rad;
      if (v <= 1) {
        // top: shallow spherical cap
        const a = v * Math.PI * 0.42;
        rad = Math.sin(a) / Math.sin(Math.PI * 0.42);
        y = 0.34 * Math.cos(a);
      } else {
        // bottom: deeper dome
        const t = v - 1;
        const a = (1 - t) * Math.PI * 0.5;
        rad = Math.sin(a);
        y = -0.52 * Math.cos(a);
      }
      const x = Math.cos(th) * rad, z = Math.sin(th) * rad;
      let yy = y;
      if (v <= 1) yy += dimple(x, z, this.inst.notes);
      return v3(x, yy, z);
    };

    for (let i = 0; i < NU; i++) {
      for (let j = 0; j < NV * 2; j++) {
        const u0 = i / NU, u1 = (i + 1) / NU;
        const v0 = (j / NV), v1 = ((j + 1) / NV);
        if (v0 >= 2) continue;
        const a = surf(u0, v0), b = surf(u1, v0), c = surf(u1, v1), d = surf(u0, v1);
        const n = norm(cross(sub(b, a), sub(d, a)));
        this.quads.push({ p:[a, b, c, d], n, bottom: v0 >= 1 });
      }
    }
  }

  /** Place tone fields on the shell in the classic alternating zigzag. */
  layout (inst) {
    const top = inst.notes.filter(n => !n.bottom);
    const bot = inst.notes.filter(n => n.bottom);
    // ding at the centre
    if (top.length) {
      const d = top[0];
      d.gx = 0; d.gz = 0; d.gr = 0.30; d.depth = 0.055; d.ring = 0;
    }
    const rest = top.slice(1);
    // Alternate sides ascending, then walk the ring so neighbours alternate.
    const A = [], B = [];
    rest.forEach((n, i) => (i % 2 ? B : A).push(n));
    const ring = A.concat(B.reverse());
    // For large layouts use two concentric rings so fields do not overlap.
    const twoRings = ring.length > 10;
    const inner = twoRings ? ring.filter((_, i) => i % 2 === 0) : ring;
    const outer = twoRings ? ring.filter((_, i) => i % 2 === 1) : [];
    const place = (list, radius, rr, ringIdx, phase) => {
      list.forEach((nt, k) => {
        const ang = Math.PI / 2 + phase + (k + 0.5) * (TAU / Math.max(1, list.length));
        nt.gx = Math.cos(ang) * radius;
        nt.gz = Math.sin(ang) * radius;
        nt.gr = rr;
        nt.depth = 0.04;
        nt.ring = ringIdx;
        nt.ang = ang;
      });
    };
    if (twoRings) {
      place(inner, 0.44, Math.min(0.19, 1.25 / inner.length), 1, 0);
      place(outer, 0.79, Math.min(0.17, 1.15 / outer.length), 2, 0.3);
    } else {
      place(ring, 0.62, Math.min(0.22, 1.5 / Math.max(6, ring.length)), 1, 0);
    }
    // bottom shell: single ring on the underside
    bot.forEach((nt, k) => {
      const ang = Math.PI / 2 + (k + 0.5) * (TAU / Math.max(1, bot.length));
      nt.gx = Math.cos(ang) * 0.66;
      nt.gz = Math.sin(ang) * 0.66;
      nt.gy = -0.30;
      nt.gr = Math.min(0.17, 1.3 / Math.max(6, bot.length));
      nt.depth = 0.03;
      nt.ring = -1;
      nt.ang = ang;
    });
    // stereo pan follows the x position as seen by the listener
    for (const nt of inst.notes) nt.pan = Math.max(-0.7, Math.min(0.7, nt.gx * 1.1));
    this.buildMesh(inst);
  }

  /* ------------------------------------------------------------ camera -- */
  rotate (dx, dy) {
    this.yaw += dx;
    this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch + dy));
  }
  zoom (f) { this.dist = Math.max(1.9, Math.min(6.5, this.dist * f)); }

  project (p) {
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    // yaw about Y, then pitch about X
    const x1 = p.x * cy - p.z * sy;
    const z1 = p.x * sy + p.z * cy;
    const y2 = p.y * cp - z1 * sp;
    const z2 = p.y * sp + z1 * cp;
    const zc = z2 + this.dist;
    const f = this.fit * 2.0 / Math.max(0.35, zc);
    return { x: this.W / 2 + x1 * f, y: this.H / 2 - y2 * f, z: zc, s: f };
  }

  /** Camera-space normal, for lighting and back-face tests. */
  rotN (n) {
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const x1 = n.x * cy - n.z * sy;
    const z1 = n.x * sy + n.z * cy;
    const y2 = n.y * cp - z1 * sp;
    const z2 = n.y * sp + z1 * cp;
    return v3(x1, y2, z2);
  }

  /* ------------------------------------------------------------- draw -- */
  draw (theme) {
    const c = this.cx;
    c.clearRect(0, 0, this.W, this.H);
    if (!this.inst) return;
    const light = norm(v3(-0.45, 0.8, -0.42));

    // depth-sort quads back to front
    const list = [];
    for (const q of this.quads) {
      const pr = q.p.map(p => this.project(p));
      const zc = (pr[0].z + pr[1].z + pr[2].z + pr[3].z) / 4;
      const n = this.rotN(q.n);
      // back-face cull: the shell is convex, so skip faces pointing away
      const facing = n.z < 0;
      list.push({ pr, zc, n, q, facing });
    }
    list.sort((a, b) => b.zc - a.zc);

    for (const it of list) {
      if (!it.facing) continue;
      const { pr, n, q } = it;
      const lam = Math.max(0, dot(n, light));
      const spec = Math.pow(Math.max(0, -n.z), 14) * 0.5;
      const base = q.bottom ? 26 : 44;
      const lum = base + lam * 92 + spec * 120;
      const r = Math.round(lum * 1.02), g = Math.round(lum * 0.98), b = Math.round(lum * 0.92);
      c.beginPath();
      c.moveTo(pr[0].x, pr[0].y);
      for (let i = 1; i < 4; i++) c.lineTo(pr[i].x, pr[i].y);
      c.closePath();
      c.fillStyle = 'rgb(' + r + ',' + g + ',' + b + ')';
      c.fill();
      // hairline overdraw removes seams between adjacent quads
      c.strokeStyle = 'rgb(' + r + ',' + g + ',' + b + ')';
      c.lineWidth = 0.7;
      c.stroke();
    }

    // rim highlight
    this.drawRim(c);
    // tone fields
    this.notePos = [];
    this.drawFields(c, light, theme);
  }

  drawRim (c) {
    const pts = [];
    for (let i = 0; i <= 72; i++) {
      const th = i / 72 * TAU;
      pts.push(this.project(v3(Math.cos(th), 0, Math.sin(th))));
    }
    c.beginPath();
    pts.forEach((p, i) => i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y));
    c.closePath();
    c.strokeStyle = 'rgba(226,190,120,0.34)';
    c.lineWidth = 1.4;
    c.stroke();
  }

  drawFields (c, light, theme) {
    const notes = this.inst.notes;
    // sort by depth so nearer fields draw last
    const order = notes.map((nt, i) => {
      const y = nt.bottom ? nt.gy : this.surfaceY(nt.gx, nt.gz);
      const p = this.project(v3(nt.gx, y, nt.gz));
      const nrm = this.rotN(norm(v3(nt.gx * 0.55, nt.bottom ? -1 : 1, nt.gz * 0.55)));
      return { nt, p, nrm, i };
    });
    order.sort((a, b) => b.p.z - a.p.z);

    for (const o of order) {
      const { nt, p, nrm } = o;
      // Hide fields on the far side of the shell.
      if (nrm.z > 0.12) { this.notePos.push(null); continue; }
      const vis = Math.min(1, Math.max(0, -nrm.z * 2.2));
      const rr = nt.gr * p.s * 0.94;
      // foreshorten into an ellipse along the surface tangent
      const ry = rr * Math.max(0.18, Math.abs(nrm.z));
      const rot = Math.atan2(p.y - this.H / 2, p.x - this.W / 2) + Math.PI / 2;

      const act = Math.max(nt.flash, Math.min(1, nt.energy * 2.4));
      const lam = Math.max(0, dot(nrm, light));

      c.save();
      c.translate(p.x, p.y);
      c.rotate(rot);
      // field basin
      const g = c.createRadialGradient(-rr * 0.25, -ry * 0.3, rr * 0.04, 0, 0, rr);
      const lift = 0.16 + act * 0.62;
      g.addColorStop(0, 'rgba(' + Math.round(150 + act * 100) + ',' +
                          Math.round(158 + act * 76) + ',172,' + (0.5 + lift * 0.5) + ')');
      g.addColorStop(0.62, 'rgba(' + Math.round(66 + lam * 40) + ',' +
                           Math.round(72 + lam * 40) + ',82,' + (0.42 + act * 0.34) + ')');
      g.addColorStop(1, 'rgba(22,26,31,0.10)');
      c.beginPath();
      c.ellipse(0, 0, rr, ry, 0, 0, TAU);
      c.fillStyle = g;
      c.fill();
      c.strokeStyle = 'rgba(226,190,120,' + (0.20 * vis + act * 0.6) + ')';
      c.lineWidth = 1.2;
      c.stroke();
      // dimple
      c.beginPath();
      c.ellipse(0, 0, rr * 0.28, ry * 0.28, 0, 0, TAU);
      c.fillStyle = 'rgba(11,14,17,' + (0.42 + 0.2 * vis) + ')';
      c.fill();
      c.strokeStyle = 'rgba(255,255,255,0.10)';
      c.lineWidth = 0.8;
      c.stroke();
      // ring pulse on strike
      if (nt.flash > 0.02) {
        const t = 1 - nt.flash;
        c.beginPath();
        c.ellipse(0, 0, rr * (1 + t * 1.5), ry * (1 + t * 1.5), 0, 0, TAU);
        c.strokeStyle = 'rgba(217,164,65,' + (0.5 * nt.flash) + ')';
        c.lineWidth = 1.6 * nt.flash + 0.3;
        c.stroke();
      }
      c.restore();

      // label, upright in screen space
      if (vis > 0.25) {
        const fs = Math.max(9, Math.min(22, rr * 0.62));
        c.font = (nt.ring === 0 ? '600 ' : '500 ') + fs + 'px ' + (theme.font || 'sans-serif');
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillStyle = 'rgba(16,19,23,0.55)';
        c.fillText(nt.name, p.x + 1, p.y + ry * 0.62 + 1);
        c.fillStyle = 'rgba(242,238,228,' + (0.55 * vis + act * 0.45) + ')';
        c.fillText(nt.name, p.x, p.y + ry * 0.62);
      }
      this.notePos.push({ nt, x: p.x, y: p.y, rr, ry, rot, vis });
    }
  }

  /** Top-shell surface height at (x,z), including dimples. */
  surfaceY (x, z) {
    const rad = Math.hypot(x, z);
    const a = Math.asin(Math.min(1, rad * Math.sin(Math.PI * 0.42))) / (Math.PI * 0.42);
    let y = 0.34 * Math.cos(a * Math.PI * 0.42);
    for (const nt of this.inst.notes) {
      if (nt.bottom) continue;
      const dx = x - nt.gx, dz = z - nt.gz;
      const r2 = (dx * dx + dz * dz) / (nt.gr * nt.gr);
      if (r2 < 4) y -= nt.depth * Math.exp(-r2 * 1.4);
    }
    return y;
  }

  /** Hit-test a screen point against the drawn tone fields. */
  pick (sx, sy) {
    let best = null, bd = 1e9;
    for (const np of this.notePos) {
      if (!np || np.vis < 0.25) continue;
      // transform into the ellipse's local frame
      const dx = sx - np.x, dy = sy - np.y;
      const ca = Math.cos(-np.rot), sa = Math.sin(-np.rot);
      const lx = dx * ca - dy * sa, ly = dx * sa + dy * ca;
      const d = Math.hypot(lx / np.rr, ly / np.ry);
      if (d < 1.25 && d < bd) { bd = d; best = { nt: np.nt, pos: Math.min(1, d) }; }
    }
    return best;
  }

  /** True when the point is on the shell but not on any field (a "tak"). */
  onShell (sx, sy) {
    const p = this.project(v3(0, 0, 0));
    const r = this.fit * 2.0 / Math.max(0.35, this.dist);
    return Math.hypot(sx - p.x, sy - p.y) < r * 1.05;
  }
}
