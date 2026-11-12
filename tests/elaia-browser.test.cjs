// Actual WebGL, AudioWorklet, pointer input, and storage integration.
// PW may point to an existing Playwright installation.
const { chromium } = require(process.env.PW || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const BASE = (process.argv[2] || 'http://127.0.0.1:8080').replace(/\/$/, '');
const ARTIFACTS = process.env.SHOTS || '/tmp/elaia-check';
let count = 0;
function check(value, message) { assert.ok(value, message); count++; }

(async () => {
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  const browser = await chromium.launch({
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-webgl'],
  });
  const errors = [];
  const captureErrors = page => {
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('requestfailed', r => errors.push(r.url() + ': ' + r.failure().errorText));
  };
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  // Exercise synthesized fallback deterministically for the worklet/FFT checks.
  // The separate sample test covers successful recorded playback.
  const failedRecording = route => route.fulfill({ status: 200, contentType: 'audio/mpeg', body: '' });
  await context.route('**/smp-*.mp3*', failedRecording);
  const page = await context.newPage();
  captureErrors(page);
  const layout = () => page.evaluate(() => JSON.parse(JSON.stringify(__elaia.layout)));
  const waitView = () => page.waitForFunction(() => Math.abs(__elaia.renderer.pitch - __elaia.renderer.targetPitch) < 0.004);
  const clickWorld = async (x, z, side) => {
    const p = await page.evaluate(({ x, z, side }) => {
      const r = __elaia.renderer, rect = r.canvas.getBoundingClientRect();
      const p = r.project([x, r.heightAt(x, z, side), z]);
      return { x: p.x + rect.x, y: p.y + rect.y };
    }, { x, z, side });
    await page.mouse.click(p.x, p.y);
  };
  try {
    await page.goto(BASE + '/Elaia-handpan-player/');
    await page.waitForFunction(() => window.__elaia?.renderer?.positions.length === 18);
    const boot = await page.evaluate(() => ({
      notes: __elaia.layout.fields.length, renderer: !!__elaia.renderer,
      started: __elaia.audio.started, triangles: __elaia.renderer.indexCount / 3,
      overflow: document.documentElement.scrollWidth > innerWidth,
      picks: __elaia.renderer.positions.filter(p => p.visible).every(p => __elaia.renderer.pick(p.x, p.y)?.field.id === p.field.id),
      glError: __elaia.renderer.gl.getError(),
    }));
    check(boot.notes === 18 && boot.renderer && boot.triangles > 1000, 'Default instrument renders real WebGL geometry');
    check(!boot.started, 'Audio respects browser gesture requirements');
    check(!boot.overflow && boot.picks && boot.glError === 0, 'No overflow; every top field picks itself; no GL errors');
    check(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1 && getComputedStyle(document.getElementById('side-panel')).overflowY === 'auto'), 'Desktop chord arpeggios scroll inside the panel while the instrument and dock stay in one viewport');
    await page.screenshot({ path: path.join(ARTIFACTS, 'elaia-desktop.png'), fullPage: true, timeout: 90_000 });
    await page.click('#scale-btn');
    check(await page.locator('.scale-option').count() === 15 && await page.locator('.scale-option').filter({ hasText: 'D Aegean 18' }).count() === 1, 'The library exposes only fifteen Ayasa models and one D Aegean 18');
    await page.click('#scale-dialog .close-dialog');
    const angled = await page.evaluate(() => {
      const r = __elaia.renderer, results = [];
      for (const pitch of [-0.15, 0.15]) {
        r.pitch = r.targetPitch = pitch; r.dirty = true; r.draw(performance.now() / 1000);
        const exposed = r.positions.filter(p => p.visible && p.field.side === (pitch < 0 ? 'top' : 'bottom'));
        results.push(exposed.length > 0 && exposed.every(p => r.pick(p.x, p.y)?.field.id === p.field.id));
      }
      r.setView('top'); return results;
    });
    check(angled.every(Boolean), 'Exposed notes on the opposite shell remain clickable across the equator');
    await waitView();
    check(await page.evaluate(() => __elaia.renderer.normalSize === 1024 && __elaia.renderer.vertexCount < 250000), 'Crisp normal detail keeps the desktop mesh bounded');
    await page.click('#sound-btn');
    await page.waitForFunction(() => __elaia.audio.started);
    check(await page.evaluate(() => __elaia.audio.engine.ctx.state === 'running' && __elaia.audio.engine.inst.nNotes === 18), 'Real audio worklet initializes');
    const rms = await page.evaluate(async () => {
      const ctx = __elaia.audio.engine.ctx, analyser = ctx.createAnalyser();
      analyser.fftSize = 4096;
      __elaia.audio.engine.master.connect(analyser);
      await new Promise(resolve => setTimeout(resolve, 250));
      const data = new Float32Array(4096); analyser.getFloatTimeDomainData(data);
      __elaia.audio.engine.master.disconnect(analyser);
      return Math.sqrt(data.reduce((s, v) => s + v * v, 0) / data.length);
    });
    check(rms > 0.0001, 'A user gesture produces actual audio samples');
    const exposed = await page.evaluate(() => {
      const r = __elaia.renderer; r.pitch = r.targetPitch = -0.15; r.dirty = true; r.draw(performance.now() / 1000);
      const p = r.positions.find(p => p.visible && p.field.side === 'top' && r.pick(p.x, p.y)?.field.id === p.field.id);
      const rect = r.canvas.getBoundingClientRect(); return { id: p.field.id, x: p.x + rect.x, y: p.y + rect.y };
    });
    await page.mouse.click(exposed.x, exposed.y);
    check(await page.locator(`.note-chip[data-id="${exposed.id}"]`).evaluate(el => el.classList.contains('sounding')), 'An actual click below the equator plays an exposed top-shell note');
    await page.click('[data-view="top"]'); await waitView();

    await page.evaluate(() => {
      __elaia.damp(); window.playedFields = [];
      const strike = __elaia.audio.strike.bind(__elaia.audio);
      __elaia.audio.strike = (id, ...args) => {
        const field = __elaia.layout.fields.find(f => f.id === id);
        playedFields.push({ id, midi: field.midi, side: field.side });
        strike(id, ...args);
      };
    });
    const resetPlayed = () => page.evaluate(() => { window.playedFields = []; });
    const played = () => page.evaluate(() => playedFields);
    const waitPlayed = n => page.waitForFunction(n => playedFields.length >= n, n);
    check(await page.locator('.chord-chip[data-chord="Bm"]').count() === 1, 'B minor has one compact all-register chord button');
    await resetPlayed();
    await page.click('.chord-chip[data-chord="Bm"]');
    await waitPlayed(9);
    assert.deepEqual((await played()).map(f => f.midi), [47, 50, 54, 59, 62, 66, 71, 74, 78]); count++;
    check((await page.textContent('#chord-detail')).includes('B2') && (await page.textContent('#chord-detail')).includes('F♯5'), 'Chord feedback names every played register');
    const demoLayout = await layout();
    for (const side of ['top', 'bottom', 'all']) {
      await resetPlayed();
      await page.click(`[data-demo="${side}"]`);
      await page.waitForFunction(() => !!__elaia.demo && !__elaia.demo.loading);
      check(await page.locator('#demo-stop').isVisible() && await page.locator(`[data-demo="${side}"]`).getAttribute('aria-pressed') === 'true', `${side} demo has an active control and Stop`);
      await page.waitForFunction(() => !__elaia.demo, null, { timeout: 25000 });
      const expected = demoLayout.fields.filter(f => side === 'all' || f.side === side).sort((a, b) => a.midi - b.midi);
      assert.deepEqual((await played()).map(f => f.id), expected.map(f => f.id)); count++;
      check(await page.locator('#demo-stop').isHidden(), `${side} demo returns to idle after its last note`);
    }
    await resetPlayed(); await page.click('[data-demo="all"]'); await waitPlayed(1);
    await page.click('#demo-stop'); const stopped = (await played()).length;
    await page.waitForTimeout(800);
    check((await played()).length === stopped && await page.evaluate(() => __elaia.playTimers.size === 0), 'Stop cancels every remaining demo strike');
    const bottomDemo = await page.locator('[data-demo="bottom"]').boundingBox();
    await resetPlayed(); await page.click('[data-demo="top"]'); await waitPlayed(1);
    await page.click('[data-demo="bottom"]');
    await page.waitForFunction(() => playedFields.some(f => f.side === 'bottom'));
    check((await played()).find(f => f.side === 'bottom').midi === 47 && await page.evaluate(() => __elaia.demo?.side === 'bottom'), 'Switching demos starts the new shell at its lowest note');
    // A normal locator click waits for compositing; the four-second demo can
    // finish meanwhile on software WebGL. Send a real pointer click directly.
    await page.mouse.click(bottomDemo.x + bottomDemo.width / 2, bottomDemo.y + bottomDemo.height / 2);
    check(await page.evaluate(() => !__elaia.demo && !__elaia.playTimers.size), 'Tapping the active demo also stops it');
    await resetPlayed(); await page.click('[data-demo="all"]'); await waitPlayed(1);
    await page.click('.note-chip[data-id="n0"]'); await waitPlayed(2);
    const takeover = (await played()).length; await page.waitForTimeout(800);
    check((await played()).length === takeover && await page.evaluate(() => !__elaia.demo), 'Playing manually stops the demo and plays the chosen field');
    const demoTitle = demoLayout.title;
    for (const cancel of ['stop', 'layout']) {
      await resetPlayed();
      await page.evaluate(() => {
        window.originalPrepare = __elaia.audio.prepare.bind(__elaia.audio);
        window.prepareGate = new Promise(resolve => { window.releasePrepare = resolve; });
        __elaia.audio.prepare = id => prepareGate.then(() => originalPrepare(id));
      });
      await page.click('[data-demo="all"]');
      check((await page.textContent('#demo-status')).includes('Loading') && !(await played()).length, 'A cold demo waits for recordings without a synth attack');
      if (cancel === 'stop') await page.click('#demo-stop');
      else await page.evaluate(() => __elaia.commit({ ...__elaia.layout, title: 'Cancel pending demo' }, { geometry: false }));
      await page.evaluate(() => { __elaia.audio.prepare = originalPrepare; releasePrepare(); });
      await page.waitForTimeout(800);
      check(!(await played()).length && await page.evaluate(() => !__elaia.demo && !__elaia.playTimers.size), `${cancel} cancels a demo still loading its recordings`);
    }
    await page.evaluate(title => __elaia.commit({ ...__elaia.layout, title }, { geometry: false }), demoTitle);
    await page.click('[data-view="top"]'); await waitView();

    const tap = await page.evaluate(async () => {
      const { ShellTap } = await import(new URL('shell-tap.mjs', location.href).href);
      const render = async (velocity, x, damp = false) => {
        const ctx = new OfflineAudioContext(2, 22050, 44100);
        const dry = ctx.createGain(), conv = ctx.createGain(); dry.connect(ctx.destination);
        const model = new ShellTap({ ctx, dry, conv }); model.strike(velocity, x);
        if (damp) ctx.suspend(0.015).then(() => { model.damp(); return ctx.resume(); });
        const buffer = await ctx.startRendering();
        await new Promise(resolve => setTimeout(resolve, 0));
        const channels = [buffer.getChannelData(0), buffer.getChannelData(1)];
        const rms = (data, start, end) => Math.sqrt(data.slice(start, end).reduce((s, v) => s + v * v, 0) / (end - start));
        return { attack: channels.map(data => rms(data, 0, 1323)), late: rms(channels[1], 3528, 6615),
          tail: rms(channels[1], 8820, 22050), peak: Math.max(...channels.flatMap(data => Array.from(data, Math.abs))),
          voices: model.voices.size, bytes: model.noise.length * 4 };
      };
      return { hard: await render(0.9, 0.8), soft: await render(0.3, 0.8), stopped: await render(0.9, 0.8, true) };
    });
    check(tap.hard.attack[1] > 0.02 && tap.hard.peak < 1 && tap.hard.tail === 0, 'The finger slap has an audible bounded attack and a short dry tail');
    check(tap.hard.attack[1] > tap.soft.attack[1] * 2 && tap.hard.attack[1] > tap.hard.attack[0] * 1.5, 'Shell taps respond to force and stereo position');
    check(tap.stopped.late < tap.hard.late * 0.1 && tap.hard.voices === 0 && tap.stopped.voices === 0 && tap.hard.bytes < 40000, 'Damping stops taps; ended nodes release and the shared noise stays small');
    await resetPlayed();

    await page.click('#advanced-btn');
    check(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1), 'Desktop editing stays in one viewport');
    await page.click('.note-chip[data-id="n0"]');
    check(await page.locator('#field-shape').isHidden(), 'Field geometry is disclosed separately from quick pitch editing');
    await page.click('#field-details summary');
    const convexBefore = await page.evaluate(() => {
      const f = __elaia.renderer.geometryFields.find(f => f.id === 'n0');
      return { y: __elaia.renderer.surfaceModel.sample(f.O[0], f.O[2], 'top')[1], geometry: __elaia.layout.fields[0].geometry };
    });
    await page.selectOption('#field-shape', 'dimple');
    check(await page.evaluate(before => {
      const f = __elaia.renderer.geometryFields.find(f => f.id === 'n0');
      return __elaia.layout.fields[0].shape === 'dimple' && __elaia.layout.fields[0].geometry === before.geometry
        && __elaia.renderer.surfaceModel.sample(f.O[0], f.O[2], 'top')[1] < before.y;
    }, convexBefore), 'The shape editor depresses a convex cap without losing source geometry');
    await page.click('#undo-btn');
    check(await page.inputValue('#field-shape') === 'dome', 'Changing convex/concave shape is undone as one action');
    await page.selectOption('#field-note', '69');
    await page.focus('#layout-tab'); await page.keyboard.press('ArrowRight');
    check(await page.locator('#tuning-tab').getAttribute('aria-selected') === 'true' && await page.locator('#tuning-settings').isVisible(), 'Customization tabs support arrow-key navigation');
    await page.click('[data-pitch="432"]');
    check(await page.evaluate(() => __elaia.audio.engine.inst.notes[0].f0 === 432), 'Editing A4 and choosing 432 Hz rebuilds the actual physical model');
    const tuningLayout = await layout(), tuningField = tuningLayout.fields[0];
    await clickWorld(tuningField.x, tuningField.z, tuningField.side);
    check(await page.evaluate(() => !__elaia.renderer.edit && document.querySelector('.note-chip[data-id="n0"]').classList.contains('sounding')), 'The instrument remains playable while tuning');
    assert.deepEqual(await layout(), tuningLayout); count++;
    const spectrum = await page.evaluate(async () => {
      __elaia.damp();
      const ctx = __elaia.audio.engine.ctx, analyser = ctx.createAnalyser();
      analyser.fftSize = 32768; analyser.smoothingTimeConstant = 0;
      __elaia.audio.engine.master.connect(analyser);
      await __elaia.play('n0', 0.4, 0);
      await new Promise(resolve => setTimeout(resolve, 1000));
      const bins = new Float32Array(analyser.frequencyBinCount);
      analyser.getFloatFrequencyData(bins);
      let peak = -Infinity, hz = 0;
      for (let i = 0; i < bins.length; i++) {
        const f = i * ctx.sampleRate / analyser.fftSize;
        if (f >= 420 && f <= 445 && bins[i] > peak) { peak = bins[i]; hz = f; }
      }
      __elaia.audio.engine.master.disconnect(analyser);
      return { hz, peak };
    });
    check(Math.abs(spectrum.hz - 432) < 2.5 && spectrum.peak > -70, 'Real AudioWorklet output rings at 432 Hz');
    const beforeTranspose = await layout();
    await page.click('#transpose-up');
    const transposed = await layout();
    check(transposed.fields.every((f, i) => f.midi === beforeTranspose.fields[i].midi + 3), 'Transpose shifts every note together and skips keys containing B flat 4');
    await page.click('#undo-btn');
    assert.deepEqual(await layout(), beforeTranspose); count++;
    await page.click('#redo-btn');
    assert.deepEqual(await layout(), transposed); count++;

    await page.click('#layout-tab');
    await page.click('#close-inspector');
    await page.click('[data-view="bottom"]');
    await waitView();
    await page.click('[data-tool="add"]');
    await page.selectOption('#add-note', '84');
    await page.click('#place-note-btn');
    let afterAdd = await layout();
    const added = afterAdd.fields.at(-1);
    check(afterAdd.fields.length === 19 && added?.midi === 84, 'Add note immediately places the requested pitch on the chosen shell');
    check(Math.hypot(added.x, added.z) > 0.4, 'Automatic placement finds a sensible shell position');
    check(await page.locator('#add-settings').isVisible() && await page.locator('[data-tool="add"]').getAttribute('aria-pressed') === 'true', 'Adding stays in the repeat-add flow');
    check(await page.inputValue('#add-note') === '86' && (await page.textContent('#place-note-btn')).includes('D6'), 'The next add is already set to the next scale pitch');
    await page.click('#cancel-add');
    await page.waitForFunction(() => __elaia.renderer.positions.length === __elaia.layout.fields.length);
    const bottomPick = await page.evaluate(() => {
      const r = __elaia.renderer, p = r.positions.find(p => p.field.id === __elaia.layout.fields.at(-1).id);
      return p && p.visible && r.pick(p.x, p.y)?.field.id === p.field.id;
    });
    check(bottomPick, 'Bottom field is visible and picks correctly');
    await clickWorld(0, 0, 'bottom');
    check((await layout()).fields.length === 19, 'Adding through the gu sound port is prevented');
    await clickWorld(added.x, added.z, 'bottom');
    check((await layout()).fields.length === 19, 'Adding over an occupied tone field is prevented');
    const dragPoints = id => page.evaluate(async id => {
      const r = __elaia.renderer, rect = r.canvas.getBoundingClientRect();
      const start = r.positions.find(p => p.field.id === id);
      const { fits } = await import(new URL('model.mjs', location.href).href);
      const { dragAngle } = await import(new URL('tonefields.mjs', location.href).href);
      const field = __elaia.layout.fields.find(f => f.id === id);
      const slots = [0.42, 0.55, 0.68, 0.8].flatMap(rad => Array.from({ length: 64 }, (_, i) => [Math.cos(i / 64 * Math.PI * 2) * rad, Math.sin(i / 64 * Math.PI * 2) * rad]));
      const [x, z] = slots.find(([x, z]) => Math.hypot(x - field.x, z - field.z) > 0.2 && fits(__elaia.layout, { ...field, angle: dragAngle(field, x, z) }, x, z));
      const end = r.project([x, r.heightAt(x, z, 'bottom'), z]);
      return { sx: start.x + rect.x, sy: start.y + rect.y, ex: end.x + rect.x, ey: end.y + rect.y };
    }, id);
    const drag = await dragPoints(added.id);
    await page.evaluate(() => {
      const r = __elaia.renderer;
      window.dragBaseline = { vertices: r.vertexCount, size: r.normalSize, texture: r.normalTexture,
        pixels: r.normalPixels.slice(), bakes: 0 };
      const bake = r.bakeNormals.bind(r);
      r.bakeNormals = (...args) => { dragBaseline.bakes++; return bake(...args); };
    });
    await page.mouse.move(drag.sx, drag.sy); await page.mouse.down();
    await page.mouse.move(drag.ex, drag.ey, { steps: 5 });
    await page.waitForFunction(() => !!__elaia.renderer.lastUpdate);
    const dragQuality = await page.evaluate(() => {
      const r = __elaia.renderer, n = r.normalSize * r.normalSize * 4;
      let untouched = true;
      for (let i = 0; i < n; i++) if (dragBaseline.pixels[i] !== r.normalPixels[i]) { untouched = false; break; }
      return { mapped: r.mappedNormals, sameMesh: r.vertexCount === dragBaseline.vertices,
        sameTexture: r.normalTexture === dragBaseline.texture && r.normalSize === dragBaseline.size,
        untouched, local: r.lastUpdate.vertices < r.vertexCount / 2 && r.lastUpdate.texels < r.normalSize ** 2 / 2,
        milliseconds: r.lastUpdate.milliseconds };
    });
    check(dragQuality.mapped && dragQuality.sameMesh && dragQuality.sameTexture, 'Dragging retains the full mesh and crisp normal map');
    check(dragQuality.untouched && dragQuality.local, 'Dragging a bottom field preserves the entire top-shell detail and updates only local regions');
    await page.screenshot({ path: path.join(ARTIFACTS, 'elaia-dragging.png'), timeout: 90_000 });
    console.log(`Local drag update: ${dragQuality.milliseconds.toFixed(1)} ms.`);
    await page.mouse.up();
    await page.waitForTimeout(100);
    check(await page.evaluate(() => dragBaseline.bakes === 0), 'Releasing a drag reuses the patched normal map instead of baking the whole instrument');
    const moved = (await layout()).fields.find(f => f.id === added.id);
    check(Math.hypot(moved.x - added.x, moved.z - added.z) > 0.1 && moved.side === 'bottom', 'Advanced mode directly drags a bottom field without a Move tool');
    check((await layout()).manualPlacement === true, 'Dragging takes control of the layout from automatic arrangement');
    const orbitState = await page.evaluate(() => ({ yaw: __elaia.renderer.yaw, fields: JSON.stringify(__elaia.layout.fields) }));
    const fieldScreen = await page.evaluate(id => {
      const r = __elaia.renderer, rect = r.canvas.getBoundingClientRect(), p = r.positions.find(p => p.field.id === id);
      return { x: p.x + rect.x, y: p.y + rect.y };
    }, added.id);
    await page.mouse.move(fieldScreen.x, fieldScreen.y); await page.mouse.down({ button: 'right' });
    await page.mouse.move(fieldScreen.x + 25, fieldScreen.y + 10, { steps: 3 }); await page.mouse.up({ button: 'right' });
    check(await page.evaluate(s => __elaia.renderer.yaw !== s.yaw && JSON.stringify(__elaia.layout.fields) === s.fields, orbitState), 'Right dragging a field orbits without changing its position');
    await page.click('#reset-view'); await waitView();
    await page.click('#undo-btn');
    const restored = (await layout()).fields.find(f => f.id === added.id);
    check(Math.abs(restored.x - added.x) < 1e-8 && Math.abs(restored.z - added.z) < 1e-8, 'A drag is undone as one gesture');
    check(!(await layout()).manualPlacement, 'Undo also restores automatic placement after a manual drag');
    await page.click('[data-view="bottom"]'); await waitView();
    const cancelBaseline = await page.evaluate(() => ({
      layout: JSON.stringify(__elaia.layout), history: __elaia.history.length,
      future: JSON.stringify(__elaia.future), saved: localStorage.getItem('elaia.current.v1'),
    }));
    await page.waitForFunction(id => {
      const p = __elaia.renderer.positions.find(p => p.field.id === id);
      return p?.visible && p.field === __elaia.layout.fields.find(f => f.id === id)
        && __elaia.renderer.pick(p.x, p.y)?.field.id === id;
    }, added.id);
    const cancelledDrag = await dragPoints(added.id);
    await page.mouse.move(cancelledDrag.sx, cancelledDrag.sy); await page.mouse.down();
    await page.mouse.move(cancelledDrag.ex, cancelledDrag.ey, { steps: 5 });
    check(await page.evaluate(before => JSON.stringify(__elaia.layout) !== before.layout, cancelBaseline), 'A cancellable drag previews a changed layout');
    await page.evaluate(() => {
      const pointerId = __elaia.pointers.keys().next().value;
      document.getElementById('instrument').dispatchEvent(new PointerEvent('pointercancel', { pointerId }));
    });
    await page.mouse.up();
    check(await page.evaluate(before =>
      JSON.stringify(__elaia.layout) === before.layout
      && JSON.stringify(__elaia.audio.layout) === before.layout
      && JSON.stringify(__elaia.audio.samples.layout) === before.layout
      && __elaia.audio.engine.inst.notes.every(n =>
        Math.abs(n.pan - __elaia.layout.fields.find(f => __elaia.audio.indices.get(f.id) === n.ni).x * 0.7) < 1e-8),
    cancelBaseline), 'Cancelling a drag restores the visual layout, sample positions, and modeled audio pans');
    check(await page.evaluate(before => __elaia.history.length === before.history
      && JSON.stringify(__elaia.future) === before.future && localStorage.getItem('elaia.current.v1') === before.saved,
    cancelBaseline), 'Cancelling a drag preserves undo, redo, and saved state');
    await page.click('.note-chip[data-id="n0"]');
    await page.evaluate(() => {
      const input = document.getElementById('field-angle');
      for (let i = 0; i < 2; i++) { input.stepDown(); input.dispatchEvent(new Event('input')); }
      input.dispatchEvent(new Event('change'));
    });
    check(await page.evaluate(before => __elaia.history.length === before.history + 1
      && __elaia.future.length === 0 && __elaia.layout.manualPlacement
      && localStorage.getItem('elaia.current.v1') === JSON.stringify(__elaia.layout),
    cancelBaseline), 'A multi-step rotation gesture creates one undo entry, clears redo, and saves the final layout');
    await page.click('#undo-btn');
    check(JSON.stringify(await layout()) === cancelBaseline.layout, 'Undo restores the entire layout before a rotation gesture');
    await page.click(`.note-chip[data-id="${added.id}"]`);
    await page.selectOption('#field-note', '83');
    check(await page.evaluate(id => {
      const index = __elaia.audio.indices.get(id);
      return __elaia.audio.engine.inst.notes[index].midi === 83 && __elaia.audio.engine.inst.notes[index].bottom;
    }, added.id), 'Bottom-note editing preserves audio identity');
    check(await page.locator('[data-side], #field-size').count() === 0, 'Shell-transfer and size controls are removed');
    await page.click('#remove-field');
    check((await layout()).fields.length === 18, 'A tone field can be removed');
    await page.click('#undo-btn');
    check((await layout()).fields.length === 19, 'Removing a field is undoable');
    if (await page.locator('#close-inspector').isVisible()) await page.click('#close-inspector');

    await page.click('#tuning-tab'); await page.click('[data-finish="rose"]');
    await page.click('#save-btn');
    await page.fill('#layout-name', 'Élaia 🌿 — evening');
    await page.click('#save-form [type="submit"]');
    check(await page.locator('#share-dialog').isVisible(), 'Saving immediately presents a recreation URL');
    const saveUrl = await page.inputValue('#share-url');
    const fromSave = await context.newPage(); captureErrors(fromSave);
    await fromSave.goto(saveUrl); await fromSave.waitForFunction(() => !!window.__elaia);
    check(await fromSave.evaluate(() => __elaia.layout.title === 'Élaia 🌿 — evening' && __elaia.layout.a4 === 432 && __elaia.layout.finish === 'rose'), 'Save URL recreates the named version, tuning, and finish');
    const saveExpected = await layout(); saveExpected.title = 'Élaia 🌿 — evening';
    assert.deepEqual(await fromSave.evaluate(() => __elaia.layout), saveExpected); count++;
    await fromSave.close();
    await page.click('#share-dialog .close-dialog');
    await page.click('#library-btn');
    check((await page.locator('.saved-load b').textContent()) === 'Élaia 🌿 — evening', 'Named layouts preserve Unicode titles');
    await page.click('.saved-load');
    const saved = await layout();
    await page.click('#share-btn');
    const sharedUrl = await page.inputValue('#share-url');
    check(sharedUrl.includes('#layout='), 'Sharing creates a self-contained instrument URL');
    const shared = await context.newPage(); captureErrors(shared);
    await shared.goto(sharedUrl); await shared.waitForFunction(() => !!window.__elaia);
    assert.deepEqual(await shared.evaluate(() => __elaia.layout), saved); count++;
    await shared.close();
    await page.click('#share-dialog .close-dialog');
    await page.reload(); await page.waitForFunction(() => !!window.__elaia);
    assert.deepEqual(await layout(), saved); count++;
    await page.click('#library-btn');
    const downloadPromise = page.waitForEvent('download');
    await page.click('#export-btn');
    const download = await downloadPromise, file = await download.path();
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), saved); count++;
    await page.setInputFiles('#import-file', { name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{"version":1,"fields":[]}') });
    await page.waitForFunction(() => document.getElementById('toast').textContent.includes('Could not import'));
    assert.deepEqual(await layout(), saved); count++;
    const imported = JSON.parse(JSON.stringify(saved)); imported.title = 'Imported handpan'; imported.a4 = 440;
    await page.setInputFiles('#import-file', { name: 'instrument.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(imported)) });
    await page.waitForFunction(() => __elaia.layout.title === 'Imported handpan');
    assert.deepEqual(await layout(), imported); count++;

    await page.click('#scale-btn'); await page.fill('#scale-search', '21');
    check(await page.locator('.scale-option').count() === 1, 'Search finds the one measured 21-field model');
    await page.locator('.scale-option').filter({ hasText: 'F♯ Low Pygmy' }).click();
    check((await layout()).fields.length === 21 && (await layout()).fields.filter(f => f.side === 'bottom').length === 9, 'The 21-note preset creates both shells');
    await page.click('[data-view="bottom"]'); await waitView();
    check(await page.evaluate(() => __elaia.renderer.positions.filter(p => p.visible && p.field.side === 'bottom').length === 9), 'All nine bottom fields are visible in a 21-note layout');
    if (await page.evaluate(() => __elaia.advanced)) await page.click('#advanced-btn');
    await page.click('[data-view="top"]'); await waitView();
    await page.click('[data-finish="ember"]');
    await page.screenshot({ path: path.join(ARTIFACTS, 'elaia-21-notes.png'), fullPage: true, timeout: 90_000 });
    await page.click('#scale-btn'); await page.fill('#scale-search', 'D Aegean 18');
    await page.locator('.scale-option').click();
    const aegean = await layout();
    check(aegean.arrangement === 'd-aegean-18' && aegean.fields.filter(f => f.side === 'top').length === 11 && aegean.fields.filter(f => f.side === 'bottom').length === 7, 'Ayasa category loads the published D Aegean 18');
    await page.waitForFunction(() => __elaia.renderer.positions.length === 18);
    check(await page.evaluate(() => __elaia.renderer.positions.filter(p => p.visible).every(p => __elaia.renderer.pick(p.x, p.y)?.field.id === p.field.id)), 'Every published D Aegean top centre is playable');
    await page.screenshot({ path: path.join(ARTIFACTS, 'elaia-aegean.png'), fullPage: true, timeout: 90_000 });
    await page.click('[data-view="bottom"]'); await waitView();
    check(await page.evaluate(() => __elaia.renderer.positions.filter(p => p.visible).length === 7 && __elaia.renderer.positions.filter(p => p.visible).every(p => __elaia.renderer.pick(p.x, p.y)?.field.id === p.field.id)), 'Every published D Aegean bottom centre is playable');
    await page.screenshot({ path: path.join(ARTIFACTS, 'elaia-aegean-bottom.png'), fullPage: true, timeout: 90_000 });
    await page.click('#scale-btn'); await page.fill('#scale-search', 'D Kurd 13');
    await page.locator('.scale-option').first().click();
    await page.click('#keyboard-btn');
    check(await page.locator('.note-chip kbd').count() === 13, 'Keyboard mapping is visible');
    await page.focus('#instrument'); await page.keyboard.press('a');
    await page.waitForFunction(() => __elaia.audio.started);
    check(await page.locator('.note-chip.sounding').count() > 0, 'Keyboard input plays a field');
    await page.keyboard.press('m');
    check(await page.locator('.note-chip.sounding').count() === 0, 'Keyboard damping clears playing feedback');
    const orbitBefore = await page.evaluate(() => __elaia.renderer.yaw);
    await page.mouse.move(290, 400); await page.mouse.down();
    await page.mouse.move(330, 420, { steps: 3 }); await page.mouse.up();
    check(await page.evaluate(yaw => Math.abs(__elaia.renderer.yaw - yaw) > 0.01, orbitBefore), 'Bare-shell dragging orbits the camera');
    const zoomBefore = await page.evaluate(() => __elaia.renderer.zoom);
    await page.mouse.wheel(0, -200);
    check(await page.evaluate(zoom => __elaia.renderer.zoom > zoom, zoomBefore), 'Mouse wheel zooms');
    await page.click('#reset-view'); await waitView();
    await page.click('#keyboard-btn');
    await page.click('#scale-btn'); await page.fill('#scale-search', 'D Aegean 18'); await page.locator('.scale-option').click();
    await page.click('[data-view="top"]'); await waitView();
    await page.screenshot({ path: path.join(ARTIFACTS, 'elaia-desktop.png'), fullPage: true, timeout: 90_000 });

    const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    await mobileContext.route('**/smp-*.mp3*', failedRecording);
    const mobile = await mobileContext.newPage(); captureErrors(mobile);
    await mobile.goto(BASE + '/Elaia-handpan-player/');
    await mobile.waitForFunction(() => window.__elaia?.renderer?.positions.length === 18);
    check(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth && __elaia.renderer.canvas.width <= innerWidth * 2), 'Phone UI fits and caps WebGL pixel density at 2x');
    await mobile.click('[data-view="bottom"]');
    await mobile.waitForFunction(() => Math.abs(__elaia.renderer.pitch - __elaia.renderer.targetPitch) < 0.004);
    check(await mobile.locator('#bottom-notes').isVisible() && await mobile.locator('#top-notes').isHidden(), 'Phone note palette follows the viewed shell');
    await mobile.click('#play-chords-tab');
    check(await mobile.locator('#chords').isVisible() && await mobile.locator('#bottom-notes').isHidden(), 'Phone chords have a separate compact palette');
    check(await mobile.locator('.chord-chip[data-chord="Bm"]').count() === 1 && await mobile.locator('.chord-chip').first().evaluate(el => el.getBoundingClientRect().height >= 44), 'Phone chord arpeggios remain available with finger-sized targets');
    await mobile.click('#play-notes-tab');
    check(await mobile.locator('#bottom-notes').isVisible(), 'Returning to notes remembers the current shell');
    await mobile.evaluate(() => {
      __elaia.setView('free');
      __elaia.renderer.pitch = __elaia.renderer.targetPitch = -1.12;
      __elaia.renderer.dirty = true;
    });
    await mobile.waitForFunction(() => __elaia.noteSide === 'bottom');
    await mobile.click('#reset-view');
    check(await mobile.locator('#top-notes').isVisible() && await mobile.locator('#bottom-notes').isHidden(), 'Resetting a freely rotated view also resets the phone note palette');
    await mobile.click('[data-view="top"]');
    await mobile.waitForFunction(() => Math.abs(__elaia.renderer.pitch - __elaia.renderer.targetPitch) < 0.004);
    await mobile.evaluate(() => {
      __elaia.audio.engine.onEnergy = energies => { window.lastEnergy = Array.from(energies); };
    });
    const touches = await mobile.evaluate(() => {
      const rect = __elaia.renderer.canvas.getBoundingClientRect();
      return __elaia.renderer.positions.slice(0, 2).map((p, i) => ({ x: p.x + rect.x, y: p.y + rect.y, id: i + 1 }));
    });
    const cdp = await mobileContext.newCDPSession(mobile);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: touches });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await mobile.waitForFunction(() => window.lastEnergy?.[0] > 0.0001 && window.lastEnergy?.[1] > 0.0001);
    check(await mobile.evaluate(() => __elaia.audio.started && __elaia.audio.engine.ctx.state === 'running'), 'Two simultaneous first touches start audio and preserve both notes');
    await mobile.locator('.note-chip[data-id="n2"]').tap();
    check(await mobile.locator('.note-chip[data-id="n2"]').evaluate(el => el.classList.contains('sounding')), 'Touch note buttons play immediately');
    await mobile.locator('[data-demo="all"]').tap();
    await mobile.waitForFunction(() => __elaia.demo && !__elaia.demo.loading);
    check(await mobile.locator('#demo-stop').isVisible() && await mobile.locator('#demo-stop').evaluate(el => {
      const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight;
    }), 'Phone demos present a reachable Stop control');
    await mobile.locator('#demo-stop').tap();
    check(await mobile.evaluate(() => !__elaia.demo && !__elaia.playTimers.size), 'Phone Stop cancels the running demo');
    await mobile.click('[data-view="top"]');
    await mobile.waitForFunction(() => Math.abs(__elaia.renderer.pitch - __elaia.renderer.targetPitch) < 0.004);
    const pinchBefore = await mobile.evaluate(() => __elaia.renderer.zoom);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: touches });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: touches.map((p, i) => ({ ...p, x: p.x + (i ? 20 : -15), y: p.y + (i ? 20 : -15) })) });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    check(await mobile.evaluate(zoom => Math.abs(__elaia.renderer.zoom - zoom) > 0.01, pinchBefore), 'Real two-finger input zooms the handpan');
    await mobile.click('#reset-view'); await mobile.waitForFunction(() => __elaia.renderer.zoom === 1);
    await mobile.screenshot({ path: path.join(ARTIFACTS, 'elaia-mobile.png'), fullPage: true, timeout: 90_000 });
    await mobile.click('#advanced-btn');
    check(await mobile.evaluate(() => __elaia.renderer.width >= innerWidth * 0.95), 'Advanced mode keeps the phone canvas at full width');
    await mobile.locator('.note-chip[data-id="n1"]').tap();
    check(await mobile.evaluate(() => {
      const stage = document.getElementById('stage').getBoundingClientRect();
      const panel = document.getElementById('side-panel').getBoundingClientRect();
      return !document.getElementById('field-inspector').hidden && getComputedStyle(document.getElementById('side-panel')).position === 'fixed'
        && stage.bottom <= panel.top + 1 && panel.bottom <= innerHeight + 1;
    }), 'Phone editing opens a bottom sheet below an unobstructed instrument');
    check(await mobile.locator('#field-note').evaluate(el => {
      const rect = el.getBoundingClientRect();
      return document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) === el;
    }), 'Phone pitch picker is above the camera controls and receives touches');
    await mobile.selectOption('#field-note', '65');
    check(await mobile.evaluate(() => __elaia.layout.fields.find(f => f.id === 'n1').midi === 65), 'Phone bottom sheet edits the actual note');
    check(await mobile.locator('#field-details summary').evaluate(el => {
      const r = el.getBoundingClientRect();
      return r.bottom <= innerHeight && el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
    }), 'Phone field geometry is discoverable without covering the instrument');
    await mobile.screenshot({ path: path.join(ARTIFACTS, 'elaia-mobile-editor.png'), timeout: 90_000 });
    await mobile.click('#close-inspector');
    check(await mobile.locator('[data-tool="add"]').evaluate(el => {
      const r = el.getBoundingClientRect();
      return r.bottom <= innerHeight && el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
    }), 'Phone add control remains in reach in the editor heading');
    await mobile.click('[data-tool="add"]'); await mobile.selectOption('#add-note', '61'); await mobile.selectOption('#add-side', 'bottom');
    await mobile.click('#place-note-btn');
    await mobile.waitForFunction(() => __elaia.layout.fields.length === 19 && Math.abs(__elaia.renderer.pitch - __elaia.renderer.targetPitch) < 0.004);
    check(await mobile.evaluate(() => __elaia.selected === __elaia.layout.fields.at(-1).id) && await mobile.locator('#add-settings').isVisible(), 'Phone adding keeps the repeat-add controls open with the last field selected');
    check(await mobile.locator('#place-note-btn').evaluate(el => {
      const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight && r.height >= 44;
    }), 'The next phone addition is one reachable finger-sized button');
    await mobile.click('#cancel-add');
    check(await mobile.locator('#field-inspector').isVisible(), 'Done opens the last added field for immediate pitch editing');
    const mobileDrag = await mobile.evaluate(async () => {
      const r = __elaia.renderer, rect = r.canvas.getBoundingClientRect(), f = __elaia.layout.fields.at(-1);
      const start = r.positions.find(p => p.field.id === f.id), { fits } = await import(new URL('model.mjs', location.href).href);
      const slots = [0.42, 0.55, 0.68, 0.8].flatMap(rad => Array.from({ length: 64 }, (_, i) => [Math.cos(i / 64 * Math.PI * 2) * rad, Math.sin(i / 64 * Math.PI * 2) * rad]));
      const [x, z] = slots.find(([x, z]) => Math.hypot(x - f.x, z - f.z) > 0.2 && fits(__elaia.layout, f, x, z));
      const end = r.project([x, r.heightAt(x, z, 'bottom'), z]);
      return { id: f.id, x: f.x, z: f.z, start: { x: start.x + rect.x, y: start.y + rect.y, id: 1 }, end: { x: end.x + rect.x, y: end.y + rect.y, id: 1 } };
    });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [mobileDrag.start] });
    for (let i = 1; i <= 5; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: mobileDrag.start.x + (mobileDrag.end.x - mobileDrag.start.x) * i / 5, y: mobileDrag.start.y + (mobileDrag.end.y - mobileDrag.start.y) * i / 5, id: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    check(await mobile.evaluate(before => {
      const f = __elaia.layout.fields.find(f => f.id === before.id);
      return Math.hypot(f.x - before.x, f.z - before.z) > 0.1;
    }, mobileDrag), 'Real phone touch input drags a newly added bottom note directly');
    check(await mobile.evaluate(() => __elaia.renderer.mappedNormals && __elaia.renderer.normalSize === 768 && !!__elaia.renderer.lastUpdate), 'Phone dragging retains full surface detail');
    await mobile.click('#save-btn'); await mobile.fill('#layout-name', 'Evening handpan');
    await mobile.click('#save-form [type="submit"]');
    check(await mobile.locator('#copy-link-btn').evaluate(el => {
      const r = el.getBoundingClientRect();
      return r.top >= 0 && r.bottom <= innerHeight;
    }), 'Phone save and share presents a reachable copy-link action');
    const phoneUrl = await mobile.inputValue('#share-url');
    const phoneShared = await mobileContext.newPage(); captureErrors(phoneShared);
    await phoneShared.goto(phoneUrl); await phoneShared.waitForFunction(() => !!window.__elaia);
    check(await phoneShared.evaluate(() => __elaia.layout.title === 'Evening handpan' && __elaia.layout.fields.length === 19 && __elaia.layout.manualPlacement), 'Phone share URL recreates the edited instrument and preserves manual placement');
    await phoneShared.close(); await mobile.click('#share-dialog .close-dialog');
    for (const width of [320, 768]) {
      await mobile.setViewportSize({ width, height: 844 });
      check(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `No horizontal overflow at ${width}px`);
    }
    await mobile.setViewportSize({ width: 844, height: 390 });
    await mobile.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    check(await mobile.evaluate(() => {
      const stage = document.getElementById('stage').getBoundingClientRect(), panel = document.getElementById('side-panel').getBoundingClientRect();
      return document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight + 1
        && stage.right <= panel.left && __elaia.renderer.width > 400;
    }), 'Landscape phones use a side inspector and a full-height stage');
    await mobile.screenshot({ path: path.join(ARTIFACTS, 'elaia-mobile-landscape.png'), timeout: 90_000 });
    await mobile.setViewportSize({ width: 320, height: 568 });
    check(await mobile.locator('#field-note').evaluate(el => {
      const r = el.getBoundingClientRect();
      return r.bottom <= innerHeight && document.documentElement.scrollWidth <= innerWidth;
    }), 'Small phones keep the primary pitch control reachable');
    await mobileContext.close();

    const fallback = await context.newPage(); captureErrors(fallback);
    await fallback.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...args) {
        return type === 'webgl' ? null : original.call(this, type, ...args);
      };
    });
    await fallback.goto(BASE + '/Elaia-handpan-player/');
    check(await fallback.locator('#graphics-error').isVisible(), 'No-WebGL devices get a usable note-button fallback');
    await fallback.click('.note-chip');
    await fallback.waitForFunction(() => __elaia.audio.started);
    check(await fallback.evaluate(() => __elaia.audio.engine.inst.nNotes > 0), 'Audio remains playable when 3D is unavailable');
    await fallback.close();
    assert.deepEqual(errors, []); count++;
    console.log(`Elaia browser: ${count} checks passed — real 3D/audio, chord arpeggios, ordered demos/cancellation, shell-tap output, 432 Hz spectrum, editing, storage/sharing, keyboard, touch, mobile, and graphics fallback.`);
    console.log('Screenshots: ' + ARTIFACTS);
  } catch (error) {
    if (errors.length) console.error('Captured browser errors:', errors);
    throw error;
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
