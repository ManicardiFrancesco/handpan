import { HandpanRenderer } from './renderer.js';
import { ElaiaAudio } from './audio.js';
import { findChords } from '../src/theory/chords.js';
import {
  PRESETS, MAX_FIELDS, MIDI_MIN, MIDI_MAX, KEYS, clone, createLayout,
  validateLayout, transposeLayout, fits, nameOf, frequencyOf,
  encodeLayout, decodeLayout, loadStorage,
  automaticField, arrangementInfo,
  restoreCurrent,
} from './model.mjs';
import { fieldShape } from './geometry.mjs';

const CURRENT_KEY = 'elaia.current.v1', LIBRARY_KEY = 'elaia.library.v1';
const $ = id => document.getElementById(id);
const make = (tag, className, text) => {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
};
const markActive = (selector, attr, value) => document.querySelectorAll(selector).forEach(b => {
  const active = b.dataset[attr] === String(value);
  b.classList.toggle('active', active); b.setAttribute('aria-pressed', String(active));
});

class Elaia {
  constructor() {
    this.audio = new ElaiaAudio();
    this.audio.onStatus = () => this.renderSampleStatus();
    this.advanced = false; this.tool = 'select'; this.selected = null;
    this.keyboard = false; this.history = []; this.future = []; this.pointers = new Map();
    this.chordTimers = new Set(); this.playGeneration = 0; this.noteTimers = new Map();
    this.family = 'All'; this.library = []; this.storageAvailable = true;
    this.layout = createLayout();
    this.restore();
    try {
      this.renderer = new HandpanRenderer($('instrument'));
    } catch (error) {
      $('graphics-error').hidden = false;
      this.graphicsError = error.message;
    }
    this.fillNoteSelect($('field-note'));
    this.fillNoteSelect($('add-note'));
    $('add-note').value = '62';
    this.bind();
    this.rebuild();
    if (this.renderer) {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe($('stage'));
      this.resize();
      const animate = time => {
        if (!document.hidden && this.renderer.draw(time / 1000)) this.updateLabels();
        this.animation = requestAnimationFrame(animate);
      };
      this.animation = requestAnimationFrame(animate);
    }
    if (this.restoreError) this.toast(this.restoreError);
  }

  restore() {
    try {
      const current = loadStorage(localStorage, CURRENT_KEY, null);
      if (current) {
        try { this.layout = restoreCurrent(current); }
        catch { this.restoreError = 'Your last layout could not be restored. Starting with Ayasa D Aegean 18.'; }
      }
      const saved = loadStorage(localStorage, LIBRARY_KEY, []);
      if (Array.isArray(saved)) {
        this.library = saved.slice(0, 100).flatMap(entry => {
          try {
            if (typeof entry.id !== 'string') return [];
            return [{ id: entry.id, date: entry.date, layout: validateLayout(entry.layout) }];
          } catch { return []; }
        });
      }
    } catch { this.storageAvailable = false; }
    const code = new URLSearchParams(location.hash.slice(1)).get('layout');
    if (code) {
      try { this.layout = decodeLayout(code); this.fromShare = true; }
      catch (error) { this.restoreError = error.message; }
    }
  }

  writeStorage(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch {
      if (this.storageAvailable) this.toast('Device storage is unavailable. Export or share your instrument to keep it.');
      this.storageAvailable = false; return false;
    }
  }

  persist() {
    this.writeStorage(CURRENT_KEY, this.layout);
    if (location.hash.startsWith('#layout=')) history.replaceState(null, '', location.pathname + location.search);
  }

  toast(message) {
    clearTimeout(this.toastTimer);
    $('toast').textContent = message; $('toast').hidden = false;
    this.toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4000);
  }

  fillNoteSelect(select) {
    for (let midi = MIDI_MIN; midi <= MIDI_MAX; midi++) select.add(new Option(nameOf(midi), midi));
  }

  resize() {
    if (!this.renderer) return;
    const rect = $('stage').getBoundingClientRect();
    this.renderer.resize(rect.width, rect.height);
  }

  remember(before = this.layout) {
    this.history.push(clone(before));
    if (this.history.length > 50) this.history.shift();
    this.future = [];
  }

  commit(next, { geometry = true, audio = true, custom = true } = {}) {
    try {
      next = validateLayout(next);
      if (JSON.stringify(next) === JSON.stringify(this.layout)) return;
      this.remember();
      this.layout = next;
      if (custom) this.layout.custom = true;
      this.cancelStrum();
      this.rebuild({ geometry, audio });
      this.persist();
    } catch (error) { this.toast(error.message); }
  }

  rebuild({ geometry = true, audio = true } = {}) {
    if (!this.layout.fields.some(f => f.id === this.selected)) this.selected = null;
    if (audio) this.audio.build(this.layout);
    if (this.renderer) {
      this.renderer.layout = this.layout;
      this.renderer.selected = this.selected; this.renderer.edit = this.advanced;
      if (geometry) this.renderer.build(this.layout);
      this.renderer.dirty = true;
    }
    this.renderNotes(); this.renderChords(); this.renderInfo(); this.renderInspector(); this.renderHistory();
  }

  renderInfo() {
    const delta = this.layout.transpose;
    const preset = PRESETS.find(p => p.id === this.layout.preset);
    let title = this.layout.title;
    if (delta && preset && title === preset.title) {
      const rootName = nameOf(preset.root + delta);
      title = title.replace(/^[A-G](?:[#♯b])?\d?/, /^[A-G](?:[#♯b])?\d/.test(title) ? rootName : rootName.slice(0, -1));
    }
    $('scale-title').textContent = title;
    $('scale-subtitle').textContent = `${this.layout.fields.length} notes · ${this.layout.custom ? 'an instrument of your own' : 'Ayasa · published instrument'}`;
    $('custom-badge').hidden = !this.layout.custom;
    $('transpose-value').textContent = delta === 0 ? 'Original' : `${delta > 0 ? '+' : ''}${delta} semitone${Math.abs(delta) === 1 ? '' : 's'}`;
    $('instrument-meta').textContent = `${this.layout.a4} Hz  ·  ${this.layout.fields.length} fields  ·  ${arrangementInfo(this.layout)}`;
    $('transpose-down').disabled = this.layout.fields.some(f => f.midi <= MIDI_MIN);
    $('transpose-up').disabled = this.layout.fields.some(f => f.midi >= MIDI_MAX);
    markActive('[data-pitch]', 'pitch', this.layout.a4);
    markActive('[data-finish]', 'finish', this.layout.finish);
    markActive('[data-sound]', 'sound', this.layout.sound || 'modeled');
    this.renderSampleStatus();
  }

  renderSampleStatus() {
    const { total, ready, failed } = this.audio.sampleStatus;
    $('sample-status').textContent = this.layout.sound !== 'ayasa' ? 'Physical handpan synthesis'
      : !this.audio.started ? 'Ayasa preview recordings · load when you begin'
      : failed ? `Ayasa previews ${ready}/${total} · modeled sound fills missing notes`
      : ready < total ? `Ayasa previews loading · ${ready}/${total} ready`
      : 'Ayasa preview recordings ready';
  }

  renderNotes() {
    const ordered = this.layout.fields.filter(f => f.side === 'top').concat(this.layout.fields.filter(f => f.side === 'bottom'));
    for (const side of ['top', 'bottom']) {
      const container = $(`${side}-notes`); container.replaceChildren();
      const fields = ordered.filter(f => f.side === side);
      $(`${side}-count`).textContent = `${fields.length} NOTE${fields.length === 1 ? '' : 'S'}`;
      for (const f of fields) {
        const button = make('button', 'note-chip');
        button.dataset.id = f.id;
        button.title = fieldShape(f, this.layout) === 'dome' ? 'Convex tone field' : 'Concave tone field';
        const note = nameOf(f.midi);
        button.append(document.createTextNode(note.slice(0, -1)), make('sub', '', note.slice(-1)));
        button.setAttribute('aria-label', `${this.advanced ? 'Edit' : 'Play'} ${note}, ${side} shell`);
        if (this.selected === f.id && this.advanced) button.classList.add('selected');
        if (this.keyboard) button.append(make('kbd', '', KEYS[ordered.indexOf(f)] === ' ' ? '␣' : (KEYS[ordered.indexOf(f)] || '')));
        button.addEventListener('pointerdown', event => {
          if (event.pointerType === 'touch') {
            event.preventDefault();
            this.noteButtonAction(f);
          }
        });
        button.addEventListener('click', event => { if (event.pointerType !== 'touch') this.noteButtonAction(f); });
        container.append(button);
      }
    }
    $('bottom-empty').hidden = this.layout.fields.some(f => f.side === 'bottom');
  }

  noteButtonAction(field) {
    if (this.advanced) {
      this.select(field.id);
      this.setView(field.side);
    }
    this.play(field.id);
  }

  renderChords() {
    const notes = this.layout.fields.map(f => ({ midi: f.midi, name: nameOf(f.midi), id: f.id }));
    this.chords = findChords(notes, { minNotes: 3, maxResults: 9, tonicPc: notes[0].midi % 12 });
    $('chords').replaceChildren();
    this.chords.forEach(chord => {
      const button = make('button', 'chord-chip', chord.symbol.replaceAll('b', '♭').replaceAll('#', '♯'));
      button.title = chord.notes.map(n => nameOf(n.midi)).join(' · ');
      button.setAttribute('aria-label', `Play ${chord.fullName}`);
      button.onclick = () => this.strum(chord, button);
      $('chords').append(button);
    });
    if (!this.chords.length) $('chords').append(make('p', 'editor-hint', 'Add a few more notes to discover harmonies.'));
  }

  async boot() {
    try {
      $('sound-label').textContent = this.audio.started ? 'Sound is on' : 'Waking up…';
      await this.audio.start();
      $('sound-label').textContent = 'Sound is on'; $('sound-btn').classList.add('is-on');
      $('sound-btn').setAttribute('aria-label', 'Audio is enabled. Play the first note');
      return true;
    } catch (error) {
      $('sound-label').textContent = 'Retry audio';
      this.toast(`Audio could not start: ${error.message}. Use HTTPS or localhost.`);
      return false;
    }
  }

  async play(id, velocity = 0.64, position = 0.14) {
    const generation = this.playGeneration;
    if (!await this.boot() || generation !== this.playGeneration || !this.layout.fields.some(f => f.id === id)) return;
    this.audio.strike(id, velocity, position); this.renderer?.strike(id);
    const buttons = [...document.querySelectorAll('.note-chip')].filter(b => b.dataset.id === id);
    buttons.forEach(b => b.classList.add('sounding'));
    clearTimeout(this.noteTimers.get(id));
    this.noteTimers.set(id, setTimeout(() => {
      buttons.forEach(b => b.classList.remove('sounding'));
      this.noteTimers.delete(id);
    }, 650));
  }

  cancelStrum() {
    this.playGeneration++;
    this.chordTimers.forEach(timer => clearTimeout(timer)); this.chordTimers.clear();
    document.querySelectorAll('.chord-chip.sounding').forEach(b => b.classList.remove('sounding'));
  }

  async strum(chord, button) {
    this.cancelStrum();
    const generation = this.playGeneration;
    if (!await this.boot() || generation !== this.playGeneration) return;
    button.classList.add('sounding');
    chord.notes.forEach((note, i) => {
      const timer = setTimeout(() => {
        this.chordTimers.delete(timer);
        if (generation === this.playGeneration) this.play(note.id, 0.5);
      }, i * 48);
      this.chordTimers.add(timer);
    });
    const timer = setTimeout(() => { button.classList.remove('sounding'); this.chordTimers.delete(timer); }, 1100);
    this.chordTimers.add(timer);
  }

  damp() {
    this.cancelStrum(); this.audio.damp();
    document.querySelectorAll('.note-chip.sounding').forEach(b => b.classList.remove('sounding'));
    if (this.renderer) {
      for (let i = 0; i < 12; i++) this.renderer.hits[i * 4] = -1;
      this.renderer.dirty = true;
    }
  }

  setAdvanced(value) {
    this.advanced = value;
    document.body.classList.toggle('advanced', value);
    $('advanced-btn').setAttribute('aria-pressed', String(value));
    $('advanced-panel').hidden = !value; $('normal-panel-footer').hidden = value; $('edit-banner').hidden = !value;
    if (!value) this.tool = 'select';
    if (this.renderer) { this.renderer.edit = value; this.renderer.dirty = true; }
    this.setTool(this.tool); this.renderNotes(); this.renderInspector();
    this.resize();
  }

  setTool(tool) {
    this.tool = tool;
    markActive('[data-tool]', 'tool', tool);
    const hints = {
      select: 'Click a field to edit its note. Drag it to move. Drag the bare shell to orbit; right or middle drag always orbits.',
      add: 'Choose a note and shell. Add note finds an open spot for you.',
    };
    $('editor-hint').textContent = hints[tool];
    $('edit-message').textContent = tool === 'select' ? 'Click to edit a note. Drag a field to move it.' : 'Add a note, then drag it to make it yours.';
    $('add-settings').hidden = tool !== 'add';
    if (tool === 'add') $('add-side').value = this.renderer?.eye?.[1] < 0 ? 'bottom' : 'top';
    $('instrument').style.cursor = 'grab';
    $('stage-hint').innerHTML = this.advanced ? 'Click to edit · Drag fields to move · Right drag to orbit' : '<span class="mouse-icon"></span> Tap to play <span>·</span> Drag to explore <span>·</span> Scroll to zoom';
    this.renderInspector();
  }

  setView(view) {
    this.renderer?.setView(view);
    markActive('[data-view]', 'view', view);
    if (this.tool === 'add' && view !== 'free') $('add-side').value = view;
  }

  select(id) {
    this.selected = id;
    if (this.renderer) { this.renderer.selected = id; this.renderer.dirty = true; }
    document.querySelectorAll('.note-chip').forEach(b => b.classList.toggle('selected', this.advanced && b.dataset.id === id));
    this.renderInspector();
    if (id && this.advanced && innerWidth <= 620) this.showMobileStage();
  }

  showMobileStage() {
    window.scrollTo({ top: Math.max(0, $('stage').getBoundingClientRect().top + scrollY - 80), behavior: 'auto' });
  }

  selectedField() { return this.layout.fields.find(f => f.id === this.selected); }

  renderInspector() {
    const field = this.selectedField();
    $('field-inspector').hidden = !field || !this.advanced || this.tool !== 'select';
    document.body.classList.toggle('inspector-open', !$('field-inspector').hidden);
    if (!field) return;
    $('field-note').value = field.midi;
    $('field-frequency').textContent = `${frequencyOf(field.midi, this.layout.a4).toFixed(2)} Hz`;
    $('field-down').disabled = field.midi === MIDI_MIN; $('field-up').disabled = field.midi === MIDI_MAX;
    markActive('[data-side]', 'side', field.side);
    $('field-shape').value = fieldShape(field, this.layout);
    $('field-size').value = field.size;
    $('field-size-value').textContent = `${Math.round(field.size * 530)} × ${Math.round(field.size * 530 * (field.aspect ?? 0.82))} mm`;
    const angle = ((field.angle * 180 / Math.PI + 540) % 360) - 180;
    $('field-angle').value = angle; $('field-angle-value').textContent = `${Math.round(angle)}°`;
    $('remove-field').disabled = this.layout.fields.length <= 1;
  }

  updateField(change, options = {}) {
    if (!this.selectedField()) return;
    const next = clone(this.layout), field = next.fields.find(f => f.id === this.selected);
    Object.assign(field, change);
    if ((change.side || change.size || change.x !== undefined || change.angle !== undefined) && !fits(next, field)) {
      this.toast(change.side ? 'There is no room at that position on the other shell. Move the field first, or add it on that side.' : 'Leave a little space between fields and around the rim.');
      this.renderInspector(); return;
    }
    this.commit(next, { geometry: change.midi === undefined, audio: change.midi !== undefined || change.side !== undefined, ...options });
  }

  addField() {
    if (this.layout.fields.length >= MAX_FIELDS) { this.toast(`This instrument already has ${MAX_FIELDS} tone fields.`); return; }
    const side = $('add-side').value;
    const field = automaticField(this.layout, { id: 'n-' + crypto.randomUUID().slice(0, 8), midi: +$('add-note').value, side });
    if (!field) { this.toast(`The ${side} shell is full. Remove or shrink a field, or choose the other shell.`); return; }
    const next = clone(this.layout); next.fields.push(field);
    this.commit(next); this.setTool('select'); this.setView(side); this.select(field.id); this.play(field.id);
    // Keep the whole instrument accessible for the first drag on a phone.
    if (innerWidth <= 620) this.select(null);
    this.toast(`${nameOf(field.midi)} added to the ${field.side}. Drag the field to move it.`);
  }

  updateLabels() {
    const container = $('field-labels');
    if (!this.renderer || (!this.advanced && !this.keyboard)) { container.replaceChildren(); return; }
    const labels = this.renderer.positions.filter(p => p.visible && p.x > 10 && p.x < this.renderer.width - 10 && p.y > 100 && p.y < this.renderer.height - 115);
    container.replaceChildren(...labels.map(p => {
      const label = make('span', 'field-label' + (p.field.id === this.selected ? ' selected' : ''), nameOf(p.field.midi));
      label.style.left = `${p.x}px`; label.style.top = `${p.y}px`;
      return label;
    }));
  }

  bindPointers() {
    const canvas = $('instrument');
    const point = event => {
      const rect = canvas.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    canvas.onpointerdown = event => {
      if (!this.renderer) return;
      event.preventDefault();
      if (event.pointerType === 'mouse') canvas.focus({ preventScroll: true });
      else if (document.activeElement.matches('input,select,textarea')) document.activeElement.blur();
      canvas.setPointerCapture(event.pointerId);
      const p = point(event), pick = this.renderer.pick(p.x, p.y);
      const orbitOnly = event.pointerType === 'mouse' && event.button !== 0;
      const item = { ...p, startX: p.x, startY: p.y, moved: false, pick, baseline: null, orbitOnly };
      this.pointers.set(event.pointerId, item);
      if (this.pointers.size === 2) {
        this.pointers.forEach(p => { p.moved = true; });
        this.pinchDistance = this.pointerDistance();
      }
      if (this.advanced) {
        if (pick && !orbitOnly) {
          this.setTool('select');
          this.selected = pick.field.id;
          this.renderer.selected = pick.field.id; this.renderer.dirty = true;
          this.renderer.interactive = true;
          // Open the editor after release so it cannot cover an active drag.
          $('field-inspector').hidden = true; document.body.classList.remove('inspector-open');
          item.baseline = clone(this.layout);
          const surface = this.renderer.surfacePoint(p.x, p.y);
          item.offset = { x: pick.field.x - surface.x, z: pick.field.z - surface.z };
        }
      } else if (pick && !orbitOnly) this.play(pick.field.id, event.shiftKey ? 0.3 : event.altKey ? 0.9 : event.pressure > 0 && event.pressure !== 0.5 ? 0.35 + event.pressure * 0.5 : 0.64, pick.position * 0.42);
    };
    canvas.onpointermove = event => {
      const item = this.pointers.get(event.pointerId);
      if (!item || !this.renderer) return;
      const p = point(event), dx = p.x - item.x, dy = p.y - item.y;
      item.x = p.x; item.y = p.y;
      if (Math.hypot(p.x - item.startX, p.y - item.startY) > 5) item.moved = true;
      if (this.pointers.size >= 2) {
        const distance = this.pointerDistance();
        if (this.pinchDistance > 0) this.renderer.setZoom(this.renderer.zoom * distance / this.pinchDistance);
        this.pinchDistance = distance; return;
      }
      if (!item.moved) return;
      if (this.advanced && item.pick && !item.orbitOnly) {
        const surface = this.renderer.surfacePoint(p.x, p.y), field = this.layout.fields.find(f => f.id === item.pick.field.id);
        if (!surface || !field || surface.side !== field.side) return;
        const x = surface.x + item.offset.x, z = surface.z + item.offset.z;
        if (fits(this.layout, field, x, z)) {
          field.x = x; field.z = z; this.layout.custom = true;
          this.requestMesh(); this.audio.setPans(this.layout);
        }
      } else {
        this.renderer.orbit(dx, dy); markActive('[data-view]', 'view', 'free');
      }
    };
    const end = (event, cancelled = false) => {
      const item = this.pointers.get(event.pointerId);
      if (!item) return;
      this.pointers.delete(event.pointerId);
      if (!this.pointers.size) {
        this.renderer.interactive = false;
        if (item.moved && item.baseline) this.requestMesh();
      }
      if (item.baseline && JSON.stringify(item.baseline) !== JSON.stringify(this.layout)) {
        if (cancelled) {
          this.layout = item.baseline; this.rebuild({ audio: false });
        } else {
          this.remember(item.baseline); this.persist(); this.renderInfo(); this.renderHistory();
        }
      }
      if (!cancelled && item.pick && this.advanced && !item.orbitOnly) {
        this.select(item.pick.field.id);
        if (!item.moved) this.play(item.pick.field.id);
        else if (innerWidth <= 620) this.select(null);
      }
      if (!cancelled && !item.moved && !item.pick && !item.orbitOnly) {
        const p = point(event), surface = this.renderer.surfacePoint(p.x, p.y);
        if (surface && !this.advanced) this.boot().then(ok => { if (ok) this.audio.tak(); });
      }
      this.pinchDistance = 0;
      // Prevent a one-finger orbit jump when the other finger leaves a pinch.
      this.pointers.forEach(p => { p.startX = p.x; p.startY = p.y; });
    };
    canvas.onpointerup = event => end(event);
    canvas.onpointercancel = event => end(event, true);
    canvas.oncontextmenu = event => event.preventDefault();
    canvas.addEventListener('wheel', event => {
      if (!this.renderer) return;
      event.preventDefault();
      this.renderer.setZoom(this.renderer.zoom * Math.exp(-event.deltaY * 0.001));
    }, { passive: false });
  }

  pointerDistance() {
    const [a, b] = [...this.pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }

  requestMesh() {
    if (this.meshRequest) return;
    this.meshRequest = requestAnimationFrame(() => {
      this.meshRequest = null;
      this.renderer?.build(this.layout);
    });
  }

  renderHistory() {
    $('undo-btn').disabled = !this.history.length;
    $('redo-btn').disabled = !this.future.length;
  }

  travel(back) {
    const from = back ? this.history : this.future, to = back ? this.future : this.history;
    if (!from.length) return;
    this.cancelStrum(); to.push(clone(this.layout)); this.layout = from.pop();
    this.rebuild(); this.persist();
  }

  renderScales() {
    const query = $('scale-search').value.trim().toLowerCase().replaceAll('♯', '#');
    const matching = PRESETS.filter(p => (this.family === 'All' || p.family === this.family)
      && `${p.name} ${p.title} ${p.iv.length} ${p.note}`.toLowerCase().replaceAll('♯', '#').includes(query));
    $('scale-list').replaceChildren();
    matching.forEach(p => {
      const button = make('button', 'scale-option' + (p.id === this.layout.preset && !this.layout.custom ? ' current' : ''));
      button.append(make('b', '', p.title), make('span', '', `${p.iv.length} notes · ${p.bottomFrom === undefined ? 'top shell' : 'both shells'} · ${p.profile ? 'published Ayasa layout' : 'digital arrangement'}`),
        make('small', '', p.note));
      button.onclick = () => {
        const next = createLayout(p); next.a4 = this.layout.a4; next.finish = this.layout.finish;
        this.selected = null; this.commit(next, { custom: false }); this.setView('top');
        $('scale-dialog').close();
      };
      $('scale-list').append(button);
    });
    if (!matching.length) $('scale-list').append(make('p', 'editor-hint', 'No scales match. Try a different name or note count.'));
  }

  openSave() {
    $('layout-name').value = this.layout.title;
    $('save-dialog').showModal();
    $('layout-name').focus(); $('layout-name').select();
  }

  renderLibrary() {
    $('saved-list').replaceChildren();
    if (!this.library.length) $('saved-list').append(make('p', 'empty-library', 'Your collection starts here. Save your current instrument, or import an Elaia layout.'));
    this.library.forEach(entry => {
      const row = make('div', 'saved-item'), load = make('button', 'saved-load'), remove = make('button', 'saved-remove', '×');
      load.append(make('b', '', entry.layout.title), make('span', '', `${entry.layout.fields.length} notes · ${entry.layout.a4} Hz · ${entry.layout.fields.filter(f => f.side === 'bottom').length} bottom fields`));
      load.onclick = () => { this.commit(clone(entry.layout), { custom: false }); this.setView('top'); $('library-dialog').close(); };
      remove.setAttribute('aria-label', `Delete ${entry.layout.title}`);
      remove.onclick = () => {
        const before = this.library;
        this.library = this.library.filter(e => e.id !== entry.id);
        if (!this.writeStorage(LIBRARY_KEY, this.library)) { this.library = before; return; }
        this.renderLibrary();
        this.toast('Saved copy deleted. The current instrument is still here.');
      };
      const share = make('button', 'saved-share', 'Share ↗');
      share.setAttribute('aria-label', `Share ${entry.layout.title}`);
      share.onclick = () => { $('library-dialog').close(); this.share(entry.layout); };
      row.append(load, share, remove); $('saved-list').append(row);
    });
  }

  share(layout = this.layout, saved = false) {
    this.sharedLayout = clone(layout);
    const url = new URL(location.href); url.hash = 'layout=' + encodeLayout(layout);
    $('share-url').value = url.href;
    $('share-heading').textContent = saved ? 'Saved. Ready to share.' : 'Pass it on.';
    $('share-saved').hidden = !saved;
    $('share-saved').textContent = `“${layout.title}” is in your collection. This link recreates that saved version.`;
    $('share-local').hidden = !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && url.protocol !== 'file:';
    $('native-share-btn').hidden = typeof navigator.share !== 'function';
    $('share-dialog').showModal();
  }

  bind() {
    document.querySelectorAll('.close-dialog').forEach(b => { b.onclick = () => b.closest('dialog').close(); });
    document.querySelectorAll('dialog').forEach(d => d.addEventListener('click', e => {
      if (e.target !== d) return;
      const r = d.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) d.close();
    }));
    $('scale-btn').onclick = () => { this.renderScales(); $('scale-dialog').showModal(); $('scale-search').focus(); };
    $('scale-search').oninput = () => this.renderScales();
    document.querySelectorAll('[data-family]').forEach(b => { b.onclick = () => {
      this.family = b.dataset.family; markActive('[data-family]', 'family', this.family); this.renderScales();
    }; });
    $('advanced-btn').onclick = () => this.setAdvanced(!this.advanced);
    $('customize-link').onclick = () => this.setAdvanced(true);
    $('add-bottom-link').onclick = () => { this.setAdvanced(true); this.setView('bottom'); this.setTool('add'); $('add-side').value = 'bottom'; };
    $('place-note-btn').onclick = () => this.addField();
    $('done-edit').onclick = () => this.setAdvanced(false);
    document.querySelectorAll('[data-view]').forEach(b => { b.onclick = () => this.setView(b.dataset.view); });
    $('bottom-view').onclick = () => this.setView('bottom');
    $('reset-view').onclick = () => { this.renderer?.reset(); markActive('[data-view]', 'view', this.renderer?.view || 'top'); };
    $('sound-btn').onclick = () => this.play(this.layout.fields[0].id);
    $('volume').oninput = () => { this.audio.volume = +$('volume').value; this.audio.mix(); };
    $('damp-btn').onclick = () => this.damp();
    document.querySelectorAll('[data-space]').forEach(b => { b.onclick = () => {
      this.audio.space = b.dataset.space; this.audio.mix(); markActive('[data-space]', 'space', b.dataset.space);
    }; });
    document.querySelectorAll('[data-finish]').forEach(b => { b.onclick = () => {
      const next = clone(this.layout); next.finish = b.dataset.finish;
      this.commit(next, { custom: false, audio: false, geometry: false });
    }; });
    $('keyboard-btn').onclick = () => {
      this.keyboard = !this.keyboard; $('keyboard-btn').setAttribute('aria-pressed', String(this.keyboard));
      this.renderNotes(); if (this.renderer) this.renderer.dirty = true;
    };
    $('help-btn').onclick = () => $('help-dialog').showModal();
    document.querySelectorAll('[data-pitch]').forEach(b => { b.onclick = () => {
      const next = clone(this.layout); next.a4 = +b.dataset.pitch;
      this.commit(next, { geometry: false, custom: false });
    }; });
    for (const [id, delta] of [['transpose-down', -1], ['transpose-up', 1]]) $(id).onclick = () => {
      try { this.commit(transposeLayout(this.layout, delta), { geometry: false }); }
      catch (error) { this.toast(error.message); }
    };
    document.querySelectorAll('[data-tool]').forEach(b => { b.onclick = () => {
      this.setTool(b.dataset.tool);
      if (innerWidth <= 620) this.showMobileStage();
    }; });
    $('field-note').onchange = () => { this.updateField({ midi: +$('field-note').value }); this.play(this.selected); };
    $('field-shape').onchange = () => this.updateField({ shape: $('field-shape').value }, { audio: false });
    document.querySelectorAll('[data-sound]').forEach(button => { button.onclick = () => {
      const next = clone(this.layout); next.sound = button.dataset.sound;
      this.commit(next, { geometry: false, custom: this.layout.custom });
    }; });
    $('field-down').onclick = () => { if (this.selectedField()) { this.updateField({ midi: this.selectedField().midi - 1 }); this.play(this.selected); } };
    $('field-up').onclick = () => { if (this.selectedField()) { this.updateField({ midi: this.selectedField().midi + 1 }); this.play(this.selected); } };
    $('audition-btn').onclick = () => this.play(this.selected);
    $('close-inspector').onclick = () => this.select(null);
    document.querySelectorAll('[data-side]').forEach(b => { b.onclick = () => {
      if (!this.selectedField()) return;
      if (this.selectedField().side !== b.dataset.side) {
        const next = clone(this.layout), field = next.fields.find(f => f.id === this.selected);
        field.side = b.dataset.side;
        if (!fits(next, field)) {
          // Quickly find a free slot when the same location would hit the gu or another field.
          let found = false;
          for (const radius of [0.65, 0.45, 0.8]) {
            for (let i = 0; i < 32; i++) {
              const x = Math.cos(i / 32 * Math.PI * 2) * radius, z = Math.sin(i / 32 * Math.PI * 2) * radius;
              if (fits(next, field, x, z)) { field.x = x; field.z = z; found = true; break; }
            }
            if (found) break;
          }
          if (!found) { this.toast('There is no room on that shell. Make the field smaller or move another field.'); return; }
        }
        this.commit(next);
      }
      this.setView(b.dataset.side);
    }; });
    // One undo entry per slider gesture, including keyboard changes.
    for (const [id, property, convert] of [['field-size', 'size', v => +v], ['field-angle', 'angle', v => +v * Math.PI / 180]]) {
      const input = $(id);
      input.oninput = () => {
        const field = this.selectedField(); if (!field) return;
        if (!this.rangeBaseline) this.rangeBaseline = clone(this.layout);
        const value = convert(input.value), test = { ...field, [property]: value };
        if (!fits(this.layout, test)) { input.value = property === 'size' ? field.size : field.angle * 180 / Math.PI; return; }
        field[property] = value; this.layout.custom = true;
        if (this.renderer) this.renderer.interactive = true;
        this.requestMesh();
        $(id + '-value').textContent = property === 'size' ? `${Math.round(value * 530)} × ${Math.round(value * 530 * (field.aspect ?? 0.82))} mm` : `${Math.round(value * 180 / Math.PI)}°`;
      };
      input.onchange = () => {
        if (this.rangeBaseline && JSON.stringify(this.rangeBaseline) !== JSON.stringify(this.layout)) this.remember(this.rangeBaseline);
        this.rangeBaseline = null; this.persist(); this.renderInfo(); this.renderHistory();
        if (this.renderer) this.renderer.interactive = false;
        this.requestMesh();
      };
    }
    $('remove-field').onclick = () => {
      if (this.layout.fields.length <= 1) { this.toast('Keep at least one tone field on your instrument.'); return; }
      const next = clone(this.layout); next.fields = next.fields.filter(f => f.id !== this.selected);
      this.commit(next);
    };
    $('undo-btn').onclick = () => this.travel(true); $('redo-btn').onclick = () => this.travel(false);
    $('reset-layout').onclick = () => {
      const preset = PRESETS.find(p => p.id === this.layout.preset) || PRESETS[0];
      const next = createLayout(preset); next.a4 = this.layout.a4; next.finish = this.layout.finish;
      this.commit(next, { custom: false }); this.toast('Original layout restored. You can undo this.');
    };
    $('save-btn').onclick = () => this.openSave();
    $('library-btn').onclick = () => { this.renderLibrary(); $('library-dialog').showModal(); };
    $('new-save-btn').onclick = () => { $('library-dialog').close(); this.openSave(); };
    $('save-form').onsubmit = event => {
      event.preventDefault();
      const title = $('layout-name').value.trim(); if (!title) return;
      const saved = clone(this.layout); saved.title = title;
      const entry = { id: crypto.randomUUID(), date: new Date().toISOString(), layout: saved };
      const next = [entry, ...this.library].slice(0, 100);
      if (!this.writeStorage(LIBRARY_KEY, next)) return;
      this.library = next; $('save-dialog').close(); this.share(saved, true);
    };
    $('share-btn').onclick = () => this.share();
    $('copy-link-btn').onclick = async () => {
      try {
        await navigator.clipboard.writeText($('share-url').value);
        $('share-dialog').close(); this.toast('Instrument link copied. Pass it on.');
      } catch {
        $('share-url').focus(); $('share-url').select();
        this.toast('Select and copy the link above. Clipboard access is unavailable.');
      }
    };
    $('native-share-btn').onclick = async () => {
      try { await navigator.share({ title: this.sharedLayout.title + ' · Elaia', url: $('share-url').value }); }
      catch (error) { if (error.name !== 'AbortError') this.toast('Sharing is unavailable. Copy the link instead.'); }
    };
    $('export-btn').onclick = () => {
      const file = new Blob([JSON.stringify(this.layout, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(file), link = make('a');
      link.href = url; link.download = `${this.layout.title.replace(/[^\w-]+/g, '-').toLowerCase()}-elaia.json`;
      link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      this.toast('Instrument exported.');
    };
    $('import-btn').onclick = () => $('import-file').click();
    $('import-file').onchange = async () => {
      const file = $('import-file').files[0]; if (!file) return;
      try {
        if (file.size > 50000) throw new Error('Choose an Elaia JSON file smaller than 50 KB.');
        const layout = validateLayout(JSON.parse(await file.text()));
        this.commit(layout, { custom: false }); this.setView('top');
        $('library-dialog').close(); this.toast('Instrument imported. Save a named copy to keep it in your collection.');
      } catch (error) { this.toast(`Could not import: ${error.message}`); }
      $('import-file').value = '';
    };
    this.bindPointers();
    window.addEventListener('keydown', event => {
      if (document.querySelector('dialog[open]') || event.target.closest('input,select,textarea,[contenteditable]')) return;
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && key === 'z') { event.preventDefault(); this.travel(!event.shiftKey); return; }
      if (event.ctrlKey || event.metaKey || event.repeat) return;
      if (key === 'escape') { this.setAdvanced(false); return; }
      if (key === 'm') { event.preventDefault(); this.damp(); return; }
      const index = KEYS.indexOf(key);
      if (index >= 0) {
        const ordered = this.layout.fields.filter(f => f.side === 'top').concat(this.layout.fields.filter(f => f.side === 'bottom'));
        if (ordered[index]) { event.preventDefault(); this.play(ordered[index].id, event.shiftKey ? 0.28 : event.altKey ? 0.9 : 0.64); }
      }
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.damp(); this.audio.engine.ctx?.suspend();
      } else if (this.renderer) this.renderer.dirty = true;
    });
    window.addEventListener('pagehide', () => { this.cancelStrum(); this.audio.damp(); });
    window.addEventListener('hashchange', () => {
      const code = new URLSearchParams(location.hash.slice(1)).get('layout');
      if (!code) return;
      try { this.commit(decodeLayout(code), { custom: false }); this.setView('top'); }
      catch (error) { this.toast(error.message); }
    });
  }
}

window.__elaia = new Elaia();
