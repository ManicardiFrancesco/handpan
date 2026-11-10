// Real MP3 decode/playback and graceful failure, independently of the synth.
// The source recording is cached in /tmp, never bundled with the app.
const { chromium } = require(process.env.PW || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const BASE = (process.argv[2] || 'http://127.0.0.1:8080').replace(/\/$/, '');
(async () => {
  const { createLayout } = await import('../Elaia-handpan-player/model.mjs');
  const { sampleFor } = await import('../Elaia-handpan-player/sample-player.mjs');
  const doc = createLayout(); doc.fields = [doc.fields[0]]; doc.custom = true;
  const entry = sampleFor(doc, doc.fields[0]);
  const fixture = process.env.SAMPLE_FIXTURE || '/tmp/elaia-ayasa-D3.mp3';
  if (!fs.existsSync(fixture)) {
    const response = await fetch(entry.url); assert.equal(response.status, 200);
    fs.writeFileSync(fixture, Buffer.from(await response.arrayBuffer()));
  }
  const bytes = fs.readFileSync(fixture), checks = [];
  const browser = await chromium.launch({ args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-webgl'] });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    await page.addInitScript(layout => localStorage.setItem('elaia.current.v1', JSON.stringify(layout)), { ...doc, sound: 'modeled' });
    await page.route('**/smp-generic-D3.mp3*', route => route.fulfill({ status: 200, contentType: 'audio/mpeg', body: bytes }));
    await page.goto(BASE + '/Elaia-handpan-player/');
    await page.waitForFunction(() => __elaia.audio.sampleStatus.ready === 1);
    assert.ok(await page.evaluate(() => __elaia.audio.samples.cache.size === 1 && __elaia.audio.samples.bytes > 100000)); checks.push('real MP3 decoded');
    assert.ok(await page.evaluate(() => !__elaia.audio.started && !__elaia.audio.engine.ctx));
    checks.push('recording preloads before any gesture without enabling playback');
    const trackSynth = async target => target.evaluate(() => {
      window.synthHits = 0;
      const original = __elaia.audio.engine.strike.bind(__elaia.audio.engine);
      __elaia.audio.engine.strike = (...args) => { synthHits++; original(...args); };
    });
    await trackSynth(page);
    await page.click('#sound-btn');
    await page.waitForFunction(() => __elaia.audio.samples.voices.size === 1);
    assert.equal(await page.evaluate(() => synthHits), 0);
    checks.push('the first gesture uses the preloaded recording');
    checks.push('an old saved synth preference still uses the default recorded sound');
    const audio = await page.evaluate(async () => {
      __elaia.damp(); await new Promise(r => setTimeout(r, 100));
      const audio = __elaia.audio, ctx = audio.engine.ctx, analyser = ctx.createAnalyser();
      analyser.fftSize = 32768; analyser.smoothingTimeConstant = 0; audio.engine.master.connect(analyser);
      const original = audio.engine.strike.bind(audio.engine); let synthStrikes = 0;
      audio.engine.strike = (...args) => { synthStrikes++; original(...args); };
      await __elaia.play('n0'); await new Promise(r => setTimeout(r, 750));
      const bins = new Float32Array(analyser.frequencyBinCount); analyser.getFloatFrequencyData(bins);
      let peak = -Infinity, hz = 0;
      for (let i = 0; i < bins.length; i++) {
        const f = i * ctx.sampleRate / analyser.fftSize;
        if (f > 140 && f < 155 && bins[i] > peak) { peak = bins[i]; hz = f; }
      }
      audio.engine.master.disconnect(analyser);
      return { synthStrikes, voices: audio.samples.voices.size, peak, hz };
    });
    assert.equal(audio.synthStrikes, 0); assert.equal(audio.voices, 1);
    assert.ok(audio.peak > -65 && Math.abs(audio.hz - 146.832) < 2.5); checks.push('recorded D3 plays without a duplicate synth strike');
    await page.click('#advanced-btn'); await page.click('#tuning-tab'); await page.click('[data-pitch="432"]'); await page.click('#transpose-up');
    await page.click('#sound-btn');
    const rates = await page.evaluate(() => [...__elaia.audio.samples.voices].map(v => v.source.playbackRate.value));
    assert.ok(rates.some(rate => Math.abs(rate - 2 ** (1 / 12) * 432 / 440) < 1e-6)); checks.push('recorded notes transpose and retune to 432');
    await page.click('#damp-btn');
    assert.equal(await page.evaluate(() => __elaia.audio.samples.voices.size), 0); checks.push('damping clears sampled voices');
    await context.close();

    for (const cancel of [false, true, 'layout']) {
      const slowContext = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
      const slow = await slowContext.newPage();
      await slow.addInitScript(layout => localStorage.setItem('elaia.current.v1', JSON.stringify(layout)), doc);
      let release;
      const gate = new Promise(resolve => { release = resolve; });
      await slow.route('**/smp-generic-D3.mp3*', async route => {
        await gate; await route.fulfill({ status: 200, contentType: 'audio/mpeg', body: bytes });
      });
      await slow.goto(BASE + '/Elaia-handpan-player/');
      await slow.waitForFunction(() => window.__elaia?.audio.samples.loading === 1);
      await trackSynth(slow);
      await slow.locator('.note-chip[data-id="n0"]').tap();
      await slow.waitForFunction(() => __elaia.audio.started);
      assert.deepEqual(await slow.evaluate(() => ({ synth: synthHits, recorded: __elaia.audio.samples.voices.size })), { synth: 0, recorded: 0 });
      if (cancel === true) await slow.evaluate(() => __elaia.damp());
      if (cancel === 'layout') await slow.evaluate(() => __elaia.commit({ ...__elaia.layout, title: 'Another instrument' }, { geometry: false }));
      release();
      await slow.waitForFunction(() => __elaia.audio.samples.pending.size === 0);
      if (cancel) {
        // Wait for pending play promises and callbacks to settle too.
        await slow.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        assert.equal(await slow.evaluate(() => __elaia.audio.samples.voices.size), 0);
        assert.equal(await slow.evaluate(() => synthHits), 0);
        checks.push(cancel === true ? 'damping cancels a loading first strike' : 'changing the layout cancels a loading first strike');
      } else {
        await slow.waitForFunction(() => __elaia.audio.samples.voices.size === 1);
        assert.equal(await slow.evaluate(() => synthHits), 0);
        checks.push('a cold first touch waits for its recording instead of synthesizing');
      }
      await slowContext.close();
    }

    const bankContext = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const bank = await bankContext.newPage(), fullLayout = createLayout();
    let releaseBank, active = 0, maxActive = 0;
    const bankGate = new Promise(resolve => { releaseBank = resolve; });
    await bank.addInitScript(layout => localStorage.setItem('elaia.current.v1', JSON.stringify(layout)), fullLayout);
    await bank.route('**/smp-*.mp3*', async route => {
      active++; maxActive = Math.max(maxActive, active);
      await bankGate; await route.fulfill({ status: 200, contentType: 'audio/mpeg', body: bytes }); active--;
    });
    await bank.goto(BASE + '/Elaia-handpan-player/');
    await bank.waitForFunction(() => window.__elaia?.audio.samples.loading === 3);
    await bank.evaluate(() => { __elaia.audio.samples.budget = 512000; });
    releaseBank();
    await bank.waitForFunction(() => __elaia.audio.sampleStatus.ready === 18);
    assert.equal(maxActive, 3);
    assert.ok(await bank.evaluate(() => !__elaia.audio.started && __elaia.audio.samples.cache.size === 18 && __elaia.audio.samples.bytes > __elaia.audio.samples.budget));
    checks.push('all current-bank notes remain ready under cache pressure with three concurrent loads');
    await trackSynth(bank);
    await bank.locator('.note-chip[data-id="n0"]').tap();
    await bank.locator('.note-chip[data-id="n10"]').tap();
    await bank.click('[data-view="bottom"]');
    await bank.locator('.note-chip[data-id="n17"]').tap();
    await bank.waitForFunction(() => __elaia.audio.samples.voices.size === 3);
    assert.equal(await bank.evaluate(() => synthHits), 0);
    checks.push('first touches on different top and bottom fields all use recordings');
    await bank.evaluate(layout => __elaia.commit(layout), doc);
    assert.ok(await bank.evaluate(() => __elaia.audio.samples.cache.size === 1 && __elaia.audio.sampleStatus.ready === 1));
    checks.push('cache pressure releases recordings outside the selected instrument');
    await bankContext.close();

    const failedContext = await browser.newContext();
    const fallback = await failedContext.newPage();
    await fallback.addInitScript(layout => localStorage.setItem('elaia.current.v1', JSON.stringify(layout)), doc);
    await fallback.route('**/smp-generic-D3.mp3*', route => route.fulfill({ status: 404, body: '' }));
    await fallback.goto(BASE + '/Elaia-handpan-player/');
    await fallback.waitForFunction(() => __elaia.audio.sampleStatus.failed === 1);
    assert.match(await fallback.locator('#sample-status').textContent(), /Synthesis fills the gaps/);
    await trackSynth(fallback); await fallback.click('#sound-btn');
    await fallback.waitForFunction(() => synthHits === 1);
    checks.push('a failed recording reports fallback and synthesizes the first hit');
    const energy = await fallback.evaluate(async () => {
      let strikes = 0; const original = __elaia.audio.engine.strike.bind(__elaia.audio.engine);
      __elaia.audio.engine.strike = (...args) => { strikes++; original(...args); };
      await __elaia.play('n0'); return strikes;
    });
    assert.equal(energy, 1); checks.push('unavailable previews fall back immediately');
    await failedContext.close();
    console.log(`Elaia samples: ${checks.length} checks passed — ${checks.join('; ')}.`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
