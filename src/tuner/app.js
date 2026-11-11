import {
  DEFAULT_TOP,
  DEFAULT_BOTTOM,
  RATIOS,
  parseNote,
  frequency,
  cents,
  detectPartials,
  confirmPartials,
} from './detection.mjs';
import { TunerAudio } from './audio.js';

const $ = (id) => document.getElementById(id);
const audio = new TunerAudio();
const colors = ['#4d937a', '#7096bb', '#ce9c67'];
const labels = ['Fundamental', 'Octave', 'Fifth'];
let settings = { a4: 440, top: [...DEFAULT_TOP], bottom: [...DEFAULT_BOTTOM] };
let candidates = [null, null, null];
try {
  const saved = JSON.parse(localStorage.getItem('pan-tune.instrument'));
  if (
    saved &&
    saved.a4 >= 415 &&
    saved.a4 <= 466 &&
    saved.top?.length === 11 &&
    saved.bottom?.length === 7 &&
    [...saved.top, ...saved.bottom].every((n) => parseNote(n)) &&
    new Set([...saved.top, ...saved.bottom].map((n) => parseNote(n).midi)).size === 18
  )
    settings = saved;
} catch {}
let side = 'top',
  selected = settings.top[0],
  results = [null, null, null],
  history = [];
let tab = 'history',
  lastAnalysis = 0,
  previousFrame = 0,
  warmupUntil = 0,
  sequence = 0;
const offsets = [0, 0, 0];
let toastTimer,
  referenceTimer,
  recordingTimer,
  recording = null,
  recordedURL = null,
  recordedAudio = null;
let recordedNote = null,
  recordingChunks = [],
  stoppingRecording = false;
const target = () => frequency(parseNote(selected).midi, settings.a4);
const pretty = (n) => n.replace('#', '♯').replace('b', '♭');
const signed = (n) => (n > 0 ? '+' : '') + n.toFixed(1);
const escapedNote = (n) => pretty(n).replace(/(\d)$/, '<sub>$1</sub>');
const currentNotes = () => settings[side];
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

$('strobe-rows').innerHTML = labels
  .map(
    (label, i) => `
  <div class="strobe-row"><div class="strobe-label">${label}<small>${i + 1}× ${i === 2 ? 'COMPOUND FIFTH' : 'PARTIAL'}</small></div>
  <div class="strobe-track" id="track-${i}"><div class="strobe-stripes" style="--stripe:${colors[i]}" id="stripes-${i}"></div></div>
  <div class="strobe-cents" id="strobe-${i}">—<small>CENTS</small></div></div>`,
  )
  .join('');
$('partial-cards').innerHTML = labels
  .map(
    (label, i) => `
  <article class="partial-card" style="--partial-color:${colors[i]}"><div class="partial-title">${label}<span>${i + 1}×</span></div>
  <div class="partial-ideal" id="ideal-${i}"></div><div class="partial-reading" id="reading-${i}">—<small>cents</small></div>
  <div class="partial-frequency" id="measured-${i}">Not detected</div><div class="partial-bar"><i id="marker-${i}"></i></div>
  <div class="partial-state" id="state-${i}">Waiting for a strike</div><div class="interval-error" id="interval-${i}"></div></article>`,
  )
  .join('');

function notify(message) {
  $('toast').textContent = message;
  $('toast').style.display = 'block';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($('toast').style.display = 'none'), 6000);
}
function clearRecorded() {
  recordedAudio?.pause();
  recordedAudio = null;
  if (recordedURL) URL.revokeObjectURL(recordedURL);
  recordedURL = null;
  recordedNote = null;
  $('play-recording').disabled = true;
  $('recording-label').textContent = 'Capture your strike for a direct A/B comparison.';
}
function stopRecording(discard = false) {
  clearTimeout(recordingTimer);
  if (recording?.state === 'recording') {
    stoppingRecording = discard;
    recording.stop();
  }
  $('record-strike').textContent = '● Capture strike';
}
function setSide(value) {
  side = value;
  for (const s of ['top', 'bottom']) {
    $(`${s}-shell`).classList.toggle('selected', side === s);
    $(`${s}-shell`).setAttribute('aria-pressed', String(side === s));
  }
  select(currentNotes()[0]);
}
function drawInstrument() {
  $('handpan')
    .querySelectorAll('.tone')
    .forEach((n) => n.remove());
  $('note-list').replaceChildren();
  const notes = currentNotes();
  notes.forEach((note, i) => {
    const ding = side === 'top' && i === 0;
    const j = side === 'top' ? i - 1 : i;
    const count = side === 'top' ? notes.length - 1 : notes.length;
    const angle = Math.PI / 2 + (j / count) * Math.PI * 2;
    const x = ding ? 50 : 50 + Math.cos(angle) * 35;
    const y = ding ? 49 : 50 + Math.sin(angle) * 35;
    const field = document.createElement('button');
    field.className = 'tone' + (ding ? ' ding' : '') + (selected === note ? ' selected' : '');
    field.style.left = `${x}%`;
    field.style.top = `${y}%`;
    field.setAttribute('aria-label', `${pretty(note)}${ding ? ', ding' : ''}`);
    field.setAttribute('aria-pressed', String(note === selected));
    field.innerHTML = `<span>${pretty(note)}</span><small>${ding ? 'DING' : i + (side === 'bottom' ? 1 : 0)}</small>`;
    field.addEventListener('click', () => choose(note));
    $('handpan').append(field);
    const chip = document.createElement('button');
    chip.textContent = pretty(note);
    chip.className = selected === note ? 'selected' : '';
    chip.setAttribute('aria-pressed', String(note === selected));
    chip.addEventListener('click', () => choose(note));
    $('note-list').append(chip);
  });
}
function choose(note) {
  select(note);
  if ($('audition-notes').checked && audio.mode !== 'mic') reference();
}
function select(note) {
  stopRecording(true);
  clearRecorded();
  selected = note;
  audio.stopReference();
  audio.configureInstrument(settings);
  clearTimeout(referenceTimer);
  $('reference-status').textContent = 'Physical model · calibrated 1 : 2 : 3';
  results = [null, null, null];
  candidates = [null, null, null];
  history = [];
  warmupUntil = performance.now() + 900;
  drawInstrument();
  $('target-note').innerHTML =
    `${escapedNote(note)}<span id="target-frequency">${target().toFixed(2)} <small>Hz</small></span>`;
  $('field-label').textContent =
    `${side === 'top' && note === settings.top[0] ? 'DING · ' : ''}${side.toUpperCase()} SHELL`;
  RATIOS.forEach(
    (ratio, i) => ($('ideal-' + i).textContent = `Ideal · ${(target() * ratio).toFixed(2)} Hz`),
  );
  $('pitch-label').textContent = settings.a4;
  $('footer-pitch').textContent = settings.a4;
  if (audio.mode === 'demo') audio.demo(target()).catch(error);
  updateReadings();
  renderChart(performance.now());
}
function error(err) {
  const message =
    err.name === 'NotAllowedError'
      ? 'Microphone access was blocked. Allow it in your browser’s site settings, then try again.'
      : err.name === 'NotFoundError'
        ? 'No microphone found. Connect one, then try again.'
        : err.name === 'NotReadableError'
          ? 'Your microphone is busy. Close the other app using it, then try again.'
          : `Audio couldn’t start: ${err.message || 'check your browser’s audio permissions.'}`;
  notify(message);
}
function updateInputUI() {
  const mic = audio.mode === 'mic',
    demo = audio.mode === 'demo';
  $('microphone').innerHTML = mic
    ? '<span>■</span> Stop microphone'
    : '<span>♩</span> Enable microphone';
  $('demo').innerHTML = demo ? 'Stop demo <span>■</span>' : 'Try a demo <span>↗</span>';
  $('live-status').className = 'status-pill' + (mic ? ' live' : demo ? ' demo' : '');
  $('live-status').innerHTML = '<b></b>' + (mic ? 'Listening' : demo ? 'Demo signal' : 'Mic off');
  $('record-strike').disabled = !mic;
  $('audition-notes').disabled = mic;
  $('input-label').textContent = mic
    ? 'Listening on this device'
    : demo
      ? 'Generated demo · not your handpan'
      : 'Waiting for microphone';
  $('strobe-message').textContent = mic
    ? 'Strike the selected field gently. Let the overtones ring.'
    : demo
      ? 'Demo: three intentionally detuned partials.'
      : 'Enable your mic, then strike the selected note.';
}
function stopInput() {
  sequence++;
  stopRecording();
  audio.stopInput();
  results = [null, null, null];
  candidates = [null, null, null];
  updateInputUI();
  updateReadings();
  $('input-level').style.width = '0';
  renderChart(performance.now());
}
$('microphone').addEventListener('click', async () => {
  if (audio.mode === 'mic') return stopInput();
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    notify('Microphone access needs HTTPS or localhost. Open this app through a local web server.');
    return;
  }
  const request = ++sequence;
  audio.stopReference();
  $('microphone').disabled = true;
  try {
    await audio.microphone();
    if (request !== sequence) {
      audio.stopInput();
      return;
    }
    audio.stream.getAudioTracks()[0].onended = () => {
      if (audio.mode === 'mic') stopInput();
    };
    warmupUntil = performance.now() + 900;
    history = [];
    results = [null, null, null];
    candidates = [null, null, null];
    updateInputUI();
  } catch (err) {
    error(err);
    updateInputUI();
  } finally {
    $('microphone').disabled = false;
  }
});
$('demo').addEventListener('click', async () => {
  if (audio.mode === 'demo') return stopInput();
  if ($('microphone').disabled) return;
  stopRecording();
  sequence++;
  $('demo').disabled = true;
  try {
    await audio.demo(target());
    warmupUntil = performance.now() + 900;
    history = [];
    results = [null, null, null];
    candidates = [null, null, null];
    updateInputUI();
  } catch (err) {
    error(err);
  } finally {
    $('demo').disabled = false;
  }
});
function updateReadings() {
  const tolerance = Number($('tolerance').value);
  results.forEach((r, i) => {
    const inTune = r && Math.abs(r.cents) <= tolerance;
    const color = r ? (inTune ? colors[i] : '#cfaa79') : '#738e7d';
    $('track-' + i).classList.toggle('detected', !!r);
    $('strobe-' + i).innerHTML = `${r ? signed(r.cents) : '—'}<small>CENTS</small>`;
    $('strobe-' + i).style.color = color;
    $('reading-' + i).innerHTML = `${r ? signed(r.cents) : '—'}<small>cents</small>`;
    $('reading-' + i).style.color = r ? (inTune ? colors[i] : '#b08b57') : '#8b9a83';
    $('measured-' + i).textContent = r ? `${r.hz.toFixed(2)} Hz measured` : 'Not detected';
    $('marker-' + i).style.display = r ? 'block' : 'none';
    $('marker-' + i).style.left = `${r ? Math.max(0, Math.min(100, 50 + r.cents)) : 50}%`;
    $('state-' + i).textContent = r
      ? inTune
        ? '● Within tolerance'
        : r.cents < 0
          ? '← Flat of reference'
          : 'Sharp of reference →'
      : audio.mode === 'off'
        ? 'Waiting for a strike'
        : 'No clear partial';
    $('state-' + i).style.color = r ? (inTune ? '#77906d' : '#b39a78') : '#a6ae9e';
    $('interval-' + i).textContent =
      i > 0 && r && results[0]
        ? `Interval error ${signed(cents(r.hz, results[0].hz * (i + 1)))} ¢`
        : '';
  });
}
async function reference(ratio = 0) {
  const note = selected;
  try {
    recordedAudio?.pause();
    const played = await audio.reference(target(), ratio);
    if (!played || selected !== note) return;
    $('reference-status').textContent =
      `Playing ${pretty(note)} · ${ratio ? labels[ratio - 1].toLowerCase() + ' · pure tone' : 'handpan reference · physical model'}`;
    clearTimeout(referenceTimer);
    referenceTimer = setTimeout(
      () => ($('reference-status').textContent = 'Physical model · calibrated 1 : 2 : 3'),
      6000,
    );
  } catch (err) {
    error(err);
  }
}
$('play-reference').addEventListener('click', () => reference());
document
  .querySelectorAll('[data-play]')
  .forEach((b) => b.addEventListener('click', () => reference(Number(b.dataset.play))));
$('stop-reference').addEventListener('click', () => {
  audio.stopReference();
  recordedAudio?.pause();
  clearTimeout(referenceTimer);
  $('reference-status').textContent = 'Playback stopped';
});
$('volume').addEventListener('input', () => {
  audio.setVolume(Number($('volume').value) / 100);
  if (recordedAudio) recordedAudio.volume = audio.volume;
});
$('top-shell').addEventListener('click', () => setSide('top'));
$('bottom-shell').addEventListener('click', () => setSide('bottom'));
$('tolerance').addEventListener('change', updateReadings);
$('help-button').addEventListener('click', () => $('help-dialog').showModal());
for (const dialog of document.querySelectorAll('dialog'))
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
$('settings-button').addEventListener('click', () => {
  $('concert-pitch').value = settings.a4;
  $('top-notes').value = settings.top.join(' ');
  $('bottom-notes').value = settings.bottom.join(' ');
  $('settings-error').textContent = '';
  $('settings-dialog').showModal();
});
$('close-settings').addEventListener('click', () => $('settings-dialog').close());
$('reset-settings').addEventListener('click', () => {
  $('concert-pitch').value = 440;
  $('top-notes').value = DEFAULT_TOP.join(' ');
  $('bottom-notes').value = DEFAULT_BOTTOM.join(' ');
});
$('settings-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const top = $('top-notes')
    .value.trim()
    .replaceAll('♯', '#')
    .replaceAll('♭', 'b')
    .split(/[\s,]+/);
  const bottom = $('bottom-notes')
    .value.trim()
    .replaceAll('♯', '#')
    .replaceAll('♭', 'b')
    .split(/[\s,]+/);
  if (top.length !== 11 || bottom.length !== 7 || [...top, ...bottom].some((n) => !parseNote(n))) {
    $('settings-error').textContent =
      'Enter 11 top notes and 7 bottom notes using names like D3, F#4 or Bb3.';
    return;
  }
  if (new Set([...top, ...bottom].map((n) => parseNote(n).midi)).size !== 18) {
    $('settings-error').textContent = 'Each of the 18 fields needs a distinct pitch.';
    return;
  }
  settings = { a4: Number($('concert-pitch').value), top, bottom };
  try {
    localStorage.setItem('pan-tune.instrument', JSON.stringify(settings));
  } catch {
    notify('Settings applied for this visit. Your browser blocked saving them.');
  }
  $('settings-dialog').close();
  setSide(side);
  notify('Instrument saved. Reference tones and tuning targets updated.');
});
function setTab(value) {
  tab = value;
  for (const t of ['history', 'spectrum']) {
    $(t + '-tab').classList.toggle('selected', t === tab);
    $(t + '-tab').setAttribute('aria-pressed', String(t === tab));
  }
  $('chart-description').textContent =
    tab === 'history'
      ? 'Last 12 seconds · deviation from ideal pitch'
      : 'Frequency spectrum · selected fundamental and overtones';
  $('chart').setAttribute(
    'aria-label',
    tab === 'history' ? 'Live pitch history chart' : 'Live frequency spectrum chart',
  );
  renderChart(performance.now());
}
$('history-tab').addEventListener('click', () => setTab('history'));
$('spectrum-tab').addEventListener('click', () => setTab('spectrum'));
$('clear-history').addEventListener('click', () => {
  history = [];
  renderChart(performance.now());
  notify('Pitch trace cleared.');
});
function renderChart(now) {
  const canvas = $('chart'),
    w = canvas.clientWidth,
    h = canvas.clientHeight,
    dpr = Math.min(devicePixelRatio || 1, 2);
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const left = 35,
    right = w - 8,
    top = 10,
    bottom = h - 24;
  ctx.font = '8px "DM Sans", sans-serif';
  ctx.lineWidth = 1;
  if (tab === 'history') {
    const y = (c) => top + ((50 - c) / 100) * (bottom - top);
    const tolerance = Number($('tolerance').value);
    ctx.fillStyle = '#edf3e7';
    ctx.fillRect(left, y(tolerance), right - left, y(-tolerance) - y(tolerance));
    [-50, -25, 0, 25, 50].forEach((c) => {
      ctx.strokeStyle = c === 0 ? '#d2dfc8' : '#ecf0e5';
      ctx.setLineDash(c === 0 ? [] : [3, 4]);
      ctx.beginPath();
      ctx.moveTo(left, y(c));
      ctx.lineTo(right, y(c));
      ctx.stroke();
      ctx.fillStyle = '#a2ae96';
      ctx.textAlign = 'right';
      ctx.fillText(c > 0 ? '+' + c : String(c), left - 9, y(c) + 3);
    });
    ctx.setLineDash([]);
    [12, 9, 6, 3, 0].forEach((seconds) => {
      const x = left + ((12 - seconds) / 12) * (right - left);
      ctx.strokeStyle = '#f0f2ea';
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
      ctx.stroke();
      ctx.fillStyle = '#aab49f';
      ctx.textAlign = 'center';
      ctx.fillText(seconds === 0 ? 'now' : `−${seconds}s`, Math.min(x, right - 8), h - 7);
    });
    results.forEach((_, i) => {
      ctx.strokeStyle = colors[i];
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      let connected = false,
        previous = 0;
      for (const point of history) {
        const value = point.values[i];
        const x = left + ((point.time - (now - 12000)) / 12000) * (right - left);
        if (value === null || Math.abs(value) > 50 || x < left) {
          connected = false;
          continue;
        }
        if (!connected || point.time - previous > 220) ctx.moveTo(x, y(value));
        else ctx.lineTo(x, y(value));
        connected = true;
        previous = point.time;
      }
      ctx.stroke();
    });
    $('chart-empty').style.display = history.some((p) => p.values.some((v) => v !== null))
      ? 'none'
      : 'flex';
  } else {
    const min = target() * 0.65,
      max = target() * 3.6;
    const x = (f) => left + (Math.log(f / min) / Math.log(max / min)) * (right - left);
    const y = (db) => bottom - Math.max(0, Math.min(1, (db + 100) / 85)) * (bottom - top);
    [-90, -60, -30].forEach((db) => {
      ctx.strokeStyle = '#e9eee1';
      ctx.beginPath();
      ctx.moveTo(left, y(db));
      ctx.lineTo(right, y(db));
      ctx.stroke();
      ctx.fillStyle = '#a2ae96';
      ctx.textAlign = 'right';
      ctx.fillText(db + ' dB', left - 5, y(db) + 3);
    });
    if (audio.mode !== 'off' && audio.spectrum) {
      ctx.beginPath();
      ctx.moveTo(left, bottom);
      const bin = audio.ctx.sampleRate / audio.analyser.fftSize;
      for (
        let k = Math.ceil(min / bin);
        k <= Math.min(audio.spectrum.length - 1, Math.floor(max / bin));
        k++
      )
        ctx.lineTo(x(k * bin), y(audio.spectrum[k]));
      ctx.lineTo(right, bottom);
      ctx.closePath();
      ctx.fillStyle = '#dce7d688';
      ctx.fill();
      ctx.strokeStyle = '#9db48e';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    RATIOS.forEach((ratio, i) => {
      const xx = x(target() * ratio);
      ctx.strokeStyle = colors[i];
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(xx, top);
      ctx.lineTo(xx, bottom);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = colors[i];
      ctx.textAlign = 'center';
      ctx.fillText(`${(target() * ratio).toFixed(1)} Hz`, xx, h - 7);
      ctx.fillText(`${ratio}×`, xx, top + 4);
    });
    $('chart-empty').style.display = audio.mode === 'off' ? 'flex' : 'none';
  }
}
function frame(now) {
  const delta = Math.min(100, now - (previousFrame || now));
  previousFrame = now;
  if (audio.mode !== 'off' && now - lastAnalysis > 85) {
    lastAnalysis = now;
    const reading = audio.read();
    results =
      now < warmupUntil
        ? [null, null, null]
        : confirmPartials(
            detectPartials(
              reading.spectrum,
              audio.ctx.sampleRate,
              audio.analyser.fftSize,
              target(),
              reading.rms,
            ),
            candidates,
          );
    history.push({ time: now, values: results.map((r) => r?.cents ?? null) });
    history = history.filter((p) => p.time > now - 12000);
    $('input-level').style.width =
      `${Math.min(100, Math.max(0, ((20 * Math.log10(reading.rms + 0.000001) + 80) / 65) * 100))}%`;
    $('input-label').textContent =
      reading.peak > 0.97
        ? 'Input clipping · strike softer'
        : audio.mode === 'demo'
          ? 'Generated demo · not your handpan'
          : reading.rms < 0.00012
            ? 'Listening · waiting for a strike'
            : 'Microphone signal detected';
    updateReadings();
    renderChart(now);
  }
  results.forEach((r, i) => {
    if (r && !reducedMotion) {
      offsets[i] = (offsets[i] + Math.max(-50, Math.min(50, r.cents)) * 0.0015 * delta) % 32;
      $('stripes-' + i).style.transform = `translateX(${offsets[i]}px)`;
    }
  });
  requestAnimationFrame(frame);
}

// A short, explicit local recording allows repeatable reference / physical A/B.
const captureRow = document.createElement('div');
captureRow.className = 'capture-row';
captureRow.innerHTML =
  '<button id="record-strike" class="capture-button" disabled>● Capture strike</button><button id="play-recording" class="capture-button" disabled>▶ Your handpan</button><span id="recording-label">Capture your strike for a direct A/B comparison.</span><small>5 SEC · LOCAL ONLY</small>';
$('reference-status')
  .closest('.reference')
  .insertBefore(captureRow, document.querySelector('.reference-footer'));
$('record-strike').addEventListener('click', () => {
  if (recording?.state === 'recording') {
    stopRecording();
    return;
  }
  if (!audio.stream) return;
  if (!window.MediaRecorder) {
    notify(
      'This browser doesn’t support strike recording. Live tuning and reference playback still work.',
    );
    return;
  }
  clearRecorded();
  audio.stopReference();
  stoppingRecording = false;
  recordingChunks = [];
  recordedNote = selected;
  try {
    recording = new MediaRecorder(audio.stream);
    const thisRecorder = recording,
      note = selected;
    recording.ondataavailable = (e) => {
      if (e.data.size) recordingChunks.push(e.data);
    };
    recording.onstop = () => {
      if (stoppingRecording || note !== selected) {
        recordingChunks = [];
        return;
      }
      const blob = new Blob(recordingChunks, { type: thisRecorder.mimeType });
      if (!blob.size) {
        notify('No audio captured. Try another strike.');
        return;
      }
      recordedURL = URL.createObjectURL(blob);
      recordedAudio = new Audio(recordedURL);
      recordedAudio.volume = audio.volume;
      $('play-recording').disabled = false;
      $('recording-label').textContent =
        `${pretty(recordedNote)} captured. Switch between the reference and your handpan.`;
    };
    recording.onerror = () => {
      stopRecording(true);
      notify('Recording failed. Try again.');
    };
    recording.start();
    $('record-strike').textContent = '■ Finish capture';
    $('recording-label').textContent = 'Recording… strike your selected note now.';
    recordingTimer = setTimeout(() => stopRecording(), 5000);
  } catch (err) {
    error(err);
  }
});
$('play-recording').addEventListener('click', async () => {
  if (!recordedAudio) return;
  audio.stopReference();
  clearTimeout(referenceTimer);
  recordedAudio.currentTime = 0;
  try {
    await recordedAudio.play();
    $('reference-status').textContent = `Playing your ${pretty(recordedNote)} recording`;
  } catch (err) {
    error(err);
  }
});
window.addEventListener('resize', () => renderChart(performance.now()));
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopInput();
    audio.stopReference();
    recordedAudio?.pause();
  }
});
window.addEventListener('pagehide', () => {
  stopInput();
  audio.stopReference();
  if (recordedURL) URL.revokeObjectURL(recordedURL);
});
select(selected);
updateInputUI();
requestAnimationFrame(frame);
