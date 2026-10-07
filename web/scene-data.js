export async function readJson(url){const response=await fetch(url);if(!response.ok)throw Error(`${response.status}: ${url}`);return response.json();}

// Regional exports retain world matrices and share material/texture definitions.
// Merge their indices, allowing one parser to share textures for the full body.
export function mergeRegions(documents){
 const first=documents[0];if(!first)throw Error('No regions available');
 const result={asset:first.asset,scene:0,scenes:[{nodes:[]}],nodes:[],meshes:[],accessors:[],bufferViews:[],buffers:[],materials:first.materials,textures:first.textures,images:first.images,samplers:first.samplers};
 for(const g of documents){
  const meshOffset=result.meshes.length,accessorOffset=result.accessors.length,viewOffset=result.bufferViews.length,bufferOffset=result.buffers.length;
  result.buffers.push(...g.buffers);
  result.bufferViews.push(...g.bufferViews.map(v=>({...v,buffer:v.buffer+bufferOffset})));
  result.accessors.push(...g.accessors.map(a=>({...a,bufferView:a.bufferView+viewOffset})));
  result.meshes.push(...g.meshes.map(m=>({...m,primitives:m.primitives.map(p=>({...p,indices:p.indices+accessorOffset,attributes:Object.fromEntries(Object.entries(p.attributes).map(([key,value])=>[key,value+accessorOffset])),targets:p.targets?.map(target=>Object.fromEntries(Object.entries(target).map(([key,value])=>[key,value+accessorOffset]))) }))})));
  result.nodes.push(...g.nodes.map(n=>({...n,mesh:n.mesh+meshOffset})));
 }
 // Nodes are loaded on demand from the shared parser when their system is shown.
 return result;
}

export function defaultSystems(systems){return Object.fromEntries(systems.map(s=>[s.id,{enabled:s.defaultEnabled,level:s.defaultLayer}]));}

export function activeNodes(systems,state){
 const nodes=new Set();
 for(const system of systems){const value=state[system.id];if(!value?.enabled)continue;const layer=system.layers[value.level];if(!layer?.supported)continue;for(const id of layer.nodeIds)nodes.add(id);}
 return nodes;
}
