import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {mergeRegions,readJson} from './scene-data.js';
import {Overlays} from './overlays.js';
import {DrawingLayer} from './drawing-layer.js';
import {AcupunctureLayer} from './acupuncture-layer.js';

export class ViewerEngine {
 constructor(canvas,onSelect,onContextLost,onDrawingEvent,onAcupunctureEdit=()=>{}){
  this.canvas=canvas;this.onSelect=onSelect;this.records=new Map();this.loaded=new Map();this.meshes=[];this.originalMaterials=new Map();
  this.scene=new THREE.Scene();this.scene.background=new THREE.Color('#111a20');
  this.camera=new THREE.PerspectiveCamera(35,1,.01,2000);
  this.scene.add(new THREE.HemisphereLight(0xffffff,0x667080,2));
  const light=new THREE.DirectionalLight(0xffffff,2.3);light.position.set(40,80,100);this.scene.add(light);
  this.renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});
  this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;
  this.controls=new OrbitControls(this.camera,canvas);this.controls.enableDamping=true;
  this.drawing=new DrawingLayer(this.scene,onDrawingEvent,this.camera);this.drawingPointer=null;
  this.acupuncture=new AcupunctureLayer(this.scene,onSelect,onAcupunctureEdit);this.acupuncturePointer=null;
  new ResizeObserver(()=>this.updateViewport()).observe(canvas);
  this.clock=new THREE.Clock();this.heartMotion=true;this.heartTime=0;
  this.renderer.setAnimationLoop(()=>{const delta=this.clock.getDelta();if(!document.hidden){if(this.heartMotion)this.updateHeart(delta);this.controls.update();this.renderer.render(this.scene,this.camera);}});
  const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2(),active=new Set();let down,multi=false;
  const pick=(e,skinOnly=false,includeControls=false)=>{const r=canvas.getBoundingClientRect();pointer.set((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);raycaster.setFromCamera(pointer,this.camera);const targets=this.meshes.filter(o=>o.visible&&(!skinOnly||this.drawing.skinIds.has(o.userData.sourceId)));if(includeControls)targets.unshift(...this.drawing.controlObjects());return raycaster.intersectObjects(targets,false)[0]||null;};
  const stylus=e=>this.drawing.enabled&&e.pointerType==='pen';
  canvas.addEventListener('pointerdown',e=>{if(stylus(e)){e.preventDefault();e.stopImmediatePropagation();if(e.button!==0||this.drawingPointer!==null)return;this.drawingPointer=e.pointerId;try{canvas.setPointerCapture?.(e.pointerId);}catch{}this.drawing.start(pick(e,true,true));return;}if(e.button===0&&this.acupuncture.editing&&!this.busy){pick(e,true);if(this.acupuncture.beginDrag(raycaster)){e.preventDefault();e.stopImmediatePropagation();this.acupuncturePointer=e.pointerId;this.controls.enabled=false;try{canvas.setPointerCapture?.(e.pointerId);}catch{}return;}}active.add(e.pointerId);if(active.size>1)multi=true;down=[e.clientX,e.clientY];},true);
  canvas.addEventListener('pointermove',e=>{if(this.acupuncturePointer===e.pointerId){e.preventDefault();e.stopImmediatePropagation();const hit=pick(e,true),skins=this.meshes.filter(o=>o.visible&&this.drawing.skinIds.has(o.userData.sourceId));this.acupuncture.dragTo(hit,skins);return;}if(stylus(e)&&this.drawingPointer===e.pointerId){e.preventDefault();e.stopImmediatePropagation();const hit=pick(e,true),planeHit=this.drawing.dragPlaneHit(raycaster.ray);this.drawing.add(this.drawing.prefersPlaneDrag()?planeHit||hit:hit||planeHit);}},true);
  canvas.addEventListener('pointercancel',e=>{if(this.acupuncturePointer===e.pointerId){e.stopImmediatePropagation();this.acupuncture.endDrag(true);this.acupuncturePointer=null;this.controls.enabled=true;return;}if(stylus(e)&&this.drawingPointer===e.pointerId){e.stopImmediatePropagation();this.drawing.cancelActive();this.drawingPointer=null;return;}active.delete(e.pointerId);down=null;if(!active.size)multi=false;},true);
  canvas.addEventListener('pointerup',e=>{if(this.acupuncturePointer===e.pointerId){e.preventDefault();e.stopImmediatePropagation();const hit=pick(e,true),skins=this.meshes.filter(o=>o.visible&&this.drawing.skinIds.has(o.userData.sourceId));this.acupuncture.dragTo(hit,skins);this.acupuncture.endDrag();this.acupuncturePointer=null;this.controls.enabled=true;return;}if(stylus(e)&&this.drawingPointer===e.pointerId){e.preventDefault();e.stopImmediatePropagation();const hit=pick(e,true),planeHit=this.drawing.dragPlaneHit(raycaster.ray);this.drawing.add(this.drawing.prefersPlaneDrag()?planeHit||hit:hit||planeHit);this.drawing.finish();this.drawingPointer=null;return;}active.delete(e.pointerId);const skip=multi;if(!active.size)multi=false;if(this.drawing.enabled||skip||this.busy||!down||Math.hypot(e.clientX-down[0],e.clientY-down[1])>6)return;
   const hit=pick(e),acupoint=this.acupuncture.pick(raycaster);if(acupoint){this.select(null);this.onSelect(acupoint);return;}if(this.acupuncture.showPoints){this.select(null);return;}this.select(hit?hit.object.userData.sourceId:null);const overlay=this.overlays?.pick(hit);if(overlay)this.onSelect({...this.records.get(hit.object.userData.sourceId),name:overlay.name,cid:overlay.cid,overlay:true});
  },true);
  canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();onContextLost();});
 }
 updateViewport(){
  const rect=this.canvas.getBoundingClientRect(),width=rect.width,height=rect.height;if(!width||!height)return;
  this.renderer.setSize(width,height,false);this.camera.aspect=width/height;
  const dock=document.getElementById('systems')?.getBoundingClientRect(),rightInset=dock?.width>0&&dock?.height>0?Math.max(0,rect.right-dock.left):0,drawerElement=document.getElementById('selection-drawer'),drawer=drawerElement?.classList.contains('is-open')?drawerElement.getBoundingClientRect():null,leftInset=drawer?.height>rect.height*.7?drawer.width:0,offsetX=(rightInset-leftInset)/2;
  if(offsetX!==0)this.camera.setViewOffset(width,height,offsetX,0,width,height);else{this.camera.clearViewOffset();this.camera.updateProjectionMatrix();}
 }
 release(){
  this.select(null);
  this.stopDrawing();this.drawing.clear();this.drawing.clearTargets();
  this.cardiacAnimation=null;this.heartTime=0;
  this.overlays?.clear();this.overlays=null;
  if(this.root){const geometries=new Set(),materials=new Set(),textures=new Set();this.root.traverse(o=>{if(o.geometry)geometries.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:o.material?[o.material]:[]){materials.add(m);for(const v of Object.values(m))if(v?.isTexture)textures.add(v);}});
   this.scene.remove(this.root);geometries.forEach(g=>g.dispose());textures.forEach(t=>{t.source?.data?.close?.();t.dispose();});materials.forEach(m=>m.dispose());
  }
  this.root=null;this.parser=null;this.loaded.clear();this.records.clear();this.meshes=[];this.renderer.renderLists.dispose();
 }
 async prepare(model,display,textureLevel){
  this.release();
  const documents=await Promise.all(model.regions.map(r=>readJson(r.url)));
  const doc=mergeRegions(documents);
  const sourceRegion=new Map();documents.forEach((g,i)=>g.nodes.forEach(n=>sourceRegion.set(n.extras.source_node,model.regions[i].name)));
  doc.nodes.forEach((node,index)=>{const id=node.extras.source_node,info=display.nodeInfo[id];
   this.records.set(id,{id,index,cid:info?.cid,name:info?.name||node.name||`Unnamed structure ${id}`,structureId:info?.structureId||node.extras.structure_id,region:sourceRegion.get(id)});
  });
  const manager=new THREE.LoadingManager();if(textureLevel==='balanced')manager.setURLModifier(url=>url.replace('/textures/','/textures-balanced/'));
  const gltf=await new GLTFLoader(manager).parseAsync(JSON.stringify(doc),new URL('models/',document.baseURI).href);
  this.parser=gltf.parser;this.root=gltf.scene;this.scene.add(this.root);this.cardiacAnimation=model.cardiacAnimation||null;
  const integumentary=display.systems.find(system=>system.name==='Integumentary'),skinIds=new Set((integumentary?.layers||[]).flatMap(layer=>layer.nodeIds).filter(id=>/^Skin\b/i.test(this.records.get(id)?.name||'')));this.drawing.setSkinIds(skinIds);
  this.overlays=new Overlays(this,display);
  this.acupuncture.setModel(model.id);
 }
 loadAcupuncture(url,registrationUrl){return this.acupuncture.load(url,registrationUrl);}
 setAcupuncture(state){this.acupuncture.setState(state);}
 setAcupunctureEditing(value){this.acupuncture.setEditing(value);}
 setAcupunctureCalibration(value){this.acupuncture.setCalibration(value);}
 exportAcupunctureCalibration(){return this.acupuncture.exportCalibration();}
 markAcupunctureSaved(){this.acupuncture.markSaved();}
 undoAcupuncture(){return this.acupuncture.undo();}
 resetSelectedAcupuncture(){return this.acupuncture.resetSelected();}
 resetAcupunctureModel(){return this.acupuncture.resetModel();}
 searchAcupuncture(query,limit){return this.acupuncture.search(query,limit);}
 focusAcupuncture(key){const point=this.acupuncture.selectKey(key);if(!point)return false;const direction=new THREE.Vector3(point.position.x,0,point.position.z);if(direction.lengthSq()<.25)direction.copy(this.camera.position).sub(this.controls.target);if(direction.lengthSq()===0)direction.set(0,0,1);direction.normalize();this.controls.target.copy(point.position);this.camera.position.copy(point.position).addScaledVector(direction,8);this.camera.near=.01;this.camera.far=1000;this.updateViewport();this.controls.update();return true;}
 setHeartMotion(enabled){this.heartMotion=enabled;if(enabled)this.clock.getDelta();}
 updateHeart(delta){const animation=this.cardiacAnimation;if(!animation)return;this.heartTime=(this.heartTime+delta)%animation.playbackDuration;const position=this.heartTime/animation.playbackDuration*(animation.frames-1),a=Math.floor(position),b=(a+1)%animation.frames,mix=position-a,count=animation.weightsPerFrame;
  for(const mesh of this.meshes){if(!mesh.morphTargetInfluences?.length)continue;for(let i=0;i<count;i++){const from=animation.weights[a*count+i],to=animation.weights[b*count+i];mesh.morphTargetInfluences[i]=THREE.MathUtils.lerp(from,to,mix);}}
 }
 async show(ids,progress){
  if(!this.parser)throw Error('Model library is not ready');
  const missing=[...ids].filter(id=>this.records.has(id)&&!this.loaded.has(id));
  this.busy=true;
  try{
   for(let offset=0;offset<missing.length;offset+=32){
    await Promise.all(missing.slice(offset,offset+32).map(async id=>{
     const record=this.records.get(id),object=await this.parser.getDependency('node',record.index);
     let drawingMeshIndex=0;object.traverse(mesh=>{if(!mesh.isMesh)return;mesh.userData.sourceId=id;mesh.userData.drawingTargetId=`${id}:${drawingMeshIndex++}`;mesh.visible=false;for(const m of Array.isArray(mesh.material)?mesh.material:[mesh.material])m.emissiveIntensity=.08;this.meshes.push(mesh);if(this.drawing.skinIds.has(id))this.drawing.registerTarget(mesh);});
     this.loaded.set(id,object);this.root.add(object);
    }));
    progress(Math.min(offset+32,missing.length),missing.length);
    await new Promise(resolve=>requestAnimationFrame(resolve));
   }
   this.meshes.forEach(mesh=>mesh.visible=ids.has(mesh.userData.sourceId));
   this.root.updateMatrixWorld(true);
   const box=new THREE.Box3();for(const mesh of this.meshes){if(!mesh.visible)continue;mesh.geometry.computeBoundingBox();box.union(mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld));}if(!box.isEmpty())this.drawing.setRadius(Math.max(box.getSize(new THREE.Vector3()).length()*.0013,.0005));
  }finally{this.busy=false;}
 }
 startDrawing(){this.select(null);this.controls.enabled=true;this.drawing.begin();}
 stopDrawing(){if(!this.drawing)return;this.drawing.end();this.controls.enabled=true;this.drawingPointer=null;}
 setDrawingBrushScale(scale){this.drawing.setBrushScale(scale);}
 setDrawingColor(color){this.drawing.setColor(color);}
 setDrawingMode(mode){this.drawing.setMode(mode);}
 setDrawingBand(id,name,color){this.drawing.setBand(id,name,color);}
 setDrawingLayerVisible(id,visible){this.drawing.setLayerVisible(id,visible);}
 drawingLayerStats(){return this.drawing.layerStats();}
 resizeSelectedSurface(factor){return this.drawing.resizeSelected(factor);}
 deleteSelectedSurface(){return this.drawing.deleteSelected();}
 deleteSelectedSurfaceVertex(){return this.drawing.deleteSelectedVertex();}
 toggleSelectedSurfaceCurve(){return this.drawing.toggleSelectedCurve();}
 setSurfaceTool(tool){return this.drawing.setSurfaceTool(tool);}
 surfaceEditState(){return this.drawing.editState();}
 hasSelectedSurface(){return Boolean(this.drawing.selectedSurface);}
 setBodyMapBands(bands){this.overlays?.setBodyBands(bands);}
 refreshBodyMap(){return this.overlays?.reapply();}
 undoDrawing(){this.drawing.undo();}
 clearDrawing(){this.drawing.clear();}
 loadDrawing(strokes){this.drawing.load(strokes);}
 exportDrawing(){return this.drawing.export();}
 hasDrawing(){return this.drawing.hasDrawing();}
 select(id){
  for(const [mesh,original] of this.originalMaterials){for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material])material.dispose();mesh.material=original;}this.originalMaterials.clear();
  this.selected=id;
  this.loaded.get(id)?.traverse(mesh=>{if(!mesh.isMesh)return;this.originalMaterials.set(mesh,mesh.material);
   const highlight=original=>{const m=original.clone();m.emissive.set('#61b69b');m.emissiveIntensity=.45;return m;};mesh.material=Array.isArray(mesh.material)?mesh.material.map(highlight):highlight(mesh.material);
  });
  this.onSelect(id===null?null:this.records.get(id));
 }
 fit(direction){
  if(!this.root)return;const box=new THREE.Box3();this.root.updateMatrixWorld(true);
  for(const mesh of this.meshes){if(!mesh.visible)continue;mesh.geometry.computeBoundingBox();box.union(mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld));}
  if(box.isEmpty())return;
  const center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3());
  const distance=Math.max(size.y,size.x/this.camera.aspect,size.z)*.65/Math.tan(THREE.MathUtils.degToRad(this.camera.fov/2));
  const offset=direction?new THREE.Vector3(...direction):this.camera.position.clone().sub(this.controls.target).normalize();
  if(offset.lengthSq()===0)offset.set(0,0,1);
  this.camera.position.copy(center).addScaledVector(offset,Math.max(distance,1));this.controls.target.copy(center);this.camera.near=Math.max(distance/1000,.001);this.camera.far=Math.max(distance*30,1000);this.updateViewport();this.controls.update();
 }
}
