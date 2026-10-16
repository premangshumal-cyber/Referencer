// Dependency-free ESRI Shapefile + DBF + ZIP writers, usable fully offline.
import {closeRing,signedArea,selfIntersects,measure,EPSG4326,EPSG3857} from './math.js';
const enc = new TextEncoder();
const bytes = v => typeof v==='string'?enc.encode(v):v;
const writeString=(view,start,str,n)=>{const a=enc.encode(String(str));for(let i=0;i<Math.min(a.length,n);i++)view.setUint8(start+i,a[i]);};
const safeName=(s)=>String(s||'layer').replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,48)||'layer';
const checksum=arr=>{
 let c=0xffffffff;for(const b of arr){c^=b;for(let k=0;k<8;k++)c=(c>>>1)^(0xedb88320&-(c&1));}return(c^0xffffffff)>>>0;
};
const concat=(parts)=>{const size=parts.reduce((s,p)=>s+p.length,0),out=new Uint8Array(size);let i=0;for(const p of parts){out.set(p,i);i+=p.length;}return out;};
export const download=(fileName,blob)=>{
 const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=fileName;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),15000);
};
export const saveText=(name,value,type='text/plain')=>download(name,new Blob([value],{type}));
export function zip(files){
 const local=[],central=[];let offset=0;
 for(const [name,contents] of files){
  const filename=bytes(name),data=bytes(contents),crc=checksum(data);
  const header=new Uint8Array(30+filename.length),h=new DataView(header.buffer);
  h.setUint32(0,0x04034b50,true);h.setUint16(4,20,true);h.setUint16(6,0x0800,true);
  h.setUint16(8,0,true);h.setUint16(10,0,true);h.setUint16(12,0,true);
  h.setUint32(14,crc,true);h.setUint32(18,data.length,true);h.setUint32(22,data.length,true);
  h.setUint16(26,filename.length,true);header.set(filename,30);
  local.push(header,data);
  const c=new Uint8Array(46+filename.length),v=new DataView(c.buffer);
  v.setUint32(0,0x02014b50,true);v.setUint16(4,20,true);v.setUint16(6,20,true);
  v.setUint16(8,0x0800,true);v.setUint16(10,0,true);v.setUint16(12,0,true);
  v.setUint32(16,crc,true);v.setUint32(20,data.length,true);v.setUint32(24,data.length,true);
  v.setUint16(28,filename.length,true);v.setUint32(42,offset,true);c.set(filename,46);
  central.push(c);offset+=header.length+data.length;
 }
 const body=concat(local),directory=concat(central),end=new Uint8Array(22),dv=new DataView(end.buffer);
 dv.setUint32(0,0x06054b50,true);dv.setUint16(8,central.length,true);dv.setUint16(10,central.length,true);
 dv.setUint32(12,directory.length,true);dv.setUint32(16,body.length,true);
 return new Blob([body,directory,end],{type:'application/zip'});
}
const bounds=shapes=>{
 const points=shapes.flatMap(s=>s.points);
 if(!points.length)return [0,0,0,0];
 return [Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1])),Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))];
};
const shapeBytes=(type,points)=>{
 const code=type==='point'?1:type==='line'?3:5;
 let ring=code===5?closeRing(points):points;
 // ESRI outer polygon rings use clockwise winding (negative signed area).
 if(code===5&&signedArea(ring)>0)ring=[...ring].reverse();
 const len=code===1?20:44+16*ring.length;
 const a=new Uint8Array(len),v=new DataView(a.buffer);
 v.setInt32(0,code,true);
 if(code===1){
  v.setFloat64(4,ring[0][0],true);v.setFloat64(12,ring[0][1],true);
 }else{
  const [minx,miny,maxx,maxy]=bounds([{points:ring}]);
  [minx,miny,maxx,maxy].forEach((n,i)=>v.setFloat64(4+8*i,n,true));
  v.setInt32(36,1,true);v.setInt32(40,ring.length,true);v.setInt32(44,0,true);
  ring.forEach(([x,y],i)=>{v.setFloat64(48+16*i,x,true);v.setFloat64(56+16*i,y,true);});
 }
 return a;
};
function header(type,fileSize,extent){
 const a=new Uint8Array(100),v=new DataView(a.buffer);
 v.setInt32(0,9994,false);v.setInt32(24,fileSize/2,false);
 v.setInt32(28,1000,true);v.setInt32(32,type==='point'?1:type==='line'?3:5,true);
 [extent[0],extent[1],extent[2],extent[3]].forEach((n,i)=>v.setFloat64(36+8*i,n,true));
 return a;
}
function shpAndShx(type,shapes){
 const entries=shapes.map(s=>shapeBytes(type,s.points));
 const extent=bounds(shapes),shpSize=100+entries.reduce((s,r)=>s+8+r.length,0),shxSize=100+entries.length*8;
 const shp=new Uint8Array(shpSize),shx=new Uint8Array(shxSize);
 shp.set(header(type,shpSize,extent));shx.set(header(type,shxSize,extent));
 const sv=new DataView(shp.buffer),iv=new DataView(shx.buffer);
 let offset=100;
 entries.forEach((entry,i)=>{
  sv.setInt32(offset,i+1,false);sv.setInt32(offset+4,entry.length/2,false);shp.set(entry,offset+8);
  iv.setInt32(100+i*8,offset/2,false);iv.setInt32(104+i*8,entry.length/2,false);
  offset+=8+entry.length;
 });
 return [shp,shx];
}
function dbf(shapes,type,options){
 const known=new Set(['ID','NAME','LENGTH','AREA']);
 const attrKeys=[...new Set(shapes.flatMap(s=>Object.keys(s.attributes||{})))].filter(Boolean).slice(0,20);
 const fields=[
  {name:'ID',type:'N',length:12,dec:0,key:'id'},
  {name:'NAME',type:'C',length:80,dec:0,key:'name'},
  ...(type==='point'?[]:type==='line'?[{name:'LENGTH',type:'N',length:19,dec:6,key:'length'}]:[{name:'AREA',type:'N',length:19,dec:6,key:'area'}])
 ];
 attrKeys.forEach((key,i)=>{
  let name=key.toUpperCase().replace(/[^A-Z0-9_]/g,'_').slice(0,10)||('FIELD'+i);
  let suffix=1;const base=name;
  while(known.has(name)){name=base.slice(0,8)+(suffix++);}
  known.add(name);
  const values=shapes.map(s=>s.attributes?.[key]).filter(x=>x!==null&&x!==undefined&&String(x)!=='');
  const numeric=values.length>0&&values.every(v=>typeof v==='number'&&Number.isFinite(v));
  fields.push({name,type:numeric?'N':'C',length:numeric?19:80,dec:numeric?6:0,key:'attr:'+key});
 });
 const recordSize=1+fields.reduce((s,f)=>s+f.length,0),headSize=32+fields.length*32+1;
 const output=new Uint8Array(headSize+recordSize*shapes.length+1),v=new DataView(output.buffer);
 output[0]=0x03;const d=new Date();output[1]=d.getFullYear()-1900;output[2]=d.getMonth()+1;output[3]=d.getDate();
 v.setUint32(4,shapes.length,true);v.setUint16(8,headSize,true);v.setUint16(10,recordSize,true);
 fields.forEach((f,i)=>{
  const o=32+32*i;writeString(v,o,f.name,10);v.setUint8(o+11,f.type.charCodeAt(0));v.setUint8(o+16,f.length);v.setUint8(o+17,f.dec);
 });
 output[headSize-1]=0x0d;
 shapes.forEach((s,i)=>{
  let o=headSize+i*recordSize;output[o++]=0x20;
  for(const f of fields){
   let value=f.key.startsWith('attr:')?s.attributes?.[f.key.slice(5)]:s[f.key];
   if(f.key==='length')value=s.metric?.length;
   if(f.key==='area')value=s.metric?.area;
   let str='';
   if(value!==null&&value!==undefined){
    if(f.type==='N'){const n=Number(value);str=Number.isFinite(n)?n.toFixed(f.dec):'';if(str.length>f.length)str='';str=str.padStart(f.length,' ');}
    else str=String(value);
   }
   const b=enc.encode(str);
   if(f.type==='C'){output.fill(0x20,o,o+f.length);output.set(b.slice(0,f.length),o);}
   else {output.fill(0x20,o,o+f.length);output.set(b.slice(0,f.length),o);}
   o+=f.length;
  }
 });
 output[output.length-1]=0x1a;return output;
}
export function shapefileZip(layer,calibration,settings){
 if(!calibration)throw new Error('Calibrate the image before exporting Shapefiles.');
 const visible=layer.features;
 if(!visible.length)throw new Error('This layer contains no features.');
 const min=layer.type==='point'?1:layer.type==='line'?2:3;
 const shapes=visible.map((f,i)=>{
  if(f.pixels.length<min)throw new Error('Feature '+f.name+' has too few vertices.');
  const points=f.pixels.map(([u,v])=>settings.forward(calibration,u,v));
  if(points.some(p=>p.some(n=>!Number.isFinite(n))))throw new Error('Invalid transformed coordinate in '+f.name);
  if(layer.type==='polygon'&&selfIntersects(points))throw new Error('Polygon '+f.name+' self-intersects. Repair it before export.');
  if(layer.type==='polygon'&&Math.abs(signedArea(points))<1e-12)throw new Error('Polygon '+f.name+' has zero area.');
  return {id:i+1,name:f.name||'Feature '+(i+1),points,attributes:f.attributes||{},metric:measure(layer.type,points,settings.crs,settings.xUnit,settings.yUnit)};
 });
 const [shp,shx]=shpAndShx(layer.type,shapes),name=safeName(layer.name);
 const files=[[name+'.shp',shp],[name+'.shx',shx],[name+'.dbf',dbf(shapes,layer.type)]];
 let crs=null;if(settings.crs==='epsg:4326')crs=EPSG4326;
 else if(settings.crs==='epsg:3857')crs=EPSG3857;
 if(crs)files.push([name+'.prj',crs]);
 files.push([name+'.cpg','UTF-8']);
 return zip(files);
}
const escapeCSV=s=>{const x=String(s??'');return /[,"\n\r]/.test(x)?'"'+x.replace(/"/g,'""')+'"':x;};
export function csvRows(rows){return rows.map(row=>row.map(escapeCSV).join(',')).join('\r\n')+'\r\n';}
export function vertexCSV(layers,calibration,forward){
 const rows=[['layer','feature_id','feature_name','type','vertex','x','y','pixel_x','pixel_y']];
 for(const layer of layers)for(const f of layer.features)f.pixels.forEach(([u,v],i)=>{
  const [x,y]=forward(calibration,u,v);rows.push([layer.name,f.id,f.name,layer.type,i+1,x,y,u,v]);
 });
 return csvRows(rows);
}
