/* Ported from trailbound-controller (deployed main). ESM, behaviour-faithful.
   Not typechecked: a full TS conversion of these files would stall the port.
   three r187: colorSpace, colorspace_fragment, per-fragment Lambert cel, asset root.
*/
import { THREE } from './three-runtime.js';
/* Ambient wanderers. One roster entry is a character.
   Task clips: add a name to HERO_TASKS / ANIMAL_TASKS when a new animation ships
   (sit, chop, carry, talk, …). A model that doesn't have the clip is skipped.
   A roster entry's own `tasks` array replaces the default list for that character. */
(function(){
const TB_ROOT=(import.meta.env&&import.meta.env.BASE_URL?import.meta.env.BASE_URL:'./')+'assets/';
const HERO_TASKS=["Interact","Cheer","Sit","Chop","Carry","Talk"];
const ANIMAL_TASKS=["Eat","Howl","Interact"];
const ONCE={Interact:1,Cheer:1,Attack:1,Sit:1,Chop:1,Carry:1,Talk:1};
const SOCIAL=3.6;
let actors=[],BX,walkable;

function fadeTo(a,name){
if(!name||!a.actions[name])name=a.actions.Idle?"Idle":(a.actions.Walk?"Walk":Object.keys(a.actions)[0]);
if(!name||a.clip===name)return;
const next=a.actions[name],prev=a.clip?a.actions[a.clip]:null;
if(a.fading&&a.fading!==next&&a.fading!==prev)a.fading.stop();
if(!prev){next.reset().play();a.clip=name;a.fading=null;return;}
next.reset().fadeIn(.28).play();
prev.fadeOut(.28);
a.fading=prev;a.fadeT=.3;a.clip=name;
}
function taskPool(a){
const base=a.def.tasks||(a.kind==="animal"?ANIMAL_TASKS:HERO_TASKS);
const out=[];for(let i=0;i<base.length;i++)if(a.actions[base[i]])out.push(base[i]);
return out;
}
function nearest(a){
if(a.kind!=="hero")return null;
let best=null,bd=SOCIAL;
for(let i=0;i<actors.length;i++){
const b=actors[i];if(b===a||b.kind!=="hero")continue;
const d=Math.hypot(a.x-b.x,a.z-b.z);if(d<bd){bd=d;best=b;}
}
return best;
}
function beginPause(a){
a.phase="pause";
const span=a.def.pause||[2.4,5.4];
a.left=span[0]+Math.random()*(span[1]-span[0]);
const pool=taskPool(a);
const bias=a.def.taskBias!=null?a.def.taskBias:.62;
let name="Idle";
if(nearest(a)&&a.actions.Interact&&Math.random()<.8)name="Interact";
else if(pool.length&&Math.random()<bias)name=pool[(Math.random()*pool.length)|0];
fadeTo(a,name);
}
function blocked(x,z,rad){
const r2=rad*rad;
for(let i=0;i<BX.length;i++){
const b=BX[i];if(!b||b.h<0.45)continue;
const cx=x<b.x-b.w/2?b.x-b.w/2:x>b.x+b.w/2?b.x+b.w/2:x;
const cz=z<b.z-b.d/2?b.z-b.d/2:z>b.z+b.d/2?b.z+b.d/2:z;
const dx=x-cx,dz=z-cz;if(dx*dx+dz*dz<r2)return true;
}
return false;
}
function pickDest(a){
for(let k=0;k<12;k++){
const ang=Math.random()*6.2831853,rad=(.3+Math.random()*.7)*a.radius;
const x=a.homeX+Math.sin(ang)*rad,z=a.homeZ+Math.cos(ang)*rad;
if(Math.hypot(x-a.x,z-a.z)<1.1)continue;
if(walkable(x,z)&&!blocked(x,z,a.rad)){a.dx=x;a.dz=z;return true;}
}
return false;
}
function beginWalk(a){
if(!pickDest(a)){beginPause(a);return;}
a.phase="walk";a.stuck=0;
fadeTo(a,a.actions.Walk?"Walk":"Run");
}
function tryMove(a,dt){
const dx=a.dx-a.x,dz=a.dz-a.z,dist=Math.hypot(dx,dz);
if(dist<.4)return "arrive";
const dirx=dx/dist,dirz=dz/dist,step=Math.min(a.speed*dt,dist);
const angs=[0,.5,-.5,1.05,-1.05,1.7,-1.7,2.4,-2.4,3.14];
for(let i=0;i<angs.length;i++){
const c=Math.cos(angs[i]),s=Math.sin(angs[i]);
const rx=dirx*c-dirz*s,rz=dirx*s+dirz*c;
const nx=a.x+rx*step,nz=a.z+rz*step;
const fx=a.x+rx*(step+.55),fz=a.z+rz*(step+.55);
if(!walkable(nx,nz)||!walkable(fx,fz)||blocked(nx,nz,a.rad)||blocked(fx,fz,a.rad))continue;
a.x=nx;a.z=nz;
const ty=Math.atan2(rx,rz);
let d=ty-a.yaw;d=Math.atan2(Math.sin(d),Math.cos(d));
const m=8*dt;a.yaw+=d<-m?-m:d>m?m:d;
return "ok";
}
return "stuck";
}
function separate(){
for(let i=0;i<actors.length;i++)for(let j=i+1;j<actors.length;j++){
const a=actors[i],b=actors[j];
let dx=b.x-a.x,dz=b.z-a.z,d=Math.hypot(dx,dz),need=a.rad+b.rad;
if(d>=need||d<1e-4)continue;
const p=(need-d)*.5,nx=dx/d,nz=dz/d;
const ax=a.x-nx*p,az=a.z-nz*p,bx=b.x+nx*p,bz=b.z+nz*p;
if(walkable(ax,az)&&!blocked(ax,az,a.rad*.5)){a.x=ax;a.z=az;}
if(walkable(bx,bz)&&!blocked(bx,bz,b.rad*.5)){b.x=bx;b.z=bz;}
}
}
function footY(x,z){return (window.TBWorld&&TBWorld.groundY)?TBWorld.groundY(x,z):0;}
function turnTo(a,ty,dt,rate){
let d=ty-a.yaw;d=Math.atan2(Math.sin(d),Math.cos(d));
const m=rate*dt;a.yaw+=d<-m?-m:d>m?m:d;
}
function makeActor(def,built,root){
const mixer=new THREE.AnimationMixer(built.root),actions={};
for(let i=0;i<built.clips.length;i++){
const c=built.clips[i],act=mixer.clipAction(c);
if(ONCE[c.name]){act.setLoop(THREE.LoopOnce,1);act.clampWhenFinished=true;}
else act.setLoop(THREE.LoopRepeat,Infinity);
actions[c.name]=act;
}
const a={def,kind:def.kind,root:built.root,mixer,actions,clip:"",fading:null,fadeT:0,
x:def.x,z:def.z,yaw:def.yaw||0,homeX:def.x,homeZ:def.z,radius:def.radius==null?3:def.radius,
speed:def.speed||(def.kind==="animal"?1.3:1.15),rad:def.kind==="animal"?0.46:0.32,
phase:"pause",left:1,stuck:0,dx:def.x,dz:def.z};
/* FF3 clips play at their native rate; Walk is foot-locked to the wander speed (per-actor jitter stays off it) */
mixer.timeScale=.94+Math.random()*.12;
const g=TBAssets.gait(def.url);
if(g)for(const n in actions){const st=g.stride[n],act=actions[n];
act.timeScale=st?TBAssets.footLock(act.getClip(),st,a.speed,built.root.scale.x)/mixer.timeScale:g.rate;}
mixer.addEventListener("finished",()=>{if(a.phase==="pause"&&a.clip!=="Idle")fadeTo(a,"Idle");});
built.root.position.set(a.x,footY(a.x,a.z),a.z);built.root.rotation.y=a.yaw;
root.add(built.root);
return a;
}
function update(dt){
for(let i=0;i<actors.length;i++){
const a=actors[i];
if(a.phase==="walk"){
const r=tryMove(a,dt);
if(r==="arrive")beginPause(a);
else if(r==="stuck"){a.stuck+=dt;if(a.stuck>.75){a.stuck=0;beginPause(a);}}
else a.stuck=0;
}else{
a.left-=dt;
const pal=nearest(a);
if(pal)turnTo(a,Math.atan2(pal.x-a.x,pal.z-a.z),dt,3.2);
if(a.left<=0)beginWalk(a);
}
if(a.fading){a.fadeT-=dt;if(a.fadeT<=0){a.fading.stop();a.fading=null;}}
}
separate();
for(let i=0;i<actors.length;i++){
const a=actors[i];
a.root.position.set(a.x,footY(a.x,a.z),a.z);a.root.rotation.y=a.yaw;a.mixer.update(dt);
}
}
function start(opts){
BX=opts.BX;walkable=opts.walkable;actors=[];
opts.roster.forEach(def=>{
const pack=def.pack||(def.kind==="hero"?"heroes":"animals");
const url=TB_ROOT+"models/"+pack+"/"+def.file;
const built=TBAssets.cloneSkinned(url);
if(!built){console.warn("trail world: no actor",def.file);return;}
/* heroes ship about 2 m tall; the meadow is normalised to ~1.8 m.
   native keeps a cast at its own height (the stock Pro Fantasy characters are already ~1.5 m). */
if(def.kind==="hero"&&!def.native)built.root.scale.multiplyScalar(.9);
actors.push(makeActor(Object.assign({url},def),built,opts.root));
});
actors.forEach((a,i)=>{if(i%2)beginWalk(a);else beginPause(a);a.mixer.update(.02);});
}
window.TBLife={start,update,count:()=>actors.length};
})();
