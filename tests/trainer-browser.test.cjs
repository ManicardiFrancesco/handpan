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
    await page.evaluate(()=>testTone.osc.frequency.value=130);
    await page.waitForFunction(()=>document.querySelector('#pitch-space').dataset.state==='low');
    await page.waitForFunction(()=>document.querySelector('#pitch-trail line[stroke="#638da8"]'));
    assert.ok(await page.locator('#pitch-trail line[stroke="#c58340"]').count()>0, 'Trail retains earlier high pitch');
    await page.evaluate(()=>testTone.osc.disconnect());
    await page.waitForFunction(()=>document.querySelectorAll('#pitch-trail line').length===0);
    await page.evaluate(()=>testTone.osc.connect(testTone.dest));
    await page.evaluate(()=>testTone.osc.frequency.value=146.83238396);
    await page.waitForFunction(()=>document.querySelector('#completed').textContent==='1 / 9');
    assert.ok(await page.locator('#pitch-score').textContent() !== '— / 100');
    await page.waitForFunction(()=>document.querySelector('#target-note').textContent==='A3');
    await page.locator('#microphone').click();
    assert.deepEqual(errors,[]);
    console.log('Browser passed: audio, microphone lifecycle, notes, scales, octaves, mobile layout, high/low feedback, sustained pitch completion and automatic advance.');
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exit(1)});
