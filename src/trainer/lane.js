import { LOOKAHEAD_MS, laneOffset } from './arpeggio.mjs';
// The guitar-hero lane: note blocks travel right to left and cross the centre
// rail, which is "now". Blocks are HTML, not SVG, so the labels and corners keep
// their shape however wide the pitch space is.
// Vertical placement matches the live marker: offset +1 is 11%, -1 is 89%.
const top = offset => 50 - offset * 39;
export class NoteLane {
  constructor(container) {
    this.el = document.createElement('div');
    this.el.className = 'lane';
    this.el.setAttribute('aria-hidden', 'true');
    container.prepend(this.el);
    this.blocks = [];
  }
  setRound(round, names) {
    this.el.replaceChildren();
    this.blocks = round.steps.map((step, i) => {
      const block = document.createElement('div');
      block.className = 'lane-note';
      block.textContent = names[i];
      this.el.append(block);
      return block;
    });
  }
  clear() { this.el.replaceChildren(); this.blocks = []; }
  // phase 'listen' lays the phrase out as a static preview; 'sing' scrolls it.
  render({ round, phase, at, results = [], sounding = -1, active = -1 }) {
    const height = Math.max(7, round.tolerance * 2 / round.window.span * 78);
    round.steps.forEach((step, i) => {
      const block = this.blocks[i];
      if (!block) return;
      const offset = laneOffset(step.midi * 100, round.window);
      const slot = 92 / round.steps.length;
      const left = phase === 'listen' ? 4 + i * slot + slot * .08 : 50 + (step.at - at) / LOOKAHEAD_MS * 50;
      const width = phase === 'listen' ? slot * .84 : step.duration / LOOKAHEAD_MS * 50;
      block.style.left = `${left}%`;
      block.style.width = `${width}%`;
      block.style.height = `${height}%`;
      block.style.top = `${top(offset) - height / 2}%`;
      block.hidden = phase === 'sing' && (left > 104 || left + width < -4);
      block.className = 'lane-note'
        + (phase === 'listen' ? i === sounding ? ' sounding' : ' preview' : '')
        + (results[i] ? ` ${results[i]}` : i === active ? ' active' : '');
    });
  }
}
