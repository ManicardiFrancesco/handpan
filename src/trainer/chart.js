import { trendOf, OUTLIER_CENTS } from './progress.mjs';
// One measure over time: how far off target each found note was, lower is better.
// Two series, so a legend is always present; only the trend end is direct-labelled.
// The chart is drawn at its container's pixel size (one viewBox unit = one pixel)
// and redrawn on resize, so marks and type keep their weight at every width.
export const ATTEMPT_COLOR = '#1f7fb0';
export const TREND_COLOR = '#1c7040';
const SURFACE = '#fffefa', GRID = '#e6eade', BAND = '#e7efdf', BASELINE = '#c3d4b8';
const SESSION_GAP = 30 * 60 * 1000;
const SVGNS = 'http://www.w3.org/2000/svg';
const node = (name, attrs = {}) => {
  const element = document.createElementNS(SVGNS, name);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
  return element;
};
const STEPS = [5, 10, 20, 25, 50];
const gridStep = max => STEPS.find(step => max / step <= 5) ?? 50;
// Entries come back out of localStorage, so labels are escaped before markup.
const clean = value => String(value ?? '').replace(/[<>&]/g, character => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[character]);
export const formatWhen = (at, now = Date.now()) => {
  const date = new Date(at);
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return new Date(now).toDateString() === date.toDateString() ? time
    : `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`;
};

export class ProgressChart {
  constructor(figure, table) {
    this.figure = figure; this.table = table; this.entries = []; this.state = null;
    this.svg = node('svg', { role: 'img' });
    this.empty = document.createElement('p');
    this.empty.className = 'chart-empty';
    this.tip = document.createElement('div');
    this.tip.className = 'chart-tip'; this.tip.hidden = true;
    const legend = document.createElement('figcaption');
    legend.className = 'chart-legend';
    legend.innerHTML = `<span><i class="key-dot" style="background:${ATTEMPT_COLOR}"></i>Each note you found</span>`
      + `<span><i class="key-line" style="background:${TREND_COLOR}"></i>Trend</span>`
      + '<span><i class="key-band"></i>Your current target</span>';
    figure.append(this.svg, this.tip, legend, this.empty);
    this.svg.addEventListener('pointermove', event => this.hover(event));
    this.svg.addEventListener('pointerleave', () => this.hover(null));
    if (typeof ResizeObserver === 'function') {
      new ResizeObserver(() => {
        if (!this.state || Math.abs(this.width() - this.drawnWidth) < 5) return;
        cancelAnimationFrame(this.pending);
        this.pending = requestAnimationFrame(() => this.render(this.state));
      }).observe(figure);
    }
  }
  width() { return Math.max(280, Math.min(1000, Math.round(this.figure.clientWidth || 760))); }
  render(state) {
    const { entries, tolerance } = state;
    this.state = state; this.entries = entries;
    this.svg.replaceChildren(); this.tip.hidden = true;
    this.empty.hidden = entries.length > 0;
    this.empty.textContent = entries.length ? '' : 'No notes yet. Hold one note in tune and your first point lands here.';
    this.svg.style.display = entries.length ? '' : 'none';
    this.renderTable();
    if (!entries.length) { this.svg.setAttribute('aria-label', 'Accuracy over time, no notes recorded yet'); return; }
    const width = this.drawnWidth = this.width();
    const narrow = width < 560;
    const height = narrow ? 200 : 240;
    // Top padding leaves the unit caption clear of the highest axis label.
    const pad = { top: 26, right: narrow ? 58 : 92, bottom: 32, left: narrow ? 36 : 46 };
    this.svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    this.svg.setAttribute('width', width); this.svg.setAttribute('height', height);
    const plot = { w: width - pad.left - pad.right, h: height - pad.top - pad.bottom };
    const cents = entries.map(entry => entry.cents);
    const max = Math.min(OUTLIER_CENTS, Math.max(30, Math.ceil(Math.max(...cents, tolerance * 1.5) / 10) * 10));
    const x = i => entries.length === 1 ? pad.left + plot.w / 2 : pad.left + i / (entries.length - 1) * plot.w;
    const y = value => pad.top + plot.h * (1 - Math.min(value, max) / max);
    this.x = x; this.y = y;
    const layer = document.createDocumentFragment();
    const text = (content, attrs) => {
      const element = node('text', attrs);
      element.textContent = content;
      return element;
    };
    // The target band is the goal, not a series: a wash behind the grid.
    layer.append(node('rect', { x: pad.left, y: y(tolerance), width: plot.w, height: y(0) - y(tolerance), fill: BAND, rx: 3 }));
    layer.append(node('line', { x1: pad.left, x2: pad.left + plot.w, y1: y(0), y2: y(0), stroke: BASELINE }));
    for (let value = 0; value <= max; value += gridStep(max)) {
      if (value) layer.append(node('line', { x1: pad.left, x2: pad.left + plot.w, y1: y(value), y2: y(value), stroke: GRID }));
      layer.append(text(value, { x: pad.left - 8, y: y(value) + 4, 'text-anchor': 'end', class: 'axis' }));
    }
    layer.append(text('cents', { x: pad.left - 8, y: pad.top - 12, 'text-anchor': 'end', class: 'axis' }));
    // The band's label rides inside the band, clear of the trend's end label.
    layer.append(text(`in tune ±${tolerance}`, { x: pad.left + 8, y: y(0) - 8, class: 'axis' }));
    // A hairline where practice stopped and started again, so gaps in time show.
    entries.forEach((entry, i) => {
      if (!i || entry.at - entries[i - 1].at < SESSION_GAP) return;
      const at = (x(i) + x(i - 1)) / 2;
      layer.append(node('line', { x1: at, x2: at, y1: pad.top, y2: y(0), stroke: GRID }));
    });
    const trend = trendOf(cents);
    if (trend) {
      const end = y(Math.max(0, trend.to));
      layer.append(node('line', {
        x1: x(0), y1: y(Math.max(0, trend.from)), x2: x(entries.length - 1), y2: end,
        stroke: TREND_COLOR, 'stroke-width': 2, 'stroke-linecap': 'round',
      }));
      layer.append(text(`${trend.to.toFixed(1)}¢`, { x: x(entries.length - 1) + 9, y: end + 1, class: 'trend-label' }));
      layer.append(text(trend.changePct >= 0 ? `↓ ${Math.round(trend.changePct)}%` : `↑ ${Math.round(-trend.changePct)}%`,
        { x: x(entries.length - 1) + 9, y: end + 15, class: 'axis' }));
    }
    this.crosshair = node('line', { y1: pad.top, y2: y(0), stroke: '#b9c9ae', visibility: 'hidden' });
    layer.append(this.crosshair);
    this.dots = entries.map((entry, i) => {
      const dot = node('circle', { cx: x(i), cy: y(entry.cents), r: 4.5, fill: ATTEMPT_COLOR, stroke: SURFACE, 'stroke-width': 2 });
      layer.append(dot);
      return dot;
    });
    layer.append(text(formatWhen(entries[0].at), { x: pad.left, y: height - 10, class: 'axis' }));
    if (entries.length > 1) layer.append(text(formatWhen(entries.at(-1).at), { x: pad.left + plot.w, y: height - 10, 'text-anchor': 'end', class: 'axis' }));
    this.svg.append(layer);
    this.svg.setAttribute('aria-label', `Distance from the target note for the last ${entries.length} notes found, in cents.`
      + (trend ? ` Trend: ${trend.changePct >= 0 ? 'improving' : 'widening'} by ${Math.abs(Math.round(trend.changePct))} percent.` : ''));
  }
  hover(event) {
    if (!this.dots?.length) return;
    if (!event) {
      this.crosshair.setAttribute('visibility', 'hidden');
      this.dots.forEach(dot => dot.setAttribute('r', 4.5));
      this.tip.hidden = true;
      return;
    }
    const rect = this.svg.getBoundingClientRect();
    if (!rect.width) return;
    const position = (event.clientX - rect.left) / rect.width * this.drawnWidth;
    let index = 0;
    this.entries.forEach((_, i) => { if (Math.abs(this.x(i) - position) < Math.abs(this.x(index) - position)) index = i; });
    const entry = this.entries[index];
    this.dots.forEach((dot, i) => dot.setAttribute('r', i === index ? 6.5 : 4.5));
    this.crosshair.setAttribute('x1', this.x(index)); this.crosshair.setAttribute('x2', this.x(index));
    this.crosshair.setAttribute('visibility', 'visible');
    this.tip.hidden = false;
    this.tip.innerHTML = `<strong>${entry.cents.toFixed(1)} cents off</strong><span>${clean(entry.note)} · ${formatWhen(entry.at)}</span>`
      + `<span>${clean(entry.scale)} · ${clean(entry.difficulty)}${entry.mode === 'speedrun' ? ' · speedrun' : ''}</span>`;
    const scale = rect.width / this.drawnWidth;
    this.tip.style.left = `${this.x(index) * scale}px`;
    this.tip.style.top = `${this.y(entry.cents) * scale}px`;
    this.tip.classList.toggle('flip', this.x(index) * scale > rect.width - 160);
  }
  renderTable() {
    if (!this.table) return;
    this.table.querySelector('.table-scroll')?.remove();
    const rows = this.entries.slice().reverse().map(entry => `<tr><td>${formatWhen(entry.at)}</td><td>${clean(entry.note)}</td>`
      + `<td>${clean(entry.scale)}</td><td>${entry.cents.toFixed(1)}</td><td>${clean(entry.difficulty)}</td><td>${clean(entry.mode)}</td></tr>`).join('');
    if (!rows) return;
    const scroll = document.createElement('div');
    scroll.className = 'table-scroll';
    scroll.innerHTML = '<table><thead><tr><th>When</th><th>Note</th><th>Scale</th><th>Cents off</th><th>Difficulty</th><th>Mode</th></tr></thead>'
      + `<tbody>${rows}</tbody></table>`;
    this.table.append(scroll);
  }
}
