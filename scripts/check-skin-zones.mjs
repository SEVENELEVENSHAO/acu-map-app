import fs from 'node:fs/promises';
import path from 'node:path';

const manifest = JSON.parse(await fs.readFile('public/models/manifest.json', 'utf8'));
const expectedChannels = new Set(['LU','LI','ST','SP','HT','SI','BL','KI','PC','TE','GB','LR','CV','GV']);

function readGlbJson(buffer) {
  if (buffer.readUInt32LE(0) !== 0x46546c67 || buffer.readUInt32LE(4) !== 2) throw new Error('Invalid GLB header');
  const jsonLength = buffer.readUInt32LE(12);
  if (buffer.readUInt32LE(16) !== 0x4e4f534a) throw new Error('GLB JSON chunk is missing');
  return JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8').trim());
}

for (const model of manifest.models) {
  if (!model.zonesUrl) throw new Error(`${model.id}: zonesUrl is missing`);
  if (model.zonesSource !== 'computed from registered APK surface paths') throw new Error(`${model.id}: computed zone provenance is missing`);
  const buffer = await fs.readFile(path.join('public', model.zonesUrl));
  if (buffer.length > 3 * 1024 * 1024) throw new Error(`${model.id}: skin zones exceed the 3 MiB asset budget`);
  const gltf = readGlbJson(buffer);
  const nodes = gltf.nodes.filter((node) => node.extras?.layer === 'computed-meridian-skin-zone');
  if (nodes.length !== 26 || gltf.meshes.length !== 26) throw new Error(`${model.id}: expected 26 bilateral/midline skin-zone ribbons`);
  const channels = new Set(nodes.map((node) => node.extras.channel));
  for (const channel of expectedChannels) if (!channels.has(channel)) throw new Error(`${model.id}: missing ${channel} skin zone`);
  for (const node of nodes) {
    if (node.extras.reviewStatus !== 'pending') throw new Error(`${model.id}: ${node.name} must remain pending review`);
    if (node.extras.halfWidth !== 2.4) throw new Error(`${model.id}: ${node.name} has an unexpected half-width`);
    if (node.extras.borderSmoothing !== 3) throw new Error(`${model.id}: ${node.name} is missing smoothed borders`);
  }
  const triangles = gltf.meshes.reduce((total, mesh) => total + mesh.primitives.reduce((meshTotal, primitive) => meshTotal + gltf.accessors[primitive.indices].count / 3, 0), 0);
  if (triangles < 6_000 || triangles > 8_000) throw new Error(`${model.id}: unexpected smooth-ribbon triangle count ${triangles}`);
  console.log(`${model.id}: 26 projected ribbons, 14 channels, ${triangles.toLocaleString()} triangles, ${(buffer.length / 1048576).toFixed(2)} MiB`);
}

console.log('Meridian skin-zone checks passed.');
