import fs from 'node:fs/promises';
import path from 'node:path';

const manifest = JSON.parse(await fs.readFile('public/models/manifest.json', 'utf8'));

function readGlbJson(buffer) {
  if (buffer.readUInt32LE(0) !== 0x46546c67 || buffer.readUInt32LE(4) !== 2) throw new Error('Invalid GLB header');
  const jsonLength = buffer.readUInt32LE(12);
  if (buffer.readUInt32LE(16) !== 0x4e4f534a) throw new Error('GLB JSON chunk is missing');
  return JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8').trim());
}

for (const model of manifest.models) {
  if (!model.anatomyUrl) throw new Error(`${model.id}: anatomyUrl is missing`);
  const file = path.join('public', model.anatomyUrl);
  const buffer = await fs.readFile(file);
  if (model.anatomySource !== manifest.source) throw new Error(`${model.id}: cutaway provenance is not the supplied APK`);
  if (buffer.length > 16 * 1024 * 1024) throw new Error(`${model.id}: cutaway exceeds the 16 MiB native asset budget`);

  const gltf = readGlbJson(buffer);
  const anatomyNodes = gltf.nodes.filter((node) =>
    node.extras?.anatomyLayer === 'Native APK cutaway' &&
    node.extras?.source === manifest.source
  );
  const expectedMeshes = model.id === 'Male' ? 8 : 24;
  if (anatomyNodes.length !== expectedMeshes || gltf.meshes.length !== expectedMeshes) {
    throw new Error(`${model.id}: expected ${expectedMeshes} native cutaway meshes`);
  }
  const declaredSystems = new Set(anatomyNodes.flatMap((node) => node.extras.anatomySystems.split(',')));
  if (!declaredSystems.has('skeletal') || !declaredSystems.has('internal-organs')) {
    throw new Error(`${model.id}: cutaway metadata must include bones and internal organs`);
  }

  const materialNames = gltf.materials.map((material) => material.name.toLowerCase());
  if (!materialNames.some((name) => name.startsWith('skel'))) throw new Error(`${model.id}: native bones are missing`);
  if (!materialNames.some((name) => name.startsWith('organ-'))) throw new Error(`${model.id}: native internal organs are missing`);
  if (!materialNames.some((name) => name.startsWith('brain_'))) throw new Error(`${model.id}: native brain anatomy is missing`);

  const triangles = gltf.meshes.reduce((total, mesh) => total + mesh.primitives.reduce((meshTotal, primitive) => {
    const count = gltf.accessors[primitive.indices].count;
    return meshTotal + count / 3;
  }, 0), 0);
  if (triangles < 80_000 || triangles > 90_000) throw new Error(`${model.id}: unexpected triangle count ${triangles}`);
  console.log(`${model.id}: ${expectedMeshes} meshes, ${gltf.materials.length} bone/organ materials, ${Math.round(triangles).toLocaleString()} triangles, ${(buffer.length / 1048576).toFixed(2)} MiB`);
}

console.log('Native cutaway anatomy checks passed.');
