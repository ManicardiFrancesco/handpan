// Zoom labels, the compact gu, and actual hidden-shell strike pixels.
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
    const controls = [...document.querySelectorAll('.instrument-heading, .restore-original, .edit-banner, .view-controls, .stage-hint')]
      .filter(el => el.getClientRects().length).map(el => el.getBoundingClientRect());
    return [...document.querySelectorAll('.field-label:not([hidden])')].every(label => {
      const r = label.getBoundingClientRect();
      return r.left >= stage.left && r.right <= stage.right && r.top >= stage.top && r.bottom <= stage.bottom
        && controls.every(c => r.right <= c.left || r.left >= c.right || r.bottom <= c.top || r.top >= c.bottom);
    });
  });
  try {
    const { context, page } = await open({ viewport: { width: 1440, height: 900 } });
    const clickable = await page.evaluate(async () => {
      const { clone, transposeLayout } = await import(new URL('model.mjs', location.href).href);
      const { addToneField } = await import(new URL('arrangement.mjs', location.href).href);
      const layout = clone(__elaia.layout); layout.fields[0].midi = 69; layout.a4 = 432;
      __elaia.commit(addToneField(transposeLayout(layout, 1), { id: 'ray-regression', midi: 61, side: 'bottom' }));
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
    await page.click('#play-mode-btn');
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
      const feedback = await page.evaluate(side => {
        __elaia.damp();
        const r = __elaia.renderer, t = performance.now() / 1000, opposite = side === 'top' ? 'bottom' : 'top';
        r.pitch = r.targetPitch = side === 'bottom' ? 1.32 : -1.32; r.dirty = true; r.draw(t);
        const f = __elaia.layout.fields.find(f => f.side === side);
        const p = r.project([f.x, r.heightAt(f.x, f.z, opposite), f.z]);
        const size = 60, scale = r.canvas.width / r.width;
        const x = Math.round(p.x * scale - size / 2), y = Math.round(r.canvas.height - p.y * scale - size / 2);
        const pixels = () => {
          const data = new Uint8Array(size * size * 4); r.gl.readPixels(x, y, size, size, r.gl.RGBA, r.gl.UNSIGNED_BYTE, data); return data;
        };
        const before = pixels(), vertices = r.vertexCount, resolution = r.normalSize;
        r.strike(f.id, t); r.draw(t + 0.12);
        const after = pixels(), slot = (r.hitIndex - 1) % 12;
        let changed = 0;
        for (let i = 0; i < before.length; i += 4) {
          if (Math.abs(before[i] - after[i]) + Math.abs(before[i + 1] - after[i + 1]) + Math.abs(before[i + 2] - after[i + 2]) > 10) changed++;
        }
        return { changed, hidden: r.hiddenHits[slot], mesh: vertices === r.vertexCount && resolution === r.normalSize, error: r.gl.getError() };
      }, side);
      check(feedback.hidden === 1 && feedback.changed > 80 && feedback.error === 0, `An unseen ${side} note changes actual pixels on the opposite shell`);
      check(feedback.mesh, 'Hidden-note feedback retains the full mesh and normal detail');
      await page.evaluate(side => {
        const r = __elaia.renderer; r.pitch = r.targetPitch = side === 'top' ? 1.32 : -1.32;
        r.dirty = true; r.draw(performance.now() / 1000);
      }, side);
      check(await page.evaluate(() => __elaia.renderer.hiddenHits[(__elaia.renderer.hitIndex - 1) % 12] === 0), 'Turning toward the struck shell switches off its through-shell pulse');
    }
    await page.evaluate(() => {
      __elaia.damp(); __elaia.setView('top'); const r = __elaia.renderer; r.pitch = r.targetPitch = 1.12; r.dirty = true; r.draw(performance.now() / 1000);
    });
    const chord = await page.evaluate(() => {
      for (const chord of __elaia.chords) for (const voicing of chord.voicings) {
        const hidden = voicing.notes.find(n => __elaia.layout.fields.find(f => f.id === n.id).side === 'bottom');
        if (hidden && voicing.notes.some(n => __elaia.layout.fields.find(f => f.id === n.id).side === 'top')) {
          return { symbol: chord.plainSymbol, root: voicing.rootMidi, hidden: hidden.id, ids: voicing.notes.map(n => n.id) };
        }
      }
    });
    assert.ok(chord, 'The fixture has a mixed-shell chord');
    await page.click(`.chord-chip[data-chord="${chord.symbol}"][data-root-midi="${chord.root}"]`);
    await page.waitForFunction(ids => ids.every(id => __elaia.noteTimers.has(id)), chord.ids);
    await page.waitForFunction(id => {
      const r = __elaia.renderer, index = __elaia.layout.fields.findIndex(f => f.id === id);
      return r.hits.some((v, i) => i % 4 === 0 && v === index + 1 && r.hiddenHits[i / 4] === 1);
    }, chord.hidden);
    check(await page.evaluate(id => {
      const r = __elaia.renderer, index = __elaia.layout.fields.findIndex(f => f.id === id);
      return r.hits.some((v, i) => i % 4 === 0 && v === index + 1 && r.hiddenHits[i / 4] === 1);
    }, chord.hidden), 'Pressing an actual chord button signals its hidden bottom-shell voice');
    await page.screenshot({ path: path.join(SHOTS, 'after-hidden-note-desktop.png') });
    await page.click('#damp-btn');
    check(await page.evaluate(() => __elaia.renderer.hits.every((v, i) => i % 4 !== 0 || v === -1)), 'Damping removes both visible and hidden strike feedback');
    await context.close();

    const { context: mobileContext, page: mobile } = await open({
      viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2,
    });
    await mobile.click('#advanced-btn');
    for (const [width, height] of [[390, 844], [320, 568], [844, 390]]) {
      await mobile.setViewportSize({ width, height });
      await mobile.waitForFunction(() => __elaia.renderer.width === document.getElementById('stage').clientWidth);
      await mobile.evaluate(() => { __elaia.renderer.setZoom(1.3); });
      await mobile.waitForFunction(() => !__elaia.renderer.dirty);
      await mobile.waitForFunction(() => [...document.querySelectorAll('.field-label:not([hidden])')].some(el => {
        const y = parseFloat(el.style.top); return y < 100 || y > __elaia.renderer.height - 115;
      }));
      check(await labelsClear(mobile), `${width}px mobile labels use available space without covering controls`);
      check(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth && __elaia.renderer.gl.getError() === 0), 'Phone layouts stay bounded with no GL errors');
      await mobile.screenshot({ path: path.join(SHOTS, `after-labels-${width}px.png`) });
    }
    await mobile.setViewportSize({ width: 390, height: 844 });
    await mobile.locator('#play-mode-btn').tap();
    await mobile.locator('[data-play-tab="chords"]').tap();
    const mobileChord = await mobile.evaluate(() => {
      for (const chord of __elaia.chords) for (const voicing of chord.voicings) {
        const hidden = voicing.notes.find(n => __elaia.layout.fields.find(f => f.id === n.id).side === 'bottom');
        if (hidden) return { symbol: chord.plainSymbol, root: voicing.rootMidi, hidden: hidden.id };
      }
    });
    await mobile.locator(`.chord-chip[data-chord="${mobileChord.symbol}"][data-root-midi="${mobileChord.root}"]`).tap();
    await mobile.waitForFunction(id => {
      const r = __elaia.renderer, index = __elaia.layout.fields.findIndex(f => f.id === id);
      return r.hits.some((v, i) => i % 4 === 0 && v === index + 1 && r.hiddenHits[i / 4] === 1);
    }, mobileChord.hidden);
    check(await mobile.evaluate(() => __elaia.audio.started && __elaia.renderer.gl.getError() === 0), 'Touching a chord on a phone starts audio and its hidden-shell pulse');
    await mobile.screenshot({ path: path.join(SHOTS, 'after-hidden-note-390px.png') });
    await mobileContext.close();
    check(errors.length === 0, 'No browser exceptions');
    console.log(`Elaia visibility: ${count} checks passed — zoom labels, compact gu collar, real hidden-shell pixels, chord feedback, and phone layouts.`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
