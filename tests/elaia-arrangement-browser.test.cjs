// Repeat additions, factory restoration, empty fields, and phone reachability.
const { chromium } = require(process.env.PW || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const BASE = (process.argv[2] || 'http://127.0.0.1:8080').replace(/\/$/, '');
const SHOTS = process.env.SHOTS || '/tmp/elaia-arrangement';
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
  try {
    const { context, page } = await open({ viewport: { width: 1440, height: 900 } });
    const stock = await page.evaluate(() => JSON.parse(JSON.stringify(__elaia.layout)));
    check(await page.locator('#stage-status').count() === 0 && await page.locator('#restore-original').isHidden(), 'The ready badge is removed and a factory instrument has no reset clutter');
    await page.click('#advanced-btn'); await page.click('[data-tool="add"]');
    check(await page.inputValue('#add-note') === '80', 'Add opens on G sharp 5, the next available scale note');
    for (const [index, midi] of [80, 81, 83, 85].entries()) {
      await page.click('#place-note-btn');
      check(await page.evaluate(({ total, midi }) => __elaia.layout.fields.length === total && __elaia.layout.fields.at(-1).midi === midi,
        { total: 19 + index, midi }), 'Repeated clicks add successive scale notes without choosing pitches');
      check(await page.locator('#add-settings').isVisible() && await page.locator('#restore-original').isVisible(), 'Repeat-add stays open and Original is immediately available');
      if (index === 0) await page.screenshot({ path: path.join(SHOTS, 'elaia-add-pair-desktop.png') });
    }
    check(await page.locator('#place-note-btn').isDisabled() && (await page.textContent('#add-feedback')).includes('five'), 'A full five-note cluster explains how to continue on the other shell or manually');
    await page.screenshot({ path: path.join(SHOTS, 'elaia-add-five-desktop.png') });
    await page.click('#undo-btn');
    check(await page.inputValue('#add-note') === '85' && await page.locator('#place-note-btn').isEnabled(), 'Undo removes one addition and restores the correct next pitch');
    await page.click('#redo-btn');
    const expanded = await page.evaluate(() => JSON.parse(JSON.stringify(__elaia.layout)));
    await page.click('#restore-original');
    assert.deepEqual(await page.evaluate(() => __elaia.layout), stock); count++;
    check(await page.locator('#restore-original').isHidden() && await page.locator('#add-settings').isHidden(), 'Reset returns to the original instrument and exits adding');
    await page.click('#undo-btn');
    assert.deepEqual(await page.evaluate(() => __elaia.layout), expanded); count++;
    await page.click('#restore-original');
    await page.click('.note-chip[data-id="n3"]'); await page.click('#remove-field');
    await page.click('[data-tool="add"]');
    check(await page.inputValue('#add-note') === '61', 'A missing published top note is offered before extensions');
    await page.click('#place-note-btn');
    const restored = await page.evaluate(() => __elaia.layout.fields.at(-1));
    check(['x', 'z', 'size', 'angle', 'geometry'].every(key => restored[key] === stock.fields[3][key]), 'Adding fills the removed field at its exact factory position');
    await page.click('#restore-original');
    await page.click('[data-tool="add"]'); await page.selectOption('#add-note', '');
    await page.click('#place-note-btn');
    check(await page.inputValue('#add-note') === '' && await page.evaluate(() => __elaia.layout.fields.at(-1).midi === null
      && __elaia.audio.indices.size === 18), 'Unassigned additions stay unassigned and are excluded from sound');
    await page.click('#cancel-add'); await page.selectOption('#field-note', '84');
    check(await page.evaluate(() => __elaia.layout.fields.at(-1).midi === 84 && __elaia.audio.indices.size === 19), 'Done makes the new field immediately tunable and assignment adds it to audio');
    await page.evaluate(() => {
      __elaia.commit({ ...__elaia.layout, preset: '', arrangement: '', fields: __elaia.layout.fields.map(f => ({ ...f, midi: null })) });
    });
    await page.click('[data-tool="add"]');
    check(await page.inputValue('#add-note') === '' && await page.locator('#follow-scale').isDisabled(), 'An unknown scale starts with empty fields');
    check(await page.evaluate(() => __elaia.audio.indices.size === 0 && !__elaia.audio.engine.inst
      && __elaia.audio.sampleStatus.total === 0 && __elaia.chords.length === 0), 'An all-empty instrument has no sample requests, chords, or synth notes');
    check(await page.locator('[data-demo="all"]').isDisabled(), 'A demo with no assigned pitches is disabled');
    await context.close();

    const { context: mobileContext, page: mobile } = await open({
      viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2,
    });
    await mobile.click('#advanced-btn'); await mobile.click('[data-tool="add"]');
    await mobile.locator('#place-note-btn').tap();
    check(await mobile.locator('#add-settings').isVisible() && await mobile.inputValue('#add-note') === '81', 'A phone can add the next scale note without reopening the panel');
    for (const [width, height] of [[390, 844], [320, 568]]) {
      await mobile.setViewportSize({ width, height });
      await mobile.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      check(await mobile.locator('#place-note-btn').evaluate(el => {
        const r = el.getBoundingClientRect();
        return r.top >= 0 && r.bottom <= innerHeight && r.height >= 44 && el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
      }), `${width}px phones keep the repeat-add action visible and touchable`);
      check(await mobile.evaluate(() => {
        const heading = document.querySelector('.instrument-heading').getBoundingClientRect(), reset = document.getElementById('restore-original').getBoundingClientRect();
        return document.documentElement.scrollWidth <= innerWidth && heading.right <= reset.left;
      }), `${width}px phones keep Original clear of the title without horizontal overflow`);
      await mobile.screenshot({ path: path.join(SHOTS, `elaia-add-${width}px.png`) });
    }
    await mobile.setViewportSize({ width: 390, height: 844 });
    await mobile.locator('#place-note-btn').tap();
    check(await mobile.evaluate(() => __elaia.layout.fields.length === 20 && __elaia.layout.fields.at(-1).midi === 81), 'The next phone tap extends the scale to A5');
    await mobile.click('#restore-original');
    check(await mobile.evaluate(() => __elaia.layout.fields.length === 18 && !__elaia.layout.custom), 'Phone Original restores the factory version with one tap');
    await mobile.click('#undo-btn');
    check(await mobile.evaluate(() => __elaia.layout.fields.length === 20), 'Phone Undo brings the customized instrument back');
    await mobile.setViewportSize({ width: 844, height: 390 }); await mobile.click('[data-tool="add"]');
    check(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight + 1), 'Landscape adding remains inside the viewport');
    await mobile.screenshot({ path: path.join(SHOTS, 'elaia-add-landscape.png') });
    await mobileContext.close();
    assert.deepEqual(errors, []); count++;
    console.log(`Elaia arrangement: ${count} checks passed — repeated scale additions, default slots, undo/reset, unassigned audio, and mobile reachability.`);
    console.log('Screenshots: ' + SHOTS);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
