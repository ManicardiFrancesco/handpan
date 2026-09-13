// YIN difference function with a fixed window to avoid long-lag bias.
export function detectPitch(samples, sampleRate) {
  let energy = 0;
  for (const s of samples) energy += s * s;
  if (Math.sqrt(energy / samples.length) < 0.008) return null;
  const max = Math.min(Math.floor(sampleRate / 40), Math.floor(samples.length / 2) - 1);
  const min = Math.max(2, Math.floor(sampleRate / 2400));
  const difference = new Float32Array(max + 1);
  let cumulative = 0;
  for (let lag = 1; lag <= max; lag++) {
    let sum = 0;
    for (let i = 0; i < samples.length - max; i++) {
      const delta = samples[i] - samples[i + lag]; sum += delta * delta;
    }
    cumulative += sum;
    difference[lag] = cumulative ? sum * lag / cumulative : 1;
  }
  for (let lag = min; lag < max; lag++) {
    if (difference[lag] >= 0.15) continue;
    while (lag + 1 < max && difference[lag + 1] < difference[lag]) lag++;
    const a = difference[lag - 1], b = difference[lag], c = difference[lag + 1];
    const denominator = 2 * (2 * b - a - c);
    const offset = denominator ? (c - a) / denominator : 0;
    return sampleRate / (lag + offset);
  }
  return null;
}
export const centsFrom = (frequency, target) => 1200 * Math.log2(frequency / target);
