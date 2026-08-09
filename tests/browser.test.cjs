/* Browser integration test: loads the app in headless Chromium, exercises the
 * 3D view, audio engine and chord panel, and fails on any console error.
 *
 *   node tests/browser.test.cjs [baseUrl]
 *
 * Requires playwright (installed under /tmp for this environment).
 */
const path = require('path');
const { chromium } = require(process.env.PW || '/tmp/node_modules/playwright');
const BASE = process.argv[2] || 'http://127.0.0.1:8080';
const SHOTS = process.env.SHOTS || '/tmp';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.log('  FAIL:', m); } };

(async () => {
  const browser = await chromium.launch({
    args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 880 } });
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  page.on('requestfailed', r =>
    errs.push('REQFAIL: ' + r.url().split('/').pop() + ' ' + r.failure().errorText));

  await page.goto(BASE + '/index.html');
  await page.waitForTimeout(800);
  await page.mouse.click(720, 430);          // gate: start audio
  await page.waitForTimeout(1500);

  console.log('=== boot ===');
  const st = await page.evaluate(() => ({
    started: __app.engine.started,
    hasNode: !!__app.engine.node,
    ctx: __app.engine.ctx && __app.engine.ctx.state,
    sr: __app.engine.ctx && __app.engine.ctx.sampleRate,
    notes: __app.engine.inst.nNotes,
    quads: __app.renderer.quads.length,
    chords: __app.chordPanel.chords.length,
    status: document.getElementById('status').textContent,
    cw: document.getElementById('view').width,
  }));
  console.log(' ', JSON.stringify(st));
  ok(st.started, 'engine started');
  ok(st.hasNode, 'worklet node created');
  ok(st.ctx === 'running', 'context running');
  ok(st.notes === 9, 'D Kurd 9 has 9 notes, got ' + st.notes);
  ok(st.quads > 500, 'shell mesh built, quads=' + st.quads);
  ok(st.chords > 20, 'chords found: ' + st.chords);
  ok(/ready/.test(st.status), 'status shows ready: ' + st.status);
  ok(st.cw > 300, 'canvas sized: ' + st.cw);

  console.log('=== 3D picking: every visible field is hittable ===');
  const pick = await page.evaluate(() => {
    const r = __app.renderer, out = [];
    for (const np of r.notePos) {
      if (!np || np.vis < 0.25) continue;
      const hit = r.pick(np.x, np.y);
      out.push({ name: np.nt.name, hit: hit ? hit.nt.name : null });
    }
    return out;
  });
  const mis = pick.filter(x => x.hit !== x.name);
  ok(pick.length >= 8, 'most fields visible from default camera: ' + pick.length);
  ok(mis.length === 0, 'each field picks itself (mismatches: ' + JSON.stringify(mis) + ')');

  console.log('=== strike via pick -> audible energy ===');
  const energy = await page.evaluate(async () => {
    const r = __app.renderer;
    const np = r.notePos.find(n => n && n.vis > 0.5);
    __app.hitNote(np.nt, 0.9, 0.1);
    await new Promise(z => setTimeout(z, 400));
    const inst = __app.engine.inst;
    return { struck: np.nt.name, energies: inst.notes.map(n => +n.energy.toFixed(4)) };
  });
  const anyE = energy.energies.some(e => e > 0.0005);
  ok(anyE, 'DSP reports per-note energy after a strike: ' + JSON.stringify(energy));

  console.log('=== orbit + zoom ===');
  const cam0 = await page.evaluate(() => ({ y: __app.renderer.yaw, p: __app.renderer.pitch, d: __app.renderer.dist }));
  await page.mouse.move(700, 300);
  await page.mouse.down();
  await page.mouse.move(860, 380, { steps: 8 });
  await page.mouse.up();
  await page.mouse.wheel(0, -300);
  await page.waitForTimeout(200);
  const cam1 = await page.evaluate(() => ({ y: __app.renderer.yaw, p: __app.renderer.pitch, d: __app.renderer.dist }));
  ok(Math.abs(cam1.y - cam0.y) > 0.05, 'drag changed yaw ' + cam0.y.toFixed(2) + '->' + cam1.y.toFixed(2));
  ok(Math.abs(cam1.p - cam0.p) > 0.02, 'drag changed pitch');
  ok(cam1.d < cam0.d, 'scroll zoomed in ' + cam0.d.toFixed(2) + '->' + cam1.d.toFixed(2));
  await page.screenshot({ path: path.join(SHOTS, 'shot-orbited.png') });

  // view from underneath: bottom-shell notes must become visible on a mutant
  console.log('=== bottom shell visibility on a mutant layout ===');
  await page.evaluate(() => {
    const sel = document.getElementById('scale');
    const idx = [...sel.options].findIndex(o => o.textContent.includes('Kurd 21'));
    sel.selectedIndex = idx; sel.dispatchEvent(new Event('change'));
    __app.renderer.pitch = 1.2;      // look up at the underside
  });
  await page.waitForTimeout(500);
  const bot = await page.evaluate(() => {
    const inst = __app.engine.inst;
    const vis = __app.renderer.notePos.filter(n => n && n.vis > 0.3);
    return {
      total: inst.nNotes,
      bottomCount: inst.notes.filter(n => n.bottom).length,
      visibleBottom: vis.filter(n => n.nt.bottom).length,
      visibleTop: vis.filter(n => !n.nt.bottom).length,
    };
  });
  console.log(' ', JSON.stringify(bot));
  ok(bot.total === 21, 'Kurd 21 loaded: ' + bot.total);
  ok(bot.bottomCount > 0, 'has bottom-shell notes: ' + bot.bottomCount);
  ok(bot.visibleBottom > 0, 'bottom notes visible from below: ' + bot.visibleBottom);
  await page.screenshot({ path: path.join(SHOTS, 'shot-underside.png') });

  console.log('=== chord panel ===');
  await page.evaluate(() => {
    document.getElementById('resetview').click();
    const sel = document.getElementById('scale');
    const idx = [...sel.options].findIndex(o => o.textContent.includes('Kurd 9'));
    sel.selectedIndex = idx; sel.dispatchEvent(new Event('change'));
  });
  await page.waitForTimeout(400);
  const cp = await page.evaluate(() => ({
    mode: document.getElementById('cp-mode').textContent,
    items: document.querySelectorAll('.cp-item').length,
    groups: document.querySelectorAll('.cp-group').length,
    firstSyms: [...document.querySelectorAll('.cp-sym')].slice(0, 8).map(e => e.textContent),
  }));
  console.log(' ', JSON.stringify(cp));
  ok(/natural minor/.test(cp.mode), 'mode line reads natural minor: ' + cp.mode);
  ok(cp.items > 20, 'chord items listed: ' + cp.items);
  ok(cp.groups >= 5, 'grouped by root: ' + cp.groups);

  // click a chord: highlights notes and strums
  await page.click('.cp-item');
  await page.waitForTimeout(700);
  const sel = await page.evaluate(() => ({
    selected: !!__app.chordPanel.selected,
    symbol: __app.chordPanel.selected && __app.chordPanel.selected.symbol,
    highlighted: __app.highlight.size,
    held: __app.held.length,
    live: document.getElementById('cp-live').textContent,
  }));
  console.log(' ', JSON.stringify(sel));
  ok(sel.selected, 'chord selected on click');
  ok(sel.highlighted >= 3, 'chord notes highlighted: ' + sel.highlighted);
  ok(sel.held >= 2, 'strum registered held notes: ' + sel.held);
  ok(/[A-G]/.test(sel.live), 'live panel identified something: ' + sel.live);

  console.log('=== filters ===');
  for (const f of ['triads', '7th', 'ext', 'all']) {
    const n = await page.evaluate(async (ff) => {
      document.querySelector('.cp-filters button[data-f="' + ff + '"]').click();
      await new Promise(z => setTimeout(z, 120));
      const items = [...document.querySelectorAll('.cp-item')];
      const syms = items.map(i => i.querySelector('.cp-sym').textContent);
      return { count: items.length, syms: syms.slice(0, 5) };
    }, f);
    console.log('  ' + f.padEnd(7), 'items=' + String(n.count).padStart(3), n.syms.join(' '));
    ok(n.count > 0 || f === 'ext', 'filter ' + f + ' yields results');
  }

  console.log('=== live chord identification by playing ===');
  const live = await page.evaluate(async () => {
    __app.chordPanel.clearSelection();
    __app.held = [];
    const inst = __app.engine.inst;
    const byName = (n) => inst.notes.find(x => x.name === n);
    for (const n of ['D3', 'F4', 'A3']) { __app.hitNote(byName(n), 0.7, 0.1); await new Promise(z => setTimeout(z, 90)); }
    __app.heldDirty = true;
    await new Promise(z => setTimeout(z, 260));
    return document.getElementById('cp-live').textContent;
  });
  console.log('  played D3 F4 A3 ->', live.trim());
  ok(/Dm/.test(live), 'D+F+A identified as Dm, got: ' + live);

  console.log('=== every scale loads, renders and analyses ===');
  const scales = await page.evaluate(() => [...document.getElementById('scale').options].map(o => o.textContent));
  for (let i = 0; i < scales.length; i++) {
    const r = await page.evaluate(async (idx) => {
      const sel = document.getElementById('scale');
      sel.selectedIndex = idx;
      sel.dispatchEvent(new Event('change'));
      await new Promise(z => setTimeout(z, 90));
      const inst = __app.engine.inst;
      // strike a few notes to be sure the DSP accepts the new table
      for (let k = 0; k < 3; k++) __app.engine.strike(k % inst.nNotes, 0.8, 0.2, 1);
      await new Promise(z => setTimeout(z, 80));
      return {
        n: inst.nNotes,
        quads: __app.renderer.quads.length,
        chords: __app.chordPanel.chords.length,
        drawn: __app.renderer.notePos.filter(x => x).length,
        ding: inst.notes[0].name,
        f0: +inst.notes[0].f0.toFixed(2),
        res: inst.resonators.f.length,
        links: inst.resonators.cd.length,
      };
    }, i);
    console.log('  ' + scales[i].padEnd(34), 'n=' + String(r.n).padStart(2),
      'res=' + String(r.res).padStart(4), 'links=' + String(r.links).padStart(3),
      'chords=' + String(r.chords).padStart(3), 'ding=' + r.ding.padEnd(4), r.f0 + ' Hz');
    ok(r.quads > 400, scales[i] + ': mesh built');
    ok(r.n >= 8, scales[i] + ': notes >= 8');
    ok(r.res === r.n * 10 + 3, scales[i] + ': resonator count = 10/note + 3 global, got ' + r.res);
  }

  console.log('=== responsive ===');
  // Resize twice, small then large then small again: the canvas used to feed its
  // own height back into the stage's measured height, so it could only grow.
  for (const [w, h] of [[430, 900], [1440, 880], [390, 780], [430, 900]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(250);
  }
  const mob = await page.evaluate(() => {
    const c = document.getElementById('view').getBoundingClientRect();
    const r = __app.renderer;
    // how much of the canvas the shell actually fills, across the width
    const xs = r.notePos.filter(Boolean).map(n => n.x);
    // projected shell diameter: the rim is at unit radius
    const dia = Math.round(2 * r.fit * 2.0 / Math.max(0.35, r.dist));
    return {
      w: Math.round(c.width), h: Math.round(c.height),
      fits: c.right <= innerWidth + 1 && c.bottom <= innerHeight + 1,
      shellDia: dia,
      noteSpan: xs.length ? Math.round(Math.max(...xs) - Math.min(...xs)) : 0,
      // is the first control group reachable without the canvas eating the page?
      scaleTop: Math.round(document.getElementById('scale').getBoundingClientRect().top),
      docH: Math.round(document.documentElement.scrollHeight),
    };
  });
  console.log(' ', JSON.stringify(mob));
  ok(mob.fits, 'canvas fits inside the mobile viewport');
  ok(mob.w > 200 && mob.h > 200, 'canvas usable on mobile: ' + mob.w + 'x' + mob.h);
  ok(mob.h < 520, 'canvas height stays bounded after repeated resizes: ' + mob.h);
  // At the default zoom the shell occupies about 60% of the width, leaving room
  // to orbit without the rim leaving the frame.
  ok(mob.shellDia > mob.w * 0.5,
    'shell fills the canvas width (' + mob.shellDia + ' of ' + mob.w + ' px)');
  ok(mob.noteSpan > mob.w * 0.35,
    'tone fields are spread across the view (' + mob.noteSpan + ' px)');
  ok(mob.scaleTop < 1400, 'controls are within reach on mobile (scale select at y=' + mob.scaleTop + ')');
  await page.screenshot({ path: path.join(SHOTS, 'shot-mobile.png'), fullPage: false });

  await page.setViewportSize({ width: 1440, height: 880 });
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const sel = document.getElementById('scale');
    const idx = [...sel.options].findIndex(o => o.textContent.includes('Kurd 9'));
    sel.selectedIndex = idx; sel.dispatchEvent(new Event('change'));
    __app.engine.strike(0, 0.9, 0.08, 1);
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(SHOTS, 'shot-desktop.png') });

  console.log('\n=== console errors ===');
  console.log(' ', errs.length ? errs : 'NONE');
  ok(errs.length === 0, 'no console errors');

  console.log('\n' + (fail ? 'FAILURES: ' + fail : 'ALL PASS') + '  (' + pass + ' assertions)');
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('harness error:', e); process.exit(2); });
