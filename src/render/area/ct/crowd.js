/* Ported from trailbound-controller (deployed main). ESM, behaviour-faithful.
   Not typechecked: a full TS conversion of these files would stall the port.
   three r187: colorSpace, colorspace_fragment, per-fragment Lambert cel, asset root.
*/
import { THREE } from './three-runtime.js';
/* Pooled town crowd for AreaExport v0.5.
   Named residents stay in npcs.js. This file spawns everyone else from
   population {count, mode, avg, seed, homes, hotspots}. No population block
   means no crowd, so v0.3 and v0.4 areas behave as they do today.
   ?crowd=N forces the count, ?crowdCap=N sets the active cap (default 500),
   ?hour=H previews the schedule. Bodies are a swappable provider: instanced
   capsule + head now, skinned GLBs later via assets/npc/manifest.json.
   See docs/crowds.md. */
(function(){
const TB_ROOT=(import.meta.env&&import.meta.env.BASE_URL?import.meta.env.BASE_URL:'./')+'assets/';
const ACTIVE_CAP=500;
const POOL_MAX=5000;
const ASTAR_BUDGET=2;
const PATH_CACHE_MAX=256;
const NEAR_IN=32, NEAR_OUT=38;
const MID_IN=80, MID_OUT=96;
const PARK_HYST=8;
const REFRESH_S=0.3;
const ROAD_MAX=64, HOT_MAX=24, DOOR_MAX=96;
const ARCH=["townsfolk","townsfolk","townsfolk","merchant","elder","youth"];
const TUNICS=["#c45c3a","#2f7d4a","#3a6294","#c4963a","#7a4e78","#3f8a8a"];
const HAIR=["#6b3a22","#c4a15a","#4a3428","#8a4a28","#d8c4a4"];
const SKIN=["#e0b090","#c48860","#f0c8a8","#8a5a3c"];
/* P1 is models/ff3/ingus_freelancer.glb at scale 1. Accessor bounds, feet on y=0. */
const PLAYER_H=1.4001044677734376;
const PAWN=function(){
const height=PLAYER_H*1.05;
const headDiameter=height*0.375;
const headR=headDiameter*0.5;
const bodyHeight=height-headDiameter*0.8;
const bodyWidth=bodyHeight*0.5;
return {
playerHeight:PLAYER_H, height:height, bodyHeight:bodyHeight, bodyWidth:bodyWidth,
headDiameter:headDiameter, headR:headR, headCenter:height-headR,
bodyRadius:bodyWidth*0.5, scale:[1,1,1]
};
}();

let ctx=null, area=null, nav=null, seed=1, activeCap=ACTIVE_CAP;
let members=[], activeIdx=new Uint16Array(1), activeN=0;
let memberPlan=null;
let placeholder=null, provider=null, manifestTried=false;
let hoursOverride=null, viewerOverride=null;
let fallbackX=0, fallbackZ=0;
let refreshAcc=REFRESH_S, lastMs=0, astarFrame=0, astarTotal=0;
let popMode="", popAvg=0;
let homeList=[];
let doorN=0, hotN=0, roadN=0;
const doorX=new Float64Array(DOOR_MAX), doorZ=new Float64Array(DOOR_MAX);
const doorId=new Array(DOOR_MAX);
const hotX=new Float64Array(HOT_MAX), hotZ=new Float64Array(HOT_MAX);
const roadX=new Float64Array(ROAD_MAX), roadZ=new Float64Array(ROAD_MAX);
const vx=new Float64Array(4), vz=new Float64Array(4);
let vn=0;
let dist2=new Float64Array(1), order=new Uint16Array(1), mark=new Uint8Array(1);
let nxt=new Int16Array(1), nearScratch=new Uint16Array(1), nearScratchN=0;
let reqNear=new Uint16Array(1), reqMid=new Uint16Array(1);
const ghead=new Int16Array(40*40);
const GW=40, GS=2.5;
const npcX=new Float64Array(48), npcZ=new Float64Array(48);
let npcSepN=0;
const pathCache=new Map();
const cacheKeys=[];
const scratchPt={x:0,z:0};
const freeStack=[];
let freeN=0;
let builtToken=0;

function hash2(a,b,c){
let n=Math.imul((a|0)+Math.imul(b|0,374761393),668265263)^Math.imul((c|0)^((a|0)*1274126177),2246822519);
n=Math.imul(n^(n>>>13),3266489917);
return ((n^(n>>>16))>>>0)/4294967295;
}
function queryNum(name){
try{
if(typeof location==="undefined"||!location.search) return null;
const v=new URLSearchParams(location.search).get(name);
if(v==null||v==="") return null;
const n=+v;
return isFinite(n)?n:null;
}catch(e){ return null; }
}
function clampCount(n){
n=n|0;
if(n<0) n=0;
if(n>POOL_MAX) n=POOL_MAX;
return n;
}
function hours(){
let h=null;
if(hoursOverride!=null&&isFinite(+hoursOverride)) h=+hoursOverride;
else {
const q=queryNum("hour");
if(q!=null) h=q;
else if(window.TBLive&&TBLive.clock){
const c=TBLive.clock();
if(c&&isFinite(c.hours)) h=c.hours;
}
}
if(h==null) h=9.25;
h=h%24;
if(h<0) h+=24;
return h;
}
function isNight(h){ return h<6||h>=20; }
function motionOf(dt){
if(hoursOverride!=null) return dt;
if(queryNum("hour")!=null) return dt;
if(window.TBLive&&TBLive.clock){
const c=TBLive.clock();
if(c&&!(c.rate>0)) return 0;
}
return dt;
}
function canDraw(){
return typeof THREE!=="undefined"&&!!THREE.InstancedMesh&&typeof document!=="undefined"&&!!document.createElement;
}
function sampleViewers(){
if(viewerOverride&&viewerOverride.length){
vn=0;
for(let i=0;i<viewerOverride.length&&vn<4;i++){
const v=viewerOverride[i];
if(!v||!isFinite(+v.x)||!isFinite(+v.z)) continue;
vx[vn]=+v.x; vz[vn]=+v.z; vn++;
}
if(vn) return;
}
vn=0;
const ps=ctx&&ctx.players;
if(ps){
for(let i=0;i<ps.length&&vn<4;i++){
const p=ps[i];
if(!p||!isFinite(p.x)||!isFinite(p.z)) continue;
vx[vn]=p.x; vz[vn]=p.z; vn++;
}
}
if(!vn){ vx[0]=fallbackX; vz[0]=fallbackZ; vn=1; }
}
function dist2ToView(x,z){
let best=1e18;
for(let i=0;i<vn;i++){
const dx=x-vx[i], dz=z-vz[i], d=dx*dx+dz*dz;
if(d<best) best=d;
}
return best;
}
function openAt(cx,cz){
if(!nav) return true;
if(cx<0||cz<0||cx>=nav.w||cz>=nav.h) return false;
return nav.walk[cz*nav.w+cx]===1;
}
function openMeter(x,z){
if(!nav) return true;
const m=nav.m||1;
return openAt(Math.floor(x/m), Math.floor(z/m));
}
function snapInto(x,z){
scratchPt.x=x; scratchPt.z=z;
if(!nav) return;
const m=nav.m||1;
const cx=Math.floor(x/m), cz=Math.floor(z/m);
if(openAt(cx,cz)) return;
for(let r=1;r<=8;r++){
for(let dz=-r;dz<=r;dz++) for(let dx=-r;dx<=r;dx++){
if(Math.abs(dx)!==r&&Math.abs(dz)!==r) continue;
if(!openAt(cx+dx,cz+dz)) continue;
scratchPt.x=(cx+dx+0.5)*m;
scratchPt.z=(cz+dz+0.5)*m;
return;
}
}
}
function footY(x,z){
if(window.TBArea&&TBArea.active&&TBArea.active()) return TBArea.groundY(x,z)||0;
return 0;
}
function selectNearest(n,k){
let l=0, r=n-1;
while(l<r){
const piv=dist2[order[(l+r)>>1]];
let i=l, j=r;
while(i<=j){
while(dist2[order[i]]<piv) i++;
while(dist2[order[j]]>piv) j--;
if(i<=j){
const t=order[i]; order[i]=order[j]; order[j]=t;
i++; j--;
}
}
if(k-1<=j) r=j;
else if(k-1>=i) l=i;
else break;
}
}
function setActive(m,on){
if(!!on===!!m.active) return;
if(on){
m.active=true;
activeIdx[activeN++]=m.i;
}else{
m.active=false;
for(let i=0;i<activeN;i++) if(activeIdx[i]===m.i){
activeIdx[i]=activeIdx[--activeN];
break;
}
}
}
function updateLod(m){
const d=m.d2;
const nIn=NEAR_IN*NEAR_IN, nOut=NEAR_OUT*NEAR_OUT, mIn=MID_IN*MID_IN, mOut=MID_OUT*MID_OUT;
if(m.lod===0){
if(d>nOut) m.lod=d>mOut?2:1;
}else if(m.lod===1){
if(d<nIn) m.lod=0;
else if(d>mOut) m.lod=2;
}else{
if(d<nIn) m.lod=0;
else if(d<mIn) m.lod=1;
}
}
function acquire(m){
let b=freeN>0?freeStack[--freeN]:null;
if(b){
if(b.apply) b.apply(m.archObj);
if(b.setVisible) b.setVisible(true);
}else{
b=provider&&provider.create?provider.create(m.archObj):null;
if(!b&&placeholder&&provider!==placeholder) b=placeholder.create(m.archObj);
}
m.body=b;
}
function release(m){
const b=m.body;
if(!b) return;
if(b.setMoving) b.setMoving(false);
if(b.setVisible) b.setVisible(false);
m.body=null;
freeStack[freeN++]=b;
}
function syncPresence(m){
updateLod(m);
const want=m.active&&!m.hidden&&m.lod<2;
if(want&&!m.body) acquire(m);
else if(!want&&m.body) release(m);
}
function refreshActive(){
const n=members.length;
sampleViewers();
if(!n){ activeN=0; return; }
for(let i=0;i<n;i++){
const m=members[i];
m.d2=dist2ToView(m.x,m.z);
dist2[i]=m.d2;
}
const cap=activeCap;
if(cap<=0){
for(let i=0;i<n;i++){ setActive(members[i], false); syncPresence(members[i]); }
return;
}
if(n<=cap){
for(let i=0;i<n;i++){ setActive(members[i], true); syncPresence(members[i]); }
return;
}
for(let i=0;i<n;i++) order[i]=i;
selectNearest(n, cap);
mark.fill(0);
let thresh=0;
for(let i=0;i<cap;i++){
mark[order[i]]=1;
if(dist2[order[i]]>thresh) thresh=dist2[order[i]];
}
const threshD=Math.sqrt(thresh);
const keep2=(threshD+PARK_HYST)*(threshD+PARK_HYST);
let slots=0;
for(let i=0;i<n;i++){
const m=members[i];
if(m.active&&dist2[i]<=keep2){ m._keep=1; slots++; }
else m._keep=0;
}
while(slots>cap){
let worst=-1, wd=-1;
for(let i=0;i<n;i++) if(members[i]._keep&&dist2[i]>wd){ wd=dist2[i]; worst=i; }
if(worst<0) break;
members[worst]._keep=0;
slots--;
}
for(let i=0;i<cap&&slots<cap;i++){
const m=members[order[i]];
if(m._keep) continue;
m._keep=1;
slots++;
}
for(let i=0;i<n;i++) setActive(members[i], !!members[i]._keep);
for(let i=0;i<n;i++) if(!members[i].active) syncPresence(members[i]);
for(let i=0;i<n;i++) if(members[i].active) syncPresence(members[i]);
}
function allocBuffers(n){
dist2=new Float64Array(n);
order=new Uint16Array(n);
mark=new Uint8Array(n);
nxt=new Int16Array(n);
nearScratch=new Uint16Array(n);
reqNear=new Uint16Array(n);
reqMid=new Uint16Array(n);
activeIdx=new Uint16Array(Math.max(n,1));
activeN=0;
}
function discardBodies(){
for(let i=0;i<members.length;i++){
const b=members[i]&&members[i].body;
if(b&&b.dispose) b.dispose();
if(members[i]) members[i].body=null;
}
for(let i=0;i<freeN;i++) if(freeStack[i]&&freeStack[i].dispose) freeStack[i].dispose();
freeN=0;
if(provider&&provider.reset) provider.reset();
if(placeholder&&placeholder!==provider&&placeholder.reset) placeholder.reset();
}
function clearCrowd(){
discardBodies();
members=[];
activeN=0;
doorN=hotN=roadN=0;
homeList.length=0;
pathCache.clear();
cacheKeys.length=0;
astarTotal=0;
astarFrame=0;
}
function readDoors(p){
doorN=0;
const doors=window.TBNpcs&&TBNpcs.listDoors?TBNpcs.listDoors(p):[];
for(let i=0;i<doors.length&&doorN<DOOR_MAX;i++){
doorX[doorN]=doors[i].x;
doorZ[doorN]=doors[i].z;
doorId[doorN]=doors[i].id;
doorN++;
}
}
function homeOf(p, bi){
const buildings=p.buildings||[];
const b=buildings[bi];
const id=b&&b.id;
for(let i=0;i<doorN;i++) if(doorId[i]===id) return {x:doorX[i], z:doorZ[i]};
const O=p.area&&p.area.innerOrigin||{x:0,y:0};
const m=(p.units&&+p.units.metersPerTile)||1;
if(b) return {x:(+b.x-+O.x)*m, z:(+b.y-+O.y)*m};
return {x:fallbackX, z:fallbackZ};
}
function readHomes(p, pop){
homeList.length=0;
const buildings=p.buildings||[];
const src=pop&&Array.isArray(pop.homes)?pop.homes:null;
if(src){
for(let i=0;i<src.length;i++){
const bi=src[i]|0;
if(bi>=0&&bi<buildings.length) homeList.push(bi);
}
}
if(!homeList.length){
for(let i=0;i<buildings.length;i++){
const b=buildings[i]||{};
const w=Math.max(1, Math.round(((+b.footW||4)*(+b.footD||4))/28));
for(let k=0;k<w&&homeList.length<800;k++) homeList.push(i);
}
}
if(!homeList.length) homeList.push(0);
}
function hotPoint(p,h){
if(!h) return null;
if(isFinite(+h.x)&&isFinite(+h.z)) return {x:+h.x, z:+h.z};
/* Map hotspots are area metres, y down, already offset from innerOrigin. */
if(isFinite(+h.x)&&isFinite(+h.y)) return {x:+h.x, z:+h.y};
return null;
}
function deriveHotspots(){
hotN=0;
for(let i=0;i<doorN&&hotN<HOT_MAX;i++){
const id=doorId[i]||"";
const b=area&&area.buildings;
let type="";
if(b) for(let k=0;k<b.length;k++) if(b[k]&&b[k].id===id) type=b[k].type||"";
if(/tavern|shop|inn|church|market|plaza/i.test(type)){
hotX[hotN]=doorX[i]; hotZ[hotN]=doorZ[i]; hotN++;
}
}
if(nav){
let sx=0, sz=0, sn=0;
for(let i=0;i<nav.walk.length;i++){
if(!nav.walk[i]||nav.ground[i]!=="plaza") continue;
sx+=i%nav.w; sz+=(i/nav.w)|0; sn++;
}
if(sn&&hotN<HOT_MAX){
const m=nav.m||1;
hotX[hotN]=(sx/sn+0.5)*m;
hotZ[hotN]=(sz/sn+0.5)*m;
hotN++;
}
}
if(!hotN&&doorN){ hotX[0]=doorX[0]; hotZ[0]=doorZ[0]; hotN=1; }
}
function readHotspots(p, pop){
hotN=0;
const list=pop&&Array.isArray(pop.hotspots)?pop.hotspots:null;
if(list){
for(let i=0;i<list.length&&hotN<HOT_MAX;i++){
const pt=hotPoint(p, list[i]);
if(!pt) continue;
hotX[hotN]=pt.x; hotZ[hotN]=pt.z; hotN++;
}
}
if(!hotN) deriveHotspots();
}
function sampleRoads(){
roadN=0;
if(!nav) return;
const stride=Math.max(1, Math.floor((nav.w*nav.h)/900));
for(let i=0;i<nav.walk.length&&roadN<ROAD_MAX;i+=stride){
if(!nav.walk[i]) continue;
const g=nav.ground[i];
if(g!=="road"&&g!=="dirt"&&g!=="plaza") continue;
const m=nav.m||1;
roadX[roadN]=((i%nav.w)+0.5)*m;
roadZ[roadN]=(((i/nav.w)|0)+0.5)*m;
roadN++;
}
}
function fallbackViewer(p){
const entries=window.TBNpcs&&TBNpcs.listEntries?TBNpcs.listEntries(p):[];
for(let i=0;i<entries.length;i++) if(entries[i].kind==="spawn"){
fallbackX=entries[i].x; fallbackZ=entries[i].z; return;
}
if(doorN){ fallbackX=doorX[0]; fallbackZ=doorZ[0]; return; }
fallbackX=0; fallbackZ=0;
}
function ringAt(i, x, z){
const ang=(i%8)*0.78539816339+hash2(seed, i, 23)*0.4;
const rad=0.85+(i%5)*0.42;
return {x:x+Math.cos(ang)*rad, z:z+Math.sin(ang)*rad};
}
function anchor(i){
const kind=i%3;
if(kind===0&&doorN){ const k=(i/3|0)%doorN; return ringAt(i, doorX[k], doorZ[k]); }
if(kind===1&&roadN){ const k=(i/3|0)%roadN; return ringAt(i, roadX[k], roadZ[k]); }
if(hotN){ const k=(i/3|0)%hotN; return ringAt(i, hotX[k], hotZ[k]); }
if(doorN){ const k=i%doorN; return ringAt(i, doorX[k], doorZ[k]); }
return {x:fallbackX, z:fallbackZ};
}
function pickGoal(m, slot){
m.hideOnArrive=false;
const kind=(m.i+slot)%3;
if(kind===2&&hotN){
const k=(m.i+slot)%hotN;
m.gx=hotX[k]; m.gz=hotZ[k]; m.goalKind=2; m.goalId=k;
}else if(kind===1&&roadN){
const k=(m.i*2+slot)%roadN;
m.gx=roadX[k]; m.gz=roadZ[k]; m.goalKind=3; m.goalId=k;
}else if(doorN){
const k=(m.i+slot)%doorN;
m.gx=doorX[k]; m.gz=doorZ[k]; m.goalKind=4; m.goalId=k;
}else{
m.gx=m.hx; m.gz=m.hz; m.goalKind=1; m.goalId=m.home;
}
const ring=ringAt(m.i+slot*3, m.gx, m.gz);
snapInto(ring.x, ring.z);
m.gx=scratchPt.x; m.gz=scratchPt.z;
m.path=null; m.pi=0; m.needPath=true;
}
function placeMember(m){
if(isNight(hours())){
m.x=m.hx; m.z=m.hz; m.hidden=true; m.night=true; m.moving=false;
m.needPath=false; m.goalKind=1; m.gx=m.hx; m.gz=m.hz; m.hideOnArrive=true;
m.slot=-1;
return;
}
m.night=false; m.hidden=false; m.hideOnArrive=false;
const a=anchor(m.i);
snapInto(a.x, a.z);
m.x=scratchPt.x; m.z=scratchPt.z;
m.simT=hash2(seed, m.i, 19)*4;
m.slot=0;
pickGoal(m, Math.floor(hash2(seed, m.i, 25)*5));
m.slot=0;
}
function spawnAll(count){
allocBuffers(count);
members=new Array(count);
for(let i=0;i<count;i++){
const bi=homeList[Math.floor(hash2(seed, i, 1)*homeList.length)%homeList.length];
const planned=memberPlan&&memberPlan[i];
const arch=planned&&planned.role?planned.role:ARCH[Math.floor(hash2(seed, i, 2)*ARCH.length)%ARCH.length];
const tint=TUNICS[Math.floor(hash2(seed, i, 3)*TUNICS.length)%TUNICS.length];
const skin=SKIN[Math.floor(hash2(seed, i, 4)*SKIN.length)%SKIN.length];
const hair=HAIR[Math.floor(hash2(seed, i, 6)*HAIR.length)%HAIR.length];
const hp=homeOf(area, bi);
snapInto(hp.x, hp.z);
const m={
i:i, id:"crowd-"+i, home:bi, talkable:false,
arch:arch, tint:tint, skin:skin, hair:hair,
archObj:{id:arch, role:arch, tier:planned&&planned.tier||"village", tint:tint, skin:skin, hair:hair, scale:1, seed:planned&&planned.seed!=null?planned.seed:((seed^i)>>>0), n:i},
hx:scratchPt.x, hz:scratchPt.z, x:scratchPt.x, z:scratchPt.z,
yaw:hash2(seed, i, 9)*6.28318530718,
gx:scratchPt.x, gz:scratchPt.z, goalKind:1, goalId:bi, hideOnArrive:false,
speed:1.15+hash2(seed, i, 5)*0.4,
period:12+hash2(seed, i, 8)*10,
simT:0, slot:-1, idle:0, phase:hash2(seed, i, 10)*6.28318530718,
moving:false, hidden:false, night:false, active:false, lod:2,
path:null, pi:0, needPath:false, stuck:0, retry:0,
acc:hash2(seed, i, 15)*0.45, d2:1e18, body:null, _keep:0, ticked:false, lastDt:0
};
placeMember(m);
members[i]=m;
}
refreshAcc=REFRESH_S;
refreshActive();
}
function pathKey(m){
const q=8;
return ((m.x/q)|0)+","+((m.z/q)|0)+">"+((m.gx/q)|0)+","+((m.gz/q)|0);
}
function storePath(key, path){
if(pathCache.has(key)) return;
pathCache.set(key, path);
cacheKeys.push(key);
if(cacheKeys.length>PATH_CACHE_MAX){
const old=cacheKeys.shift();
pathCache.delete(old);
}
}
function closest(path, x, z){
const pts=path.points;
let best=0, bd=1e18;
for(let i=0;i<pts.length;i++){
const dx=pts[i].x-x, dz=pts[i].z-z, d=dx*dx+dz*dz;
if(d<bd){ bd=d; best=i; }
}
return best;
}
function arrive(m){
m.moving=false; m.path=null; m.needPath=false; m.pi=0; m.stuck=0;
if(openMeter(m.gx, m.gz)){ m.x=m.gx; m.z=m.gz; }
if(m.hideOnArrive){
m.hidden=true; m.x=m.hx; m.z=m.hz; m.moving=false;
return;
}
if(m.goalKind===2) m.idle=3.2+hash2(seed, m.i, m.slot+3)*6.5;
else m.idle=0.7+hash2(seed, m.i, m.slot+5)*1.6;
}
function stepPath(m, dt){
const pts=m.path&&m.path.points;
if(!pts||!pts.length){ m.path=null; m.needPath=true; return; }
let left=m.speed*dt, guard=0;
while(left>0&&m.pi<pts.length&&guard++<8){
const p=pts[m.pi];
const dx=p.x-m.x, dz=p.z-m.z;
const d=Math.hypot(dx, dz);
if(d<0.16){ m.pi++; continue; }
const step=d<left?d:left;
const nx=m.x+dx/d*step, nz=m.z+dz/d*step;
if(!openMeter(nx, nz)){ m.moving=false; m.stuck+=dt; return; }
m.x=nx; m.z=nz; left-=step;
m.yaw=Math.atan2(dx, dz);
m.moving=true; m.stuck=0;
}
if(m.pi>=pts.length||Math.hypot(m.gx-m.x, m.gz-m.z)<0.7) arrive(m);
else if(m.stuck>1.6){ m.stuck=0; m.path=null; m.needPath=true; }
}
function stepDirect(m, dt){
const dx=m.gx-m.x, dz=m.gz-m.z;
const dist=Math.hypot(dx, dz);
if(dist<0.7){ arrive(m); return; }
const step=dist<m.speed*dt?dist:m.speed*dt;
const nx=m.x+dx/dist*step, nz=m.z+dz/dist*step;
if(!openMeter(nx, nz)){ m.moving=false; return; }
m.x=nx; m.z=nz;
m.yaw=Math.atan2(dx, dz);
m.moving=true;
}
function considerPath(m, list, n){
if(!m.needPath||m.lod>=2) return n;
const key=pathKey(m);
const hit=pathCache.get(key);
if(hit){ m.path=hit; m.pi=closest(hit, m.x, m.z); m.needPath=false; return n; }
list[n]=m.i;
return n+1;
}
function runAstar(list, n, budget){
let spent=0;
for(let r=0;r<n&&spent<budget;r++){
const m=members[list[r]];
if(!m||!m.needPath) continue;
const key=pathKey(m);
const hit=pathCache.get(key);
if(hit){ m.path=hit; m.pi=closest(hit, m.x, m.z); m.needPath=false; continue; }
if(!window.TBNpcs||!TBNpcs.findPath||!nav){ m.needPath=false; continue; }
const path=TBNpcs.findPath(nav, m.x, m.z, m.gx, m.gz, false);
spent++;
astarTotal++;
if(path&&path.points&&path.points.length){
storePath(key, path);
m.path=path; m.pi=closest(path, m.x, m.z); m.needPath=false;
}else m.needPath=false;
}
return spent;
}
function simOne(m, motion, night){
m.ticked=false;
m.d2=dist2ToView(m.x, m.z);
updateLod(m);
if(night!==m.night){
m.night=night;
m.idle=0; m.stuck=0;
if(night){
m.gx=m.hx; m.gz=m.hz; m.goalKind=1; m.goalId=m.home;
m.hideOnArrive=true; m.hidden=false; m.path=null; m.needPath=true; m.slot=-1;
if(Math.hypot(m.x-m.hx, m.z-m.hz)<0.8){
m.hidden=true; m.x=m.hx; m.z=m.hz; m.needPath=false; m.moving=false;
}
}else{
m.hidden=false; m.hideOnArrive=false; m.slot=-999;
}
}
syncPresence(m);
if(m.hidden&&night){ m.moving=false; return; }
m.acc+=motion;
const quota=m.lod===0?0:m.lod===1?0.16:0.45;
if(m.lod!==0&&m.acc<quota) return;
const dt=m.lod===0?motion:m.acc;
m.acc=0;
m.ticked=true;
m.lastDt=dt;
if(dt<=0) return;
m.simT+=dt;
if(m.idle>0){
m.idle-=dt;
m.moving=false;
if(m.idle>0) return;
}
if(!night){
const slot=Math.floor(m.simT/m.period);
if(slot!==m.slot){ m.slot=slot; pickGoal(m, slot); }
}
if(m.needPath&&m.retry && m.simT<m.retry) m.needPath=false;
if(m.path&&m.lod<2) stepPath(m, dt);
else stepDirect(m, dt);
if(m.moving) m.phase+=dt*6.4;
}
function pushPair(a,b){
let dx=b.x-a.x, dz=b.z-a.z;
const d2=dx*dx+dz*dz;
const need=0.52;
if(d2>=need*need||d2<1e-8) return;
const d=Math.sqrt(d2);
const p=(need-d)*0.5;
dx/=d; dz/=d;
const ax=a.x-dx*p, az=a.z-dz*p, bx=b.x+dx*p, bz=b.z+dz*p;
if(openMeter(ax, az)){ a.x=ax; a.z=az; }
if(openMeter(bx, bz)){ b.x=bx; b.z=bz; }
}
function pushFrom(m, ox, oz, rad){
let dx=m.x-ox, dz=m.z-oz;
const d2=dx*dx+dz*dz;
const need=rad+0.48;
if(d2>=need*need||d2<1e-6) return;
const d=Math.sqrt(d2);
const p=need-d;
const nx=m.x+dx/d*p, nz=m.z+dz/d*p;
if(openMeter(nx, nz)){ m.x=nx; m.z=nz; }
}
function separateNear(){
if(nearScratchN<1) return;
ghead.fill(-1);
const ox=vx[0]-GW*GS*0.5, oz=vz[0]-GW*GS*0.5;
for(let s=0;s<nearScratchN;s++){
const i=nearScratch[s];
const m=members[i];
let cx=(m.x-ox)/GS|0, cz=(m.z-oz)/GS|0;
if(cx<0) cx=0; else if(cx>=GW) cx=GW-1;
if(cz<0) cz=0; else if(cz>=GW) cz=GW-1;
const cell=cz*GW+cx;
nxt[i]=ghead[cell];
ghead[cell]=i;
}
if(window.TBNpcs&&TBNpcs.actors){
const list=TBNpcs.actors();
npcSepN=0;
for(let i=0;i<list.length&&npcSepN<48;i++){
const a=list[i];
if(!a||a.hidden) continue;
npcX[npcSepN]=a.x; npcZ[npcSepN]=a.z; npcSepN++;
}
}else npcSepN=0;
for(let s=0;s<nearScratchN;s++){
const i=nearScratch[s];
const m=members[i];
let cx=(m.x-ox)/GS|0, cz=(m.z-oz)/GS|0;
if(cx<0) cx=0; else if(cx>=GW) cx=GW-1;
if(cz<0) cz=0; else if(cz>=GW) cz=GW-1;
for(let dz=-1;dz<=1;dz++) for(let dx=-1;dx<=1;dx++){
const x=cx+dx, z=cz+dz;
if(x<0||z<0||x>=GW||z>=GW) continue;
let j=ghead[z*GW+x];
while(j>=0){
if(j>i) pushPair(m, members[j]);
j=nxt[j];
}
}
for(let a=0;a<npcSepN;a++) pushFrom(m, npcX[a], npcZ[a], 0.55);
}
}
function syncBody(m, dt){
const b=m.body;
if(!b) return;
if(b.setLod) b.setLod(m.lod);
if(b.setMoving) b.setMoving(!!m.moving&&!m.hidden);
if(b.setVisible) b.setVisible(!m.hidden&&m.lod<2);
const y=footY(m.x, m.z);
if(b.place) b.place(m.x, y, m.z, m.yaw, m.phase, !!m.moving);
else if(b.object3d){
b.object3d.visible=!m.hidden&&m.lod<2;
b.object3d.position.set(m.x, y, m.z);
b.object3d.rotation.y=m.yaw;
}
if(m.lod===0&&b.update) b.update(dt);
}
function crowdUpdate(dt){
if(provider&&provider.pump)provider.pump();
const t0=typeof performance!=="undefined"&&performance.now?performance.now():0;
const raw=dt>0?dt:0;
if(!members.length){ lastMs=t0?performance.now()-t0:0; astarFrame=0; return; }
const motion=motionOf(raw);
const night=isNight(hours());
sampleViewers();
refreshAcc+=raw;
if(refreshAcc>=REFRESH_S){ refreshAcc=0; refreshActive(); }
else{
for(let i=0;i<activeN;i++){
const m=members[activeIdx[i]];
m.d2=dist2ToView(m.x, m.z);
}
}
nearScratchN=0;
let nearReq=0, midReq=0;
for(let i=0;i<activeN;i++){
const m=members[activeIdx[i]];
simOne(m, motion, night);
if(m.lod===0&&!m.hidden) nearScratch[nearScratchN++]=m.i;
nearReq=considerPath(m, reqNear, nearReq);
midReq=considerPath(m, reqMid, midReq);
}
separateNear();
let spent=runAstar(reqNear, nearReq, ASTAR_BUDGET);
spent+=runAstar(reqMid, midReq, ASTAR_BUDGET-spent);
astarFrame=spent;
for(let i=0;i<activeN;i++){
const m=members[activeIdx[i]];
if(!m.body) continue;
syncBody(m, m.lod===0?raw:(m.ticked?m.lastDt:0));
}
if(provider&&provider.flush) provider.flush();
lastMs=t0?performance.now()-t0:0;
}
function crowdOnArea(p, opt){
if(!p){ clearCrowd(); area=null; return; }
const token=builtToken;
if(opt&&opt.same&&area&&members.length&&token) return;
area=p;
clearCrowd();
const qCount=queryNum("crowd");
const qCap=queryNum("crowdCap");
activeCap=qCap!=null?clampCount(qCap):ACTIVE_CAP;
const pop=p.population&&typeof p.population==="object"?p.population:null;
popMode=pop&&pop.mode?String(pop.mode):"";
popAvg=pop&&isFinite(+pop.avg)?+pop.avg:0;
seed=pop&&isFinite(+pop.seed)?(+pop.seed|0):((p.area&&p.area.placeSeed)|0)||1;
if(!seed) seed=1;
/* population.count is the town census. Named residents in npcs.list are already
   real bodies, so the crowd is what's left. ?crowd=N skips that subtraction. */
let named=0;
if(pop&&pop.named!=null&&isFinite(+pop.named)) named=Math.max(0, Math.round(+pop.named));
else if(p.npcs&&Array.isArray(p.npcs.list)) named=p.npcs.list.length;
const census=pop&&isFinite(+pop.count)?Math.round(+pop.count):0;
let count=qCount!=null?clampCount(qCount):clampCount(Math.max(0, census-named));
nav=window.TBNpcs&&TBNpcs.buildNav?TBNpcs.buildNav(p):null;
readDoors(p);
fallbackViewer(p);
readHomes(p, pop);
readHotspots(p, pop);
sampleRoads();
ensureProviders();
if(window.TBCharacters&&TBCharacters.planCrowd){
const planned=TBCharacters.planCrowd(p, count);
memberPlan=planned.members;
count=planned.count;
}else memberPlan=null;
if(window.__tbEntry)window.__tbEntry.count=count;
if(canDraw()&&window.TBCharacters&&TBCharacters.crowdProvider)setBodyProvider(TBCharacters.crowdProvider());
if(count>0) spawnAll(count);
builtToken++;
}
function makeStub(cap){
let seq=0;
const api={
kind:"stub", mode:"stub", capacity:cap, created:0,
attach:function(){}, flush:function(){}, dispose:function(){}, reset:function(){ api.created=0; },
create:function(arch){
const b={
object3d:null, arch:arch, lod:1, moving:false, visible:true, id:++seq, dead:false,
x:0, y:0, z:0, yaw:0,
setMoving:function(v){ b.moving=!!v; },
setLod:function(l){ b.lod=l; },
setVisible:function(v){ b.visible=!!v; },
apply:function(a){ b.arch=a; },
place:function(x,y,z,yaw){ b.x=x; b.y=y; b.z=z; b.yaw=yaw; },
update:function(){},
dispose:function(){ b.dead=true; b.visible=false; }
};
api.created++;
return b;
}
};
return api;
}
function makeInstanced(cap){
/* Chibi pawn at 1.05× the player GLB. Body is twice as tall as it is wide.
   The head sphere is 37.5% of the total height. Instance scale is uniform 1.
   CylinderGeometry is copied to a plain BufferGeometry: r128 does not draw
   an instanced CylinderGeometry that has been in the scene at count 0. */
function plain(src){
const g=new THREE.BufferGeometry();
g.setAttribute("position", src.attributes.position.clone());
g.setAttribute("normal", src.attributes.normal.clone());
if(src.attributes.uv) g.setAttribute("uv", src.attributes.uv.clone());
if(src.index) g.setIndex(src.index.clone());
src.dispose();
return g;
}
const bodySrc=new THREE.CylinderGeometry(PAWN.bodyRadius, PAWN.bodyRadius, PAWN.bodyHeight, 8);
bodySrc.translate(0, PAWN.bodyHeight*0.5, 0);
const bodyGeo=plain(bodySrc);
const headSrc=new THREE.SphereGeometry(PAWN.headR, 8, 6);
headSrc.translate(0, PAWN.headCenter, 0);
const headGeo=plain(headSrc);
const group=new THREE.Group();
group.name="tb-crowd";
group.userData.tbKeep=1;
if(ctx&&ctx.scene) ctx.scene.add(group);
const _m=new THREE.Matrix4();
const _p=new THREE.Vector3();
const _q=new THREE.Quaternion();
const _s=new THREE.Vector3(1,1,1);
const _e=new THREE.Euler(0,0,0,"YXZ");
function addPool(geo, colors){
const meshes=[], mats=[], high=[], free=[];
for(let i=0;i<colors.length;i++){
const mat=new THREE.MeshLambertMaterial({color:new THREE.Color(colors[i])});
const mesh=new THREE.InstancedMesh(geo, mat, cap);
mesh.count=0; mesh.frustumCulled=false; mesh.castShadow=false; mesh.receiveShadow=false;
group.add(mesh);
meshes.push(mesh); mats.push(mat); high.push(0); free.push([]);
}
return {meshes:meshes, mats:mats, high:high, free:free};
}
const bodies=addPool(bodyGeo, TUNICS);
const heads=addPool(headGeo, SKIN);
function hideSlot(mesh, slot){
_m.makeScale(0,0,0);
mesh.setMatrixAt(slot, _m);
}
function allocSlot(pool, ci){
const stack=pool.free[ci];
if(stack.length) return stack.pop();
const slot=pool.high[ci]++;
pool.meshes[ci].count=pool.high[ci];
return slot;
}
function freeSlot(pool, ci, slot){
if(slot==null||ci==null) return;
hideSlot(pool.meshes[ci], slot);
pool.free[ci].push(slot);
}
const handles=new Array(cap);
let made=0;
function makeHandle(){
const b={
object3d:null, alive:false, lod:1, moving:false, arch:null,
tintI:0, skinI:0, slotB:null, slotH:null,
setMoving:function(v){ b.moving=!!v; },
setLod:function(level){ b.lod=level; },
setVisible:function(v){ if(!v){ freeSlot(bodies, b.tintI, b.slotB); freeSlot(heads, b.skinI, b.slotH); b.slotB=b.slotH=null; } },
apply:function(arch){
b.arch=arch;
const ti=Math.max(0, TUNICS.indexOf(arch&&arch.tint));
const si=Math.max(0, SKIN.indexOf(arch&&arch.skin));
if(b.slotB!=null&&b.tintI!==ti){ freeSlot(bodies, b.tintI, b.slotB); b.slotB=null; }
if(b.slotH!=null&&b.skinI!==si){ freeSlot(heads, b.skinI, b.slotH); b.slotH=null; }
b.tintI=ti; b.skinI=si;
if(b.slotB==null) b.slotB=allocSlot(bodies, ti);
if(b.slotH==null) b.slotH=allocSlot(heads, si);
},
place:function(x,y,z,yaw){
if(b.slotB==null||b.slotH==null) return;
_e.y=yaw||0;
_q.setFromEuler(_e);
_s.set(1, 1, 1);
_p.set(x, y||0, z);
_m.compose(_p, _q, _s);
bodies.meshes[b.tintI].setMatrixAt(b.slotB, _m);
heads.meshes[b.skinI].setMatrixAt(b.slotH, _m);
},
update:function(){},
dispose:function(){
b.alive=false;
freeSlot(bodies, b.tintI, b.slotB);
freeSlot(heads, b.skinI, b.slotH);
b.slotB=b.slotH=null;
}
};
return b;
}
return {
kind:"instanced", mode:"instanced", capacity:cap, created:0,
attach:function(c){ if(!group.parent&&c&&c.scene) c.scene.add(group); },
create:function(arch){
if(made>=cap) return null;
const b=handles[made]||(handles[made]=makeHandle());
made++;
b.alive=true; b.slotB=null; b.slotH=null;
b.apply(arch);
this.created++;
return b;
},
reset:function(){
made=0; this.created=0;
for(let i=0;i<bodies.meshes.length;i++){ bodies.meshes[i].count=0; bodies.high[i]=0; bodies.free[i].length=0; }
for(let i=0;i<heads.meshes.length;i++){ heads.meshes[i].count=0; heads.high[i]=0; heads.free[i].length=0; }
for(let i=0;i<handles.length;i++) if(handles[i]){ handles[i].alive=false; handles[i].slotB=handles[i].slotH=null; }
},
flush:function(){
for(let i=0;i<bodies.meshes.length;i++) bodies.meshes[i].instanceMatrix.needsUpdate=true;
for(let i=0;i<heads.meshes.length;i++) heads.meshes[i].instanceMatrix.needsUpdate=true;
},
dispose:function(){
if(group.parent) group.parent.remove(group);
bodyGeo.dispose(); headGeo.dispose();
for(let i=0;i<bodies.mats.length;i++) bodies.mats[i].dispose();
for(let i=0;i<heads.mats.length;i++) heads.mats[i].dispose();
}
};
}
function ensureProviders(){
const cap=Math.max(1, activeCap||queryNum("crowdCap")||ACTIVE_CAP);
const mode=canDraw()?"instanced":"stub";
if(placeholder&&placeholder.capacity>=cap&&placeholder.mode===mode) return;
const using=!provider||provider===placeholder;
if(placeholder&&placeholder.dispose) placeholder.dispose();
placeholder=mode==="instanced"?makeInstanced(cap):makeStub(cap);
if(using) provider=placeholder;
}
function setBodyProvider(p){
if(!p) return;
for(let i=0;i<members.length;i++) if(members[i].body) release(members[i]);
for(let i=0;i<freeN;i++) if(freeStack[i]&&freeStack[i].dispose) freeStack[i].dispose();
freeN=0;
if(provider&&provider!==placeholder&&provider!==p&&provider.dispose) provider.dispose();
provider=p;
if(p.attach&&ctx) p.attach(ctx);
for(let i=0;i<members.length;i++) syncPresence(members[i]);
}
function pickManifest(entries, arch){
if(!entries||!entries.length) return null;
const id=arch&&arch.id?arch.id:String(arch||"");
const tagged=[];
for(let i=0;i<entries.length;i++){
const e=entries[i];
if(!e) continue;
if(!e.tags||!e.tags.length||e.tags.indexOf(id)>=0) tagged.push(e);
}
const pool=tagged.length?tagged:entries;
let sum=0;
for(let i=0;i<pool.length;i++) sum+=+pool[i].weight>0?+pool[i].weight:1;
let u=hash2(arch&&arch.seed||0, arch&&arch.n||0, 9)*sum;
for(let i=0;i<pool.length;i++){
u-=+pool[i].weight>0?+pool[i].weight:1;
if(u<=0) return pool[i];
}
return pool[0];
}
function findClip(anims, name){
if(!anims) return null;
for(let i=0;i<anims.length;i++) if(anims[i]&&anims[i].name===name) return anims[i];
return null;
}
function createGlbProvider(entries){
const root=(typeof THREE!=="undefined"&&THREE.Group)?new THREE.Group():null;
if(root){
root.name="tb-crowd-glb";
if(!root.userData) root.userData={};
root.userData.tbKeep=1;
if(ctx&&ctx.scene) ctx.scene.add(root);
}
const api={
kind:"glb", mode:"glb", capacity:POOL_MAX, created:0, entries:entries,
attach:function(c){ if(root&&!root.parent&&c&&c.scene) c.scene.add(root); },
flush:function(){},
reset:function(){},
dispose:function(){ if(root&&root.parent) root.parent.remove(root); },
create:function(arch){
const entry=pickManifest(entries, arch);
if(!entry||typeof THREE==="undefined"||!THREE.SkeletonUtils) return null;
let object3d=null;
try{ object3d=THREE.SkeletonUtils.clone(entry.template); }
catch(e){ return null; }
if(!object3d) return null;
if(root&&object3d) root.add(object3d);
api.created++;
const clips=entry.clips||{};
const b={
object3d:object3d,
clipIdle:clips.idle||null,
clipWalk:clips.walk||null,
mixer:null, idleAction:null, walkAction:null,
mixerUpdates:0, lod:1, moving:false, posed:false, arch:arch,
setMoving:function(v){ b.moving=!!v; },
setLod:function(level){
b.lod=level;
if(level===0) b.ensureMixer();
else b.poseIdle();
},
setVisible:function(v){ if(object3d) object3d.visible=!!v; },
apply:function(a){ b.arch=a; },
place:function(x,y,z,yaw){
if(!object3d||!object3d.position) return;
object3d.visible=true;
object3d.position.set(x,y,z);
if(object3d.rotation) object3d.rotation.y=yaw;
const s=b.arch&&b.arch.scale||1;
if(object3d.scale&&object3d.scale.setScalar) object3d.scale.setScalar(s);
},
ensureMixer:function(){
if(b.mixer||typeof THREE==="undefined"||!THREE.AnimationMixer) return;
const mixer=new THREE.AnimationMixer(object3d);
b.mixer=mixer;
if(b.clipIdle){ b.idleAction=mixer.clipAction(b.clipIdle); b.idleAction.play(); }
if(b.clipWalk){
b.walkAction=mixer.clipAction(b.clipWalk);
b.walkAction.play();
if(b.walkAction.setEffectiveWeight) b.walkAction.setEffectiveWeight(0);
}
},
poseIdle:function(){
if(b.posed||!b.clipIdle||typeof THREE==="undefined"||!THREE.AnimationMixer) return;
const tmp=new THREE.AnimationMixer(object3d);
const a=tmp.clipAction(b.clipIdle);
if(a.play) a.play();
tmp.update(1/60);
if(tmp.stopAllAction) tmp.stopAllAction();
b.posed=true;
},
update:function(dt){
if(b.lod!==0) return;
b.ensureMixer();
if(!b.mixer) return;
const w=b.moving&&b.walkAction?1:0;
if(b.walkAction&&b.walkAction.setEffectiveWeight) b.walkAction.setEffectiveWeight(w);
if(b.idleAction&&b.idleAction.setEffectiveWeight) b.idleAction.setEffectiveWeight(b.walkAction?1-w:1);
b.mixer.update(dt>0?dt:0);
b.mixerUpdates++;
},
dispose:function(){
if(object3d&&object3d.parent&&object3d.parent.remove) object3d.parent.remove(object3d);
}
};
b.poseIdle();
return b;
}
};
return api;
}
function adoptManifest(list){
if(!Array.isArray(list)||!list.length) return;
if(typeof THREE==="undefined"||!THREE.GLTFLoader||!THREE.SkeletonUtils) return;
const loader=new THREE.GLTFLoader();
const entries=[];
let pending=list.length;
function finish(){
if(--pending>0) return;
if(!entries.length) return;
const glb=createGlbProvider(entries);
if(glb) setBodyProvider(glb);
}
for(let i=0;i<list.length;i++){
(function(row){
const idleN=row&&row.clips&&row.clips.idle||"Idle";
const walkN=row&&row.clips&&row.clips.walk||"Walk";
try{
loader.load(row.glb, function(gltf){
const anims=gltf&&gltf.animations||[];
entries.push({
id:String(row.id||"npc"),
weight:+row.weight>0?+row.weight:1,
tags:Array.isArray(row.tags)?row.tags.slice():[],
template:gltf.scene,
clips:{idle:findClip(anims, idleN), walk:findClip(anims, walkN)}
});
finish();
}, undefined, function(){ finish(); });
}catch(e){ finish(); }
})(list[i]);
}
}
function tryManifest(){
if(manifestTried) return;
manifestTried=true;
if(typeof fetch!=="function") return;
if(typeof document==="undefined") return;
/* Empty array in public/assets/npc/manifest.json keeps the placeholder pool. */
let url=TB_ROOT+"npc/manifest.json";
try{ if(typeof location!=="undefined"&&location.href) url=new URL(TB_ROOT+"npc/manifest.json", location.href).href; }
catch(e){}
try{
fetch(url).then(function(r){
if(!r||!r.ok) return null;
return r.json();
}).then(function(list){ if(list) adoptManifest(list); }).catch(function(){});
}catch(e){}
}
let talkHandler=null;
function setTalkHandler(fn){ talkHandler=typeof fn==="function"?fn:null; }
function talkableAt(x,z){
let best=null, bd=2.4*2.4;
for(let i=0;i<activeN;i++){
const m=members[activeIdx[i]];
if(!m||!m.talkable||m.hidden) continue;
const dx=m.x-x, dz=m.z-z, d=dx*dx+dz*dz;
if(d<bd){ bd=d; best=m; }
}
if(best&&talkHandler) talkHandler(best);
return best;
}
function stats(){
let parked=0, hidden=0, near=0, mid=0, far=0, bodies=0;
for(let i=0;i<members.length;i++){
const m=members[i];
if(!m.active) parked++;
if(m.hidden) hidden++;
if(m.active&&m.lod===0) near++;
else if(m.active&&m.lod===1) mid++;
else if(m.active) far++;
if(m.body) bodies++;
}
return {
count:members.length, active:activeN, parked:parked, hidden:hidden,
near:near, mid:mid, far:far, visible:bodies, bodies:bodies,
bodiesCreated:provider&&provider.created||0,
astar:astarFrame, astarTotal:astarTotal, cache:pathCache.size,
cap:activeCap, ms:lastMs, seed:seed, mode:popMode, avg:popAvg
};
}
function crowdAttach(c){
ctx=c||ctx;
ensureProviders();
if(provider&&provider.attach&&ctx) provider.attach(ctx);
if(placeholder&&placeholder!==provider&&placeholder.attach&&ctx) placeholder.attach(ctx);
tryManifest();
}
function hookNpcs(){
if(!window.TBNpcs||!TBNpcs.update||TBNpcs.update._tbCrowd) return;
const u=TBNpcs.update, o=TBNpcs.onArea, a=TBNpcs.attach;
function update(dt){ u(dt); crowdUpdate(dt); }
update._tbCrowd=1;
function onArea(p,opt){ if(o) o(p, opt); crowdOnArea(p, opt); }
onArea._tbCrowd=1;
function attach(c){ if(a) a(c); crowdAttach(c); }
attach._tbCrowd=1;
TBNpcs.update=update;
TBNpcs.onArea=onArea;
TBNpcs.attach=attach;
}
function setHours(h){ hoursOverride=h==null?null:+h; }
function setViewer(v){
if(v==null) viewerOverride=null;
else viewerOverride=Array.isArray(v)?v:[v];
if(members.length) refreshActive();
}
hookNpcs();
window.TBCrowd={
ACTIVE_CAP:ACTIVE_CAP,
attach:crowdAttach,
update:crowdUpdate,
onArea:crowdOnArea,
setBodyProvider:setBodyProvider,
setHours:setHours,
setViewer:setViewer,
stats:stats,
members:function(){ return members; },
pickManifest:pickManifest,
createGlbProvider:createGlbProvider,
adoptManifest:adoptManifest,
talkableAt:talkableAt,
setTalkHandler:setTalkHandler,
metrics:function(){
return {
playerHeight:PAWN.playerHeight, height:PAWN.height,
bodyHeight:PAWN.bodyHeight, bodyWidth:PAWN.bodyWidth,
headDiameter:PAWN.headDiameter, scale:PAWN.scale.slice()
};
}
};
})();
