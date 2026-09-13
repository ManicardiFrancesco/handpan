import { SCALES } from '../model/scales.js';
import { noteName, midiToFreq } from '../model/notes.js';
import { detectPitch, centsFrom } from './pitch.mjs';
import { Engine } from '../audio/engine.js';
import { PitchScore } from './score.mjs';
import { PitchTrail } from './trail.js';
import { StableFeedback } from './feedback.mjs';
const stableFeedback = new StableFeedback();
let shownState = null, lastReadout = 0, lastScore = 0;
const pitchScore = new PitchScore();
const engine = new Engine();
let playbackRequest = 0;
const $ = id => document.getElementById(id);
const pitchTrail = new PitchTrail($('pitch-space'));
$('pitch-space').append($('microphone'));
const scorePanel = document.createElement('div');
scorePanel.className = 'score-panel';
scorePanel.title = 'Last 2 seconds of detected voice. Score = 100 × exp(−RMS cents / 50). RMS measures distance from target; σ measures variation around your average pitch. Silence is excluded.';
scorePanel.innerHTML = '<div><span>LAST 2 SECONDS</span><strong id="pitch-score">—<small> / 100</small></strong></div><div><span>TARGET DEVIATION · RMS</span><strong id="pitch-rms">— cents</strong><small id="pitch-sigma">Stability σ: — cents</small></div>';
document.querySelector('.readouts').before(scorePanel);
function updateScore(now, cents = null) {
  const result = pitchScore.update(now, cents);
  if (result && now - lastScore < 150) return;
  lastScore = now;
  $('pitch-score').innerHTML = `${result ? result.score : '—'}<small> / 100</small>`;
  $('pitch-rms').textContent = result ? `${result.rms.toFixed(1)} cents` : '— cents';
  $('pitch-sigma').textContent = result ? `Stability σ: ${result.deviation.toFixed(1)} cents` : 'Stability σ: — cents';
}
const scales = SCALES.filter(s => s.family === 'Classic' || s.family === 'Exotic');
const bottomSection = document.createElement('div');
bottomSection.hidden = true;
bottomSection.innerHTML = '<div class="eyebrow" style="text-align:center">UNDERSIDE NOTES</div><div id="handpan-bottom" class="handpan underside" aria-label="Handpan underside notes"></div>';
$('handpan').after(bottomSection);
let index = 0, completed = new Set(), context, stream, analyser, frame, active = false, hold = 0, previous = 0, lastAnalysis = 0, suppressUntil = 0, advanceAt = 0, smooth = null;
let buffers;
const notes = () => scales[+$('scale').value].iv.map(n => n + scales[+$('scale').value].root + +$('octave').value);
const target = () => midiToFreq(notes()[index]);
scales.forEach((s, i) => $('scale').add(new Option(s.name, i)));
function feedback(title, detail) {
  if ($('guidance').textContent !== title) $('guidance').textContent = title;
  if ($('detail').textContent !== detail) $('detail').textContent = detail;
}
function showPitchFeedback(state) {
  if (state === shownState) return;
  shownState = state;
  $('pitch-space').dataset.state = state;
  const copy = {
    idle: ['Let your voice come through.', 'Sing a steady vowel near the microphone.', 'Your voice'],
    tuned: ['That’s it. Stay here.', 'Keep the sound easy and steady.', 'In tune'],
    high: ['↓ Sing a little lower.', 'Slide gently down until your voice meets the center.', '↓ Lower'],
    low: ['↑ Sing a little higher.', 'Glide gently up until your voice meets the center.', '↑ Higher'],
  }[state];
  feedback(copy[0], copy[1]); $('marker-label').textContent = copy[2];
}
function render() {
  const list = notes();
  const bottomFrom = scales[+$('scale').value].bottomFrom ?? list.length;
  bottomSection.hidden = bottomFrom >= list.length;
  // Match Renderer3D.layout in the original: ascending notes alternate sides.
  const outer = list.slice(1, bottomFrom).map((_, i) => i + 1);
  const ring = outer.filter((_, i) => i % 2 === 0)
    .concat(outer.filter((_, i) => i % 2 === 1).reverse());
  $('target-note').innerHTML = noteName(list[index]).replace(/(\d+)$/, '<small>$1</small>');
  $('target-hz').textContent = target().toFixed(2) + ' Hz';
  $('scale-description').textContent = scales[+$('scale').value].note;
  $('completed').textContent = `${completed.size} / ${list.length}`;
  $('step').textContent = `NOTE ${index + 1} OF ${list.length}`;
  for (const container of ['handpan','handpan-bottom','note-list']) {
    $(container).replaceChildren();
    list.forEach((midi, i) => {
      const isShell = container !== 'note-list';
      const isBottom = i >= bottomFrom;
      if (container === 'handpan' && isBottom || container === 'handpan-bottom' && !isBottom) return;
      const button = document.createElement('button');
      button.textContent = noteName(midi); button.className = `${isShell ? 'tone ' : ''}${i === index ? 'selected ' : ''}${completed.has(i) ? 'done' : ''}`;
      if (isBottom) button.title = 'Underside note';
      button.setAttribute('aria-label', `Practice ${noteName(midi)}`); button.setAttribute('aria-pressed', String(i === index));
      if (isShell) {
        const position = isBottom ? i - bottomFrom : ring.indexOf(i);
        const count = isBottom ? list.length - bottomFrom : ring.length;
        const angle = (position + 0.5) / count * Math.PI * 2 + Math.PI / 2;
        button.style.left = `${i ? 50 + Math.cos(angle) * 35 : 50}%`;
        button.style.top = `${i ? 50 + Math.sin(angle) * 35 : 50}%`;
      }
      button.onclick = () => { choose(i); play().catch(audioError); };
      $(container).append(button);
    });
  }
}
function clearPitch(resetScore = true) {
  stableFeedback.reset(); shownState = null;
  if (resetScore) { pitchScore.reset(); pitchTrail.reset(); updateScore(performance.now()); }
  hold = 0; smooth = null; $('hold-fill').style.width = '0%';
  $('pitch-space').dataset.state = 'idle'; $('pitch-marker').style.opacity = '.3';
  $('pitch-marker').style.top = '50%'; $('marker-label').textContent = 'Your voice';
  $('sung-note').textContent = '—'; $('cents').textContent = '— cents';
}
function choose(i) { index = i; advanceAt = 0; clearPitch(); render(); feedback(active ? 'Sing the target note.' : 'Ready when you are.', 'Listen, take a breath, and gently match the pitch.'); }
async function audio() {
  await engine.start();
  context = engine.ctx;
  if (context.state !== 'running') await context.resume();
}
function audioError(error) { $('error').textContent = `Audio could not start: ${error.message}`; }
async function play() {
  const request = ++playbackRequest;
  await audio();
  if (request !== playbackRequest) return;
  suppressUntil = performance.now() + 1800; clearPitch();
  feedback('Listen to the note.', 'Let the tone settle, then join it with your voice.');
  // Use the original instrument model and its default touch/body/mix settings.
  const scale = scales[+$('scale').value];
  engine.build(scale, {
    a4: 440, rootMidi: scale.root + +$('octave').value, helmF: 85, seed: 7,
  });
  engine.param({ sustain: 1, kappa: 0.0076 * 0.42 });
  engine.wet.gain.value = 0.30 * 0.9;
  engine.dry.gain.value = 1 - 0.30 * 0.35;
  engine.master.gain.value = Math.pow(0.75, 1.6) * 1.6;
  engine.strike(index, 0.72, 0.15, 1);
}
function stop() {
  $('pitch-space').classList.remove('listening');
  playbackRequest++; engine.silence();
  active = false; cancelAnimationFrame(frame); stream?.getTracks().forEach(t => t.stop()); stream = null;
  analyser?.disconnect(); analyser = null; advanceAt = 0; clearPitch();
  $('microphone').textContent = '◉  Start microphone'; $('mic-status').textContent = 'MIC OFF';
  feedback('Practice paused.', 'Your progress is saved for this session.');
}
async function start() {
  if (active) { stop(); return; }
  $('microphone').disabled = true; $('error').textContent = '';
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone access needs HTTPS or localhost and a supported browser.');
    await audio();
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    analyser = context.createAnalyser(); analyser.fftSize = 4096;
    context.createMediaStreamSource(stream).connect(analyser);
    buffers = new Float32Array(analyser.fftSize); active = true; previous = performance.now();
    $('pitch-space').classList.add('listening');
    stream.getAudioTracks()[0].onended = stop;
    $('microphone').textContent = '■  Stop microphone'; $('mic-status').textContent = '● LISTENING';
    feedback('Sing the target note.', 'Try a relaxed “oo” or “ah” sound.'); frame = requestAnimationFrame(tick);
  } catch (error) {
    stop(); $('error').textContent = error.name === 'NotAllowedError' ? 'Microphone permission was denied. Allow access in your browser’s site settings, then try again.' : error.name === 'NotFoundError' ? 'No microphone was found. Connect one and try again.' : error.message;
  } finally { $('microphone').disabled = false; }
}
function tick(now) {
  if (!active) return;
  frame = requestAnimationFrame(tick);
  if (now - lastAnalysis < 60) return;
  lastAnalysis = now;
  const elapsed = Math.min(now - previous, 120); previous = now;
  updateScore(now);
  pitchTrail.draw(now);
  if (advanceAt) {
    if (now >= advanceAt) { choose((index + 1) % notes().length); play().catch(audioError); }
    return;
  }
  if (now < suppressUntil) return;
  analyser.getFloatTimeDomainData(buffers);
  const frequency = detectPitch(buffers, context.sampleRate);
  if (!frequency) {
    hold = 0; $('hold-fill').style.width = '0%';
    const state = stableFeedback.update(now, null, +$('tolerance').value);
    if (state === 'idle') {
      showPitchFeedback(state); smooth = null;
      $('pitch-marker').style.opacity = '.3';
      $('sung-note').textContent = '—'; $('cents').textContent = '— cents';
    }
    return;
  }
  const cents = centsFrom(frequency, target());
  updateScore(now, cents);
  smooth = smooth === null || Math.abs(cents - smooth) > 150 ? cents : smooth * .55 + cents * .45;
  const tuned = Math.abs(cents) <= +$('tolerance').value;
  const state = stableFeedback.update(now, smooth, +$('tolerance').value);
  pitchTrail.add(now, smooth, state === 'tuned');
  showPitchFeedback(state);
  $('pitch-marker').style.opacity = '1'; $('pitch-marker').style.top = `${50 - Math.max(-1, Math.min(1, smooth / 150)) * 39}%`;
  if (now - lastReadout >= 180) {
    lastReadout = now;
    $('sung-note').textContent = noteName(Math.round(69 + 12 * Math.log2(frequency / 440)));
    $('cents').textContent = `${Math.round(smooth) > 0 ? '+' : ''}${Math.round(smooth)} cents`;
  }
  if (tuned) {
    const previousHold = hold;
    hold += elapsed;
    if (hold >= 2000 && previousHold < 2000) {
      completed.add(index); render();
      feedback(completed.size === notes().length ? 'Beautiful. Scale complete!' : 'Note found. Nicely done.', $('mode').value === 'guided' ? 'Take a breath. The next note is on its way.' : 'Keep exploring this note, or choose another.');
      if ($('mode').value === 'guided') advanceAt = now + 1100;
    }
  } else {
    hold = 0;
  }
  $('hold-fill').style.width = `${Math.min(100, hold / 20)}%`;
}
$('microphone').onclick = start; $('listen').onclick = () => play().catch(audioError);
$('next').onclick = () => { choose((index + 1) % notes().length); play().catch(audioError); };
function reset() { completed.clear(); choose(0); }
$('scale').onchange = reset; $('octave').onchange = reset; $('reset').onclick = reset;
$('mode').onchange = () => { advanceAt = 0; clearPitch(); };
$('tolerance').onchange = () => { advanceAt = 0; clearPitch(); };
document.addEventListener('visibilitychange', () => { if (document.hidden && active) stop(); });
window.addEventListener('pagehide', stop);
render();
