/* Ported from trailbound-controller (deployed main). ESM, behaviour-faithful.
   Not typechecked: a full TS conversion of these files would stall the port.
   three r187: colorSpace, colorspace_fragment, per-fragment Lambert cel, asset root.
*/
import { locomotionSample } from '../locomotion.ts';
import { THREE } from './three-runtime.js';
/* Player (and the talkative meadow NPC) visuals.
   Movement stays on the existing rig; this only swaps the cubes for a hero GLB
   and plays Idle / Walk / Run from the movement state. */
(function(){
const TB_ROOT=(import.meta.env&&import.meta.env.BASE_URL?import.meta.env.BASE_URL:'./')+'assets/';
/* P1, P2, talkative NPC. FF3 (DS) rips are exported at their chibi height (~1.4 m), so they keep scale 1. */
const URLS=[TB_ROOT+"models/ff3/ingus_freelancer.glb",TB_ROOT+"models/ff3/ingus_black_mage.glb",TB_ROOT+"models/ff3/smith.glb"];
const HERO=0.9;/* native heroes are ~2 m; meadow characters are ~1.8 m */
function sizeOf(url){return url.indexOf("/ff3/")>=0?1:HERO;}
const claimed=[];

function hideCubes(rig){
rig.root.traverse(o=>{if(o.isMesh)o.visible=false;});
}
function claim(rig){
rig._slot=claimed.length;
claimed.push(rig);
if(window.TBAssets&&TBAssets.get(URLS[rig._slot%URLS.length]))dress(rig);
}
function play(rig,name){
const actions=rig.actions;
if(!actions[name])name=actions.Idle?"Idle":Object.keys(actions)[0];
if(!name||rig.clip===name)return;
const next=actions[name],prev=rig.clip?actions[rig.clip]:null;
if(!prev){next.reset().play();rig.clip=name;return;}
next.reset().fadeIn(.16).play();
prev.fadeOut(.16);
rig.clip=name;
}
function dress(rig){
if(rig.mixer)return true;
const url=URLS[rig._slot%URLS.length],built=TBAssets.cloneSkinned(url);
if(!built)return false;
const drop=[];
rig.root.traverse(o=>{if(o.isMesh)drop.push(o);});
drop.forEach(o=>{if(o.parent)o.parent.remove(o);});
built.root.scale.multiplyScalar(sizeOf(url));
rig.size=sizeOf(url);rig.gait=TBAssets.gait(url);
built.root.traverse(o=>{o.visible=true;});
rig.root.add(built.root);
const mixer=new THREE.AnimationMixer(built.root),actions={};
for(let i=0;i<built.clips.length;i++){
const c=built.clips[i],act=mixer.clipAction(c);
if(c.name==="Cheer"||c.name==="Interact"||c.name==="Attack"){act.setLoop(THREE.LoopOnce,1);act.clampWhenFinished=true;}
actions[c.name]=act;
}
rig.mixer=mixer;rig.actions=actions;rig.clip="";
play(rig,"Idle");
return true;
}
function dressAll(){claimed.forEach(dress);}
/* Returns true once a hero mesh owns the pose. Jump and fall keep the clip they left the ground with.
   Walk and Run are foot-locked to ground speed; everything else plays at the rip's native rate. */
function drive(rig,p,dt){
if(!rig.mixer)return false;
const names=Object.keys(rig.actions);
const durations={};
for(let i=0;i<names.length;i++){
const act=rig.actions[names[i]];
durations[names[i]]=act.getClip().duration;
}
const g=rig.gait;
const sample=locomotionSample({
state:p.st,
speed:Math.hypot(p.vx,p.vz),
scale:rig.size*rig.root.scale.x,
clips:names,
durations:durations,
strides:g?g.stride:undefined,
gaitRate:g?g.rate:1
});
if(sample.clip)play(rig,sample.clip);
rig.mixer.timeScale=sample.timeScale;
rig.mixer.update(dt);
return true;
}
window.TBAvatar={claim:claim,dressAll:dressAll,drive:drive,urls:function(){return URLS.slice();}};
})();
