import test from 'node:test';
import assert from 'node:assert/strict';
import {fitCalibration,forward,backward,measure,affineWorldFile,selfIntersects} from '../src/math.js';
import {shapefileZip,vertexCSV} from '../src/export.js';
const eq=(a,b,eps=1e-7)=>assert.ok(Math.abs(a-b)<eps,String(a)+' != '+String(b));
const gcp=(u,v,x,y)=>({id:u+'_'+v,u,v,x,y,enabled:true});
const controls=[gcp(0,300,0,0),gcp(400,300,100,0),gcp(0,0,0,50)];
test('affine: pixel Y downward, XY upward, inverse consistency',()=>{
 const cal=fitCalibration(controls);const [x,y]=forward(cal,200,150);eq(x,50);eq(y,25);
 const [u,v]=backward(cal,x,y);eq(u,200);eq(v,150);eq(cal.rmsPixel,0);assert.equal(cal.count,3);
});
test('affine: recovers rotation and skew from 5 controls',()=>{
 const f=(u,v)=>[42+2*u+.3*v,-13-.7*u+3*v];
 const pts=[[0,0],[10,0],[0,10],[12,23],[56,78]].map(([u,v])=>gcp(u,v,...f(u,v)));
 const cal=fitCalibration(pts,'affine');const [x,y]=forward(cal,8,19);eq(x,f(8,19)[0]);eq(y,f(8,19)[1]);
});
test('axis: independent horizontal and vertical scales',()=>{
 const pts=[gcp(0,200,2,-20),gcp(100,200,12,-20),gcp(0,0,2,20)];
 const cal=fitCalibration(pts,'axis');const [x,y]=forward(cal,50,100);eq(x,7);eq(y,0);
});
test('log axis: powers are fitted in log domain',()=>{
 const pts=[gcp(0,100,1,0),gcp(200,100,100,0),gcp(0,0,1,10)];
 const cal=fitCalibration(pts,'affine','log','linear');
 const [x,y]=forward(cal,100,50);eq(x,10);eq(y,5);
 assert.throws(()=>fitCalibration([gcp(0,0,0,0),...pts],'affine','log','linear'),/positive/);
});
test('reversed horizontal and vertical axes are supported',()=>{
 const cal=fitCalibration([gcp(0,0,100,100),gcp(100,0,0,100),gcp(0,100,100,0)]);
 const [x,y]=forward(cal,25,40);eq(x,75);eq(y,60);
});
test('projective homography maps four reference correspondences',()=>{
 const pts=[gcp(0,0,0,0),gcp(100,0,100,5),gcp(100,100,80,100),gcp(0,100,10,90)];
 const cal=fitCalibration(pts,'projective');
 for(const p of pts){const [x,y]=forward(cal,p.u,p.v);eq(x,p.x);eq(y,p.y);}
 const [u,v]=backward(cal,...forward(cal,42,21));eq(u,42);eq(v,21);
});
test('regression residuals are nonzero for noisy control points',()=>{
 const pts=[gcp(0,0,0,0),gcp(100,0,100,0),gcp(0,100,0,100),gcp(100,100,101,100)];
 const cal=fitCalibration(pts);assert.ok(cal.rmsPixel>0);
});
test('bad control point configurations rejected',()=>{
 assert.throws(()=>fitCalibration([gcp(0,0,0,0),gcp(2,2,2,2)]),/at least/);
 assert.throws(()=>fitCalibration([gcp(0,0,0,0),gcp(2,2,2,2),gcp(4,4,4,4)]),/collinear/);
 assert.throws(()=>fitCalibration([gcp(0,0,0,0),gcp(0,0,1,1),gcp(1,1,2,2)]),/Duplicate/);
});
test('3-4-5 line length and rectangle area/perimeter',()=>{
 const line=measure('line',[[0,0],[3,4]]);eq(line.length,5);eq(line.endToEnd,5);
 const rect=measure('polygon',[[0,0],[10,0],[10,5],[0,5]]);
 eq(rect.area,50);eq(rect.perimeter,30);eq(rect.centroid[0],5);eq(rect.centroid[1],2.5);assert.equal(rect.invalid,false);
});
test('polygon detects self-intersections',()=>{
 assert.equal(selfIntersects([[0,0],[10,10],[0,10],[10,0]]),true);
 assert.equal(selfIntersects([[0,0],[10,0],[10,10],[0,10]]),false);
});
test('web mercator and longitude-latitude measurement semantics',()=>{
 const g=measure('line',[[0,0],[1,0]],'epsg:4326');
 assert.ok(g.length>100000&&g.length<112000);assert.equal(g.unit,'m');
 const m=measure('polygon',[[0,0],[1,0],[1,1],[0,1]],'epsg:4326');
 assert.ok(m.area>1e10);assert.equal(m.approximate,true);
});
test('affine world file standard six-line coefficient order',()=>{
 const cal=fitCalibration(controls),f=affineWorldFile(cal).trim().split('\n').map(Number);
 eq(f[0],.25);eq(f[1],0);eq(f[2],0);eq(f[3],-1/6);eq(f[4],0);eq(f[5],50);
});
async function zipEntries(blob){
 const data=new Uint8Array(await blob.arrayBuffer()),v=new DataView(data.buffer),result={};let o=0;
 while(o<data.length&&v.getUint32(o,true)===0x04034b50){
  const len=v.getUint32(o+18,true),n=v.getUint16(o+26,true),extra=v.getUint16(o+28,true);
  const filename=new TextDecoder().decode(data.slice(o+30,o+30+n));
  const start=o+30+n+extra;result[filename]=data.slice(start,start+len);o=start+len;
 }
 return result;
}
test('point line and polygon Shapefile ZIPs have valid binary SHP SHX DBF',async()=>{
 const cal=fitCalibration([gcp(0,0,0,0),gcp(100,0,100,0),gcp(0,100,0,100)]);
 for(const [type,points,shapeType] of [
  ['point',[[4,5]],1],['line',[[0,0],[3,4]],3],['polygon',[[0,0],[10,0],[10,5],[0,5]],5]
 ]){
  const layer={name:'sample_'+type,type,features:[{id:'f1',name:'Example',pixels:points,attributes:{value:2}}]};
  const blob=shapefileZip(layer,cal,{forward,crs:'epsg:4326',xUnit:'degrees',yUnit:'degrees'});
  const entries=await zipEntries(blob),name='sample_'+type;
  for(const ext of ['shp','shx','dbf','prj','cpg'])assert.ok(entries[name+'.'+ext],type+' missing '+ext);
  const shp=new DataView(entries[name+'.shp'].buffer),shx=new DataView(entries[name+'.shx'].buffer);
  assert.equal(shp.getInt32(0,false),9994);assert.equal(shp.getInt32(32,true),shapeType);
  assert.equal(shp.getInt32(100,false),1);assert.equal(shp.getInt32(108,true),shapeType);
  assert.equal(shp.getInt32(24,false)*2,entries[name+'.shp'].length);
  assert.equal(shx.getInt32(24,false)*2,entries[name+'.shx'].length);
  assert.equal(entries[name+'.dbf'][4],1);
  if(type==='point'){eq(shp.getFloat64(112,true),4);eq(shp.getFloat64(120,true),5);}
  if(type==='polygon'){assert.equal(shp.getInt32(144,true),1);assert.equal(shp.getInt32(148,true),5);}
 }
});
test('arbitrary Cartesian Shapefiles do not fabricate a .prj',async()=>{
 const layer={name:'local',type:'point',features:[{id:'id',name:'Test',pixels:[[1,2]],attributes:{}}]};
 const entries=await zipEntries(shapefileZip(layer,fitCalibration(controls),{forward,crs:'cartesian',xUnit:'s',yUnit:'mm'}));
 assert.equal(Object.keys(entries).some(k=>k.endsWith('.prj')),false);
});
test('invalid polygon blocks export',()=>{
 const layer={name:'bad',type:'polygon',features:[{id:'id',name:'Bow tie',pixels:[[0,0],[10,10],[0,10],[10,0]],attributes:{}}]};
 assert.throws(()=>shapefileZip(layer,fitCalibration([gcp(0,0,0,0),gcp(10,0,10,0),gcp(0,10,0,10)]),{forward,crs:'cartesian',xUnit:'',yUnit:''}),/self-intersects/);
});
test('CSV export preserves underlying transformed coordinates',()=>{
 const layer={name:'Line',type:'line',features:[{id:'f1',name:'L',pixels:[[0,300],[200,150]],attributes:{}}]};
 const csv=vertexCSV([layer],fitCalibration(controls),forward);
 assert.match(csv,/200,150/);assert.match(csv,/50,25/);
});
