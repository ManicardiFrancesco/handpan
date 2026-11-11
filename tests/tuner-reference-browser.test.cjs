const { chromium } = require(process.env.PW || 'playwright');
const assert = require('node:assert/strict');
const base = process.argv[2] || 'http://127.0.0.1:8080';
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await page.goto(base + '/tuner.html');
    await page.locator('.tone').last().waitFor();
    await page.evaluate(async () => {
      const { Engine } = await import('/src/audio/engine.js');
      const strike = Engine.prototype.strike;
      Engine.prototype.strike = function (index, ...args) {
        window.referenceEngine = this;
        const note = this.inst.notes[index];
        window.lastModal = {
          name: note.name,
          hz: note.f0,
          index,
          notes: this.inst.nNotes,
          a4: this.inst.a4,
          worklet: this.node instanceof AudioWorkletNode,
          principals: [0, 2, 4].map((i) => note.modes[i].f),
          touch: args,
        };
        if (!window.referenceProbe) {
          window.referenceProbe = this.ctx.createAnalyser();
          window.referenceProbe.fftSize = 2048;
          this.master.connect(window.referenceProbe);
        }
        return strike.call(this, index, ...args);
      };
      const createOscillator = AudioContext.prototype.createOscillator;
      AudioContext.prototype.createOscillator = function (...args) {
        const osc = createOscillator.apply(this, args),
          start = osc.start;
        osc.start = function (...times) {
          window.lastPure = {
            hz: osc.frequency.value,
            sameContext: osc.context === window.referenceEngine.ctx,
          };
          return start.apply(this, times);
        };
        return osc;
      };
    });
    const sets = [
      {
        side: 'top',
        notes: ['D3', 'F#3', 'A3', 'C#4', 'D4', 'F#4', 'G#4', 'A4', 'C#5', 'D5', 'F#5'],
      },
      { side: 'bottom', notes: ['E3', 'G#3', 'B3', 'E4', 'E5', 'B4', 'B2'] },
    ];
    for (const set of sets) {
      await page.locator('#' + set.side + '-shell').click();
      for (let i = 0; i < set.notes.length; i++) {
        await page.locator('#note-list button').nth(i).click();
        await page.waitForFunction((name) => window.lastModal?.name === name, set.notes[i]);
        const ref = await page.evaluate(() => window.lastModal);
        assert.equal(ref.notes, 18);
        assert.equal(ref.a4, 440);
        assert.equal(ref.worklet, true);
        assert.deepEqual(ref.principals, [ref.hz, ref.hz * 2, ref.hz * 3]);
        assert.deepEqual(ref.touch, [0.5, 0.15, 1]);
        await page.waitForFunction(() => {
          const data = new Float32Array(2048);
          window.referenceProbe.getFloatTimeDomainData(data);
          return data.some((x) => Math.abs(x) > 0.00001);
        });
      }
    }
    await page.locator('#top-shell').click();
    const f0 = 146.8323839587038;
    for (const ratio of [1, 2, 3]) {
      await page.locator(`[data-play="${ratio}"]`).click();
      await page.waitForFunction(
        (hz) => Math.abs((window.lastPure?.hz || 0) - hz) < 0.001,
        f0 * ratio,
      );
      assert.equal(await page.evaluate(() => window.lastPure.sameContext), true);
    }
    await page.locator('#play-reference').click();
    await page.waitForFunction(
      () => window.lastModal?.name === 'D3' && window.referenceEngine.master.gain.value > 0,
    );
    await page.locator('#volume').evaluate((el) => {
      el.value = 0;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForTimeout(150);
    assert.ok(await page.evaluate(() => window.referenceEngine.master.gain.value < 0.005));
    await page.locator('#volume').evaluate((el) => {
      el.value = 45;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForFunction(() => window.referenceEngine.master.gain.value > 0.2);
    await page.locator('#stop-reference').click();
    await page.waitForFunction(() => window.referenceEngine.master.gain.value === 0);
    assert.equal(await page.evaluate(() => window.referenceEngine.master.gain.value), 0);
    await page.locator('#settings-button').click();
    await page.locator('#concert-pitch').fill('432');
    await page.locator('#settings-form .primary-button').click();
    await page.locator('#play-reference').click();
    await page.waitForFunction(() => window.lastModal?.a4 === 432);
    const calibrated = await page.evaluate(() => window.lastModal);
    assert.ok(Math.abs(calibrated.hz - (f0 * 432) / 440) < 0.00001);
    assert.deepEqual(calibrated.principals, [calibrated.hz, calibrated.hz * 2, calibrated.hz * 3]);
    await page.setViewportSize({ width: 320, height: 568 });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    await page.goto(base + '/index.html?scale=d-aegean-18');
    await page.waitForFunction(() => document.querySelectorAll('#notes .nl').length === 18);
    assert.equal(
      await page.locator('#scale option:checked').textContent(),
      'D Aegean 18 (Lombardo)',
    );
    assert.equal(await page.locator('#root').inputValue(), '50');
    assert.deepEqual(
      await page.locator('#notes .nl b').allTextContents(),
      sets.flatMap((s) => s.notes),
    );
    assert.deepEqual(errors, []);
    console.log(
      'Reference browser: all 18 notes use real AudioWorklet synthesis with audible output; pure partials, shared context, volume recovery, stop, A4 calibration, mobile and 3D preset passed.',
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
