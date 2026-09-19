const { chromium } = require(process.env.PW || 'playwright');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({args:['--no-sandbox','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']});
  try {
    const page = await browser.newPage({viewport:{width:1440,height:1000}});
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto((process.argv[2] || 'http://127.0.0.1:8088') + '/trainer.html');
    await page.locator('.tone').last().waitFor();
    for (const viewport of [{width:1440,height:700},{width:768,height:700},{width:390,height:667},{width:320,height:568},{width:844,height:390}]) {
      await page.setViewportSize(viewport);
      await page.evaluate(()=>window.scrollTo(0,0));
      const button = await page.locator('#microphone').boundingBox();
      assert.ok(button.y >= 0 && button.y + button.height <= viewport.height, `Microphone visible at ${viewport.width}×${viewport.height}`);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    }
    await page.setViewportSize({width:1440,height:1000});
    assert.equal(await page.locator('.tone').count(),9);
    // Compare every field with the original renderer's layout, then click the
    // physical positions to verify they select the intended reference pitches.
    const fields = await page.evaluate(async () => {
      const { Renderer3D } = await import('/src/ui/renderer3d.js');
      const { buildInstrument } = await import('/src/model/instrument.js');
      const { SCALES } = await import('/src/model/scales.js');
      const inst = buildInstrument(SCALES[0]);
      new Renderer3D(document.createElement('canvas')).layout(inst);
      return inst.notes.map((note, i) => {
        const button = document.querySelectorAll('.tone')[i];
        return { name: note.name, frequency: note.f0,
          x: parseFloat(button.style.left), y: parseFloat(button.style.top),
          expectedX: 50 + note.gx / .62 * 35,
          expectedY: 50 + note.gz / .62 * 35 };
      });
    });
    for (const field of fields) {
      assert.ok(Math.abs(field.x-field.expectedX)<.001, `${field.name} horizontal placement`);
      assert.ok(Math.abs(field.y-field.expectedY)<.001, `${field.name} vertical placement`);
    }
    await page.evaluate(async () => {
      const { Engine } = await import('/src/audio/engine.js');
      const strike = Engine.prototype.strike;
      Engine.prototype.strike = function(index, ...args) {
        window.lastReference = { frequency: this.inst.notes[index].f0, name: this.inst.notes[index].name,
          worklet: this.node instanceof AudioWorkletNode, touch: args };
        return strike.call(this, index, ...args);
      };
    });
    for (const field of fields) {
      const bounds = await page.locator('#handpan').boundingBox();
      await page.mouse.click(bounds.x + bounds.width * field.x / 100,
        bounds.y + bounds.height * field.y / 100);
      await page.waitForFunction(name=>window.lastReference?.name===name, field.name);
      assert.equal(await page.locator('#target-note').textContent(),field.name);
      assert.equal(await page.evaluate(()=>window.lastReference.frequency),field.frequency);
    }
    await page.locator('#note-list button').last().click();
    await page.waitForFunction(()=>window.lastReference?.name==='A4');
    assert.deepEqual(await page.evaluate(()=>window.lastReference), {
      frequency:440, name:'A4', worklet:true, touch:[0.72,0.15,1],
    });
    await page.locator('#reset').click();
    await page.locator('#listen').click();
    await page.locator('#microphone').click();
    await page.waitForFunction(()=>document.querySelector('#mic-status').textContent==='● LISTENING');
    assert.equal(await page.locator('#mic-status').textContent(),'● LISTENING');
    await page.locator('#microphone').click();
    assert.equal(await page.locator('#mic-status').textContent(),'MIC OFF');
    await page.locator('#next').click();
    assert.equal(await page.locator('#target-note').textContent(),'A3');
    await page.selectOption('#octave','12');
    assert.equal(await page.locator('#target-note').textContent(),'D4');
    await page.selectOption('#scale','3');
    assert.equal(await page.locator('.tone').count(),8);
    await page.selectOption('#scale',{label:'F Aegean 18'});
    await page.selectOption('#octave','0');
    assert.equal(await page.locator('#handpan .tone').count(),9);
    assert.equal(await page.locator('#handpan-bottom .tone').count(),9);
    const aegean = ['F2','C3','F3','Ab3','Bb3','C4','Eb4','F4','G4','Ab4','Bb4','C5','Eb5','F5','G5','Ab5','Bb5','C6'];
    assert.deepEqual(await page.locator('#note-list button').allTextContents(),aegean);
    for (const name of aegean) {
      await page.locator('.tone').filter({hasText:new RegExp(`^${name}$`)}).click();
      await page.waitForFunction(name=>window.lastReference?.name===name,name);
      assert.equal(await page.locator('#target-note').textContent(),name);
    }
    await page.locator('#next').click();
    assert.equal(await page.locator('#target-note').textContent(),'F2');
    await page.setViewportSize({width:390,height:844});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.selectOption('#scale','0'); await page.selectOption('#octave','0');
    assert.equal(await page.locator('#handpan-bottom').isVisible(),false);
    await page.screenshot({path:'/tmp/handpan-voice-desktop.png',fullPage:true});
    await page.setViewportSize({width:390,height:844});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.screenshot({path:'/tmp/handpan-voice-mobile.png',fullPage:true});
    // Feed a known pitch through the real analyser and exercise correction + hold.
    await page.evaluate(() => {
      const ctx = new AudioContext(), osc = ctx.createOscillator(), dest = ctx.createMediaStreamDestination();
      osc.frequency.value=160; osc.connect(dest); osc.start();
      window.testTone={ctx,osc,dest};
      navigator.mediaDevices.getUserMedia=async()=>dest.stream;
    });
    await page.locator('#microphone').click();
    await page.waitForFunction(()=>document.querySelector('#pitch-space').dataset.state==='high');
    await page.waitForFunction(()=>document.querySelectorAll('#pitch-trail line').length>3);
    assert.ok(await page.locator('#pitch-rms').textContent() !== '— cents');
    const beforeReplay = await page.locator('#pitch-marker').evaluate(el=>parseFloat(el.style.top));
    await page.locator('#listen').click();
    await page.evaluate(()=>testTone.osc.frequency.value=130);
    await page.waitForFunction(before=>parseFloat(document.querySelector('#pitch-marker').style.top)>before+10,beforeReplay,{timeout:450});
    assert.equal(await page.locator('#hold-ring').getAttribute('aria-valuenow'),'0.0', 'Hold stays empty immediately after reference playback');
    await page.waitForFunction(()=>document.querySelector('#pitch-space').dataset.state==='low');
    await page.waitForFunction(()=>document.querySelector('#pitch-trail line[stroke="#638da8"]'));
    assert.ok(await page.locator('#pitch-trail line[stroke="#c58340"]').count()>0, 'Trail retains earlier high pitch');
    await page.evaluate(()=>testTone.osc.disconnect());
    await page.waitForFunction(()=>document.querySelectorAll('#pitch-trail line').length===0);
    await page.evaluate(()=>testTone.osc.connect(testTone.dest));
    await page.evaluate(()=>testTone.osc.frequency.value=146.83238396);
    await page.waitForFunction(()=>Number(document.querySelector('#hold-ring').getAttribute('aria-valuenow'))>=.5);
    assert.ok(Number(await page.locator('#hold-ring-fill').evaluate(el=>el.style.strokeDashoffset))<100,'Ring fills while holding pitch');
    // Three zones. Inside the tolerance the bank fills; a drift eases it back
    // without wiping it; a different note empties it.
    await page.waitForFunction(()=>document.querySelector('#hold-tile').dataset.zone==='good');
    const banked = Number(await page.locator('#hold-ring').getAttribute('aria-valuenow'));
    await page.evaluate(()=>testTone.osc.frequency.value=148.96); // 25 cents sharp: drifting, not wrong
    await page.waitForFunction(()=>document.querySelector('#hold-tile').dataset.zone==='drift');
    assert.ok(await page.locator('#hold-ring').evaluate(el=>el.classList.contains('draining')),'The ring shows it draining');
    await page.waitForTimeout(250);
    const drifted = Number(await page.locator('#hold-ring').getAttribute('aria-valuenow'));
    assert.ok(drifted<banked,`Drifting out of tune eases the bank back (${banked} → ${drifted})`);
    assert.ok(drifted>0,'A moment out of tune is a setback, not a restart');
    await page.evaluate(()=>testTone.osc.frequency.value=165); // two semitones up: a different note
    await page.waitForFunction(()=>document.querySelector('#hold-ring').classList.contains('lost'),null,{timeout:4000});
    assert.equal(await page.locator('#hold-ring').getAttribute('aria-valuenow'),'0.0','A wrong note empties the bank');
    assert.equal(await page.locator('#hold-percent').textContent(),'0%');
    assert.equal(await page.locator('#hold-tile').getAttribute('data-zone'),'off');
    // Back on target, and the drifted-through attempt still lands.
    await page.evaluate(()=>testTone.osc.frequency.value=146.83238396);
    await page.waitForFunction(()=>document.querySelector('#completed').textContent==='1 / 9');
    assert.equal(await page.locator('#hold-percent').textContent(),'100%');
    assert.ok(await page.locator('#pitch-score').textContent() !== '— / 100');
    await page.waitForFunction(()=>document.querySelector('#target-note').textContent==='A3');
    await page.locator('#microphone').click();
    assert.equal(await page.locator('#hold-ring').getAttribute('aria-valuenow'),'0.0');
    // ---- Progress graph, difficulty ladder, speedrun, arpeggio rounds ----
    await page.setViewportSize({width:1440,height:1000});
    // Elements that set their own display must still honour the hidden attribute.
    assert.equal(await page.locator('#suggestion').isVisible(),false,'Suggestion stays out of the way');
    assert.equal(await page.locator('#run-bar').isVisible(),false,'No run clock outside speedrun');
    assert.equal(await page.locator('#lane-caption').isVisible(),false);
    // The note held above was metered and stored as one point on the graph.
    const stored = await page.evaluate(()=>JSON.parse(localStorage.getItem('handpanvoice.history.v1')));
    assert.equal(stored.length,1);
    assert.equal(stored[0].note,'D3'); assert.equal(stored[0].mode,'guided');
    assert.equal(stored[0].difficulty,'Balanced');
    // The tone above sat low before it landed, so the RMS carries that approach.
    assert.ok(stored[0].cents>0&&stored[0].cents<150,`Stored accuracy ${stored[0].cents} cents`);
    assert.ok(stored[0].best>=0&&stored[0].best<stored[0].cents,'Closest moment beats the RMS');
    assert.equal(await page.locator('#stat-count').textContent(),'1');
    assert.equal(await page.locator('#progress-chart svg circle').count(),1);
    assert.equal(await page.locator('#progress-table tbody tr').count(),1);
    assert.equal(await page.locator('.chart-empty').isVisible(),false);
    // One ladder drives tolerance, hold, the ring's label and the chart's band.
    assert.equal(await page.locator('#difficulty').inputValue(),'3');
    assert.match(await page.locator('#difficulty-note').textContent(),/Balanced: stay within ±15 cents for 2\.0 seconds/);
    await page.locator('#easier').click();
    assert.equal(await page.locator('#difficulty').inputValue(),'2');
    assert.match(await page.locator('#difficulty-note').textContent(),/Relaxed: stay within ±25 cents for 1\.5 seconds/);
    assert.equal(await page.locator('.hold-caption').textContent(),'Fill the ring · hold in tune for 1.5 seconds');
    assert.equal(await page.locator('#hold-ring').getAttribute('aria-valuemax'),'1.5');
    // The two bands in the pitch space are drawn from the level, so what you see
    // is what is being measured: ±25 cents banks, out to ±75 eases back.
    const bands = () => page.evaluate(()=>['.zone','.drift-zone'].map(s=>Math.round(parseFloat(document.querySelector(s).style.height))));
    assert.deepEqual(await bands(),[13,39],'Relaxed draws a wide in-tune band inside a wider drift band');
    await page.locator('#easier').click(); await page.locator('#easier').click();
    assert.equal(await page.locator('#difficulty').inputValue(),'0');
    assert.equal(await page.locator('#easier').isDisabled(),true,'Cannot go gentler than the first rung');
    await page.selectOption('#difficulty','5');
    assert.equal(await page.locator('#harder').isDisabled(),true,'Cannot go tighter than the last rung');
    assert.equal(await page.evaluate(()=>localStorage.getItem('handpanvoice.level.v1')),'5');
    await page.selectOption('#difficulty','3');
    assert.deepEqual(await bands(),[8,26],'Balanced tightens the in-tune band, and the drift band holds its quarter-tone floor');
    assert.match(await page.locator('#difficulty-note').textContent(),/past ±50 cents it empties/);
    assert.ok((await page.locator('#progress-chart svg text').allTextContents()).includes('in tune ±15'));
    // Speedrun: the clock starts on your first note and banks a personal best.
    await page.selectOption('#mode','speedrun');
    assert.equal(await page.locator('#run-bar').isVisible(),true);
    assert.equal(await page.locator('#run-clock').textContent(),'0.0s');
    assert.equal(await page.locator('#run-best').textContent(),'—');
    assert.equal(await page.locator('#run-progress').textContent(),'0 / 9');
    assert.equal(await page.locator('.hold-caption').textContent(),'Fill the ring · hold in tune for 0.8 seconds');
    // Stopping the microphone ends the fake track, so hand out a fresh one.
    await page.evaluate(()=>{navigator.mediaDevices.getUserMedia=async()=>{
      const dest=window.testTone.ctx.createMediaStreamDestination();
      window.testTone.osc.connect(dest);
      return dest.stream;
    }});
    // Track whatever note is being asked for, so the run actually completes.
    await page.evaluate(()=>{window.follow=setInterval(()=>{
      const hz=parseFloat(document.getElementById('target-hz').textContent);
      if(hz) window.testTone.osc.frequency.value=hz;
    },40)});
    await page.locator('#microphone').click();
    await page.waitForFunction(()=>document.querySelector('#run-clock').classList.contains('running'),null,{timeout:15000});
    await page.waitForFunction(()=>document.querySelector('#run-progress').textContent==='9 / 9',null,{timeout:60000});
    await page.waitForFunction(()=>!document.querySelector('#run-clock').classList.contains('running'),null,{timeout:5000});
    const finalTime = await page.locator('#run-clock').textContent();
    await page.waitForTimeout(400);
    assert.equal(await page.locator('#run-clock').textContent(),finalTime,'Clock stops on the last note');
    assert.match(await page.locator('#guidance').textContent(),/New best · \d/);
    const runs = await page.evaluate(()=>JSON.parse(localStorage.getItem('handpanvoice.runs.v1')));
    assert.deepEqual(Object.keys(runs),['D Kurd 9|0|3']);
    assert.ok(runs['D Kurd 9|0|3'].ms>0&&runs['D Kurd 9|0|3'].count===1);
    assert.equal(await page.locator('#run-best').textContent(),await page.locator('#run-clock').textContent());
    assert.match(await page.locator('#stat-run-note').textContent(),/^D Kurd 9 · Balanced · 1 run$/);
    const sprint = await page.evaluate(()=>JSON.parse(localStorage.getItem('handpanvoice.history.v1')).filter(e=>e.mode==='speedrun'));
    assert.ok(sprint.length>=6,`Speedrun notes recorded: ${sprint.length}`);
    assert.ok(sprint.every(entry=>entry.cents<150),'Outliers never reach the graph');
    // Arpeggio: the phrase plays, then scrolls at you guitar-hero style.
    await page.selectOption('#mode','arpeggio');
    assert.equal(await page.locator('#run-bar').isVisible(),false);
    assert.equal(await page.locator('#pitch-space').getAttribute('data-lane'),'on');
    assert.deepEqual(await page.locator('.lane-note').allTextContents(),['D3','Bb3','D4']);
    assert.equal(await page.locator('.zone').isVisible(),false,'The single-target zone steps aside');
    assert.equal(await page.locator('.drift-zone').isVisible(),false,'And so does its drift band');
    assert.equal(await page.locator('.hold-caption').textContent(),'Fill the ring · hold in tune for 0.5 seconds');
    await page.waitForSelector('.lane-note.sounding');
    assert.match(await page.locator('#lane-caption').textContent(),/^Triad up · 3 notes/);
    assert.equal(await page.locator('#step').textContent(),'PHRASE 1 · TRIAD UP');
    await page.waitForFunction(()=>document.querySelector('#guidance').textContent==='Your turn.',null,{timeout:20000});
    const before = await page.locator('.lane-note').evaluateAll(els=>els.map(el=>parseFloat(el.style.left)));
    before.forEach((left,i)=>{ if(i) assert.ok(left>before[i-1],`Block ${i} queues to the right`); });
    await page.waitForTimeout(500);
    const after = await page.locator('.lane-note').evaluateAll(els=>els.map(el=>parseFloat(el.style.left)));
    after.forEach((left,i)=>assert.ok(left<before[i]-4,`Block ${i} travels right to left`));
    await page.waitForSelector('.lane-note.hit',{timeout:15000});
    await page.waitForFunction(()=>/^(All 3 notes|\d of 3 notes)/.test(document.querySelector('#guidance').textContent),null,{timeout:20000});
    assert.equal(await page.locator('.lane-note.hit').count(),3,'Every note of the phrase was sung back');
    assert.match(await page.locator('#lane-caption').textContent(),/1 clean round in a row$/);
    assert.equal(await page.locator('#completed').textContent(),'3 / 9');
    const phrase = await page.evaluate(()=>JSON.parse(localStorage.getItem('handpanvoice.history.v1')).filter(e=>e.mode==='arpeggio'));
    assert.deepEqual(phrase.map(entry=>entry.note),['D3','Bb3','D4']);
    await page.waitForFunction(()=>document.querySelector('#step').textContent.startsWith('PHRASE 2'),null,{timeout:10000});
    assert.equal(await page.locator('.lane-note').count(),4,'The next phrase is a new pattern');
    await page.evaluate(()=>clearInterval(window.follow));
    await page.locator('#microphone').click();
    await page.selectOption('#mode','guided');
    assert.equal(await page.locator('#pitch-space').getAttribute('data-lane'),null);
    assert.equal(await page.locator('.lane-note').count(),0);
    assert.equal(await page.locator('.zone').isVisible(),true);
    // History ranges, then an erase that needs a confirming second tap.
    await page.locator('.range button[data-range="all"]').click();
    assert.equal(await page.locator('.range button.on').textContent(),'All');
    const all = await page.locator('#progress-chart svg circle').count();
    assert.ok(all>=10,`Points on the graph: ${all}`);
    await page.locator('#clear-progress').click();
    assert.equal(await page.locator('#clear-progress').textContent(),'Tap again to erase everything');
    assert.equal(await page.locator('#progress-chart svg circle').count(),all,'First tap erases nothing');
    await page.locator('#clear-progress').click();
    assert.equal(await page.locator('#stat-count').textContent(),'0');
    assert.equal(await page.locator('#stat-run').textContent(),'—');
    assert.equal(await page.locator('.chart-empty').isVisible(),true);
    assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('handpanvoice.history.v1'))),[]);
    assert.deepEqual(errors,[]);
    console.log('Browser passed: audio, microphone lifecycle, notes, scales, octaves, mobile layout, high/low feedback, sustained pitch completion and automatic advance,'
      + ' progress graph and history, three-zone hold scoring, difficulty ladder, speedrun clock and record, arpeggio lane and round scoring.');
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exit(1)});
