/* Ported from trailbound-controller (deployed main). ESM, behaviour-faithful.
   Not typechecked: a full TS conversion of these files would stall the port.
   three r187: colorSpace, colorspace_fragment, per-fragment Lambert cel, asset root.
*/
import { THREE } from './three-runtime.js';
/* AreaExport props, wagon-yard slots and host_* markers.
   Kit name → placeholder (bbox, pivot, family colour, flat bands). One
   InstancedMesh per kit part, so a later GLB can replace `model` on the
   same map. v0.5 props have type/class/x/y and no kit; those still draw.
   Ground cover stays outline-free. Solid props, trees, rocks and fences
   take the object outline. No baked dither and no black (V stays ≥ 0.35).
   Props and buildings are 24 texels/m; heroes 32. */
(function(){
const HOST={
"host_table_game_1.5":{w:1.5,d:1.5,h:0.75},
"host_table_arm_1.0":{w:1,d:1,h:0.75},
"host_fishing_spot":{w:1.5,d:1.5,h:0.05,decal:1},
"host_forage_patch":{w:1.5,d:1.5,h:0.05,decal:1},
"host_chopping_block":{w:0.75,d:0.5,h:0.5},
"host_stage_3x3":{w:3,d:3,h:0.3},
"host_delve_entrance":{w:1.5,d:1.5,h:2.2},
"host_archery_butts":{w:1.5,d:0.5,h:1.5},
"host_race_gate":{w:3,d:0.5,h:2.5},
"host_ore_vein":{w:1.2,d:1.2,h:1},
"host_marker":{w:0.8,d:0.8,h:1.4}
};
const LEGACY={
well:"prop_well_simple",lantern:"prop_lantern_post",bench:"prop_bench_1.5m",
market:"prop_market_stall_3x1.5",chest:"prop_crate_0.75",fence:"prop_fence_split_rail_3m",
"rock-4":"rock_boulder_cool_m",rock:"rock_boulder_cool_m"
};
const BARK="#8D6240",CONIFER="#3E8C48",MOSS="#6E8A62",HOODOO="#C27248",DIRT="#C4A06A";
/* Plaza stone is not the shared deco green or the prop tan, so a fountain,
   statue and well stay separate objects. Basin water matches the shallow ocean. */
const STONE="#8E8A82",BASIN_WATER="#4A9EB2";
const FACE={N:Math.PI,S:0,E:Math.PI/2,W:-Math.PI/2};
const geoCache={},matCache={},texCache={};

function colors(){return (window.TBKit&&TBKit.colors)||{};}
function colorOf(family){
const F=colors();
return F[family]||F.prop||"#C4A07A";
}
function hash01(a,b){
let n=Math.imul((a*100|0)+17,374761393)^Math.imul((b*100|0)-9,668265263);
n=Math.imul(n^(n>>>13),1274126177);
return ((n^(n>>>16))>>>0)/4294967295;
}
function hexRgb(hex){
const n=parseInt(String(hex).replace("#",""),16);
return [(n>>16)&255,(n>>8)&255,n&255];
}
function rgbHsv(r,g,b){
r/=255;g/=255;b/=255;
const max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min;
let h=0;
if(d){
if(max===r)h=((g-b)/d)%6;
else if(max===g)h=(b-r)/d+2;
else h=(r-g)/d+4;
h*=60;if(h<0)h+=360;
}
return [h,max?d/max:0,max];
}
function hsvRgb(h,s,v){
h=((h%360)+360)%360;
const c=v*s,x=c*(1-Math.abs((h/60)%2-1)),m=v-c;
let r=0,g=0,b=0;
if(h<60){r=c;g=x;}
else if(h<120){r=x;g=c;}
else if(h<180){g=c;b=x;}
else if(h<240){g=x;b=c;}
else if(h<300){r=x;b=c;}
else{r=c;b=x;}
return [Math.round((r+m)*255),Math.round((g+m)*255),Math.round((b+m)*255)];
}
/* Shadow band stays at V ≥ 0.35 so a placeholder never resolves to black. */
function shade(hex,vMul,hueShift){
const rgb=hexRgb(hex),hsv=rgbHsv(rgb[0],rgb[1],rgb[2]);
hsv[0]+=hueShift||0;
hsv[2]=Math.max(0.35,Math.min(1,hsv[2]*(vMul==null?1:vMul)));
return hsvRgb(hsv[0],hsv[1],hsv[2]);
}
function density(spec){
return (spec&&(spec.category==="hero"||spec.family==="cap"))?32:24;
}
function bandTex(hex,height,den){
const th=Math.max(12,Math.min(256,Math.round(Math.max(0.25,height)*den)));
const key=hex+"|"+th;
if(texCache[key])return texCache[key];
const bands=[shade(hex,0.72,-10),shade(hex,0.9,-2),shade(hex,1,6)];
const data=new Uint8Array(4*th*4);
for(let y=0;y<th;y++){
const t=th<=1?1:y/(th-1);
const b=t<0.34?bands[0]:t<0.72?bands[1]:bands[2];
for(let x=0;x<4;x++){
const o=(y*4+x)*4;
data[o]=b[0];data[o+1]=b[1];data[o+2]=b[2];data[o+3]=255;
}
}
const tex=new THREE.DataTexture(data,4,th,THREE.RGBAFormat,THREE.UnsignedByteType);
tex.flipY=false;tex.magFilter=tex.minFilter=THREE.NearestFilter;tex.generateMipmaps=false;
tex.wrapS=THREE.RepeatWrapping;tex.wrapT=THREE.ClampToEdgeWrapping;tex.unpackAlignment=1;
tex.colorSpace=THREE.SRGBColorSpace;
tex.needsUpdate=true;texCache[key]=tex;return tex;
}
function bandMat(hex,height,den){
const key=hex+"|"+height+"|"+den;
if(matCache[key])return matCache[key];
const m=new THREE.MeshLambertMaterial({map:bandTex(hex,height,den),color:0xffffff});
m.toneMapped=false;m.userData.tbKeep=1;matCache[key]=m;return m;
}
function familyMaterial(family){
if(typeof THREE==="undefined")return null;
const key="flat|"+family;
if(matCache[key])return matCache[key];
const hex=colorOf(family);
const base=window.TBTiles&&TBTiles.MAT&&TBTiles.MAT.plaster;
const m=base?base.clone():new THREE.MeshLambertMaterial();
m.color.set(hex);
m.map=bandTex(hex,3,24);
m.toneMapped=false;m.userData.tbKeep=1;matCache[key]=m;return m;
}
function bandUV(geo,height,den){
const p=geo.attributes.position,uv=new Float32Array(p.count*2),h=Math.max(0.125,height);
for(let i=0;i<p.count;i++){
uv[i*2]=p.getX(i)*den/4;
uv[i*2+1]=p.getY(i)/h;
}
geo.setAttribute("uv",new THREE.Float32BufferAttribute(uv,2));
return geo;
}
function mergeGeos(list){
const pos=[],uv=[],idx=[];
let base=0;
list.forEach(function(g){
const ng=g.index?g.toNonIndexed():g;
const p=ng.attributes.position;
for(let i=0;i<p.count;i++)pos.push(p.getX(i),p.getY(i),p.getZ(i));
base+=p.count;
});
const geo=new THREE.BufferGeometry();
geo.setAttribute("position",new THREE.Float32BufferAttribute(pos,3));
geo.computeVertexNormals();
return geo;
}
function cyl(rTop,rBot,h,seg){
const g=new THREE.CylinderGeometry(rTop,rBot,h,seg||7);
g.translate(0,h/2,0);
return g;
}
function cone(r,h,seg){
const g=new THREE.ConeGeometry(r,h,seg||7);
g.translate(0,h/2,0);
return g;
}
function ico(r){return new THREE.IcosahedronGeometry(r,0);}
function sit(geo){
geo.computeBoundingBox();
const b=geo.boundingBox;
geo.translate(0,-b.min.y,0);
return geo;
}
/* Chamfered box, pivot on the bottom centre. Not a single cube. */
function bevelBox(w,h,d,bevel){
const hw=w/2,hd=d/2,b=Math.min(bevel==null?Math.min(w,h,d)*0.12:bevel,hw*0.42,h*0.42,hd*0.42);
if(!(b>0.025)||typeof THREE==="undefined"){
const g=new THREE.BoxGeometry(Math.max(0.05,w),Math.max(0.05,h),Math.max(0.05,d));
g.translate(0,h/2,0);return g;
}
const y0=b,y1=h-b,pos=[],ind=[];
function V(x,y,z){const i=pos.length/3;pos.push(x,y,z);return i;}
function quad(a,b,c,d){ind.push(a,b,c,a,c,d);}
const T=[V(-hw+b,h,-hd+b),V(hw-b,h,-hd+b),V(hw-b,h,hd-b),V(-hw+b,h,hd-b)];
const B=[V(-hw+b,0,-hd+b),V(-hw+b,0,hd-b),V(hw-b,0,hd-b),V(hw-b,0,-hd+b)];
const F=[V(-hw+b,y0,hd),V(hw-b,y0,hd),V(hw-b,y1,hd),V(-hw+b,y1,hd)];
const K=[V(hw-b,y0,-hd),V(-hw+b,y0,-hd),V(-hw+b,y1,-hd),V(hw-b,y1,-hd)];
const R=[V(hw,y0,-hd+b),V(hw,y0,hd-b),V(hw,y1,hd-b),V(hw,y1,-hd+b)];
const L=[V(-hw,y0,hd-b),V(-hw,y0,-hd+b),V(-hw,y1,-hd+b),V(-hw,y1,hd-b)];
quad(T[0],T[3],T[2],T[1]);
quad(B[0],B[1],B[2],B[3]);
quad(F[0],F[1],F[2],F[3]);
quad(K[0],K[1],K[2],K[3]);
quad(R[0],R[1],R[2],R[3]);
quad(L[0],L[1],L[2],L[3]);
function edge(a,b,c,d){quad(a,b,c,d);}
edge(T[3],F[3],F[2],T[2]);
edge(T[1],K[3],K[2],T[0]);
edge(T[2],R[2],R[3],T[1]);
edge(T[0],L[2],L[3],T[3]);
edge(B[1],F[0],F[1],B[2]);
edge(B[3],K[0],K[1],B[0]);
edge(B[2],R[1],R[0],B[3]);
edge(B[0],L[1],L[0],B[1]);
edge(F[1],R[1],R[2],F[2]);
edge(R[0],K[0],K[3],R[3]);
edge(K[1],L[1],L[2],K[2]);
edge(L[0],F[0],F[3],L[3]);
function corner(a,b,c){ind.push(a,b,c);}
corner(T[2],F[2],R[2]);
corner(T[1],R[3],K[3]);
corner(T[0],K[2],L[2]);
corner(T[3],L[3],F[3]);
corner(B[2],R[1],F[1]);
corner(B[3],K[0],R[0]);
corner(B[0],L[1],K[1]);
corner(B[1],F[0],L[0]);
const geo=new THREE.BufferGeometry();
geo.setAttribute("position",new THREE.Float32BufferAttribute(pos,3));
geo.setIndex(ind);
geo.computeVertexNormals();
return geo;
}
function moved(geo,x,y,z,rx,ry,rz,sx,sy,sz){
const g=geo.clone();
if(sx||sy||sz)g.scale(sx==null?1:sx,sy==null?1:sy,sz==null?1:sz);
if(rx)g.rotateX(rx);if(ry)g.rotateY(ry);if(rz)g.rotateZ(rz);
g.translate(x||0,y||0,z||0);
return g;
}
function treeStyle(name){
if(/palm|coconut/.test(name))return "palm";
if(/acacia|baobab/.test(name))return "flat";
if(/dead|snag|charred|crystal/.test(name))return "snag";
if(/pine|spruce|fir|larch|yew|juniper|conifer|cypress/.test(name))return "conifer";
if(/willow|mangrove/.test(name))return "willow";
return "broad";
}
function rockTint(name){
if(/hoodoo|red_|sandstone|mesa/.test(name))return HOODOO;
if(/moss|lichen/.test(name))return MOSS;
return colorOf("rock");
}
function shapeOf(spec){
const n=spec.name||"",c=spec.category||"";
if(spec.pad||n==="__pad")return "pad";
if(spec.decal)return "decal";
if(/steam|motes/.test(n))return "fx";
if(c==="tree"||/^tree_/.test(n))return "tree";
if(c==="rock"||/^rock_/.test(n))return "rock";
if(c==="plant"||/^(bush_|flower_|grass_|reeds_|lilypad|beach_grass|mushroom_|vine_|cactus_|crop_|mangrove_)/.test(n))return "plant";
if(c==="fence"||/fence|palisade|rail|hedge/.test(n))return "fence";
if(/^host_/.test(n)&&/spot|patch|decal/.test(n))return "decal";
if(/^host_/.test(n))return "box";
if(/barrel|keg|vat|well|trough|pot|planter|bucket|quench|brazier/.test(n))return "cylinder";
if(/haystack|sack|pile|mound|coal|snowdrift|heap|cairn|skull|bones|termite/.test(n))return "blob";
if(/cart|wagon/.test(n))return "cart";
if(/post|signpost|lantern|lamp_|banner_pole|pole/.test(n))return "post";
return "box";
}
function solidOf(spec,shape){
if(shape==="decal"||shape==="fx"||shape==="pad")return false;
if(spec.category==="plant"&&spec.h<0.7&&/flower|grass_|lilypad|reeds_|beach_grass/.test(spec.name||""))return false;
return true;
}
function part(geo,hex,spec,solid){
const den=density(spec);
let g=geo;
if(g.index)g=g.toNonIndexed();
if(g.clearGroups)g.clearGroups();
if(!g.attributes.normal)g.computeVertexNormals();
bandUV(g,Math.max(0.25,spec.h||1),den);
g.computeBoundingSphere();
g.userData.tbKeep=1;
return {geo:g,mat:bandMat(hex,Math.max(0.25,spec.h||1),den),solid:solid};
}
function treeParts(spec){
const w=spec.w,h=spec.h,style=treeStyle(spec.name||""),r=Math.min(w,spec.d)*0.5;
const trunk=part(cyl(r*0.1,r*0.16,h*(style==="snag"?0.92:0.34),6),BARK,spec,true);
if(style==="snag")return [trunk,part(moved(cone(r*0.22,h*0.18,5),r*0.2,h*0.78,0,0,0.4,0.6),BARK,spec,true)];
if(style==="conifer"){
const leaf=CONIFER;
return [trunk,
part(moved(cone(r*0.92,h*0.38,7),0,h*0.28,0),leaf,spec,true),
part(moved(cone(r*0.68,h*0.32,7),0,h*0.5,0),leaf,spec,true),
part(moved(cone(r*0.4,h*0.26,6),0,h*0.7,0),leaf,spec,true)];
}
if(style==="palm"){
const leaf="#56A84A",parts=[part(cyl(r*0.08,r*0.14,h*0.72,6),BARK,spec,true)];
for(let i=0;i<5;i++){
const yaw=i/5*Math.PI*2;
parts.push(part(moved(cone(r*0.55,h*0.22,5),Math.cos(yaw)*r*0.35,h*0.7,Math.sin(yaw)*r*0.35,0.9,yaw,0),leaf,spec,true));
}
return parts;
}
if(style==="flat"){
const canopy=ico(r*0.85);canopy.scale(1,0.28,1);sit(canopy);canopy.translate(0,h*0.78,0);
return [part(cyl(r*0.1,r*0.16,h*0.55,6),BARK,spec,true),part(canopy,colorOf("tree"),spec,true)];
}
const leaf=colorOf("tree");
const clumps=[];
[[0,0.62,0,0.46],[0.28,0.74,0.12,0.32],[-0.22,0.7,-0.16,0.3]].forEach(function(c){
const g=ico(r*c[3]);g.translate(r*c[0],h*c[1],r*c[2]);
clumps.push(part(g,leaf,spec,true));
});
if(style==="willow"){
const drape=moved(cone(r*0.7,h*0.45,7),0,h*0.35,0);
clumps.push(part(drape,"#4E924A",spec,true));
}
return [trunk].concat(clumps);
}
function rockParts(spec){
const n=spec.name||"",tint=rockTint(n),w=spec.w,d=spec.d,h=spec.h;
let g;
if(/column|basalt/.test(n))g=cyl(Math.min(w,d)*0.42,Math.min(w,d)*0.48,h,6);
else if(/hoodoo|spire|sea_stack/.test(n)){
g=mergeGeos([
cyl(w*0.28,w*0.42,h*0.55,6),
moved(cyl(w*0.18,w*0.3,h*0.35,6),0,h*0.5,0),
moved(cone(w*0.16,h*0.22,6),0,h*0.78,0)
]);
}else{
g=ico(1);const p=g.attributes.position;
for(let i=0;i<p.count;i++){
const j=hash01(i*3+n.length,i*7);
const s=0.78+j*0.4;
p.setXYZ(i,p.getX(i)*s*(0.9+hash01(i,1)*0.2),p.getY(i)*s,p.getZ(i)*s*(0.9+hash01(i,2)*0.2));
}
g.computeBoundingBox();
const bb=g.boundingBox,sx=w/Math.max(0.001,bb.max.x-bb.min.x),sy=h/Math.max(0.001,bb.max.y-bb.min.y),sz=d/Math.max(0.001,bb.max.z-bb.min.z);
g.scale(sx,sy,sz);sit(g);
if(/outcrop|slab|flat|scree/.test(n))g.scale(1,0.55,1);
}
return [part(g,tint,spec,true)];
}
function plantParts(spec){
const n=spec.name||"",w=spec.w,h=spec.h,r=Math.min(w,spec.d)*0.5;
if(/cactus_column/.test(n))return [part(cyl(r*0.35,r*0.42,h,6),"#5C9A44",spec,true)];
if(/cactus/.test(n))return [part(moved(bevelBox(w*0.7,h*0.7,spec.d*0.22,0.04),0,h*0.35,0), "#5C9A44",spec,true)];
if(/mushroom/.test(n)){
return [part(cyl(r*0.12,r*0.16,h*0.45,6),"#C4A07A",spec,true),part(moved(ico(r*0.7),0,h*0.62,0,0,0,0,1,0.45,1),"#C44A3A",spec,true)];
}
if(/flower/.test(n)){
const blob=ico(r*0.7);blob.scale(1,0.45,1);sit(blob);
return [part(blob,"#E8C86A",spec,false)];
}
if(/grass_|reeds_|beach_grass|lilypad/.test(n)){
const g=cone(r*0.7,h,5);return [part(g,colorOf("plant"),spec,false)];
}
const a=ico(r*0.62),b=ico(r*0.45);
a.translate(0,h*0.45,0);b.translate(r*0.28,h*0.38,r*0.1);
return [part(mergeGeos([a,b]),colorOf("plant"),spec,h>=0.7)];
}
function fenceParts(spec){
const w=spec.w,h=spec.h,d=Math.max(0.12,spec.d);
const post=function(x){return moved(cyl(d*0.35,d*0.42,h,5),x,0,0);};
const railY=h*0.62,rail=bevelBox(Math.max(0.2,w),h*0.12,d*0.45,0.02);
rail.translate(w/2,railY,0);
let g=mergeGeos([post(0),post(w),rail]);
if(spec.pivot!=="bottom_left_post")g.translate(-w/2,0,0);
return [part(g,colorOf("fence"),spec,true)];
}
function cartParts(spec){
const w=spec.w,d=spec.d,h=spec.h;
const body=bevelBox(w*0.92,h*0.62,d*0.72,0.06);
body.translate(0,h*0.38,0);
const wheel=function(x,z){return moved(cyl(h*0.28,h*0.28,w*0.12,8),x,h*0.28,z,0,0,Math.PI/2);};
const wheels=mergeGeos([wheel(-w*0.42,-d*0.22),wheel(w*0.42,-d*0.22),wheel(-w*0.42,d*0.22),wheel(w*0.42,d*0.22)]);
return [part(body,colorOf(spec.family),spec,true),part(wheels,"#5C4636",spec,true)];
}
/* Dimensions come from the kit bbox so a 3×3×1.5 fountain stays low and wide
   and a 1.5×1.5×3.25 statue stays tall. Water discs are not solid, so they
   take no outline. Bands only; shade() keeps V ≥ 0.35. */
function plazaOf(spec){
if(!spec||!spec.name)return null;
const n=spec.name,w=+spec.w,d=+spec.d,h=+spec.h;
if(/fountain/.test(n)){
const baseH=Math.max(0.22,h*0.34);
return {kind:"fountain",parts:[
{role:"basin",hex:STONE,solid:true,w:w,d:d,h:baseH},
{role:"spout",hex:STONE,solid:true,w:Math.min(w,d)*0.16,d:Math.min(w,d)*0.16,h:Math.max(0.3,h*0.92-baseH)},
{role:"water",hex:BASIN_WATER,solid:false,w:Math.min(w,d)*0.72,d:Math.min(w,d)*0.72,h:0.02}
]};
}
if(/statue/.test(n)){
const plinthH=Math.max(0.2,h*0.2);
return {kind:"statue",parts:[
{role:"plinth",hex:STONE,solid:true,w:w*0.92,d:d*0.92,h:plinthH},
{role:"figure",hex:STONE,solid:true,w:w*0.38,d:d*0.34,h:Math.max(0.3,h-plinthH)}
]};
}
if(/well/.test(n)){
const roofed=/roof|canopy/.test(n)||h>=2.2;
return {kind:"well",roofed:roofed,parts:[
{role:"drum",hex:STONE,solid:true,w:w,d:d,h:roofed?Math.min(1,h*0.34):Math.max(0.45,h*0.7)},
{role:"water",hex:BASIN_WATER,solid:false,w:Math.min(w,d)*0.5,d:Math.min(w,d)*0.5,h:0.02},
roofed?{role:"roof",hex:STONE,solid:true,w:w,d:d,h:h}:null
].filter(Boolean)};
}
return null;
}
function fountainParts(spec){
const plan=plazaOf(spec),w=spec.w,d=spec.d,h=spec.h;
const baseH=plan.parts[0].h;
const base=bevelBox(w,baseH,d,Math.min(0.08,w*0.05));
const spoutH=plan.parts[1].h;
const spout=cyl(Math.min(w,d)*0.07,Math.min(w,d)*0.1,spoutH,7);
spout.translate(0,baseH,0);
const disc=new THREE.CircleGeometry(Math.min(w,d)*0.36,10);
disc.rotateX(-Math.PI/2);
disc.translate(0,baseH+0.03,0);
return [part(base,STONE,spec,true),part(spout,STONE,spec,true),part(disc,BASIN_WATER,spec,false)];
}
function statueParts(spec){
const plan=plazaOf(spec),w=spec.w,d=spec.d,h=spec.h;
const plinthH=plan.parts[0].h;
const plinth=bevelBox(w*0.92,plinthH,d*0.92,0.04);
const headR=Math.min(w,d)*0.2;
const bodyH=Math.max(0.3,h-plinthH-headR*2.05);
const body=bevelBox(w*0.38,bodyH,d*0.34,0.03);
body.translate(0,plinthH,0);
const head=ico(headR);sit(head);head.translate(0,plinthH+bodyH,0);
return [part(plinth,STONE,spec,true),part(body,STONE,spec,true),part(head,STONE,spec,true)];
}
function wellParts(spec){
const plan=plazaOf(spec),w=spec.w,d=spec.d,h=spec.h;
const roofed=plan.roofed;
const foot=Math.min(w,d);
const drumR=roofed?Math.min(foot*0.28,0.85):foot*0.38;
const drumH=plan.parts[0].h;
const drum=cyl(drumR,drumR*1.05,drumH,8);
const disc=new THREE.CircleGeometry(drumR*0.72,8);
disc.rotateX(-Math.PI/2);
disc.translate(0,drumH+0.03,0);
const parts=[part(drum,STONE,spec,true),part(disc,BASIN_WATER,spec,false)];
if(roofed){
const roofT=Math.max(0.1,h*0.08);
const postH=Math.max(drumH+0.35,h-roofT);
const posts=[];
const px=w*0.36,pz=d*0.36;
[[-px,-pz],[px,-pz],[px,pz],[-px,pz]].forEach(function(p){
posts.push(moved(cyl(0.08,0.1,postH,5),p[0],0,p[1]));
});
const roof=bevelBox(w*0.98,roofT,d*0.98,0.04);
roof.translate(0,postH,0);
posts.push(roof);
parts.push(part(mergeGeos(posts),STONE,spec,true));
}
return parts;
}
function partsFor(spec){
const key=spec.name+"|"+spec.w+"|"+spec.d+"|"+spec.h;
if(geoCache[key])return geoCache[key];
const shape=shapeOf(spec),solid=solidOf(spec,shape);
const plaza=plazaOf(spec);
let parts=[];
if(plaza&&plaza.kind==="fountain")parts=fountainParts(spec);
else if(plaza&&plaza.kind==="statue")parts=statueParts(spec);
else if(plaza&&plaza.kind==="well")parts=wellParts(spec);
else if(shape==="fx")parts=[];
else if(shape==="tree")parts=treeParts(spec);
else if(shape==="rock")parts=rockParts(spec);
else if(shape==="plant")parts=plantParts(spec);
else if(shape==="fence")parts=fenceParts(spec);
else if(shape==="cart")parts=cartParts(spec);
else if(shape==="pad")parts=[part(bevelBox(spec.w,Math.max(0.05,spec.h),spec.d,0.04),DIRT,spec,false)];
else if(shape==="decal"){
const g=new THREE.CircleGeometry(Math.max(spec.w,spec.d)*0.5,8);
g.rotateX(-Math.PI/2);g.translate(0,0.04,0);
parts=[part(g,colorOf("host"),spec,false)];
}else if(shape==="cylinder"){
parts=[part(cyl(spec.w*0.5,spec.w*0.46,spec.h,8),colorOf(spec.family),spec,solid)];
}else if(shape==="post"){
parts=[part(cyl(Math.min(spec.w,spec.d)*0.28,Math.min(spec.w,spec.d)*0.34,spec.h,6),colorOf(spec.family),spec,true)];
}else if(shape==="blob"){
const g=ico(Math.max(spec.w,spec.d)*0.5);g.scale(1,spec.h/Math.max(0.2,spec.w),1);sit(g);
parts=[part(g,colorOf(spec.family),spec,solid)];
}else parts=[part(bevelBox(spec.w,spec.h,spec.d),colorOf(spec.family==="host"?"host":spec.family),spec,solid)];
geoCache[key]=parts;
return parts;
}
function specOf(name){
if(!name)return null;
if(name==="prop_hitching_rail_3m")name="prop_fence_split_rail_3m";
if(name==="__pad")return {name:"__pad",w:3,d:6,h:0.08,pivot:"bottom_center",category:"deco",family:"prop",color:DIRT,model:null,pad:1};
const host=HOST[name];
if(host)return {name:name,w:host.w,d:host.d,h:host.h,pivot:"bottom_center",category:"host",family:"host",color:colorOf("host"),model:null,decal:!!host.decal};
const item=window.TBKit&&TBKit.get&&TBKit.get(name);
if(item)return item;
if(/^host_/.test(name))return specOf("host_marker");
if(/^tree_/.test(name))return {name:name,w:4,d:4,h:7,pivot:"trunk_base",category:"tree",family:"tree",color:colorOf("tree"),model:null};
if(/^rock_/.test(name))return {name:name,w:1.5,d:1.5,h:1.2,pivot:"bottom_center",category:"rock",family:"rock",color:colorOf("rock"),model:null};
if(/^bush_|^flower_|^grass_/.test(name))return {name:name,w:1,d:1,h:0.8,pivot:"bottom_center",category:"plant",family:"plant",color:colorOf("plant"),model:null};
if(/^bld_|^hero_|^deco_|^prop_|^civ_/.test(name))return {name:name,w:1,d:1,h:1,pivot:"bottom_center",category:"prop",family:"prop",color:colorOf("prop"),model:null};
return null;
}
function resolveKit(p){
if(!p)return "";
if(p.kit&&specOf(p.kit))return p.kit==="prop_hitching_rail_3m"?"prop_fence_split_rail_3m":p.kit;
if(p.type&&specOf(p.type))return p.type;
if(p.type&&LEGACY[p.type])return LEGACY[p.type];
if(p.class==="tree"){
const t=String(p.type||"");
if(/winter|snow/.test(t)&&specOf("tree_fir_snow_m"))return "tree_fir_snow_m";
if(/dead/.test(t)&&specOf("tree_dead_snag_m"))return "tree_dead_snag_m";
return "tree_oak_m";
}
if(p.class==="rock")return "rock_boulder_cool_m";
if(p.class==="plant")return specOf("bush_round_m")?"bush_round_m":"bush_fern_m";
if(p.class==="deco")return "deco_statue_s";
if(p.class==="host"||p.class==="hero"||p.class==="civic"||p.class==="fence_post")return p.kit||p.type||"host_marker";
return p.kit||p.type||"prop_crate_0.75";
}
function localOf(p,origin,meters){
const m=meters||1,ox=origin&&origin.x||0,oy=origin&&origin.y||0;
const y=p.y!=null?+p.y:+p.z;
return {x:(+p.x-ox)*m,z:(y-oy)*m};
}
function yawOf(p,spec){
if(p.rot!=null&&isFinite(+p.rot))return +p.rot*Math.PI/180;
if(typeof p.facing==="string"&&FACE[String(p.facing).toUpperCase()]!=null)return FACE[String(p.facing).toUpperCase()];
if(p.yaw!=null&&isFinite(+p.yaw)&&Math.abs(p.yaw)<=Math.PI*2+0.01)return +p.yaw;
const cat=spec&&spec.category;
if(cat==="tree"||cat==="rock"||cat==="plant")return hash01(p.x||0,p.y||p.z||0)*Math.PI*2;
return 0;
}
function scaleOf(p,spec){
if(!(spec&&(spec.category==="tree"||p.class==="tree")))return 1;
const s=+p.scale;
if(s>=0.9&&s<=1.1)return s;
return 1;
}
function rot2(x,z,yaw){
const c=Math.cos(yaw),s=Math.sin(yaw);
return [x*c+z*s,-x*s+z*c];
}
/* zones[].slots[].x/y are cell centres, the same convention as buildings and
   props. The pad sits on that centre; rails are offset by half the slot size. */
function slotItems(slot,origin,meters){
const w=+slot.w>0?+slot.w:3,d=+slot.d>0?+slot.d:6;
const loc=localOf(slot,origin,meters);
const yaw=(slot.rot!=null?+slot.rot:0)*Math.PI/180;
const items=[{kit:"__pad",x:loc.x,z:loc.z,yaw:yaw,scale:1}];
function put(lx,lz,ry){
const p=rot2(lx,lz,yaw);
items.push({kit:"prop_fence_split_rail_3m",x:loc.x+p[0],z:loc.z+p[1],yaw:yaw+ry,scale:1});
}
const nLong=Math.max(1,Math.round(d/3)),nShort=Math.max(1,Math.round(w/3));
[-w/2,w/2].forEach(function(sx){
for(let i=0;i<nLong;i++)put(sx,-d/2+i*3,-Math.PI/2);
});
[-d/2,d/2].forEach(function(sz){
for(let i=0;i<nShort;i++)put(-w/2+i*3,sz,0);
});
return items;
}
function nearKit(items,kit,x,z,r){
for(let i=0;i<items.length;i++){
const it=items[i];
if(it.kit!==kit)continue;
if(Math.hypot(it.x-x,it.z-z)<=r)return true;
}
return false;
}
/* ≤ 2000 vegetation, ≤ 600 other. Drop ground cover before trees. */
function budget(items){
const trees=[],cover=[],other=[];
items.forEach(function(it){
const s=specOf(it.kit);
const cat=s&&s.category;
if(cat==="tree")trees.push(it);
else if(cat==="plant")cover.push(it);
else other.push(it);
});
let room=2000;
const keepT=trees.slice(0,room);room-=keepT.length;
const keepC=cover.slice(0,Math.max(0,room));
return keepT.concat(keepC,other.slice(0,600));
}
function scatter(group,items,groundY){
if(typeof THREE==="undefined"||!items.length)return;
const bins={};
items.forEach(function(it){(bins[it.kit]||(bins[it.kit]=[])).push(it);});
Object.keys(bins).forEach(function(kit){
const list=bins[kit],spec=specOf(kit);
if(!spec)return;
const parts=partsFor(spec);
parts.forEach(function(pt){
const im=new THREE.InstancedMesh(pt.geo,pt.mat,list.length);
const dummy=new THREE.Object3D(),tint=new THREE.Color();
for(let i=0;i<list.length;i++){
const it=list[i];
const y=groundY?groundY(it.x,it.z)||0:0;
dummy.position.set(it.x,y,it.z);
dummy.rotation.set(0,it.yaw||0,0);
dummy.scale.setScalar(it.scale||1);
dummy.updateMatrix();
im.setMatrixAt(i,dummy.matrix);
}
im.instanceMatrix.needsUpdate=true;
if(im.instanceColor)im.instanceColor.needsUpdate=true;
im.castShadow=!!pt.solid;im.receiveShadow=!!pt.solid;im.frustumCulled=false;
if(!pt.solid)im.userData.surface=1;
im.userData.tbProp=kit;
group.add(im);
});
});
}
function collect(payload,meters){
const origin=payload.area&&payload.area.innerOrigin||{x:0,y:0};
const items=[];
(payload.props||[]).forEach(function(p){
if(!p||!isFinite(+p.x))return;
const kit=resolveKit(p);
const spec=specOf(kit);
if(!spec)return;
const loc=localOf(p,origin,meters);
items.push({kit:kit,x:loc.x,z:loc.z,yaw:yawOf(p,spec),scale:scaleOf(p,spec)});
});
(payload.zones||[]).forEach(function(z){
if(!z||z.kind!=="wagon_yard"||!z.slots)return;
z.slots.forEach(function(slot){
if(!slot||!isFinite(+slot.x))return;
slotItems(slot,origin,meters).forEach(function(it){items.push(it);});
});
});
(payload.minigameSlots||[]).forEach(function(s){
if(!s||!isFinite(+s.x))return;
let kit=s.host&&s.host.kit;
if(!kit||String(kit).indexOf("host_")!==0)return;
if(kit==="prop_hitching_rail_3m")kit="prop_fence_split_rail_3m";
const loc=localOf(s,origin,meters);
if(nearKit(items,kit,loc.x,loc.z,0.75))return;
const spec=specOf(kit);
items.push({kit:kit,x:loc.x,z:loc.z,yaw:yawOf(s,spec),scale:1});
});
return budget(items);
}
function place(parent,groundY,payload,meters){
if(!parent||typeof THREE==="undefined")return null;
const group=new THREE.Group();
group.name="tb-area-props";
scatter(group,collect(payload||{},meters||1),groundY);
parent.add(group);
return group;
}
function stamp(parent,kit,x,z,yaw,groundY){
if(!parent||typeof THREE==="undefined"||!specOf(kit))return null;
const group=new THREE.Group();
group.name="tb-prop-"+kit;
scatter(group,[{kit:kit,x:x,z:z,yaw:yaw||0,scale:1}],groundY);
parent.add(group);
return group;
}
window.TBProps={
place:place,stamp:stamp,scatter:scatter,collect:collect,specOf:specOf,resolveKit:resolveKit,
partsFor:partsFor,plazaOf:plazaOf,familyMaterial:familyMaterial,colorOf:colorOf,shade:shade,slotItems:slotItems,
HOST:HOST,LEGACY:LEGACY
};
})();
