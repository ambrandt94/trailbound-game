/* Ported from trailbound-controller (deployed main). ESM, behaviour-faithful.
   Not typechecked: a full TS conversion of these files would stall the port.
   three r187: colorSpace, colorspace_fragment, per-fragment Lambert cel, asset root.
*/
import { THREE } from './three-runtime.js';
/* Live and standalone NPCs for an AreaExport.
   The map owns who they are and what they intend. This file walks them on a 1 m
   grid taken from grid.mask, minus water and building walls, and draws a
   placeholder body. Speeds are real metres per second (clock-true): a pause
   (clock rate 0) freezes them, and any running clock moves them at `speed`.
   With no live session, the v0.4 `npcs` snapshot is walked the same way.
   Indoors bodies are hidden. Nothing is parked in the interior instance. */
(function(){
const STRUCT=["wall","window","tower"];
const COST={road:1,dirt:1,plaza:1,lot:1.5,yard:1.5,grass:2,sand:2.5,rock:3};
const DIRS=[[1,0,1],[-1,0,1],[0,1,1],[0,-1,1],[1,1,Math.SQRT2],[1,-1,Math.SQRT2],[-1,1,Math.SQRT2],[-1,-1,Math.SQRT2]];
const SIDE={N:[0,-1],S:[0,1],E:[1,0],W:[-1,0]};
const MAX_LEADS=16, MAX_BODIES=40, ARMY_SHOW=15;
/* makePerson local bounds: boot sole to hair crown. Scaled so that span matches TBCrowd. */
const PERSON_BOTTOM=0.11, PERSON_TOP=1.425;
function personScale(){
const h=window.TBCrowd&&TBCrowd.metrics?TBCrowd.metrics().height:(PERSON_TOP-PERSON_BOTTOM);
return h/(PERSON_TOP-PERSON_BOTTOM);
}
function placeholderHeight(){return (PERSON_TOP-PERSON_BOTTOM)*personScale();}
const TUNICS=["#c45c3a","#2f7d4a","#3a6294","#c4963a","#7a4e78","#3f8a8a"];
const HAIR=["#6b3a22","#c4a15a","#4a3428","#8a4a28","#d8c4a4"];
const SKIN=["#e0b090","#c48860","#f0c8a8","#8a5a3c"];
let ctx=null, area=null, nav=null, actors=[], doors=[], entries=[], seed=1;
let frameN=0, standalone=false;

function decodeU8(layer,n){
if(!layer)return null;
let src=layer;
if(layer.enc||layer.data)src=layer.data!=null?layer.data:null;
if(!src)return null;
let out;
if(Array.isArray(src))out=Uint8Array.from(src);
else if(typeof src==="string"){
if(typeof atob!=="function")return null;
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
function hash2(a,b,c){
let n=Math.imul((a|0)+Math.imul(b|0,374761393),668265263)^Math.imul((c|0)^((a|0)*1274126177),2246822519);
n=Math.imul(n^(n>>>13),3266489917);
return ((n^(n>>>16))>>>0)/4294967295;
}
function idNum(id){
let h=2166136261;id=String(id||"");
for(let i=0;i<id.length;i++){h^=id.charCodeAt(i);h=Math.imul(h,16777619);}
return h>>>0;
}
function r1(n){return Math.round(n*10)/10;}
function zoneOf(area,ix,iy){
const O=area.area.innerOrigin||{x:0,y:0};
const m=(area.units&&+area.units.metersPerTile)||1;
return {x:(+ix-+O.x)*m,z:(+iy-+O.y)*m};
}
function buildNav(p){
const w=p.grid.w|0,h=p.grid.h|0,n=w*h;
const mask=decodeU8(p.grid.mask,n);
const gnd=decodeU8(p.layers.ground,n);
const gL=legendOf(p.layers.ground,["grass","dirt","road","lot","plaza","water","sand","rock"]);
const m=(p.units&&+p.units.metersPerTile)||1;
const O=p.area.innerOrigin||{x:0,y:0};
const walk=new Uint8Array(n),cost=new Float32Array(n),wall=new Uint8Array(n),place=new Uint8Array(n);
const ground=new Array(n);
if(!mask||!gnd)return {w:w,h:h,m:m,walk:walk,cost:cost,wall:wall,ground:ground,place:place};
for(let i=0;i<n;i++){
const name=gL[gnd[i]]||"grass";
ground[i]=name;
if(mask[i])place[i]=1;
if(!mask[i]||name==="water")continue;
walk[i]=1;
cost[i]=COST[name]||2;
}
const buildings=p.buildings||[];
for(let bi=0;bi<buildings.length;bi++){
const b=buildings[bi];
const tiles=b&&b.tiles; if(!tiles)continue;
const tw=tiles.w|0,th=tiles.h|0;
const grid=decodeU8(tiles,tw*th); if(!grid)continue;
const leg=legendOf(tiles,["void","yard","floor","wall","door","window","tower"]);
const plotX=b.plotX!=null?+b.plotX:+b.x-(+b.footW||tw)/2;
const plotY=b.plotY!=null?+b.plotY:+b.y-(+b.footD||th);
const ox=(plotX-+O.x)*m, oz=(plotY-+O.y)*m;
for(let ty=0;ty<th;ty++)for(let tx=0;tx<tw;tx++){
const name=leg[grid[ty*tw+tx]]||"void";
if(STRUCT.indexOf(name)<0)continue;
const cx=Math.floor((ox+tx*m+0.5*m)/m), cz=Math.floor((oz+ty*m+0.5*m)/m);
if(cx<0||cz<0||cx>=w||cz>=h)continue;
const i=cz*w+cx;
wall[i]=1; walk[i]=0;
}
}
return {w:w,h:h,m:m,walk:walk,cost:cost,wall:wall,ground:ground,place:place};
}
function openAt(nav,cx,cz){
if(cx<0||cz<0||cx>=nav.w||cz>=nav.h)return false;
return nav.walk[cz*nav.w+cx]===1;
}
function nearestOpen(nav,cx,cz,rad){
if(openAt(nav,cx,cz))return {x:cx,z:cz};
let best=null,bd=1e9;
rad=rad==null?8:rad;
for(let dz=-rad;dz<=rad;dz++)for(let dx=-rad;dx<=rad;dx++){
if(!openAt(nav,cx+dx,cz+dz))continue;
const d=dx*dx+dz*dz; if(d<bd){bd=d;best={x:cx+dx,z:cz+dz};}
}
return best;
}
function see(nav,a,b,viaRoad){
let x0=a.x,z0=a.z,x1=b.x,z1=b.z;
const dx=Math.abs(x1-x0),dz=Math.abs(z1-z0);
let x=x0,z=z0,n=1+dx+dz;
const xi=x1>x0?1:-1, zi=z1>z0?1:-1;
let err=dx-dz, dx2=dx*2, dz2=dz*2;
for(;n>0;n--){
if(!openAt(nav,x,z))return false;
if(viaRoad&&nav.ground[z*nav.w+x]==="grass")return false;
if(err>0){x+=xi;err-=dz2;}
else if(err<0){z+=zi;err+=dx2;}
else{x+=xi;z+=zi;err+=dx2-dz2;n--;}
}
return true;
}
function Heap(){this.a=[];}
Heap.prototype.push=function(node){
const a=this.a;a.push(node);let i=a.length-1;
while(i>0){const p=(i-1)>>1;if(a[p].f<=a[i].f)break;const t=a[p];a[p]=a[i];a[i]=t;i=p;}
};
Heap.prototype.pop=function(){
const a=this.a;if(!a.length)return null;
const top=a[0],last=a.pop();
if(a.length){a[0]=last;let i=0;for(;;){
let l=i*2+1,r=l+1,s=i;
if(l<a.length&&a[l].f<a[s].f)s=l;
if(r<a.length&&a[r].f<a[s].f)s=r;
if(s===i)break;
const t=a[s];a[s]=a[i];a[i]=t;i=s;
}}
return top;
};
function findPath(nav,x0,z0,x1,z1,viaRoad){
if(!nav)return null;
const m=nav.m||1;
let s=nearestOpen(nav,Math.floor(x0/m),Math.floor(z0/m),10);
let g=nearestOpen(nav,Math.floor(x1/m),Math.floor(z1/m),10);
if(!s||!g)return null;
const w=nav.w,h=nav.h,N=w*h;
const si=s.z*w+s.x, gi=g.z*w+g.x;
if(si===gi){
const pt={x:(s.x+0.5)*m,z:(s.z+0.5)*m};
return {points:[pt],cells:[s]};
}
const gScore=new Float64Array(N);gScore.fill(Infinity);
const prev=new Int32Array(N);prev.fill(-1);
gScore[si]=0;
const heap=new Heap();
heap.push({i:si,f:0,g:0});
const minC=1;
let guard=0;
while(heap.a.length&&guard++<N*8){
const cur=heap.pop();
if(cur.g!==gScore[cur.i])continue;
if(cur.i===gi)break;
const cx=cur.i%w, cz=(cur.i/w)|0;
for(let k=0;k<DIRS.length;k++){
const dx=DIRS[k][0],dz=DIRS[k][1];
const nx=cx+dx,nz=cz+dz;
if(!openAt(nav,nx,nz))continue;
if(dx&&dz&&(!openAt(nav,cx+dx,cz)||!openAt(nav,cx,nz)))continue;
const ni=nz*w+nx;
let c=nav.cost[ni]||2;
const gname=nav.ground[ni];
if(viaRoad&&gname==="grass")c=6;
const ng=gScore[cur.i]+c*DIRS[k][2];
if(ng>=gScore[ni])continue;
gScore[ni]=ng;prev[ni]=cur.i;
const hf=Math.hypot(nx-(gi%w),nz-((gi/w)|0))*minC;
heap.push({i:ni,f:ng+hf,g:ng});
}
}
if(prev[gi]<0&&si!==gi)return null;
const raw=[];
let c=gi;
raw.push({x:c%w,z:(c/w)|0});
while(c!==si){c=prev[c];if(c<0)return null;raw.push({x:c%w,z:(c/w)|0});if(raw.length>N)return null;}
raw.reverse();
const pulled=[];
let i=0;
while(i<raw.length){
pulled.push(raw[i]);
if(i===raw.length-1)break;
let nxt=i+1;
for(let k=raw.length-1;k>i;k--){if(see(nav,raw[i],raw[k],viaRoad)){nxt=k;break;}}
i=nxt;
}
const points=pulled.map(function(c){return {x:(c.x+0.5)*m,z:(c.z+0.5)*m};});
const cells=[];
for(let sgi=0;sgi<pulled.length-1;sgi++){
const a=pulled[sgi],b=pulled[sgi+1];
let x0=a.x,z0=a.z,x1=b.x,z1=b.z;
const dx=Math.abs(x1-x0),dz=Math.abs(z1-z0);
let x=x0,z=z0,n=1+dx+dz;
const xi=x1>x0?1:-1,zi=z1>z0?1:-1;
let err=dx-dz,dx2=dx*2,dz2=dz*2;
for(;n>0;n--){
cells.push({x:x,z:z});
if(err>0){x+=xi;err-=dz2;}
else if(err<0){z+=zi;err+=dx2;}
else{x+=xi;z+=zi;err+=dx2-dz2;n--;}
}
}
if(!cells.length)cells.push(pulled[0]);
cells.push(pulled[pulled.length-1]);
return {points:points,cells:cells,goal:{x:(g.x+0.5)*m,z:(g.z+0.5)*m}};
}
function listDoors(p){
const out=[]; if(!p)return out;
const O=p.area.innerOrigin||{x:0,y:0};
const m=(p.units&&+p.units.metersPerTile)||1;
const list=p.buildings||[];
for(let bi=0;bi<list.length;bi++){
const b=list[bi]; if(!b)continue;
const tiles=b.tiles;
let dx=0,dz=0,dn=0;
if(tiles){
const tw=tiles.w|0,th=tiles.h|0,grid=decodeU8(tiles,tw*th);
const leg=legendOf(tiles,["void","yard","floor","wall","door","window","tower"]);
const plotX=b.plotX!=null?+b.plotX:+b.x;
const plotY=b.plotY!=null?+b.plotY:+b.y;
const ox=(plotX-+O.x)*m, oz=(plotY-+O.y)*m;
if(grid){
for(let ty=0;ty<th;ty++)for(let tx=0;tx<tw;tx++){
if((leg[grid[ty*tw+tx]]||"")!=="door")continue;
dx+=ox+(tx+0.5)*m; dz+=oz+(ty+0.5)*m; dn++;
}
}
}
if(!dn&&b.doorCell){
dx=(+b.doorCell.x-+O.x)*m+0.5*m;
dz=(+b.doorCell.y-+O.y)*m+0.5*m;
dn=1;
}
if(!dn)continue;
dx/=dn;dz/=dn;
const s=SIDE[String(b.door||"S").toUpperCase()]||SIDE.S;
out.push({id:String(b.id),type:b.type||"",x:dx+s[0]*(0.5*m+0.8),z:dz+s[1]*(0.5*m+0.8)});
}
return out;
}
function listEntries(p){
const out=[]; if(!p||!p.entries)return out;
for(let i=0;i<p.entries.length;i++){
const e=p.entries[i];
const z=zoneOf(p,e.x,e.y);
out.push({id:e.id,kind:e.kind,side:e.side||null,x:z.x,z:z.z});
}
return out;
}
function distPt(a,x,z){
const px=a.pos?a.pos.x:a.x, pz=a.pos?a.pos.z:a.z;
if(px==null||pz==null)return 1e9;
return Math.hypot(px-x,pz-z);
}
function followerShow(ent){
let show=ent.members?ent.members.show|0:0;
if(show<0)show=0;
if(ent.kind==="army"&&show>ARMY_SHOW)show=ARMY_SHOW;
if(ent.members&&ent.members.looks&&show>16)show=16;
return show;
}
function capLeads(list,player,limits){
const maxLeads=(limits&&limits.maxLeads)||MAX_LEADS;
const maxBodies=(limits&&limits.maxBodies)||MAX_BODIES;
const px=player&&player.x||0, pz=player&&player.z||0;
const sorted=(list||[]).slice().sort(function(a,b){return distPt(a,px,pz)-distPt(b,px,pz);});
const gone=[], leads=[];
let bodies=0;
for(let i=0;i<sorted.length;i++){
if(leads.length>=maxLeads||bodies>=maxBodies){gone.push(sorted[i].id);continue;}
let show=followerShow(sorted[i]);
if(bodies+1+show>maxBodies)show=Math.max(0,maxBodies-bodies-1);
bodies+=1+show;
leads.push({id:sorted[i].id,show:show,ent:sorted[i]});
}
return {leads:leads,gone:gone,bodies:bodies};
}
function playerPos(){
const ps=ctx&&ctx.players;
if(ps&&ps[0])return {x:ps[0].x,z:ps[0].z,yaw:ps[0].yaw};
return {x:0,z:0,yaw:0};
}
function doorById(id){
for(let i=0;i<doors.length;i++)if(doors[i].id===id)return doors[i];
return null;
}
function entryById(id){
for(let i=0;i<entries.length;i++)if(entries[i].id===id)return entries[i];
return null;
}
function opOf(intent){return intent&&(intent.op||intent.type)||"";}
function goalFor(actor){
const it=actor.intent||{}, op=opOf(it);
if(op==="walk_to"){const p=it.to;return p?{x:+p.x,z:+p.z,op:op,via:!!it.viaRoad}:null;}
if(op==="halt"||op==="idle"){const p=it.at||it.to;return p?{x:+p.x,z:+p.z,op:op}:null;}
if(op==="visit"){
if(it.door&&typeof it.door==="object"&&isFinite(+it.door.x))return {x:+it.door.x,z:+it.door.z,op:op};
const d=doorById(it.buildingId);
return d?{x:d.x,z:d.z,op:op,buildingId:it.buildingId}:null;
}
if(op==="pass_through"||op==="leave"){
let pt=null;
if(it.exit&&typeof it.exit==="object")pt={x:+it.exit.x,z:+it.exit.z};
else if(typeof it.exit==="string"){const e=entryById(it.exit);if(e)pt={x:e.x,z:e.z};}
else if(it.to&&typeof it.to==="object")pt={x:+it.to.x,z:+it.to.z};
if(!pt)return null;
const via=it.viaRoad!=null?!!it.viaRoad:(actor.kind==="caravan"||actor.kind==="army");
return {x:pt.x,z:pt.z,op:op,via:via,side:it.side||null};
}
return null;
}
function repath(actor){
actor.path=null;actor.along=0;actor.stuckT=0;actor.progress=0;actor.did=null;actor.arrived=false;actor.pi=0;
const g=goalFor(actor);
actor.goal=g;
if(!g||!nav)return;
if(g.op==="halt"||g.op==="idle"){
if(Math.hypot(g.x-actor.x,g.z-actor.z)<0.8)return;
}
actor.path=findPath(nav,actor.x,actor.z,g.x,g.z,!!g.via);
}
function report(actor,e,extra){
if(actor.did===e)return;
actor.did=e;
const msg={id:actor.id,iv:actor.iv|0,e:e,at:{x:r1(actor.x),z:r1(actor.z)}};
if(extra)for(const k in extra)msg[k]=extra[k];
if(window.TBLive&&TBLive.npcEvent)TBLive.npcEvent(msg);
}
function hours(){
if(window.TBLive&&TBLive.clock){const c=TBLive.clock();if(c)return c.hours;}
return 0;
}
function motionOf(dt){
if(window.TBLive&&TBLive.clock){
const c=TBLive.clock();
if(c&&!(c.rate>0))return 0;
}
return dt>0?dt:0;
}
function pickLocal(actor){
actor.n=(actor.n||0)+1;
const u=hash2(seed,idNum(actor.id),actor.n);
if(doors.length){
const d=doors[Math.floor(u*doors.length)%doors.length];
const dwell=0.15+hash2(seed,idNum(actor.id),actor.n+9)*0.25;
actor.intent={op:"visit",buildingId:d.id,door:{x:d.x,z:d.z},dwellH:dwell,pace:"walk"};
}else if(entries.length){
const e=entries[Math.floor(u*entries.length)%entries.length];
actor.intent={op:"walk_to",to:{x:e.x,z:e.z},pace:"walk"};
}else actor.intent={op:"idle",at:{x:actor.x,z:actor.z},untilH:hours()+0.25};
actor.hidden=false;actor.fade=1;actor.iv=(actor.iv|0);
repath(actor);
}
function arrive(actor){
if(actor.arrived)return;
actor.arrived=true;
const op=actor.goal&&actor.goal.op||opOf(actor.intent);
if(op==="visit"){actor.fading="in";actor.fade=1;return;}
if(op==="pass_through"||op==="leave"){
report(actor,"left",{side:actor.goal.side||actor.intent.side||null});
actor.fading="out";actor.fade=1;return;
}
if(op==="walk_to")report(actor,"arrived");
actor.waiting=op==="halt"||op==="idle"||op==="walk_to";
}
function stepAlong(actor,dt){
if(actor.talkT>0){
actor.talkT-=dt;
const p=playerPos();
actor.look=Math.atan2(p.x-actor.x,p.z-actor.z);
return;
}
const op=opOf(actor.intent);
if(op==="talk"){
const p=playerPos();
actor.look=Math.atan2(p.x-actor.x,p.z-actor.z);
if(actor.intent.untilH!=null&&hours()>=actor.intent.untilH&&standalone)pickLocal(actor);
return;
}
if(op==="inside"||actor.hidden){
if(standalone&&actor.until!=null&&hours()>=actor.until){
report(actor,"exited",{buildingId:actor.buildingId||null});
actor.did=null;
pickLocal(actor);
}
return;
}
if(actor.phase==="near"&&actor.target){
const dx=actor.target.x-actor.x, dz=actor.target.z-actor.z, dist=Math.hypot(dx,dz);
const step=Math.min(dist,(actor.speed||1.3)*dt);
if(dist>0.05){actor.x+=dx/dist*step;actor.z+=dz/dist*step;actor.yaw=Math.atan2(dx,dz);actor.moving=step>0.001;}
else actor.moving=false;
return;
}
if(actor.waiting){
actor.moving=false;
actor.lookT=(actor.lookT||0)-dt;
if(actor.lookT<=0){
actor.lookT=1.4+hash2(seed,idNum(actor.id),frameN)*2.2;
actor.look=actor.yaw+(hash2(seed,frameN,idNum(actor.id))-0.5)*1.2;
}
if(op==="idle"&&actor.intent.untilH!=null&&hours()>=actor.intent.untilH&&standalone)pickLocal(actor);
return;
}
if(!actor.path||!actor.path.points||actor.path.points.length<1){actor.moving=false;return;}
const pts=actor.path.points;
let left=(actor.speed||1.3)*dt;
let guard=0;
while(left>0&&actor.pi<pts.length&&guard++<8){
const pt=pts[actor.pi];
const dx=pt.x-actor.x, dz=pt.z-actor.z, dist=Math.hypot(dx,dz);
if(dist<0.08){actor.pi++;continue;}
const step=Math.min(dist,left);
actor.x+=dx/dist*step; actor.z+=dz/dist*step; left-=step;
actor.yaw=Math.atan2(dx,dz); actor.moving=true;
}
if(actor.pi>=pts.length){actor.moving=false;arrive(actor);return;}
const g=actor.goal;
if(g&&Math.hypot(g.x-actor.x,g.z-actor.z)<0.55){actor.moving=false;arrive(actor);}
}
function formation(kind,index){
if(kind==="caravan")return {back:4.4*(index+1),side:0};
if(kind==="army"){
const col=index%5, rank=(index/5|0)+1;
return {back:rank*2.7, side:(col-2)*2.4};
}
return {back:1.3*(index+1), side:(index%2?0.7:-0.7)};
}
function sampleBack(actor,back,side){
const pts=actor.path&&actor.path.points;
let x=actor.x,z=actor.z,yaw=actor.yaw;
if(!pts||pts.length<2){
x-=Math.sin(yaw)*back; z-=Math.cos(yaw)*back;
}else{
let remain=back;
let px=actor.x,pz=actor.z,idx=Math.max(0,actor.pi-1);
if(idx>=pts.length)idx=pts.length-1;
for(let i=idx;i>=0&&remain>0;i--){
const qx=i===idx?actor.x:pts[i+1]?pts[i+1].x:pts[i].x;
const qz=i===idx?actor.z:pts[i+1]?pts[i+1].z:pts[i].z;
const tx=pts[i].x, tz=pts[i].z;
const dx=qx-tx, dz=qz-tz, seg=Math.hypot(dx,dz);
if(seg<1e-4)continue;
if(seg>=remain){x=qx-dx/seg*remain;z=qz-dz/seg*remain;yaw=Math.atan2(dx,dz);remain=0;break;}
remain-=seg;x=tx;z=tz;yaw=Math.atan2(dx,dz);px=tx;pz=tz;
}
if(remain>0){x-=Math.sin(yaw)*remain;z-=Math.cos(yaw)*remain;}
}
const rx=Math.cos(yaw), rz=-Math.sin(yaw);
return {x:x+rx*side, z:z+rz*side, yaw:yaw};
}
function clampIn(x,z){
if(window.TBArea&&TBArea.active&&TBArea.active()&&TBArea.walkClamp)return TBArea.walkClamp(x,z);
if(!nav)return {x:x,z:z};
const m=nav.m||1;
const cx=Math.floor(x/m),cz=Math.floor(z/m);
if(openAt(nav,cx,cz))return {x:x,z:z};
const n=nearestOpen(nav,cx,cz,4);
if(!n)return {x:x,z:z};
return {x:(n.x+0.5)*m,z:(n.z+0.5)*m};
}
function separate(){
const bodies=[];
for(let i=0;i<actors.length;i++){
const a=actors[i];
if(a.hidden||a.phase==="near")continue;
bodies.push(a);
if(a.folks)for(let f=0;f<a.folks.length;f++)if(!a.folks[f].hidden)bodies.push(a.folks[f]);
}
for(let i=0;i<bodies.length;i++)for(let j=i+1;j<bodies.length;j++){
const a=bodies[i],b=bodies[j];
let dx=b.x-a.x,dz=b.z-a.z,d=Math.hypot(dx,dz);
const need=(a.rad||0.32)+(b.rad||0.32);
if(d>=need||d<1e-4)continue;
const p=(need-d)*0.5; dx/=d;dz/=d;
const ax=a.x-dx*p, az=a.z-dz*p, bx=b.x+dx*p, bz=b.z+dz*p;
if(a.lead!==false){const c=clampIn(ax,az);a.x=c.x;a.z=c.z;}
else {a.x=ax;a.z=az;}
if(b.lead!==false){const c=clampIn(bx,bz);b.x=c.x;b.z=c.z;}
else {b.x=bx;b.z=bz;}
}
}
function footY(x,z){
if(window.TBArea&&TBArea.active&&TBArea.active())return TBArea.groundY(x,z)||0;
return 0;
}
function canDraw(){return typeof THREE!=="undefined"&&typeof document!=="undefined"&&document.createElement;}
const GEO={};
function geo(name,fn){return GEO[name]||(GEO[name]=fn());}
function pick(arr,n){const i=((n%arr.length)+arr.length)%arr.length;return arr[i];}
function pix(hex,seed){
hex=hex||"#c4a574";
const s=16,c=document.createElement("canvas");c.width=c.height=s;
const g=c.getContext("2d");
const br=parseInt(hex.slice(1,3),16),bg=parseInt(hex.slice(3,5),16),bb=parseInt(hex.slice(5,7),16);
for(let y=0;y<s;y++)for(let x=0;x<s;x++){
let k=0.84+hash2(x+seed,y,seed)*0.28;
if(((x*3+y*5)%7)===0)k*=0.9;
const r=Math.max(16,Math.min(244,(br*k)|0));
const gg=Math.max(16,Math.min(244,(bg*k)|0));
const b=Math.max(16,Math.min(244,(bb*k)|0));
g.fillStyle="rgb("+r+","+gg+","+b+")";
g.fillRect(x,y,1,1);
}
const t=new THREE.CanvasTexture(c);
t.magFilter=t.minFilter=THREE.NearestFilter;
t.wrapS=t.wrapT=THREE.RepeatWrapping;
return t;
}
function faceTex(skin,hair){
const s=16,c=document.createElement("canvas");c.width=c.height=s;
const g=c.getContext("2d");
g.fillStyle=skin;g.fillRect(0,0,s,s);
g.fillStyle=hair;g.fillRect(0,0,s,4);g.fillRect(0,4,2,4);g.fillRect(14,4,2,4);
g.fillStyle="#4a3428";g.fillRect(4,7,2,2);g.fillRect(10,7,2,2);
g.fillStyle="#f4e6d4";g.fillRect(5,7,1,1);g.fillRect(11,7,1,1);
g.fillStyle="#a0524a";g.fillRect(7,11,2,1);
const t=new THREE.CanvasTexture(c);
t.magFilter=t.minFilter=THREE.NearestFilter;
return t;
}
function mat(map,tint){
const m=new THREE.MeshLambertMaterial({map:map});
if(tint)m.color=new THREE.Color(tint);
return m;
}
function addMesh(parent,geometry,material,x,y,z){
const o=new THREE.Mesh(geometry,material);
o.position.set(x,y,z);
o.castShadow=true;
parent.add(o);
return o;
}
function makePerson(look,kind){
const g=new THREE.Group();
const n=idNum((look&&look.sheet)||kind||"p")+((look&&look.char)|0);
const tunic=kind==="caravan"?"#a85a32":kind==="army"?"#6d7a4a":pick(TUNICS,n);
const hair=pick(HAIR,n>>>3), skin=pick(SKIN,n>>>5);
const cloth=mat(pix(tunic,n+1)), hide=mat(pix(skin,n+2)), hairM=mat(pix(hair,n+3));
const pants=mat(pix(kind==="army"?"#7a6244":"#5c5346",n+4));
const boot=mat(pix("#6b4a32",n+5));
const legL=new THREE.Group(),legR=new THREE.Group();
legL.position.set(-0.09,0.62,0);legR.position.set(0.09,0.62,0);
g.add(legL);g.add(legR);
addMesh(legL,geo("leg",function(){return new THREE.CylinderGeometry(0.055,0.07,0.46,6);}),pants,0,-0.2,0);
addMesh(legR,geo("leg",function(){return GEO.leg;}),pants,0,-0.2,0);
addMesh(legL,geo("boot",function(){return new THREE.SphereGeometry(0.07,6,5);}),boot,0,-0.44,0.03);
addMesh(legR,geo("boot",function(){return GEO.boot;}),boot,0,-0.44,0.03);
addMesh(g,geo("torso",function(){return new THREE.CylinderGeometry(0.15,0.17,0.42,7);}),cloth,0,0.86,0);
const armL=new THREE.Group(),armR=new THREE.Group();
armL.position.set(-0.22,1.02,0);armR.position.set(0.22,1.02,0);
g.add(armL);g.add(armR);
addMesh(armL,geo("arm",function(){return new THREE.CylinderGeometry(0.045,0.05,0.36,5);}),cloth,0,-0.16,0);
addMesh(armR,geo("arm",function(){return GEO.arm;}),cloth,0,-0.16,0);
addMesh(g,geo("head",function(){return new THREE.SphereGeometry(0.15,7,6);}),mat(faceTex(skin,hair)),0,1.26,0);
addMesh(g,geo("hair",function(){return new THREE.SphereGeometry(0.155,7,5);}),hairM,0,1.34,0).scale.set(1,0.55,1);
if(kind==="caravan")addMesh(g,geo("pack",function(){return new THREE.CylinderGeometry(0.1,0.12,0.22,6);}),mat(pix("#c47a3a",n+8)),0,0.9,-0.16);
if(kind==="army")addMesh(g,geo("cap",function(){return new THREE.ConeGeometry(0.12,0.16,6);}),mat(pix("#8a7048",n+6)),0,1.5,0);
g.userData.tbPerson=1;
return {root:g,legL:legL,legR:legR,armL:armL,armR:armR};
}
function makeHorse(seedN){
const g=new THREE.Group();
const hide=mat(pix("#8a5a32",seedN||3)), mane=mat(pix("#6b4428",seedN||4)), hoof=mat(pix("#6b4a32",seedN||5));
const body=addMesh(g,geo("hbody",function(){return new THREE.SphereGeometry(0.28,7,5);}),hide,0,0.72,0);
body.scale.set(0.7,0.85,1.35);
addMesh(g,geo("hneck",function(){return new THREE.CylinderGeometry(0.08,0.11,0.32,5);}),hide,0,0.95,0.28).rotation.x=0.7;
addMesh(g,geo("hhead",function(){return new THREE.SphereGeometry(0.12,6,5);}),hide,0,1.12,0.42);
addMesh(g,geo("hmane",function(){return new THREE.SphereGeometry(0.08,5,4);}),mane,0,1.05,0.22);
const legs=[];
[[-0.1,0.28],[-0.1,-0.22],[0.1,0.28],[0.1,-0.22]].forEach(function(p){
const lg=new THREE.Group();lg.position.set(p[0],0.55,p[1]);g.add(lg);legs.push(lg);
addMesh(lg,geo("hleg",function(){return new THREE.CylinderGeometry(0.04,0.045,0.4,5);}),hide,0,-0.16,0);
addMesh(lg,geo("hhoof",function(){return new THREE.SphereGeometry(0.05,5,4);}),hoof,0,-0.36,0);
});
g.scale.setScalar(1.28);
return {root:g,legs:legs,horse:1};
}
function ensureMesh(actor){
if(!canDraw()||actor.root)return;
const parent=ctx&&ctx.scene; if(!parent)return;
const group=new THREE.Group();
group.name="tb-npc";
group.userData.tbKeep=1;
group.scale.setScalar(actor.horse?personScale()*1.1:personScale());
const fig=actor.horse?makeHorse(idNum(actor.id)):makePerson(actor.appearance,actor.kind);
if(!actor.horse) fig.root.position.y=-PERSON_BOTTOM;
group.add(fig.root);
actor.root=group;actor.fig=fig;
parent.add(group);
if(!actor.horse&&window.TBCharacters&&TBCharacters.dressNpc){
TBCharacters.dressNpc(actor,group,function(){if(fig.root)fig.root.visible=false;});
}
if(actor.folks)actor.folks.forEach(function(f){ensureFolk(actor,f);});
}
function ensureFolk(actor,f){
if(!canDraw()||f.root||!actor.root)return;
const parent=ctx&&ctx.scene; if(!parent)return;
const group=new THREE.Group();
group.name="tb-npc-follow";
group.userData.tbKeep=1;
group.scale.setScalar(f.horse?personScale()*1.1:personScale());
const fig=f.horse?makeHorse(idNum(actor.id)+f.i+1):makePerson(f.appearance||f.look,actor.kind);
if(!f.horse) fig.root.position.y=-PERSON_BOTTOM;
group.add(fig.root);
f.root=group;f.fig=fig;
parent.add(group);
}
function paintBubble(actor){
if(!actor.bubC)return;
const c=actor.bubC,g=c.getContext("2d");
g.clearRect(0,0,256,64);
g.fillStyle="#fff6e4";g.strokeStyle="#6b4a32";g.lineWidth=4;
g.fillRect(4,4,248,56);g.strokeRect(4,4,248,56);
g.fillStyle="#3a2a22";g.font="bold 18px monospace";g.textAlign="center";
const words=String(actor.bubText||"").split(/\s+/);
const lines=["",""]; let li=0;
for(let i=0;i<words.length;i++){
const w=words[i]; if(!w)continue;
const tryLine=lines[li]?lines[li]+" "+w:w;
if(tryLine.length>26&&lines[li]){if(li===0)li=1;else break;}
if(li>1)break;
lines[li]=lines[li]?lines[li]+" "+w:w;
}
g.fillText(lines[0],128,28);
g.fillText(lines[1],128,50);
actor.bub.material.map.needsUpdate=true;
}
function ensureBubble(actor){
if(!canDraw()||actor.bub||!actor.root)return;
const c=document.createElement("canvas");c.width=256;c.height=64;
const map=new THREE.CanvasTexture(c);
map.magFilter=map.minFilter=THREE.NearestFilter;
const s=new THREE.Sprite(new THREE.SpriteMaterial({map:map,transparent:true,depthTest:false,depthWrite:false}));
s.scale.set(6.4,1.6,1);s.center.set(0.5,0);s.renderOrder=9;s.visible=false;
s.position.set(0,1.85,0);
actor.root.add(s);
actor.bub=s;actor.bubC=c;
}
function syncActor(actor,dt){
if(actor.fading){
const kind=actor.fading;
actor.fade-=dt/0.45;
if(actor.fade<=0){
actor.fade=0;actor.fading=null;
if(kind==="in"&&!actor.hidden){
actor.hidden=true;actor.until=hours()+(actor.intent&&actor.intent.dwellH||0.2);
actor.buildingId=actor.intent&&actor.intent.buildingId;
report(actor,"entered",{buildingId:actor.buildingId||null});
}
if(kind==="out"){actor.hidden=true;actor.remove=true;}
}
}
if(typeof actor.look==="number"){
let d=actor.look-actor.yaw;d=Math.atan2(Math.sin(d),Math.cos(d));
const m=4*dt;actor.yaw+=d<-m?-m:d>m?m:d;
}
if(!actor.root)return;
const y=footY(actor.x,actor.z);
actor.root.visible=!actor.hidden&&actor.fade>0.02;
actor.root.position.set(actor.x,y,actor.z);
actor.root.rotation.y=actor.yaw;
const swing=actor.moving?Math.sin(actor.phase)*0.7:0;
if(actor.fig&&actor.fig.legL){
actor.fig.legL.rotation.x=swing;actor.fig.legR.rotation.x=-swing;
actor.fig.armL.rotation.x=-swing*0.6;actor.fig.armR.rotation.x=swing*0.6;
}
if(actor.fig&&actor.fig.legs){
actor.fig.legs.forEach(function(lg,i){lg.rotation.x=(i%2?swing:-swing);});
}
if(actor.charBody){
actor.charBody.setMoving(!!actor.moving,actor.speed||1.3);
actor.charBody.update(dt>0?dt:0,0);
}else actor.root.traverse(function(o){if(o.material&&o.material.opacity!=null&&actor.fade<1){o.material.transparent=actor.fade<0.99;o.material.opacity=Math.max(0,actor.fade);}});
if(actor.bub){
if(actor.bubLeft>0){actor.bub.visible=!actor.hidden;actor.bubLeft-=dt;}
else actor.bub.visible=false;
}
if(actor.thing){
actor.thing.x=actor.x;actor.thing.z=actor.z;actor.thing.y=y;
actor.thing.gone=actor.hidden?1:0;
actor.thing.o.look=actor.look;
}
}
function syncFolk(actor,f){
if(f.root){
f.root.visible=!actor.hidden&&!f.hidden;
f.root.position.set(f.x,footY(f.x,f.z),f.z);
f.root.rotation.y=f.yaw;
if(f.fig&&f.fig.legL){
const swing=actor.moving?Math.sin(actor.phase+f.i)*0.7:0;
f.fig.legL.rotation.x=swing;f.fig.legR.rotation.x=-swing;
f.fig.armL.rotation.x=-swing*0.6;f.fig.armR.rotation.x=swing*0.6;
}
if(f.fig&&f.fig.legs){
const swing=actor.moving?Math.sin(actor.phase+f.i)*0.7:0;
f.fig.legs.forEach(function(lg,i){lg.rotation.x=(i%2?swing:-swing);});
}
}
}
function dropActor(actor){
if(actor.root&&actor.root.parent)actor.root.parent.remove(actor.root);
if(actor.folks)actor.folks.forEach(function(f){if(f.root&&f.root.parent)f.root.parent.remove(f.root);});
const th=ctx&&ctx.things;
if(th&&actor.thing){
const i=th.indexOf(actor.thing);
if(i>=0)th.splice(i,1);
}
}
function makeThing(actor){
if(!ctx||!ctx.things)return;
const thing={
k:"npc",tbLiveNpc:1,x:actor.x,z:actor.z,y:0,r:1.7,hy:2.3,
o:actor,li:-1,lines:["Hello."],
onTalk:function(p){talk(actor,p);}
};
ctx.things.push(thing);
actor.thing=thing;
}
function talk(actor,p){
actor.talkT=4;
actor.look=Math.atan2(p.x-actor.x,p.z-actor.z);
if(window.TBLive&&TBLive.talk)TBLive.talk(actor.id);
}
function upsert(ent,show){
if(!ent||!ent.id)return null;
let actor=null;
for(let i=0;i<actors.length;i++)if(actors[i].id===ent.id){actor=actors[i];break;}
const born=!actor;
if(!actor){
actor={id:ent.id,kind:ent.kind||"wanderer",x:0,z:0,yaw:0,phase:"in",speed:1.4,
intent:null,iv:-1,folks:[],rad:0.34,lead:true,fade:1,pi:0,hidden:false,n:0};
actors.push(actor);
}
if(ent.pos){if(born||ent.phase==="near"){actor.x=+ent.pos.x;actor.z=+ent.pos.z;}}
if(ent.yaw!=null&&(born||ent.phase==="near"))actor.yaw=+ent.yaw;
if(ent.name)actor.name=String(ent.name).slice(0,48);
if(ent.look&&typeof ent.look==="object")actor.appearance=ent.look;
if(ent.speed!=null&&isFinite(+ent.speed))actor.speed=Math.max(0.2,Math.min(3.5,+ent.speed));
else if(born)actor.speed=actor.kind==="caravan"?1.15:actor.kind==="army"?0.9:1.35+hash2(seed,idNum(actor.id),1)*0.15;
if(ent.phase)actor.phase=ent.phase;
if(ent.intent&&(ent.iv|0)!==(actor.iv|0)){
actor.intent=ent.intent;actor.iv=ent.iv|0;actor.waiting=false;actor.hidden=opOf(ent.intent)==="inside"||ent.phase==="inside";
actor.pi=0;repath(actor);
}
if(ent.phase==="inside"||opOf(actor.intent)==="inside")actor.hidden=true;
if(ent.phase==="near"&&ent.pos)actor.target={x:+ent.pos.x,z:+ent.pos.z};
const want=show==null?followerShow(ent):show;
const looks=ent.members&&ent.members.looks||[];
while(actor.folks.length<want){
const i=actor.folks.length;
const horse=actor.kind==="caravan"&&i===0;
actor.folks.push({i:i,lead:false,rad:horse?0.46:0.3,look:looks[i%Math.max(1,looks.length)]||actor.look,horse:horse,x:actor.x,z:actor.z,yaw:actor.yaw});
}
if(actor.folks.length>want){
for(let i=want;i<actor.folks.length;i++){const f=actor.folks[i];if(f.root&&f.root.parent)f.root.parent.remove(f.root);}
actor.folks.length=want;
}
if(born)makeThing(actor);
ensureMesh(actor);
return actor;
}
function clearActors(){
while(actors.length)dropActor(actors.pop());
}
function onArea(p,opt){
if(!p)return;
if(opt&&opt.same&&area&&actors.length){area=p;return;}
area=p;nav=buildNav(p);doors=listDoors(p);entries=listEntries(p);
seed=(p.area&&p.area.placeSeed)||1;
clearActors();
standalone=!(p.session&&p.session.live);
const snap=p.npcs&&p.npcs.list||[];
const player=playerPos();
const capped=capLeads(snap,player);
const showOf={};
capped.leads.forEach(function(L){showOf[L.id]=L.show;});
for(let i=0;i<snap.length;i++){
if(showOf[snap[i].id]==null)continue;
const a=upsert(snap[i],showOf[snap[i].id]);
if(a&&!a.path&&a.phase!=="near")repath(a);
}
}
function applySim(msg){
if(!msg)return;
standalone=false;
const player=playerPos();
const list=msg.ents||[];
const capped=capLeads(list,player);
const allow={};
capped.leads.forEach(function(L){allow[L.id]=L.show;});
if(msg.key){
const keep={};
list.forEach(function(e){if(allow[e.id]!=null)keep[e.id]=1;});
for(let i=actors.length-1;i>=0;i--)if(!keep[actors[i].id]){actors[i].fading="out";actors[i].fade=Math.min(actors[i].fade,1);}
}
for(let i=0;i<list.length;i++){
if(allow[list[i].id]==null)continue;
upsert(list[i],allow[list[i].id]);
}
(msg.events||[]).forEach(function(ev){
if(!ev||!ev.id)return;
if(ev.e==="gone"){
for(let i=0;i<actors.length;i++)if(actors[i].id===ev.id){actors[i].fading="out";actors[i].fade=Math.min(actors[i].fade,1);}
}
if(ev.e==="enter"){
let ent=null;
for(let i=0;i<list.length;i++)if(list[i].id===ev.id)ent=list[i];
if(!ent)ent={id:ev.id,kind:"wanderer",phase:"in",intent:{op:"idle",at:ev.at},iv:0,speed:1.3};
ent.phase="in";
if(ev.at)ent.pos={x:ev.at.x,z:ev.at.z};
const a=upsert(ent,allow[ent.id]!=null?allow[ent.id]:followerShow(ent));
if(a&&ev.at){a.x=+ev.at.x;a.z=+ev.at.z;a.phase="in";a.hidden=false;repath(a);}
}
});
}
function chatter(msg){
if(!msg||!msg.speakerId)return;
let actor=null;
for(let i=0;i<actors.length;i++)if(actors[i].id===msg.speakerId)actor=actors[i];
if(!actor||actor.hidden)return;
actor.bubText=String(msg.text||"").slice(0,160);
actor.bubLeft=(+msg.ms||5200)/1000;
ensureBubble(actor);
if(actor.bub)paintBubble(actor);
}
function facePlayer(id){
for(let i=0;i<actors.length;i++)if(actors[i].id===id){
const a=actors[i],p=playerPos();
a.talkT=4;a.look=Math.atan2(p.x-a.x,p.z-a.z);
}
}
function edgeHold(x,z,vx,vz){
/* The area scene owns the leave-town exit, including the warning and the fade. */
if(window.TBArea&&TBArea.ownsExit)return null;
if(!nav)return null;
const m=nav.m||1;
const cx=Math.floor(x/m),cz=Math.floor(z/m);
if(!openAt(nav,cx,cz))return null;
const ax=Math.abs(vx),az=Math.abs(vz);
if(Math.hypot(vx,vz)<0.35)return null;
const side=ax>az?(vx>0?"E":"W"):(vz>0?"S":"N");
const d=SIDE[side];
const nx=cx+d[0],nz=cz+d[1];
const outside=nx<0||nz<0||nx>=nav.w||nz>=nav.h||!nav.place||!nav.place[nz*nav.w+nx];
if(!outside)return null;
return {side:side,held:true};
}
function update(dt){
if(!actors.length)return;
frameN++;
const raw=dt>0?dt:0;
const motion=motionOf(raw);
for(let i=0;i<actors.length;i++){
const a=actors[i];
if(a.moving)a.phase+=raw*7;
const before=a.x*a.x+a.z*a.z;
if(!a.hidden&&a.phase!=="inside")stepAlong(a,motion);
if(a.phase!=="near"&&!a.hidden){
const c=clampIn(a.x,a.z);
const moved=Math.hypot(a.x-c.x,a.z-c.z);
a.x=c.x;a.z=c.z;
const prog=Math.hypot(a.x,a.z)-Math.sqrt(Math.max(0,before));
if(a.moving&&Math.abs(prog)<0.01&&moved<0.02)a.stuckT+=raw;else a.stuckT=0;
if(a.stuckT>2){a.stuckT=0;report(a,"stuck");repath(a);}
}
if(a.folks)for(let f=0;f<a.folks.length;f++){
const slot=formation(a.kind,f);
const s=sampleBack(a,slot.back,slot.side);
a.folks[f].x=s.x;a.folks[f].z=s.z;a.folks[f].yaw=s.yaw;
}
}
separate();
for(let i=actors.length-1;i>=0;i--){
const a=actors[i];
syncActor(a,raw);
if(a.folks)for(let f=0;f<a.folks.length;f++)syncFolk(a,a.folks[f]);
if(a.remove){dropActor(a);actors.splice(i,1);}
}
}
function setStandalone(on){standalone=!!on;if(on){for(let i=0;i<actors.length;i++)if(!actors[i].path&&!actors[i].hidden)pickLocal(actors[i]);}}
function attach(c){ctx=c;actors.forEach(ensureMesh);}
window.TBNpcs={
attach:attach,update:update,onArea:onArea,applySim:applySim,chatter:chatter,facePlayer:facePlayer,
setStandalone:setStandalone,edgeHold:edgeHold,buildNav:buildNav,findPath:findPath,listDoors:listDoors,
listEntries:listEntries,capLeads:capLeads,decodeU8:decodeU8,
actors:function(){return actors;},
nav:function(){return nav;},
doors:function(){return doors;},
entries:function(){return entries;},
placeholderHeight:placeholderHeight,
personScale:personScale
};
})();
