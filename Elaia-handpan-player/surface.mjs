import { PUBLISHED_LAYOUTS } from './layouts.mjs';
import { fieldGeometry, fieldShape, portRadius, shellGeometry } from './geometry.mjs';

const TAU = Math.PI * 2;
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = a => { const r = Math.hypot(...a) || 1; return a.map(v => v / r); };
const sourceVector = v => [v[1], v[2], v[0]];
const rotate = (v, c, s) => [v[0] * c - v[2] * s, v[1], v[0] * s + v[2] * c];

function profileTable(points) {
  const count = 4096, values = new Float64Array(count + 1), slopes = new Float64Array(count + 1);
  const derivatives = points.map((p, i) => {
    const a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)];
    return (b[1] - a[1]) / Math.max(1e-8, b[0] - a[0]);
  });
  let index = 0;
  for (let i = 0; i <= count; i++) {
    const r = i / count;
    while (index + 2 < points.length && points[index + 1][0] < r) index++;
    const [a, b] = [points[index], points[index + 1]], span = b[0] - a[0];
    const t = Math.max(0, Math.min(1, (r - a[0]) / span)), t2 = t * t, t3 = t2 * t;
    const ma = derivatives[index], mb = derivatives[index + 1];
    values[i] = (2 * t3 - 3 * t2 + 1) * a[1] + (t3 - 2 * t2 + t) * span * ma
      + (-2 * t3 + 3 * t2) * b[1] + (t3 - t2) * span * mb;
    slopes[i] = ((6 * t2 - 6 * t) * a[1] + (-6 * t2 + 6 * t) * b[1]) / span
      + (3 * t2 - 4 * t + 1) * ma + (3 * t2 - 2 * t) * mb;
  }
  return { values, slopes, count };
}

// A contour lookup retains the measured outlines, including their asymmetry.
// No ellipse approximation is used to shape a published tone field.
function contourTable(points, centre, angle, size, radius) {
  const c = Math.cos(angle), s = Math.sin(angle);
  const local = points.map(([X, Y]) => {
    const x = Y / radius - centre[0], z = X / radius - centre[1];
    return [(x * c + z * s) / size, (-x * s + z * c) / size];
  });
  const count = 256, table = new Float64Array(count);
  for (let j = 0; j < count; j++) {
    const t = j / count * TAU, dx = Math.cos(t), dz = Math.sin(t);
    let distance = Infinity;
    for (let i = 0; i < local.length; i++) {
      const a = local[i], b = local[(i + 1) % local.length];
      const ex = b[0] - a[0], ez = b[1] - a[1], determinant = dx * ez - dz * ex;
      if (Math.abs(determinant) < 1e-10) continue;
      const r = (a[0] * ez - a[1] * ex) / determinant, u = (a[0] * dz - a[1] * dx) / determinant;
      if (r > 0 && u >= 0 && u <= 1) distance = Math.min(distance, r);
    }
    table[j] = Number.isFinite(distance) ? distance : 1;
  }
  return table;
}

// Rounded manufactured caps, with separate first/second tiers. Sampling the
// profile once avoids expensive powers and fillet work during editing.
function capTable(Ru, Rv, height, plateau = 0, dimple = false) {
  const count = 512, reach = 1.3, table = new Float64Array(count + 1);
  const fillet = Math.min(0.12, 0.00115 / Math.min(Ru, Rv));
  const raw = r => {
    if (r >= 1) return 0;
    const value = Math.min(1, (1 - r ** (dimple ? 2.6 : 2)) / (1 - plateau * plateau));
    return height * value ** (dimple ? 1 : 0.78);
  };
  for (let i = 0; i <= count; i++) {
    const r = i / count * reach;
    let sum = 0, weight = 0;
    for (let j = -5; j <= 5; j++) {
      const w = Math.exp(-j * j / 6);
      sum += raw(Math.abs(r + j * fillet / 3)) * w; weight += w;
    }
    table[i] = sum / weight;
  }
  return { Ru, Rv, table, count, reach };
}

export class HandpanSurface {
  constructor(layout) {
    this.port = portRadius(layout);
    this.profile = shellGeometry(layout.arrangement);
    const [edge, height] = this.profile.bottom[0];
    const bottom = this.port < edge ? [
      [this.port, height + 0.018],
      [this.port + (edge - this.port) * 0.16, height + 0.004],
      [this.port + (edge - this.port) * 0.4, height - 0.006],
      ...this.profile.bottom,
    ] : this.profile.bottom;
    this.tables = { top: profileTable(this.profile.top), bottom: profileTable(bottom) };
    this.fields = layout.fields.map(f => this.prepare({ ...f, shape: fieldShape(f, layout) }));
  }

  updateFields(layout) {
    const changes = [], keys = ['x', 'z', 'size', 'angle', 'aspect', 'geometry'];
    layout.fields.forEach((field, index) => {
      const before = this.fields[index], shape = fieldShape(field, layout);
      if (shape === before.shape && keys.every(key => field[key] === before[key])) return;
      const after = this.prepare({ ...field, shape });
      this.fields[index] = after; changes.push({ before, after });
    });
    return changes;
  }

  base(x, z, side) {
    const r = Math.hypot(x, z), table = this.tables[side], at = Math.min(table.count - 1, r * table.count);
    const index = Math.floor(at), mix = at - index;
    const y = table.values[index] * (1 - mix) + table.values[index + 1] * mix;
    const slope = table.slopes[index] * (1 - mix) + table.slopes[index + 1] * mix;
    return [y, r > 1e-8 ? slope * x / r : 0, r > 1e-8 ? slope * z / r : 0];
  }

  prepare(f) {
    const source = fieldGeometry(f.geometry), shape = fieldShape(f);
    const base = this.base(f.x, f.z, f.side), direction = f.side === 'top' ? 1 : -1;
    const result = { ...f, cos: Math.cos(f.angle), sin: Math.sin(f.angle), caps: [],
      py: base[0] - direction * 0.015, px: base[1], pz: base[2], shape };
    if (source) {
      const radius = source.radius, centre = [source.centre[1] / radius, source.centre[0] / radius];
      const [profile] = f.geometry.split('/');
      const row = PUBLISHED_LAYOUTS[profile].fields.find(r => r[0] === source.note && r[1] === source.side);
      const scale = f.size / row[4], angle = f.angle - row[5], c = Math.cos(angle), s = Math.sin(angle);
      const old = this.base(...centre, source.side);
      const plane = source.plane;
      const planeCentre = (plane.a * source.centre[0] + plane.b * source.centre[1] + plane.c - source.rimZ) / radius;
      const slope = rotate([plane.b, 0, plane.a], c, s), oldSlope = rotate([old[1], 0, old[2]], c, s);
      const flipped = f.side === source.side ? 1 : -1;
      result.py = base[0] + (planeCentre - old[0]) * scale * flipped;
      result.px = base[1] + (slope[0] - oldSlope[0]) * flipped;
      result.pz = base[2] + (slope[2] - oldSlope[2]) * flipped;
      result.N = unit([-result.px, 1, -result.pz]);
      const rotatedU = rotate(sourceVector(source.frame.U), c, s);
      result.U = unit(rotatedU.map((v, i) => v - result.N[i] * dot(rotatedU, result.N)));
      result.V = cross(result.N, result.U);
      const offset = rotate([(source.frame.O[1] / radius - centre[0]) * scale, 0,
        (source.frame.O[0] / radius - centre[1]) * scale], c, s);
      result.O = [f.x + offset[0], result.py + result.px * offset[0] + result.pz * offset[2], f.z + offset[2]];
      result.contour = contourTable(source.boundary, centre, row[5], row[4], radius);
      result.shoulder = Math.max(0.009, Math.min(0.065,
        4 * (22 / radius) * Math.abs(planeCentre - old[0]) / (row[4] * row[6]))) * scale;
      const factor = scale / radius, dome = shape === 'dome';
      if (dome && source.tier1) {
        const k = source.tier2 ? Math.min(source.tier2.Ru / source.tier1.Ru, source.tier2.Rv / source.tier1.Rv) : 0;
        result.caps.push(capTable(source.tier1.Ru * factor, source.tier1.Rv * factor, source.h1 * factor, k));
        if (source.tier2) result.caps.push(capTable(source.tier2.Ru * factor, source.tier2.Rv * factor, source.h1 * 0.8 * factor));
      } else if (shape === 'pure' && source.type !== 'pure') {
        result.caps.push(capTable(11 * factor, 11 * factor, 3.8 * factor, 0, true));
      } else if (!dome && source.dimple) {
        result.caps.push(capTable(source.dimple.Ru * factor, source.dimple.Rv * factor, source.dimple.depth * factor, 0, true));
      } else {
        const core = source.tier1 || source.dimple;
        result.caps.push(capTable((core?.Ru || 22) * factor, (core?.Rv || 18) * factor,
          (source.dimple?.depth || source.h1 || 6) * factor, 0, !dome));
      }
    } else {
      result.N = unit([-result.px, 1, -result.pz]);
      result.U = unit([result.cos, result.px * result.cos + result.pz * result.sin, result.sin]);
      result.V = cross(result.N, result.U); result.O = [f.x, result.py, f.z];
      result.shoulder = 0.02;
      result.caps.push(capTable(f.size * 0.28, f.size * (f.aspect ?? 0.82) * 0.28,
        Math.min(0.028, f.size * 0.13), 0, shape !== 'dome'));
    }
    result.sign = direction * (shape === 'dome' ? 1 : -1);
    result.coreReach = Math.max(...result.caps.map(cap => Math.max(cap.Ru, cap.Rv)));
    return result;
  }

  sample(x, z, side, normal = true) {
    const base = this.base(x, z, side), direction = side === 'top' ? 1 : -1;
    let y = base[0], gx = base[1], gz = base[2], chosen = null, border = 0, borderAngle = 0;
    for (const f of this.fields) {
      if (f.side !== side || Math.abs(x - f.x) > f.size * 1.3 || Math.abs(z - f.z) > f.size * 1.3) continue;
      const dx = x - f.x, dz = z - f.z;
      const u = (dx * f.cos + dz * f.sin) / f.size, v = (-dx * f.sin + dz * f.cos) / f.size;
      const r = Math.hypot(u, v);
      let outer, slope = 0;
      if (f.contour) {
        const at = ((Math.atan2(v, u) / TAU + 1) % 1) * f.contour.length;
        const a = Math.floor(at), b = (a + 1) % f.contour.length;
        outer = f.contour[a] + (f.contour[b] - f.contour[a]) * (at - a);
        slope = (f.contour[b] - f.contour[a]) * f.contour.length / TAU;
      } else {
        const aspect = f.aspect ?? 0.82, theta = Math.atan2(v, u);
        outer = 1 / Math.hypot(Math.cos(theta) / aspect, Math.sin(theta));
        slope = (1 / (aspect * aspect) - 1) * Math.cos(theta) * Math.sin(theta) * outer ** 3;
      }
      if (r >= outer) continue;
      chosen = f; border = (outer - r) * f.size; borderAngle = slope;
      break;
    }
    if (!chosen) return [x, y, z, ...unit([-gx * direction, direction, -gz * direction])];
    const f = chosen, dx = x - f.x, dz = z - f.z, length = Math.hypot(dx, dz);
    const fillet = 0.0055, easing = Math.exp(-border / fillet);
    const rawWeight = Math.tanh((border - fillet * (1 - easing)) / f.shoulder);
    let weight = rawWeight, centreBlend = 1, centreSlope = 0;
    // A directional contour has no defined angle at its centre. Blend to the
    // exact field plane there, keeping ray-hit normals stable at any zoom.
    const centreRadius = f.size * 0.08;
    if (length < centreRadius) {
      const t = length / centreRadius;
      centreBlend = t * t * (3 - 2 * t);
      centreSlope = 6 * t * (1 - t) / centreRadius;
      weight = 1 + (rawWeight - 1) * centreBlend;
    }
    const plane = f.py + f.px * dx + f.pz * dz;
    if (normal) {
      const factor = (1 - rawWeight * rawWeight) * (1 - easing) / f.shoulder;
      const localU = dx * f.cos + dz * f.sin, localV = -dx * f.sin + dz * f.cos;
      const ddx = length > 1e-8 ? -dx / length + f.size * borderAngle * (-localV * f.cos - localU * f.sin) / (length * length) : 0;
      const ddz = length > 1e-8 ? -dz / length + f.size * borderAngle * (-localV * f.sin + localU * f.cos) / (length * length) : 0;
      const centreDerivative = (rawWeight - 1) * centreSlope / (length || 1);
      gx += (f.px - gx) * weight + (plane - y) * (factor * ddx * centreBlend + centreDerivative * dx);
      gz += (f.pz - gz) * weight + (plane - y) * (factor * ddz * centreBlend + centreDerivative * dz);
    }
    y += (plane - y) * weight;
    const q = [x - f.O[0], y - f.O[1], z - f.O[2]], u = dot(q, f.U), v = dot(q, f.V);
    let h = 0, hx = 0, hz = 0;
    for (const cap of f.caps) {
      const rn = Math.hypot(u / cap.Ru, v / cap.Rv);
      if (rn >= cap.reach) continue;
      const at = rn / cap.reach * cap.count, i = Math.floor(at), mix = at - i;
      h += (cap.table[i] * (1 - mix) + cap.table[i + 1] * mix) * f.sign;
      if (normal && rn > 1e-8) {
        const derivative = (cap.table[i + 1] - cap.table[i]) * cap.count / cap.reach * f.sign;
        hx += derivative * (u * (f.U[0] + f.U[1] * gx) / cap.Ru ** 2
          + v * (f.V[0] + f.V[1] * gx) / cap.Rv ** 2) / rn;
        hz += derivative * (u * (f.U[2] + f.U[1] * gz) / cap.Ru ** 2
          + v * (f.V[2] + f.V[1] * gz) / cap.Rv ** 2) / rn;
      }
    }
    const px = [1 + f.N[0] * hx, gx + f.N[1] * hx, f.N[2] * hx];
    const pz = [f.N[0] * hz, gz + f.N[1] * hz, 1 + f.N[2] * hz];
    const n = normal ? unit(cross(pz, px)).map(v => v * direction) : [0, direction, 0];
    return [x + f.N[0] * h, y + f.N[1] * h, z + f.N[2] * h, ...n];
  }

  // Caps displace along the field normal, including X/Z. Invert that small
  // displacement when intersecting a screen ray or dragging a field.
  inverse(x, z, side) {
    let u = x, v = z;
    for (let i = 0; i < 4; i++) {
      const p = this.sample(u, v, side, false);
      u += x - p[0]; v += z - p[2];
    }
    return [u, v];
  }

  height(x, z, side) {
    const [u, v] = this.inverse(x, z, side);
    return this.sample(u, v, side, false)[1];
  }
}
