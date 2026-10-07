import fs from 'node:fs/promises';

const data = JSON.parse(await fs.readFile('public/acupuncture-data.json', 'utf8'));
const surface = JSON.parse(await fs.readFile('public/acupuncture-native-paths.json', 'utf8'));

if (surface.schema !== 'acu-map-native-surface-paths' || surface.version !== 1) {
  throw new Error('Unexpected native surface-path schema.');
}
if (surface.sourceSha256 !== data.source?.sha256) {
  throw new Error('Surface paths do not match the acupuncture source data.');
}

const checks = new Map([
  ['SI8->SI9', 3],
  ['BL52->BL53', 2],
  ['KI10->KI11', 4],
]);

const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
let sampleCount = 0;

for (const [modelName, model] of Object.entries(surface.models)) {
  if (Object.keys(model.paths).length !== 26) {
    throw new Error(`${modelName}: expected 26 channel-side paths.`);
  }

  for (const [pathName, samples] of Object.entries(model.paths)) {
    sampleCount += samples.length;
    for (const sample of samples) {
      if (!Array.isArray(sample.position) || sample.position.length !== 3 || sample.position.some((value) => !Number.isFinite(value))) {
        throw new Error(`${modelName} ${pathName}: invalid position.`);
      }
    }

    if (pathName.startsWith('BL:')) {
      const bl41 = samples.find((sample) => sample.from.startsWith('BL41:'));
      if (!bl41?.breakBefore) throw new Error(`${modelName} ${pathName}: BL41 branch break is missing.`);
      if (samples.some((sample) => sample.from.startsWith('BL40:') && sample.to.startsWith('BL41:'))) {
        throw new Error(`${modelName} ${pathName}: BL40 and BL41 must not be connected.`);
      }
    }

    for (const [segment, limit] of checks) {
      const [from, to] = segment.split('->');
      const points = samples.filter((sample) => sample.from.startsWith(`${from}:`) && sample.to.startsWith(`${to}:`));
      if (!points.length) continue;
      let maxStep = 0;
      for (let index = 1; index < points.length; index += 1) {
        maxStep = Math.max(maxStep, distance(points[index - 1].position, points[index].position));
      }
      if (maxStep > limit) {
        throw new Error(`${modelName} ${pathName} ${segment}: ${maxStep.toFixed(3)} exceeds ${limit}.`);
      }
      console.log(`${modelName} ${pathName} ${segment}: ${points.length} samples, max step ${maxStep.toFixed(3)}`);
    }
  }
}

console.log(`Native surface-path checks passed (${sampleCount} samples).`);
