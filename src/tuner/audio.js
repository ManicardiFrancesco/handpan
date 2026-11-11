import { Engine } from '../audio/engine.js';
import { DEFAULT_TOP, DEFAULT_BOTTOM, parseNote } from './detection.mjs';

export class TunerAudio {
  constructor() {
    this.ctx = null;
    this.stream = null;
    this.source = null;
    this.demoNodes = [];
    this.referenceNodes = [];
    this.volume = 0.45;
    this.mode = 'off';
    this.physicalEngine = null;
    this.instrumentKey = null;
    this.playbackRequest = 0;
    this.physicalPlaying = false;
    this.configureInstrument({ top: DEFAULT_TOP, bottom: DEFAULT_BOTTOM, a4: 440 });
  }
  configureInstrument(settings) {
    const key = JSON.stringify([settings.top, settings.bottom, settings.a4]);
    if (key === this.instrumentKey) return;
    this.instrumentKey = key;
    this.noteNames = [...settings.top, ...settings.bottom];
    const root = parseNote(settings.top[0]).midi;
    this.physicalScale = {
      name: 'D Aegean 18 (Lombardo)',
      root,
      iv: this.noteNames.map((n) => parseNote(n).midi - root),
      bottomFrom: settings.top.length,
      flatNames: false,
    };
    this.concertPitch = settings.a4;
    if (this.physicalEngine?.started) this.buildPhysicalInstrument();
  }
  buildPhysicalInstrument() {
    this.physicalEngine.build(this.physicalScale, {
      a4: this.concertPitch,
      seed: 7,
      helmF: 85,
      idealPartials: true,
    });
    this.physicalEngine.param({ sustain: 1, kappa: 0.0076 * 0.42 });
    this.physicalEngine.dry.gain.value = 1 - 0.3 * 0.35;
    this.physicalEngine.wet.gain.value = 0.3 * 0.9;
    this.physicalEngine.setPans(this.physicalEngine.inst.notes);
  }
  async start() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 32768;
      this.analyser.smoothingTimeConstant = 0;
      this.spectrum = new Float32Array(this.analyser.frequencyBinCount);
      this.wave = new Float32Array(2048);
      this.referenceGain = this.ctx.createGain();
      this.referenceGain.gain.value = this.volume;
      this.referenceGain.connect(this.ctx.destination);
    }
    await this.ctx.resume();
  }
  async microphone(deviceId) {
    await this.start();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      },
    });
    this.stopInput();
    this.stream = stream;
    this.source = this.ctx.createMediaStreamSource(stream);
    // Deliberately no connection from the microphone to speakers.
    this.source.connect(this.analyser);
    this.mode = 'mic';
    return stream;
  }
  stopInput() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.source?.disconnect();
    this.source = null;
    this.demoNodes.forEach((n) => {
      n.stop();
      n.disconnect();
    });
    this.demoNodes = [];
    this.mode = 'off';
  }
  async demo(target) {
    await this.start();
    this.stopInput();
    [3.2, -8.4, 12.1].forEach((deviation, i) => {
      const osc = this.ctx.createOscillator(),
        gain = this.ctx.createGain();
      osc.frequency.value = target * (i + 1) * 2 ** (deviation / 1200);
      gain.gain.value = [0.15, 0.08, 0.05][i];
      osc.connect(gain).connect(this.analyser);
      // The demo is quiet but audible, and independent of reference playback.
      const audible = this.ctx.createGain();
      audible.gain.value = 0.12;
      gain.connect(audible).connect(this.ctx.destination);
      osc.onended = () => {
        gain.disconnect();
        audible.disconnect();
      };
      osc.start();
      this.demoNodes.push(osc);
    });
    this.mode = 'demo';
  }
  read() {
    this.analyser.getFloatFrequencyData(this.spectrum);
    this.analyser.getFloatTimeDomainData(this.wave);
    let square = 0,
      peak = 0;
    for (const x of this.wave) {
      square += x * x;
      peak = Math.max(peak, Math.abs(x));
    }
    return { spectrum: this.spectrum, rms: Math.sqrt(square / this.wave.length), peak };
  }
  async reference(target, ratio = 0) {
    this.stopReference();
    const request = this.playbackRequest;
    await this.start();
    if (request !== this.playbackRequest) return false;
    if (!ratio) {
      if (!this.physicalEngine) this.physicalEngine = new Engine(this.ctx);
      try {
        await this.physicalEngine.start();
      } catch (err) {
        this.physicalEngine = null;
        throw err;
      }
      if (request !== this.playbackRequest) return false;
      if (!this.physicalEngine.inst) this.buildPhysicalInstrument();
      const index = this.physicalEngine.inst.notes.findIndex(
        (n) => Math.abs(n.f0 - target) < 0.001,
      );
      if (index < 0) throw new Error('Select a note from your configured instrument.');
      this.physicalEngine.master.gain.cancelScheduledValues(this.ctx.currentTime);
      this.physicalEngine.master.gain.setValueAtTime(
        Math.pow(this.volume, 1.6) * 1.6,
        this.ctx.currentTime,
      );
      this.physicalPlaying = true;
      // Gentle contact avoids the model's hard-strike pitch bend. Split mode
      // pairs, shell resonance and sympathetic coupling preserve its timbre.
      this.physicalEngine.strike(index, 0.5, 0.15, 1);
      return true;
    }
    const now = this.ctx.currentTime;
    const modes = [{ ratio, amp: 0.28, decay: 2.2 }];
    modes.forEach((mode) => {
      const osc = this.ctx.createOscillator(),
        gain = this.ctx.createGain();
      osc.frequency.value = target * mode.ratio;
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(mode.amp, now + 0.006);
      gain.gain.exponentialRampToValueAtTime(0.00001, now + mode.decay);
      osc.connect(gain).connect(this.referenceGain);
      osc.start(now);
      osc.stop(now + mode.decay + 0.03);
      osc.onended = () => gain.disconnect();
      this.referenceNodes.push(osc);
    });
    return true;
  }
  stopReference() {
    this.playbackRequest++;
    this.physicalPlaying = false;
    this.physicalEngine?.silence();
    if (this.physicalEngine?.master) {
      this.physicalEngine.master.gain.cancelScheduledValues(this.ctx.currentTime);
      this.physicalEngine.master.gain.setValueAtTime(0, this.ctx.currentTime);
    }
    this.referenceNodes.forEach((n) => {
      try {
        n.stop();
      } catch {}
      n.disconnect();
    });
    this.referenceNodes = [];
  }
  setVolume(value) {
    this.volume = value;
    if (this.referenceGain)
      this.referenceGain.gain.setTargetAtTime(value, this.ctx.currentTime, 0.03);
    if (this.physicalEngine?.master && this.physicalPlaying)
      this.physicalEngine.master.gain.setTargetAtTime(
        Math.pow(value, 1.6) * 1.6,
        this.ctx.currentTime,
        0.03,
      );
  }
}
