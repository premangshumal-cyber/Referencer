// Referencer numerical core. All geometry remains in original image-pixel coordinates.
export const EPSG4326 = 'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]]';
export const EPSG3857 = 'PROJCS["WGS 84 / Pseudo-Mercator",GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]],PROJECTION["Mercator_1SP"],PARAMETER["central_meridian",0],PARAMETER["scale_factor",1],PARAMETER["false_easting",0],PARAMETER["false_northing",0],UNIT["metre",1],AXIS["X",EAST],AXIS["Y",NORTH]]';
export const finite = v => Number.isFinite(Number(v)) && v !== '' && v !== null;
const norm = xs => { const a=xs.reduce((s,x)=>s+x,0)/xs.length; const span=Math.max(...xs.map(x=>Math.abs(x-a))); return {offset:a, scale:span || 1}; };
const vnorm=(x,n)=>(x-n.offset)/n.scale;
const denorm=(x,n)=>x*n.scale+n.offset;
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
function leastSquares(rows, ys) {
  const m=rows.length, n=rows[0].length;
  if(m<n) throw new Error('Not enough enabled control points.');
  const q=[],r=Array.from({length:n},()=>Array(n).fill(0));
  const col=j=>rows.map(row=>row[j]);
  const maxCol=Math.max(1,...Array.from({length:n},(_,j)=>Math.hypot(...col(j))));
  for(let j=0;j<n;j++){
    let v=col(j);
    // Reorthogonalized modified Gram-Schmidt avoids unstable normal equations.
    for(let pass=0;pass<2;pass++)for(let i=0;i<j;i++){
      const d=dot(q[i],v);r[i][j]+=d;v=v.map((x,k)=>x-d*q[i][k]);
    }
    r[j][j]=Math.hypot(...v);
    if(r[j][j]<1e-10*maxCol)throw new Error('Control points are collinear, duplicated, or poorly distributed.');
    q[j]=v.map(x=>x/r[j][j]);
  }
  const b=q.map(v=>dot(v,ys)),result=Array(n).fill(0);
  for(let i=n-1;i>=0;i--){let value=b[i];for(let j=i+1;j<n;j++)value-=r[i][j]*result[j];result[i]=value/r[i][i];}
  return result;
}
const applyH=(h,u,v)=>{
  const d=h[6]*u+h[7]*v+h[8];
  if(Math.abs(d)<1e-12) throw new Error('Projective transform approaches infinity at this location.');
  return [(h[0]*u+h[1]*v+h[2])/d,(h[3]*u+h[4]*v+h[5])/d];
};
const inverse3=h=>{
  const [a,b,c,d,e,f,g,i,j]=h, A=e*j-f*i, B=c*i-b*j, C=b*f-c*e,
  D=f*g-d*j, E=a*j-c*g, F=c*d-a*f, G=d*i-e*g, H=b*g-a*i, I=a*e-b*d;
  const det=a*A+b*D+c*G;
  if(!Number.isFinite(det)||Math.abs(det)<1e-14) throw new Error('Singular transformation; adjust the control points.');
  return [A,B,C,D,E,F,G,H,I].map(x=>x/det);
};
const toAxis=(v,axis)=>{
  if(axis==='log'){if(v<=0)throw new Error('Logarithmic axis requires strictly positive reference coordinates.');return Math.log10(v);}
  return v;
};
const fromAxis=(v,axis)=>axis==='log'?10**v:v;
export function fitCalibration(controls, model='affine', xAxis='linear',yAxis='linear') {
  const pts=controls.filter(p=>p.enabled!==false);
  const min=model==='projective'?4:model==='axis'?2:3;
  if(pts.length<min)throw new Error('Calibration needs at least '+min+' enabled control points.');
  for(const p of pts)if(![p.u,p.v,p.x,p.y].every(finite))throw new Error('Control points must have finite image and graph coordinates.');
  if(new Set(pts.map(p=>p.u+','+p.v)).size!==pts.length)throw new Error('Duplicate image control points are not allowed.');
  const px=pts.map(p=>Number(p.u)),py=pts.map(p=>Number(p.v));
  const gx=pts.map(p=>toAxis(Number(p.x),xAxis)),gy=pts.map(p=>toAxis(Number(p.y),yAxis));
  const uNorm=norm(px),vNorm=norm(py),xNorm=norm(gx),yNorm=norm(gy);
  const src=pts.map((p,i)=>[vnorm(px[i],uNorm),vnorm(py[i],vNorm)]);
  const dst=pts.map((p,i)=>[vnorm(gx[i],xNorm),vnorm(gy[i],yNorm)]);
  let h;
  if(model==='axis'){
    if(new Set(px).size<2||new Set(py).size<2)throw new Error('Axis mode requires varying pixel X and pixel Y positions.');
    const ax=leastSquares(src.map(p=>[1,p[0]]),dst.map(p=>p[0]));
    const ay=leastSquares(src.map(p=>[1,p[1]]),dst.map(p=>p[1]));
    h=[ax[1],0,ax[0],0,ay[1],ay[0],0,0,1];
  }else if(model==='affine'){
    const a=leastSquares(src.map(p=>[1,p[0],p[1]]),dst.map(p=>p[0]));
    const b=leastSquares(src.map(p=>[1,p[0],p[1]]),dst.map(p=>p[1]));
    h=[a[1],a[2],a[0],b[1],b[2],b[0],0,0,1];
  }else if(model==='projective'){
    const A=[],B=[];
    for(let i=0;i<src.length;i++){
      const [u,v]=src[i],[x,y]=dst[i];
      A.push([u,v,1,0,0,0,-x*u,-x*v]);B.push(x);
      A.push([0,0,0,u,v,1,-y*u,-y*v]);B.push(y);
    }
    h=[...leastSquares(A,B),1];
  }else throw new Error('Unsupported calibration model.');
  const inverse=inverse3(h);
  const cfg={model,xAxis,yAxis,uNorm,vNorm,xNorm,yNorm,h,inverse,count:pts.length};
  const residuals=pts.map(p=>{
    const [x,y]=forward(cfg,Number(p.u),Number(p.v));
    const ex=x-Number(p.x),ey=y-Number(p.y);
    let pixelResidual=null;
    try{const [u,v]=backward(cfg,Number(p.x),Number(p.y));pixelResidual=Math.hypot(u-Number(p.u),v-Number(p.v));}catch{}
    return {id:p.id,x:ex,y:ey,coordinateResidual:Math.hypot(ex,ey),pixelResidual};
  });
  const pr=residuals.map(r=>r.pixelResidual).filter(Number.isFinite);
  cfg.rmsPixel=pr.length?Math.sqrt(pr.reduce((s,e)=>s+e*e,0)/pr.length):null;
  cfg.maxPixel=pr.length?Math.max(...pr):null;
  cfg.residuals=residuals;
  cfg.warn=cfg.rmsPixel!==null&&cfg.rmsPixel>3?'Calibration residual exceeds 3 pixels. Review control points.':'';
  return cfg;
}
export function forward(cfg,u,v) {
  if(!cfg)throw new Error('Image has not been calibrated.');
  const [x,y]=applyH(cfg.h,vnorm(u,cfg.uNorm),vnorm(v,cfg.vNorm));
  return [fromAxis(denorm(x,cfg.xNorm),cfg.xAxis),fromAxis(denorm(y,cfg.yNorm),cfg.yAxis)];
}
export function backward(cfg,x,y){
  if(!cfg)throw new Error('Image has not been calibrated.');
  const a=vnorm(toAxis(x,cfg.xAxis),cfg.xNorm),b=vnorm(toAxis(y,cfg.yAxis),cfg.yNorm);
  const [u,v]=applyH(cfg.inverse,a,b);
  return [denorm(u,cfg.uNorm),denorm(v,cfg.vNorm)];
}
export const closeRing=pts=>pts.length&&((pts[0][0]===pts.at(-1)[0]&&pts[0][1]===pts.at(-1)[1])?pts:[...pts,pts[0]]);
export function signedArea(ring){const p=closeRing(ring);let s=0;for(let i=0;i<p.length-1;i++)s+=p[i][0]*p[i+1][1]-p[i+1][0]*p[i][1];return s/2;}
export const distance=(a,b)=>Math.hypot(b[0]-a[0],b[1]-a[1]);
export function selfIntersects(poly){
 const p=closeRing(poly);if(p.length<5)return false;
 const orient=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
 const between=(x,a,b)=>x>=Math.min(a,b)-1e-10&&x<=Math.max(a,b)+1e-10;
 const intersect=(a,b,c,d)=>{
  const o1=orient(a,b,c),o2=orient(a,b,d),o3=orient(c,d,a),o4=orient(c,d,b);
  if(o1*o2<0&&o3*o4<0)return true;
  return [[o1,c,a,b],[o2,d,a,b],[o3,a,c,d],[o4,b,c,d]].some(([o,z,s,t])=>Math.abs(o)<1e-10&&between(z[0],s[0],t[0])&&between(z[1],s[1],t[1]));
 };
 for(let i=0;i<p.length-1;i++)for(let j=i+1;j<p.length-1;j++){
   if(Math.abs(i-j)<=1||(i===0&&j===p.length-2))continue;
   if(intersect(p[i],p[i+1],p[j],p[j+1]))return true;
 }
 return false;
}
const geoDistance=(a,b)=>{
 const R=6371008.8,rad=Math.PI/180;
 const dlat=(b[1]-a[1])*rad,dlon=(b[0]-a[0])*rad;
 const v=Math.sin(dlat/2)**2+Math.cos(a[1]*rad)*Math.cos(b[1]*rad)*Math.sin(dlon/2)**2;
 return 2*R*Math.asin(Math.min(1,Math.sqrt(v)));
};
function geographicArea(ring){
 const pts=closeRing(ring),r=Math.PI/180,R=6371008.8;
 let sum=0;for(let i=0;i<pts.length-1;i++)sum+=(pts[i+1][0]-pts[i][0])*r*(2+Math.sin(pts[i][1]*r)+Math.sin(pts[i+1][1]*r));
 return Math.abs(sum)*R*R/2;
}
export function measure(type,pts,mode='cartesian',xUnits='',yUnits=''){
 if(!pts?.length)return {};
 const projected=mode==='epsg:3857',geo=mode==='epsg:4326';
 const same=xUnits.trim().toLowerCase()===yUnits.trim().toLowerCase()&&xUnits.trim();
 const unit=geo?'m':projected?'m':same?xUnits:'coordinate units';
 const len=(a,b)=>geo?geoDistance(a,b):distance(a,b);
 const bbox={xmin:Math.min(...pts.map(p=>p[0])),xmax:Math.max(...pts.map(p=>p[0])),ymin:Math.min(...pts.map(p=>p[1])),ymax:Math.max(...pts.map(p=>p[1]))};
 if(type==='point')return {x:pts[0][0],y:pts[0][1],bbox};
 let length=0;for(let i=1;i<pts.length;i++)length+=len(pts[i-1],pts[i]);
 if(type==='line')return {length,unit,segments:pts.length-1,vertices:pts.length,endToEnd:len(pts[0],pts.at(-1)),dx:pts.at(-1)[0]-pts[0][0],dy:pts.at(-1)[1]-pts[0][1],bbox};
 const ring=closeRing(pts);
 length+=len(pts.at(-1),pts[0]);
 const s=signedArea(ring),area=geo?geographicArea(ring):Math.abs(s);
 let cx=0,cy=0;
 if(Math.abs(s)>1e-15)for(let i=0;i<ring.length-1;i++){
  const a=ring[i],b=ring[i+1],cross=a[0]*b[1]-b[0]*a[1];
  cx+=(a[0]+b[0])*cross;cy+=(a[1]+b[1])*cross;
 }
 return {area,areaUnit:unit+'²',perimeter:length,unit,centroid:Math.abs(s)>1e-15?[cx/(6*s),cy/(6*s)]:null,bbox,vertices:pts.length,invalid:selfIntersects(ring)||Math.abs(s)<1e-14,approximate:geo};
}
export function affineWorldFile(cfg){
 if(!cfg||cfg.model==='projective'||cfg.xAxis!=='linear'||cfg.yAxis!=='linear')throw new Error('World files require a linear affine/axis calibration.');
 const [[x0,y0],[x1,y1],[x2,y2]]=[[0,0],[1,0],[0,1]].map(([u,v])=>forward(cfg,u,v));
 return [x1-x0,y1-y0,x2-x0,y2-y0,x0,y0].map(v=>Number(v).toPrecision(16)).join('\n')+'\n';
}
