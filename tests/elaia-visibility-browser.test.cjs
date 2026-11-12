// Zoom labels, the compact gu, and visible/occluded strike pixels.
const { chromium } = require(process.env.PW || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const BASE = (process.argv[2] || 'http://127.0.0.1:8080').replace(/\/$/, '');
const SHOTS = process.env.SHOTS || '/tmp/elaia-visibility';
let count = 0;
const check = (value, message) => { assert.ok(value, message); count++; };

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch({ args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-webgl'] });
  const errors = [];
  const open = async options => {
    const context = await browser.newContext(options);
    await context.route('**/smp-*.mp3*', r => r.fulfill({ status: 200, contentType: 'audio/mpeg', body: '' }));
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(BASE + '/Elaia-handpan-player/');
    await page.waitForFunction(() => window.__elaia?.renderer?.positions.length === 18);
    return { context, page };
  };
  const labelsClear = page => page.evaluate(() => {
    const stage = document.getElementById('stage').getBoundingClientRect();
    const controls = [...document.querySelectorAll('.instrument-heading, .restore-original, .edit-banner, .stage-tools, .view-controls, .stage-hint')]
      .filter(el => el.getClientRects().length).map(el => el.getBoundingClientRect());
    return [...document.querySelectorAll('.field-label:not([hidden])')].every(label => {
      const r = label.getBoundingClientRect();
      return r.left >= stage.left && r.right <= stage.right && r.top >= stage.top && r.bottom <= stage.bottom
        && controls.every(c => r.right <= c.left || r.left >= c.right || r.bottom <= c.top || r.top >= c.bottom);
    });
  });
  const strikePixels = (page, camera) => page.evaluate(camera => {
    const retained = camera.rotate ? __elaia.renderer.hits.slice() : null;
    __elaia.damp();
    const r = __elaia.renderer, t = retained ? retained[(r.hitIndex - 1) % 12 * 4 + 1] : performance.now() / 1000;
    r.pitch = r.targetPitch = camera.pitch; r.yaw = camera.yaw;
    r.setZoom(camera.zoom); r.draw(t);
    const f = r.layout.fields.find(f => camera.id ? f.id === camera.id : f.side === camera.side && f.id !== 'n0');
    const actual = r.project(r.surfaceModel.sample(f.x, f.z, f.side).slice(0, 3));
    const opposite = r.project([f.x, r.heightAt(f.x, f.z, f.side === 'top' ? 'bottom' : 'top'), f.z]);
    const pixels = () => {
      const data = new Uint8Array(r.canvas.width * r.canvas.height * 4);
      r.gl.readPixels(0, 0, r.canvas.width, r.canvas.height, r.gl.RGBA, r.gl.UNSIGNED_BYTE, data);
      return data;
    };
    const before = pixels(), vertices = r.vertexCount, resolution = r.normalSize;
    if (retained) { r.hits.set(retained); r.dirty = true; } else r.strike(f.id, t);
    const drawElements = r.gl.drawElements;
    let warmPass;
    r.gl.drawElements = function (...args) {
      drawElements.apply(this, args);
      warmPass ??= pixels();
    };
    try { r.draw(t + 0.12); } finally { r.gl.drawElements = drawElements; }
    const after = pixels();
    let changed = 0, yellow = 0, blue = 0, anchored = 0, sumX = 0, sumY = 0, warmPixels = 0, overwrittenWarm = 0;
    for (let i = 0; i < before.length; i += 4) {
      if (Math.abs(warmPass[i] - before[i]) + Math.abs(warmPass[i + 1] - before[i + 1]) + Math.abs(warmPass[i + 2] - before[i + 2]) > 10) {
        warmPixels++;
        if (Math.abs(after[i] - warmPass[i]) + Math.abs(after[i + 1] - warmPass[i + 1]) + Math.abs(after[i + 2] - warmPass[i + 2]) > 2) overwrittenWarm++;
      }
      const red = after[i] - before[i], green = after[i + 1] - before[i + 1], b = after[i + 2] - before[i + 2];
      if (Math.abs(red) + Math.abs(green) + Math.abs(b) > 10) {
        const pixel = i / 4;
        changed++;
        if (red > 0 && red - b > 6) yellow++;
        if (red < -2 && b > 2) blue++;
        const x = (pixel % r.canvas.width + 0.5) * r.width / r.canvas.width;
        const y = r.height - (Math.floor(pixel / r.canvas.width) + 0.5) * r.height / r.canvas.height;
        if (Math.abs(x - actual.x) < 4 && Math.abs(y - actual.y) < 4
            && ((red < -2 && b > 2) || (b - red > 3 && after[i + 2] > after[i] + 10))) anchored++;
        sumX += x; sumY += y;
      }
    }
    const centre = { x: sumX / changed, y: sumY / changed };
    return {
      // Antialiased boundary pixels can contain visible and hidden samples.
      changed, yellow, blue, anchored, centre, warmPreserved: overwrittenWarm <= warmPixels * 0.005, hitIndex: r.hitIndex,
      centerVisible: r.positions.find(p => p.field.id === f.id).visible,
      error: Math.hypot(centre.x - actual.x, centre.y - actual.y),
      wrongError: Math.hypot(centre.x - opposite.x, centre.y - opposite.y),
      mesh: vertices === r.vertexCount && resolution === r.normalSize, glError: r.gl.getError(),
    };
  }, camera);
  const chordAligned = (page, id) => page.evaluate(id => {
    const r = __elaia.renderer, index = r.layout.fields.findIndex(f => f.id === id);
    const time = performance.now() / 1000, hits = r.hits.slice();
    r.dirty = true; r.draw(time);
    const f = r.layout.fields[index], p = r.project(r.surfaceModel.sample(f.x, f.z, f.side).slice(0, 3));
    const x = Math.round(p.x * r.canvas.width / r.width) - 4;
    const y = Math.round((r.height - p.y) * r.canvas.height / r.height) - 4;
    const pixels = () => {
      const data = new Uint8Array(9 * 9 * 4);
      r.gl.readPixels(x, y, 9, 9, r.gl.RGBA, r.gl.UNSIGNED_BYTE, data);
      return data;
    };
    const after = pixels();
    // Compare only this bottom voice's contribution. A faded blue pulse can
    // still leave polished gold with more red than blue in absolute RGB.
    r.hits.forEach((v, i) => { if (i % 4 === 0 && v === index + 1) r.hits[i] = -1; });
    r.dirty = true; r.draw(time);
    const before = pixels();
    r.hits.set(hits); r.dirty = true; r.draw(time);
    return hits.some((v, i) => i % 4 === 0 && v === index + 1)
      && after.some((v, i) => i % 4 === 2 && v - before[i] > 2 && after[i - 2] - before[i - 2] < -2);
  }, id);
  try {
    const { context, page } = await open({ viewport: { width: 1440, height: 900 } });
    // Keep the same strike alive across the former centre-visibility switch.
    const partialCamera = { id: 'n12', side: 'bottom', pitch: 0.3, yaw: -0.12, zoom: 1 };
    let partial = await strikePixels(page, partialCamera);
    check(partial.centerVisible && partial.yellow > 500 && partial.blue > 100 && partial.warmPreserved,
      'A partly visible bottom note shows yellow and blue together even when its centre faces the camera');
    const hitIndex = partial.hitIndex;
    for (const pitch of [0.4, 0.42]) {
      partial = await strikePixels(page, { ...partialCamera, pitch, rotate: true });
      check(!partial.centerVisible && partial.yellow > 500 && partial.blue > 100 && partial.warmPreserved && partial.hitIndex === hitIndex,
        `Rotating a sounding note keeps both colours without restarting or switching the whole highlight: ${JSON.stringify(partial)}`);
    }
    const visible = await strikePixels(page, { ...partialCamera, pitch: -1.32, rotate: true });
    check(visible.yellow > 500 && visible.blue < visible.changed * 0.01 && visible.warmPreserved, 'Exposing the note retains its warm glow');
    await page.evaluate(() => __elaia.damp());
    const partialChord = await page.evaluate(() => {
      for (const chord of __elaia.chords) {
        if (chord.notes.some(n => n.id === 'n12')) {
          return { symbol: chord.plainSymbol, ids: chord.notes.map(n => n.id) };
        }
      }
    });
    assert.ok(partialChord, 'The fixture has a chord containing the partly visible bottom note');
    await page.click(`.chord-chip[data-chord="${partialChord.symbol}"]`);
    await page.waitForFunction(ids => ids.every(id => __elaia.renderer.hits.some((v, i) => i % 4 === 0 && v === __elaia.layout.fields.findIndex(f => f.id === id) + 1)), partialChord.ids);
    const partialVoices = await strikePixels(page, { ...partialCamera, rotate: true });
    check(partialVoices.yellow > 500 && partialVoices.blue > 100 && partialVoices.warmPreserved,
      'An actual chord keeps visible voices yellow while the partly hidden bottom voice glows blue');
    await page.evaluate(() => __elaia.damp());
    const clickable = await page.evaluate(async () => {
      const { clone, transposeLayout } = await import(new URL('model.mjs', location.href).href);
      const { addToneField } = await import(new URL('arrangement.mjs', location.href).href);
      const layout = clone(__elaia.layout); layout.fields[0].midi = 69; layout.a4 = 432;
      layout.fields = layout.fields.filter(f => f.id !== 'n11');
      __elaia.commit(addToneField(transposeLayout(layout, 3), { id: 'ray-regression', midi: 61, side: 'bottom' }));
      __elaia.setAdvanced(true); __elaia.setView('bottom');
      const r = __elaia.renderer, results = [];
      for (const pitch of [-1.12, -1.1189216475971744, -1.1185, -1.1, -1]) {
        for (const zoom of [0.85, 1, 1.3]) {
          r.pitch = r.targetPitch = pitch; r.setZoom(zoom); r.draw(performance.now() / 1000);
          const p = r.positions.find(p => p.field.id === 'ray-regression');
          results.push(p.visible && r.pick(p.x, p.y)?.field.id === p.field.id);
        }
      }
      r.pitch = r.targetPitch = -1.1189216475971744; r.setZoom(1); r.draw(performance.now() / 1000);
      return results;
    });
    check(clickable.length === 15 && clickable.every(Boolean), 'An added bottom field remains clickable across fifteen camera angles and zoom settings');
    const click = await page.evaluate(() => {
      const r = __elaia.renderer, rect = r.canvas.getBoundingClientRect(), p = r.positions.find(p => p.field.id === 'ray-regression');
      return { x: rect.left + p.x, y: rect.top + p.y };
    });
    await page.mouse.click(click.x, click.y);
    check(await page.evaluate(() => __elaia.selected === 'ray-regression'), 'A real pointer click selects the field at the formerly unstable angle');
    await page.evaluate(async () => {
      const { createLayout, PRESETS } = await import(new URL('model.mjs', location.href).href);
      __elaia.damp(); __elaia.setAdvanced(false);
      __elaia.commit(createLayout(PRESETS.find(p => p.profile === 'd-kurd-13')), { custom: false });
    });
    await page.click('#advanced-btn');
    await page.evaluate(() => {
      const r = __elaia.renderer;
      r.pitch = r.targetPitch = 1.32; r.setZoom(1.5);
      r.draw(performance.now() / 1000); __elaia.updateLabels();
    });
    check(await page.evaluate(() => __elaia.renderer.positions.filter(p => p.visible && p.x > 400 && p.y > 0 && p.y < 100)
      .every(p => !document.querySelector(`.field-label[data-id="${p.field.id}"]`).hidden)
      && [...document.querySelectorAll('.field-label:not([hidden])')].filter(el => parseFloat(el.style.top) < 100).length >= 2),
    'Zoomed upper fields retain labels inside the formerly excluded 100px band');
    check(await labelsClear(page), 'Desktop labels fit the viewport and avoid actual controls');
    await page.screenshot({ path: path.join(SHOTS, 'after-labels-desktop.png') });
    await page.evaluate(() => { window.dingLabel = document.querySelector('.field-label[data-id="n0"]'); });
    await page.locator('#instrument').hover({ position: { x: 480, y: 330 } });
    await page.mouse.wheel(0, 170);
    await page.waitForFunction(() => __elaia.renderer.zoom < 1.35);
    check(await page.evaluate(() => dingLabel === document.querySelector('.field-label[data-id="n0"]')), 'Real wheel zoom reuses label nodes');
    check(await labelsClear(page), 'Labels still avoid controls after a wheel gesture');
    await page.click('.note-chip[data-id="n0"]');
    await page.waitForFunction(() => document.querySelector('.field-label[data-id="n0"]').classList.contains('selected'));
    check(await page.locator('.field-label[data-id="n0"]').evaluate(el => el.classList.contains('selected')), 'Selection styling follows the cached label');
    await page.click('#field-up');
    await page.waitForFunction(() => document.querySelector('.field-label[data-id="n0"]').textContent === 'D♯3');
    check(await page.locator('.field-label[data-id="n0"]').textContent() === 'D♯3', 'Retuning updates the label text and measured size');
    await page.click('#restore-original');
    await page.click('#advanced-btn');
    await page.waitForFunction(() => !document.querySelector('.field-label'));
    check(await page.locator('.field-label').count() === 0, 'Play mode keeps labels hidden without keyboard mode');
    await page.click('#keyboard-btn');
    await page.waitForFunction(() => document.querySelector('.field-label:not([hidden])'));
    check(await page.locator('.field-label:visible').count() > 0, 'Keyboard mode uses the same visible field labels');
    await page.click('#keyboard-btn');
    await page.evaluate(() => {
      __elaia.setView('bottom'); const r = __elaia.renderer;
      r.pitch = r.targetPitch = -1.32; r.setZoom(1); r.dirty = true; r.draw(performance.now() / 1000);
    });
    check(await page.evaluate(() => {
      const r = __elaia.renderer, start = r.project([r.surfaceModel.port, r.heightAt(r.surfaceModel.port, 0, 'bottom'), 0]);
      const collar = r.project([0.23, r.heightAt(0.23, 0, 'bottom'), 0]);
      return r.surfaceModel.port === 0.18 && r.surfacePoint(collar.x, collar.y)?.side === 'bottom'
        && r.pick(start.x, start.y) === null && r.gl.getError() === 0;
    }), 'The compact opening renders a real steel collar and remains separate from tone fields');
    await page.screenshot({ path: path.join(SHOTS, 'after-bottom-desktop.png') });
    for (const side of ['bottom', 'top']) {
      for (const [pitch, yaw, zoom] of [[0.85, 0.4, 1.15], [1.12, -0.75, 0.8], [1.32, 1.2, 1.4]]) {
        const camera = { side, pitch: pitch * (side === 'bottom' ? 1 : -1), yaw, zoom };
        const feedback = await strikePixels(page, camera);
        check(!feedback.centerVisible && feedback.blue > 80 && feedback.glError === 0,
          `An unseen ${side} note produces a real pulse at pitch ${camera.pitch}`);
        // The shaped field can have an asymmetric footprint. Check blue at
        // its actual centre rather than the centroid of a projected ellipse.
        check(feedback.anchored > 20,
          `The rendered blue pulse covers the actual ${side} note projection, including depth, rotation, and zoom: ${JSON.stringify(feedback)}`);
        if (pitch === 0.85) check(feedback.wrongError > feedback.error + 10,
          `The ${side} pulse avoids the old position on the opposite shell`);
        check(feedback.mesh, 'Hidden-note feedback retains the full mesh and normal detail');
      }
      const exposed = await strikePixels(page, { side, pitch: side === 'top' ? 1.32 : -1.32, yaw: 1.2, zoom: 1.4, rotate: true });
      check(exposed.yellow > 80 && exposed.blue < exposed.changed * 0.01 && exposed.warmPreserved, 'Turning toward the struck shell retains warm strike pixels');
    }
    await page.evaluate(async () => {
      // The label fixture has no chord ending on a bottom note. Restore the
      // mixed-shell preset to inspect a fresh final strike of the arpeggio.
      const { createLayout, PRESETS } = await import(new URL('model.mjs', location.href).href);
      __elaia.damp(); __elaia.commit(createLayout(PRESETS[0]), { custom: false });
      __elaia.setView('top'); const r = __elaia.renderer;
      r.pitch = r.targetPitch = 1.12; r.setZoom(1); r.draw(performance.now() / 1000);
    });
    const chord = await page.evaluate(() => {
      for (const chord of __elaia.chords) {
        const hidden = chord.notes.at(-1);
        if (__elaia.layout.fields.find(f => f.id === hidden?.id)?.side !== 'bottom') continue;
        const p = __elaia.renderer.positions.find(p => p.field.id === hidden.id);
        const cover = __elaia.renderer.pick(p.x, p.y)?.field.id;
        if (chord.notes.some(n => n.id === cover)) continue;
        if (chord.notes.some(n => __elaia.layout.fields.find(f => f.id === n.id).side === 'top')) {
          return { symbol: chord.plainSymbol, hidden: hidden.id, ids: chord.notes.map(n => n.id) };
        }
      }
    });
    assert.ok(chord, 'The fixture has a mixed-shell chord');
    await page.click(`.chord-chip[data-chord="${chord.symbol}"]`);
    await page.waitForFunction(ids => ids.every(id => __elaia.renderer.hits.some((v, i) => i % 4 === 0 && v === __elaia.layout.fields.findIndex(f => f.id === id) + 1)), chord.ids);
    await page.waitForFunction(id => {
      const r = __elaia.renderer, index = __elaia.layout.fields.findIndex(f => f.id === id);
      return r.hits.some((v, i) => i % 4 === 0 && v === index + 1);
    }, chord.hidden);
    check(await chordAligned(page, chord.hidden), 'Pressing an actual chord button projects its hidden bottom voice at the correct note');
    await page.screenshot({ path: path.join(SHOTS, 'after-hidden-note-desktop.png') });
    await page.click('#damp-btn');
    check(await page.evaluate(() => __elaia.renderer.hits.every((v, i) => i % 4 !== 0 || v === -1)), 'Damping removes both visible and hidden strike feedback');
    await context.close();

    const { context: mobileContext, page: mobile } = await open({
      viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2,
    });
    const partialPhone = await strikePixels(mobile, partialCamera);
    check(partialPhone.yellow > 100 && partialPhone.blue > 20 && partialPhone.warmPreserved && partialPhone.glError === 0,
      'A partly visible phone note shows both colours at 2× pixel density without washing out yellow');
    await mobile.click('#advanced-btn');
    for (const [width, height] of [[390, 844], [320, 568], [844, 390]]) {
      await mobile.setViewportSize({ width, height });
      await mobile.waitForFunction(() => __elaia.renderer.width === document.getElementById('stage').clientWidth);
      const feedback = await strikePixels(mobile, { side: 'bottom', pitch: 0.85, yaw: 0.4, zoom: 1 });
      check(!feedback.centerVisible && feedback.blue > 80 && feedback.glError === 0 && feedback.anchored > 20,
        `${width}px phone pulse covers the actual hidden note at 2× pixel density`);
      await mobile.evaluate(() => {
        __elaia.damp(); const r = __elaia.renderer;
        r.pitch = r.targetPitch = 1.12; r.yaw = -0.12; r.setZoom(1.3);
      });
      await mobile.waitForFunction(() => !__elaia.renderer.dirty);
      await mobile.waitForFunction(() => document.querySelectorAll('.field-label:not([hidden])').length >= 6);
      check(await labelsClear(mobile), `${width}px mobile labels use available space without covering controls`);
      check(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth && __elaia.renderer.gl.getError() === 0), 'Phone layouts stay bounded with no GL errors');
      await mobile.screenshot({ path: path.join(SHOTS, `after-labels-${width}px.png`) });
    }
    await mobile.setViewportSize({ width: 390, height: 844 });
    await mobile.locator('#advanced-btn').tap();
    await mobile.locator('[data-play-tab="chords"]').tap();
    const mobileChord = await mobile.evaluate(() => {
      for (const chord of __elaia.chords) {
        const hidden = chord.notes.at(-1);
        if (__elaia.layout.fields.find(f => f.id === hidden?.id)?.side !== 'bottom') continue;
        const p = __elaia.renderer.positions.find(p => p.field.id === hidden.id);
        const cover = __elaia.renderer.pick(p.x, p.y)?.field.id;
        if (!chord.notes.some(n => n.id === cover)) return { symbol: chord.plainSymbol, hidden: hidden.id };
      }
    });
    assert.ok(mobileChord, 'The phone fixture has a chord whose final bottom voice is clear of a played top field');
    await mobile.locator(`.chord-chip[data-chord="${mobileChord.symbol}"]`).tap();
    await mobile.waitForFunction(id => {
      const r = __elaia.renderer, index = __elaia.layout.fields.findIndex(f => f.id === id);
      return r.hits.some((v, i) => i % 4 === 0 && v === index + 1);
    }, mobileChord.hidden);
    check(await mobile.evaluate(() => __elaia.audio.started && __elaia.renderer.gl.getError() === 0), 'Touching a chord on a phone starts audio and its hidden-shell pulse');
    check(await chordAligned(mobile, mobileChord.hidden), 'The phone chord pulse uses the hidden note projection after resizing and zooming');
    await mobile.screenshot({ path: path.join(SHOTS, 'after-hidden-note-390px.png') });
    await mobileContext.close();
    check(errors.length === 0, 'No browser exceptions');
    console.log(`Elaia visibility: ${count} checks passed — zoom labels, compact gu collar, pixel-accurate hidden-note positions, chord feedback, and phone layouts.`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
