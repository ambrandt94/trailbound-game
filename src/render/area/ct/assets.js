/* Ported from trailbound-controller (deployed main). ESM, behaviour-faithful.
   Not typechecked: a full TS conversion of these files would stall the port.
   three r187: colorSpace, colorspace_fragment, per-fragment Lambert cel, asset root.
*/
import { THREE } from './three-runtime.js';
/* GLB loading for the living world.
   Paid Asset Store models, embedded in this workshop only — not a pack to redistribute.
   Textures stay nearest-filtered with mipmaps off so the pixels stay crisp.
   Skinned copies go through SkeletonUtils.clone so instances don't share a skeleton. */
(function(){
const MAPS=["map","emissiveMap","normalMap","roughnessMap","metalnessMap","alphaMap","aoMap"];
const loader=new THREE.GLTFLoader();
const pending=Object.create(null),got=Object.create(null);
const tintTex=Object.create(null),tintMat=Object.create(null);

function crisp(t){
t.magFilter=THREE.NearestFilter;
t.minFilter=THREE.NearestFilter;
t.generateMipmaps=false;
t.needsUpdate=true;
}
/* glTF ships Standard materials. Without an env map those read as near-black.
   Phong with the same maps matches the workshop lights and keeps skinning. */
function toPhong(m){
if(!m||!m.isMeshStandardMaterial)return m;
const p=new THREE.MeshPhongMaterial({
name:m.name,map:m.map,color:m.color?m.color.clone():new THREE.Color(0xffffff),
emissive:m.emissive?m.emissive.clone():new THREE.Color(0),emissiveMap:m.emissiveMap,
emissiveIntensity:m.emissiveIntensity==null?1:m.emissiveIntensity,
shininess:0,specular:new THREE.Color(0),
transparent:m.transparent,opacity:m.opacity,alphaTest:m.alphaTest,side:m.side,
vertexColors:m.vertexColors,depthWrite:m.depthWrite,depthTest:m.depthTest
});
return p;
}
function prep(root){
root.traverse(o=>{
if(!o.isMesh||!o.material)return;
const list=(Array.isArray(o.material)?o.material:[o.material]).map(toPhong);
o.material=Array.isArray(o.material)?list:list[0];
list.forEach(m=>{
MAPS.forEach(k=>{if(m[k])crisp(m[k]);});
/* alpha cutout (heroes' eye cards, any MASK material) — no blended fringe */
if(m.alphaTest>0){m.alphaTest=Math.max(m.alphaTest,.45);m.transparent=false;m.depthWrite=true;}
});
});
}
function load(url){
if(pending[url])return pending[url];
pending[url]=new Promise((res,rej)=>{
loader.load(url,g=>{prep(g.scene);got[url]=g;res(g);},undefined,e=>{got[url]=null;rej(e);});
});
return pending[url];
}
function warm(urls){
return Promise.all(urls.map(u=>load(u).catch(e=>{console.warn("trail world: missing",u,e);return null;})));
}
function texture(url){
return new Promise((res,rej)=>{
new THREE.TextureLoader().load(url,t=>{
crisp(t);t.wrapS=t.wrapT=THREE.RepeatWrapping;
t.colorSpace=THREE.SRGBColorSpace;
res(t);
},undefined,rej);
});
}
/* Shift the painted red awning stripes toward a muted brick or a muted blue.
   Wood and ground pixels stay. The stall is one atlas, so this is pixel-level. */
function isStripe(r,g,b){return r>110&&r>g*1.9&&r>b*1.7;}
function tintMap(src,mode){
const key=mode+"|"+src.uuid;
if(tintTex[key])return tintTex[key];
const img=src.image;if(!img||!img.width)return src;
const c=document.createElement("canvas");c.width=img.width;c.height=img.height;
const g=c.getContext("2d");g.drawImage(img,0,0);
const im=g.getImageData(0,0,c.width,c.height),d=im.data;
for(let i=0;i<d.length;i+=4){
const r=d[i],gv=d[i+1],b=d[i+2];
if(!isStripe(r,gv,b))continue;
if(mode==="blue"){d[i]=Math.min(255,r*.15+78);d[i+1]=Math.min(255,r*.18+96);d[i+2]=Math.min(255,r*.28+118);}
else{d[i]=Math.min(255,r*.42+86);d[i+1]=Math.min(255,gv*.35+r*.08+28);d[i+2]=Math.min(255,b*.3+r*.06+22);}
}
g.putImageData(im,0,0);
const t=new THREE.CanvasTexture(c);
t.flipY=src.flipY;t.colorSpace=src.colorSpace||THREE.SRGBColorSpace;
t.wrapS=src.wrapS;t.wrapT=src.wrapT;crisp(t);
tintTex[key]=t;return t;
}
function tintOne(m,mode){
if(!m||!m.map||!m.map.image||(m.name&&m.name.indexOf("glow")>=0))return m;
const key=mode+"|"+m.map.uuid;
if(tintMat[key])return tintMat[key];
const c=m.clone();c.map=tintMap(m.map,mode);c.needsUpdate=true;
tintMat[key]=c;return c;
}
function cloneProp(url,opt){
const g=got[url];if(!g)return null;
const o=g.scene.clone(true);
if(opt&&opt.stripe)o.traverse(n=>{
if(!n.isMesh||!n.material)return;
const list=Array.isArray(n.material)?n.material:[n.material];
const next=list.map(m=>tintOne(m,opt.stripe));
n.material=Array.isArray(n.material)?next:next[0];
});
return o;
}
function cloneSkinned(url){
const g=got[url];if(!g||!THREE.SkeletonUtils)return null;
const o=THREE.SkeletonUtils.clone(g.scene);
o.traverse(n=>{n.frustumCulled=false;});
return{root:o,clips:g.animations};
}
/* FF3 (DS) rips: keys are stamped at 60 fps but the DS played them at 30, so every clip runs at half rate.
   The whole cast shares one skeleton. stride = metres the body covers per loop at timeScale 1 and scale 1,
   measured from the contact foot's backward speed (Walk 0.4 s loop, Run 0.233 s loop).
   Locomotion timeScale = speed * duration / (stride * scale) keeps the planted foot still. */
const FF3={rate:.5,stride:{Walk:1.07,Run:1.98}};
function gait(url){return url&&url.indexOf("/ff3/")>=0?FF3:null;}
function footLock(clip,stride,speed,scale){return speed*clip.duration/(stride*(scale||1));}
window.TBAssets={warm,texture,get:u=>got[u]||null,cloneProp,cloneSkinned,gait,footLock};
})();
