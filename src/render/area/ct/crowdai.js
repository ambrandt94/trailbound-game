/* Ported from trailbound-controller (deployed main). ESM, behaviour-faithful.
   Not typechecked: a full TS conversion of these files would stall the port.
   three r187: colorSpace, colorspace_fragment, per-fragment Lambert cel, asset root.
*/
/* Utility AI for the crowd test scene. No rendering.
   Behaviours: wander, enter (door), grab (carry/drop), play (minigame node).
   The scene owns the world lists; this file only steps agents. */
(function(){
const BEHAVIOURS=["wander","enter","grab","play"];

function mulberry32(seed){
let a=seed>>>0;
return function(){
a|=0;a=a+0x6D2B79F5|0;
let t=Math.imul(a^a>>>15,1|a);
t=t+Math.imul(t^t>>>7,61|t)^t;
return ((t^t>>>14)>>>0)/4294967296;
};
}
function tally(world,key){
if(!world.tally)world.tally={wander:0,enter:0,grab:0,play:0};
world.tally[key]=(world.tally[key]||0)+1;
}
function pickBehaviour(rng,weights){
const w=BEHAVIOURS.map(function(k){return Math.max(0,+(weights&&weights[k])||0);});
let sum=0;
for(let i=0;i<w.length;i++)sum+=w[i];
if(!(sum>0))return "wander";
let u=rng()*sum;
for(let i=0;i<BEHAVIOURS.length;i++){
u-=w[i];
if(u<=0)return BEHAVIOURS[i];
}
return "wander";
}
function blocked(world,x,z){
const blocks=world.blocks||[];
for(let i=0;i<blocks.length;i++){
const b=blocks[i];
if(Math.abs(x-b.x)<b.hw&&Math.abs(z-b.z)<b.hd)return true;
}
const circles=world.circles||[];
for(let i=0;i<circles.length;i++){
const c=circles[i],dx=x-c.x,dz=z-c.z;
if(dx*dx+dz*dz<c.r*c.r)return true;
}
if(x<world.minX||x>world.maxX||z<world.minZ||z>world.maxZ)return true;
return false;
}
function createAgent(i,x,z){
return {
i:i,x:x,z:z,yaw:0,speed:1.4,
state:"choose",behaviour:"wander",pose:"idle",
hidden:false,moving:false,holding:false,wait:0,
tx:x,tz:z,door:-1,prop:-1,node:-1,face:0,
stall:0,best:1e9
};
}
function release(a,world){
if(a.prop>=0&&world.props&&world.props[a.prop]){
const p=world.props[a.prop];
if(p.reserved===a.i)p.reserved=-1;
if(a.holding&&p.carried){p.carried=false;p.x=a.x;p.z=a.z;}
}
a.prop=-1;a.holding=false;a.door=-1;a.node=-1;
}
function aim(a,x,z,state){
a.tx=x;a.tz=z;a.state=state;a.stall=0;a.best=1e9;a.moving=true;
a.pose=a.holding?"carry":"walk";
}
function freeProp(world,rng){
const list=[];
const props=world.props||[];
for(let i=0;i<props.length;i++){
const p=props[i];
if(p&&p.reserved<0&&!p.carried)list.push(p);
}
if(!list.length)return null;
return list[Math.floor(rng()*list.length)];
}
function countUse(world,kind,id){
let n=0;
const agents=world.agents||[];
for(let i=0;i<agents.length;i++){
const a=agents[i];
if(kind==="door"&&a.door===id&&(a.state==="toDoor"||a.state==="inside"||a.state==="exit"))n++;
if(kind==="node"&&a.node===id&&(a.state==="toNode"||a.state==="act"))n++;
}
return n;
}
function least(world,list,kind){
let best=list[0],bn=1e9;
for(let i=0;i<list.length;i++){
const n=countUse(world,kind,list[i].i);
if(n<bn){bn=n;best=list[i];}
}
return best;
}
function stand(node,slot){
const ang=(node.yaw||0)+(slot-1)*0.5;
const r=Math.max(0.9,(node.radius||1.4)*0.85);
const x=node.x+Math.sin(ang)*r,z=node.z+Math.cos(ang)*r;
return {x:x,z:z,face:Math.atan2(node.x-x,node.z-z)};
}
function begin(a,world,rng){
const weights=world.weights||{wander:1,enter:1,grab:1,play:1};
let b=pickBehaviour(rng,weights);
if(b==="enter"&&!(world.doors&&world.doors.length))b="wander";
if(b==="play"&&!(world.nodes&&world.nodes.length))b="wander";
if(b==="grab"){
const p=freeProp(world,rng);
if(!p)b="wander";
else{
p.reserved=a.i;a.prop=p.i;a.behaviour="grab";
aim(a,p.x,p.z,"toProp");
return;
}
}
if(b==="enter"){
const d=least(world,world.doors,"door");
a.door=d.i;a.behaviour="enter";
aim(a,d.x,d.z,"toDoor");
return;
}
if(b==="play"){
const n=least(world,world.nodes,"node");
a.node=n.i;a.behaviour="play";
const st=stand(n,countUse(world,"node",n.i));
a.face=st.face;
aim(a,st.x,st.z,"toNode");
return;
}
const pois=world.pois&&world.pois.length?world.pois:[{x:a.x,z:a.z}];
const p=pois[Math.floor(rng()*pois.length)];
a.behaviour="wander";
aim(a,p.x,p.z,"wander");
}
function tryMove(a,vx,vz,step,world){
const ox=a.x,oz=a.z;
function go(x,z){if(blocked(world,x,z))return false;a.x=x;a.z=z;return true;}
if(go(ox+vx*step,oz+vz*step))return true;
if(go(ox+vx*step,oz))return true;
if(go(ox,oz+vz*step))return true;
if(go(ox-vz*step,oz+vx*step))return true;
if(go(ox+vz*step,oz-vx*step))return true;
return false;
}
function seek(a,world,dt,sep){
const dx0=a.tx-a.x,dz0=a.tz-a.z;
const dist=Math.hypot(dx0,dz0);
if(dist<0.48){a.moving=false;return true;}
let dx=dx0/dist,dz=dz0/dist;
const k=dist<1.25?0.2:1.15;
let vx=dx+(sep?sep.x*k:0),vz=dz+(sep?sep.z*k:0);
const vm=Math.hypot(vx,vz)||1;
vx/=vm;vz/=vm;
const step=Math.max(0.05,a.speed)*dt;
const before=dist;
const moved=tryMove(a,vx,vz,step,world);
if(moved){
const mx=a.x-(a.tx-dx0),mz=a.z-(a.tz-dz0);
if(mx*mx+mz*mz>1e-8)a.yaw=Math.atan2(mx,mz);
}
const after=Math.hypot(a.tx-a.x,a.tz-a.z);
if(after<0.48){a.moving=false;return true;}
a.moving=true;
a.pose=a.holding?"carry":"walk";
if(after<before-0.02){a.best=after;a.stall=0;}
else a.stall+=dt;
return false;
}
function arrive(a,world,rng){
a.moving=false;a.stall=0;
if(a.state==="wander"){
tally(world,"wander");
a.pose="idle";a.state="idle";
a.wait=0.45+rng()*1.5;
}else if(a.state==="toDoor"){
tally(world,"enter");
a.state="inside";a.hidden=true;a.pose="idle";
a.wait=3+rng()*4.2;
}else if(a.state==="exit"){
a.door=-1;a.state="choose";
}else if(a.state==="toProp"){
tally(world,"grab");
a.state="lift";a.pose="interact";a.wait=0.55;
}else if(a.state==="haul"){
a.state="drop";a.pose="interact";a.wait=0.4;
}else if(a.state==="toNode"){
tally(world,"play");
a.state="act";a.pose="interact";
if(isFinite(a.face))a.yaw=a.face;
a.wait=2.6+rng()*2.4;
}
}
function finishWait(a,world,rng){
if(a.state==="idle"||a.state==="act"){
a.node=-1;a.state="choose";return;
}
if(a.state==="inside"){
a.hidden=false;
const d=(world.doors&&world.doors[a.door])||(world.doors&&world.doors[0]);
if(!d){a.state="choose";return;}
aim(a,d.outX,d.outZ,"exit");
return;
}
if(a.state==="lift"){
const p=world.props&&world.props[a.prop];
if(p)p.carried=true;
a.holding=true;a.pose="carry";
const drops=world.drops&&world.drops.length?world.drops:[{x:a.x+1,z:a.z}];
const drop=drops[Math.floor(rng()*drops.length)];
aim(a,drop.x,drop.z,"haul");
return;
}
if(a.state==="drop"){
const p=world.props&&world.props[a.prop];
if(p){
p.carried=false;p.reserved=-1;
p.x=a.x+Math.sin(a.yaw)*0.5;
p.z=a.z+Math.cos(a.yaw)*0.5;
}
a.prop=-1;a.holding=false;a.state="choose";
}
}
function giveUp(a,world){
if(a.holding){
a.state="drop";a.wait=0.15;a.moving=false;a.pose="interact";a.stall=0;return;
}
if(a.prop>=0&&world.props&&world.props[a.prop]){
const p=world.props[a.prop];
if(!p.carried&&p.reserved===a.i)p.reserved=-1;
}
a.prop=-1;a.door=-1;a.node=-1;a.stall=0;a.state="choose";
}
function hashAgents(agents){
const cell=1.25,map=new Map();
for(let i=0;i<agents.length;i++){
const a=agents[i];
if(!a||a.hidden)continue;
const k=(Math.floor(a.x/cell)+512)+(Math.floor(a.z/cell)+512)*4096;
let b=map.get(k);
if(!b){b=[];map.set(k,b);}
b.push(a);
}
return map;
}
function separate(a,hash){
const R=0.62,R2=R*R,cell=1.25;
let sx=0,sz=0;
const cx=Math.floor(a.x/cell),cz=Math.floor(a.z/cell);
for(let gz=cz-1;gz<=cz+1;gz++)for(let gx=cx-1;gx<=cx+1;gx++){
const bucket=hash.get((gx+512)+(gz+512)*4096);
if(!bucket)continue;
for(let i=0;i<bucket.length;i++){
const b=bucket[i];
if(b===a)continue;
const dx=a.x-b.x,dz=a.z-b.z,d2=dx*dx+dz*dz;
if(d2>R2||d2<1e-8)continue;
const d=Math.sqrt(d2),push=(R-d)/R;
sx+=(dx/d)*push;sz+=(dz/d)*push;
}
}
return {x:sx,z:sz};
}
function stepAgent(a,world,dt,rng,hash){
if(world.speed>0)a.speed=world.speed;
if(a.state==="inside"||a.state==="idle"||a.state==="lift"||a.state==="drop"||a.state==="act"){
a.moving=false;
a.wait-=dt;
if(a.wait>0){
a.pose=(a.state==="act"||a.state==="lift"||a.state==="drop")?"interact":(a.holding?"carry":"idle");
return;
}
finishWait(a,world,rng);
return;
}
if(a.state==="choose"){begin(a,world,rng);return;}
const sep=hash?separate(a,hash):{x:0,z:0};
if(seek(a,world,dt,sep))arrive(a,world,rng);
else if(a.stall>2.6)giveUp(a,world);
}
function stepAll(agents,world,dt,rng){
if(!(dt>0)||!agents)return;
world.agents=agents;
const hash=hashAgents(agents);
for(let i=0;i<agents.length;i++)stepAgent(agents[i],world,dt,rng,hash);
}
const api={
BEHAVIOURS:BEHAVIOURS,
mulberry32:mulberry32,
pickBehaviour:pickBehaviour,
blocked:blocked,
createAgent:createAgent,
release:release,
stepAll:stepAll
};
if(typeof module!=="undefined"&&module.exports)module.exports=api;
if(typeof window!=="undefined")window.TBCrowdAI=api;
})();
