// Native WebGL. Published geometry is sculpted locally; high-precision normal
// maps are baked from that same surface, with no texture/environment downloads.
import { HandpanSurface } from './surface.mjs';
const TAU = Math.PI * 2;
const subtract = (a, b) => a.map((v, i) => v - b[i]);
const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const normalize = a => { const l = Math.hypot(...a) || 1; return a.map(v => v / l); };
const identity = () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

function multiply(a, b) {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1]
      + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  }
  return out;
}

function transform(m, v) {
  const out = Array(4).fill(0);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) out[r] += m[c * 4 + r] * v[c];
  return out;
}

function inverse(m) {
  const rows = Array.from({ length: 4 }, (_, r) => [...Array.from({ length: 4 }, (_, c) => m[c * 4 + r]), ...Array.from({ length: 4 }, (_, c) => +(r === c))]);
  for (let c = 0; c < 4; c++) {
    let best = c;
    for (let r = c + 1; r < 4; r++) if (Math.abs(rows[r][c]) > Math.abs(rows[best][c])) best = r;
    [rows[c], rows[best]] = [rows[best], rows[c]];
    const scale = rows[c][c];
    if (Math.abs(scale) < 1e-10) return identity();
    rows[c] = rows[c].map(v => v / scale);
    for (let r = 0; r < 4; r++) if (r !== c) {
      const amount = rows[r][c];
      rows[r] = rows[r].map((v, i) => v - amount * rows[c][i]);
    }
  }
  return Float32Array.from(Array.from({ length: 16 }, (_, i) => rows[i % 4][4 + Math.floor(i / 4)]));
}

function lookAt(eye) {
  const z = normalize(eye);
  const x = normalize(cross([0, 1, 0], z)), y = cross(z, x);
  return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1]);
}

const VERTEX = `
attribute vec3 aPosition;
attribute vec3 aNormal;
attribute vec3 aDetail;
uniform mat4 uVP;
varying vec3 vPosition;
varying vec3 vNormal;
varying vec3 vDetail;
void main() {
  vPosition = aPosition;
  vNormal = aNormal;
  vDetail = aDetail;
  gl_Position = uVP * vec4(aPosition, 1.0);
}`;

const FRAGMENT = `
precision highp float;
varying vec3 vPosition;
varying vec3 vNormal;
varying vec3 vDetail;
uniform vec3 uEye;
uniform vec3 uColor;
uniform float uRoughness;
uniform sampler2D uNormals;
uniform float uMapped;
uniform float uNormalSize;
uniform float uTime;
uniform float uEdit;
uniform vec4 uSelection;
uniform vec2 uSelectionRotation;
uniform float uSelectionAspect;
uniform vec4 uHits[12];
uniform vec4 uStrikeFields[12];
uniform float uStrikeAspect[12];
uniform vec3 uHiddenCenters[12];
uniform vec4 uHiddenAxes[12];
uniform vec3 uPixelSpace;

float hash(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}
float softbox(vec2 p, vec2 centre, vec2 size, float softness) {
  vec2 d = abs(p - centre) - size;
  return 1.0 - smoothstep(-softness, softness, max(d.x, d.y));
}
vec3 environment(vec3 r, float rough) {
  // Rectangular studio panels give steel distinct reflected edges. Their
  // penumbra approximates roughness filtering without an HDR texture download.
  vec3 q = vec3(r.x, abs(r.y), r.z);
  vec2 ceiling = q.xz / max(q.y, 0.06);
  float softness = 0.09 + rough * 1.1;
  float key = softbox(ceiling, vec2(-1.05, 0.65), vec2(0.52, 1.65), softness);
  float strip = softbox(ceiling, vec2(1.4, -0.3), vec2(0.12, 1.9), softness * 0.65);
  float fill = softbox(ceiling, vec2(0.2, -1.85), vec2(0.95, 0.5), softness * 1.5);
  float edge = pow(max(0.0, dot(q, normalize(vec3(-1.9, 0.18, -0.8)))), 65.0);
  float broad = pow(max(0.0, dot(q, normalize(vec3(-0.9, 1.5, 1.1)))), 5.0);
  vec3 room = mix(vec3(0.025, 0.023, 0.02), vec3(0.14, 0.15, 0.13), q.y);
  return room + vec3(1.35, 1.2, 0.94) * broad + vec3(1.5, 1.35, 1.1) * key
    + vec3(0.9, 1.0, 1.08) * strip + vec3(0.65, 0.75, 0.78) * fill
    + vec3(1.7, 1.35, 0.85) * edge;
}
vec3 filmic(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}
void main() {
  vec3 N = normalize(vNormal);
  if (uMapped > 0.5 && vDetail.z < 0.5) {
    vec2 uv = clamp(vDetail.xy * 0.5 + 0.5, vec2(0.5 / uNormalSize), vec2(1.0 - 0.5 / uNormalSize));
    uv.y = uv.y * 0.5 + (vDetail.z < -0.5 ? 0.5 : 0.0);
    vec4 encodedNormal = texture2D(uNormals, uv);
    vec2 oct = ((encodedNormal.rg * 65280.0 + encodedNormal.ba * 255.0) / 65535.0) * 2.0 - 1.0;
    vec3 decoded = vec3(oct, 1.0 - abs(oct.x) - abs(oct.y));
    if (decoded.z < 0.0) decoded.xy = (1.0 - abs(decoded.yx)) * sign(decoded.xy);
    N = normalize(decoded.xzy) * (vDetail.z < -0.5 ? -1.0 : 1.0);
  }
  vec3 V = normalize(uEye - vPosition);
  // Fine hammered grain breaks up reflections without a texture map.
  float grain = hash(floor(vPosition * 760.0));
  vec3 brushing = vec3(sin(vPosition.z * 360.0), 0.0, sin(vPosition.x * 410.0));
  N = normalize(N + brushing * 0.0013 + (grain - 0.5) * 0.002);
  float rough = clamp(uRoughness + (grain - 0.5) * 0.025, 0.1, 0.6);
  vec3 R = reflect(-V, N);
  float nv = max(dot(N, V), 0.0);
  vec3 fresnel = uColor + (vec3(1.0) - uColor) * pow(1.0 - nv, 5.0);
  vec3 color = environment(R, rough) * fresnel;
  float diffuse = max(dot(N, normalize(vec3(-0.6, 2.0, 1.0))), 0.0);
  color += uColor * (0.03 + diffuse * 0.065);
  // The polished inner dimple catches a small, sharper highlight.
  color += fresnel * pow(max(0.0, dot(N, normalize(V + normalize(vec3(-0.9, 1.5, 1.1))))), 110.0) * 0.3;
  if (uEdit > 0.5 && uSelection.z > 0.0 && vPosition.y * uSelection.w > 0.0) {
    vec2 offset = vPosition.xz - uSelection.xy;
    float radius = length(vec2(
      dot(offset, uSelectionRotation) / (uSelection.z * uSelectionAspect),
      dot(offset, vec2(-uSelectionRotation.y, uSelectionRotation.x)) / uSelection.z));
    float rim = exp(-pow((radius - 0.91) * 32.0, 2.0));
    float inside = exp(-pow(radius / 0.9, 8.0));
    color += vec3(0.7, 0.8, 0.34) * rim + vec3(0.04, 0.055, 0.015) * inside;
  }
  for (int i = 0; i < 12; i++) {
    float age = uTime - uHits[i].y;
    bool ownShell = vPosition.y * uStrikeFields[i].w > 0.0;
    bool throughShell = !ownShell && uHiddenCenters[i].z > 0.5 && vDetail.z < 0.5;
    if (uHits[i].x > 0.5 && age >= 0.0 && age < 1.6 && (ownShell || throughShell)) {
      float fade = exp(-age * 3.5);
      if (throughShell) {
        // Project the hidden field itself, including its depth. The same X/Z
        // on the visible shell appears elsewhere when the instrument tilts.
        vec2 screen = vec2(gl_FragCoord.x * uPixelSpace.x,
          uPixelSpace.z - gl_FragCoord.y * uPixelSpace.y);
        vec2 offset = screen - uHiddenCenters[i].xy;
        float radius = length(vec2(dot(offset, uHiddenAxes[i].xy),
          dot(offset, uHiddenAxes[i].zw)));
        float mask = 1.0 - smoothstep(0.45, 0.9, radius);
        float halo = exp(-pow((radius - 0.5 - age * 0.12) * 9.0, 2.0));
        color = mix(color, vec3(0.025, 0.09, 0.16), fade * mask * 0.3);
        color += fade * mask * vec3(0.35, 0.7, 1.4) * (0.12 + halo * 0.5);
      } else {
        vec2 offset = vPosition.xz - uStrikeFields[i].xy;
        float radius = length(vec2(
          dot(offset, uHits[i].zw) / (uStrikeFields[i].z * uStrikeAspect[i]),
          dot(offset, vec2(-uHits[i].w, uHits[i].z)) / uStrikeFields[i].z));
        float wave = exp(-pow((radius - age * 1.25) * 14.0, 2.0));
        float rim = exp(-pow((radius - 0.91) * 32.0, 2.0));
        float mask = 1.0 - smoothstep(1.0, 1.2, radius);
        color += fade * mask * vec3(1.35, 0.8, 0.31) * (0.26 + rim * 0.6 + wave * 0.4);
      }
    }
  }
  if (vDetail.z > 0.5 && vDetail.z < 1.5) color *= 1.16;
  // Soft filmic compression and display gamma.
  color = filmic(color * 1.1);
  color = pow(max(color, vec3(0.0)), vec3(1.0 / 2.2));
  gl_FragColor = vec4(color, 1.0);
}`;

export class HandpanRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl', { alpha: true, antialias: true, powerPreference: 'low-power', preserveDrawingBuffer: true });
    if (!this.gl) throw new Error('WebGL unavailable');
    const gl = this.gl;
    const shader = (type, source) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, source); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    this.program = gl.createProgram();
    const vs = shader(gl.VERTEX_SHADER, VERTEX), fs = shader(gl.FRAGMENT_SHADER, FRAGMENT);
    gl.attachShader(this.program, vs); gl.attachShader(this.program, fs); gl.linkProgram(this.program);
    gl.deleteShader(vs); gl.deleteShader(fs);
    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(this.program));
    this.uniforms = Object.fromEntries(['uNormals', 'uMapped', 'uNormalSize', 'uVP', 'uEye', 'uColor', 'uRoughness', 'uTime', 'uEdit', 'uSelection', 'uSelectionRotation', 'uSelectionAspect', 'uHits[0]', 'uStrikeFields[0]', 'uStrikeAspect[0]', 'uHiddenCenters[0]', 'uHiddenAxes[0]', 'uPixelSpace'].map(n => [n, gl.getUniformLocation(this.program, n)]));
    this.attributes = Object.fromEntries(['aPosition', 'aNormal', 'aDetail'].map(n => [n, gl.getAttribLocation(this.program, n)]));
    this.normalTexture = gl.createTexture();
    this.buffer = gl.createBuffer();
    this.indexBuffer = gl.createBuffer();
    this.largeIndices = !!gl.getExtension('OES_element_index_uint');
    this.width = 1; this.height = 1;
    this.pitch = 1.12; this.yaw = -0.12; this.zoom = 1;
    this.view = 'top'; this.targetPitch = this.pitch;
    this.hits = new Float32Array(48);
    this.strikeFields = new Float32Array(48);
    this.strikeAspect = new Float32Array(12).fill(0.82);
    this.hiddenHits = new Float32Array(12);
    this.hiddenCenters = new Float32Array(36);
    this.hiddenAxes = new Float32Array(48);
    for (let i = 0; i < 12; i++) this.hits[i * 4] = -1;
    this.hitIndex = 0; this.layout = null; this.selected = null; this.edit = false;
    this.dirty = true; this.activeUntil = 0; this.positions = [];
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); this.lost = true; });
    canvas.addEventListener('webglcontextrestored', () => location.reload());
  }

  resize(width, height) {
    const wasMobile = this.width < 650;
    this.width = Math.max(1, width); this.height = Math.max(1, height);
    // Cap pixel work on high-density phones.
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(width * dpr); this.canvas.height = Math.round(height * dpr);
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    if (this.layout && wasMobile !== (width < 650)) this.build(this.layout);
    this.dirty = true;
  }

  baseHeight(x, z, side = 'top') { return this.surfaceModel.base(x, z, side)[0]; }

  heightAt(x, z, side) { return this.surfaceModel.height(x, z, side); }

  vertexAt(x, z, side) { return [...this.surfaceModel.sample(x, z, side), x, z, side === 'bottom' ? -1 : 0]; }

  normalCacheKey(layout, size) {
    return JSON.stringify([layout.arrangement, layout.fields.map(f =>
      [f.id, f.side, f.x, f.z, f.size, f.angle, f.aspect, f.geometry, f.shape]), size]);
  }

  writeNormals({ side, left, top, right, bottom }, upload = false) {
    const size = this.normalSize, bytes = this.normalPixels;
    const patch = upload ? new Uint8Array((right - left) * (bottom - top) * 4) : null;
    for (let row = top; row < bottom; row++) {
      const z = (row + 0.5) / size * 2 - 1;
      for (let col = left; col < right; col++) {
        const x = (col + 0.5) / size * 2 - 1;
        const p = this.surfaceModel.sample(x, z, side ? 'bottom' : 'top');
        const sum = Math.abs(p[3]) + Math.abs(p[4]) + Math.abs(p[5]);
        const direction = side ? -1 : 1;
        let nx = p[3] / sum * direction, ny = p[5] / sum * direction;
        if (p[4] * direction < 0) {
          const old = nx;
          nx = (1 - Math.abs(ny)) * (nx >= 0 ? 1 : -1);
          ny = (1 - Math.abs(old)) * (ny >= 0 ? 1 : -1);
        }
        const a = Math.round((nx * 0.5 + 0.5) * 65535), b = Math.round((ny * 0.5 + 0.5) * 65535);
        const offset = ((side * size + row) * size + col) * 4;
        bytes[offset] = a >> 8; bytes[offset + 1] = b >> 8;
        bytes[offset + 2] = a & 255; bytes[offset + 3] = b & 255;
      }
      if (patch) {
        const start = ((side * size + row) * size + left) * 4;
        patch.set(bytes.subarray(start, start + (right - left) * 4), (row - top) * (right - left) * 4);
      }
    }
    if (patch) {
      this.gl.texSubImage2D(this.gl.TEXTURE_2D, 0, left, top + side * size,
        right - left, bottom - top, this.gl.RGBA, this.gl.UNSIGNED_BYTE, patch);
    }
  }

  bakeNormals(size) {
    this.normalSize = size;
    this.normalPixels = new Uint8Array(size * size * 8);
    for (let side = 0; side < 2; side++) this.writeNormals({ side, left: 0, top: 0, right: size, bottom: size });
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.normalTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size * 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, this.normalPixels);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  indexVertices() {
    this.vertexBins = Array.from({ length: 2 }, () => Array.from({ length: 32 * 32 }, () => []));
    for (let id = 0; id < this.vertexCount; id++) {
      const at = id * 9, detail = this.meshVertices[at + 8];
      if (detail > 0.5) continue; // The rim and gu wall do not move with fields.
      const x = Math.max(0, Math.min(31, Math.floor((this.meshVertices[at + 6] + 1) * 16)));
      const z = Math.max(0, Math.min(31, Math.floor((this.meshVertices[at + 7] + 1) * 16)));
      this.vertexBins[detail < -0.5 ? 1 : 0][z * 32 + x].push(id);
    }
  }

  updateInteractive(layout, size) {
    if (!this.meshVertices || !this.normalPixels || size !== this.normalSize
        || layout.arrangement !== this.surfaceArrangement
        || layout.fields.length !== this.geometryFields.length
        || layout.fields.some((f, i) => f.id !== this.geometryFields[i].id || f.side !== this.geometryFields[i].side)) return false;
    const started = performance.now(), changes = this.surfaceModel.updateFields(layout);
    if (!changes.length) { this.dirty = true; return true; }
    const rectangles = [], ids = new Set();
    for (const { before, after } of changes) {
      const regions = [before, after].map(f => {
        const reach = f.size * 1.3 + 2 / size;
        return { side: f.side === 'bottom' ? 1 : 0,
          left: Math.max(0, Math.floor((f.x - reach + 1) * size / 2)),
          right: Math.min(size, Math.ceil((f.x + reach + 1) * size / 2)),
          top: Math.max(0, Math.floor((f.z - reach + 1) * size / 2)),
          bottom: Math.min(size, Math.ceil((f.z + reach + 1) * size / 2)) };
      });
      const [a, b] = regions;
      if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) {
        rectangles.push({ side: a.side, left: Math.min(a.left, b.left), right: Math.max(a.right, b.right),
          top: Math.min(a.top, b.top), bottom: Math.max(a.bottom, b.bottom) });
      } else rectangles.push(...regions);
    }
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.normalTexture);
    let texels = 0;
    for (const rect of rectangles) {
      this.writeNormals(rect, true); texels += (rect.right - rect.left) * (rect.bottom - rect.top);
      const left = Math.max(0, Math.floor(rect.left / size * 32));
      const right = Math.min(31, Math.floor(rect.right / size * 32));
      const top = Math.max(0, Math.floor(rect.top / size * 32));
      const bottom = Math.min(31, Math.floor(rect.bottom / size * 32));
      for (let z = top; z <= bottom; z++) for (let x = left; x <= right; x++)
        this.vertexBins[rect.side][z * 32 + x].forEach(id => ids.add(id));
    }
    const ordered = [...ids].sort((a, b) => a - b), data = this.meshVertices;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    let start, end;
    const upload = () => {
      if (start !== undefined) gl.bufferSubData(gl.ARRAY_BUFFER, start * 36, data.subarray(start * 9, (end + 1) * 9));
    };
    for (const id of ordered) {
      const at = id * 9;
      data.set(this.vertexAt(data[at + 6], data[at + 7], data[at + 8] < -0.5 ? 'bottom' : 'top'), at);
      if (start === undefined) start = id;
      else if (id > end + 24) { upload(); start = id; }
      end = id;
    }
    upload();
    this.normalKey = this.normalCacheKey(layout, size);
    this.lastUpdate = { texels, vertices: ids.size, milliseconds: performance.now() - started, rectangles };
    this.dirty = true;
    return true;
  }

  refineCaps(vertices, indices, passes, mobile) {
    const limit = this.largeIndices ? Infinity : 52000;
    const key = (a, b) => a < b ? `${a}/${b}` : `${b}/${a}`;
    let triangles = indices;
    for (let pass = 0; pass < passes; pass++) {
      const mids = new Map();
      for (let i = 0; i < triangles.length; i += 3) {
        const a = triangles[i], b = triangles[i + 1], c = triangles[i + 2];
        const x = (vertices[a * 9 + 6] + vertices[b * 9 + 6] + vertices[c * 9 + 6]) / 3;
        const z = (vertices[a * 9 + 7] + vertices[b * 9 + 7] + vertices[c * 9 + 7]) / 3;
        const side = vertices[a * 9 + 8] < -0.5 ? 'bottom' : 'top';
        const length = (u, v) => Math.hypot(vertices[u * 9 + 6] - vertices[v * 9 + 6],
          vertices[u * 9 + 7] - vertices[v * 9 + 7]);
        const largest = Math.max(length(a, b), length(b, c), length(c, a));
        if (largest < (mobile ? 0.007 : 0.005)) continue;
        const detailed = this.geometryFields.some(f => f.side === side
          && Math.hypot(x - f.O[0], z - f.O[2]) < f.coreReach * 1.35 + largest);
        if (!detailed) continue;
        for (const [u, v] of [[a, b], [b, c], [c, a]]) {
          const id = key(u, v);
          if (mids.has(id) || vertices.length / 9 >= limit) continue;
          const mx = (vertices[u * 9 + 6] + vertices[v * 9 + 6]) / 2;
          const mz = (vertices[u * 9 + 7] + vertices[v * 9 + 7]) / 2;
          mids.set(id, vertices.length / 9); vertices.push(...this.vertexAt(mx, mz, side));
        }
      }
      if (!mids.size) break;
      const next = [];
      for (let i = 0; i < triangles.length; i += 3) {
        const [a, b, c] = triangles.slice(i, i + 3);
        const ab = mids.get(key(a, b)), bc = mids.get(key(b, c)), ca = mids.get(key(c, a));
        // Neighbouring triangles share every new edge vertex. The green splits
        // below prevent cracks where the finely sampled caps meet the shell.
        if (ab !== undefined && bc !== undefined && ca !== undefined) next.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
        else if (ab !== undefined && bc !== undefined) next.push(b, bc, ab, ab, bc, c, ab, c, a);
        else if (ab !== undefined && ca !== undefined) next.push(a, ab, ca, ab, b, c, ab, c, ca);
        else if (bc !== undefined && ca !== undefined) next.push(c, ca, bc, ca, a, b, ca, b, bc);
        else if (ab !== undefined) next.push(a, ab, c, ab, b, c);
        else if (bc !== undefined) next.push(b, bc, a, bc, c, a);
        else if (ca !== undefined) next.push(c, ca, b, ca, a, b);
        else next.push(a, b, c);
      }
      triangles = next;
    }
    return triangles;
  }

  build(layout) {
    this.layout = layout;
    const size = Math.min(this.width < 650 ? 768 : 1024, this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE) / 2);
    if (this.interactive && this.updateInteractive(layout, size)) return;
    this.surfaceModel = new HandpanSurface(layout);
    this.geometryFields = this.surfaceModel.fields;
    this.surfaceArrangement = layout.arrangement;
    this.mappedNormals = true;
    const key = this.normalCacheKey(layout, size);
    if (key !== this.normalKey) { this.bakeNormals(size); this.normalKey = key; }
    const vertices = [];
    let indices = [];
    const push = (a, b, c) => {
      const start = vertices.length / 9;
      vertices.push(...a, ...b, ...c); indices.push(start, start + 1, start + 2);
    };
    // Indexed geometry shares vertices, providing finer silhouettes and normals
    // while using less memory than the previous unindexed mesh.
    const mobile = this.width < 650;
    const segments = this.largeIndices ? (mobile ? 192 : 256) : 144;
    const rings = this.largeIndices ? (mobile ? 112 : 144) : 80;
    for (const side of ['top', 'bottom']) {
      const start = side === 'bottom' ? this.surfaceModel.port : 0;
      const offset = vertices.length / 9;
      for (let i = 0; i <= rings; i++) {
        const rad = start + (1 - start) * i / rings;
        for (let j = 0; j <= segments; j++) {
          const angle = j / segments * TAU;
          vertices.push(...this.vertexAt(Math.cos(angle) * rad, Math.sin(angle) * rad, side));
          if (i > 0 && j < segments) {
            const a = offset + (i - 1) * (segments + 1) + j, b = a + segments + 1;
            if (side === 'top') {
              indices.push(a, b + 1, b);
              if (i > 1 || start > 0) indices.push(a, a + 1, b + 1);
            } else {
              indices.push(a, b, b + 1);
              if (i > 1 || start > 0) indices.push(a, b + 1, a + 1);
            }
          }
        }
      }
    }
    indices = this.refineCaps(vertices, indices, 1, mobile);
    // Rolled outer edge connects the shells; a dark equatorial seam adds depth.
    const rimVertex = (a, b) => {
      const rad = 1.002 + Math.cos(b) * 0.012;
      const y = Math.sin(b) * 0.02;
      return [Math.cos(a) * rad, y, Math.sin(a) * rad,
        Math.cos(a) * Math.cos(b), Math.sin(b), Math.sin(a) * Math.cos(b), 0, 0, 1];
    };
    for (let j = 0; j < 160; j++) for (let k = 0; k < 12; k++) {
      const a = j / 160 * TAU, b = k / 12 * TAU;
      const a1 = (j + 1) / 160 * TAU, b1 = (k + 1) / 12 * TAU;
      push(rimVertex(a, b), rimVertex(a1, b1), rimVertex(a1, b));
      push(rimVertex(a, b), rimVertex(a, b1), rimVertex(a1, b1));
    }
    // Inner wall of the bottom-shell gu port.
    for (let j = 0; j < 100; j++) {
      const a = j / 100 * TAU, b = (j + 1) / 100 * TAU;
      const point = (angle, rad, y) => [Math.cos(angle) * rad, y, Math.sin(angle) * rad,
        -Math.cos(angle), -0.1, -Math.sin(angle), 0, 0, 2];
      const port = this.surfaceModel.port, y = this.baseHeight(port, 0, 'bottom');
      push(point(a, port, y), point(b, port, y), point(b, port - 0.015, y + 0.11));
      push(point(a, port, y), point(b, port - 0.015, y + 0.11), point(a, port - 0.015, y + 0.11));
    }
    this.vertexCount = vertices.length / 9;
    this.meshVertices = new Float32Array(vertices);
    this.indexVertices();
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.meshVertices, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, this.largeIndices ? new Uint32Array(indices) : new Uint16Array(indices), gl.STATIC_DRAW);
    this.indexCount = indices.length;
    this.dirty = true;
  }

  camera() {
    const mobile = this.width < 620;
    const available = Math.min(this.width * (mobile ? 0.84 : 0.81), (this.height - (this.height < 400 ? 110 : 165)) * 1.02);
    const distance = this.height / Math.max(available, 100) / Math.tan(19 * Math.PI / 180) / this.zoom;
    this.eye = [Math.sin(this.yaw) * Math.cos(this.pitch) * distance,
      Math.sin(this.pitch) * distance, Math.cos(this.yaw) * Math.cos(this.pitch) * distance];
    const f = 1 / Math.tan(19 * Math.PI / 180), aspect = this.width / this.height;
    const projection = new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, mobile ? 0.04 : -0.14, -1.002, -1, 0, 0, -0.2002, 0]);
    this.vp = multiply(projection, lookAt(this.eye));
    this.invVP = inverse(this.vp);
  }

  setView(view) {
    this.view = view;
    if (view === 'top') this.targetPitch = 1.12;
    if (view === 'bottom') this.targetPitch = -1.12;
    if (view === 'free') this.targetPitch = this.pitch;
    this.dirty = true;
  }

  reset() { this.yaw = -0.12; this.zoom = 1; this.setView(this.view === 'bottom' ? 'bottom' : 'top'); }
  orbit(dx, dy) {
    this.yaw -= dx * 0.007;
    this.pitch = Math.max(-1.48, Math.min(1.48, this.pitch + dy * 0.007));
    this.targetPitch = this.pitch; this.view = 'free'; this.dirty = true;
  }
  setZoom(zoom) { this.zoom = Math.max(0.7, Math.min(1.65, zoom)); this.dirty = true; }

  strike(id, time = performance.now() / 1000) {
    const index = this.layout.fields.findIndex(f => f.id === id);
    if (index < 0) return;
    const field = this.layout.fields[index];
    const offset = (this.hitIndex++ % 12) * 4;
    this.hits.set([index + 1, time, Math.cos(field.angle), Math.sin(field.angle)], offset);
    this.strikeFields.set([field.x, field.z, field.size, field.side === 'top' ? 1 : -1], offset);
    this.strikeAspect[offset / 4] = field.aspect ?? 0.82;
    this.activeUntil = time + 1.65; this.dirty = true;
  }

  project(point) {
    const p = transform(this.vp, [...point, 1]);
    return { x: (p[0] / p[3] + 1) * this.width / 2, y: (1 - p[1] / p[3]) * this.height / 2, depth: p[2] / p[3] };
  }

  updatePositions() {
    this.positions = this.layout.fields.map(f => {
      const sample = this.surfaceModel.sample(f.x, f.z, f.side);
      const p = sample.slice(0, 3), normal = sample.slice(3, 6);
      const direction = normalize(subtract(this.eye, p));
      const facing = dot(normal, direction);
      const center = this.project(p);
      const edge = this.project(this.surfaceModel.sample(f.x + f.size, f.z, f.side).slice(0, 3));
      return { ...center, field: f, visible: facing > 0.025, radius: Math.max(12, Math.hypot(edge.x - center.x, edge.y - center.y)) };
    });
  }

  ray(x, y) {
    const ndc = [x / this.width * 2 - 1, 1 - y / this.height * 2];
    const a = transform(this.invVP, [...ndc, -1, 1]), b = transform(this.invVP, [...ndc, 1, 1]);
    const origin = a.slice(0, 3).map(v => v / a[3]), far = b.slice(0, 3).map(v => v / b[3]);
    return { origin, direction: normalize(subtract(far, origin)) };
  }

  surfacePoint(x, y) {
    if (!this.invVP) return null;
    const { origin, direction } = this.ray(x, y);
    // Restrict marching to the instrument's bounding sphere. Test both shells:
    // camera height alone cannot tell which face is visible in an angled view.
    const b = dot(origin, direction), c = dot(origin, origin) - 1.18 ** 2;
    const discriminant = b * b - c;
    if (discriminant < 0) return null;
    const near = Math.max(0, -b - Math.sqrt(discriminant)), far = -b + Math.sqrt(discriminant);
    const step = (far - near) / 180;
    const evaluate = (t, side) => {
      const p = origin.map((v, i) => v + direction[i] * t);
      return { p, r: Math.hypot(p[0], p[2]),
        error: (p[1] - this.heightAt(p[0], p[2], side)) * (side === 'top' ? 1 : -1) };
    };
    const previous = Object.fromEntries(['top', 'bottom'].map(side => [side, evaluate(near, side)]));
    for (let i = 1; i <= 180; i++) {
      const t = near + step * i;
      let hit = null;
      for (const side of ['top', 'bottom']) {
        const next = evaluate(t, side);
        if (next.r <= 1 && next.error <= 0 && previous[side].error > 0) {
          let low = t - step, high = t;
          for (let j = 0; j < 14; j++) {
            const mid = (low + high) / 2;
            if (evaluate(mid, side).error > 0) low = mid; else high = mid;
          }
          const distance = (low + high) / 2, p = evaluate(distance, side).p;
          if (side !== 'bottom' || Math.hypot(p[0], p[2]) >= this.surfaceModel.port) {
            const [u, v] = this.surfaceModel.inverse(p[0], p[2], side);
            const normal = this.surfaceModel.sample(u, v, side).slice(3, 6);
            if (dot(normal, direction) < -0.005 && (!hit || distance < hit.distance)) {
              hit = { x: u, z: v, side, distance };
            }
          }
        }
        previous[side] = next;
      }
      if (hit) return hit;
    }
    return null;
  }

  pick(x, y) {
    const surface = this.surfacePoint(x, y);
    if (!surface) return null;
    let best = null;
    for (const f of this.layout.fields) {
      if (f.side !== surface.side) continue;
      const c = Math.cos(f.angle), s = Math.sin(f.angle), dx = surface.x - f.x, dz = surface.z - f.z;
      const r = Math.hypot((dx * c + dz * s) / (f.size * (f.aspect ?? 0.82)), (-dx * s + dz * c) / f.size);
      if (r <= 1.2 && (!best || r < best.radius)) best = { field: f, radius: r, position: Math.min(1, r) };
    }
    return best;
  }

  draw(time) {
    if (this.lost || !this.layout) return false;
    if (Math.abs(this.pitch - this.targetPitch) > 0.001) {
      this.pitch += (this.targetPitch - this.pitch) * 0.15; this.dirty = true;
    }
    if (!this.dirty && time > this.activeUntil) return false;
    this.dirty = false; this.camera(); this.updatePositions();
    for (let i = 0; i < 12; i++) {
      const position = this.positions[this.hits[i * 4] - 1];
      this.hiddenHits[i] = position && !position.visible ? 1 : 0;
      this.hiddenCenters[i * 3 + 2] = this.hiddenHits[i];
      const age = time - this.hits[i * 4 + 1];
      if (!this.hiddenHits[i] || age < 0 || age >= 1.6) continue;
      const f = position.field, c = Math.cos(f.angle), s = Math.sin(f.angle);
      const axis = (dx, dz) => {
        const a = this.project(this.surfaceModel.sample(f.x + dx, f.z + dz, f.side).slice(0, 3));
        const b = this.project(this.surfaceModel.sample(f.x - dx, f.z - dz, f.side).slice(0, 3));
        return [(a.x - b.x) / 2, (a.y - b.y) / 2];
      };
      const a = axis(c * f.size * (f.aspect ?? 0.82), s * f.size * (f.aspect ?? 0.82));
      const b = axis(-s * f.size, c * f.size);
      const determinant = a[0] * b[1] - a[1] * b[0];
      this.hiddenCenters.set([position.x, position.y], i * 3);
      if (Math.abs(determinant) > 1) {
        this.hiddenAxes.set([b[1] / determinant, -b[0] / determinant,
          -a[1] / determinant, a[0] / determinant], i * 4);
      } else {
        // Keep an edge-on strike legible without a singular projection.
        const radius = Math.max(8, Math.min(position.radius, 24));
        this.hiddenAxes.set([1 / radius, 0, 0, 1 / radius], i * 4);
      }
    }
    const gl = this.gl, u = this.uniforms;
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    for (const [attribute, offset] of [['aPosition', 0], ['aNormal', 12], ['aDetail', 24]]) {
      gl.enableVertexAttribArray(this.attributes[attribute]);
      gl.vertexAttribPointer(this.attributes[attribute], 3, gl.FLOAT, false, 36, offset);
    }
    gl.uniformMatrix4fv(u.uVP, false, this.vp);
    gl.uniform3fv(u.uEye, this.eye);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.normalTexture);
    gl.uniform1i(u.uNormals, 0); gl.uniform1f(u.uMapped, this.mappedNormals ? 1 : 0);
    gl.uniform1f(u.uNormalSize, this.normalSize || 768);
    const colors = { ember: [0.62, 0.34, 0.105], silver: [0.57, 0.66, 0.69], rose: [0.64, 0.31, 0.22] };
    gl.uniform3fv(u.uColor, colors[this.layout.finish] || colors.ember);
    gl.uniform1f(u.uRoughness, this.layout.finish === 'silver' ? 0.31 : 0.26);
    gl.uniform1f(u.uTime, time);
    const selected = this.layout.fields.find(f => f.id === this.selected);
    gl.uniform4fv(u.uSelection, selected ? [selected.x, selected.z, selected.size, selected.side === 'top' ? 1 : -1] : [0, 0, 0, 0]);
    gl.uniform2fv(u.uSelectionRotation, selected ? [Math.cos(selected.angle), Math.sin(selected.angle)] : [1, 0]);
    gl.uniform1f(u.uSelectionAspect, selected?.aspect ?? 0.82);
    gl.uniform1f(u.uEdit, this.edit ? 1 : 0);
    gl.uniform4fv(u['uHits[0]'], this.hits);
    gl.uniform4fv(u['uStrikeFields[0]'], this.strikeFields);
    gl.uniform1fv(u['uStrikeAspect[0]'], this.strikeAspect);
    gl.uniform3fv(u['uHiddenCenters[0]'], this.hiddenCenters);
    gl.uniform4fv(u['uHiddenAxes[0]'], this.hiddenAxes);
    gl.uniform3f(u.uPixelSpace, this.width / this.canvas.width, this.height / this.canvas.height, this.height);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
    gl.drawElements(gl.TRIANGLES, this.indexCount, this.largeIndices ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, 0);
    return true;
  }
}
