import assert from 'node:assert/strict';
import { detectPitch, centsFrom } from '../src/trainer/pitch.mjs';
for (const sampleRate of [44100, 48000]) {
  for (const frequency of [43.65, 73.42, 146.83, 220, 440, 880, 1046.5, 2093]) {
    for (const harmonic of [0, .6]) {
      const signal = Float32Array.from({length:4096}, (_,i) => .2 * Math.sin(2*Math.PI*frequency*i/sampleRate) + harmonic*.2*Math.sin(4*Math.PI*frequency*i/sampleRate));
      const detected = detectPitch(signal, sampleRate);
      assert.ok(detected && Math.abs(centsFrom(detected, frequency)) < 5, `${frequency} Hz at ${sampleRate}: ${detected}`);
    }
  }
}
assert.equal(detectPitch(new Float32Array(4096),48000),null);
assert.ok(centsFrom(450,440)>0);
assert.ok(centsFrom(430,440)<0);
console.log('Pitch checks passed: 32 sine/harmonic signals, silence, and correction direction.');
