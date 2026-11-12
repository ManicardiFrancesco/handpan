import { HandpanRenderer } from './renderer.js';
import { ElaiaAudio } from './audio.js';
import { findChords } from '../src/theory/chords.js';
import { chordArpeggio, demoFields } from './playback.mjs';
import { addToneField, removeToneField, nextNote, scalePitches, placementStatus, originalLayout, setPlayingPosition, canAutoArrange } from './arrangement.mjs';
import {
  PRESETS, MAX_FIELDS, MIDI_MIN, MIDI_MAX, KEYS, clone, createLayout,
  validateLayout, transposeLayout, nextTranspose, fits, footprint, nameOf, frequencyOf, titleFor,
  encodeLayout, decodeLayout, loadStorage,
  arrangementInfo,
  restoreCurrent,
} from './model.mjs';
import { fieldShape, fieldGeometry, bodyDiameter } from './geometry.mjs';
import { allowedNote, stepNote, sizeForNote, dragAngle, noteDimensions } from './tonefields.mjs';

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
    this.audio.onStatus = () => { this.renderSampleStatus(); if (this.demo?.loading) this.renderDemo(); };
    this.advanced = false; this.editorTab = 'layout'; this.playTab = 'top'; this.tool = 'select'; this.selected = null;
    this.keyboard = false; this.history = []; this.future = []; this.pointers = new Map();
    this.playTimers = new Set(); this.playGeneration = 0; this.noteTimers = new Map(); this.demo = null;
    this.fieldLabels = new Map();
    this.showBottom = false;
    this.library = []; this.storageAvailable = true;
    this.layout = createLayout();
    this.restore();
    try {
      this.renderer = new HandpanRenderer($('instrument'));
    } catch {
      $('graphics-error').hidden = false;
    }
    this.fillNoteSelect($('field-note'));
    this.fillNoteSelect($('add-note'));
    $('add-note').value = '62';
    this.bind();
    this.setPlayTab('top', false); this.setTool('select');
    this.rebuild();
    if (this.renderer) {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe($('stage'));
      this.resize();
      const animate = time => {
        if (!document.hidden && this.renderer.draw(time / 1000)) { this.updateLabels(); this.updateBottomOverlay(); }
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
      try { this.layout = decodeLayout(code); }
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

  fillNoteSelect(select, side = 'top', selected = select.value) {
    select.replaceChildren();
    select.append(new Option('Unassigned', ''));
    let group, octave;
    for (let midi = MIDI_MIN; midi <= MIDI_MAX; midi++) {
      if (!allowedNote(midi, side)) continue;
      const current = Math.floor(midi / 12) - 1;
      if (current !== octave) {
        octave = current; group = make('optgroup');
        group.label = `Octave ${octave}`; select.append(group);
      }
      group.append(new Option(nameOf(midi), midi));
    }
    select.value = selected;
  }

  resize() {
    if (!this.renderer) return;
    const stage = $('stage'), rect = stage.getBoundingClientRect();
    const frame = rect.width < 620 ? {
      top: stage.querySelector('.instrument-heading').getBoundingClientRect().bottom - rect.top + 10,
      bottom: stage.querySelector('.stage-tools').getBoundingClientRect().top - rect.top - 10,
    } : null;
    this.renderer.resize(rect.width, rect.height, frame);
    this.fieldLabels.forEach(entry => { entry.width = 0; });
  }

  get editing() { return this.advanced && this.editorTab === 'layout'; }

  remember(before = this.layout) {
    this.history.push(clone(before));
    if (this.history.length > 50) this.history.shift();
    this.future = [];
  }

  commit(next, { geometry = true, audio = true, custom = true, before = this.layout } = {}) {
    try {
      next = validateLayout(next);
      if (JSON.stringify(next) === JSON.stringify(before)) return;
      this.remember(before);
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
    else this.audio.setPans(this.layout);
    if (this.renderer) {
      this.renderer.layout = this.layout;
      this.renderer.selected = this.selected; this.renderer.edit = this.editing;
      if (geometry) this.renderer.build(this.layout);
      this.renderer.dirty = true;
    }
    this.renderNotes(); this.renderChords(); this.renderDemo(); this.renderInfo(); this.renderInspector(); this.renderAdd(); this.renderHistory();
  }

  renderInfo() {
    const delta = this.layout.transpose;
    $('scale-title').textContent = titleFor(this.layout);
    $('scale-subtitle').textContent = `${this.layout.custom ? 'Custom instrument' : 'Ayasa'} · ${this.layout.fields.length} notes · ${this.layout.a4} Hz`;
    $('notes-total').textContent = this.layout.fields.length;
    $('custom-badge').hidden = !this.layout.custom;
    $('transpose-value').textContent = delta === 0 ? 'Transpose' : `${delta > 0 ? '+' : ''}${delta} st`;
    $('instrument-meta').textContent = `${this.layout.a4} Hz  ·  ${this.layout.fields.length} fields  ·  ${arrangementInfo(this.layout)}`;
    for (const [id, direction] of [['transpose-down', -1], ['transpose-up', 1]]) {
      const step = nextTranspose(this.layout, direction);
      $(id).disabled = step === null;
      $(id).title = step === null ? 'No supported key in this direction' : `Transpose ${step > 0 ? '+' : ''}${step} semitone${Math.abs(step) === 1 ? '' : 's'}; skips B♭4`;
    }
    markActive('[data-position]', 'position', this.layout.position || 1);
    $('bottom-overlay-btn').disabled = !this.renderer || !this.layout.fields.some(f => f.side === 'bottom');
    const canRestore = this.layout.custom || this.layout.transpose !== 0 || this.layout.manualPlacement;
    $('restore-original').hidden = !canRestore;
    document.body.classList.toggle('can-restore', !!canRestore);
    markActive('[data-pitch]', 'pitch', this.layout.a4);
    markActive('[data-finish]', 'finish', this.layout.finish);
    this.renderSampleStatus();
  }

  renderSampleStatus() {
    const { total, ready, failed } = this.audio.sampleStatus;
    $('sample-status').textContent = ready + failed < total ? `Loading recordings… ${ready}/${total}`
      : failed ? `${ready}/${total} recordings ready. Synthesis fills the gaps.`
       : total ? 'Ayasa recordings loaded.' : 'Assign a note to hear this instrument.';
  }

  renderNotes() {
    const ordered = this.layout.fields.filter(f => f.side === 'top').concat(this.layout.fields.filter(f => f.side === 'bottom'));
    for (const side of ['top', 'bottom']) {
      const container = $(`${side}-notes`); container.replaceChildren();
      const fields = ordered.filter(f => f.side === side);
      $(`${side}-count`).textContent = `${fields.length} note${fields.length === 1 ? '' : 's'}`;
      for (const f of fields) {
        const button = make('button', 'note-chip');
        button.dataset.id = f.id;
        button.title = fieldShape(f, this.layout) === 'dome' ? 'Convex tone field' : 'Concave tone field';
        const ding = side === 'top' && Math.hypot(f.x, f.z) < 0.1;
        if (ding) { button.classList.add('ding'); button.title = 'Ding · ' + button.title; }
        const note = nameOf(f.midi);
        if (f.midi === null) { button.textContent = '—'; button.classList.add('unassigned'); button.title = 'Assign a note in Customize'; }
        else button.append(document.createTextNode(note.slice(0, -1)), make('sub', '', note.slice(-1)));
        button.setAttribute('aria-label', `${f.midi === null ? 'Assign a note to' : this.editing ? 'Edit' : 'Play'} ${note}, ${side} shell${ding ? ', ding' : ''}`);
        if (this.selected === f.id && this.editing) button.classList.add('selected');
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
    if (field.midi === null && !this.advanced) this.setAdvanced(true);
    if (this.editing) {
      if (this.tool === 'add') this.setTool('select');
      this.select(field.id);
      this.setView(field.side);
    }
    this.play(field.id);
  }

  renderChords() {
    const notes = this.layout.fields.filter(f => f.midi !== null).map(f => ({ midi: f.midi, name: nameOf(f.midi), id: f.id }));
    this.chords = findChords(notes, { minNotes: 3, maxResults: 9, tonicPc: notes[0]?.midi % 12 });
    $('chords').replaceChildren();
    this.chords.forEach(chord => {
      const arpeggio = chordArpeggio(chord, notes);
      chord.notes = arpeggio.notes;
      const button = make('button', 'chord-chip', chord.plainSymbol.replaceAll('b', '♭').replaceAll('#', '♯'));
      button.dataset.chord = chord.plainSymbol;
      button.title = `${chord.plainSymbol} · ${arpeggio.notes.map(n => nameOf(n.midi)).join(' · ')}`;
      button.setAttribute('aria-label', `Arpeggiate ${chord.fullName}: ${arpeggio.notes.map(n => nameOf(n.midi)).join(', ')}`);
      button.onclick = () => this.strum(arpeggio, button);
      $('chords').append(button);
    });
    $('chord-detail').textContent = 'Choose a chord to hear every matching note, low to high.';
    if (!this.chords.length) $('chords').append(make('p', 'editor-hint', 'Add a few more notes to discover harmonies.'));
  }

  renderDemo() {
    document.querySelectorAll('[data-demo]').forEach(button => {
      const active = this.demo?.side === button.dataset.demo;
      button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
      button.disabled = !demoFields(this.layout, button.dataset.demo).length;
    });
    $('demo-stop').hidden = !this.demo;
    $('demo-status').textContent = !this.demo ? 'Low to high'
      : this.demo.loading ? 'Loading recordings…'
      : `${nameOf(this.demo.field.midi)} · ${this.demo.index + 1}/${this.demo.total}`;
  }

  async boot() {
    try {
      $('sound-label').textContent = this.audio.started ? 'Sound on' : 'Starting…';
      await this.audio.start();
      $('sound-label').textContent = 'Sound on'; $('sound-btn').classList.add('is-on');
      $('sound-btn').setAttribute('aria-label', 'Audio is enabled. Play the first note');
      return true;
    } catch (error) {
      $('sound-label').textContent = 'Retry audio';
      this.toast(`Audio could not start: ${error.message}. Use HTTPS or localhost.`);
      return false;
    }
  }

  async play(id, velocity = 0.64, position = 0.14, { automatic = false } = {}) {
    const field = this.layout.fields.find(f => f.id === id);
    if (!field || field.midi === null) return;
    if (!automatic && (this.demo || this.playTimers.size)) this.damp();
    const generation = this.playGeneration;
    if (!await this.boot() || generation !== this.playGeneration || !this.layout.fields.some(f => f.id === id)) return;
    await this.audio.prepare(id);
    if (generation !== this.playGeneration || !this.layout.fields.some(f => f.id === id)) return;
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
    this.playTimers.forEach(timer => clearTimeout(timer)); this.playTimers.clear();
    document.querySelectorAll('.chord-chip.sounding').forEach(b => b.classList.remove('sounding'));
    this.demo = null; this.renderDemo();
  }

  schedule(callback, delay, generation = this.playGeneration) {
    const timer = setTimeout(() => {
      this.playTimers.delete(timer);
      if (generation === this.playGeneration) callback();
    }, delay);
    this.playTimers.add(timer);
  }

  async strum(chord, button) {
    if (this.demo) this.audio.damp();
    this.cancelStrum();
    const generation = this.playGeneration;
    if (!await this.boot() || generation !== this.playGeneration) return;
    await Promise.all(chord.notes.map(note => this.audio.prepare(note.id)));
    if (generation !== this.playGeneration) return;
    button.classList.add('sounding');
    $('chord-detail').textContent = `${chord.symbol.replaceAll('b', '♭').replaceAll('#', '♯')} · ${chord.notes.map(n => nameOf(n.midi)).join(' · ')}`;
    chord.notes.forEach((note, i) => {
      this.schedule(() => this.play(note.id, 0.5, 0.14, { automatic: true }), i * 180, generation);
    });
    this.schedule(() => button.classList.remove('sounding'), chord.notes.length * 180 + 500, generation);
  }

  async playDemo(side) {
    if (this.demo?.side === side) { this.damp(); return; }
    this.damp();
    const fields = demoFields(this.layout, side);
    if (!fields.length) return;
    const generation = this.playGeneration;
    this.demo = { side, loading: true }; this.renderDemo();
    if (side !== 'all') this.setView(side);
    if (!await this.boot() || generation !== this.playGeneration) {
      if (generation === this.playGeneration) { this.demo = null; this.renderDemo(); }
      return;
    }
    await Promise.all(fields.map(field => this.audio.prepare(field.id)));
    if (generation !== this.playGeneration) return;
    fields.forEach((field, index) => {
      this.schedule(() => {
        this.demo = { side, loading: false, field, index, total: fields.length }; this.renderDemo();
        this.setPlayTab(field.side, false);
        this.play(field.id, 0.6, 0.14, { automatic: true });
      }, index * 600, generation);
    });
    this.schedule(() => { this.demo = null; this.renderDemo(); }, fields.length * 600, generation);
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
    if (this.demo || this.playTimers.size) this.damp();
    this.advanced = value;
    document.body.classList.toggle('advanced', value);
    $('advanced-btn').setAttribute('aria-pressed', String(value));
    $('advanced-btn').classList.toggle('active', value);
    $('advanced-panel').hidden = !value; $('normal-panel-footer').hidden = value; $('edit-banner').hidden = !value;
    $('editor-footer').hidden = !value;
    for (const [selector, target, home] of [
      ['.sound-controls', 'tuning-playback', 'playback-home'],
      ['.ambience-control', 'tuning-space', 'space-home'],
      ['.finish-control', 'tuning-finish', 'finish-home'],
    ]) $(value ? target : home).append(document.querySelector(selector));
    if (value) {
      window.scrollTo({ top: 0, behavior: 'instant' });
    } else this.tool = 'select';
    this.setEditorTab('layout');
    this.resize();
  }

  setEditorTab(tab) {
    this.editorTab = tab;
    document.body.classList.toggle('tuning-open', this.advanced && tab === 'tuning');
    $('layout-settings').hidden = tab !== 'layout';
    $('tuning-settings').hidden = tab !== 'tuning';
    document.querySelectorAll('[data-editor-tab]').forEach(button => {
      const active = button.dataset.editorTab === tab;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1;
    });
    if (this.renderer) { this.renderer.edit = this.editing; this.renderer.dirty = true; }
    this.setTool(this.tool); this.renderNotes();
    $('side-panel')?.scrollTo({ top: 0 });
  }

  setPlayTab(tab, updateView = true) {
    if (tab === 'notes') tab = this.noteSide || 'top';
    if (tab !== 'chords') this.noteSide = tab;
    this.playTab = tab;
    document.body.dataset.playTab = tab;
    document.querySelectorAll('[data-play-tab]').forEach(button => {
      const active = button.dataset.playTab === tab || (button.dataset.playTab === 'notes' && tab !== 'chords');
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1;
    });
    if (updateView && tab !== 'chords') this.setView(tab);
  }

  setTool(tool) {
    const enteringAdd = tool === 'add' && this.tool !== 'add';
    this.tool = tool;
    document.body.classList.toggle('adding-note', this.editing && tool === 'add');
    markActive('[data-tool]', 'tool', tool);
    const hints = {
      select: 'Tap a field or a note below to edit. Drag a field to move it.',
      add: 'Keep adding. The next note follows your scale.',
    };
    $('editor-hint').textContent = hints[tool];
    $('edit-message').textContent = tool === 'select' ? 'Drag a field to move it' : 'Add notes with one tap';
    $('add-settings').hidden = tool !== 'add';
    if (enteringAdd) {
      const view = this.renderer?.view;
      $('add-side').value = view === 'bottom' || view === 'free' && this.renderer.eye[1] < 0
        || !view && this.noteSide === 'bottom' ? 'bottom' : 'top';
      this.fillNoteSelect($('add-note'), $('add-side').value);
      this.suggestAdd();
    }
    $('instrument').style.cursor = 'grab';
    $('instrument').setAttribute('aria-label', this.editing
      ? 'Editable 3D handpan. Select a tone field to edit its note; drag a field to move it or the shell to rotate.'
      : 'Interactive 3D handpan. Touch a tone field to play; drag the shell to rotate.');
    const touch = matchMedia('(pointer: coarse)').matches;
    $('stage-hint').textContent = this.editing
      ? touch ? 'Drag a field to move · Pinch to zoom' : 'Drag fields to move · Drag the shell to orbit'
      : touch ? 'Touch to play · Drag to rotate · Pinch to zoom' : 'Click to play · Drag to rotate · Scroll to zoom';
    this.renderInspector(); this.renderAdd();
  }

  setView(view) {
    this.renderer?.setView(view);
    markActive('[data-view]', 'view', view);
    if (view !== 'free') this.setPlayTab(view, false);
    if (this.tool === 'add' && view !== 'free' && $('add-side').value !== view) {
      $('add-side').value = view; this.fillNoteSelect($('add-note'), view); this.suggestAdd(); this.renderAdd();
    }
  }

  select(id) {
    const changed = id !== this.selected;
    this.selected = id;
    if (this.renderer) { this.renderer.selected = id; this.renderer.dirty = true; }
    document.querySelectorAll('.note-chip').forEach(b => b.classList.toggle('selected', this.editing && b.dataset.id === id));
    this.renderInspector();
    if (id && changed && this.editing) document.querySelector('.side-panel').scrollTo({ top: 0, behavior: 'instant' });
  }

  selectedField() { return this.layout.fields.find(f => f.id === this.selected); }

  renderInspector() {
    const field = this.selectedField();
    $('field-inspector').hidden = !field || !this.advanced || this.tool !== 'select' || this.editorTab !== 'layout';
    document.body.classList.toggle('inspector-open', !$('field-inspector').hidden);
    $('editor-empty').hidden = !!field || this.tool !== 'select';
    if (!field) return;
    const ding = field.side === 'top' && Math.hypot(field.x, field.z) < 0.1;
    $('selected-field-title').textContent = `${ding ? 'Ding' : 'Tone field'} · ${field.side === 'top' ? 'Top' : 'Bottom'}`;
    this.fillNoteSelect($('field-note'), field.side, field.midi ?? '');
    $('field-frequency').textContent = field.midi === null ? 'Choose a pitch' : `${frequencyOf(field.midi, this.layout.a4).toFixed(2)} Hz`;
    $('field-down').disabled = stepNote(field.midi, -1, field.side) === null;
    $('field-up').disabled = stepNote(field.midi, 1, field.side) === null;
    $('audition-btn').disabled = field.midi === null;
    $('field-shell-label').textContent = `${field.side === 'top' ? 'Top' : 'Bottom'} shell`;
    $('field-shape').value = fieldShape(field, this.layout);
    $('field-shape').disabled = field.midi > 76;
    const diameter = bodyDiameter(this.layout), source = fieldGeometry(field.geometry), core = source?.dimple || source?.tier1;
    const innerMajor = field.dimpleSize !== undefined ? field.dimpleSize * diameter : core ? Math.max(core.Ru, core.Rv) * 2 : field.size * diameter * 0.28;
    const innerMinor = field.dimpleSize !== undefined ? innerMajor * (field.dimpleAspect ?? field.aspect ?? 0.82) : core ? Math.min(core.Ru, core.Rv) * 2 : innerMajor * (field.aspect ?? 0.82);
    const provenance = field.dimpleSize !== undefined ? noteDimensions(field.midi)?.source : 'Ayasa';
    $('field-dimensions').textContent = `Tonefield ${Math.round(field.size * diameter * (field.aspect ?? 0.82))} × ${Math.round(field.size * diameter)} mm · Dimple ${Math.round(innerMinor)} × ${Math.round(innerMajor)} mm${provenance ? ' · ' + provenance : ''}`;
    const angle = ((field.angle * 180 / Math.PI + 540) % 360) - 180;
    $('field-angle').value = angle; $('field-angle-value').textContent = `${Math.round(angle)}°`;
    $('remove-field').disabled = this.layout.fields.length <= 1;
  }

  updateField(change, options = {}) {
    if (!this.selectedField()) return;
    const next = clone(this.layout), field = next.fields.find(f => f.id === this.selected);
    Object.assign(field, change);
    if (change.midi !== undefined) {
      if (!allowedNote(field.midi, field.side)) { this.toast('Use F2–E6 without B♭4; bottom notes start at G♯2.'); this.renderInspector(); return; }
      Object.assign(field, sizeForNote(next, field));
      delete field.geometry; delete field.autoSize; delete field.lowerGeometry;
      if (canAutoArrange(this.layout)) field.autoSlot ??= field.id;
    }
    if ((change.midi !== undefined || change.size || change.x !== undefined || change.angle !== undefined) && !fits(next, field)) {
      this.toast(change.midi !== undefined ? 'That note’s full-size field needs more room. Move nearby fields or add it elsewhere.' : 'Leave a little space between fields and around the rim.');
      this.renderInspector(); return;
    }
    if (['size', 'x', 'z', 'angle', 'aspect'].some(key => change[key] !== undefined)) next.manualPlacement = true;
    this.commit(next, { geometry: true, audio: change.midi !== undefined, ...options });
  }

  suggestAdd(after) {
    if (!$('follow-scale').checked) return;
    $('add-note').value = nextNote(this.layout, $('add-side').value, after) ?? '';
  }

  renderAdd() {
    const side = $('add-side').value, midi = $('add-note').value === '' ? null : +$('add-note').value;
    const status = placementStatus(this.layout, side);
    $('placement-status').textContent = status.label;
    $('follow-scale').disabled = !scalePitches(this.layout).length;
    $('place-note-btn').textContent = midi === null ? 'Add unassigned field' : `Add ${nameOf(midi)}`;
    $('place-note-btn').disabled = status.full || this.layout.fields.length >= MAX_FIELDS || !allowedNote(midi, side)
      || (midi === null && $('follow-scale').checked && scalePitches(this.layout).length > 0);
    if (status.full) $('add-feedback').textContent = 'All five inner slots are used. Choose Bottom or drag a field to use a manual layout.';
    else if (midi === null && $('follow-scale').checked && scalePitches(this.layout).length) $('add-feedback').textContent = 'No higher scale notes within F2–E6. Choose a lower note or turn off Follow scale for an unassigned field.';
    else if (this.lastAdded && this.layout.fields.some(f => f.id === this.lastAdded)) {
      const last = this.layout.fields.find(f => f.id === this.lastAdded);
      $('add-feedback').textContent = `${nameOf(last.midi)} added. ${midi === null ? 'Keep adding, then choose pitches.' : `Next: ${nameOf(midi)}.`}`;
    } else $('add-feedback').textContent = midi === null ? 'Keep adding empty fields. Choose their pitches later.'
      : status.automatic ? 'One tap per note. Drag a field to take over the layout.' : 'Existing fields stay put. Drag each new field to adjust.';
  }

  addField() {
    if (this.layout.fields.length >= MAX_FIELDS) { this.toast(`This instrument already has ${MAX_FIELDS} tone fields.`); return; }
    const side = $('add-side').value;
    const midi = $('add-note').value === '' ? null : +$('add-note').value;
    const id = 'n-' + crypto.randomUUID().slice(0, 8), next = addToneField(this.layout, { id, midi, side });
    if (!next) { this.toast(`The full-size field will not fit on the ${side} shell. Choose another pitch or make room by moving fields.`); return; }
    this.selected = id; this.lastAdded = id;
    this.commit(next); this.setView(side);
    if (midi !== null) this.suggestAdd(midi);
    this.renderAdd(); this.play(id);
  }

  restoreOriginal() {
    const next = originalLayout(this.layout);
    this.damp(); this.selected = null; this.lastAdded = null;
    this.commit(next, { custom: false }); this.setTool('select'); this.setView('top');
    this.toast('Original instrument restored. Undo brings your edits back.');
  }

  updateLabels() {
    const container = $('field-labels');
    if (this.renderer?.view === 'free' && !this.advanced && !this.demo && this.playTab !== 'chords') {
      const side = this.renderer.eye[1] < 0 ? 'bottom' : 'top';
      if (side !== this.noteSide) this.setPlayTab(side, false);
    }
    if (!this.renderer || (!this.editing && !this.keyboard)) {
      container.replaceChildren(); this.fieldLabels.clear(); return;
    }
    const stage = container.getBoundingClientRect(), { width, height } = this.renderer;
    const obstacles = [...$('stage').querySelectorAll('.instrument-heading, .restore-original, .edit-banner, .stage-tools, .view-controls, .stage-hint, .graphics-error')]
      .filter(el => el.getClientRects().length).map(el => {
        const r = el.getBoundingClientRect();
        return { left: r.left - stage.left, right: r.right - stage.left, top: r.top - stage.top, bottom: r.bottom - stage.top };
      });
    const ids = new Set(this.renderer.positions.map(p => p.field.id));
    for (const [id, entry] of this.fieldLabels) {
      if (!ids.has(id)) { entry.label.remove(); this.fieldLabels.delete(id); }
    }
    // Reuse nodes and read their sizes together before writing positions.
    const labels = this.renderer.positions.map(p => {
      const text = p.field.midi === null ? '—' : nameOf(p.field.midi);
      let entry = this.fieldLabels.get(p.field.id);
      if (!entry) {
        entry = { label: make('span', 'field-label', text) };
        entry.label.dataset.id = p.field.id;
        container.append(entry.label); this.fieldLabels.set(p.field.id, entry);
      } else if (entry.label.textContent !== text) {
        entry.label.textContent = text; entry.width = 0;
      }
      return { p, entry };
    });
    labels.forEach(({ entry }) => { if (!entry.width) entry.label.hidden = false; });
    labels.forEach(({ entry }) => {
      if (!entry.width) { entry.width = entry.label.offsetWidth; entry.height = entry.label.offsetHeight; }
    });
    for (const { p, entry: { label, width: w, height: h } } of labels) {
      const x = Math.max(w / 2 + 4, Math.min(width - w / 2 - 4, p.x));
      const y = Math.max(h / 2 + 4, Math.min(height - h / 2 - 4, p.y));
      const rect = { left: x - w / 2, right: x + w / 2, top: y - h / 2, bottom: y + h / 2 };
      label.hidden = !p.visible || p.x < 0 || p.x > width || p.y < 0 || p.y > height
        || obstacles.some(o => rect.left < o.right + 4 && rect.right > o.left - 4 && rect.top < o.bottom + 4 && rect.bottom > o.top - 4);
      label.classList.toggle('selected', p.field.id === this.selected);
      label.style.left = `${x}px`; label.style.top = `${y}px`;
    }
  }

  updateBottomOverlay() {
    const overlay = $('bottom-overlay'), renderer = this.renderer;
    const hidden = !this.showBottom || !renderer || renderer.eye[1] <= 0;
    overlay.toggleAttribute('hidden', hidden);
    if (hidden) return;
    overlay.setAttribute('viewBox', `0 0 ${renderer.width} ${renderer.height}`);
    overlay.replaceChildren();
    const element = tag => document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const field of this.layout.fields.filter(f => f.side === 'bottom')) {
      const path = element('path');
      const points = footprint(field).map(([x, z]) => renderer.project(renderer.surfaceModel.sample(x, z, 'bottom').slice(0, 3)));
      path.setAttribute('d', points.map((p, index) => `${index ? 'L' : 'M'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ') + ' Z');
      path.dataset.id = field.id;
      const label = element('text'), center = renderer.positions.find(p => p.field.id === field.id);
      label.setAttribute('x', center.x); label.setAttribute('y', center.y);
      label.textContent = field.midi === null ? '—' : nameOf(field.midi);
      overlay.append(path, label);
    }
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
      const velocity = event.shiftKey ? 0.3 : event.altKey ? 0.9 : event.pressure > 0 && event.pressure !== 0.5 ? 0.35 + event.pressure * 0.5 : 0.72;
      const item = { ...p, startX: p.x, startY: p.y, moved: false, pick, baseline: null, orbitOnly, velocity };
      this.pointers.set(event.pointerId, item);
      if (this.pointers.size === 2) {
        this.pointers.forEach(p => { p.moved = true; });
        this.pinchDistance = this.pointerDistance();
      }
      if (this.editing) {
        if (pick && !orbitOnly) {
          this.setTool('select');
          this.select(pick.field.id);
          this.renderer.interactive = true;
          item.baseline = clone(this.layout);
          const surface = this.renderer.surfacePoint(p.x, p.y);
          if (surface) item.offset = { x: pick.field.x - surface.x, z: pick.field.z - surface.z };
        }
      } else if (pick && !orbitOnly) {
        if (pick.field.midi === null) this.noteButtonAction(pick.field);
        else this.play(pick.field.id, event.shiftKey ? 0.3 : event.altKey ? 0.9 : event.pressure > 0 && event.pressure !== 0.5 ? 0.35 + event.pressure * 0.5 : 0.64, pick.position * 0.42);
      }
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
      if (this.editing && item.pick && !item.orbitOnly) {
        const surface = this.renderer.surfacePoint(p.x, p.y), field = this.layout.fields.find(f => f.id === item.pick.field.id);
        if (!surface || !field || !item.offset || surface.side !== field.side) return;
        const x = surface.x + item.offset.x, z = surface.z + item.offset.z;
        const angle = dragAngle(field, x, z);
        if (fits(this.layout, { ...field, angle }, x, z)) {
          field.x = x; field.z = z; field.angle = angle; this.layout.custom = true; this.layout.manualPlacement = true;
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
          this.layout = item.baseline; this.audio.setPans(this.layout); this.rebuild({ audio: false });
        } else {
          this.commit(this.layout, { before: item.baseline, geometry: false, audio: false });
        }
      }
      if (!cancelled && item.pick && this.editing && !item.orbitOnly) {
        this.select(item.pick.field.id);
        if (!item.moved) this.play(item.pick.field.id);
      }
      if (!cancelled && !item.moved && !item.pick && !item.orbitOnly) {
        const p = point(event), surface = this.renderer.surfacePoint(p.x, p.y);
        if (surface && !this.editing) {
          if (this.demo) this.damp();
          const generation = this.playGeneration;
          this.boot().then(ok => { if (ok && generation === this.playGeneration) this.audio.tak(item.velocity, surface.x, surface.side); });
        }
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
    this.rebuild();
    if (this.tool === 'add') { this.suggestAdd(); this.renderAdd(); }
    this.persist();
  }

  renderScales() {
    const query = $('scale-search').value.trim().toLowerCase().replaceAll('♯', '#');
    const matching = PRESETS.filter(p =>
      `${p.name} ${p.title} ${p.iv.length} ${p.note}`.toLowerCase().replaceAll('♯', '#').includes(query));
    $('scale-list').replaceChildren();
    matching.forEach(p => {
      const button = make('button', 'scale-option' + (p.id === this.layout.preset && !this.layout.custom ? ' current' : ''));
      button.append(make('b', '', p.title), make('span', '', `${p.bottomFrom ?? p.iv.length} top · ${p.bottomFrom === undefined ? 0 : p.iv.length - p.bottomFrom} bottom · Ayasa`),
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
    $('share-heading').textContent = saved ? 'Saved. Ready to share.' : 'Share your handpan.';
    $('share-saved').hidden = !saved;
    $('share-saved').textContent = `“${layout.title}” is in your collection. This link recreates that saved version.`;
    $('share-local').hidden = !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && url.protocol !== 'file:';
    $('native-share-btn').hidden = typeof navigator.share !== 'function';
    $('share-dialog').showModal();
  }

  bind() {
    if (window.visualViewport) {
      const fitDialogs = () => {
        document.documentElement.style.setProperty('--visual-height', `${visualViewport.height}px`);
        document.documentElement.style.setProperty('--visual-top', `${visualViewport.offsetTop}px`);
      };
      visualViewport.addEventListener('resize', fitDialogs);
      visualViewport.addEventListener('scroll', fitDialogs);
      fitDialogs();
    }
    document.querySelectorAll('.close-dialog').forEach(b => { b.onclick = () => b.closest('dialog').close(); });
    document.querySelectorAll('dialog').forEach(d => d.addEventListener('click', e => {
      if (e.target !== d) return;
      const r = d.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) d.close();
    }));
    $('scale-btn').onclick = () => { this.renderScales(); $('scale-dialog').showModal(); $('scale-search').focus(); };
    $('scale-search').oninput = () => this.renderScales();
    $('advanced-btn').onclick = () => this.setAdvanced(!this.advanced);
    for (const [selector, choose] of [
      ['[data-editor-tab]', button => this.setEditorTab(button.dataset.editorTab)],
      ['[data-play-tab]', button => this.setPlayTab(button.dataset.playTab)],
    ]) {
      const tabs = [...document.querySelectorAll(selector)];
      tabs.forEach((button, index) => {
        button.onclick = () => choose(button);
        button.onkeydown = event => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
            : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
          choose(tabs[next]); tabs[next].focus();
        };
      });
    }
    $('customize-link').onclick = () => this.setAdvanced(true);
    document.querySelectorAll('[data-demo]').forEach(button => { button.onclick = () => this.playDemo(button.dataset.demo); });
    $('demo-stop').onclick = () => this.damp();
    $('add-bottom-link').onclick = () => { this.setAdvanced(true); this.setView('bottom'); this.setTool('add'); };
    $('place-note-btn').onclick = () => this.addField();
    $('cancel-add').onclick = () => this.setTool('select');
    $('add-note').onchange = () => {
      if ($('add-note').value === '') $('follow-scale').checked = false;
      this.renderAdd();
    };
    $('add-side').onchange = () => {
      this.fillNoteSelect($('add-note'), $('add-side').value);
      this.setView($('add-side').value); this.suggestAdd(); this.renderAdd();
    };
    $('follow-scale').onchange = () => { this.suggestAdd(); this.renderAdd(); };
    $('done-edit').onclick = () => this.setAdvanced(false);
    document.querySelectorAll('[data-view]').forEach(b => { b.onclick = () => this.setView(b.dataset.view); });
    document.querySelectorAll('[data-position]').forEach(b => { b.onclick = () => {
      try { this.commit(setPlayingPosition(this.layout, +b.dataset.position), { audio: false, custom: false }); }
      catch (error) { this.toast(error.message); }
    }; });
    $('bottom-overlay-btn').onclick = () => {
      this.showBottom = !this.showBottom;
      $('bottom-overlay-btn').setAttribute('aria-pressed', String(this.showBottom));
      $('bottom-overlay-btn').classList.toggle('active', this.showBottom);
      if (this.showBottom) this.setView('top');
      this.updateBottomOverlay();
      if (this.renderer) this.renderer.dirty = true;
    };
    $('bottom-view').onclick = () => this.setView('bottom');
    $('reset-view').onclick = () => { this.renderer?.reset(); this.setView(this.renderer?.view || 'top'); };
    $('sound-btn').onclick = () => {
      const field = this.layout.fields.find(f => f.midi !== null);
      if (field) this.play(field.id); else this.toast('Choose a pitch for a tone field in Customize.');
    };
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
    for (const [id, direction] of [['transpose-down', -1], ['transpose-up', 1]]) $(id).onclick = () => {
      try {
        const delta = nextTranspose(this.layout, direction);
        if (delta !== null) this.commit(transposeLayout(this.layout, delta));
      }
      catch (error) { this.toast(error.message); }
    };
    document.querySelectorAll('[data-tool]').forEach(b => { b.onclick = () => {
      this.setEditorTab('layout');
      this.setTool(b.dataset.tool);
    }; });
    $('field-note').onchange = () => { this.updateField({ midi: $('field-note').value === '' ? null : +$('field-note').value }); this.play(this.selected); };
    $('field-shape').onchange = () => this.updateField({ shape: $('field-shape').value }, { audio: false });
    for (const [id, direction] of [['field-down', -1], ['field-up', 1]]) $(id).onclick = () => {
      const field = this.selectedField(), midi = field && stepNote(field.midi, direction, field.side);
      if (midi !== null && midi !== undefined) { this.updateField({ midi }); this.play(this.selected); }
    };
    $('audition-btn').onclick = () => this.play(this.selected);
    $('close-inspector').onclick = () => this.select(null);
    // One undo entry per slider gesture, including keyboard changes.
    for (const [id, property, convert] of [['field-angle', 'angle', v => +v * Math.PI / 180]]) {
      const input = $(id);
      input.oninput = () => {
        const field = this.selectedField(); if (!field) return;
        if (!this.rangeBaseline) this.rangeBaseline = clone(this.layout);
        const value = convert(input.value), test = { ...field, [property]: value };
        if (!fits(this.layout, test)) { input.value = field.angle * 180 / Math.PI; return; }
        if (field[property] !== value) this.layout.manualPlacement = true;
        field[property] = value; this.layout.custom = true;
        if (this.renderer) this.renderer.interactive = true;
        this.requestMesh();
        $(id + '-value').textContent = `${Math.round(value * 180 / Math.PI)}°`;
      };
      input.onchange = () => {
        if (this.rangeBaseline) this.commit(this.layout, { before: this.rangeBaseline, geometry: false, audio: false });
        this.rangeBaseline = null;
        if (this.renderer) this.renderer.interactive = false;
        this.requestMesh();
      };
    }
    $('remove-field').onclick = () => {
      if (this.layout.fields.length <= 1) { this.toast('Keep at least one tone field on your instrument.'); return; }
      this.commit(removeToneField(this.layout, this.selected));
    };
    $('undo-btn').onclick = () => this.travel(true); $('redo-btn').onclick = () => this.travel(false);
    $('reset-layout').onclick = () => this.restoreOriginal();
    $('restore-original').onclick = () => this.restoreOriginal();
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
      if (document.querySelector('dialog[open]')) return;
      const key = event.key.toLowerCase();
      const textEntry = event.target.closest('textarea,[contenteditable],input:not([type=range])');
      if ((event.ctrlKey || event.metaKey) && key === 'z' && !textEntry) { event.preventDefault(); this.travel(!event.shiftKey); return; }
      if (event.target.closest('input,select,textarea,[contenteditable]')) return;
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
