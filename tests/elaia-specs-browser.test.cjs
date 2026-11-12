// Supplied Elaia specifications: dimensions, pitch limits, controls and views.
const { chromium } = require(process.env.PW || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const BASE = (process.argv[2] || 'http://127.0.0.1:8080').replace(/\/$/, '');
const SHOTS = process.env.SHOTS || '/tmp/elaia-spec-update';
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
  const zenith = async (page, side) => {
    await page.click(`[data-view="${side}"]`);
    await page.waitForFunction(side => __elaia.renderer.pitch === (side === 'top' ? Math.PI / 2 : -Math.PI / 2), side);
    check(await page.evaluate(() => Math.hypot(__elaia.renderer.eye[0], __elaia.renderer.eye[2]) < 1e-8
      && __elaia.renderer.positions.filter(p => p.visible).every(p => __elaia.renderer.pick(p.x, p.y)?.field.id === p.field.id)),
    `${side} is exactly zenithal and every visible field picks itself`);
  };
  try {
    const { context, page } = await open({ viewport: { width: 1440, height: 900 } });
    check(await page.locator('#play-mode-btn, #field-size, [data-side]').count() === 0, 'Obsolete Play, resizing and shell-transfer controls are absent');
    await page.click('#advanced-btn');
    check(await page.evaluate(() => __elaia.advanced) && await page.locator('#advanced-btn').getAttribute('aria-pressed') === 'true', 'Customize toggles on');
    await page.click('#advanced-btn');
    check(await page.evaluate(() => !__elaia.advanced), 'The same Customize button toggles off');
    await zenith(page, 'bottom'); await zenith(page, 'top');
    const before = await page.evaluate(() => JSON.parse(JSON.stringify(__elaia.layout)));
    await page.click('#sound-btn'); await page.waitForFunction(() => __elaia.audio.started);
    await page.click('[data-position="2"]');
    check(await page.evaluate(before => __elaia.layout.position === 2
      && __elaia.layout.fields[0].x === before.fields[0].x
      && __elaia.layout.fields[0].z === before.fields[0].z
      && Math.hypot(__elaia.layout.fields[1].x - before.fields[1].x, __elaia.layout.fields[1].z - before.fields[1].z) > 0.1, before),
    'Position 2 offsets the ring while retaining the player-facing ding');
    check(await page.evaluate(() => __elaia.audio.layout === __elaia.layout
      && __elaia.audio.engine.inst.notes.every(n => Math.abs(n.pan
        - __elaia.layout.fields.find(f => __elaia.audio.indices.get(f.id) === n.ni).x * 0.7) < 1e-8)),
    'Playing positions update modeled and recorded stereo placement');
    await page.click('[data-position="1"]');
    await page.click('#bottom-overlay-btn');
    check(await page.locator('#bottom-overlay').isVisible() && await page.locator('#bottom-overlay path').count() === 7, 'Bottom-note outlines can be shown through the top shell');
    check(await page.evaluate(() => {
      const field = __elaia.layout.fields.find(f => f.side === 'bottom'), p = __elaia.renderer.positions.find(p => p.field.id === field.id);
      const label = document.querySelector('#bottom-overlay text');
      return Math.hypot(+label.getAttribute('x') - p.x, +label.getAttribute('y') - p.y) < 1e-8;
    }), 'Bottom labels use the actual 3D underside projection');
    await page.screenshot({ path: path.join(SHOTS, 'after-desktop.png'), fullPage: true, timeout: 90_000 });
    await page.click('#bottom-overlay-btn');
    check(await page.locator('#bottom-overlay').isHidden(), 'The bottom overlay toggles off');
    await page.click('#transpose-up');
    check(await page.evaluate(() => __elaia.layout.transpose === 3 && __elaia.layout.fields.every(f => f.midi !== 70)
      && __elaia.layout.fields.filter(f => f.midi > 76).every(f => f.aspect === 1 && f.shape === 'pure')),
    'Nearby transpose controls skip excluded keys and keep high notes circular');
    await page.click('#restore-original');
    await page.click('#advanced-btn'); await page.click('#undo-btn'); await page.click('#redo-btn');
    await page.evaluate(() => __elaia.commit({ ...__elaia.layout, fields: __elaia.layout.fields.filter(f => f.side === 'top') }));
    await zenith(page, 'bottom'); await page.click('[data-tool="add"]');
    check(await page.locator('#add-note option').first().getAttribute('value') === ''
      && await page.locator('#add-note option[value="44"]').count() === 1
      && await page.locator('#add-note option[value="43"], #add-note option[value="70"], #add-note option[value="89"]').count() === 0,
    'Bottom additions offer G sharp 2–E6 without B flat 4');
    await page.selectOption('#add-note', '48'); await page.click('#place-note-btn');
    check(await page.evaluate(() => {
      const f = __elaia.layout.fields.at(-1);
      return f.midi === 48 && f.side === 'bottom' && f.size > 0.3 && f.shape === 'dome';
    }), 'A C3 bottom addition is a realistically sized oval dome');
    await page.click('#cancel-add'); await page.click('#field-details summary');
    check((await page.textContent('#field-dimensions')).includes('provisional'), 'The inspector identifies the provisional Ayasa C3 dimensions');
    await page.selectOption('#field-note', '49');
    check((await page.textContent('#field-dimensions')).includes('160 × 180 mm')
      && (await page.textContent('#field-dimensions')).includes('85 × 100 mm'), 'Changing pitch applies both specified tonefield and dimple dimensions');
    await page.selectOption('#field-note', '69'); await page.click('#field-up');
    check(await page.evaluate(() => __elaia.layout.fields.at(-1).midi === 71), 'The note stepper skips B flat 4');
    await page.selectOption('#field-note', '76');
    check(await page.evaluate(() => __elaia.layout.fields.at(-1).aspect === 60 / 90), 'E5 uses the oval row in the written specification');
    await page.click('#field-up');
    check(await page.evaluate(() => {
      const f = __elaia.layout.fields.at(-1);
      return f.midi === 77 && f.shape === 'pure' && f.aspect === 1 && Math.abs(f.size * 530 - 70) < 1e-8;
    }) && await page.locator('#field-shape').isDisabled(), 'F5 and above use fixed circular pure geometry');
    await page.click('#undo-btn');
    check(await page.evaluate(() => __elaia.layout.fields.at(-1).midi === 76 && __elaia.layout.fields.at(-1).aspect < 1), 'Undo restores pitch and physical dimensions together');
    await page.click('#redo-btn');
    const state = await page.evaluate(() => JSON.parse(JSON.stringify(__elaia.layout)));
    await page.reload(); await page.waitForFunction(() => !!window.__elaia);
    assert.deepEqual(await page.evaluate(() => __elaia.layout), state); count++;
    await context.close();

    const { context: phoneContext, page: phone } = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    for (const [width, height] of [[390, 844], [320, 568]]) {
      await phone.setViewportSize({ width, height });
      await zenith(phone, 'top');
      await phone.locator('#bottom-overlay-btn').tap();
      await phone.screenshot({ path: path.join(SHOTS, `after-mobile-${width}.png`), fullPage: true, timeout: 90_000 });
      check(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth
        && [...document.querySelectorAll('.stage-tools button')].every(b => {
          const r = b.getBoundingClientRect();
          return r.left >= 0 && r.right <= innerWidth && r.height >= 44;
        })), `${width}px phones retain reachable position, transpose and visibility controls`);
      check(await phone.evaluate(() => {
        const r = __elaia.renderer, stage = document.getElementById('stage').getBoundingClientRect();
        const controls = document.querySelector('.stage-tools').getBoundingClientRect();
        return Array.from({ length: 32 }, (_, i) => {
          const angle = i / 32 * Math.PI * 2, x = Math.cos(angle), z = Math.sin(angle);
          return r.project([x, r.heightAt(x, z, 'top'), z]).y + stage.top < controls.top;
        }).every(Boolean);
      }), `${width}px phone controls leave the complete instrument rim reachable`);
      await phone.locator('#bottom-overlay-btn').tap();
    }
    await phone.setViewportSize({ width: 390, height: 844 });
    await phone.click('#advanced-btn'); await phone.click('[data-tool="add"]'); await phone.locator('#place-note-btn').tap();
    await phone.screenshot({ path: path.join(SHOTS, 'after-customize-mobile.png'), fullPage: true, timeout: 90_000 });
    check(await phone.evaluate(() => __elaia.layout.fields.at(-1).shape === 'pure'), 'Phone additions apply the same geometry rules');
    await phoneContext.close();
    assert.deepEqual(errors, []); count++;
    console.log(`Elaia specifications: ${count} checks passed — fixed dimensions, limits, zenith views, playing positions, overlay, transpose and phone controls.`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
