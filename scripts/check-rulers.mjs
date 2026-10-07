import fs from 'node:fs/promises';
import path from 'node:path';

const manifest = JSON.parse(await fs.readFile('public/models/manifest.json', 'utf8'));
const rules = JSON.parse(await fs.readFile('public/acupuncture-rulers.json', 'utf8'));
const expectedRegions = new Set(['Head', 'Torso', 'Arm', 'Hand', 'Leg']);
const validNamesByModel = new Map();

function readGlbJson(buffer) {
  if (buffer.readUInt32LE(0) !== 0x46546c67 || buffer.readUInt32LE(4) !== 2) throw new Error('Invalid GLB header');
  const jsonLength = buffer.readUInt32LE(12);
  if (buffer.readUInt32LE(16) !== 0x4e4f534a) throw new Error('GLB JSON chunk is missing');
  return JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8').trim());
}

for (const model of manifest.models) {
  if (!model.rulerUrl) throw new Error(`${model.id}: rulerUrl is missing`);
  if (model.rulerSource !== '免费找穴位神器.apk') throw new Error(`${model.id}: ruler provenance is missing`);
  const buffer = await fs.readFile(path.join('public', model.rulerUrl));
  if (buffer.length > 26 * 1024 * 1024) throw new Error(`${model.id}: ruler asset exceeds 26 MiB`);
  const gltf = readGlbJson(buffer);
  const nodes = gltf.nodes.filter((node) => node.extras?.rulerLayer === 'APK reference ruler');
  validNamesByModel.set(model.id, new Set(nodes.map((node) => node.name)));
  if (nodes.length !== 86 || gltf.meshes.length !== 86) throw new Error(`${model.id}: expected 86 native ruler meshes`);
  const regions = new Set(nodes.map((node) => node.extras.region));
  for (const region of expectedRegions) if (!regions.has(region)) throw new Error(`${model.id}: missing ${region} ruler region`);
  for (const node of nodes) {
    if (node.extras.source !== '免费找穴位神器.apk') throw new Error(`${model.id}: ${node.name} has missing source provenance`);
    if (node.extras.reviewStatus !== 'pending') throw new Error(`${model.id}: ${node.name} must remain pending review`);
  }
  const triangles = gltf.meshes.reduce((total, mesh) => total + mesh.primitives.reduce((meshTotal, primitive) => meshTotal + gltf.accessors[primitive.indices].count / 3, 0), 0);
  if (triangles !== 337_630) throw new Error(`${model.id}: unexpected source ruler triangle count ${triangles}`);
  console.log(`${model.id}: 86 native ruler meshes, 5 regions, ${triangles.toLocaleString()} triangles, ${(buffer.length / 1048576).toFixed(2)} MiB`);
}

if (rules.source !== '免费找穴位神器.apk' || rules.reviewStatus !== 'pending') throw new Error('Point ruler rule provenance is missing');
if (rules.sourceRecords !== 1341 || Object.keys(rules.points).length !== 361) throw new Error('Unexpected APK point-ruler rule coverage');
for (const [point, names] of Object.entries(rules.points)) for (const name of names) {
  for (const [model, validNames] of validNamesByModel) if (!validNames.has(name)) throw new Error(`${point}: ${name} is missing from ${model}`);
}
for (const [point, expected] of Object.entries({LI4:3,SI8:4,SI9:2,BL40:7,BL41:7,BL52:6,BL53:6,KI10:3,KI11:3})) {
  if (rules.points[point]?.length !== expected) throw new Error(`${point}: expected ${expected} original ruler references`);
}

console.log('APK proportional-ruler assets and 361 point-specific display rules passed.');
