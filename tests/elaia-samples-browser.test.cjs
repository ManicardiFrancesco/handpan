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
    await page.addInitScript(layout => localStorage.setItem('elaia.current.v1', JSON.stringify(layout)), doc);
    await page.route('**/smp-generic-D3.mp3*', route => route.fulfill({ status: 200, contentType: 'audio/mpeg', body: bytes }));
    await page.goto(BASE + '/Elaia-handpan-player/');
    await page.click('#sound-btn');
    await page.waitForFunction(() => __elaia.audio.sampleStatus.ready === 1);
    assert.ok(await page.evaluate(() => __elaia.audio.samples.cache.size === 1 && __elaia.audio.samples.bytes > 100000)); checks.push('real MP3 decoded');
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
    await page.click('#advanced-btn'); await page.click('[data-pitch="432"]'); await page.click('#transpose-up');
    await page.click('.note-chip');
    const rates = await page.evaluate(() => [...__elaia.audio.samples.voices].map(v => v.source.playbackRate.value));
    assert.ok(rates.some(rate => Math.abs(rate - 2 ** (1 / 12) * 432 / 440) < 1e-6)); checks.push('recorded notes transpose and retune to 432');
    await page.click('#damp-btn');
    assert.equal(await page.evaluate(() => __elaia.audio.samples.voices.size), 0); checks.push('damping clears sampled voices');
    await page.click('[data-sound="modeled"]'); await page.click('.note-chip');
    assert.equal(await page.evaluate(() => __elaia.audio.samples.voices.size), 0); checks.push('modeled option bypasses recorded voices');
    await context.close();

    const failedContext = await browser.newContext();
    const fallback = await failedContext.newPage();
    await fallback.addInitScript(layout => localStorage.setItem('elaia.current.v1', JSON.stringify(layout)), doc);
    await fallback.route('**/smp-generic-D3.mp3*', route => route.fulfill({ status: 404, body: '' }));
    await fallback.goto(BASE + '/Elaia-handpan-player/'); await fallback.click('#sound-btn');
    await fallback.waitForFunction(() => __elaia.audio.sampleStatus.failed === 1);
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
