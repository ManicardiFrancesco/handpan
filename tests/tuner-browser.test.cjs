const { chromium } = require(process.env.PW || 'playwright');
const assert = require('node:assert/strict');
const base = process.argv[2] || 'http://127.0.0.1:8080';
(async () => {
  const browser = await chromium.launch({
    args: ['--no-sandbox', '--use-fake-ui-for-media-stream'],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    // Feed coherent partials through the real browser analyser and microphone
    // source path. Deliberately bypass no detector or rendering implementation.
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = async function (constraints) {
        window.requestedConstraints = constraints;
        const ctx = new AudioContext(),
          destination = ctx.createMediaStreamDestination();
        await ctx.resume();
        window.feed = {
          ctx,
          destination,
          oscs: [],
          gains: [],
          silence() {
            this.oscs.forEach((o) => {
              o.stop();
              o.disconnect();
            });
            this.oscs = [];
            this.gains = [];
          },
          set(f, offsets = [4, -9, 13], missing = []) {
            this.silence();
            offsets.forEach((c, i) => {
              if (missing.includes(i)) return;
              const osc = ctx.createOscillator(),
                gain = ctx.createGain();
              osc.frequency.value = f * (i + 1) * 2 ** (c / 1200);
              gain.gain.value = [0.15, 0.08, 0.05][i];
              osc.connect(gain).connect(destination);
              osc.start();
              this.oscs.push(osc);
              this.gains.push(gain);
            });
          },
        };
        return destination.stream;
      };
    });
    await page.goto(base + '/tuner.html');
    await page.locator('.tone').last().waitFor();
    assert.equal(await page.locator('.tone').count(), 11);
    assert.deepEqual(await page.locator('.partial-reading').allTextContents(), [
      '—cents',
      '—cents',
      '—cents',
    ]);
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 1024, height: 768 },
      { width: 768, height: 800 },
      { width: 390, height: 844 },
      { width: 320, height: 568 },
    ]) {
      await page.setViewportSize(viewport);
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
        `Overflow at ${viewport.width}px`,
      );
      for (const id of ['microphone', 'demo', 'play-reference']) {
        const box = await page.locator('#' + id).boundingBox();
        assert.ok(
          box.width > 0 && box.x >= 0 && box.x + box.width <= viewport.width + 1,
          `${id} visible at ${viewport.width}px`,
        );
      }
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator('#microphone').click();
    await page.waitForFunction(() =>
      document.querySelector('#live-status').textContent.includes('Listening'),
    );
    assert.deepEqual(await page.evaluate(() => window.requestedConstraints.audio), {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
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
      assert.equal(await page.locator('.tone').count(), set.notes.length);
      for (let i = 0; i < set.notes.length; i++) {
        await page.locator('#note-list button').nth(i).click();
        const f = await page.evaluate(async (name) => {
          const { parseNote, frequency } = await import('/src/tuner/detection.mjs');
          return frequency(parseNote(name).midi);
        }, set.notes[i]);
        await page.evaluate((f) => window.feed.set(f), f);
        await page.waitForFunction(
          () =>
            [...document.querySelectorAll('.partial-reading')].every(
              (el, i) => Math.abs(parseFloat(el.textContent) - [4, -9, 13][i]) < 0.45,
            ),
          null,
          { timeout: 5000 },
        );
        const measured = await page.locator('.partial-reading').allTextContents();
        const expected = [4, -9, 13];
        measured.forEach((v, i) => {
          const actual = parseFloat(v);
          assert.ok(
            Math.abs(actual - expected[i]) < 0.45,
            `${set.notes[i]} partial ${i + 1}: ${actual}, expected ${expected[i]}`,
          );
        });
        const ideal = await page.locator('#ideal-2').textContent();
        assert.equal(ideal, `Ideal · ${(f * 3).toFixed(2)} Hz`);
      }
    }
    // Weak/missing partials must never be inferred from the remaining ones.
    await page.locator('#top-shell').click();
    await page.evaluate(() => window.feed.set(146.8323839587038, [4, -9, 13], [0]));
    await page.waitForFunction(
      () =>
        document.querySelector('#reading-0').textContent === '—cents' &&
        Math.abs(parseFloat(document.querySelector('#reading-1').textContent) + 9) < 0.45,
    );
    assert.equal(await page.locator('#reading-0').textContent(), '—cents');
    assert.equal(await page.locator('#interval-1').textContent(), '');
    assert.ok(Math.abs(parseFloat(await page.locator('#reading-1').textContent()) + 9) < 0.45);
    await page.evaluate(() => window.feed.silence());
    await page.waitForFunction(() =>
      [...document.querySelectorAll('.partial-reading')].every((el) => el.textContent === '—cents'),
    );
    assert.deepEqual(await page.locator('.partial-reading').allTextContents(), [
      '—cents',
      '—cents',
      '—cents',
    ]);
    await page.evaluate(() => window.feed.set(146.8323839587038, [0, 0, 0]));
    await page.waitForFunction(() =>
      [...document.querySelectorAll('.partial-state')].every((el) =>
        el.textContent.includes('Within tolerance'),
      ),
    );
    assert.ok(
      (await page.locator('.partial-state').allTextContents()).every((v) =>
        v.includes('Within tolerance'),
      ),
    );
    await page.locator('#record-strike').click();
    await page.waitForTimeout(550);
    await page.locator('#record-strike').click();
    await page.waitForFunction(() => !document.querySelector('#play-recording').disabled);
    await page.locator('#play-recording').click();
    await page.waitForFunction(() =>
      document.querySelector('#reference-status').textContent.includes('your D3'),
    );
    await page.locator('#play-reference').click();
    await page.waitForFunction(() =>
      document.querySelector('#reference-status').textContent.includes('handpan reference'),
    );
    await page.locator('#stop-reference').click();
    await page.locator('#microphone').click();
    assert.equal(await page.locator('#record-strike').isDisabled(), true);
    await page.locator('#demo').click();
    await page.waitForFunction(() =>
      [...document.querySelectorAll('.partial-reading')].every(
        (el, i) => Math.abs(parseFloat(el.textContent) - [3.2, -8.4, 12.1][i]) < 0.45,
      ),
    );
    const demo = await page.locator('.partial-reading').allTextContents();
    demo.forEach((v, i) => assert.ok(Math.abs(parseFloat(v) - [3.2, -8.4, 12.1][i]) < 0.45));
    await page.locator('#spectrum-tab').click();
    assert.equal(await page.locator('#spectrum-tab').getAttribute('aria-pressed'), 'true');
    await page.locator('#settings-button').click();
    await page.locator('#concert-pitch').fill('432');
    await page
      .locator('#settings-form button[type=submit], #settings-form .primary-button')
      .click();
    assert.equal(await page.locator('#pitch-label').textContent(), '432');
    await page.reload();
    assert.equal(await page.locator('#pitch-label').textContent(), '432');
    await page.locator('#help-button').click();
    assert.equal(await page.locator('#help-dialog').evaluate((d) => d.open), true);
    await page.locator('#help-dialog .primary-button').click();
    assert.deepEqual(errors, []);
    console.log(
      'Tuner browser: 18 notes × 3 real partials, 5 viewports, missing partials, silence, mic lifecycle, local A/B capture, demo and saved calibration passed.',
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
