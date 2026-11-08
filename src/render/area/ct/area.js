/* Ported from trailbound-controller (deployed main). ESM, behaviour-faithful.
   Not typechecked: a full TS conversion of these files would stall the port.
   three r187: colorSpace, colorspace_fragment, per-fragment Lambert cel, asset root.
*/
import { THREE } from './three-runtime.js';
import {
  WALK_CLAMP_MARGIN,
  freshEdgeLeave,
  stepEdgeLeave,
  clampClearance,
} from '../../../core/area/edge-leave.ts';
import { useOakSeed } from '../oak-batch.ts';
/* AreaExport v0.1–v0.4 → a smooth heightmapped level.
   Schema: world-map src/app/engine/area-export.ts (types win over the field guide).
   Loaded by ?area=, a dropped JSON file, or postMessage {type:'tb-area', payload}.
   The map opens ?bridge=1, says tb-area-hello, and waits for tb-area-ready.
   With no area, the hand-made meadow is left alone. An area replaces it for the session.
   Buildings sit on payload.buildings (see world/buildings.js).
   Roads and dirt paths are smoothed ribbons, not the 1 m cell stairs.
   Building lots stay rectangular yards; plazas stay cobble.
   Heights are Catmull-Rom on the exported lattice (8 m corners, or v0.3 subdiv),
   plus a low detail ripple that stays off roads, lots, plazas and footprints.
   v0.3 borderMask is neighbouring land: still textured, eased toward 55% saturation,
   and only the outer 8 m fades into the sky. A local stretch lifts flat exports
   into a few metres of hills, after the smooth field, and never steeper than
   about 35 degrees. Shore is where that height meets the water level; the
   painted water mask only biases the line. The bank eases down over 3–6 m.
   When layers.water.present is false, playable cells are held just above
   the waterline. The ring outside the mask keeps the ocean. When water is
   present, interior water uses that same textured sheet and sea shoreline.
   Each building's footprint and yard is then flattened to one pad so the
   shell sits on the ground and its door stays on that pad.
   v0.6 (additive): layers.surface and roads.polylines paint road ribbons,
   payload.props / zones.wagon_yard / minigameSlots draw through world/props.js.
   A missing surface layer still uses the ground path masks. */
(function(){
const ALLOW=["https://ambrandt94.github.io","http://localhost:4202","https://map.4thtower.com","https://trailbound-world-map.pages.dev"];
const BIOME_DEFAULT=["Water","Sand","Plains","Meadow","Forest","DarkForest","Hills","Heath","Marsh","Mountain","Snow","Taiga","Desert","Jungle","Ashlands"];
const GROUND_DEFAULT=["grass","dirt","road","lot","plaza","water","sand","rock"];
const FACE={N:Math.PI,S:0,E:Math.PI/2,W:-Math.PI/2};
const SLOPE_MAX=Math.tan(35*Math.PI/180);
/* Dry towns sit just above the sheet (waterY+0.02) so the ocean does not cover them. */
const WATER_HOLD=0.2;

let ctx=null,active=false,builtHash="",queued=null,queuedFrom=null,currentPayload=null;
let gw=0,gh=0,meters=1,waterWalk=0.04,skirtY=-1.5,gridOffX=0,gridOffZ=0,hasRing=false,solidMask=null;
let heights=null,ground=null,groundLegend=GROUND_DEFAULT,biome=null,biomeLegend=BIOME_DEFAULT,placeMask=null,surfaceGrid=null;
let minigameSlots=[],respawnAnchor=null,settlementInfo=null;
const DRY_FALLBACK={Sand:1,Hills:1,Heath:1,Badlands:1,Desert:1,Ashlands:1,Mountain:1,Snow:1};
/* Forest and Mountain ring lists. biomes_48.json is authoritative once it has loaded. */
const RING_DRESS={
Forest:[
{kit:"tree_oak_l",w:3},{kit:"tree_beech_l",w:1},{kit:"tree_birch_m",w:1},{kit:"tree_pine_m",w:1},
{kit:"bush_fern_m",w:2},{kit:"log_fallen_m",w:1},{kit:"stump_s",w:1},{kit:"mushroom_cluster_red",w:1},{kit:"rock_mossy_cool_m",w:1}
],
Mountain:[
{kit:"tree_pine_m",w:3},{kit:"tree_juniper_s",w:1},
{kit:"rock_outcrop_cool_l",w:2},{kit:"rock_scree_s",w:2},{kit:"rock_boulder_cool_l",w:1},{kit:"prop_cairn",w:1},{kit:"bush_alpine_s",w:2}
]
};
function biomeBook(){return window.TBTiles&&TBTiles.biomeBook&&TBTiles.biomeBook();}
function biomeRec(name){
const book=biomeBook();
if(!name)return null;
if(book&&book[name])return book[name];
if((name==="Heath"||name==="Badlands")&&book)return book.Heath||book.Badlands||null;
return null;
}
function isDryBiome(name){
const rec=biomeRec(name);
if(rec&&rec.dry!=null)return !!rec.dry;
return !!DRY_FALLBACK[name];
}
function ringDressFor(name){
const rec=biomeRec(name);
if(rec&&rec.ringDress&&rec.ringDress.length)return rec.ringDress;
return RING_DRESS[name]||null;
}
function readHooks(p){
const slots=Array.isArray(p&&p.minigameSlots)?p.minigameSlots.slice():[];
const st=p&&p.area&&p.area.settlement||null;
return {minigameSlots:slots,settlement:st,respawnAnchor:st&&st.respawnAnchor||null};
}
let group=null,spawnPos={x:0,z:0,y:0,yaw:Math.PI},areaName="",bxCleared=false;
let paintOpt=null,groundMesh=null,heightSpan=null;

function on(el,ev,fn){if(el&&el.addEventListener)el.addEventListener(ev,fn);}
function areaParam(){
try{return new URLSearchParams(location.search).get("area");}catch(e){return null;}
}
function requested(){return !!areaParam();}
function curtain(on){
if(typeof document==="undefined")return;
let s=document.getElementById("tb-area-curtain");
if(on){
if(s)return;
s=document.createElement("style");s.id="tb-area-curtain";
s.textContent="#c{visibility:hidden}";
document.head.appendChild(s);
}else if(s&&s.parentNode)s.parentNode.removeChild(s);
}
function decodeU8(layer,n){
if(!layer)return null;
let src=layer;
if(layer.enc||layer.data)src=layer.data!=null?layer.data:null;
if(!src)return null;
let out;
if(Array.isArray(src))out=Uint8Array.from(src);
else if(typeof src==="string"){
const bin=atob(src),u=new Uint8Array(bin.length);
for(let i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i)&255;
out=u;
}else if(src.length!=null)out=Uint8Array.from(src);
else return null;
if(n!=null&&out.length!==n)return null;
return out;
}
function legendOf(layer,fallback){
if(layer&&Array.isArray(layer.legend)&&layer.legend.length)return layer.legend;
return fallback;
}
function payloadHash(p){
if(p.meta&&p.meta.hash)return String(p.meta.hash);
const s=JSON.stringify(p.grid||"")+":"+JSON.stringify(p.layers||"");
let h=2166136261;
for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}
return "fnv1a:"+(h>>>0).toString(16);
}
function majorOf(v){const m=/^(\d+)/.exec(String(v==null?"":v));return m?+m[1]:null;}
function validate(p){
if(!p||typeof p!=="object")return "empty payload";
if(p.type!=="trailbound.area")return "not an AreaExport";
if(majorOf(p.version)!==0)return "unsupported version "+p.version;
if(!p.grid||!(p.grid.w>0)||!(p.grid.h>0))return "grid size missing";
if(!p.area||!p.area.innerOrigin)return "innerOrigin missing";
if(!p.layers||!p.layers.biome||!p.layers.ground||!p.layers.height)return "layers missing";
const n=p.grid.w*p.grid.h;
if(!decodeU8(p.grid.mask,n))return "mask length";
if(!decodeU8(p.layers.biome,n))return "biome length";
if(!decodeU8(p.layers.ground,n))return "ground length";
const H=p.layers.height;
if(!H.raw||!H.w||!H.h||H.raw.length!==H.w*H.h)return "height samples";
return "";
}
function smooth01(t){t=t<0?0:t>1?1:t;return t*t*(3-2*t);}
/* Uniform Catmull-Rom. Passes through p1 (t=0) and p2 (t=1). */
function catmull(p0,p1,p2,p3,t){
const t2=t*t,t3=t2*t;
return 0.5*((2*p1)+(-p0+p2)*t+(2*p0-5*p1+4*p2-p3)*t2+(-p0+3*p1-3*p2+p3)*t3);
}
function hash2(ix,iz,seed){
let n=Math.imul((ix|0)+seed,374761393)^Math.imul((iz|0)-seed,668265263);
n=Math.imul(n^(n>>>13),1274126177);
return ((n^(n>>>16))>>>0)/4294967295;
}
function valueNoise(x,z,seed){
const x0=Math.floor(x),z0=Math.floor(z);
const tx=x-x0,tz=z-z0;
const sx=tx*tx*(3-2*tx),sz=tz*tz*(3-2*tz);
const a=hash2(x0,z0,seed),b=hash2(x0+1,z0,seed),c=hash2(x0,z0+1,seed),d=hash2(x0+1,z0+1,seed);
return a*(1-sx)*(1-sz)+b*sx*(1-sz)+c*(1-sx)*sz+d*sx*sz;
}
/* About ±1, strongest octave near a 3.2 m wavelength. */
function detailNoise(x,z,seed){
const f=1/3.2;
let n=0,a=1,s=1,norm=0;
for(let o=0;o<3;o++){
n+=a*(valueNoise(x*f*s+o*13.2,z*f*s-o*9.4,seed+o*17)*2-1);
norm+=a;a*=0.5;s*=2.15;
}
let v=norm?n/norm:0;
if(v<-1)v=-1;else if(v>1)v=1;
return v;
}
function hashStr(s){
let h=2166136261;s=String(s==null?"area":s);
for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}
return h>>>0;
}
function prepare(p){
const w=p.grid.w|0,h=p.grid.h|0,n=w*h;
const mask=decodeU8(p.grid.mask,n);
const bio=decodeU8(p.layers.biome,n);
const gnd=decodeU8(p.layers.ground,n);
const border=p.grid.borderMask?decodeU8(p.grid.borderMask,n):null;
const bioL=legendOf(p.layers.biome,BIOME_DEFAULT);
const gndL=legendOf(p.layers.ground,GROUND_DEFAULT);
const surface=p.layers&&p.layers.surface?decodeU8(p.layers.surface,n):null;
const units=p.units||{};
const m=+units.metersPerTile||1;
const zone=+units.zoneScale||8;
const H=p.layers.height;
const raw=H.raw;
let rawMin=Infinity,rawMax=-Infinity;
for(let i=0;i<raw.length;i++){const v=+raw[i];if(v<rawMin)rawMin=v;if(v>rawMax)rawMax=v;}
if(!isFinite(rawMin)){rawMin=0;rawMax=1;}
if(isFinite(+H.minRaw)&&isFinite(+H.maxRaw)&&+H.maxRaw>+H.minRaw){rawMin=+H.minRaw;rawMax=+H.maxRaw;}
const span=rawMax-rawMin||1;
const relief=H.reliefMeters==null?6*(H.reliefBiomeMultiplier==null?1:+H.reliefBiomeMultiplier):+H.reliefMeters;
const fine=H.sampling==="world-subdiv";
const subdiv=fine?(isFinite(+H.subdivMeters)&&+H.subdivMeters>0?+H.subdivMeters:2):0;
let step=fine?subdiv*m:zone*m;
if(!(step>0))step=zone*m||8;
let originX,originZ;
const inner=p.area.innerOrigin||{x:0,y:0};
const oc=(H.originInner&&H.originInner.x!=null)?H.originInner:H.originCorner;
if(oc&&oc.x!=null&&oc.y!=null){
let ox=+oc.x,oy=+oc.y;
if(fine){
const asInner=Math.abs(ox-inner.x)+Math.abs(oy-inner.y);
const asTile=Math.abs(ox*zone-inner.x)+Math.abs(oy*zone-inner.y);
if(Math.abs(inner.x)>zone*4&&asTile+zone<asInner){ox*=zone;oy*=zone;}
originX=(ox-inner.x)*m;
originZ=(oy-inner.y)*m;
}else{
originX=(ox*zone-inner.x)*m;
originZ=(oy*zone-inner.y)*m;
}
}else{
const wb=p.area.worldBounds||{};
const tilesX=(wb.x1!=null&&wb.x0!=null)?(wb.x1-wb.x0):w/zone;
const tilesY=(wb.y1!=null&&wb.y0!=null)?(wb.y1-wb.y0):h/zone;
originX=-((H.w-(tilesX+1))/2)*step;
originZ=-((H.h-(tilesY+1))/2)*step;
}
let offX=0,offZ=0;
const go=p.grid.originInner;
if(go&&go.x!=null&&go.y!=null){offX=(+go.x-inner.x)*m;offZ=(+go.y-inner.y)*m;}
function atRaw(ix,iz){
if(ix<0)ix=0;else if(ix>H.w-1)ix=H.w-1;
if(iz<0)iz=0;else if(iz>H.h-1)iz=H.h-1;
return +raw[iz*H.w+ix];
}
function remapRaw(v){
let t=(v-rawMin)/span;
if(t<0)t=0;else if(t>1)t=1;
return t*relief;
}
function sampleH(ix,iz){return remapRaw(atRaw(ix,iz));}
/* Catmull-Rom on the remapped lattice. Knots stay on
   t = clamp((raw-minRaw)/(maxRaw-minRaw), 0, 1); y = t*relief.
   baseAt is that contract. heightAt then applies a capped local stretch. */
function baseAt(x,z){
let gx=(x-originX)/step,gz=(z-originZ)/step;
if(gx<0)gx=0;else if(gx>H.w-1)gx=H.w-1;
if(gz<0)gz=0;else if(gz>H.h-1)gz=H.h-1;
const x1=Math.floor(gx),z1=Math.floor(gz);
const tx=gx-x1,tz=gz-z1;
if(tx===0&&tz===0)return sampleH(x1,z1);
function row(iz){return catmull(sampleH(x1-1,iz),sampleH(x1,iz),sampleH(x1+1,iz),sampleH(x1+2,iz),tx);}
let y=catmull(row(z1-1),row(z1),row(z1+1),row(z1+2),tz);
if(y<0)y=0;else if(y>relief)y=relief;
return y;
}
const sea=units.seaLevel==null||!isFinite(+units.seaLevel)?0.36:+units.seaLevel;
let waterY=(sea-rawMin)/span*relief;
const spec=p.layers.water;
if(spec&&typeof spec.level==="number"&&isFinite(spec.level))waterY=spec.level;
/* present false is explicit. A missing flag (Goldmere) still follows the height. */
const waterPresent=!!(spec&&spec.present);
const waterHeld=!!(spec&&spec.present===false);
const detailAmp=H.detailMeters==null?0.3:Math.max(0,+H.detailMeters);
const detailSeed=hashStr((p.area&&p.area.id)||(p.meta&&p.meta.hash)||"area");
function detailAt(x,z){return detailAmp?detailAmp*detailNoise(x,z,detailSeed):0;}
const flatNames={road:1,lot:1,plaza:1,cobble_lot:1};
const flat=new Uint8Array(n);
const solid=border?new Uint8Array(n):null;
for(let i=0;i<n;i++){
const live=!border||!!mask[i]||!!border[i];
if(solid)solid[i]=live?1:0;
if(!live)continue;
if(flatNames[gndL[gnd[i]]||""])flat[i]=1;
if(surface&&surface[i]>=1&&surface[i]<=7)flat[i]=1;
}
const built=lotPads(p.buildings||[],inner,m,offX,offZ,w,h,mask);
const footprints=built.footprints,pads=built.pads,padCells=built.padCells;
let hasRing=false;
if(border)for(let i=0;i<border.length;i++)if(border[i]){hasRing=true;break;}
const waterId=gndL.indexOf("water");
const waterDist=chamferFrom(function(i){
if(solid&&!solid[i])return false;
return waterId>=0&&gnd[i]===waterId;
},w,h);
const waterSrc=new Float32Array(n);
if(waterId>=0)for(let i=0;i<n;i++){
if(solid&&!solid[i])continue;
if(gnd[i]===waterId)waterSrc[i]=1;
}
const waterBlur=gaussBlur(waterSrc,w,h,3);
/* The export window is wider than the samples, so a faithful remap can be
   only a couple of metres. Stretch the playable land toward ~7 m, never
   past 10 m, and never more than 4×. Water level is not moved. */
let pLo=Infinity,pHi=-Infinity,pN=0;
for(let iz=0;iz<h;iz++)for(let ix=0;ix<w;ix++){
const i=iz*w+ix;
if(mask&&!mask[i])continue;
if(waterId>=0&&gnd[i]===waterId)continue;
const y=baseAt(offX+(ix+0.5)*m,offZ+(iz+0.5)*m);
if(y<pLo)pLo=y;if(y>pHi)pHi=y;pN++;
}
if(pN<8){
pLo=Infinity;pHi=-Infinity;
for(let iz=0;iz<H.h;iz++)for(let ix=0;ix<H.w;ix++){
const y=sampleH(ix,iz);
if(y<pLo)pLo=y;if(y>pHi)pHi=y;
}
}
const pSpan=pHi>pLo?pHi-pLo:0;
let reliefGain=1,reliefPivot=(pLo+pHi)*0.5;
if(pSpan>0.2&&pSpan<5.5){
const goal=pSpan<4?7:6;
reliefGain=Math.min(4,goal/pSpan);
if(pSpan*reliefGain>10)reliefGain=10/pSpan;
}
const waterNear=waterPresent&&waterY>=pLo-2&&waterY<=pHi+2;
if(waterNear)reliefPivot=waterY;
/* Stretch is applied to the smoothed field, then capped so the steepest
   playable slope stays under about 35 degrees. */
let maxBase=0;
for(let iz=1;iz<h-1;iz+=2)for(let ix=1;ix<w-1;ix+=2){
const i=iz*w+ix;
if(mask&&!mask[i]&&!(border&&border[i]))continue;
const x=offX+ix*m,z=offZ+iz*m;
const sx=(baseAt(x+1,z)-baseAt(x-1,z))*0.5;
const sz=(baseAt(x,z+1)-baseAt(x,z-1))*0.5;
const s=Math.hypot(sx,sz);
if(s>maxBase)maxBase=s;
}
if(maxBase>1e-4&&reliefGain>SLOPE_MAX/maxBase)reliefGain=SLOPE_MAX/maxBase;
function heightAt(x,z){
const y=baseAt(x,z);
if(reliefGain===1)return y;
return reliefPivot+(y-reliefPivot)*reliefGain;
}
const polylines=(p.roads&&p.roads.polylines)||[];
return {w:w,h:h,mask:mask,border:border,hasRing:hasRing,solid:solid,biome:bio,ground:gnd,biomeLegend:bioL,groundLegend:gndL,surface:surface,polylines:polylines,innerOrigin:inner,version:String(p.version||""),meters:m,relief:relief,heightAt:heightAt,baseAt:baseAt,reliefGain:reliefGain,reliefPivot:reliefPivot,detailAt:detailAt,detailAmp:detailAmp,detailSeed:detailSeed,waterY:waterY,waterPresent:waterPresent,waterHeld:waterHeld,rawMin:rawMin,rawMax:rawMax,originX:originX,originZ:originZ,step:step,offX:offX,offZ:offZ,flat:flat,footprints:footprints,pads:pads,padCells:padCells,waterDist:waterDist,waterBlur:waterBlur};
}
function cellName(ids,legend,ix,iz){
if(ix<0||iz<0||ix>=gw||iz>=gh)return "";
const id=ids[iz*gw+ix];
return legend[id]||"";
}
function worldCell(x,z){
return [Math.floor((x-gridOffX)/meters),Math.floor((z-gridOffZ)/meters)];
}
function cellLive(ix,iz){
if(!solidMask)return true;
if(ix<0||iz<0||ix>=gw||iz>=gh)return true;
return !!solidMask[iz*gw+ix];
}
function groundNameAt(x,z){
const c=worldCell(x,z);
if(!cellLive(c[0],c[1]))return "grass";
return cellName(ground,groundLegend,c[0],c[1])||"grass";
}
function biomeNameAt(x,z){
const c=worldCell(x,z);
if(!cellLive(c[0],c[1]))return "Plains";
return cellName(biome,biomeLegend,c[0],c[1])||"Meadow";
}
function insideAt(x,z){
const c=worldCell(x,z),ix=c[0],iz=c[1];
if(!placeMask||ix<0||iz<0||ix>=gw||iz>=gh)return false;
return !!placeMask[iz*gw+ix];
}
/* Outside the place mask the stored byte is 0 (Water). Spread the nearest
   inside biome across that apron so the skirt is not a grass fringe.
   A v0.3 border cell already has its own biome; leave it alone. */
function floodBiome(bio,mask,w,h,border){
const out=new Uint8Array(bio);
const seen=new Uint8Array(w*h);
const q=new Int32Array(w*h);
let qh=0,qt=0;
for(let i=0;i<w*h;i++){
/* Ring and void already have their own bytes. Void is off-world: leave it sealed. */
if(border&&!mask[i]){seen[i]=1;continue;}
if(mask[i]){seen[i]=1;q[qt++]=i;}
}
while(qh<qt){
const i=q[qh++],x=i%w;
const nbs=[];
if(x>0)nbs.push(i-1);
if(x+1<w)nbs.push(i+1);
if(i>=w)nbs.push(i-w);
if(i+w<w*h)nbs.push(i+w);
for(let k=0;k<nbs.length;k++){
const j=nbs[k];
if(seen[j])continue;
seen[j]=1;out[j]=out[i];q[qt++]=j;
}
}
return out;
}
/* Drop isolated one-cell biomes before the edge masks are baked. A cell
   changes only when it has a full neighbourhood and fewer than two of
   those neighbours agree with it. The 1×1 bake tests never see this. */
function smoothBiomeField(bio,w,h){
let src=bio;
for(let pass=0;pass<2;pass++){
const dst=new Uint8Array(src);
const tally=new Uint8Array(16);
for(let iz=0;iz<h;iz++)for(let ix=0;ix<w;ix++){
tally.fill(0);
let nb=0,same=0;
const self=src[iz*w+ix];
for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++){
if(!dx&&!dz)continue;
const x=ix+dx,z=iz+dz;
if(x<0||z<0||x>=w||z>=h)continue;
const b=src[z*w+x];
tally[b]++;nb++;
if(b===self)same++;
}
if(nb<5||same>=2)continue;
let best=self,bn=-1;
for(let b=0;b<16;b++){
if(tally[b]>bn||(tally[b]===bn&&b===self)){best=b;bn=tally[b];}
}
dst[iz*w+ix]=best;
}
src=dst;
}
return src;
}
function biomeIdAt(x,z){
const c=worldCell(x,z);
let ix=c[0],iz=c[1];
if(solidMask&&ix>=0&&iz>=0&&ix<gw&&iz<gh&&!solidMask[iz*gw+ix])return 2;
if(ix<0)ix=0;else if(ix>=gw)ix=gw-1;
if(iz<0)iz=0;else if(iz>=gh)iz=gh-1;
if(!biome)return 2;
const id=biome[iz*gw+ix];
return id<=14?id:2;
}
function surfaceAt(x,z){
if(surfaceGrid){
const c=worldCell(x,z),ix=c[0],iz=c[1];
if(ix>=0&&iz>=0&&ix<gw&&iz<gh){
const v=surfaceGrid[iz*gw+ix];
if(v===1||v===2||v===10)return 1;
if(v>=3&&v<=6)return 2;
if(v===7)return 3;
}
}
const n=groundNameAt(x,z);
if(n==="road")return 2;
if(n==="dirt")return 1;
if(n==="lot"||n==="plaza"||n==="cobble_lot")return 3;
return 0;
}
function chamferFrom(isSource,w,h){
const INF=1e6,dist=new Float32Array(w*h);
for(let i=0;i<dist.length;i++)dist[i]=isSource(i)?0:INF;
for(let y=0;y<h;y++)for(let x=0;x<w;x++){
const i=y*w+x;
if(x)dist[i]=Math.min(dist[i],dist[i-1]+1);
if(y)dist[i]=Math.min(dist[i],dist[i-w]+1);
if(x&&y)dist[i]=Math.min(dist[i],dist[i-w-1]+1.4142);
if(y&&x+1<w)dist[i]=Math.min(dist[i],dist[i-w+1]+1.4142);
}
for(let y=h-1;y>=0;y--)for(let x=w-1;x>=0;x--){
const i=y*w+x;
if(x+1<w)dist[i]=Math.min(dist[i],dist[i+1]+1);
if(y+1<h)dist[i]=Math.min(dist[i],dist[i+w]+1);
if(x+1<w&&y+1<h)dist[i]=Math.min(dist[i],dist[i+w+1]+1.4142);
if(x&&y+1<h)dist[i]=Math.min(dist[i],dist[i+w-1]+1.4142);
}
return dist;
}
function skirtField(mask,w,h){
return chamferFrom(function(i){return !!mask[i];},w,h);
}
function neighborCells(ix,iz,w,h){
const cs=[];
if(ix>0&&iz>0)cs.push((iz-1)*w+(ix-1));
if(ix<w&&iz>0)cs.push((iz-1)*w+ix);
if(ix>0&&iz<h)cs.push(iz*w+(ix-1));
if(ix<w&&iz<h)cs.push(iz*w+ix);
return cs;
}
function onFootprint(field,x,z){
const rs=field.footprints;
if(!rs)return false;
for(let i=0;i<rs.length;i++){
const r=rs[i];
if(x>=r.x0-0.35&&x<=r.x1+0.35&&z>=r.z0-0.35&&z<=r.z1+0.35)return true;
}
return false;
}
/* Painted water only nudges the shore. The line itself is the smooth height. */
function shoreBiasAt(field,x,z){
const blur=field.waterBlur,m=field.meters||1,w=field.w,h=field.h;
let b=0;
if(blur&&w&&h){
const gx=(x-(field.offX||0))/m-0.5,gz=(z-(field.offZ||0))/m-0.5;
const x0=Math.floor(gx),z0=Math.floor(gz),tx=gx-x0,tz=gz-z0;
function bl(ix,iz){
if(ix<0)ix=0;else if(ix>=w)ix=w-1;
if(iz<0)iz=0;else if(iz>=h)iz=h-1;
return blur[iz*w+ix];
}
const a=bl(x0,z0),c=bl(x0+1,z0),d=bl(x0,z0+1),e=bl(x0+1,z0+1);
b=a*(1-tx)*(1-tz)+c*tx*(1-tz)+d*(1-tx)*tz+e*tx*tz;
}
const n=(valueNoise(x*0.16,z*0.16,(field.detailSeed||1)+91)-0.5)*0.75;
return (b-0.45)*0.7+n;
}
function beachWidthAt(ix,iz){
return 3+3*valueNoise(ix*0.17,iz*0.17,17);
}
/* Detail stays off roads, lots, plazas and footprints, and fades on steep ground. */
function detailDamp(field,x,z,ix,iz){
const cs=neighborCells(ix,iz,field.w,field.h);
let damp=1;
if(field.flat&&cs.length){
for(let k=0;k<cs.length;k++)if(field.flat[cs[k]]){damp=0;break;}
}
if(damp&&onFootprint(field,x,z))damp=0;
if(damp){
const e=0.5;
const sx=(field.heightAt(x+e,z)-field.heightAt(x-e,z))/(e*2);
const sz=(field.heightAt(x,z+e)-field.heightAt(x,z-e))/(e*2);
damp*=1-smooth01((Math.hypot(sx,sz)-0.22)/0.55);
}
return damp;
}
/* After the beach, no edge may rise faster than about 35 degrees.
   Outside-mask verts are not a floor, so the skirt does not carve the land. */
function relaxSlopes(grid,wet,outside,vx,vz,m,waterY){
const diag=m*Math.SQRT2;
const next=new Float32Array(grid.length);
const dirs=[[1,0,m],[-1,0,m],[0,1,m],[0,-1,m],[1,1,diag],[-1,-1,diag],[1,-1,diag],[-1,1,diag]];
for(let pass=0;pass<28;pass++){
let moved=0;
for(let iz=0;iz<vz;iz++)for(let ix=0;ix<vx;ix++){
const o=iz*vx+ix;
if(wet[o]){next[o]=waterY;continue;}
let cap=grid[o];
for(let k=0;k<dirs.length;k++){
const jx=ix+dirs[k][0],jz=iz+dirs[k][1];
if(jx<0||jz<0||jx>=vx||jz>=vz)continue;
const jo=jz*vx+jx;
if(outside[jo]&&!wet[jo])continue;
const lim=grid[jo]+SLOPE_MAX*dirs[k][2];
if(lim<cap)cap=lim;
}
if(grid[o]-cap>1e-3)moved++;
next[o]=cap;
}
grid.set(next);
if(!moved)break;
}
}
/* Footprint plus yard, one pad per building. A mask-less lot uses its whole plot. */
function lotPads(buildings,inner,m,offX,offZ,gw,gh,mask){
const footprints=[],pads=[],padCells=new Uint8Array(gw*gh);
const sideOf={N:[0,-1],S:[0,1],E:[1,0],W:[-1,0]};
function addCell(list,ix,iz){
if(ix<0||iz<0||ix>=gw||iz>=gh)return;
if(mask&&!mask[iz*gw+ix])return;
const i=iz*gw+ix;
if(padCells[i])return;
padCells[i]=1;list.push(i);
}
for(let bi=0;bi<buildings.length;bi++){
const b=buildings[bi];
if(!b||!isFinite(+b.x)||!isFinite(+b.y))continue;
const cells=[];
let door=null;
const tiles=b.tiles,tw=tiles?tiles.w|0:0,th=tiles?tiles.h|0:0;
const grid=tw&&th?decodeU8(tiles,tw*th):null;
if(grid){
const legend=legendOf(tiles,["void","yard","floor","wall","door","window","tower"]);
const plotX=b.plotX!=null?+b.plotX:+b.x-(+b.footW||tw)/2;
const plotY=b.plotY!=null?+b.plotY:+b.y-(+b.footD||th);
const ox=(plotX-inner.x)*m,oz=(plotY-inner.y)*m;
let dx=0,dz=0,dn=0;
for(let ty=0;ty<th;ty++)for(let tx=0;tx<tw;tx++){
const name=legend[grid[ty*tw+tx]]||"void";
if(name==="void")continue;
const x=ox+tx*m,z=oz+ty*m;
addCell(cells,Math.floor((x+0.5*m-offX)/m),Math.floor((z+0.5*m-offZ)/m));
if(name==="door"){dx+=x+0.5*m;dz+=z+0.5*m;dn++;}
}
if(dn){
dx/=dn;dz/=dn;
const s=sideOf[String(b.door||"S").toUpperCase()]||sideOf.S;
const outX=dx+s[0]*(0.5*m+0.8),outZ=dz+s[1]*(0.5*m+0.8);
door={x:outX,z:outZ};
addCell(cells,Math.floor((outX-offX)/m),Math.floor((outZ-offZ)/m));
}
}else{
const fw=Math.max(2,+b.footW||10),fd=Math.max(2,+b.footD||8);
const ax=(+b.x-inner.x)*m,az=(+b.y-inner.y)*m;
const x0=ax-fw/2,z0=az-fd,x1=ax+fw/2,z1=az;
for(let iz=Math.floor((z0-offZ)/m);iz<Math.ceil((z1-offZ)/m);iz++)for(let ix=Math.floor((x0-offX)/m);ix<Math.ceil((x1-offX)/m);ix++)addCell(cells,ix,iz);
door={x:ax,z:az+0.85};
}
if(!cells.length)continue;
let x0=Infinity,z0=Infinity,x1=-Infinity,z1=-Infinity;
for(let k=0;k<cells.length;k++){
const i=cells[k],ix=i%gw,iz=(i/gw)|0;
const x=offX+ix*m,z=offZ+iz*m;
if(x<x0)x0=x;if(z<z0)z0=z;if(x+m>x1)x1=x+m;if(z+m>z1)z1=z+m;
}
footprints.push({x0:x0,z0:z0,x1:x1,z1:z1});
pads.push({cells:cells,door:door});
}
return {footprints:footprints,pads:pads,padCells:padCells};
}
/* A flat pad, then a ramp no steeper than about 35 degrees back into the hills. */
function applyPads(field,grid,vx,vz,m){
const pads=field.pads,w=field.w;
if(!pads||!pads.length)return;
const pinned=new Uint8Array(vx*vz);
const acc=new Float32Array(vx*vz);
const cnt=new Uint16Array(vx*vz);
for(let p=0;p<pads.length;p++){
const cells=pads[p].cells;
let sum=0,n=0;
const verts=[];
for(let k=0;k<cells.length;k++){
const i=cells[k],ix=i%w,iz=(i/w)|0;
const c=[iz*vx+ix,iz*vx+ix+1,(iz+1)*vx+ix,(iz+1)*vx+ix+1];
let a=0;
for(let v=0;v<4;v++)a+=grid[c[v]];
sum+=a*0.25;n++;
for(let v=0;v<4;v++)verts.push(c[v]);
}
if(!n)continue;
const y=sum/n;
for(let v=0;v<verts.length;v++){
const o=verts[v];
acc[o]+=y;cnt[o]++;pinned[o]=1;
}
}
for(let o=0;o<pinned.length;o++)if(pinned[o])grid[o]=acc[o]/cnt[o];
const diag=m*Math.SQRT2;
const dirs=[[1,0,m],[-1,0,m],[0,1,m],[0,-1,m],[1,1,diag],[-1,-1,diag],[1,-1,diag],[-1,1,diag]];
let src=pinned;
for(let pass=0;pass<32;pass++){
const nextSrc=new Uint8Array(src);
const next=new Float32Array(grid);
let moved=0;
for(let iz=0;iz<vz;iz++)for(let ix=0;ix<vx;ix++){
const o=iz*vx+ix;
if(pinned[o])continue;
let lo=-Infinity,hi=Infinity,hit=false;
for(let k=0;k<dirs.length;k++){
const jx=ix+dirs[k][0],jz=iz+dirs[k][1];
if(jx<0||jz<0||jx>=vx||jz>=vz)continue;
const jo=jz*vx+jx;
if(!src[jo])continue;
hit=true;
const lim=SLOPE_MAX*dirs[k][2];
const ny=grid[jo];
if(ny-lim>lo)lo=ny-lim;
if(ny+lim<hi)hi=ny+lim;
}
if(!hit)continue;
let y=grid[o];
if(lo>hi)y=(lo+hi)*0.5;
else if(y<lo)y=lo;
else if(y>hi)y=hi;
if(Math.abs(y-grid[o])>1e-4){next[o]=y;nextSrc[o]=1;moved++;}
}
if(!moved)break;
grid.set(next);
src=nextSrc;
}
}
function sampleGrid(field){
const m=field.meters,w=field.w,h=field.h,vx=w+1,vz=h+1;
const ring=!!field.hasRing;
const dist=ring?null:skirtField(field.mask,w,h);
const grid=new Float32Array(vx*vz);
const wet=new Uint8Array(vx*vz);
const outside=new Uint8Array(vx*vz);
const skirt=field.waterY-1.45;
const offX=field.offX||0,offZ=field.offZ||0;
for(let iz=0;iz<vz;iz++)for(let ix=0;ix<vx;ix++){
const o=iz*vx+ix;
const cs=neighborCells(ix,iz,w,h);
const x=offX+ix*m,z=offZ+iz*m;
grid[o]=field.heightAt(x,z);
if(!ring){
let best=8;
if(cs.length){
best=1e6;
for(let k=0;k<cs.length;k++)if(dist[cs[k]]<best)best=dist[cs[k]];
}
if(best>0.5)outside[o]=1;
}
/* A vertex is playable only when every cell it touches is inside the mask.
   Those stay dry when water.present is false. Coast vertices still meet the ocean. */
let playable=false;
if(field.waterHeld&&field.mask&&cs.length){
playable=true;
for(let k=0;k<cs.length;k++)if(!field.mask[cs[k]]){playable=false;break;}
}
if(playable){
const floor=field.waterY+WATER_HOLD;
if(grid[o]<floor)grid[o]=floor;
}else if(!outside[o]&&grid[o]-shoreBiasAt(field,x,z)<=field.waterY)wet[o]=1;
}
const shore=chamferFrom(function(i){return !!wet[i];},vx,vz);
for(let iz=0;iz<vz;iz++)for(let ix=0;ix<vx;ix++){
const o=iz*vx+ix;
if(wet[o]){grid[o]=field.waterY;continue;}
if(outside[o])continue;
const d=shore[o]*m;
const width=beachWidthAt(ix,iz);
if(!(d<width))continue;
const t=smooth01(d/width);
let eased=field.waterY+(grid[o]-field.waterY)*t;
const cap=field.waterY+SLOPE_MAX*d;
if(eased>cap)eased=cap;
if(eased<field.waterY)eased=field.waterY;
grid[o]=eased;
}
for(let iz=0;iz<vz;iz++)for(let ix=0;ix<vx;ix++){
const o=iz*vx+ix;
if(wet[o]||outside[o])continue;
const cs=neighborCells(ix,iz,w,h);
if(field.padCells&&cs.length){
let onPad=false;
for(let k=0;k<cs.length;k++)if(field.padCells[cs[k]]){onPad=true;break;}
if(onPad)continue;
}
const d=shore[o]*m;
if(d<beachWidthAt(ix,iz)+0.35)continue;
const x=offX+ix*m,z=offZ+iz*m;
const damp=detailDamp(field,x,z,ix,iz);
if(damp>0&&field.detailAt)grid[o]+=field.detailAt(x,z)*damp;
}
relaxSlopes(grid,wet,outside,vx,vz,m,field.waterY);
if(!ring){
for(let iz=0;iz<vz;iz++)for(let ix=0;ix<vx;ix++){
const o=iz*vx+ix;
const cs=neighborCells(ix,iz,w,h);
let best=8;
if(cs.length){
best=1e6;
for(let k=0;k<cs.length;k++)if(dist[cs[k]]<best)best=dist[cs[k]];
}
const t=smooth01(best/7);
grid[o]=grid[o]*(1-t)+skirt*t;
}
}
const lake=new Uint8Array(w*h);
for(let iz=0;iz<h;iz++)for(let ix=0;ix<w;ix++){
if(field.solid&&!field.solid[iz*w+ix])continue;
/* No water sheet on the playable mask when the export says water is absent. */
if(field.waterHeld&&field.mask&&field.mask[iz*w+ix])continue;
const x=offX+(ix+0.5)*m,z=offZ+(iz+0.5)*m;
if(field.heightAt(x,z)-shoreBiasAt(field,x,z)<=field.waterY)lake[iz*w+ix]=1;
}
if(field.padCells)for(let i=0;i<lake.length;i++)if(field.padCells[i])lake[i]=0;
field.lake=lake;
field.lakeDist=chamferFrom(function(i){return !!lake[i];},w,h);
applyPads(field,grid,vx,vz,m);
if(field.waterHeld&&field.mask){
const floor=field.waterY+WATER_HOLD;
for(let iz=0;iz<vz;iz++)for(let ix=0;ix<vx;ix++){
const cs=neighborCells(ix,iz,w,h);
if(!cs.length)continue;
let playable=true;
for(let k=0;k<cs.length;k++)if(!field.mask[cs[k]]){playable=false;break;}
if(!playable)continue;
const o=iz*vx+ix;
if(grid[o]<floor)grid[o]=floor;
}
}
return {heights:grid,skirtY:skirt,vx:vx,vz:vz,wet:wet};
}
function maskDistAt(field,ix,iz){
if(!field.hasRing)return 0;
const dist=field._maskDist||(field._maskDist=skirtField(field.mask,field.w,field.h));
const cs=neighborCells(ix,iz,field.w,field.h);
if(!cs.length)return 64;
let md=1e6;
for(let k=0;k<cs.length;k++)if(dist[cs[k]]<md)md=dist[cs[k]];
if(md<=0)return 0;
return md*field.meters;
}
/* Metres to the outer rim: the grid edge, or a void cell. The last 8 m fades to sky. */
function rimDistAt(field,ix,iz){
const w=field.w,h=field.h;
let d=Math.min(ix,iz,w-ix,h-iz);
const vd=field._voidDist||(field._voidDist=chamferFrom(function(i){
if(!field.border)return false;
return !field.mask[i]&&!field.border[i];
},w,h));
const cs=neighborCells(ix,iz,w,h);
for(let k=0;k<cs.length;k++)if(vd[cs[k]]<d)d=vd[cs[k]];
return d*field.meters;
}
/* Soften road and dirt cells into a tube. Blurring only the mask rounds
   the corners but leaves multi-metre treads, which still read as stairs.
   Blur far enough to melt those treads, then stroke a narrow ribbon along
   the ridge so a two-metre road stays about two metres wide. */
function ribbonCover(road,dirt,w,h,meters,yards){
meters=meters||1;
const worldW=w*meters,worldH=h*meters;
let spp=4;
if(worldW*spp>512)spp=512/worldW;
if(worldH*spp>512)spp=Math.min(spp,512/worldH);
spp=Math.max(1.25,spp);
const tw=Math.max(2,Math.round(worldW*spp)),th=Math.max(2,Math.round(worldH*spp));
const roadC=new Float32Array(tw*th),dirtC=new Float32Array(tw*th);
function paint(mask,cov){
if(!mask)return;
const src=new Float32Array(tw*th);
for(let y=0;y<th;y++)for(let x=0;x<tw;x++){
const wx=(x+0.5)/tw*worldW,wz=(y+0.5)/th*worldH;
const ix=Math.floor(wx/meters),iz=Math.floor(wz/meters);
if(ix<0||iz<0||ix>=w||iz>=h||!mask[iz*w+ix])continue;
src[y*tw+x]=1;
}
const F=gaussBlur(src,tw,th,2.2*tw/Math.max(worldW,1));
const ridge=new Uint8Array(tw*th);
/* Negative curvature across the blurred road. The band is solid, so
   thinning it leaves one centerline instead of the stair. */
for(let y=1;y<th-1;y++)for(let x=1;x<tw-1;x++){
const i=y*tw+x;
if(F[i]<0.1)continue;
const dxx=F[i+1]-2*F[i]+F[i-1],dyy=F[i+tw]-2*F[i]+F[i-tw];
const dxy=(F[i+tw+1]-F[i+tw-1]-F[i-tw+1]+F[i-tw-1])*0.25;
const tr=dxx+dyy,det=dxx*dyy-dxy*dxy;
const disc=Math.sqrt(Math.max(0,tr*tr*0.25-det));
const lam=tr*0.5-disc;
if(lam<-0.0015)ridge[i]=1;
}
const sk=thinSkel(ridge,tw,th);
const idx=new Int32Array(tw*th);
for(let i=0;i<idx.length;i++)idx[i]=-1;
const pos=[];
for(let y=0;y<th;y++)for(let x=0;x<tw;x++)if(sk[y*tw+x]){idx[y*tw+x]=pos.length;pos.push([(x+0.5)/tw*worldW,(y+0.5)/th*worldH]);}
const adj=pos.map(function(){return [];});
function link(a,b){if(a<0||b<0||a===b)return;if(adj[a].indexOf(b)<0){adj[a].push(b);adj[b].push(a);}}
for(let y=0;y<th;y++)for(let x=0;x<tw;x++){
const a=idx[y*tw+x];if(a<0)continue;
for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
if(dx<0||(dx===0&&dy<=0))continue;
const xx=x+dx,yy=y+dy;
if(xx<0||yy<0||xx>=tw||yy>=th)continue;
link(a,idx[yy*tw+xx]);
}
}
for(let i=0;i<pos.length;i++)if(adj[i].length<=1){
let best=-1,bd=1.6;
for(let j=i+1;j<pos.length;j++)if(adj[j].length<=1){
const d=Math.hypot(pos[i][0]-pos[j][0],pos[i][1]-pos[j][1]);
if(d<bd&&d>0.05){bd=d;best=j;}
}
if(best>=0)link(i,best);
}
for(let k=0;k<48;k++){
const nxt=pos.map(function(p){return [p[0],p[1]];});
for(let i=0;i<pos.length;i++){
const a=adj[i];if(a.length<2)continue;
let sx=0,sy=0;
for(let j=0;j<a.length;j++){sx+=pos[a[j]][0];sy+=pos[a[j]][1];}
nxt[i][0]=pos[i][0]*0.35+(sx/a.length)*0.65;
nxt[i][1]=pos[i][1]*0.35+(sy/a.length)*0.65;
}
for(let i=0;i<pos.length;i++){pos[i][0]=nxt[i][0];pos[i][1]=nxt[i][1];}
}
const half=0.98,feather=0.42,seen={};
for(let i=0;i<adj.length;i++){
if(!adj[i].length){strokeSeg(cov,tw,th,worldW,worldH,pos[i][0],pos[i][1],pos[i][0],pos[i][1],half,feather);continue;}
for(let j=0;j<adj[i].length;j++){
const b=adj[i][j],key=i<b?i+"-"+b:b+"-"+i;
if(seen[key])continue;seen[key]=1;
strokeSeg(cov,tw,th,worldW,worldH,pos[i][0],pos[i][1],pos[b][0],pos[b][1],half,feather);
}
}
}
paint(road,roadC);
paint(dirt,dirtC);
(yards||[]).forEach(function(r){stampRect(dirtC,tw,th,worldW,worldH,r[0],r[1],r[2],r[3],0.32);});
const data=new Uint8Array(tw*th*4);
for(let i=0;i<data.length/4;i++){
data[i*4]=Math.max(0,Math.min(255,Math.round(roadC[i]*255)));
data[i*4+1]=Math.max(0,Math.min(255,Math.round(dirtC[i]*255)));
data[i*4+3]=255;
}
return {data:data,w:tw,h:th,x0:0,z0:0,worldW:worldW,worldH:worldH};
}
function gaussBlur(src,w,h,sigma){
const r=Math.max(1,Math.ceil(sigma*2.6));
const k=new Float32Array(r*2+1);
let s=0;
for(let i=-r;i<=r;i++){const v=Math.exp(-0.5*(i*i)/(sigma*sigma));k[i+r]=v;s+=v;}
for(let i=0;i<k.length;i++)k[i]/=s;
const tmp=new Float32Array(w*h),out=new Float32Array(w*h);
for(let y=0;y<h;y++){
const row=y*w;
for(let x=0;x<w;x++){
let a=0;
for(let i=-r;i<=r;i++){
const xx=x+i;a+=src[row+(xx<0?0:xx>=w?w-1:xx)]*k[i+r];
}
tmp[row+x]=a;
}
}
for(let x=0;x<w;x++)for(let y=0;y<h;y++){
let a=0;
for(let i=-r;i<=r;i++){
const yy=y+i;a+=tmp[(yy<0?0:yy>=h?h-1:yy)*w+x]*k[i+r];
}
out[y*w+x]=a;
}
return out;
}
function thinSkel(src,w,h){
const m=new Uint8Array(src);
let changed=true,guard=0;
function at(x,y){return x<0||y<0||x>=w||y>=h?0:m[y*w+x];}
while(changed&&guard++<80){
changed=false;
for(let step=0;step<2;step++){
const del=[];
for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
if(!m[y*w+x])continue;
const n=[at(x,y-1),at(x+1,y-1),at(x+1,y),at(x+1,y+1),at(x,y+1),at(x-1,y+1),at(x-1,y),at(x-1,y-1)];
let B=0,A=0;
for(let i=0;i<8;i++){B+=n[i];if(n[i]===0&&n[(i+1)%8]===1)A++;}
if(B<2||B>6||A!==1)continue;
if(step===0){if(n[0]*n[2]*n[4]||n[2]*n[4]*n[6])continue;}
else if(n[0]*n[2]*n[6]||n[0]*n[4]*n[6])continue;
del.push(y*w+x);
}
if(del.length)changed=true;
for(let i=0;i<del.length;i++)m[del[i]]=0;
}
}
return m;
}
function strokeSeg(cov,tw,th,worldW,worldH,ax,ay,bx,by,half,feather){
const reach=half+feather+0.05;
const x0=Math.max(0,Math.floor((Math.min(ax,bx)-reach)/worldW*tw));
const x1=Math.min(tw-1,Math.ceil((Math.max(ax,bx)+reach)/worldW*tw));
const y0=Math.max(0,Math.floor((Math.min(ay,by)-reach)/worldH*th));
const y1=Math.min(th-1,Math.ceil((Math.max(ay,by)+reach)/worldH*th));
const dx=bx-ax,dy=by-ay,l2=dx*dx+dy*dy;
for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
const px=(x+0.5)/tw*worldW,py=(y+0.5)/th*worldH;
let t=l2?((px-ax)*dx+(py-ay)*dy)/l2:0;
t=t<0?0:t>1?1:t;
const d=Math.hypot(px-(ax+dx*t),py-(ay+dy*t));
const u=(half+feather-d)/(feather*2);
const c=u<=0?0:u>=1?1:u*u*(3-2*u);
const i=y*tw+x;
if(c>cov[i])cov[i]=c;
}
}
function stampRect(cov,tw,th,worldW,worldH,x0,z0,x1,z1,feather){
const tx0=Math.max(0,Math.floor((x0-feather)/worldW*tw));
const tx1=Math.min(tw-1,Math.ceil((x1+feather)/worldW*tw));
const ty0=Math.max(0,Math.floor((z0-feather)/worldH*th));
const ty1=Math.min(th-1,Math.ceil((z1+feather)/worldH*th));
for(let y=ty0;y<=ty1;y++)for(let x=tx0;x<=tx1;x++){
const px=(x+0.5)/tw*worldW,pz=(y+0.5)/th*worldH;
const dx=px<x0?x0-px:px>x1?px-x1:0,dz=pz<z0?z0-pz:pz>z1?pz-z1:0;
const d=Math.hypot(dx,dz),u=(feather-d)/Math.max(0.08,feather);
const c=u<=0?0:u>=1?1:u*u*(3-2*u);
const i=y*tw+x;
if(c>cov[i])cov[i]=c;
}
}
function pathMasks(field){
const w=field.w,h=field.h,n=w*h;
const road=new Uint8Array(n),dirt=new Uint8Array(n);
const legend=field.groundLegend,g=field.ground,mask=field.mask;
const ir=legend.indexOf("road"),id=legend.indexOf("dirt");
for(let i=0;i<n;i++){
if(mask&&!mask[i])continue;
if(g[i]===ir)road[i]=1;
else if(g[i]===id)dirt[i]=1;
}
return {road:road,dirt:dirt};
}
/* v0.6 surface: 1 path and 2 lane_gravel stay on the dirt tile until gravel
   is authored. 3–6 (cobble, flagstone, sandstone, processional) use the
   sandstone road tile. 10 boardwalk uses the path tile. */
function surfaceMasks(field){
const w=field.w,h=field.h,n=w*h,s=field.surface;
const road=new Uint8Array(n),dirt=new Uint8Array(n),mask=field.mask;
for(let i=0;i<n;i++){
if(!s)break;
if(mask&&!mask[i])continue;
const v=s[i];
if(v>=3&&v<=6)road[i]=1;
else if(v===1||v===2||v===10)dirt[i]=1;
}
return {road:road,dirt:dirt};
}
function v6Road(p){
return !!(p&&(p.widthM!=null||p.rank!=null||typeof p.surface==="string"));
}
function roadHalf(p){
let w=+p.widthM;
if(!(w>0))w=+p.width;
if(!(w>0)){
const rank=p.rank==null?3:p.rank|0;
w=rank===0?9:rank===1?6:rank===2?3:1.5;
}
return Math.max(0.4,w*0.5);
}
function roadDirt(p){
const s=String(p.surface||p.kind||"").toLowerCase();
if(/cobble|flagstone|sandstone|processional|avenue/.test(s))return false;
if(s==="street"||s==="street_cobble")return false;
if(/path|alley|gravel|lane|dirt|boardwalk/.test(s))return true;
if(p.rank==null)return true;
return (p.rank|0)>=2;
}
function polyXY(pt){
if(Array.isArray(pt))return [+pt[0],+pt[1]];
if(!pt)return null;
const y=pt.y!=null?pt.y:pt.z;
if(!isFinite(+pt.x)||!isFinite(+y))return null;
return [+pt.x,+y];
}
function toLocalXZ(x,y,field){
const m=field.meters||1,inner=field.innerOrigin||{x:0,y:0};
const ox=field.offX||0,oz=field.offZ||0,W=field.w*m,H=field.h*m;
let lx=(+x-inner.x)*m-ox,lz=(+y-inner.y)*m-oz;
if((lx<-8||lz<-8||lx>W+8||lz>H+8)&&+x>=-8&&+y>=-8&&+x<=W+8&&+y<=H+8){lx=+x-ox;lz=+y-oz;}
return [lx,lz];
}
function coverGrid(w,h,meters){
meters=meters||1;
const worldW=w*meters,worldH=h*meters;
let spp=4;
if(worldW*spp>512)spp=512/worldW;
if(worldH*spp>512)spp=Math.min(spp,512/worldH);
spp=Math.max(1.25,spp);
return {tw:Math.max(2,Math.round(worldW*spp)),th:Math.max(2,Math.round(worldH*spp)),worldW:worldW,worldH:worldH};
}
function packCover(roadC,dirtC,g){
const data=new Uint8Array(g.tw*g.th*4);
for(let i=0;i<roadC.length;i++){
data[i*4]=Math.max(0,Math.min(255,Math.round(roadC[i]*255)));
data[i*4+1]=Math.max(0,Math.min(255,Math.round(dirtC[i]*255)));
data[i*4+3]=255;
}
return {data:data,w:g.tw,h:g.th,x0:0,z0:0,worldW:g.worldW,worldH:g.worldH};
}
function polylineCover(field,polys,yards){
const g=coverGrid(field.w,field.h,field.meters);
const roadC=new Float32Array(g.tw*g.th),dirtC=new Float32Array(g.tw*g.th);
polys.forEach(function(p){
const pts=p.points||[],half=roadHalf(p),cov=roadDirt(p)?dirtC:roadC,loc=[];
for(let i=0;i<pts.length;i++){
const xy=polyXY(pts[i]);
if(!xy)continue;
loc.push(toLocalXZ(xy[0],xy[1],field));
}
for(let i=1;i<loc.length;i++)strokeSeg(cov,g.tw,g.th,g.worldW,g.worldH,loc[i-1][0],loc[i-1][1],loc[i][0],loc[i][1],half,0.42);
});
(yards||[]).forEach(function(r){stampRect(dirtC,g.tw,g.th,g.worldW,g.worldH,r[0],r[1],r[2],r[3],0.32);});
return packCover(roadC,dirtC,g);
}
/* Polylines win when they carry v0.6 fields. Otherwise a surface layer,
   and only then today's ground path masks. Old polylines (kind+width only)
   stay ignored so v0.1–v0.5 roads do not move. */
function roadCover(field,yards){
const polys=(field.polylines||[]).filter(v6Road);
if(polys.length)return polylineCover(field,polys,yards);
if(field.surface){
const masks=surfaceMasks(field);
return ribbonCover(masks.road,masks.dirt,field.w,field.h,field.meters,yards);
}
const masks=pathMasks(field);
return ribbonCover(masks.road,masks.dirt,field.w,field.h,field.meters,yards);
}
function yardRects(rows){
const out=[];
if(!rows)return out;
for(let i=0;i<rows.length;i++){
const r=rows[i];
if(!r.yard||!r.yard.dirt)continue;
out.push([r.cx-r.fw/2,r.cz-r.fd/2,r.cx+r.fw/2,r.cz+r.fd/2]);
}
return out;
}
function inYard(rows,x,z){
if(!rows)return false;
for(let i=0;i<rows.length;i++){
const r=rows[i];
if(Math.abs(x-r.cx)<=r.fw/2+0.05&&Math.abs(z-r.cz)<=r.fd/2+0.05)return true;
}
return false;
}
/* vZone is metres outside the playable mask. vEdge is metres to the outer rim.
   The ring keeps its textures, eased to about 55% saturation. Only the outer 8 m goes to sky. */
const ZONE_FADE=[
"float _d=max(vZone,0.0);",
"float _k=smoothstep(2.0,18.0,_d);",
"if(_k>0.001||vEdge<8.5){",
"float _l=dot(gl_FragColor.rgb,vec3(0.299,0.587,0.114));",
"vec3 _rgb=mix(vec3(_l),gl_FragColor.rgb,mix(1.0,0.55,_k));",
"_rgb=mix(_rgb,_rgb*vec3(0.90,0.97,1.06),_k*0.45);",
"vec3 _sky=vec3(0.20,0.45,0.85);",
"_rgb=mix(_rgb,_sky,_k*0.05);",
"float _outer=1.0-smoothstep(0.0,8.0,vEdge);",
"gl_FragColor.rgb=mix(_rgb,_sky,_outer);",
"}"
].join("");
function primeGroundMat(mat){
mat.onBeforeCompile=function(sh){
if(!sh.uniforms.uBakePass)sh.uniforms.uBakePass={value:0};
if(sh.fragmentShader.indexOf("uniform float uBakePass")<0)sh.fragmentShader="uniform float uBakePass;\n"+sh.fragmentShader;
if(sh.vertexShader.indexOf("aZone")<0){
sh.vertexShader=sh.vertexShader
.replace("#include <common>","#include <common>\nattribute float aZone;\nattribute float aEdge;\nvarying float vZone;\nvarying float vEdge;")
.replace("#include <project_vertex>","vZone=aZone;\nvEdge=aEdge;\n#include <project_vertex>");
}
if(sh.fragmentShader.indexOf("vZone")<0){
sh.fragmentShader=sh.fragmentShader.replace("#include <common>","#include <common>\nvarying float vZone;\nvarying float vEdge;");
sh.fragmentShader=sh.fragmentShader.replace("#include <fog_fragment>","if(uBakePass<0.5){"+ZONE_FADE+"}\n#include <fog_fragment>");
}
};
}
function buildMesh(field,rows){
gridOffX=field.offX||0;gridOffZ=field.offZ||0;hasRing=!!field.hasRing;
const m=field.meters,sampled=sampleGrid(field),vx=sampled.vx,vz=sampled.vz;
heights=sampled.heights;skirtY=sampled.skirtY;
const pos=new Float32Array(vx*vz*3),uv=new Float32Array(vx*vz*2),zone=new Float32Array(vx*vz),edge=new Float32Array(vx*vz);
const k=10/32,ox=gridOffX,oz=gridOffZ;
for(let iz=0;iz<vz;iz++)for(let ix=0;ix<vx;ix++){
const o=iz*vx+ix,p=o*3;
pos[p]=ox+ix*m;pos[p+1]=heights[o];pos[p+2]=oz+iz*m;
uv[o*2]=ix*m*k;uv[o*2+1]=iz*m*k;
zone[o]=maskDistAt(field,ix,iz);
edge[o]=field.hasRing?rimDistAt(field,ix,iz):80;
}
const count=field.w*field.h*6;
const idx=(vx*vz)>65535?new Uint32Array(count):new Uint16Array(count);
let q=0;
for(let iz=0;iz<field.h;iz++)for(let ix=0;ix<field.w;ix++){
const a=iz*vx+ix;
idx[q++]=a;idx[q++]=a+vx;idx[q++]=a+1;
idx[q++]=a+1;idx[q++]=a+vx;idx[q++]=a+vx+1;
}
const geo=new THREE.BufferGeometry();
geo.setAttribute("position",new THREE.BufferAttribute(pos,3));
geo.setAttribute("uv",new THREE.BufferAttribute(uv,2));
geo.setAttribute("aZone",new THREE.BufferAttribute(zone,1));
geo.setAttribute("aEdge",new THREE.BufferAttribute(edge,1));
geo.setIndex(new THREE.BufferAttribute(idx,1));
geo.computeVertexNormals();
const mat=new THREE.MeshLambertMaterial({color:0xffffff});
mat.toneMapped=false;
const yards=yardRects(rows);
if(ox||oz)for(let i=0;i<yards.length;i++){yards[i][0]-=ox;yards[i][2]-=ox;yards[i][1]-=oz;yards[i][3]-=oz;}
const rib=roadCover(field,yards);
rib.x0=ox;rib.z0=oz;
paintOpt={
biome:biomeIdAt,surface:surfaceAt,
bounds:{x0:ox-4,x1:ox+field.w*m+4,z0:oz-4,z1:oz+field.h*m+4},
ribbon:rib
};
primeGroundMat(mat);
if(window.TBTiles)TBTiles.install(mat,paintOpt);
const mesh=new THREE.Mesh(geo,mat);
mesh.name="tb-area-ground";
if(window.TBTiles&&TBTiles.noteGround)TBTiles.noteGround(mesh);
mesh.receiveShadow=true;mesh.castShadow=false;
mesh.userData.surface=1;mesh.userData.tbOwnMat=1;
groundMesh=mesh;
return mesh;
}
/* Distance to shore, in metres, on the same grid as the dithered coverage.
   Shallow water is the first few metres; deep water is the rest. */
function waterField(field){
const lake=field.lake;
const id=field.groundLegend.indexOf("water");
if(!lake&&id<0)return null;
const w=field.w,h=field.h,spp=2,tw=w*spp,th=h*spp,m=field.meters||1;
const src=new Float32Array(tw*th);
const water=new Uint8Array(tw*th);
const live=field.solid;
for(let y=0;y<th;y++)for(let x=0;x<tw;x++){
const ix=Math.min(w-1,x/spp|0),iz=Math.min(h-1,y/spp|0),i=iz*w+ix;
if(live&&!live[i])continue;
if(lake?lake[i]:field.ground[i]===id){src[y*tw+x]=1;water[y*tw+x]=1;}
}
const blur=gaussBlur(src,tw,th,1.2*spp);
let any=false;
for(let i=0;i<blur.length;i++)if(blur[i]>0.04){any=true;break;}
if(!any)return null;
const INF=1e6,dist=new Float32Array(tw*th);
for(let i=0;i<dist.length;i++)dist[i]=water[i]?INF:0;
for(let y=0;y<th;y++)for(let x=0;x<tw;x++){
const i=y*tw+x;
if(x)dist[i]=Math.min(dist[i],dist[i-1]+1);
if(y)dist[i]=Math.min(dist[i],dist[i-tw]+1);
if(x&&y)dist[i]=Math.min(dist[i],dist[i-tw-1]+1.4142);
if(y&&x+1<tw)dist[i]=Math.min(dist[i],dist[i-tw+1]+1.4142);
}
for(let y=th-1;y>=0;y--)for(let x=tw-1;x>=0;x--){
const i=y*tw+x;
if(x+1<tw)dist[i]=Math.min(dist[i],dist[i+1]+1);
if(y+1<th)dist[i]=Math.min(dist[i],dist[i+tw]+1);
if(x+1<tw&&y+1<th)dist[i]=Math.min(dist[i],dist[i+tw+1]+1.4142);
if(x&&y+1<th)dist[i]=Math.min(dist[i],dist[i+tw-1]+1.4142);
}
const step=m/spp;
const data=new Uint8Array(tw*th*4);
for(let i=0;i<tw*th;i++){
const c=Math.max(0,Math.min(255,Math.round(blur[i]*255)));
const metres=dist[i]>=INF*0.5?32:dist[i]*step;
data[i*4]=c;
data[i*4+1]=Math.max(0,Math.min(255,Math.round(metres/32*255)));
data[i*4+3]=255;
}
const tex=new THREE.DataTexture(data,tw,th,THREE.RGBAFormat,THREE.UnsignedByteType);
tex.flipY=false;tex.magFilter=tex.minFilter=THREE.LinearFilter;tex.generateMipmaps=false;
tex.wrapS=tex.wrapT=THREE.ClampToEdgeWrapping;tex.unpackAlignment=1;tex.needsUpdate=true;
const on=new Uint8Array(w*h);
for(let iz=0;iz<h;iz++)for(let ix=0;ix<w;ix++){
let mx=0;
for(let dz=0;dz<spp;dz++)for(let dx=0;dx<spp;dx++){
const v=blur[(iz*spp+dz)*tw+(ix*spp+dx)];
if(v>mx)mx=v;
}
if(mx>0.2)on[iz*w+ix]=1;
}
return {tex:tex,on:on,worldW:w*m,worldH:h*m};
}
const WATER_SHEET=[
"vec2 _pix=floor(vW.xz*10.0);",
"vec2 _uv=(_pix+0.5)/128.0;",
"vec4 _sf=texture2D(uShore,(vW.xz-uShoreOrg.xy)*uShoreOrg.zw);",
"if(_sf.r<0.5) discard;",
"float _dist=_sf.g*32.0;",
"float _wob=1.3*sin(vW.x*0.31+1.0)*cos(vW.z*0.23)+0.8*sin(vW.x*0.11-vW.z*0.17);",
"float _shoreD=_dist+_wob;",
"vec4 _sh=(texture2D(uShallow,_uv));",
"vec4 _dp=(texture2D(uDeep,_uv));",
"vec3 _midc=mix(_sh.rgb,_dp.rgb,0.5);",
"vec2 _cell=floor(gl_FragCoord.xy);",
"float _bi=mod(_cell.y,4.0)*4.0+mod(_cell.x,4.0);",
"float _bv=0.0;",
"if(_bi<0.5)_bv=0.0;else if(_bi<1.5)_bv=8.0;else if(_bi<2.5)_bv=2.0;else if(_bi<3.5)_bv=10.0;",
"else if(_bi<4.5)_bv=12.0;else if(_bi<5.5)_bv=4.0;else if(_bi<6.5)_bv=14.0;else if(_bi<7.5)_bv=6.0;",
"else if(_bi<8.5)_bv=3.0;else if(_bi<9.5)_bv=11.0;else if(_bi<10.5)_bv=1.0;else if(_bi<11.5)_bv=9.0;",
"else if(_bi<12.5)_bv=15.0;else if(_bi<13.5)_bv=7.0;else if(_bi<14.5)_bv=13.0;else _bv=5.0;",
"float _th=(_bv+0.5)/16.0;",
"float _fw=max(fwidth(_shoreD),1e-4);",
"float _jit=(_th-0.5)*0.45*step(48.0,0.45/_fw);",
"float _d0=1.8+_jit;",
"float _d1=4.0+_jit;",
"vec3 _band=_shoreD<_d0?_sh.rgb:(_shoreD<_d1?_midc:_dp.rgb);",
"vec4 texelColor=vec4(_band,1.0);",
"float _fogF=smoothstep(36.0,130.0,length(vW.xz-cameraPosition.xz));",
"float _zF=clamp((_fogF-0.8)/0.2,0.0,1.0);",
"float _spanF=0.2/max(fwidth(_fogF),1e-5);",
"float _toSky=mix(step(0.9,_fogF),step(_th,_zF),step(48.0,_spanF));",
"texelColor.rgb=mix(texelColor.rgb,vec3(0.20,0.45,0.85),_toSky);",
"diffuseColor*=texelColor;"
].join("\n");
function bindZoneFade(sh){
if(sh.vertexShader.indexOf("aZone")<0){
sh.vertexShader=sh.vertexShader
.replace("#include <common>","#include <common>\nattribute float aZone;\nattribute float aEdge;\nvarying float vZone;\nvarying float vEdge;")
.replace("#include <project_vertex>","vZone=aZone;\nvEdge=aEdge;\n#include <project_vertex>");
}
if(sh.fragmentShader.indexOf("vZone")<0){
sh.fragmentShader=sh.fragmentShader.replace("#include <common>","#include <common>\nvarying float vZone;\nvarying float vEdge;");
sh.fragmentShader=sh.fragmentShader.replace("#include <fog_fragment>",ZONE_FADE+"\n#include <fog_fragment>");
}
}
/* Interior water and the outer ocean share this textured sheet. A flat colour is not used for either. */
function buildWater(field){
if(!field.lake||!window.TBTiles||!TBTiles.waterMat||!TBTiles.WATER)return null;
const cover=waterField(field);
if(!cover)return null;
const cells=[];
for(let iz=0;iz<field.h;iz++)for(let ix=0;ix<field.w;ix++)if(cover.on[iz*field.w+ix])cells.push(ix,iz);
if(!cells.length)return null;
const y=field.waterY+0.02,m=field.meters||1,ox=field.offX||0,oz=field.offZ||0;
const pos=[],uv=[],ind=[],zone=[],edge=[];
for(let i=0;i<cells.length;i+=2){
const ix=cells[i],iz=cells[i+1],x=ox+ix*m,z=oz+iz*m,b=(i/2)*4;
const zv=maskDistAt(field,ix,iz),ev=rimDistAt(field,ix,iz);
pos.push(x,y,z, x+m,y,z, x+m,y,z+m, x,y,z+m);
uv.push(0,0,1,0,1,1,0,1);
for(let v=0;v<4;v++){zone.push(zv);edge.push(ev);}
ind.push(b,b+2,b+1, b,b+3,b+2);
}
const geo=new THREE.BufferGeometry();
geo.setAttribute("position",new THREE.Float32BufferAttribute(pos,3));
geo.setAttribute("uv",new THREE.Float32BufferAttribute(uv,2));
geo.setAttribute("aZone",new THREE.Float32BufferAttribute(zone,1));
geo.setAttribute("aEdge",new THREE.Float32BufferAttribute(edge,1));
geo.setIndex(ind);
const W=TBTiles.WATER;
const mat=TBTiles.waterMat(W.shallow,{kind:"sheet",depthWrite:true});
mat.extensions=mat.extensions||{};
mat.extensions.derivatives=true;
mat.userData.shoreTex=cover.tex;
const org=new THREE.Vector4(ox,oz,1/cover.worldW,1/cover.worldH);
mat.onBeforeCompile=function(sh){
sh.uniforms.uShallow={value:W.shallow[0]};
sh.uniforms.uDeep={value:W.deep[0]};
sh.uniforms.uShore={value:cover.tex};
sh.uniforms.uShoreOrg={value:org};
mat.userData.uShallow=sh.uniforms.uShallow;
mat.userData.uDeep=sh.uniforms.uDeep;
sh.vertexShader=sh.vertexShader.replace("#include <project_vertex>","vW=(modelMatrix*vec4(transformed,1.0)).xyz;\n#include <project_vertex>");
if(sh.vertexShader.indexOf("varying vec3 vW")<0)sh.vertexShader="varying vec3 vW;\n"+sh.vertexShader;
sh.fragmentShader="varying vec3 vW;\nuniform sampler2D uShallow;\nuniform sampler2D uDeep;\nuniform sampler2D uShore;\nuniform vec4 uShoreOrg;\n"+sh.fragmentShader.replace("#include <map_fragment>",WATER_SHEET);
bindZoneFade(sh);
};
mat.needsUpdate=true;
const mesh=new THREE.Mesh(geo,mat);
mesh.name="tb-area-water";
mesh.renderOrder=1;
mesh.receiveShadow=true;mesh.userData.surface=1;mesh.userData.tbOwnMat=1;
return mesh;
}
function lakeAt(field,x,z){
const m=field.meters||1;
const ix=Math.floor((x-(field.offX||0))/m),iz=Math.floor((z-(field.offZ||0))/m);
if(ix<0||iz<0||ix>=field.w||iz>=field.h)return false;
if(field.solid&&!field.solid[iz*field.w+ix])return false;
return !!field.lake[iz*field.w+ix];
}
function shoreChains(field){
const w=field.w,h=field.h,m=field.meters||1,ox=field.offX||0,oz=field.offZ||0;
const segs=[];
function wet(ix,iz){
if(ix<0||iz<0||ix>=w||iz>=h)return false;
if(field.solid&&!field.solid[iz*w+ix])return false;
return !!field.lake[iz*w+ix];
}
for(let iz=0;iz<h;iz++)for(let ix=0;ix<w;ix++){
if(!wet(ix,iz))continue;
const x0=ox+ix*m,z0=oz+iz*m,x1=x0+m,z1=z0+m;
if(!wet(ix,iz+1))segs.push([x0,z1,x1,z1]);
if(!wet(ix,iz-1))segs.push([x1,z0,x0,z0]);
if(!wet(ix+1,iz))segs.push([x1,z1,x1,z0]);
if(!wet(ix-1,iz))segs.push([x0,z0,x0,z1]);
}
function key(x,z){return Math.round(x*100)+"_"+Math.round(z*100);}
const from=new Map();
segs.forEach(function(s,i){
const k=key(s[0],s[1]);
let a=from.get(k);if(!a){a=[];from.set(k,a);}a.push(i);
});
const used=new Uint8Array(segs.length);
const chains=[];
for(let i=0;i<segs.length;i++){
if(used[i])continue;
const pts=[[segs[i][0],segs[i][1]]];
let cur=i;
while(cur!=null&&!used[cur]){
used[cur]=1;
const s=segs[cur];
pts.push([s[2],s[3]]);
const nxts=from.get(key(s[2],s[3]))||[];
let nxt=null;
for(let k=0;k<nxts.length;k++)if(!used[nxts[k]]){nxt=nxts[k];break;}
cur=nxt;
}
const closed=pts.length>3&&key(pts[0][0],pts[0][1])===key(pts[pts.length-1][0],pts[pts.length-1][1]);
if(closed)pts.pop();
if(pts.length>=4)chains.push({pts:pts,closed:closed});
}
return chains;
}
function catmullShore(P,closed){
const n=P.length,out=[];
const segs=closed?n:n-1;
for(let i=0;i<segs;i++){
const p1=P[i%n],p2=P[(i+1)%n];
const p0=closed||i>0?P[(i-1+n)%n]:[2*P[0][0]-P[1][0],2*P[0][1]-P[1][1]];
const p3=closed||i+2<n?P[(i+2)%n]:[2*P[n-1][0]-P[n-2][0],2*P[n-1][1]-P[n-2][1]];
const len=Math.hypot(p2[0]-p1[0],p2[1]-p1[1]);
const k=Math.max(4,Math.round(len/0.12));
for(let j=0;j<k;j++){
const t=j/k,t2=t*t,t3=t2*t;
out.push([
0.5*((2*p1[0])+(-p0[0]+p2[0])*t+(2*p0[0]-5*p1[0]+4*p2[0]-p3[0])*t2+(-p0[0]+3*p1[0]-3*p2[0]+p3[0])*t3),
0.5*((2*p1[1])+(-p0[1]+p2[1])*t+(2*p0[1]-5*p1[1]+4*p2[1]-p3[1])*t2+(-p0[1]+3*p1[1]-3*p2[1]+p3[1])*t3)
]);
}
}
if(!closed)out.push(P[n-1]);
return out;
}
/* Cut corners sharper than minR by pulling them toward the chord. A hard push off the circumcenter folds the shore into loops. */
function roundShore(P,closed,minR){
let C=P.map(function(p){return p.slice();});
for(let pass=0;pass<8;pass++){
const n=C.length;
const next=C.map(function(p){return p.slice();});
let moved=false;
const a0=closed?0:1,a1=closed?n:n-1;
for(let i=a0;i<a1;i++){
const A=C[(i-1+n)%n],B=C[i],Cp=C[(i+1)%n];
const abx=B[0]-A[0],abz=B[1]-A[1],bcx=Cp[0]-B[0],bcz=Cp[1]-B[1];
const lab=Math.hypot(abx,abz)||1,lbc=Math.hypot(bcx,bcz)||1;
const dot=(abx/lab)*(bcx/lbc)+(abz/lab)*(bcz/lbc);
const cross=(abx/lab)*(bcz/lbc)-(abz/lab)*(bcx/lbc);
const theta=Math.abs(Math.atan2(cross,dot));
if(theta<0.2)continue;
const seg=Math.min(lab,lbc);
const r=seg/Math.max(0.2,Math.tan(theta/2));
if(r>=minR)continue;
const mx=(A[0]+Cp[0])*0.5,mz=(A[1]+Cp[1])*0.5;
const pull=Math.min(0.55,(minR-r)/minR);
next[i][0]=B[0]+(mx-B[0])*pull;
next[i][1]=B[1]+(mz-B[1])*pull;
moved=true;
}
C=next;
if(!moved)break;
}
return C.length>=4?C:P;
}
function resampleShore(P,closed,step){
if(P.length<2)return P;
const out=[P[0].slice()];
let acc=0;
const n=closed?P.length:P.length-1;
for(let i=0;i<n;i++){
const a=P[i],b=P[(i+1)%P.length];
const len=Math.hypot(b[0]-a[0],b[1]-a[1]);
if(len<1e-5)continue;
let d=step-acc;
while(d<=len+1e-6){
const t=Math.min(1,d/len);
out.push([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]);
d+=step;
}
acc=len-(d-step);
if(acc<0)acc=0;
}
if(!closed)out.push(P[P.length-1].slice());
return out.length>=4?out:P;
}
function leftNormals(C,closed){
const n=C.length,N=[];
for(let i=0;i<n;i++){
const a=C[closed?(i-1+n)%n:Math.max(0,i-1)];
const b=C[closed?(i+1)%n:Math.min(n-1,i+1)];
let tx=b[0]-a[0],tz=b[1]-a[1],l=Math.hypot(tx,tz)||1;
tx/=l;tz/=l;N.push([-tz,tx]);
}
return N;
}
function landLeft(C,N,field,closed){
const i=Math.min(2,C.length-1);
if(lakeAt(field,C[i][0]+N[i][0]*0.7,C[i][1]+N[i][1]*0.7)){
C.reverse();
return leftNormals(C,closed);
}
return N;
}
function landInfo(field,x,z,nx,nz){
const names=field.biomeLegend||[],gnd=field.groundLegend||[];
const m=field.meters||1;
const lx=x+nx*0.8,lz=z+nz*0.8;
const ix=Math.floor((lx-(field.offX||0))/m),iz=Math.floor((lz-(field.offZ||0))/m);
let bio="Plains",ground="grass";
if(ix>=0&&iz>=0&&ix<field.w&&iz<field.h){
const i=iz*field.w+ix;
bio=names[field.biome[i]]||bio;
ground=gnd[field.ground[i]]||ground;
}
const sand=bio==="Sand"||ground==="sand";
const dry=isDryBiome(bio)||ground==="dirt"||sand;
return {sand:sand,bank:dry?"mud":"grass"};
}
/* A component is the sea when it runs off the area, or when it is simply huge.
   Goldmere stays a lake: it sits inside the grid and is a couple of hundred cells. */
function markSea(field){
const w=field.w,h=field.h,lake=field.lake;
const seen=new Uint8Array(w*h),sea=new Uint8Array(w*h),q=new Int32Array(w*h);
let qtAll=0;
for(let i=0;i<w*h;i++){
if(!lake[i]||seen[i])continue;
const start=qtAll;
let qh=start,touch=0;
q[qtAll++]=i;seen[i]=1;
while(qh<qtAll){
const c=q[qh++],x=c%w,z=(c-x)/w;
if(x===0||z===0||x===w-1||z===h-1)touch=1;
if(x>0){const j=c-1;if(lake[j]&&!seen[j]){seen[j]=1;q[qtAll++]=j;}}
if(x+1<w){const j=c+1;if(lake[j]&&!seen[j]){seen[j]=1;q[qtAll++]=j;}}
if(c>=w){const j=c-w;if(lake[j]&&!seen[j]){seen[j]=1;q[qtAll++]=j;}}
if(c+w<w*h){const j=c+w;if(lake[j]&&!seen[j]){seen[j]=1;q[qtAll++]=j;}}
}
if(touch||qtAll-start>2000)for(let k=start;k<qtAll;k++)sea[q[k]]=1;
}
field.sea=sea;
}
function seaAt(field,x,z){
if(!field.sea)return false;
const m=field.meters||1;
const ix=Math.floor((x-(field.offX||0))/m),iz=Math.floor((z-(field.offZ||0))/m);
if(ix<0||iz<0||ix>=field.w||iz>=field.h)return false;
return !!field.sea[iz*field.w+ix];
}
function chainIsSea(field,C,N){
let sawLake=false;
for(let i=0;i<C.length;i+=4){
const x=C[i][0]-N[i][0]*1.2,z=C[i][1]-N[i][1]*1.2;
if(seaAt(field,x,z))return true;
if(lakeAt(field,x,z))sawLake=true;
}
return false;
}
function ribbonOffsets(C,N,landD,waterD,closed){
const n=C.length,L=[],W=[];
for(let i=0;i<n;i++){
const i0=closed?(i-1+n)%n:Math.max(0,i-1);
const i1=closed?(i+1)%n:Math.min(n-1,i+1);
const p=C[i],prev=C[i0],next=C[i1];
const ax=p[0]-prev[0],az=p[1]-prev[1],bx=next[0]-p[0],bz=next[1]-p[1];
const al=Math.hypot(ax,az)||1,bl=Math.hypot(bx,bz)||1;
const cross=(ax/al)*(bz/bl)-(az/al)*(bx/bl);
const dot=(ax/al)*(bx/bl)+(az/al)*(bz/bl);
const theta=Math.atan2(cross,dot);
const radius=Math.abs(theta)>0.08?bl/Math.abs(theta):1e6;
const cap=0.9*radius;
let ld=landD,wd=waterD;
if(cross>0.08)ld=Math.min(ld,cap);
else if(cross<-0.08)wd=Math.min(wd,cap);
L.push([p[0]+N[i][0]*ld,p[1]+N[i][1]*ld]);
W.push([p[0]-N[i][0]*wd,p[1]-N[i][1]*wd]);
}
for(let i=1;i<n;i++){
const cx=C[i][0]-C[i-1][0],cz=C[i][1]-C[i-1][1];
if(cx*(L[i][0]-L[i-1][0])+cz*(L[i][1]-L[i-1][1])<0)L[i]=L[i-1].slice();
if(cx*(W[i][0]-W[i-1][0])+cz*(W[i][1]-W[i-1][1])<0)W[i]=W[i-1].slice();
}
if(closed&&n>2){
const cx=C[0][0]-C[n-1][0],cz=C[0][1]-C[n-1][1];
if(cx*(L[0][0]-L[n-1][0])+cz*(L[0][1]-L[n-1][1])<0)L[0]=L[n-1].slice();
if(cx*(W[0][0]-W[n-1][0])+cz*(W[0][1]-W[n-1][1])<0)W[0]=W[n-1].slice();
}
return {land:L,water:W};
}
function pushRibbon(buf,C,N,field,kind,closed){
const spec=kind==="foam"?{a:5/16,extra:0}:kind==="thin"?{a:3/16,extra:0}:kind==="wetsand"?{a:1,extra:0.08}:kind==="lake"?{a:10/16,extra:0}:{a:8/16,extra:0};
/* 64x16 at 16 texels/m is 1.0 m wide and 4 m along the shore. */
const w=1.0,landD=spec.a*w+spec.extra,waterD=(1-spec.a)*w-spec.extra;
const off=ribbonOffsets(C,N,landD,waterD,closed);
const n=C.length;
const s=new Float32Array(n+1);
for(let i=1;i<n;i++)s[i]=s[i-1]+Math.hypot(C[i][0]-C[i-1][0],C[i][1]-C[i-1][1]);
let total=s[n-1];
if(closed)total+=Math.hypot(C[0][0]-C[n-1][0],C[0][1]-C[n-1][1]);
if(!(total>1))return;
const rep=4.0;
const scale=closed?Math.max(1,Math.round(total/rep))*rep/total:1;
const count=closed?n+1:n;
const y0=field.waterY+0.02;
for(let i=0;i<count-1;i++){
const i0=i%n,i1=(i+1)%n;
const u0=s[i0]*scale/rep,u1=(i+1===count-1&&closed?total:s[i1])*scale/rep;
const la=off.land[i0],wa=off.water[i0],lb=off.land[i1],wb=off.water[i1];
const b=buf.pos.length/3;
buf.pos.push(la[0],y0,la[1], wa[0],y0,wa[1], wb[0],y0,wb[1], lb[0],y0,lb[1]);
buf.uv.push(u0,1, u0,0, u1,0, u1,1);
const c0=worldCell(la[0],la[1]),c1=worldCell(wa[0],wa[1]);
function ze(c){
const ix=Math.max(0,Math.min(field.w-1,c[0])),iz=Math.max(0,Math.min(field.h-1,c[1]));
return [maskDistAt(field,ix,iz),rimDistAt(field,ix,iz)];
}
const za=ze(c0),zb=ze(c1),zc=ze(worldCell(wb[0],wb[1])),zd=ze(worldCell(lb[0],lb[1]));
buf.zone.push(za[0],zb[0],zc[0],zd[0]);
buf.edge.push(za[1],zb[1],zc[1],zd[1]);
buf.ind.push(b,b+1,b+2, b,b+2,b+3);
}
}
function pushWhere(bins,C,N,field,closed,kind,flag){
const n=C.length;
if(!n)return;
let on=0;
for(let i=0;i<n;i++)if(flag[i])on++;
if(!on)return;
if(closed&&on===n){
if(!bins[kind])bins[kind]={pos:[],uv:[],ind:[],zone:[],edge:[]};
pushRibbon(bins[kind],C,N,field,kind,true);
return;
}
if(closed){
let cut=0;
for(let i=0;i<n;i++)if(!flag[i]&&flag[(i+1)%n]){cut=(i+1)%n;break;}
if(cut){
C=C.slice(cut).concat(C.slice(0,cut));
N=N.slice(cut).concat(N.slice(0,cut));
flag=flag.slice(cut).concat(flag.slice(0,cut));
}
}
let start=-1;
for(let i=0;i<=n;i++){
const hit=i<n&&flag[i];
if(hit&&start<0)start=i;
if(!hit&&start>=0){
const to=Math.min(n,i+1);
const slice=C.slice(start,to);
const ns=N.slice(start,start+slice.length);
if(slice.length>=2){
if(!bins[kind])bins[kind]={pos:[],uv:[],ind:[],zone:[],edge:[]};
pushRibbon(bins[kind],slice,ns,field,kind,false);
}
start=-1;
}
}
}
function buildShores(field){
if(!field.lake||!window.TBTiles||!TBTiles.waterMat||!TBTiles.WATER)return null;
const W=TBTiles.WATER;
const mats={};
function matFor(kind){
if(mats[kind])return mats[kind];
const frames=W[kind]||W.lake;
const m=TBTiles.waterMat(frames,{kind:"ribbon",alphaTest:kind==="thin"?0.35:0.5,depthWrite:false,side:THREE.DoubleSide,offset:1});
if(kind==="thin"){m.transparent=true;m.opacity=0.4;m.depthWrite=false;}
m.userData._zoned=0;
m.onBeforeCompile=function(sh){bindZoneFade(sh);};
m.needsUpdate=true;
mats[kind]=m;
return m;
}
markSea(field);
const g=new THREE.Group();g.name="tb-area-shore";
const chains=shoreChains(field);
const bins={};
const wind=[-0.7071,-0.7071];
chains.forEach(function(ch){
let C=resampleShore(roundShore(catmullShore(ch.pts,ch.closed),ch.closed,1.5),ch.closed,0.16);
if(C.length<4)return;
let N=leftNormals(C,ch.closed);
N=landLeft(C,N,field,ch.closed);
/* present water inside the mask gets the sea foam and wet sand, same as the outer ocean. */
const sea=chainIsSea(field,C,N);
const ocean=sea||!!field.waterPresent;
const sand=[],grass=[],mud=[],thin=[],all=[];
for(let i=0;i<C.length;i++){
const info=landInfo(field,C[i][0],C[i][1],N[i][0],N[i][1]);
sand.push(info.sand?1:0);
grass.push(info.bank==="grass"?1:0);
mud.push(info.bank==="mud"?1:0);
const facing=N[i][0]*wind[0]+N[i][1]*wind[1];
/* Windward only, one short stretch in four. Sheltered shores stay bare. */
thin.push(facing>0.55&&Math.floor(i/24)%4===0?1:0);
all.push(1);
}
if(ocean){
const seaGrass=grass.map(function(v,i){return sand[i]?0:v;});
const seaMud=mud.map(function(v,i){return sand[i]?0:v;});
pushWhere(bins,C,N,field,ch.closed,"foam",sand);
pushWhere(bins,C,N,field,ch.closed,"wetsand",sand);
pushWhere(bins,C,N,field,ch.closed,"grass",seaGrass);
pushWhere(bins,C,N,field,ch.closed,"mud",seaMud);
}else{
pushWhere(bins,C,N,field,ch.closed,"grass",grass);
pushWhere(bins,C,N,field,ch.closed,"mud",mud);
pushWhere(bins,C,N,field,ch.closed,"lake",all);
pushWhere(bins,C,N,field,ch.closed,"thin",thin);
}
});
let any=false;
Object.keys(bins).forEach(function(kind){
const b=bins[kind];
if(b.ind.length<3)return;
any=true;
const geo=new THREE.BufferGeometry();
geo.setAttribute("position",new THREE.Float32BufferAttribute(b.pos,3));
geo.setAttribute("uv",new THREE.Float32BufferAttribute(b.uv,2));
geo.setAttribute("aZone",new THREE.Float32BufferAttribute(b.zone,1));
geo.setAttribute("aEdge",new THREE.Float32BufferAttribute(b.edge,1));
geo.setIndex(b.ind);
const mesh=new THREE.Mesh(geo,matFor(kind));
mesh.name="tb-area-shore-"+kind;
mesh.renderOrder=kind==="wetsand"?2:3;
mesh.frustumCulled=false;
mesh.userData.surface=1;mesh.userData.tbOwnMat=1;
g.add(mesh);
});
return any?g:null;
}
function cobbleMat(){
const mat=TBTiles.MAT.cobble.clone();
mat.transparent=true;
mat.depthWrite=true;
mat.polygonOffset=true;
mat.polygonOffsetFactor=-3;
mat.polygonOffsetUnits=-3;
const prev=mat.onBeforeCompile;
mat.onBeforeCompile=function(sh){
if(prev)prev(sh);
sh.vertexShader=sh.vertexShader
.replace("#include <uv_pars_vertex>","#include <uv_pars_vertex>\nattribute vec4 aRim;\nattribute vec2 aLoc;\nattribute float aSeed;\nvarying vec4 vRim;\nvarying vec2 vLoc;\nvarying float vSeed;")
.replace("#include <uv_vertex>","#include <uv_vertex>\nvRim=aRim;vLoc=aLoc;vSeed=aSeed;");
sh.fragmentShader="varying vec4 vRim;\nvarying vec2 vLoc;\nvarying float vSeed;\n"+sh.fragmentShader;
sh.fragmentShader=sh.fragmentShader.replace("diffuseColor*=texelColor;","diffuseColor*=texelColor;\nfloat _e=1.0;float _w=sin(vLoc.y*8.0+vSeed)*0.045;if(vRim.x>0.5)_e=min(_e,smoothstep(0.0,0.18,vLoc.x+_w));if(vRim.y>0.5)_e=min(_e,smoothstep(0.0,0.18,1.0-vLoc.x-_w));if(vRim.z>0.5)_e=min(_e,smoothstep(0.0,0.18,vLoc.y+_w));if(vRim.w>0.5)_e=min(_e,smoothstep(0.0,0.18,1.0-vLoc.y-_w));diffuseColor.a*=_e;");
if(window.TBTiles&&TBTiles.bindHeight)TBTiles.bindHeight(sh);
};
mat.needsUpdate=true;
return mat;
}
function buildCobble(field,rows){
if(!heights||!window.TBTiles||!TBTiles.MAT||!TBTiles.MAT.cobble)return null;
const names=field.groundLegend;
const lotIds=[],plazaIds=[];
["lot","cobble_lot"].forEach(function(n){const i=names.indexOf(n);if(i>=0)lotIds.push(i);});
["plaza"].forEach(function(n){const i=names.indexOf(n);if(i>=0)plazaIds.push(i);});
const surf=field.surface;
if(!lotIds.length&&!plazaIds.length&&!surf)return null;
const on=new Uint8Array(field.w*field.h);
const cells=[];
const m0=field.meters;
for(let iz=0;iz<field.h;iz++)for(let ix=0;ix<field.w;ix++){
if(!field.mask[iz*field.w+ix])continue;
const id=field.ground[iz*field.w+ix];
const lot=lotIds.indexOf(id)>=0,plaza=plazaIds.indexOf(id)>=0||(surf&&surf[iz*field.w+ix]===7);
if(!lot&&!plaza)continue;
if(lot&&inYard(rows,(ix+0.5)*m0,(iz+0.5)*m0))continue;
on[iz*field.w+ix]=1;
cells.push(ix,iz);
}
if(!cells.length)return null;
/* cobble_32 stones are about 8 px. 10 texels/m maps the 32 px tile across 3.2 m,
   so a stone is a bit under a metre, the same density as the meadow street and the biome tiles. */
const m=field.meters,k=10/32,vx=field.w+1,ox=field.offX||0,oz=field.offZ||0;
const pos=[],uv=[],ind=[],rim=[],loc=[],seed=[];
function outer(ix,iz){
if(ix<0||iz<0||ix>=field.w||iz>=field.h)return 1;
return on[iz*field.w+ix]?0:1;
}
for(let i=0;i<cells.length;i+=2){
const ix=cells[i],iz=cells[i+1],x=ox+ix*m,z=oz+iz*m,b=pos.length/3;
const y00=heights[iz*vx+ix]+0.03,y10=heights[iz*vx+ix+1]+0.03;
const y11=heights[(iz+1)*vx+ix+1]+0.03,y01=heights[(iz+1)*vx+ix]+0.03;
pos.push(x,y00,z, x+m,y10,z, x+m,y11,z+m, x,y01,z+m);
uv.push(x*k,z*k, (x+m)*k,z*k, (x+m)*k,(z+m)*k, x*k,(z+m)*k);
const rw=outer(ix-1,iz),re=outer(ix+1,iz),rs=outer(ix,iz-1),rn=outer(ix,iz+1);
for(let v=0;v<4;v++)rim.push(rw,re,rs,rn);
loc.push(0,0, 1,0, 1,1, 0,1);
const s=((ix*73856093)^(iz*19349663))%1000/1000*6.28;
for(let v=0;v<4;v++)seed.push(s);
ind.push(b,b+2,b+1, b,b+3,b+2);
}
const geo=new THREE.BufferGeometry();
geo.setAttribute("position",new THREE.Float32BufferAttribute(pos,3));
geo.setAttribute("uv",new THREE.Float32BufferAttribute(uv,2));
geo.setAttribute("aRim",new THREE.Float32BufferAttribute(rim,4));
geo.setAttribute("aLoc",new THREE.Float32BufferAttribute(loc,2));
geo.setAttribute("aSeed",new THREE.Float32BufferAttribute(seed,1));
geo.setIndex(ind);
geo.computeVertexNormals();
const mesh=new THREE.Mesh(geo,cobbleMat());
mesh.name="tb-area-cobble";
mesh.receiveShadow=true;mesh.castShadow=false;
mesh.userData.surface=1;mesh.userData.tbOwnMat=1;
return mesh;
}
function buildSkirt(field){
if(field.hasRing)return buildFarPad(field);
const pad=18,m=field.meters,ox=field.offX||0,oz=field.offZ||0;
const y=(field.waterY-1.45)-0.08;
const geo=new THREE.PlaneGeometry(field.w*m+pad*2,field.h*m+pad*2,1,1);
geo.rotateX(-Math.PI/2);
geo.translate(ox+field.w*m/2,y,oz+field.h*m/2);
let mat;
if(window.TBTiles&&TBTiles.MAT&&TBTiles.MAT.stone){
mat=TBTiles.MAT.stone.clone();
mat.map=null;mat.color.setRGB(0.20,0.45,0.85);mat.needsUpdate=true;
}else mat=new THREE.MeshLambertMaterial({color:new THREE.Color(0.20,0.45,0.85)});
mat.toneMapped=false;
const mesh=new THREE.Mesh(geo,mat);
mesh.name="tb-area-skirt";
mesh.receiveShadow=true;mesh.userData.surface=1;mesh.userData.tbOwnMat=1;
return mesh;
}
/* Past the ring the ground is already sky-coloured. This pad is the same unlit
   sky, so the mesh edge and the old pale rim disappear into the background. */
function buildFarPad(field){
const m=field.meters,ox=field.offX||0,oz=field.offZ||0;
const x0=ox,z0=oz,x1=ox+field.w*m,z1=oz+field.h*m;
const ext=90,cell=18;
const cols=Math.ceil((x1-x0+ext*2)/cell),rows=Math.ceil((z1-z0+ext*2)/cell);
const vx=cols+1,vz=rows+1;
const pos=[],ind=[];
const y=field.waterY-0.4;
for(let iz=0;iz<vz;iz++)for(let ix=0;ix<vx;ix++)pos.push(x0-ext+ix*cell,y,z0-ext+iz*cell);
for(let iz=0;iz<rows;iz++)for(let ix=0;ix<cols;ix++){
const ax=x0-ext+ix*cell,az=z0-ext+iz*cell;
const bx=ax+cell,bz=az+cell;
if(ax>=x0-0.01&&bx<=x1+0.01&&az>=z0-0.01&&bz<=z1+0.01)continue;
const a=iz*vx+ix;
ind.push(a,a+vx,a+1,a+1,a+vx,a+vx+1);
}
if(!ind.length)return null;
const geo=new THREE.BufferGeometry();
geo.setAttribute("position",new THREE.Float32BufferAttribute(pos,3));
geo.setIndex(ind);
const mat=new THREE.MeshBasicMaterial({color:new THREE.Color(0.20,0.45,0.85),fog:true});
mat.toneMapped=false;
const mesh=new THREE.Mesh(geo,mat);
mesh.name="tb-area-far";
mesh.receiveShadow=false;mesh.frustumCulled=false;
mesh.userData.surface=1;mesh.userData.tbOwnMat=1;
return mesh;
}
function pickWeighted(list,hv){
let sum=0;
for(let i=0;i<list.length;i++)sum+=list[i].w||1;
let t=hv*sum;
for(let i=0;i<list.length;i++){t-=list[i].w||1;if(t<=0)return list[i];}
return list[list.length-1];
}
function buildRingDress(field){
if(!field.hasRing||typeof THREE==="undefined")return null;
const dist=skirtField(field.mask,field.w,field.h);
const names=field.biomeLegend||[];
const trees=[],bushes=[],kits=[];
const want={Forest:1,DarkForest:1,Jungle:1,Taiga:1};
for(let iz=0;iz<field.h;iz++)for(let ix=0;ix<field.w;ix++){
const i=iz*field.w+ix;
if(!field.border||!field.border[i])continue;
if(field.mask[i])continue;
if(dist[i]<2)continue;
const bn=names[field.biome[i]]||"";
if(field.flat&&field.flat[i])continue;
const hsh=hash2(ix,iz,91);
const rim=Math.min(ix,iz,field.w-1-ix,field.h-1-iz);
const dress=ringDressFor(bn);
if(dress){
const treesL=[],coverL=[];
for(let k=0;k<dress.length;k++)(/^tree_/.test(dress[k].kit)?treesL:coverL).push(dress[k]);
const treeP=bn==="Mountain"?0.045:0.08,coverP=bn==="Mountain"?0.05:0.09;
const x=(field.offX||0)+(ix+0.5)*field.meters,z=(field.offZ||0)+(iz+0.5)*field.meters;
if(hsh<treeP&&treesL.length&&kits.length<480){
const pick=pickWeighted(treesL,hash2(ix,iz,17));
kits.push({kit:pick.kit,x:x,z:z,yaw:hsh*6.283,scale:0.9+hash2(ix,iz,3)*0.2,dist:dist[i],rim:rim});
}else if(hsh<treeP+coverP&&coverL.length&&kits.length<960){
const pick=pickWeighted(coverL,hash2(ix,iz,29));
kits.push({kit:pick.kit,x:x,z:z,yaw:hsh*6.283,scale:1,dist:dist[i],rim:rim});
}
continue;
}
if(!want[bn])continue;
if(hsh<0.08&&trees.length<480)trees.push(ix,iz,hsh,dist[i],rim);
else if(hsh>0.08&&hsh<0.15&&bushes.length<480)bushes.push(ix,iz,hsh,dist[i],rim);
}
if(!trees.length&&!bushes.length&&!kits.length)return null;
const g=new THREE.Group();g.name="tb-area-ring-dress";
if(kits.length&&window.TBProps&&TBProps.scatter)TBProps.scatter(g,kits,groundY);
function matOf(key,hex){
let m;
if(window.TBTiles&&TBTiles.MAT&&TBTiles.MAT[key])m=TBTiles.MAT[key].clone();
else m=new THREE.MeshLambertMaterial({color:hex});
m.toneMapped=false;
return m;
}
const leaf=matOf("pine",0x4e8a48),bark=matOf("bark",0x8d6240),bush=matOf("leaf",0x5a9a46);
function geoCone(r,ht,n){const geo=new THREE.ConeGeometry(r,ht,n);geo.translate(0,ht*0.5,0);return geo;}
function place(list,parts){
if(!list.length)return;
const n=list.length/5;
parts.forEach(function(part){
const im=new THREE.InstancedMesh(part.geo,part.mat,n);
const dummy=new THREE.Object3D(),tint=new THREE.Color(),sky=new THREE.Color(0.20,0.45,0.85);
for(let i=0;i<n;i++){
const ix=list[i*5],iz=list[i*5+1],hv=list[i*5+2],d=list[i*5+3],rim=list[i*5+4];
const x=(field.offX||0)+(ix+0.5)*field.meters,z=(field.offZ||0)+(iz+0.5)*field.meters;
const s=part.s*(0.75+hv*0.7);
dummy.position.set(x,groundY(x,z)+(part.y||0)*s,z);
dummy.rotation.set(0,hv*6.283,0);
dummy.scale.setScalar(s);
dummy.updateMatrix();
im.setMatrixAt(i,dummy.matrix);
const k=smooth01((d*field.meters-2)/14);
const outer=1-smooth01(rim*field.meters/8);
tint.setRGB(1,1,1).lerp(new THREE.Color(0.78,0.86,0.80),0.1+0.4*k);
tint.lerp(sky,outer);
if(im.setColorAt)im.setColorAt(i,tint);
}
im.instanceMatrix.needsUpdate=true;
if(im.instanceColor)im.instanceColor.needsUpdate=true;
im.castShadow=true;im.receiveShadow=true;im.frustumCulled=false;
im.userData.surface=1;im.userData.tbOwnMat=1;
g.add(im);
});
}
place(trees,[
{geo:new THREE.CylinderGeometry(0.07,0.11,0.55,5),mat:bark,y:0,s:1},
{geo:geoCone(0.72,1.15,6),mat:leaf,y:0.55,s:1},
{geo:geoCone(0.48,0.9,6),mat:leaf.clone(),y:1.35,s:1}
]);
const bushGeo=new THREE.IcosahedronGeometry(0.42,0);bushGeo.translate(0,0.38,0);
place(bushes,[{geo:bushGeo,mat:bush,y:0,s:1}]);
return g;
}
/* Static boxes (walls, roofs, stalls, fences) share a handful of materials.
   One mesh per material drops the draw-call cost of the colour pass and the
   outline pass together. Wind, crowd, ground and instancing stay as they are. */
function weldStatic(root){
if(!root||typeof THREE==="undefined"||!THREE.BufferGeometryUtils)return;
const merge=THREE.BufferGeometryUtils.mergeGeometries;
if(!merge)return;
root.updateMatrixWorld(true);
const inv=new THREE.Matrix4().copy(root.matrixWorld).invert();
function blocked(o){
let n=o;
while(n){
const u=n.userData;
if(u&&(u.tbKeep||u._wind||u.tbInterior||u.tbPerson||u.tbFade))return true;
n=n.parent;
}
return false;
}
const meshes=[];
root.traverse(function(o){
if(!o.isMesh||o.isInstancedMesh||o.isSkinnedMesh)return;
if(!o.geometry||!o.material||Array.isArray(o.material))return;
const u=o.userData||{};
if(u.tbOwnMat||u.surface||u.tbKeep||u._wind)return;
if(blocked(o))return;
meshes.push(o);
});
const refs=new Map();
root.traverse(function(o){
if(o.geometry)refs.set(o.geometry,(refs.get(o.geometry)||0)+1);
});
const bins={};
meshes.forEach(function(m){
const names=Object.keys(m.geometry.attributes).sort().join(",");
const key=m.material.uuid+"|"+(m.castShadow?1:0)+"|"+(m.receiveShadow?1:0)+"|"+names;
(bins[key]||(bins[key]=[])).push(m);
});
let removed=0,batches=0;
Object.keys(bins).forEach(function(key){
const list=bins[key];
if(list.length<2)return;
const geos=[];
for(let i=0;i<list.length;i++){
const src=list[i].geometry;
let g=src.index?src.toNonIndexed():src.clone();
g.applyMatrix4(list[i].matrixWorld);
g.applyMatrix4(inv);
geos.push(g);
}
const merged=merge(geos,false);
geos.forEach(function(g){g.dispose();});
if(!merged)return;
const mesh=new THREE.Mesh(merged,list[0].material);
mesh.name="tb-weld";
mesh.castShadow=list[0].castShadow;
mesh.receiveShadow=list[0].receiveShadow;
mesh.frustumCulled=false;
mesh.userData.tbWeld=list.length;
root.add(mesh);
list.forEach(function(m){
if(m.parent)m.parent.remove(m);
const left=(refs.get(m.geometry)||1)-1;
refs.set(m.geometry,left);
if(left<=0&&m.geometry.dispose)m.geometry.dispose();
});
removed+=list.length;
batches++;
});
root.userData.tbWeld={candidates:meshes.length,removed:removed,batches:batches};
if(typeof console!=="undefined")console.info("tb weld",root.userData.tbWeld);
}
function disposeGroup(){
if(!group)return;
group.traverse(function(o){
if(o.isInstancedMesh&&o.userData&&o.userData.tbOak){
if(o.morphTexture&&o.morphTexture.dispose)o.morphTexture.dispose();
if(o.instanceMatrix&&o.instanceMatrix.dispose)o.instanceMatrix.dispose();
}
if(o.geometry&&o.geometry.dispose&&!(o.geometry.userData&&o.geometry.userData.tbKeep))o.geometry.dispose();
if(o.userData&&o.userData.tbOwnMat&&o.material&&o.material.dispose&&!(o.material.userData&&o.material.userData.tbKeep))o.material.dispose();
});
if(group.parent)group.parent.remove(group);
group=null;groundMesh=null;
}
function hideMeadow(){
if(!ctx||!ctx.scene)return;
const kids=ctx.scene.children;
for(let i=0;i<kids.length;i++){
const o=kids[i];
if(o.isLight)continue;
if(ctx.sun&&o===ctx.sun.target)continue;
if(o===group||(o.userData&&(o.userData.tbKeep||o.userData.tbArea)))continue;
if(o.geometry&&o.geometry.type==="SphereGeometry"&&o.geometry.parameters&&o.geometry.parameters.radius>100)continue;
o.visible=false;
}
if(!bxCleared&&ctx.BX){
for(let i=ctx.BX.length-1;i>=0;i--)if(!ctx.BX[i].tbBldg)ctx.BX.splice(i,1);
bxCleared=true;
}
if(ctx.things)for(let i=0;i<ctx.things.length;i++){
const t=ctx.things[i];
if(t.tbDoor||t.tbLeave||t.tbLiveNpc)continue;
t._tbOff=1;
}
}
function widenShadows(){
if(!ctx||!ctx.sun)return;
const span=Math.max(gw,gh)*meters;
const ext=Math.max(36,Math.min(96,span*0.62));
const cam=ctx.sun.shadow.camera;
cam.left=cam.bottom=-ext;cam.right=cam.top=ext;
cam.far=Math.max(80,ext+48);
cam.updateProjectionMatrix();
}
function placePlayers(){
if(!ctx||!ctx.players)return;
ctx.players.forEach(function(p,i){
const x=spawnPos.x+(i?1.3:0), z=spawnPos.z;
p.x=x;p.z=z;p.y=groundY(x,z);p.yaw=spawnPos.yaw;
p.vx=p.vy=p.vz=0;p.g=true;p.snap=true;
p.hop=null;p.sup=null;p.lock=false;p.fs=null;
if(p.mount){p.mount.rider=null;p.mount=null;}
if(p.carry){p.carry.carried=null;p.carry=null;}
});
}
function readSpawn(p){
const list=p.entries||[];
let e=null;
for(let i=0;i<list.length;i++)if(list[i].kind==="spawn"||list[i].id==="player"){e=list[i];break;}
if(!e&&list.length)e=list[0];
const m=meters,ox=p.area.innerOrigin.x,oy=p.area.innerOrigin.y;
if(!e)return {x:gw*m*0.5,z:gh*m*0.5,yaw:Math.PI};
const face=String(e.facing||"S").toUpperCase();
return {x:(+e.x-ox)*m,z:(+e.y-oy)*m,yaw:FACE[face]!=null?FACE[face]:Math.PI};
}
function repaint(done){
const go=function(){
if(groundMesh&&paintOpt&&window.TBTiles){
primeGroundMat(groundMesh.material);
TBTiles.install(groundMesh.material,paintOpt);
}
if(window.TBVisuals&&TBVisuals.worldReady)TBVisuals.worldReady();
if(active)hideMeadow();
if(done)done();
};
if(paintOpt&&paintOpt.biome&&window.TBTiles&&TBTiles.whenBiomes)TBTiles.whenBiomes(go);
else go();
}
function primeCharacters(){
try{if(window.TBCharacters&&TBCharacters.init)TBCharacters.init();}catch(e){}
}
function areaSeedOf(p){
const place=p&&p.area&&p.area.placeSeed;
if(typeof place==="number"&&isFinite(place))return place;
const world=p&&p.source&&p.source.seed;
if(typeof world==="number"&&isFinite(world))return world;
return 1;
}
function build(p){
useOakSeed(areaSeedOf(p));
window.__tbEntry={t0:(typeof performance!=="undefined"?performance.now():Date.now()),sceneMs:0,firstBodyMs:0,allBodiesMs:0,count:0,charInitMs:window.__tbCharInitMs||0,packsMs:0};
if(!ctx||!ctx.scene)throw new Error("scene not ready");
if(typeof THREE==="undefined")throw new Error("THREE missing");
const field=prepare(p);
disposeGroup();
if(window.TBInteriors)TBInteriors.forget();
gw=field.w;gh=field.h;meters=field.meters;
ground=field.ground;groundLegend=field.groundLegend;
surfaceGrid=field.surface||null;
const hooks=readHooks(p);
minigameSlots=hooks.minigameSlots;respawnAnchor=hooks.respawnAnchor;settlementInfo=hooks.settlement;
biome=smoothBiomeField(floodBiome(field.biome,field.mask,field.w,field.h,field.border),field.w,field.h);field.biome=biome;biomeLegend=field.biomeLegend;placeMask=field.mask;solidMask=field.solid||null;
waterWalk=field.waterY+0.04;
group=new THREE.Group();group.name="tb-area";group.userData.tbArea=1;
group.userData.minigameSlots=minigameSlots;
group.userData.respawnAnchor=respawnAnchor;
group.userData.settlement=settlementInfo;
const rows=(window.TBBuildings&&p.buildings&&p.buildings.length)?TBBuildings.layout(p.buildings,p.area.innerOrigin,field.meters,function(){return 0;}):[];
group.add(buildMesh(field,rows));
const skirt=buildSkirt(field);
if(skirt)group.add(skirt);
const cobble=buildCobble(field,rows);
if(cobble)group.add(cobble);
const water=buildWater(field);
if(water)group.add(water);
const shores=buildShores(field);
if(shores)group.add(shores);
const dress=buildRingDress(field);
if(dress)group.add(dress);
ctx.scene.add(group);
spawnPos=readSpawn(p);
spawnPos.y=groundY(spawnPos.x,spawnPos.z);
areaName=(p.area&&p.area.name)||"area";
rememberSpan();
if(window.TBBuildings&&p.buildings&&p.buildings.length){
TBBuildings.place(group,groundY,p.buildings,p.area.innerOrigin,meters,ctx.BX);
}
if(window.TBProps)TBProps.place(group,groundY,p,meters);
weldStatic(group);
widenShadows();
if(window.__tbEntry)window.__tbEntry.sceneMs=(typeof performance!=="undefined"?performance.now():Date.now())-window.__tbEntry.t0;
resetEdge();
}
function rememberSpan(){
if(!heights||!gw){heightSpan=null;return;}
let min=1e9,max=-1e9,n=0,vx=gw+1;
for(let iz=0;iz<gh;iz++)for(let ix=0;ix<gw;ix++){
if(placeMask&&!placeMask[iz*gw+ix])continue;
const y=heights[iz*vx+ix];
if(y<min)min=y;if(y>max)max=y;n++;
}
heightSpan=n?{min:min,max:max}:null;
}
function useVista(){
if(ctx&&typeof ctx.goView==="function")ctx.goView(0);
}
function ack(from,hash){
if(!from||!from.source||ALLOW.indexOf(from.origin)<0)return;
const msg={type:"tb-area-ack",hash:hash};
if(window.TBLive&&TBLive.liveChosen&&TBLive.liveChosen())msg.live=1;
try{from.source.postMessage(msg,from.origin);}catch(e){}
}
function notifyLive(payload,from,same){
try{if(window.TBNpcs&&TBNpcs.onArea)TBNpcs.onArea(payload,{same:!!same});}
catch(e){console.warn("tb npcs",e);}
try{if(window.TBLive&&TBLive.onArea)TBLive.onArea(payload,{same:!!same,from:from||null});}
catch(e){console.warn("tb live",e);}
}
function receive(payload,from){
primeCharacters();
const err=validate(payload);
if(err){console.warn("tb area:",err);curtain(false);return;}
try{if(JSON.stringify(payload).length>4*1024*1024){console.warn("tb area: payload too big");curtain(false);return;}}catch(e){}
currentPayload=payload;
const hash=payloadHash(payload);
if(active&&hash&&hash===builtHash&&group&&ctx&&group.parent===ctx.scene){ack(from,hash);notifyLive(payload,from,true);return;}
if(!ctx){queued=payload;queuedFrom=from||null;return;}
try{
build(payload);
builtHash=hash;
active=true;
hideMeadow();
if(window.TBInteriors)TBInteriors.arm();
placePlayers();
useVista();
ack(from,hash);
notifyLive(payload,from,false);
repaint(function(){curtain(false);});
console.info("tb area ready:",areaName,gw+"x"+gh,"hash",hash);
}catch(e){console.warn("tb area failed",e);curtain(false);}
}
function attach(c){
ctx=c;
if(window.TBInteriors)TBInteriors.bind(c);
if(c&&c.rigs)c.rigs.forEach(function(r){
if(r.root)r.root.userData.tbKeep=1;
if(r.sh)r.sh.userData.tbKeep=1;
if(r.ring)r.ring.userData.tbKeep=1;
});
if(queued){const p=queued,f=queuedFrom;queued=null;queuedFrom=null;receive(p,f);}
}
function gridH(ix,iz){
if(ix<0)ix=0;else if(ix>gw)ix=gw;
if(iz<0)iz=0;else if(iz>gh)iz=gh;
return heights[iz*(gw+1)+ix];
}
function groundY(x,z){
if(!heights)return 0;
let fx=(x-gridOffX)/meters,fz=(z-gridOffZ)/meters;
if(fx<0||fz<0||fx>gw||fz>gh){
if(!hasRing)return skirtY;
fx=Math.max(0,Math.min(gw,fx));fz=Math.max(0,Math.min(gh,fz));
x=gridOffX+fx*meters;z=gridOffZ+fz*meters;
}
const x1=Math.floor(fx),z1=Math.floor(fz);
const tx=fx-x1,tz=fz-z1;
let h;
if(tx===0&&tz===0)h=gridH(x1,z1);
else{
function row(iz){return catmull(gridH(x1-1,iz),gridH(x1,iz),gridH(x1+1,iz),gridH(x1+2,iz),tx);}
h=catmull(row(z1-1),row(z1),row(z1+1),row(z1+2),tz);
}
const n=groundNameAt(x,z);
if(n==="water")h=Math.max(h,waterWalk);
if(n==="lot"||n==="plaza"||n==="cobble_lot")h+=0.03;
return h;
}
function readyWanted(hasOpener,search){
if(hasOpener)return true;
return /(?:^|[?&])bridge=1(?:&|$)/.test(String(search||""));
}
function bridgeSearch(){
try{return location.search||"";}catch(e){return "";}
}
function maskSample(mask,w,h,x,z,meters){
const ix=Math.floor(x/meters),iz=Math.floor(z/meters);
if(ix<0||iz<0||ix>=w||iz>=h)return 0;
return mask[iz*w+ix]?1:0;
}
function maskSmooth(mask,w,h,x,z,meters){
const gx=x/meters-0.5,gz=z/meters-0.5;
const x0=Math.floor(gx),z0=Math.floor(gz);
const tx=gx-x0,tz=gz-z0;
const sx=tx*tx*(3-2*tx),sz=tz*tz*(3-2*tz);
function at(ix,iz){
if(ix<0||iz<0||ix>=w||iz>=h)return 0;
return mask[iz*w+ix]?1:0;
}
const a=at(x0,z0),b=at(x0+1,z0),c=at(x0,z0+1),d=at(x0+1,z0+1);
return a*(1-sx)*(1-sz)+b*sx*(1-sz)+c*(1-sx)*sz+d*sx*sz;
}
/* Soft wall on the playable mask. Push along the mask gradient so a
   diagonal walk slides along the edge instead of stopping dead. */
function maskClamp(x,z,mask,w,h,meters){
meters=meters||1;
const maxX=w*meters,maxZ=h*meters;
const inset=Math.max(0.4,0.5*meters);
x=Math.max(0.05,Math.min(maxX-0.05,x));
z=Math.max(0.05,Math.min(maxZ-0.05,z));
function covered(px,pz){
return maskSample(mask,w,h,px,pz,meters)
&&maskSample(mask,w,h,px+inset,pz,meters)
&&maskSample(mask,w,h,px-inset,pz,meters)
&&maskSample(mask,w,h,px,pz+inset,meters)
&&maskSample(mask,w,h,px,pz-inset,meters);
}
if(covered(x,z))return {x:x,z:z};
let px=x,pz=z;
const step=Math.max(0.28,meters*0.35),e=Math.max(0.35,meters*0.45);
for(let i=0;i<16;i++){
if(covered(px,pz))break;
let gx=maskSmooth(mask,w,h,px+e,pz,meters)-maskSmooth(mask,w,h,px-e,pz,meters);
let gz=maskSmooth(mask,w,h,px,pz+e,meters)-maskSmooth(mask,w,h,px,pz-e,meters);
const len=Math.hypot(gx,gz);
if(len<1e-4)break;
px+=gx/len*step;pz+=gz/len*step;
px=Math.max(0.05,Math.min(maxX-0.05,px));
pz=Math.max(0.05,Math.min(maxZ-0.05,pz));
}
if(!maskSample(mask,w,h,px,pz,meters)){
const ix0=Math.floor(x/meters),iz0=Math.floor(z/meters);
let best=1e9,bx=maxX*0.5,bz=maxZ*0.5,found=false;
const lim=Math.max(w,h);
for(let r=0;r<=lim&&!found;r++){
let ringBest=1e9,rx=bx,rz=bz,hit=false;
for(let dz=-r;dz<=r;dz++)for(let dx=-r;dx<=r;dx++){
if(Math.max(Math.abs(dx),Math.abs(dz))!==r)continue;
const ix=ix0+dx,iz=iz0+dz;
if(ix<0||iz<0||ix>=w||iz>=h||!mask[iz*w+ix])continue;
const cx=(ix+0.5)*meters,cz=(iz+0.5)*meters;
const d=(cx-x)*(cx-x)+(cz-z)*(cz-z);
if(d<ringBest){ringBest=d;rx=cx;rz=cz;hit=true;}
}
if(hit){best=ringBest;bx=rx;bz=rz;found=true;}
}
return {x:bx,z:bz};
}
return {x:px,z:pz};
}
/* Distance to the playable mask. Positive is still inside, negative is past the edge.
   ox/oz point out of town. The hard mask wall stays available as maskClamp for tests. */
function edgeProbe(x,z,mask,w,h,m){
m=m||1;
if(!mask||!w||!h)return {dist:99,ox:0,oz:1,side:"S",inside:true};
const inside=maskSample(mask,w,h,x,z,m)===1;
const e=Math.max(0.45,m*0.5);
let gx=maskSmooth(mask,w,h,x+e,z,m)-maskSmooth(mask,w,h,x-e,z,m);
let gz=maskSmooth(mask,w,h,x,z+e,m)-maskSmooth(mask,w,h,x,z-e,m);
let len=Math.hypot(gx,gz);
if(len<1e-3){
const ix0=Math.floor(x/m),iz0=Math.floor(z/m);
let best=1e9,hit=false,tx=x,tz=z;
for(let r=1;r<=14&&!hit;r++){
for(let dz=-r;dz<=r;dz++)for(let dx=-r;dx<=r;dx++){
if(Math.max(Math.abs(dx),Math.abs(dz))!==r)continue;
const ix=ix0+dx,iz=iz0+dz;
if(ix<0||iz<0||ix>=w||iz>=h||!mask[iz*w+ix])continue;
const cx=(ix+0.5)*m,cz=(iz+0.5)*m,d=(cx-x)*(cx-x)+(cz-z)*(cz-z);
if(d<best){best=d;tx=cx;tz=cz;hit=true;}
}
}
gx=tx-x;gz=tz-z;len=Math.hypot(gx,gz)||1;
}
const ix=gx/len,iz=gz/len,ox=-ix,oz=-iz;
const step=Math.max(0.35,m*0.35);
let px=x,pz=z,dist=0;
if(inside){
for(let i=0;i<48;i++){
px+=ox*step;pz+=oz*step;dist+=step;
if(px<0||pz<0||px>=w*m||pz>=h*m||!maskSample(mask,w,h,px,pz,m))break;
if(dist>16)break;
}
}else{
for(let i=0;i<48;i++){
px+=ix*step;pz+=iz*step;dist+=step;
if(maskSample(mask,w,h,px,pz,m))break;
if(dist>24)break;
}
dist=-dist;
}
const side=Math.abs(ox)>Math.abs(oz)?(ox>0?"E":"W"):(oz>0?"S":"N");
return {dist:dist,ox:ox,oz:oz,side:side,inside:inside};
}
function walkClamp(x,z){
const mrg=WALK_CLAMP_MARGIN;
const minX=gridOffX+mrg,maxX=gridOffX+Math.max(0,gw)*meters-mrg;
const minZ=gridOffZ+mrg,maxZ=gridOffZ+Math.max(0,gh)*meters-mrg;
if(!(gw>0)||!(gh>0))return {x:x,z:z};
return {x:Math.max(minX,Math.min(maxX,x)),z:Math.max(minZ,Math.min(maxZ,z))};
}
let edgeLeave=freshEdgeLeave(),leaveBegun=false,edgeCss=false,fadeGen=0;
function resetEdge(){fadeGen++;edgeLeave=freshEdgeLeave();leaveBegun=false;setLeaveWarn(false);setLeaveVig(0);setLeaveFade(0);}
function ensureEdgeCss(){
if(edgeCss||typeof document==="undefined"||!document.createElement)return;
edgeCss=true;
const s=document.createElement("style");
s.id="tb-leave-css";
s.textContent="#tb-leave-warn{position:absolute;left:50%;top:18px;transform:translateX(-50%);z-index:32;max-width:34em;padding:8px 14px;border-radius:10px;background:rgba(42,32,22,.92);color:#fff6e4;font:600 15px/1.35 ui-sans-serif,system-ui,sans-serif;text-align:center;pointer-events:none;display:none}#tb-leave-vig{position:absolute;inset:0;z-index:30;pointer-events:none;opacity:0;background:radial-gradient(ellipse at center,rgba(0,0,0,0) 46%,rgba(12,8,4,.92) 100%)}#tb-leave-fade{position:absolute;inset:0;z-index:31;pointer-events:none;background:#000;opacity:0}";
const parent=document.head||document.documentElement;
if(parent&&parent.appendChild)parent.appendChild(s);
const canvas=document.getElementById&&document.getElementById("c");
if(canvas&&canvas.style){canvas.style.position="relative";canvas.style.zIndex="1";}
}
function edgeNode(id){
if(typeof document==="undefined"||!document.getElementById||!document.createElement)return null;
let el=document.getElementById(id);
if(el)return el;
ensureEdgeCss();
el=document.createElement("div");
if(!el)return null;
el.id=id;
const canvas=document.getElementById("area")||document.getElementById("c");
const wrap=document.querySelector&&document.querySelector(".wrap");
const parent=(canvas&&canvas.parentElement)||wrap||document.body;
if(!parent||!parent.appendChild)return null;
parent.appendChild(el);
return el;
}
function setLeaveWarn(on,name){
const el=on?edgeNode("tb-leave-warn"):(typeof document!=="undefined"?document.getElementById("tb-leave-warn"):null);
if(!el||!el.style)return;
el.style.display=on?"block":"none";
if(on)el.textContent="Leaving "+(name||"this place")+", keep going to return to the world map";
}
function setLeaveVig(amount){
const el=amount>0.02?edgeNode("tb-leave-vig"):(typeof document!=="undefined"?document.getElementById("tb-leave-vig"):null);
if(!el||!el.style)return;
el.style.opacity=String(Math.max(0,Math.min(1,amount)));
}
function setLeaveFade(amount){
const el=edgeNode("tb-leave-fade");
if(!el||!el.style)return;
el.style.opacity=String(Math.max(0,Math.min(1,amount)));
}
function startLeave(hit){
if(leaveBegun)return;
leaveBegun=true;
edgeLeave={hold:edgeLeave.hold,fired:true};
const gen=++fadeGen;
const t0=typeof performance!=="undefined"?performance.now():Date.now();
function step(now){
if(gen!==fadeGen)return;
const u=Math.min(1,((now||(typeof performance!=="undefined"?performance.now():Date.now()))-t0)/450);
setLeaveFade(u);
if(u<1){if(typeof requestAnimationFrame==="function")requestAnimationFrame(step);return;}
setLeaveWarn(false);
const p=hit.p||{};
const info={side:hit.info.side,pos:{x:Math.round(p.x*10)/10,z:Math.round(p.z*10)/10},yaw:p.yaw};
if(window.TBLive&&TBLive.requestExit)TBLive.requestExit(info);
}
if(typeof requestAnimationFrame==="function")requestAnimationFrame(step);
else step();
}
function edgeFrame(dt){
if(edgeLeave.fired)return;
if(!active||!placeMask||!ctx||!ctx.players){setLeaveWarn(false);setLeaveVig(0);return;}
const ps=ctx.players;
let worst=null;
for(let i=0;i<ps.length;i++){
const p=ps[i];
if(!p||!isFinite(p.x)||!isFinite(p.z))continue;
if(window.TBInteriors&&TBInteriors.contains&&TBInteriors.contains(p.x,p.z))continue;
const info=edgeProbe(p.x-gridOffX,p.z-gridOffZ,placeMask,gw,gh,meters);
const outward=(p.vx||0)*info.ox+(p.vz||0)*info.oz;
const room=clampClearance(p.x,p.z,gridOffX,gridOffZ,Math.max(0,gw)*meters,Math.max(0,gh)*meters);
const dist=Math.min(info.dist,room);
if(!worst||dist<worst.dist)worst={p:p,info:info,outward:outward,dist:dist};
}
const step=stepEdgeLeave(edgeLeave,worst?worst.dist:99,worst?worst.outward:0,dt||0);
edgeLeave=step.state;
if(!worst){setLeaveWarn(false);setLeaveVig(0);return;}
setLeaveWarn(step.warn,areaName);
const dist=worst.dist;
const vig=dist>=8?0:dist<=0?0.82:Math.max(0,(8-dist)/8*0.7);
setLeaveVig(vig);
if(step.startFade)startLeave(worst);
}
function spawn(){return {x:spawnPos.x,z:spawnPos.z,y:spawnPos.y,yaw:spawnPos.yaw};}
function readyMessage(){
const msg={type:"tb-area-ready"};
if(window.TBLive&&TBLive.readyExtras){
const extra=TBLive.readyExtras();
if(extra)for(const k in extra)msg[k]=extra[k];
}
return msg;
}
function postReady(){
if(typeof window==="undefined"||!window.opener||!window.opener.postMessage)return;
if(!readyWanted(true,bridgeSearch()))return;
const msg=readyMessage();
ALLOW.forEach(function(origin){
try{window.opener.postMessage(msg,origin);}catch(e){}
});
}
function onMessage(e){
if(!e||ALLOW.indexOf(e.origin)<0)return;
const d=e.data;
if(!d||typeof d!=="object")return;
const from={source:e.source,origin:e.origin};
if(window.TBLive&&TBLive.route&&TBLive.route(d,from))return;
if(d.type==="tb-area-hello"){
if(readyWanted(!!window.opener,bridgeSearch())&&e.source&&e.source.postMessage){
try{e.source.postMessage(readyMessage(),e.origin);}catch(err){}
}
return;
}
if(d.type==="tb-area"&&d.payload)receive(d.payload,from);
else if(d.type==="trailbound.area"&&d.version)receive(d,from);
}
function onDragOver(e){
const types=e.dataTransfer&&e.dataTransfer.types;
if(!types)return;
let file=false;
for(let i=0;i<types.length;i++)if(types[i]==="Files")file=true;
if(file)e.preventDefault();
}
function onDrop(e){
const f=e.dataTransfer&&e.dataTransfer.files&&e.dataTransfer.files[0];
if(!f)return;
e.preventDefault();
const reader=new FileReader();
reader.onload=function(){
try{receive(JSON.parse(String(reader.result)),null);}
catch(err){console.warn("tb area drop",err);}
};
reader.readAsText(f);
}
if(window.TBWorld&&TBWorld.boot&&!TBWorld.boot._tbArea){
const boot=TBWorld.boot;
function wrapped(c){
const r=boot(c);
const done=function(){if(active){hideMeadow();repaint();}};
if(r&&typeof r.then==="function")r.then(done,done);
return r;
}
wrapped._tbArea=1;
TBWorld.boot=wrapped;
}
if(window.TBLive&&TBLive.update&&!TBLive.update._tbEdge){
const liveUpdate=TBLive.update;
function update(dt){liveUpdate(dt);edgeFrame(dt||0);}
update._tbEdge=1;
TBLive.update=update;
}
postReady();
if(readyWanted(false,bridgeSearch())){
curtain(true);
setTimeout(function(){if(!active)curtain(false);},8000);
}
on(window,"message",onMessage);
on(window,"dragover",onDragOver);
on(window,"drop",onDrop);
const q=areaParam();
if(q){
primeCharacters();
curtain(true);
try{
const url=new URL(q,location.href).href;
fetch(url).then(function(r){if(!r.ok)throw new Error("HTTP "+r.status+" "+url);return r.json();}).then(function(p){receive(p,null);}).catch(function(e){console.warn("tb area fetch",e);curtain(false);});
}catch(e){console.warn("tb area fetch",e);curtain(false);}
}
window.TBArea={
attach:attach,receive:receive,groundY:groundY,active:function(){return active;},
players:function(){return ctx?ctx.players:[];},
setView:function(i){if(ctx&&typeof ctx.goView==="function")ctx.goView(i);},
walkClamp:walkClamp,spawn:spawn,name:function(){return areaName;},requested:requested,heightSpan:function(){return heightSpan;},
ownsExit:true,edgeProbe:edgeProbe,edgeFrame:edgeFrame,
decodeU8:decodeU8,prepare:prepare,validate:validate,payloadHash:payloadHash,sampleGrid:sampleGrid,maskClamp:maskClamp,readyWanted:readyWanted,ribbonCover:ribbonCover,roadCover:roadCover,isDryBiome:isDryBiome,ringDressFor:ringDressFor,readHooks:readHooks,
minigameSlots:function(){return minigameSlots;},respawnAnchor:function(){return respawnAnchor;},settlement:function(){return settlementInfo;},
payload:function(){return currentPayload;},allow:ALLOW
};
})();
