import * as THREE from 'three';

const DEFAULT_COLOR='#ff6b62';
const MASK_SIZE=512;
const clamp=value=>Math.max(0,Math.min(1,value));
const vector=value=>new THREE.Vector3(...value);
const zeroHandles=count=>Array.from({length:count},()=>[0,0]);

export class DrawingLayer {
 constructor(scene,onChange,camera){
  this.scene=scene;
  this.onChange=onChange;
  this.camera=camera;
  this.root=new THREE.Group();
  this.root.name='Saved drawings';
  this.handleRoot=new THREE.Group();
  this.handleRoot.name='Surface controls';
  this.root.add(this.handleRoot);
  this.scene.add(this.root);
  this.skinIds=new Set();
  this.targets=new Map();
  this.strokes=[];
  this.objects=[];
  this.surfaces=[];
  this.surfaceRenders=new Map();
  this.layerVisibility=new Map();
  this.selectedSurface=null;
  this.selectedVertex=null;
  this.surfaceTool='surface';
  this.active=null;
  this.enabled=false;
  this.baseRadius=.01;
  this.brushScale=1;
  this.radius=.01;
  this.color=DEFAULT_COLOR;
  this.mode='drawing';
  this.band=null;
 }

 setSkinIds(ids){this.skinIds=new Set(ids);}
 registerTarget(mesh){
  const id=mesh?.userData?.drawingTargetId;
  if(!id)return;
  this.targets.set(id,mesh);
  for(const [surface,render] of this.surfaceRenders)this.addTargetOverlay(surface,render,mesh);
 }
 clearTargets(){this.targets.clear();}
 setRadius(radius){if(Number.isFinite(radius)&&radius>0){this.baseRadius=radius;this.radius=radius*this.brushScale;this.updateHandles();}}
 setBrushScale(scale){if(Number.isFinite(scale)&&scale>0){this.brushScale=scale;this.radius=this.baseRadius*scale;}}
 setColor(color){if(/^#[0-9a-f]{6}$/i.test(color))this.color=color;}
 setMode(mode){this.mode=mode==='colour-mesh'?'colour-mesh':'drawing';this.selectedSurface=null;this.selectedVertex=null;this.surfaceTool='surface';this.updateHandles();}
 setBand(id,name,color){if(!id)return;this.band={id,name:name||id,color};this.setColor(color);this.setLayerVisible(id,true);}
 setLayerVisible(id,visible){
  this.layerVisibility.set(id,Boolean(visible));
  for(const [surface,render] of this.surfaceRenders)if(surface.bandId===id)for(const overlay of render.overlays.values())overlay.visible=Boolean(visible);
 }
 setSurfaceTool(tool){this.surfaceTool=tool==='add-vertex'?'add-vertex':'surface';this.change();}
 layerStats(){const counts={};for(const surface of this.surfaces)counts[surface.bandId]=(counts[surface.bandId]||0)+1;return counts;}
 editState(){
  const surface=this.selectedSurface,index=this.selectedVertex,curved=Boolean(surface&&index!==null&&(this.handleLength(surface.handlesIn[index])>0||this.handleLength(surface.handlesOut[index])>0));
  return {selectedSurface:Boolean(surface),selectedVertex:index!==null,vertexCount:surface?.vertices.length||0,surfaceTool:this.surfaceTool,curvedVertex:curved};
 }
 change(){this.updateHandles();this.onChange?.({type:'changed',strokeCount:this.mode==='colour-mesh'?this.surfaces.length:this.strokes.length,layerStats:this.layerStats(),...this.editState()});}
 begin(){this.enabled=true;this.updateHandles();this.onChange?.({type:'mode',enabled:true});}
 end(){this.enabled=false;this.cancelActive();this.updateHandles();this.onChange?.({type:'mode',enabled:false});}
 hasDrawing(){return this.mode==='colour-mesh'?this.surfaces.length>0:this.strokes.some(stroke=>stroke.points.length>1);}

 start(hit){
  if(this.mode==='colour-mesh'&&hit?.object?.userData?.surfaceControl)return this.startControl(hit.object.userData);
  if(!hit||!this.skinIds.has(hit.object.userData.sourceId)){this.onChange?.({type:'miss'});return false;}
  if(this.mode==='colour-mesh')return this.startSurface(hit);
  this.active={points:[],color:this.color,radius:this.radius,kind:'drawing',object:null};
  this.strokes.push(this.active);this.objects.push(null);this.add(hit,true);return true;
 }
 startControl(control){this.selectedSurface=control.surface;this.selectedVertex=control.index;this.active={kind:control.side==='vertex'?'move-vertex':'move-handle',surface:control.surface,index:control.index,side:control.side};this.change();return true;}
 controlObjects(){return this.handleRoot.children.filter(object=>object.isMesh&&object.userData.surfaceControl);}
 prefersPlaneDrag(){return this.active?.kind==='move-handle';}
 dragPlaneHit(ray){const surface=this.active?.surface;if(!surface||!['move-vertex','move-handle'].includes(this.active.kind))return null;const plane=new THREE.Plane().setFromNormalAndCoplanarPoint(vector(surface.frame.normal),vector(surface.frame.origin)),point=new THREE.Vector3();if(!ray.intersectPlane(plane,point))return null;return {point,object:{userData:{sourceId:surface.sourceIds[0]}}};}
 startSurface(hit){
  if(!this.band){this.onChange?.({type:'miss',reason:'band'});return false;}
  if(this.surfaceTool==='add-vertex'){
   if(!this.selectedSurface){this.onChange?.({type:'miss',reason:'surface'});return false;}
   this.addVertexAt(this.selectedSurface,hit);this.surfaceTool='surface';this.active={kind:'vertex-added'};this.change();return true;
  }
  let existing=null,preferredControl=null;
  if(this.selectedSurface?.bandId===this.band.id){const projected=this.project(this.selectedSurface,hit.point),control=this.nearestControl(this.selectedSurface,projected);if(control.distance<=this.controlTolerance(this.selectedSurface)){existing=this.selectedSurface;preferredControl=control;}}
  existing=existing||[...this.surfaces].reverse().find(surface=>surface.bandId===this.band.id&&this.containsWorld(surface,hit.point));
  if(existing){
   this.selectedSurface=existing;
   const projected=this.project(existing,hit.point),control=preferredControl||this.nearestControl(existing,projected);
   if(control.distance<=this.controlTolerance(existing)){
    this.selectedVertex=control.index;
    this.active={kind:control.side==='vertex'?'move-vertex':'move-handle',surface:existing,index:control.index,side:control.side};
   }else{
    this.selectedVertex=null;
    this.active={kind:'move-surface',surface:existing,start:projected.slice(0,2),vertices:existing.vertices.map(item=>[...item])};
   }
  }else{
   const frame=this.frameAt(hit.point),surface={
    type:'surface-polygon',id:globalThis.crypto?.randomUUID?.()||`surface-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    kind:'colour-mesh',bandId:this.band.id,bandName:this.band.name,color:this.band.color,frame,
    vertices:[[0,0,0],[0,0,0],[0,0,0],[0,0,0]],handlesIn:zeroHandles(4),handlesOut:zeroHandles(4),
    sourceIds:[hit.object.userData.sourceId],targetIds:[hit.object.userData.drawingTargetId]
   };
   this.surfaces.push(surface);this.selectedSurface=surface;this.selectedVertex=2;this.active={kind:'create-surface',surface};this.renderSurface(surface);
  }
  this.change();return true;
 }
 add(hit,force=false){
  if(this.mode==='colour-mesh')return this.addSurface(hit);
  if(!this.active||!hit||!this.skinIds.has(hit.object.userData.sourceId))return false;
  const radius=this.active.radius||this.radius;
  const normal=hit.face?.normal.clone().transformDirection(hit.object.matrixWorld)||new THREE.Vector3(0,0,1);
  const point=hit.point.clone().addScaledVector(normal,radius*1.8),last=this.active.points.at(-1);
  if(!force&&last&&last.distanceTo(point)<radius*1.4)return false;
  if(this.active.points.length>=320)return false;
  this.active.points.push(point);this.rebuild(this.strokes.length-1);this.change();return true;
 }
 addSurface(hit){
  if(!this.active||!hit?.point||!this.skinIds.has(hit.object.userData.sourceId)||this.active.kind==='vertex-added')return false;
  const surface=this.active.surface,point=this.project(surface,hit.point);
  this.rememberTarget(surface,hit);
  if(this.active.kind==='move-vertex')surface.vertices[this.active.index]=point;
  else if(this.active.kind==='move-handle')this.moveHandle(surface,this.active.index,this.active.side,point);
  else if(this.active.kind==='move-surface'){
   const dx=point[0]-this.active.start[0],dy=point[1]-this.active.start[1];
   surface.vertices=this.active.vertices.map(vertex=>[vertex[0]+dx,vertex[1]+dy,vertex[2]]);
  }else{
   const [x,y,z]=point;
   surface.vertices=[[0,0,0],[x,0,z/2],[x,y,z],[0,y,z/2]];
  }
  this.renderSurface(surface);this.change();return true;
 }
 finish(){
  if(!this.active)return;
  if(this.mode==='colour-mesh'){
   const surface=this.active.surface;
   if(this.active.kind==='create-surface'&&surface){
    const bounds=this.surfaceBounds(surface);
    if(bounds.width<this.baseRadius*3||bounds.height<this.baseRadius*3){const size=this.baseRadius*10*this.brushScale;surface.vertices=[[-size,-size,0],[size,-size,0],[size,size,0],[-size,size,0]];}
    this.renderSurface(surface);
   }
   this.active=null;this.change();return;
  }
  if(this.active.points.length<2)this.removeStroke(this.strokes.length-1);
  this.active=null;this.change();
 }
 cancelActive(){
  if(!this.active)return;
  if(this.mode==='colour-mesh'&&this.active.kind==='create-surface'){
   const surface=this.active.surface,index=this.surfaces.indexOf(surface);if(index>=0)this.surfaces.splice(index,1);this.disposeSurface(surface);this.selectedSurface=null;this.selectedVertex=null;
  }else if(this.mode!=='colour-mesh')this.removeStroke(this.strokes.length-1);
  this.active=null;this.change();
 }
 undo(){
  this.cancelActive();
  if(this.mode==='colour-mesh'){const surface=this.surfaces.pop();if(surface){this.disposeSurface(surface);if(this.selectedSurface===surface){this.selectedSurface=null;this.selectedVertex=null;}}}
  else if(this.strokes.length)this.removeStroke(this.strokes.length-1);
  this.change();
 }

 frameAt(point){
  this.camera.updateMatrixWorld(true);
  return {origin:point.toArray(),axisX:new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld,0).normalize().toArray(),axisY:new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld,1).normalize().toArray(),normal:new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld,2).normalize().toArray()};
 }
 project(surface,point){const delta=point.clone().sub(vector(surface.frame.origin));return [delta.dot(vector(surface.frame.axisX)),delta.dot(vector(surface.frame.axisY)),delta.dot(vector(surface.frame.normal))];}
 unproject(surface,point){return vector(surface.frame.origin).addScaledVector(vector(surface.frame.axisX),point[0]).addScaledVector(vector(surface.frame.axisY),point[1]).addScaledVector(vector(surface.frame.normal),point[2]||0);}
 rememberTarget(surface,hit){
  const source=hit.object.userData.sourceId,target=hit.object.userData.drawingTargetId;
  if(source&&!surface.sourceIds.includes(source))surface.sourceIds.push(source);
  if(target&&!surface.targetIds.includes(target))surface.targetIds.push(target);
 }
 handleLength(handle){return Math.hypot(handle?.[0]||0,handle?.[1]||0);}
 controlPoint(surface,index,side){const vertex=surface.vertices[index],handle=side==='in'?surface.handlesIn[index]:surface.handlesOut[index];return [vertex[0]+handle[0],vertex[1]+handle[1],vertex[2]];}
 nearestControl(surface,point){
  let best={index:0,side:'vertex',distance:Infinity};
  surface.vertices.forEach((vertex,index)=>{
   for(const side of ['in','out'])if(this.handleLength(side==='in'?surface.handlesIn[index]:surface.handlesOut[index])>0){const control=this.controlPoint(surface,index,side),distance=Math.hypot(control[0]-point[0],control[1]-point[1]);if(distance<best.distance)best={index,side,distance};}
   const distance=Math.hypot(vertex[0]-point[0],vertex[1]-point[1]);if(distance<best.distance)best={index,side:'vertex',distance};
  });
  return best;
 }
 controlTolerance(surface){const bounds=this.surfaceBounds(surface);return Math.max(this.baseRadius*13,Math.hypot(bounds.width,bounds.height)*.065);}
 moveHandle(surface,index,side,point){
  const vertex=surface.vertices[index],handle=[point[0]-vertex[0],point[1]-vertex[1]],opposite=side==='in'?'out':'in';
  if(side==='in')surface.handlesIn[index]=handle;else surface.handlesOut[index]=handle;
  const oppositeHandle=opposite==='in'?surface.handlesIn[index]:surface.handlesOut[index];
  const oppositeLength=this.handleLength(oppositeHandle),length=this.handleLength(handle);
  if(oppositeLength>0&&length>0){const mirrored=[-handle[0]/length*oppositeLength,-handle[1]/length*oppositeLength];if(opposite==='in')surface.handlesIn[index]=mirrored;else surface.handlesOut[index]=mirrored;}
 }
 toggleSelectedCurve(){
  const surface=this.selectedSurface,index=this.selectedVertex;if(!surface||index===null)return false;
  const curved=this.handleLength(surface.handlesIn[index])>0||this.handleLength(surface.handlesOut[index])>0;
  if(curved){surface.handlesIn[index]=[0,0];surface.handlesOut[index]=[0,0];}
  else{
   const count=surface.vertices.length,previous=surface.vertices[(index-1+count)%count],vertex=surface.vertices[index],next=surface.vertices[(index+1)%count],dx=next[0]-previous[0],dy=next[1]-previous[1],length=Math.hypot(dx,dy)||1,unit=[dx/length,dy/length],before=Math.hypot(vertex[0]-previous[0],vertex[1]-previous[1])/3,after=Math.hypot(next[0]-vertex[0],next[1]-vertex[1])/3;
   surface.handlesIn[index]=[-unit[0]*before,-unit[1]*before];surface.handlesOut[index]=[unit[0]*after,unit[1]*after];
  }
  this.renderSurface(surface);this.change();return true;
 }
 addVertexAt(surface,hit){
  const point=this.project(surface,hit.point),vertices=surface.vertices;let insertAt=vertices.length,best=Infinity;
  for(let i=0;i<vertices.length;i++){const distance=this.segmentDistance(point,vertices[i],vertices[(i+1)%vertices.length]);if(distance<best){best=distance;insertAt=i+1;}}
  vertices.splice(insertAt,0,point);surface.handlesIn.splice(insertAt,0,[0,0]);surface.handlesOut.splice(insertAt,0,[0,0]);this.selectedVertex=insertAt;this.rememberTarget(surface,hit);this.renderSurface(surface);
 }
 segmentDistance(point,a,b){const dx=b[0]-a[0],dy=b[1]-a[1],length=dx*dx+dy*dy,t=length?clamp(((point[0]-a[0])*dx+(point[1]-a[1])*dy)/length):0;return Math.hypot(point[0]-a[0]-t*dx,point[1]-a[1]-t*dy);}
 deleteSelectedVertex(){
  const surface=this.selectedSurface,index=this.selectedVertex;if(!surface||index===null||surface.vertices.length<=3)return false;
  surface.vertices.splice(index,1);surface.handlesIn.splice(index,1);surface.handlesOut.splice(index,1);this.selectedVertex=Math.min(index,surface.vertices.length-1);this.renderSurface(surface);this.change();return true;
 }
 resizeSelected(factor){
  const surface=this.selectedSurface;if(!surface)return false;
  const center=surface.vertices.reduce((sum,item)=>[sum[0]+item[0],sum[1]+item[1]],[0,0]).map(value=>value/surface.vertices.length);
  surface.vertices=surface.vertices.map(item=>[center[0]+(item[0]-center[0])*factor,center[1]+(item[1]-center[1])*factor,item[2]]);
  surface.handlesIn=surface.handlesIn.map(item=>item.map(value=>value*factor));surface.handlesOut=surface.handlesOut.map(item=>item.map(value=>value*factor));this.renderSurface(surface);this.change();return true;
 }
 deleteSelected(){const surface=this.selectedSurface,index=this.surfaces.indexOf(surface);if(index<0)return false;this.surfaces.splice(index,1);this.disposeSurface(surface);this.selectedSurface=null;this.selectedVertex=null;this.surfaceTool='surface';this.change();return true;}

 cubic(a,b,c,d,t){const mt=1-t;return mt*mt*mt*a+3*mt*mt*t*b+3*mt*t*t*c+t*t*t*d;}
 outlinePoints(surface,steps=12){
  const points=[],count=surface.vertices.length;
  for(let i=0;i<count;i++){
   const next=(i+1)%count,a=surface.vertices[i],d=surface.vertices[next],out=surface.handlesOut[i],inside=surface.handlesIn[next],b=[a[0]+out[0],a[1]+out[1]],c=[d[0]+inside[0],d[1]+inside[1]];
   for(let step=0;step<steps;step++){const t=step/steps;points.push([this.cubic(a[0],b[0],c[0],d[0],t),this.cubic(a[1],b[1],c[1],d[1],t)]);}
  }
  return points;
 }
 pointInPolygon(point,vertices){let inside=false;for(let i=0,j=vertices.length-1;i<vertices.length;j=i++){const a=vertices[i],b=vertices[j],cross=(a[1]>point[1])!==(b[1]>point[1])&&point[0]<(b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1]||1e-9)+a[0];if(cross)inside=!inside;}return inside;}
 containsWorld(surface,point){const projected=this.project(surface,point);return Math.abs(projected[2])<=this.surfaceDepth(surface)&&this.pointInPolygon(projected,this.outlinePoints(surface));}
 surfaceBounds(surface){const outline=this.outlinePoints(surface),xs=outline.map(item=>item[0]),ys=outline.map(item=>item[1]),minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);return {minX,maxX,minY,maxY,width:Math.max(maxX-minX,this.baseRadius),height:Math.max(maxY-minY,this.baseRadius)};}
 surfaceDepth(surface){return Math.max(this.baseRadius*24,...surface.vertices.map(item=>Math.abs(item[2]||0)+this.baseRadius*12));}

 createSurfaceMaterial(surface,texture){
  return new THREE.ShaderMaterial({transparent:true,depthTest:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-4,polygonOffsetUnits:-4,side:THREE.DoubleSide,toneMapped:false,
   uniforms:{uMask:{value:texture},uColor:{value:new THREE.Color(surface.color)},uOrigin:{value:vector(surface.frame.origin)},uAxisX:{value:vector(surface.frame.axisX)},uAxisY:{value:vector(surface.frame.axisY)},uNormal:{value:vector(surface.frame.normal)},uBounds:{value:new THREE.Vector4()},uDepth:{value:this.surfaceDepth(surface)}},
   vertexShader:`varying vec3 vWorldPosition;
void main(){
 vec4 worldPosition=modelMatrix*vec4(position,1.0);
 vWorldPosition=worldPosition.xyz;
 gl_Position=projectionMatrix*viewMatrix*worldPosition;
}`,
   fragmentShader:`uniform sampler2D uMask;
uniform vec3 uColor,uOrigin,uAxisX,uAxisY,uNormal;
uniform vec4 uBounds;
uniform float uDepth;
varying vec3 vWorldPosition;
void main(){
 vec3 delta=vWorldPosition-uOrigin;
 if(abs(dot(delta,uNormal))>uDepth)discard;
 vec2 plane=vec2(dot(delta,uAxisX),dot(delta,uAxisY));
 vec2 uv=(plane-uBounds.xy)/uBounds.zw;
 if(uv.x<0.0||uv.x>1.0||uv.y<0.0||uv.y>1.0)discard;
 float alpha=texture2D(uMask,vec2(uv.x,1.0-uv.y)).a;
 if(alpha<0.02)discard;
 gl_FragColor=vec4(uColor,alpha*0.94);
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
}`});
 }
 ensureSurfaceRender(surface){
  if(this.surfaceRenders.has(surface))return this.surfaceRenders.get(surface);
  const canvas=document.createElement('canvas');canvas.width=canvas.height=MASK_SIZE;
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.flipY=false;texture.minFilter=THREE.LinearFilter;texture.magFilter=THREE.LinearFilter;texture.generateMipmaps=false;
  const render={canvas,context:canvas.getContext('2d'),texture,material:null,overlays:new Map()};render.material=this.createSurfaceMaterial(surface,texture);this.surfaceRenders.set(surface,render);
  for(const target of this.targets.values())this.addTargetOverlay(surface,render,target);
  return render;
 }
 addTargetOverlay(surface,render,target){
  const id=target.userData.drawingTargetId;if(render.overlays.has(id))return;
  const overlay=new THREE.Mesh(target.geometry,render.material);overlay.name=`Skin display polygon · ${surface.bandId}`;overlay.renderOrder=21;overlay.visible=this.layerVisibility.get(surface.bandId)!==false;overlay.userData={bandId:surface.bandId,displayLayer:true};overlay.raycast=()=>{};target.add(overlay);render.overlays.set(id,overlay);
 }
 renderSurface(surface){
  const render=this.ensureSurfaceRender(surface),bounds=this.surfaceBounds(surface),padding=Math.max(this.baseRadius*2,Math.max(bounds.width,bounds.height)*.06),minX=bounds.minX-padding,minY=bounds.minY-padding,width=bounds.width+padding*2,height=bounds.height+padding*2,{context,canvas}=render;
  context.clearRect(0,0,canvas.width,canvas.height);context.fillStyle='#fff';context.beginPath();
  const first=surface.vertices[0];context.moveTo((first[0]-minX)/width*canvas.width,(1-(first[1]-minY)/height)*canvas.height);
  for(let i=0;i<surface.vertices.length;i++){
   const next=(i+1)%surface.vertices.length,a=surface.vertices[i],b=surface.vertices[next],out=surface.handlesOut[i],inside=surface.handlesIn[next];
   context.bezierCurveTo((a[0]+out[0]-minX)/width*canvas.width,(1-(a[1]+out[1]-minY)/height)*canvas.height,(b[0]+inside[0]-minX)/width*canvas.width,(1-(b[1]+inside[1]-minY)/height)*canvas.height,(b[0]-minX)/width*canvas.width,(1-(b[1]-minY)/height)*canvas.height);
  }
  context.closePath();context.fill();render.texture.needsUpdate=true;
  const uniforms=render.material.uniforms;uniforms.uColor.value.set(surface.color);uniforms.uOrigin.value.fromArray(surface.frame.origin);uniforms.uAxisX.value.fromArray(surface.frame.axisX);uniforms.uAxisY.value.fromArray(surface.frame.axisY);uniforms.uNormal.value.fromArray(surface.frame.normal);uniforms.uBounds.value.set(minX,minY,width,height);uniforms.uDepth.value=this.surfaceDepth(surface);
 }
 disposeSurface(surface){const render=this.surfaceRenders.get(surface);if(!render)return;for(const overlay of render.overlays.values())overlay.parent?.remove(overlay);render.material.dispose();render.texture.dispose();this.surfaceRenders.delete(surface);}

 clearHandles(){for(const object of [...this.handleRoot.children]){this.handleRoot.remove(object);object.geometry?.dispose();object.material?.dispose();}}
 updateHandles(){
  this.clearHandles();const surface=this.selectedSurface;if(!this.enabled||this.mode!=='colour-mesh'||!surface)return;
  const radius=this.baseRadius*2.6;
  surface.vertices.forEach((vertex,index)=>{
   const selected=index===this.selectedVertex,anchor=this.unproject(surface,vertex),handle=new THREE.Mesh(new THREE.SphereGeometry(selected?radius*1.3:radius,10,8),new THREE.MeshBasicMaterial({color:selected?'#ffffff':surface.color,depthTest:false,toneMapped:false}));handle.position.copy(anchor);handle.renderOrder=42;handle.name=`Anchor ${index+1}`;handle.userData={surfaceControl:true,surface,index,side:'vertex'};this.handleRoot.add(handle);
   if(!selected)return;
   for(const side of ['in','out']){
    const offset=side==='in'?surface.handlesIn[index]:surface.handlesOut[index];if(this.handleLength(offset)<=0)return;
    const point=this.unproject(surface,[vertex[0]+offset[0],vertex[1]+offset[1],vertex[2]]),line=new THREE.Line(new THREE.BufferGeometry().setFromPoints([anchor,point]),new THREE.LineBasicMaterial({color:'#ffffff',depthTest:false,transparent:true,opacity:.8})),dot=new THREE.Mesh(new THREE.SphereGeometry(radius*.72,9,7),new THREE.MeshBasicMaterial({color:'#7ec8df',depthTest:false,toneMapped:false}));line.renderOrder=41;dot.position.copy(point);dot.renderOrder=43;dot.name=`${side} curve handle`;dot.userData={surfaceControl:true,surface,index,side};this.handleRoot.add(line,dot);
   }
  });
 }

 export(){
  if(this.mode==='colour-mesh')return this.surfaces.map(surface=>({...surface,frame:Object.fromEntries(Object.entries(surface.frame).map(([key,value])=>[key,[...value]])),vertices:surface.vertices.map(item=>[...item]),handlesIn:surface.handlesIn.map(item=>[...item]),handlesOut:surface.handlesOut.map(item=>[...item]),sourceIds:[...surface.sourceIds],targetIds:[...surface.targetIds]}));
  return this.strokes.filter(stroke=>stroke.points.length>1).map(stroke=>({color:stroke.color,radius:stroke.radius,kind:'drawing',points:stroke.points.map(point=>point.toArray())}));
 }
 load(items=[]){
  this.clear();const polygons=items.filter(item=>item?.type==='surface-polygon'&&item?.frame&&Array.isArray(item.vertices));
  if(polygons.length){this.mode='colour-mesh';for(const saved of polygons){if(saved.vertices.length<3)continue;const surface={...saved,type:'surface-polygon',kind:'colour-mesh',frame:Object.fromEntries(Object.entries(saved.frame).map(([key,value])=>[key,[...value]])),vertices:saved.vertices.map(item=>item.map(Number)),handlesIn:(saved.handlesIn||zeroHandles(saved.vertices.length)).map(item=>item.map(Number)),handlesOut:(saved.handlesOut||zeroHandles(saved.vertices.length)).map(item=>item.map(Number)),sourceIds:[...(saved.sourceIds||[])],targetIds:[...(saved.targetIds||[])]};this.surfaces.push(surface);this.renderSurface(surface);}this.change();return;}
  const legacy=items.filter(item=>item?.kind==='colour-mesh'&&Array.isArray(item.uv));
  if(legacy.length){this.mode='colour-mesh';for(const saved of legacy){const surface=this.legacySurface(saved);if(surface){this.surfaces.push(surface);this.renderSurface(surface);}}this.change();return;}
  this.mode='drawing';for(const saved of items){const points=(saved.points||[]).filter(point=>Array.isArray(point)&&point.length===3).map(point=>new THREE.Vector3(...point));if(points.length<2)continue;this.strokes.push({color:saved.color||DEFAULT_COLOR,radius:Number(saved.radius)||this.radius,kind:'drawing',points,object:null});this.objects.push(null);this.rebuild(this.strokes.length-1);}this.change();
 }
 legacySurface(saved){
  const target=this.targets.get(saved.targetId),uv=saved.uv;if(!target||uv?.length!==4)return null;
  const corners=[[uv[0],uv[1]],[uv[2],uv[1]],[uv[2],uv[3]],[uv[0],uv[3]]].map(item=>this.uvToWorld(target,item));if(corners.some(item=>!item))return null;
  const frame=this.frameAt(corners[0]),surface={...saved,type:'surface-polygon',frame,vertices:[],handlesIn:zeroHandles(4),handlesOut:zeroHandles(4),sourceIds:[saved.sourceId].filter(Boolean),targetIds:[saved.targetId].filter(Boolean)};surface.vertices=corners.map(point=>this.project(surface,point));delete surface.uv;return surface;
 }
 uvToWorld(target,uv){
  const geometry=target.geometry,positions=geometry.attributes.position,uvs=geometry.attributes.uv,index=geometry.index;if(!positions||!uvs)return null;const count=index?index.count:positions.count;
  for(let i=0;i<count;i+=3){const ia=index?index.getX(i):i,ib=index?index.getX(i+1):i+1,ic=index?index.getX(i+2):i+2,ax=uvs.getX(ia),ay=uvs.getY(ia),bx=uvs.getX(ib),by=uvs.getY(ib),cx=uvs.getX(ic),cy=uvs.getY(ic),den=(by-cy)*(ax-cx)+(cx-bx)*(ay-cy);if(Math.abs(den)<1e-10)continue;const wa=((by-cy)*(uv[0]-cx)+(cx-bx)*(uv[1]-cy))/den,wb=((cy-ay)*(uv[0]-cx)+(ax-cx)*(uv[1]-cy))/den,wc=1-wa-wb;if(wa>=-1e-4&&wb>=-1e-4&&wc>=-1e-4){const point=new THREE.Vector3().fromBufferAttribute(positions,ia).multiplyScalar(wa).addScaledVector(new THREE.Vector3().fromBufferAttribute(positions,ib),wb).addScaledVector(new THREE.Vector3().fromBufferAttribute(positions,ic),wc);return point.applyMatrix4(target.matrixWorld);}}
  return null;
 }

 rebuild(index){const stroke=this.strokes[index];if(!stroke)return;this.disposeObject(this.objects[index]);const radius=stroke.radius||this.radius;let geometry;if(stroke.points.length===1)geometry=new THREE.SphereGeometry(radius,8,6);else{const curve=new THREE.CatmullRomCurve3(stroke.points,false,'centripetal');geometry=new THREE.TubeGeometry(curve,Math.min(640,Math.max(6,(stroke.points.length-1)*3)),radius,6,false);}const material=new THREE.MeshBasicMaterial({color:stroke.color,depthTest:true,depthWrite:false,toneMapped:false}),object=new THREE.Mesh(geometry,material);if(stroke.points.length===1)object.position.copy(stroke.points[0]);object.renderOrder=20;object.name='Drawing stroke';this.root.add(object);this.objects[index]=object;stroke.object=object;}
 removeStroke(index){const [object]=this.objects.splice(index,1);this.disposeObject(object);this.strokes.splice(index,1);}
 disposeObject(object){if(!object)return;object.parent?.remove(object);object.geometry?.dispose();object.material?.dispose();}
 clear(){this.active=null;for(const object of this.objects)this.disposeObject(object);for(const surface of [...this.surfaces])this.disposeSurface(surface);this.clearHandles();this.strokes=[];this.objects=[];this.surfaces=[];this.selectedSurface=null;this.selectedVertex=null;this.surfaceTool='surface';this.change();}
 dispose(){this.clear();this.scene.remove(this.root);}
}
