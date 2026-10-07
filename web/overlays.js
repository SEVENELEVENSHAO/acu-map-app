import * as THREE from 'three';

const BODY_MAP_COLORS={ST:[246,236,38],SP:[249,123,8],HT:[112,2,169],SI:[146,86,230],BL:[27,76,252],KD:[2,13,179],PC:[169,0,2],TW:[240,1,1],GB:[61,211,14],LR:[28,125,9],LU:[181,195,194],LI:[252,252,252]};
const BODY_MAP_LOOKUP=new Map(Object.entries(BODY_MAP_COLORS).map(([id,color])=>[color.join(','),id]));

// Native spots are half-float clip-space UV contours and triangle strips.
// Paint one atlas per original diffuse texture, retaining the mesh's normal map.
export class Overlays {
 constructor(engine,display){this.engine=engine;this.display=display;this.materials=new Map();this.textures=[];this.lines=[];this.paths=new Map();this.loader=new THREE.TextureLoader();this.bodyBands=new Set();this.bodyMasks=new Map();this.lastKeys=[];}
 clear(){
  for(const [mesh,original] of this.materials){for(const m of [mesh.material].flat())m.dispose();mesh.material=original;}
  this.materials.clear();this.textures.forEach(t=>t.dispose());this.textures=[];
  this.lines.forEach(l=>{l.removeFromParent();l.geometry.dispose();l.material.dispose();});this.lines=[];this.paths.clear();
 }
 async apply(keys){
  this.lastKeys=[...keys];this.clear();const overlays=keys.map(k=>this.display.overlays[k]);
  const targetSpots=new Map();for(const spot of overlays)for(const target of spot.targets){if(!targetSpots.has(target))targetSpots.set(target,[]);targetSpots.get(target).push(spot);}
  const groups=new Map();
  for(const mesh of this.engine.meshes){if(!mesh.visible)continue;const spots=targetSpots.get(mesh.userData.sourceId);if(!spots)continue;
   for(const material of [mesh.material].flat()){if(!material.map)continue;const map=material.map;
    if(!groups.has(map))groups.set(map,{meshes:new Set(),spots:new Set()});const group=groups.get(map);group.meshes.add(mesh);spots.filter(s=>s.kind===4).forEach(s=>group.spots.add(s));
   }
  }
  for(const [original,group] of groups){
   if(!group.spots.size)continue;
   const dermatomes=[...group.spots].some(s=>s.type===5);let texture;
   if(dermatomes){
    const part=[...group.spots].some(s=>s.type===5&&s.name==='Head')?'head':'body';
    texture=await this.loader.loadAsync(`models/Skin_Dermatomes_${this.display.modelId}_${part}.png`);
   }else{
    const canvas=document.createElement('canvas');canvas.width=original.image.width;canvas.height=original.image.height;
    const ctx=canvas.getContext('2d');ctx.drawImage(original.image,0,0);
    for(const spot of group.spots){const paths=[];
     for(const contour of spot.contours){const path=new Path2D(),v=contour.vertices,indices=contour.indices;
      for(let i=2;i<indices.length;i++){const ids=indices.slice(i-2,i+1);if(new Set(ids).size<3)continue;
       if(i%2)ids.reverse();ids.forEach((n,j)=>{const x=(v[n*2]+1)*canvas.width/2,y=(1-v[n*2+1])*canvas.height/2;j?path.lineTo(x,y):path.moveTo(x,y);});path.closePath();
      }
      ctx.fillStyle=`rgba(${spot.color.slice(0,3).join(',')},${spot.color[3]/255})`;ctx.fill(path);paths.push({path,targets:contour.targets});
     }
     for(const mesh of group.meshes){if(!spot.targets.includes(mesh.userData.sourceId))continue;if(!this.paths.has(mesh))this.paths.set(mesh,[]);this.paths.get(mesh).push({spot,paths,ctx});}
    }
    texture=new THREE.CanvasTexture(canvas);
   }
   texture.flipY=false;texture.colorSpace=THREE.SRGBColorSpace;texture.wrapS=original.wrapS;texture.wrapT=original.wrapT;this.textures.push(texture);
   for(const mesh of group.meshes){if(!this.materials.has(mesh)){this.materials.set(mesh,mesh.material);mesh.material=Array.isArray(mesh.material)?mesh.material.map(m=>m.clone()):mesh.material.clone();}
    for(const m of [mesh.material].flat())if(m.map===original){m.map=texture;m.needsUpdate=true;}
   }
  }
  for(const shape of overlays.filter(s=>s.kind===5)){
   if(!shape.targets.some(id=>this.engine.loaded.get(id)?.visible!==false&&this.engine.meshes.some(m=>m.visible&&m.userData.sourceId===id)))continue;
   for(const points of shape.polygons){const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(points,3));const line=new THREE.LineLoop(geometry,new THREE.LineBasicMaterial({color:new THREE.Color(...shape.color.slice(0,3)),depthTest:true}));this.engine.root.add(line);this.lines.push(line);}
  }
  await this.applyBodyMap();
 }
 setBodyBands(bands){this.bodyBands=new Set(bands);}
 reapply(){return this.apply(this.lastKeys);}
 loadBodyMask(key){
  if(!this.bodyMasks.has(key))this.bodyMasks.set(key,new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(Error(`Body map ${key} texture could not load`));image.src=`models/BodyMap_${this.display.modelId}_${key}.png`;}));
  return this.bodyMasks.get(key);
 }
 async applyBodyMap(){
  if(!this.bodyBands.size)return;const groups=[];
  for(const mesh of this.engine.meshes){const record=this.engine.records.get(mesh.userData.sourceId);if(!mesh.visible||!/^Skin\b/i.test(record?.name||''))continue;const part=record.region==='Head'?'head':'body',maskKey=/^Skin \((Hand|Foot|Leg);/i.test(record.name)?String(mesh.userData.sourceId):part;
   for(const [slot,material] of [mesh.material].flat().entries()){if(!material?.map?.image)continue;let group=groups.find(item=>item.map===material.map&&item.maskKey===maskKey);if(!group){group={map:material.map,maskKey,entries:[]};groups.push(group);}group.entries.push({mesh,slot});}
  }
  for(const group of groups){const maskImage=await this.loadBodyMask(group.maskKey),image=group.map.image,width=image.width||image.videoWidth,height=image.height||image.videoHeight;if(!width||!height)continue;
   const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(image,0,0,width,height);const base=context.getImageData(0,0,width,height);
   const maskCanvas=document.createElement('canvas');maskCanvas.width=width;maskCanvas.height=height;const maskContext=maskCanvas.getContext('2d',{willReadFrequently:true});maskContext.imageSmoothingEnabled=false;maskContext.drawImage(maskImage,0,0,width,height);const mask=maskContext.getImageData(0,0,width,height).data,opacity=.76;
   for(let offset=0;offset<mask.length;offset+=4){if(!mask[offset+3])continue;const band=BODY_MAP_LOOKUP.get(`${mask[offset]},${mask[offset+1]},${mask[offset+2]}`);if(!this.bodyBands.has(band))continue;base.data[offset]=Math.round(base.data[offset]*(1-opacity)+mask[offset]*opacity);base.data[offset+1]=Math.round(base.data[offset+1]*(1-opacity)+mask[offset+1]*opacity);base.data[offset+2]=Math.round(base.data[offset+2]*(1-opacity)+mask[offset+2]*opacity);}
   context.putImageData(base,0,0);const texture=new THREE.CanvasTexture(canvas);texture.flipY=false;texture.colorSpace=THREE.SRGBColorSpace;texture.wrapS=group.map.wrapS;texture.wrapT=group.map.wrapT;texture.magFilter=group.map.magFilter;texture.minFilter=group.map.minFilter;texture.offset.copy(group.map.offset);texture.repeat.copy(group.map.repeat);texture.center.copy(group.map.center);texture.rotation=group.map.rotation;this.textures.push(texture);
   for(const {mesh,slot} of group.entries){if(!this.materials.has(mesh)){this.materials.set(mesh,mesh.material);mesh.material=Array.isArray(mesh.material)?mesh.material.map(material=>material.clone()):mesh.material.clone();}const material=[mesh.material].flat()[slot];material.map=texture;material.needsUpdate=true;}
  }
 }
 pick(hit){
  if(!hit?.uv)return null;
  for(const entry of [...(this.paths.get(hit.object)||[])].reverse()){const {ctx,paths,spot}=entry;
   if(paths.some(p=>p.targets.includes(hit.object.userData.sourceId)&&ctx.isPointInPath(p.path,hit.uv.x*ctx.canvas.width,hit.uv.y*ctx.canvas.height)))return spot;
  }return null;
 }
}
