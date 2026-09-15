// Time runs left to right; the newest sample meets the live marker at center.
export class PitchTrail {
  constructor(container) {
    this.points = [];
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.id = 'pitch-trail';
    this.svg.setAttribute('viewBox', '0 0 1000 1000');
    this.svg.setAttribute('preserveAspectRatio', 'none');
    this.svg.setAttribute('aria-hidden', 'true');
    container.prepend(this.svg);
  }
  reset() { this.points = []; this.svg.replaceChildren(); }
  // offset is the marker's position in the space: +1 at the top, -1 at the bottom.
  add(time, offset, tuned, high) {
    this.points.push({ time, y: 500 - Math.max(-1, Math.min(1, offset)) * 390,
      color: tuned ? '#39846a' : high ? '#c58340' : '#638da8' });
    this.draw(time);
  }
  draw(time) {
    const duration = 3000;
    this.points = this.points.filter(point => time - point.time < duration);
    const fragment = document.createDocumentFragment();
    for (let i = 1; i < this.points.length; i++) {
      const previous = this.points[i - 1], point = this.points[i];
      // Leave a visible gap when voice detection drops out.
      if (point.time - previous.time > 180) continue;
      const line = document.createElementNS(this.svg.namespaceURI, 'line');
      line.setAttribute('x1', 500 - (time - previous.time) / duration * 290);
      line.setAttribute('x2', 500 - (time - point.time) / duration * 290);
      line.setAttribute('y1', previous.y); line.setAttribute('y2', point.y);
      line.setAttribute('stroke', point.color);
      line.setAttribute('opacity', .8 * (1 - (time - point.time) / duration));
      line.setAttribute('vector-effect', 'non-scaling-stroke');
      fragment.append(line);
    }
    this.svg.replaceChildren(fragment);
  }
}
