import {fitCalibration,forward,backward,measure,affineWorldFile} from './math.js';
import {shapefileZip,download,saveText,csvRows,vertexCSV} from './export.js';
const $=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const id=()=>crypto.randomUUID(),number=v=>Number.isFinite(v)?Number(v).toLocaleString('en-US',{maximumFractionDigits:10}):'—';
const colors={point:'#69d6ee',line:'#52e0bb',polygon:'#d3b3ff'};
function fresh(){return {version:1,projectName:'Untitled project',imageName:'',imageData:'',width:0,height:0,controls:[],calibration:null,model:'affine',xAxis:'linear',yAxis:'linear',crs:'cartesian',xUnit:'units',yUnit:'units',layers:[],activeLayerId:null,selectedId:null,tool:'pan',grid:false,view:{scale:1,tx:0,ty:0}};}
let s=fresh(),draft=null,drag=null,space=false,lastCursor=null,db=null,saveTimer=null,history=[],future=[],toastTimer=null,renderQueued=false;
const image=$('raster'),overlay=$('overlay'),viewport=$('viewport');
const validImage=()=>Boolean(s.imageData&&s.width&&s.height);
const activeLayer=()=>s.layers.find(l=>l.id===s.activeLayerId);
const featureById=featureId=>{for(const l of s.layers){const f=l.features.find(f=>f.id===featureId);if(f)return {layer:l,feature:f};}return null;};
const closest=(el,attr)=>el?.closest?.('['+attr+']')?.dataset;
const layerIcon=t=>t==='point'?'●':t==='line'?'〰':'⬡';
const toast=(msg,error=false)=>{const el=$('toast');el.textContent=msg;el.className='show'+(error?' toast-error':'');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.className='',4200);};
function archiveSnapshot(){history.push(JSON.stringify({controls:s.controls,layers:s.layers,calibration:s.calibration,selectedId:s.selectedId,activeLayerId:s.activeLayerId}));if(history.length>80)history.shift();future.length=0;}
function capture(){return JSON.stringify({controls:s.controls,layers:s.layers,calibration:s.calibration,selectedId:s.selectedId,activeLayerId:s.activeLayerId});}
function applySnapshot(serial){const snap=JSON.parse(serial);Object.assign(s,snap);draft=null;render();scheduleSave();}
function undo(){if(!history.length)return;future.push(capture());applySnapshot(history.pop());}
function redo(){if(!future.length)return;history.push(capture());applySnapshot(future.pop());}
const scheduleSave=()=>{clearTimeout(saveTimer);$('saveStatus').textContent='Saving locally…';saveTimer=setTimeout(async()=>{try{await saveToDB();$('saveStatus').textContent='Saved locally';}catch(e){$('saveStatus').textContent='Autosave failed';toast('Local save failed: '+e.message,true);}},500);};
function changed(){queueRender();scheduleSave();}
function queueRender(){if(renderQueued)return;renderQueued=true;requestAnimationFrame(()=>{renderQueued=false;render();});}
function setTool(tool){s.tool=tool;draft=null;document.querySelectorAll('[data-tool]').forEach(b=>b.classList.toggle('active',b.dataset.tool===tool));$('gcpMode').classList.toggle('active',tool==='gcp');viewport.dataset.tool=tool;changed();}
function ensureLayer(type){
 let layer=activeLayer();
 if(layer?.type===type&&!layer.locked)return layer;
 layer=s.layers.find(l=>l.type===type&&!l.locked);
 if(!layer){archiveSnapshot();layer={id:id(),name:type==='point'?'Points':type==='line'?'Polylines':'Polygons',type,color:colors[type],visible:true,locked:false,features:[]};s.layers.push(layer);}
 s.activeLayerId=layer.id;return layer;
}
function addLayer(type=$('newLayerType').value){
 archiveSnapshot();const count=s.layers.filter(l=>l.type===type).length+1;
 const layer={id:id(),type,name:(type==='point'?'Points':type==='line'?'Polylines':'Polygons')+' '+count,color:colors[type],visible:true,locked:false,features:[]};
 s.layers.push(layer);s.activeLayerId=layer.id;changed();return layer;
}
function addFeature(type,pixels){const l=ensureLayer(type);archiveSnapshot();const f={id:id(),name:(type==='point'?'Point':type==='line'?'Line':'Polygon')+' '+(l.features.length+1),pixels,attributes:{}};l.features.push(f);s.selectedId=f.id;changed();}
const localPx=e=>{const r=viewport.getBoundingClientRect();return [(e.clientX-r.left-s.view.tx)/s.view.scale,(e.clientY-r.top-s.view.ty)/s.view.scale];};
const screenPx=([x,y])=>[x*s.view.scale+s.view.tx,y*s.view.scale+s.view.ty];
const inside=([u,v])=>u>=0&&v>=0&&u<=s.width&&v<=s.height;
function snapped(p,excluding=''){
 const r=9/s.view.scale;let best=p,bestDist=r;
 for(const l of s.layers)if(l.visible)for(const f of l.features)if(f.id!==excluding)for(const q of f.pixels){
  const d=Math.hypot(q[0]-p[0],q[1]-p[1]);if(d<bestDist){best=q;bestDist=d;}
 }
 return [...best];
}
function svgCircle(x,y,r,opts=''){return '<circle cx="'+x+'" cy="'+y+'" r="'+r+'" '+opts+'/>';}
function svgMarkup(){
 const sc=s.view.scale,stroke=2.5/sc,parts=[],w=s.width,h=s.height;
 if(s.grid){const step=100;for(let x=0;x<=w;x+=step)parts.push('<line x1="'+x+'" y1="0" x2="'+x+'" y2="'+h+'" stroke="#7799b5" stroke-opacity=".27" stroke-width="'+.8/sc+'"/>');for(let y=0;y<=h;y+=step)parts.push('<line x1="0" y1="'+y+'" x2="'+w+'" y2="'+y+'" stroke="#7799b5" stroke-opacity=".27" stroke-width="'+.8/sc+'"/>');}
 for(const l of s.layers)if(l.visible)for(const f of l.features){
  const p=f.pixels,color=esc(l.color),selected=f.id===s.selectedId;
  if(!p.length)continue;
  const coords=p.map(q=>q.join(',')).join(' '),sel=selected?' opacity="1"':' opacity=".89"';
  if(l.type==='point')parts.push('<circle class="feature-path" data-feature="'+esc(f.id)+'" cx="'+p[0][0]+'" cy="'+p[0][1]+'" r="'+(selected?7:5)/sc+'" fill="'+color+'" stroke="#07141c" stroke-width="'+2/sc+'"'+sel+'/>');
  else if(l.type==='line')parts.push('<polyline class="feature-path" data-feature="'+esc(f.id)+'" points="'+coords+'" fill="none" stroke="'+color+'" stroke-width="'+(selected?stroke+1/sc:stroke)+'" stroke-linecap="round" stroke-linejoin="round" pointer-events="stroke"'+sel+'/>');
  else parts.push('<polygon class="feature-path" data-feature="'+esc(f.id)+'" points="'+coords+'" fill="'+color+'" fill-opacity="'+(selected?.34:.18)+'" stroke="'+color+'" stroke-width="'+stroke+'" stroke-linejoin="round"'+sel+'/>');
  if(selected&&s.tool==='select')p.forEach(([x,y],i)=>parts.push(svgCircle(x,y,5.5/sc,'class="vertex" data-feature="'+esc(f.id)+'" data-vertex="'+i+'" fill="#edfaff" stroke="'+color+'" stroke-width="'+1.6/sc+'"')));
 }
 if(draft?.pixels.length){
  const p=draft.pixels.map(q=>q.join(',')).join(' ');
  parts.push('<polyline class="draft-line" points="'+p+'" stroke-width="'+2.5/sc+'" />');
  draft.pixels.forEach(([x,y])=>parts.push(svgCircle(x,y,4.5/sc,'fill="#ffe39b" stroke="#111d29" stroke-width="'+1.5/sc+'"')));
 }
 if(s.tool==='gcp'||s.controls.length)s.controls.forEach((p,i)=>{
  const x=Number(p.u),y=Number(p.v);
  parts.push('<g data-gcp="'+esc(p.id)+'" opacity="'+(p.enabled===false?.42:1)+'">'+
   '<path class="gcp-symbol" d="M'+(x-9/sc)+','+y+' H'+(x+9/sc)+' M'+x+','+(y-9/sc)+' V'+(y+9/sc)+'" fill="none" stroke-width="'+1.5/sc+'"/>'+
   svgCircle(x,y,3.5/sc,'fill="#ffcd71" stroke="#12202b" stroke-width="'+1.1/sc+'"')+
   '<text class="gcp-text" x="'+(x+7/sc)+'" y="'+(y-8/sc)+'" font-size="'+12/sc+'" style="font-size:'+12/sc+'px">'+(i+1)+'</text></g>');
 });
 return parts.join('');
}
function render(){
 const has=validImage();
 $('welcome').hidden=has;
 image.style.display=has?'block':'none';overlay.style.display=has?'block':'none';
 if(has){
  if(image.src!==s.imageData)image.src=s.imageData;
  image.style.width=overlay.style.width=s.width+'px';
  image.style.height=overlay.style.height=s.height+'px';
  overlay.setAttribute('viewBox','0 0 '+s.width+' '+s.height);
  $('world').style.transform='translate('+s.view.tx+'px,'+s.view.ty+'px) scale('+s.view.scale+')';
  overlay.innerHTML=svgMarkup();
 }
 $('projectName').value=s.projectName;
 $('imageInfo').textContent=has?s.imageName+' · '+s.width+' × '+s.height+' px':'No image imported';
 $('zoomOutput').textContent=Math.round(s.view.scale*100)+'%';
 $('gridButton').setAttribute('aria-pressed',String(s.grid));
 $('gridButton').classList.toggle('active',s.grid);
 document.querySelectorAll('[data-tool]').forEach(b=>b.classList.toggle('active',b.dataset.tool===s.tool));
 $('gcpMode').classList.toggle('active',s.tool==='gcp');
 viewport.dataset.tool=s.tool;
 $('calStatus').className='status-badge '+(s.calibration?'valid':'waiting');
 $('calStatus').textContent=s.calibration?'Calibrated':'Uncalibrated';
 const report=$('calReport');
 report.className='cal-report'+(s.calibration?.warn?' warning':'');
 report.textContent=s.calibration?
  s.calibration.count+' GCPs · RMS '+number(s.calibration.rmsPixel)+' px · Max '+number(s.calibration.maxPixel)+' px. '+(s.calibration.warn||'Calibration valid.'):
  'Calibration required. Pick known locations and enter their coordinates.';
 $('detailReport').innerHTML='<div><span>Model</span><strong>'+esc(s.calibration?.model||'Not calibrated')+'</strong></div>'+
  '<div><span>References</span><strong>'+s.controls.filter(p=>p.enabled!==false).length+'</strong></div>'+
  '<div><span>RMS pixel error</span><strong>'+(s.calibration?number(s.calibration.rmsPixel)+' px':'—')+'</strong></div>'+
  '<div><span>Max pixel error</span><strong>'+(s.calibration?number(s.calibration.maxPixel)+' px':'—')+'</strong></div>';
 $('statusCrs').textContent=s.crs.toUpperCase();
 renderControls();renderLayers();renderInspector();
 $('undo').disabled=!history.length;$('redo').disabled=!future.length;
}
function renderControls(){
 const el=$('controlTable');
 el.innerHTML=s.controls.length?s.controls.map((p,i)=>'<tr><td><input aria-label="Enable GCP '+(i+1)+'" type="checkbox" data-control="'+esc(p.id)+'" data-prop="enabled" '+(p.enabled===false?'':'checked')+'></td>'+
  ['u','v','x','y'].map(key=>'<td><input type="number" step="any" data-control="'+esc(p.id)+'" data-prop="'+key+'" aria-label="GCP '+(i+1)+' '+key+'" value="'+(p[key]??'')+'"></td>').join('')+
  '<td><button data-delete-control="'+esc(p.id)+'" title="Delete control point">×</button></td></tr>').join(''):
 '<tr><td class="empty-table" colspan="6">No control points added</td></tr>';
}
function renderLayers(){
 const el=$('layerList');
 el.innerHTML=s.layers.length?s.layers.map(l=>'<div class="layer-item '+(l.id===s.activeLayerId?'selected':'')+'">'+
  '<span class="layer-symbol" style="color:'+esc(l.color)+'">'+layerIcon(l.type)+'</span>'+
  '<button class="layer-main" data-select-layer="'+esc(l.id)+'"><strong>'+esc(l.name)+'</strong><small>'+l.type+' · '+l.features.length+' feature'+(l.features.length===1?'':'s')+'</small></button>'+
  '<button title="'+(l.visible?'Hide':'Show')+' layer" data-toggle-layer="'+esc(l.id)+'">'+(l.visible?'◉':'○')+'</button>'+
  '<button title="'+(l.locked?'Unlock':'Lock')+' layer" data-lock-layer="'+esc(l.id)+'">'+(l.locked?'▣':'♢')+'</button>'+
  '<button title="Move layer up" data-up-layer="'+esc(l.id)+'">↑</button>'+
  '<button title="Remove layer" data-delete-layer="'+esc(l.id)+'">×</button>'+
  '</div>').join(''):'<p class="helper">No layers yet. Select a drawing tool or add a layer.</p>';
}
function renderInspector(){
 const el=$('featureInspector'),found=featureById(s.selectedId);
 if(!found){el.className='inspector-empty';el.innerHTML='<span class="inspector-graphic">◇</span><strong>Nothing selected</strong><p>Choose a feature in the viewport to inspect geometry and attributes.</p>';return;}
 el.className='';
 const {layer,feature:f}=found,pts=s.calibration?f.pixels.map(p=>forward(s.calibration,...p)):f.pixels,metric=measure(layer.type,pts,s.crs,s.xUnit,s.yUnit);
 const metricRows=layer.type==='point'?[['X',number(metric.x)],['Y',number(metric.y)]]:
 layer.type==='line'?[['Length',number(metric.length)+' '+metric.unit],['End-to-end',number(metric.endToEnd)+' '+metric.unit],['Vertices',metric.vertices],['ΔX',number(metric.dx)],['ΔY',number(metric.dy)]]:
 [['Area',number(metric.area)+' '+metric.areaUnit],['Perimeter',number(metric.perimeter)+' '+metric.unit],['Vertices',metric.vertices],['Valid boundary',metric.invalid?'No':'Yes']];
 el.innerHTML='<p class="helper">'+(s.calibration?'Calibrated graph coordinates':'Pixel coordinates · not yet calibrated')+'</p>'+
  '<label class="field">Feature name<input id="featureName" value="'+esc(f.name)+'"></label>'+
  '<div class="inspector-actions"><button id="duplicateFeature" class="minor">Duplicate</button><button id="deleteFeature" class="minor">Delete</button></div>'+
  '<table class="metrics-table">'+metricRows.map(([k,v])=>'<tr><td>'+esc(k)+'</td><td>'+esc(v)+'</td></tr>').join('')+'</table>'+
  (metric.invalid?'<p class="error-message">Invalid polygon: self-intersecting or zero-area geometry.</p>':'')+
  (metric.approximate?'<p class="helper">Geographic area uses a spherical approximation.</p>':'')+
  '<label class="field">Attributes (JSON object)<textarea id="featureAttributes" rows="4" spellcheck="false">'+esc(JSON.stringify(f.attributes,null,2))+'</textarea></label>'+
  '<h2>Vertices ('+f.pixels.length+')</h2>'+
  '<div class="vertex-list">'+pts.map(([x,y],i)=>'<div>'+(i+1)+': '+number(x)+', '+number(y)+'</div>').join('')+'</div>';
}
function updateCursor(e){
 if(!validImage())return;
 const p=localPx(e);if(!inside(p)){lastCursor=null;$('crosshairLabel').hidden=true;return;}
 lastCursor=p;
 const graph=s.calibration?forward(s.calibration,...p):null;
 $('cursorPixel').textContent='PIXEL '+number(p[0])+', '+number(p[1]);
 $('cursorGraph').textContent=graph?'X '+number(graph[0])+' · Y '+number(graph[1]):'NOT CALIBRATED';
 $('inspectX').textContent=graph?number(graph[0]):'—';$('inspectY').textContent=graph?number(graph[1]):'—';
 const c=$('crosshairLabel');c.hidden=!graph;
 if(graph){c.textContent='X '+number(graph[0])+'  Y '+number(graph[1]);const r=viewport.getBoundingClientRect();c.style.left=Math.min(r.width-160,e.clientX-r.left+14)+'px';c.style.top=Math.max(12,e.clientY-r.top-34)+'px';}
}
function pointerDown(e){
 if(e.button!==0||!validImage())return;
 viewport.focus({preventScroll:true});
 const pixel=localPx(e),target=e.target;
 if(s.tool==='pan'||space){
  drag={kind:'pan',x:e.clientX,y:e.clientY,tx:s.view.tx,ty:s.view.ty};viewport.setPointerCapture(e.pointerId);return;
 }
 if(!inside(pixel))return;
 if(s.tool==='gcp'){
  archiveSnapshot();s.controls.push({id:id(),u:pixel[0],v:pixel[1],x:null,y:null,enabled:true});
  s.calibration=null;changed();toast('Reference placed. Enter its known X and Y in the calibration table.');return;
 }
 if(s.tool==='select'){
  const gcp=closest(target,'data-gcp');
  if(gcp&&s.controls.some(p=>p.id===gcp.gcp)){
   const p=s.controls.find(p=>p.id===gcp.gcp);archiveSnapshot();drag={kind:'gcp',id:p.id};viewport.setPointerCapture(e.pointerId);return;
  }
  const data=closest(target,'data-feature'),found=featureById(data?.feature);
  if(found){
   s.selectedId=found.feature.id;s.activeLayerId=found.layer.id;
   if(e.altKey&&!found.layer.locked){
    const f=found.feature;
    if(data.vertex!==undefined){
     const min=found.layer.type==='point'?1:found.layer.type==='line'?2:3;
     if(f.pixels.length<=min)toast('This geometry requires at least '+min+' vertices.',true);
     else{archiveSnapshot();f.pixels.splice(Number(data.vertex),1);changed();toast('Vertex removed.');}
     return;
    }
    if(found.layer.type!=='point'){
     const points=f.pixels,edges=found.layer.type==='polygon'?points.length:points.length-1;
     let best=Infinity,index=0,projected=pixel;
     for(let i=0;i<edges;i++){
      const a=points[i],b=points[(i+1)%points.length],dx=b[0]-a[0],dy=b[1]-a[1];
      const t=Math.max(0,Math.min(1,((pixel[0]-a[0])*dx+(pixel[1]-a[1])*dy)/(dx*dx+dy*dy||1)));
      const q=[a[0]+t*dx,a[1]+t*dy],d=Math.hypot(q[0]-pixel[0],q[1]-pixel[1]);
      if(d<best){best=d;index=i+1;projected=q;}
     }
     archiveSnapshot();f.pixels.splice(index,0,projected);changed();toast('Vertex inserted. Drag the handle to refine it.');return;
    }
   }
   if(!found.layer.locked){
    archiveSnapshot();
    drag=data.vertex!==undefined?{kind:'vertex',id:found.feature.id,index:Number(data.vertex)}:
     {kind:'feature',id:found.feature.id,pixel,original:found.feature.pixels.map(p=>[...p])};
    viewport.setPointerCapture(e.pointerId);
   }
   changed();return;
  }
  s.selectedId=null;changed();return;
 }
 if(s.tool==='point'){addFeature('point',[snapped(pixel)]);return;}
 if(s.tool==='line'||s.tool==='polygon'){
  if(!draft||draft.type!==s.tool)draft={type:s.tool,pixels:[]};
  const p=snapped(pixel);
  if(!draft.pixels.length||Math.hypot(p[0]-draft.pixels.at(-1)[0],p[1]-draft.pixels.at(-1)[1])>.2/s.view.scale)draft.pixels.push(p);
  queueRender();return;
 }
}
function pointerMove(e){
 if(drag?.kind==='pan'){
  s.view.tx=drag.tx+e.clientX-drag.x;s.view.ty=drag.ty+e.clientY-drag.y;queueRender();return;
 }
 if(drag){
  const p=localPx(e);
  if(drag.kind==='gcp'){
   const g=s.controls.find(p=>p.id===drag.id);if(g){[g.u,g.v]=p;s.calibration=null;}
  }else{
   const found=featureById(drag.id);
   if(found){
    if(drag.kind==='vertex'){found.feature.pixels[drag.index]=snapped(p,drag.id);}
    else if(drag.kind==='feature'){const dx=p[0]-drag.pixel[0],dy=p[1]-drag.pixel[1];found.feature.pixels=drag.original.map(q=>[q[0]+dx,q[1]+dy]);}
   }
  }
  queueRender();return;
 }
 try{updateCursor(e);}catch(error){$('cursorGraph').textContent='INVALID COORDINATE';}
}
function pointerUp(e){if(!drag)return;const was=drag.kind;drag=null;if(was!=='pan')changed();else scheduleSave();}
function finishDrawing(){
 if(!draft)return;
 const needed=draft.type==='line'?2:3;
 const pixels=draft.pixels;
 if(pixels.length<needed){toast('Add at least '+needed+' different vertices.',true);return;}
 if(draft.type==='polygon'){
  // Check pixel topology before creation; calibrated validity also checked at export.
  if(new Set(pixels.map(p=>p.join(','))).size<3){toast('Polygon needs 3 distinct vertices.',true);return;}
 }
 const type=draft.type;draft=null;addFeature(type,pixels);toast('Feature created. Select it to edit individual vertices.');
}
function zoomAt(factor,x=viewport.clientWidth/2,y=viewport.clientHeight/2){
 const prev=s.view.scale,next=Math.min(32,Math.max(.04,prev*factor));
 s.view.tx=x-(x-s.view.tx)*next/prev;s.view.ty=y-(y-s.view.ty)*next/prev;s.view.scale=next;queueRender();
}
function fitImage(){
 if(!validImage())return;
 const pad=45;s.view.scale=Math.min((viewport.clientWidth-pad*2)/s.width,(viewport.clientHeight-pad*2)/s.height);
 s.view.scale=Math.max(.04,s.view.scale);
 s.view.tx=(viewport.clientWidth-s.width*s.view.scale)/2;s.view.ty=(viewport.clientHeight-s.height*s.view.scale)/2;
 queueRender();scheduleSave();
}
function applyCalibration(){
 try{
  const result=fitCalibration(s.controls,s.model,s.xAxis,s.yAxis);
  if(result.warn)toast(result.warn,true);else toast('Entire image calibrated. You can digitize and export graph coordinates.');
  s.calibration=result;changed();
 }catch(e){s.calibration=null;changed();toast(e.message,true);}
}
async function importImage(file){
 if(!file)return;
 if(/\.tiff?$/i.test(file.name)||file.type==='image/tiff'){toast('TIFF decoding is not included. Convert the file to lossless PNG before importing.',true);return;}
 if(!(/\.(png|jpe?g|webp|bmp)$/i.test(file.name)||/^image\/(png|jpeg|webp|bmp)$/.test(file.type))){toast('Unsupported image format. Use PNG, JPEG, WebP, or BMP.',true);return;}
 if(s.imageData&&!confirm('Importing a new image replaces the current image and its control points and features. Save the project first if needed.'))return;
 const uri=await new Promise((resolve,reject)=>{const f=new FileReader();f.onload=()=>resolve(String(f.result));f.onerror=()=>reject(Error('Could not read file'));f.readAsDataURL(file);});
 const temp=new Image();try{await new Promise((resolve,reject)=>{temp.onload=resolve;temp.onerror=()=>reject(Error('Browser could not decode image.'));temp.src=uri;});}catch(e){toast(e.message,true);return;}
 s=fresh();history=[];future=[];draft=null;
 s.imageData=uri;s.imageName=file.name;s.projectName=file.name.replace(/\.[^.]+$/,'')+' project';
 s.width=temp.naturalWidth;s.height=temp.naturalHeight;
 setSettingsInputs();image.src=uri;fitImage();render();scheduleSave();toast('Image imported at '+s.width+' × '+s.height+' native resolution.');
}
function setSettingsInputs(){
 for(const [key,el] of Object.entries({model:'model',xAxis:'xAxis',yAxis:'yAxis',crs:'crs',xUnit:'xUnit',yUnit:'yUnit'}))$(el).value=s[key];
 $('unitWarning').textContent=s.crs==='epsg:4326'?'Geographic length uses great-circle distance; area is an approximation.':
 s.crs==='epsg:3857'?'EPSG:3857 lengths and areas are projected planar measurements; map-scale distortion applies.':
 s.xUnit.trim().toLowerCase()===s.yUnit.trim().toLowerCase()?
 'Results are coordinate-space measurements; physical meaning depends on your calibration and units.':
 'X/Y units differ: reported line lengths and polygon areas are numerical coordinate-space quantities only.';
}
async function initializeDB(){
 if(!('indexedDB'in window))throw Error('IndexedDB unavailable');
 return new Promise((resolve,reject)=>{
  const r=indexedDB.open('referencer-local',1);
  r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains('projects'))r.result.createObjectStore('projects');};
  r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
 });
}
async function saveToDB(){
 if(!db)return;
 return new Promise((resolve,reject)=>{const t=db.transaction('projects','readwrite');t.objectStore('projects').put(s,'autosave');t.oncomplete=resolve;t.onerror=()=>reject(t.error);});
}
async function restoreFromDB(){
 if(!db)return;
 const object=await new Promise((resolve,reject)=>{const t=db.transaction('projects','readonly'),r=t.objectStore('projects').get('autosave');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 if(object?.version===1){s={...fresh(),...object};setSettingsInputs();render();if(validImage())requestAnimationFrame(()=>{if(!Number.isFinite(s.view.scale)||s.view.scale<=0)fitImage();});toast('Previous browser project restored.');}
}
function projectJSON(){return JSON.stringify({...s,projectSavedAt:new Date().toISOString()},null,2);}
function saveProject(){saveText((s.projectName||'referencer').replace(/[^a-zA-Z0-9_-]/g,'_')+'.referencer.json',projectJSON(),'application/json');toast('Portable project downloaded, including the source image.');}
async function openProject(file){
 if(!file)return;
 try{
  const raw=JSON.parse(await file.text());
  if(raw.version!==1||!Array.isArray(raw.layers)||!Array.isArray(raw.controls)||typeof raw.imageData!=='string'||(raw.imageData&&!raw.imageData.startsWith('data:image/')))throw Error('Not a valid Referencer project file.');
  s={...fresh(),...raw};history=[];future=[];draft=null;
  setSettingsInputs();render();scheduleSave();toast('Project reopened successfully.');
 }catch(e){toast('Cannot open project: '+e.message,true);}
}
function delFeature(){const item=featureById(s.selectedId);if(!item)return;archiveSnapshot();item.layer.features=item.layer.features.filter(f=>f.id!==s.selectedId);s.selectedId=null;changed();}
function duplicateFeature(){const item=featureById(s.selectedId);if(!item)return;archiveSnapshot();const f=structuredClone(item.feature);f.id=id();f.name+=' copy';f.pixels=f.pixels.map(p=>[p[0]+8/s.view.scale,p[1]+8/s.view.scale]);item.layer.features.push(f);s.selectedId=f.id;changed();}
function updateControl(e){
 const input=e.target,control=s.controls.find(p=>p.id===input.dataset.control);
 if(!control)return;
 archiveSnapshot();
 if(input.dataset.prop==='enabled')control.enabled=input.checked;
 else control[input.dataset.prop]=input.value.trim()===''?null:Number(input.value);
 s.calibration=null;changed();
}
function chooseLayer(e){
 const b=e.target.closest('[data-select-layer], [data-toggle-layer], [data-lock-layer], [data-up-layer], [data-delete-layer]');if(!b)return;
 const l=s.layers.find(l=>l.id===(b.dataset.selectLayer||b.dataset.toggleLayer||b.dataset.lockLayer||b.dataset.upLayer||b.dataset.deleteLayer));
 if(!l)return;
 if(b.dataset.selectLayer){s.activeLayerId=l.id;s.selectedId=null;}
 if(b.dataset.toggleLayer){archiveSnapshot();l.visible=!l.visible;}
 if(b.dataset.lockLayer){archiveSnapshot();l.locked=!l.locked;}
 if(b.dataset.upLayer){const index=s.layers.indexOf(l);if(index>0){archiveSnapshot();s.layers.splice(index,1);s.layers.splice(index-1,0,l);}}
 if(b.dataset.deleteLayer){if(!confirm('Delete the layer "'+l.name+'" and all '+l.features.length+' features?'))return;archiveSnapshot();s.layers=s.layers.filter(item=>item.id!==l.id);if(s.activeLayerId===l.id)s.activeLayerId=s.layers[0]?.id||null;s.selectedId=null;}
 changed();
}
function graphicSvg(){
 const content=svgMarkup(),w=s.width,h=s.height;
 return '<svg xmlns="http://www.w3.org/2000/svg" width="'+w+'" height="'+h+'" viewBox="0 0 '+w+' '+h+'">'+
  '<image href="'+esc(s.imageData)+'" width="'+w+'" height="'+h+'" />'+content+'</svg>';
}
async function exportPNG(){
 const w=s.width,h=s.height,canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
 const ctx=canvas.getContext('2d');if(!ctx)throw Error('Canvas unavailable');
 await image.decode();ctx.drawImage(image,0,0,w,h);
 for(const l of s.layers)if(l.visible)for(const f of l.features){
  ctx.beginPath();const p=f.pixels;ctx.strokeStyle=l.color;ctx.fillStyle=l.color+'44';ctx.lineWidth=2.2;
  if(l.type==='point'){ctx.arc(p[0][0],p[0][1],5,0,2*Math.PI);ctx.fillStyle=l.color;ctx.fill();}
  else {p.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));if(l.type==='polygon'){ctx.closePath();ctx.fill();}ctx.stroke();}
 }
 const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
 if(!blob)throw Error('PNG export failed');download('referencer_digitization.png',blob);
}
function requireCalibration(){if(!s.calibration)throw Error('Calibrate the image with valid control points first.');}
function exportData(kind){
 try{
  if(kind==='project'){saveProject();return;}
  if(!validImage())throw Error('Import an image first.');
  if(kind==='shp'){requireCalibration();const l=s.layers.find(l=>l.id===$('exportLayer').value);if(!l)throw Error('Choose a valid layer.');download(l.name.replace(/\W+/g,'_')+'.zip',shapefileZip(l,s.calibration,{forward,crs:s.crs,xUnit:s.xUnit,yUnit:s.yUnit}));}
  else if(kind==='csv'){requireCalibration();saveText('referencer_vertices.csv',vertexCSV(s.layers,s.calibration,forward),'text/csv;charset=utf-8');}
  else if(kind==='controls'){saveText('referencer_control_points.csv',csvRows([['id','pixel_u','pixel_v','graph_x','graph_y','enabled','pixel_residual'],...s.controls.map(p=>[p.id,p.u,p.v,p.x,p.y,p.enabled!==false,s.calibration?.residuals?.find(r=>r.id===p.id)?.pixelResidual??''])]),'text/csv;charset=utf-8');}
  else if(kind==='svg')saveText('referencer_visualization.svg',graphicSvg(),'image/svg+xml');
  else if(kind==='png')exportPNG().then(()=>toast('PNG illustration downloaded.')).catch(e=>toast(e.message,true));
  else if(kind==='world'){requireCalibration();if(!['epsg:3857','local'].includes(s.crs))throw Error('A world file is offered only for an affine projected/local coordinate system; arbitrary and geographic graphs require cautious GIS interpretation.');saveText('referencer.pgw',affineWorldFile(s.calibration),'text/plain');}
  if(kind!=='png')toast('Export prepared successfully.');
 }catch(e){toast('Export failed: '+e.message,true);}
}
function wireEvents(){
 $('imageFile').addEventListener('change',e=>{importImage(e.target.files?.[0]).catch(err=>toast(err.message,true));e.target.value='';});
 $('welcomeImport').addEventListener('click',()=>$('imageFile').click());
 const drop=$('uploadArea');
 for(const node of [drop,viewport]){node.addEventListener('dragover',e=>e.preventDefault());node.addEventListener('drop',e=>{e.preventDefault();const f=e.dataTransfer.files?.[0];if(f)importImage(f).catch(err=>toast(err.message,true));});}
 $('fitButton').addEventListener('click',fitImage);$('centerButton').addEventListener('click',fitImage);
 $('actualButton').addEventListener('click',()=>{if(!validImage())return;s.view.scale=1;s.view.tx=(viewport.clientWidth-s.width)/2;s.view.ty=(viewport.clientHeight-s.height)/2;changed();});
 $('zoomIn').addEventListener('click',()=>zoomAt(1.25));$('zoomOut').addEventListener('click',()=>zoomAt(1/1.25));
 $('gridButton').addEventListener('click',()=>{s.grid=!s.grid;changed();});
 $('gcpMode').addEventListener('click',()=>setTool('gcp'));
 document.querySelectorAll('[data-tool]').forEach(b=>b.addEventListener('click',()=>setTool(b.dataset.tool)));
 $('controlTable').addEventListener('change',updateControl);
 $('controlTable').addEventListener('click',e=>{const el=e.target.closest('[data-delete-control]');if(el){archiveSnapshot();s.controls=s.controls.filter(p=>p.id!==el.dataset.deleteControl);s.calibration=null;changed();}});
 $('clearControls').addEventListener('click',()=>{if(s.controls.length&&!confirm('Remove all calibration reference points?'))return;archiveSnapshot();s.controls=[];s.calibration=null;changed();});
 for(const key of ['model','xAxis','yAxis','crs','xUnit','yUnit']){
  const el=$(key);el.addEventListener('change',()=>{s[key]=el.value;if(['model','xAxis','yAxis'].includes(key))s.calibration=null;setSettingsInputs();changed();});
 }
 $('calibrate').addEventListener('click',applyCalibration);
 $('addLayer').addEventListener('click',()=>addLayer());
 $('layerList').addEventListener('click',chooseLayer);
 $('layerList').addEventListener('dblclick',e=>{
  const el=e.target.closest('[data-select-layer]');if(!el)return;
  const l=s.layers.find(item=>item.id===el.dataset.selectLayer);if(!l)return;
  const name=prompt('Rename layer:',l.name);if(name===null||!name.trim())return;
  archiveSnapshot();l.name=name.trim();changed();
 });
 $('projectName').addEventListener('input',e=>{s.projectName=e.target.value;scheduleSave();});
 $('newProject').addEventListener('click',()=>{if((validImage()||s.layers.length)&&!confirm('Create a new project? Unsaved work in this browser will be replaced.'))return;s=fresh();history=[];future=[];draft=null;lastCursor=null;setSettingsInputs();image.removeAttribute('src');changed();});
 $('saveProject').addEventListener('click',saveProject);
 $('openProject').addEventListener('click',()=>$('projectFile').click());
 $('projectFile').addEventListener('change',e=>{openProject(e.target.files?.[0]);e.target.value='';});
 $('undo').addEventListener('click',undo);$('redo').addEventListener('click',redo);
 $('featureInspector').addEventListener('change',e=>{
  const found=featureById(s.selectedId);if(!found)return;
  if(e.target.id==='featureName'){archiveSnapshot();found.feature.name=e.target.value||'Untitled feature';changed();}
  if(e.target.id==='featureAttributes'){try{const value=JSON.parse(e.target.value);if(!value||Array.isArray(value)||typeof value!=='object')throw Error('Attributes must be a JSON object.');archiveSnapshot();found.feature.attributes=value;changed();}catch(err){toast('Invalid attributes JSON: '+err.message,true);}}
 });
 $('featureInspector').addEventListener('click',e=>{if(e.target.id==='deleteFeature')delFeature();if(e.target.id==='duplicateFeature')duplicateFeature();});
 viewport.addEventListener('pointerdown',pointerDown);viewport.addEventListener('pointermove',pointerMove);viewport.addEventListener('pointerup',pointerUp);viewport.addEventListener('pointercancel',pointerUp);
 viewport.addEventListener('pointerleave',()=>{$('crosshairLabel').hidden=true;});
 viewport.addEventListener('dblclick',e=>{if(['line','polygon'].includes(s.tool)){e.preventDefault();finishDrawing();}});
 viewport.addEventListener('contextmenu',e=>{e.preventDefault();if(draft)finishDrawing();});
 viewport.addEventListener('wheel',e=>{if(!validImage())return;e.preventDefault();const rect=viewport.getBoundingClientRect();zoomAt(Math.exp(-e.deltaY*.0015),e.clientX-rect.left,e.clientY-rect.top);},{passive:false});
 window.addEventListener('keydown',e=>{
  const textInput=['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName);
  if(e.code==='Space'&&!textInput){space=true;e.preventDefault();}
  if((e.ctrlKey||e.metaKey)&&!textInput){
   if(e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?redo():undo();}
   if(e.key.toLowerCase()==='y'){e.preventDefault();redo();}
   if(e.key.toLowerCase()==='s'){e.preventDefault();saveProject();}
  }
  if(textInput)return;
  if(e.key==='Escape'){draft=null;drag=null;queueRender();}
  if(e.key==='Enter'&&draft)finishDrawing();
  if((e.key==='Delete'||e.key==='Backspace')&&s.selectedId)delFeature();
 });
 window.addEventListener('keyup',e=>{if(e.code==='Space')space=false;});
 window.addEventListener('blur',()=>{space=false;drag=null;});
 window.addEventListener('resize',()=>queueRender());
 $('copyXY').addEventListener('click',()=>{if(!lastCursor||!s.calibration)return toast('Hover over the calibrated graph first.',true);const p=forward(s.calibration,...lastCursor);navigator.clipboard?.writeText(p.join(', ')).then(()=>toast('Coordinates copied.')).catch(()=>toast('Clipboard unavailable.',true));});
 $('exportButton').addEventListener('click',()=>{
  $('exportLayer').innerHTML=s.layers.map(l=>'<option value="'+esc(l.id)+'">'+esc(l.name)+' ('+l.type+', '+l.features.length+')</option>').join('');
  if(activeLayer())$('exportLayer').value=activeLayer().id;$('exportDialog').showModal();
 });
 for(const [el,type] of Object.entries({downloadSHP:'shp',downloadCSV:'csv',downloadCalibration:'controls',downloadSVG:'svg',downloadPNG:'png',downloadWorld:'world',downloadJSON:'project'}))$(el).addEventListener('click',()=>exportData(type));
}
wireEvents();setSettingsInputs();render();
initializeDB().then(async result=>{db=result;await restoreFromDB();}).catch(e=>{$('saveStatus').textContent='Local autosave unavailable';console.warn('IndexedDB',e.message);});
