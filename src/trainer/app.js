import { SCALES } from '../model/scales.js';
import { noteName, midiToFreq } from '../model/notes.js';
import { detectPitch, centsFrom } from './pitch.mjs';
import { Engine } from '../audio/engine.js';
import { PitchScore } from './score.mjs';
import { PitchTrail } from './trail.js';
import { StableFeedback } from './feedback.mjs';
import { LEVELS, DEFAULT_LEVEL, clampLevel, holdFor, levelLabel, StruggleWatch } from './difficulty.mjs';
import { AttemptMeter, History, Records, LEVEL_KEY, formatDuration, runKey, readNumber, writeNumber } from './progress.mjs';
import { ProgressChart } from './chart.js';
import { NoteLane } from './lane.js';
import { buildRound, phaseAt, stepIndexAt, laneOffset, roundScore } from './arpeggio.mjs';
const stableFeedback = new StableFeedback();
let shownState = null, lastReadout = 0, lastScore = 0;
const pitchScore = new PitchScore();
const engine = new Engine();
let playbackRequest = 0;
const $ = id => document.getElementById(id);
const attempt = new AttemptMeter();
const struggle = new StruggleWatch();
const history = new History();
const records = new Records();
let level = clampLevel(readNumber(LEVEL_KEY, DEFAULT_LEVEL));
let run = null, range = 20, suggested = null, suggestionUntil = 0, lastSuggestionCheck = 0, clearArmed = false;
let lane = null, roundNumber = 0, streak = 0;
const tolerance = () => LEVELS[level].tolerance;
const holdTarget = () => lane ? lane.hold : holdFor(level, $('mode').value);
const speedrun = () => $('mode').value === 'speedrun';
const arpeggio = () => $('mode').value === 'arpeggio';
const pitchTrail = new PitchTrail($('pitch-space'));
$('pitch-space').append($('microphone'));
const holdRing = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
holdRing.id = 'hold-ring'; holdRing.setAttribute('viewBox', '0 0 48 48');
holdRing.setAttribute('role', 'progressbar'); holdRing.setAttribute('aria-label', 'Hold in tune');
holdRing.setAttribute('aria-valuemin', '0');
holdRing.innerHTML = '<circle class="hold-ring-track" cx="24" cy="24" r="20"/><circle id="hold-ring-fill" cx="24" cy="24" r="20" pathLength="100"/>';
$('pitch-marker').append(holdRing);
document.querySelector('.hold-track').remove();
function renderHold(now = performance.now()) {
  const seconds = holdTarget() / 1000;
  const progress = Math.min(1, hold / holdTarget());
  $('hold-ring-fill').style.strokeDashoffset = String(100 * (1 - progress));
  holdRing.setAttribute('aria-valuemax', seconds.toFixed(1));
  holdRing.setAttribute('aria-valuenow', (progress * seconds).toFixed(1));
  holdRing.setAttribute('aria-valuetext', now < holdAfter ? 'Listening · hold timer starts shortly' : `${(progress * seconds).toFixed(1)} of ${seconds.toFixed(1)} seconds in tune`);
  holdRing.classList.toggle('waiting', now < holdAfter);
  holdRing.classList.toggle('complete', progress === 1);
}
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
LEVELS.forEach((_, i) => $('difficulty').add(new Option(levelLabel(i), i)));
const chart = new ProgressChart($('progress-chart'), $('progress-table'));
function renderDifficulty(flash = false) {
  $('difficulty').value = String(level);
  $('easier').disabled = level === 0;
  $('harder').disabled = level === LEVELS.length - 1;
  $('difficulty-note').textContent = `${LEVELS[level].name}: stay within ±${tolerance()} cents for ${(holdTarget() / 1000).toFixed(1)} seconds.`;
  $('difficulty-note').classList.toggle('changed', flash);
  if (flash) setTimeout(() => $('difficulty-note').classList.remove('changed'), 900);
  document.querySelector('.hold-caption').textContent = `Fill the ring · hold in tune for ${(holdTarget() / 1000).toFixed(1)} seconds`;
  renderHold();
}
function setLevel(next, flash = true) {
  const wanted = clampLevel(next);
  hideSuggestion();
  struggle.quiet(performance.now());
  if (wanted === level) { renderDifficulty(flash); return; }
  level = wanted; writeNumber(LEVEL_KEY, level);
  advanceAt = 0; clearPitch(true, active);
  // A lane round bakes in the tolerance and tempo, so it is rebuilt at the new level.
  if (arpeggio()) startRound(performance.now(), false);
  renderDifficulty(flash); renderProgress(); renderRun();
}
function hideSuggestion() { suggested = null; suggestionUntil = 0; $('suggestion').hidden = true; }
function showSuggestion(kind, now) {
  suggested = kind; suggestionUntil = now + 15000;
  struggle.quiet(now);
  $('suggestion').hidden = false; $('suggestion').dataset.kind = kind;
  $('suggestion-text').textContent = kind === 'easier'
    ? 'Taking a while? A gentler setting still counts.'
    : 'You are landing these easily. Ready for a tighter target?';
  $('suggestion-yes').textContent = kind === 'easier' ? `Make it easier (${LEVELS[level - 1].name})` : `Make it harder (${LEVELS[level + 1].name})`;
}
// Speedrun: the clock starts on your first sung note and stops on the last note found.
function armRun() { run = speedrun() ? { startedAt: null, splits: [], done: false, ms: 0 } : null; }
function currentRunKey() { return runKey(scales[+$('scale').value].name, +$('octave').value, level); }
function renderRun(now = performance.now()) {
  $('run-bar').hidden = !speedrun();
  if (!speedrun()) return;
  const elapsed = !run ? 0 : run.done || run.startedAt === null ? run.ms : now - run.startedAt;
  $('run-clock').textContent = formatDuration(elapsed);
  $('run-clock').classList.toggle('running', !!run && !run.done && run.startedAt !== null);
  $('run-progress').textContent = `${completed.size} / ${notes().length}`;
  const best = records.best(currentRunKey());
  $('run-best').textContent = best ? formatDuration(best.ms) : '—';
}
function splitRun(now) {
  run.splits.push(now - run.startedAt);
  const total = notes().length;
  if (completed.size < total) {
    advanceAt = now + 220;
    feedback(`${completed.size} of ${total} · ${formatDuration(now - run.startedAt)}`, 'Straight on to the next note.');
    return;
  }
  run.ms = now - run.startedAt; run.done = true; advanceAt = 0;
  const outcome = records.submit(currentRunKey(), run.ms);
  renderProgress();
  feedback(outcome.improved ? `New best · ${formatDuration(run.ms)}!` : `Full scale in ${formatDuration(run.ms)}.`,
    outcome.previous === null ? 'That is your time to beat. Reset to run it again.'
      : outcome.improved ? `${formatDuration(outcome.previous)} beaten by ${formatDuration(outcome.previous - run.ms)}. Reset to run it again.`
        : `Your best is ${formatDuration(outcome.best)}. Reset to run it again.`);
}
// Arpeggio rounds. The lane object is the round plus its live state; while it
// exists the hold ring measures time inside the current note, not a single target.
const noteLane = new NoteLane($('pitch-space'));
function startRound(now = performance.now(), advance = false) {
  if (!arpeggio()) { endLane(); return; }
  if (advance) roundNumber++;
  lane = buildRound({ midis: notes(), round: roundNumber, level });
  Object.assign(lane, { startedAt: null, phase: null, step: -1, over: false, restartAt: 0, played: new Set() });
  lane.results = lane.steps.map(() => null);
  noteLane.setRound(lane, lane.steps.map(step => noteName(step.midi)));
  $('pitch-space').dataset.lane = 'on';
  index = lane.steps[0].index;
  advanceAt = 0; holdAfter = 0; clearPitch(true, active);
  render();
  noteLane.render({ round: lane, phase: 'listen', at: -1, results: lane.results });
  feedback(active ? 'Listen to the phrase.' : 'Ready when you are.',
    active ? 'It comes back at you in a moment.' : 'Start the microphone and the handpan plays a phrase for you to sing back.');
}
function endLane() {
  lane = null; noteLane.clear();
  delete $('pitch-space').dataset.lane;
  $('lane-caption').hidden = true;
}
function laneCaption() {
  $('lane-caption').hidden = false;
  $('lane-caption').textContent = `${lane.pattern} · ${lane.steps.length} notes`
    + (streak ? ` · ${streak} clean round${streak === 1 ? '' : 's'} in a row` : '');
}
function laneStep(i) { index = lane.steps[i].index; render(); }
function strikeStep(i) {
  try { prepareEngine(); engine.strike(lane.steps[i].index, 0.72, 0.15, 1); } catch (error) { audioError(error); }
}
function closeStep(now, i) {
  const stats = attempt.result(now);
  const hit = hold >= lane.hold;
  lane.results[i] = hit ? 'hit' : 'miss';
  if (hit) {
    completed.add(lane.steps[i].index);
    if (stats) {
      history.add({
        at: Date.now(), cents: stats.rms, best: stats.best, note: noteName(lane.steps[i].midi),
        scale: scales[+$('scale').value].name, difficulty: LEVELS[level].name, mode: 'arpeggio',
      });
      renderProgress();
    }
  }
  struggle.finish({ completed: hit, durationMs: lane.stepMs, rms: stats ? stats.rms : null });
  render();
}
function finishRound(now) {
  if (lane.step >= 0) { closeStep(now, lane.step); lane.step = -1; }
  const { hits, total } = roundScore(lane.results);
  streak = hits === total ? streak + 1 : 0;
  lane.over = true; lane.restartAt = now + 1600;
  feedback(hits === total ? streak > 1 ? `All ${total} notes · ${streak} clean rounds!` : `All ${total} notes. Clean round!` : `${hits} of ${total} notes.`,
    hits === total ? 'Here comes a new phrase.' : 'The next phrase is on its way — listen first.');
  noteLane.render({ round: lane, phase: 'sing', at: lane.steps.at(-1).at + lane.stepMs, results: lane.results });
  laneCaption();
}
function laneFrame(now) {
  if (lane.over) { if (now >= lane.restartAt) startRound(now, true); return; }
  if (lane.startedAt === null) { lane.startedAt = now; laneCaption(); }
  const { phase, at } = phaseAt(lane, now - lane.startedAt);
  if (phase === 'listen') {
    const sounding = Math.min(lane.steps.length - 1, Math.floor(at / lane.stepMs));
    if (!lane.played.has(sounding)) { lane.played.add(sounding); strikeStep(sounding); laneStep(sounding); }
    if (lane.phase !== 'listen') { lane.phase = 'listen'; feedback('Listen to the phrase.', 'Then sing it back as the blocks cross the line.'); }
    noteLane.render({ round: lane, phase, at, results: lane.results, sounding });
    return;
  }
  if (phase === 'done') { finishRound(now); return; }
  if (lane.phase !== 'sing') { lane.phase = 'sing'; hold = 0; feedback('Your turn.', 'Sing each note as its block crosses the centre line.'); }
  const step = stepIndexAt(lane.steps, at);
  if (step !== lane.step) {
    if (lane.step >= 0) closeStep(now, lane.step);
    lane.step = step; hold = 0; attempt.reset(); stableFeedback.reset(); shownState = null;
    if (step >= 0) laneStep(step);
  }
  noteLane.render({ round: lane, phase, at, results: lane.results, active: step });
}
function renderProgress() {
  const entries = history.recent(range);
  const summary = history.summary(range);
  chart.render({ entries, tolerance: tolerance() });
  $('stat-average').innerHTML = summary.average === null ? '—' : `${summary.average.toFixed(1)}<small> ¢</small>`;
  $('stat-best').innerHTML = summary.best === null ? '—' : `${summary.best.toFixed(1)}<small> ¢</small>`;
  $('stat-count').textContent = summary.total;
  const today = history.since(new Date().setHours(0, 0, 0, 0));
  $('stat-today').textContent = today ? `${today} today` : 'none yet today';
  const change = summary.trend ? Math.round(summary.trend.changePct) : null;
  $('stat-change').className = change === null ? '' : change >= 0 ? 'up' : 'down';
  $('stat-change').textContent = change === null ? 'Find a few notes to see a trend.'
    : change >= 0 ? `↓ ${change}% closer than when you started` : `↑ ${-change}% wider than when you started`;
  $('progress-headline').textContent = change === null ? 'Your accuracy over time'
    : change >= 5 ? `You are getting closer — ${change}% over these ${summary.count} notes.`
      : change <= -5 ? 'Off day? The trend is drifting wider.' : 'Holding steady.';
  const best = records.best(currentRunKey());
  $('stat-run').textContent = best ? formatDuration(best.ms) : '—';
  $('stat-run-note').textContent = best
    ? `${scales[+$('scale').value].name} · ${LEVELS[level].name} · ${best.count} run${best.count === 1 ? '' : 's'}`
    : 'no full scale run yet';
}
const scales = SCALES.filter(s => s.family === 'Classic' || s.family === 'Exotic');
const bottomSection = document.createElement('div');
bottomSection.hidden = true;
bottomSection.innerHTML = '<div class="eyebrow" style="text-align:center">UNDERSIDE NOTES</div><div id="handpan-bottom" class="handpan underside" aria-label="Handpan underside notes"></div>';
$('handpan').after(bottomSection);
let index = 0, completed = new Set(), context, stream, analyser, frame, active = false, hold = 0, previous = 0, lastAnalysis = 0, holdAfter = 0, advanceAt = 0, smooth = null;
let buffers;
const notes = () => scales[+$('scale').value].iv.map(n => n + scales[+$('scale').value].root + +$('octave').value);
const target = () => midiToFreq(notes()[index]);
scales.forEach((s, i) => $('scale').add(new Option(s.name, i)));
function feedback(title, detail) {
  if ($('guidance').textContent !== title) $('guidance').textContent = title;
  if ($('detail').textContent !== detail) $('detail').textContent = detail;
}
// Normally the space spans ±150 cents around the target. In a lane round it spans
// the phrase, so blocks, marker and trail all read as one melodic contour.
function offsetFor(cents) {
  if (!lane) return Math.max(-1, Math.min(1, cents / 150));
  return laneOffset(notes()[index] * 100 + cents, lane.window);
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
  // In a lane round the guidance line belongs to the phrase; the marker still speaks.
  if (!lane) feedback(copy[0], copy[1]);
  $('marker-label').textContent = copy[2];
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
  $('step').textContent = lane ? `PHRASE ${roundNumber + 1} · ${lane.pattern.toUpperCase()}` : `NOTE ${index + 1} OF ${list.length}`;
  $('next').textContent = lane ? 'New phrase →' : 'Next note →';
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
  renderRun();
}
function clearPitch(resetScore = true, keepMarker = false) {
  stableFeedback.reset(); shownState = null;
  if (resetScore) { pitchScore.reset(); pitchTrail.reset(); updateScore(performance.now()); }
  hold = 0; smooth = null; renderHold();
  if (keepMarker) return;
  $('pitch-space').dataset.state = 'idle'; $('pitch-marker').style.opacity = '.3';
  $('pitch-marker').style.top = '50%'; $('marker-label').textContent = 'Your voice';
  $('sung-note').textContent = '—'; $('cents').textContent = '— cents';
}
// A note left behind without being found is what "struggling" is made of.
function leaveNote() {
  if (!completed.has(index) && attempt.voicedMs > 3000) struggle.finish({ completed: false, durationMs: attempt.voicedMs });
  attempt.reset();
}
function choose(i) {
  leaveNote();
  index = i; advanceAt = 0; clearPitch(true, active); render();
  feedback(active ? 'Sing the target note.' : 'Ready when you are.',
    running() ? `${completed.size} of ${notes().length} found · keep going.` : 'Listen, take a breath, and gently match the pitch.');
}
const running = () => !!run && !run.done && run.startedAt !== null;
// In a speedrun the next note is the next one still missing, wherever you jumped from.
function nextIndex() {
  const list = notes();
  if (!run) return (index + 1) % list.length;
  for (let step = 1; step <= list.length; step++) {
    const candidate = (index + step) % list.length;
    if (!completed.has(candidate)) return candidate;
  }
  return index;
}
function noteFound(now) {
  completed.add(index);
  const stats = attempt.result(now);
  if (stats) {
    history.add({
      at: Date.now(), cents: stats.rms, best: stats.best, note: noteName(notes()[index]),
      scale: scales[+$('scale').value].name, difficulty: LEVELS[level].name, mode: $('mode').value,
    });
    renderProgress();
  }
  struggle.finish({ completed: true, durationMs: stats ? stats.voicedMs : 0, rms: stats ? stats.rms : null });
  render();
  if (running()) { splitRun(now); return; }
  feedback(completed.size === notes().length ? 'Beautiful. Scale complete!' : 'Note found. Nicely done.',
    $('mode').value === 'guided' ? 'Take a breath. The next note is on its way.' : 'Keep exploring this note, or choose another.');
  if ($('mode').value === 'guided') advanceAt = now + 1100;
}
async function audio() {
  await engine.start();
  context = engine.ctx;
  if (context.state !== 'running') await context.resume();
}
function audioError(error) { holdAfter = 0; renderHold(); $('error').textContent = `Audio could not start: ${error.message}`; }
// Use the original instrument model and its default touch/body/mix settings.
function prepareEngine() {
  const scale = scales[+$('scale').value];
  engine.build(scale, {
    a4: 440, rootMidi: scale.root + +$('octave').value, helmF: 85, seed: 7,
  });
  engine.param({ sustain: 1, kappa: 0.0076 * 0.42 });
  engine.wet.gain.value = 0.30 * 0.9;
  engine.dry.gain.value = 1 - 0.30 * 0.35;
  engine.master.gain.value = Math.pow(0.75, 1.6) * 1.6;
}
async function play() {
  const request = ++playbackRequest;
  holdAfter = Infinity; hold = 0; advanceAt = 0; renderHold();
  await audio();
  if (request !== playbackRequest) return;
  shownState = null;
  feedback('Listen to the note.', 'Let the tone settle, then join it with your voice.');
  prepareEngine();
  engine.strike(index, 0.72, 0.15, 1);
  holdAfter = performance.now() + 500;
  renderHold();
}
function stop() {
  $('pitch-space').classList.remove('listening');
  playbackRequest++; engine.silence();
  holdAfter = 0;
  active = false; cancelAnimationFrame(frame); stream?.getTracks().forEach(t => t.stop()); stream = null;
  analyser?.disconnect(); analyser = null; advanceAt = 0;
  const voided = running();
  clearPitch(); hideSuggestion();
  if (voided) { completed.clear(); index = 0; }
  if (speedrun()) { armRun(); render(); renderRun(); }
  if (arpeggio()) startRound(performance.now(), false);
  $('microphone').textContent = '◉  Start microphone'; $('mic-status').textContent = 'MIC OFF';
  feedback('Practice paused.', voided ? 'The clock stops with the microphone, so that run resets.' : 'Your progress is saved.');
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
    if (arpeggio()) feedback('Listen to the phrase.', 'Then sing it back as the blocks cross the line.');
    else feedback(speedrun() ? 'Sing to start the clock.' : 'Sing the target note.',
      speedrun() ? 'The run times itself from your first note to the last.' : 'Try a relaxed “oo” or “ah” sound.');
    frame = requestAnimationFrame(tick);
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
  if (speedrun()) renderRun(now);
  if (lane) laneFrame(now);
  if (suggestionUntil && now > suggestionUntil) hideSuggestion();
  if (advanceAt && now >= advanceAt) { const next = nextIndex(); choose(next); if (!run) play().catch(audioError); }
  analyser.getFloatTimeDomainData(buffers);
  const frequency = detectPitch(buffers, context.sampleRate);
  if (!frequency) {
    attempt.silence();
    // In a lane round the in-tune time already banked for this note stays banked.
    if (!advanceAt && !lane) hold = 0;
    renderHold(now);
    const state = stableFeedback.update(now, null, tolerance());
    if (state === 'idle') {
      if (!advanceAt) showPitchFeedback(state); smooth = null;
      $('pitch-marker').style.opacity = '.3';
      $('sung-note').textContent = '—'; $('cents').textContent = '— cents';
    }
    return;
  }
  const cents = centsFrom(frequency, target());
  updateScore(now, cents);
  if (!lane || lane.phase === 'sing') attempt.add(now, cents);
  if (run && !run.done && run.startedAt === null) { run.startedAt = now; feedback('Go!', 'The clock is running. Find every note.'); }
  if (now - lastSuggestionCheck > 1000) {
    lastSuggestionCheck = now;
    if (!suggested && !running()) {
      const nudge = struggle.suggest(now, { voicedMs: attempt.voicedMs, tolerance: tolerance(), canEasier: level > 0, canHarder: level < LEVELS.length - 1 });
      if (nudge) showSuggestion(nudge, now);
    }
  }
  smooth = smooth === null || Math.abs(cents - smooth) > 150 ? cents : smooth * .55 + cents * .45;
  const tuned = Math.abs(cents) <= tolerance();
  const state = stableFeedback.update(now, smooth, tolerance());
  const offset = offsetFor(smooth);
  pitchTrail.add(now, offset, state === 'tuned', smooth > 0);
  if (!advanceAt) showPitchFeedback(state);
  $('pitch-marker').style.opacity = '1'; $('pitch-marker').style.top = `${50 - offset * 39}%`;
  if (now - lastReadout >= 180) {
    lastReadout = now;
    $('sung-note').textContent = noteName(Math.round(69 + 12 * Math.log2(frequency / 440)));
    $('cents').textContent = `${Math.round(smooth) > 0 ? '+' : ''}${Math.round(smooth)} cents`;
  }
  if (advanceAt) { renderHold(now); return; }
  if (lane) {
    if (lane.phase === 'sing' && lane.step >= 0 && tuned) hold += elapsed;
    renderHold(now);
    return;
  }
  if (tuned && now >= holdAfter) {
    const previousHold = hold;
    hold += Math.min(elapsed, now - holdAfter);
    if (hold >= holdTarget() && previousHold < holdTarget()) noteFound(now);
  } else {
    hold = 0;
  }
  renderHold(now);
}
$('microphone').onclick = start; $('listen').onclick = () => play().catch(audioError);
$('next').onclick = () => {
  if (arpeggio()) { startRound(performance.now(), true); return; }
  choose(nextIndex()); play().catch(audioError);
};
function reset() {
  completed.clear(); armRun(); struggle.reset(); hideSuggestion(); streak = 0; roundNumber = 0;
  if (arpeggio()) startRound(); else { endLane(); choose(0); }
  renderRun(); renderProgress();
}
$('scale').onchange = reset; $('octave').onchange = reset; $('reset').onclick = reset;
// Reset first: a lane round sets its own hold, and the captions read it.
$('mode').onchange = () => { hideSuggestion(); reset(); renderDifficulty(); };
$('difficulty').onchange = () => setLevel($('difficulty').value, false);
$('easier').onclick = () => setLevel(level - 1);
$('harder').onclick = () => setLevel(level + 1);
$('suggestion-yes').onclick = () => setLevel(level + (suggested === 'easier' ? -1 : 1));
$('suggestion-no').onclick = () => { struggle.quiet(performance.now(), 180000); hideSuggestion(); };
document.querySelectorAll('.range button').forEach(button => {
  button.onclick = () => {
    range = button.dataset.range === 'all' ? Infinity : +button.dataset.range;
    document.querySelectorAll('.range button').forEach(other => other.classList.toggle('on', other === button));
    renderProgress();
  };
});
$('clear-progress').onclick = () => {
  if (!clearArmed) {
    clearArmed = true; $('clear-progress').textContent = 'Tap again to erase everything';
    setTimeout(() => { clearArmed = false; $('clear-progress').textContent = 'Clear history'; }, 5000);
    return;
  }
  clearArmed = false; $('clear-progress').textContent = 'Clear history';
  history.clear(); records.clear(); renderProgress(); renderRun();
};
document.addEventListener('visibilitychange', () => { if (document.hidden && active) stop(); });
window.addEventListener('pagehide', stop);
renderDifficulty(); armRun(); render(); renderRun(); renderProgress();
