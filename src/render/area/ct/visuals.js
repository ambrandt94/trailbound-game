/* Ported from trailbound-controller (deployed main). ESM, behaviour-faithful.
   Not typechecked: a full TS conversion of these files would stall the port.
   three r187: colorSpace, colorspace_fragment, per-fragment Lambert cel, asset root.
*/
import { THREE } from './three-runtime.js';
/* Live look controls. Stored in localStorage under tbVisuals, separate from tb3d.
   The panel is UI only: it never listens for WASD unless a slider inside it is focused,
   and then the key stops there so the game keeps moving when the panel is unfocused. */
(function(){
const $=s=>document.querySelector(s);
const AZ0=-7.5*Math.PI/180, ELMAX=38.28418027129749*Math.PI/180, SUNR=47.34976240700686;
const FACTORY={
px:2, pixelFilter:1, posterize:0,
outline:1, outlineThick:1, outlineDark:1, outlineBlack:0, depthEdge:0.02, normalEdge:2,
sunIntensity:1.15, sunHour:9.5, sunWarmth:0, hemi:0.58, shadeCool:1, shadeSteps:4, shadows:1, shadowSoft:1,
litDither:1, litPat:0, litEdge:0.06, litStrength:0.6, shHue:20,
sat:1, contrast:1, bright:1, gamma:1, hue:0, grass:"#ffffff",
fog:1, haze:"#c3e5f9", skyTop:"#61a0f9", skyHor:"#b1dcfd", clouds:1,
texel:1, dither:0, oldTiles:0,
camFov:24, camDist:60, camPitch:50,
scatter:1, flower:0.2, wind:0,
fps:0, heightDebug:0, heightContour:0
};
const EXACT={
"#c3e5f9":[0.20,0.45,0.85],
"#61a0f9":[0.12,0.36,0.95],
"#b1dcfd":[0.20,0.45,0.85],
"#ffffff":[1,1,1]
};
let v=Object.assign({}, FACTORY);
let hadSave=false, open=false;
try{
const s=JSON.parse(localStorage.getItem("tbVisuals")||"null");
if(s&&s.v){hadSave=true;Object.keys(FACTORY).forEach(k=>{if(s.v[k]!=null)v[k]=s.v[k]});open=!!s.open}
}catch(e){}
try{
const dbg=(new URLSearchParams(location.search).get("debug")||"").split(/[,\s]+/);
if(dbg.indexOf("height")>=0){v.heightDebug=1;if(dbg.indexOf("contour")>=0)v.heightContour=1;}
}catch(e){}
let ctx=null, inputs=[], shadowDirty=false;
const SUN0=new THREE.Vector3(-.62,.78,.55);
const FROM=new THREE.Vector3(-27,28,27).normalize();
const _q=new THREE.Quaternion();

function trim(n){const x=+n;if(!isFinite(x))return "";if(Math.abs(x-Math.round(x))<1e-6)return String(Math.round(x));return String(Math.round(x*1000)/1000)}
function lin(hex){
const h=String(hex||"").toLowerCase();
const hit=EXACT[h];
if(hit)return {r:hit[0],g:hit[1],b:hit[2]};
const n=parseInt(h.replace("#",""),16);
if(!isFinite(n))return {r:1,g:1,b:1};
const e=1/0.4545, r=((n>>16)&255)/255, g=((n>>8)&255)/255, b=(n&255)/255;
return {r:Math.pow(r,e), g:Math.pow(g,e), b:Math.pow(b,e)};
}
function hourLabel(h){
const name=h<5?"night":h<8?"dawn":h<11?"morning":h<14?"midday":h<17?"afternoon":h<20?"evening":"night";
return trim(h)+" "+name;
}
function sunOffset(){
if(Math.abs(v.sunHour-9.5)<0.001)return {x:-27,y:28,z:27};
const t=v.sunHour/24, az=t*Math.PI*2+AZ0, el=Math.sin(t*Math.PI)*ELMAX;
return {x:Math.cos(az)*Math.cos(el)*SUNR, y:Math.sin(el)*SUNR, z:Math.sin(az)*Math.cos(el)*SUNR};
}
function skySun(){
if(Math.abs(v.sunHour-9.5)<0.001)return SUN0.clone();
const o=sunOffset(), d=new THREE.Vector3(o.x,o.y,o.z).normalize();
_q.setFromUnitVectors(FROM, d);
return SUN0.clone().applyQuaternion(_q);
}
function warmColor(w){
const c=new THREE.Color(0xfff0c8);
if(w>0)c.lerp(new THREE.Color(0xffb060), Math.min(1,w));
else if(w<0)c.lerp(new THREE.Color(0xd0e6ff), Math.min(1,-w));
return c;
}
function coolGround(c){
const g=new THREE.Color(0x9eb8c4);
if(c>1)g.lerp(new THREE.Color(0x7aa4dc), Math.min(1,c-1));
else if(c<1)g.lerp(new THREE.Color(0xc8c0b4), Math.min(1,1-c));
return g;
}
function save(){
try{localStorage.setItem("tbVisuals", JSON.stringify({v:v, open:panel.classList.contains("on")}))}catch(e){}
}
function snapshot(){
const o={_key:"tbVisuals"};
Object.keys(FACTORY).forEach(k=>{o[k]=v[k]});
if(ctx&&ctx.P){o.px=ctx.P.px;o.camFov=ctx.P.camFov;o.camDist=ctx.P.camDist;o.camPitch=ctx.P.camPitch}
return o;
}
function applySky(){
const u=window.TBTiles&&TBTiles.skyUniforms&&TBTiles.skyUniforms();
if(u){
const z=lin(v.skyTop), h=lin(v.skyHor);
u.uZen.value.set(z.r,z.g,z.b);
u.uHor.value.set(h.r,h.g,h.b);
u.uSun.value.copy(skySun());
}
if(window.TBTiles&&TBTiles.setClouds)TBTiles.setClouds(v.clouds);
}
function applyWorld(){
if(window.TBTiles){
if(TBTiles.setFlowerRate)TBTiles.setFlowerRate(v.flower);
if(TBTiles.setOldTiles)TBTiles.setOldTiles(!!v.oldTiles);
if(TBTiles.setWind)TBTiles.setWind(v.wind);
if(TBTiles.shade){
TBTiles.shade.uSteps.value=+v.shadeSteps||4;
TBTiles.shade.uCool.value=+v.shadeCool;
TBTiles.shade.uTexel.value=+v.texel||1;
TBTiles.shade.uDithOn.value=v.litDither?1:0;
TBTiles.shade.uPat.value=v.litPat?1:0;
TBTiles.shade.uEdge.value=+v.litEdge||0.06;
TBTiles.shade.uStrength.value=+v.litStrength;
TBTiles.shade.uShHue.value=+v.shHue||20;
TBTiles.shade.uPix.value=1;
TBTiles.shade.uHemi.value=+v.hemi;
const g=lin(v.grass);
TBTiles.shade.uGrass.value.set(g.r,g.g,g.b);
}
}
applySky();
if(window.TBWorld&&TBWorld.applyScatter)TBWorld.applyScatter(+v.scatter, +v.flower);
applyHeight();
}
function applyHeight(){
if(!window.TBTiles||!TBTiles.setHeightDebug)return;
const span=window.TBArea&&TBArea.heightSpan?TBArea.heightSpan():null;
TBTiles.setHeightDebug(!!v.heightDebug, !!v.heightContour, span);
}
function applyShadow(){
if(!ctx)return;
const def=!!v.shadows&&Math.abs(v.shadowSoft-1)<1e-6;
ctx.sun.castShadow=!!v.shadows;
if(def){
if(shadowDirty){ctx.R.shadowMap.type=THREE.PCFShadowMap;ctx.sun.shadow.radius=1;ctx.R.shadowMap.needsUpdate=true;shadowDirty=false}
return;
}
shadowDirty=true;
ctx.R.shadowMap.type=(v.shadowSoft<0.15)?THREE.BasicShadowMap:THREE.PCFShadowMap;
ctx.sun.shadow.radius=Math.max(0.001, +v.shadowSoft||0);
ctx.R.shadowMap.needsUpdate=true;
}
function applyCam(){
if(!ctx)return;
ctx.setCam("px", v.px);
ctx.setCam("camFov", v.camFov);
ctx.setCam("camDist", v.camDist);
ctx.setCam("camPitch", v.camPitch);
}
function applyLook(){
if(!ctx)return;
const U=ctx.U;
U.poster.value=+v.posterize||0;
U.ol.value=v.outline?1:0;
U.olT.value=+v.outlineThick||1;
U.olD.value=+v.outlineDark;
U.olK.value=v.outlineBlack?1:0;
U.olZ.value=+v.depthEdge;
U.olN.value=+v.normalEdge;
U.sat.value=+v.sat;
U.con.value=+v.contrast;
U.bri.value=+v.bright;
U.gam.value=+v.gamma;
U.hue.value=+v.hue;
U.dith.value=+v.dither||0;
const legacy=Math.PI;
ctx.sun.intensity=(+v.sunIntensity)*legacy;
ctx.sun.color.copy(warmColor(+v.sunWarmth||0));
ctx.hemi.intensity=(+v.hemi)*legacy;
if(window.TBTiles&&TBTiles.shade){
const sc=ctx.sun.color,mx=Math.max(sc.r,sc.g,sc.b,1e-4);
TBTiles.shade.uSunCol.value.set(sc.r/mx,sc.g/mx,sc.b/mx);
TBTiles.shade.uSunI.value=+v.sunIntensity;
TBTiles.shade.uLit.value=Math.PI*legacy*mx*Math.max(0,+v.sunIntensity);
}
ctx.hemi.groundColor.copy(coolGround(+v.shadeCool));
const hz=lin(v.haze);
ctx.BGO.setRGB(hz.r,hz.g,hz.b);
applyShadow();
applyWorld();
}
function commit(cam){
save();
applyLook();
if(cam)applyCam();
}
function refresh(){inputs.forEach(i=>i.show())}

const panel=document.createElement("div");
panel.id="viz";
panel.innerHTML='<div class="vh"><b>Visuals</b><button type="button" id="vizx">Hide</button></div>';
const body=document.createElement("div");
panel.appendChild(body);
function section(title){
const d=document.createElement("details");
d.open=true;
const s=document.createElement("summary");
s.textContent=title;
d.appendChild(s);
body.appendChild(d);
return d;
}
function slider(parent, key, label, min, max, step, fmt){
const r=document.createElement("label");
r.className="row";
r.innerHTML="<span>"+label+"</span><output></output><input type=range min="+min+" max="+max+" step="+step+">";
const i=r.querySelector("input"), o=r.querySelector("output");
i.dataset.k=key;
const show=()=>{i.value=v[key];o.textContent=fmt?fmt(v[key]):trim(v[key])};
i.addEventListener("input", ()=>{v[key]=+i.value;o.textContent=fmt?fmt(v[key]):trim(v[key]);commit(key==="px"||key==="camFov"||key==="camDist"||key==="camPitch")});
parent.appendChild(r);
inputs.push({key:key, show:show, el:i});
show();
}
function toggle(parent, key, label){
const l=document.createElement("label");
l.innerHTML="<input type=checkbox> "+label;
const i=l.querySelector("input");
const show=()=>{i.checked=!!v[key]};
i.addEventListener("input", ()=>{v[key]=i.checked?1:0;commit(false)});
parent.appendChild(l);
inputs.push({key:key, show:show, el:i});
show();
}
function color(parent, key, label){
const r=document.createElement("label");
r.className="row";
r.innerHTML="<span>"+label+"</span><output></output><input type=color>";
const i=r.querySelector("input"), o=r.querySelector("output");
const show=()=>{i.value=v[key];o.textContent=v[key]};
i.addEventListener("input", ()=>{v[key]=i.value;o.textContent=i.value;commit(false)});
parent.appendChild(r);
inputs.push({key:key, show:show, el:i});
show();
}
function toggles(parent){const g=document.createElement("div");g.className="tg";parent.appendChild(g);return g}
function choice(parent, key, label, pairs){
const r=document.createElement("label");
r.className="row";
r.innerHTML="<span>"+label+"</span><output></output><select></select>";
const i=r.querySelector("select"), o=r.querySelector("output");
pairs.forEach(function(p){const op=document.createElement("option");op.value=p[0];op.textContent=p[1];i.appendChild(op);});
i.dataset.k=key;
const show=function(){i.value=String(v[key]);const hit=pairs.filter(function(p){return String(p[0])===String(v[key])})[0];o.textContent=hit?hit[1]:i.value;};
i.addEventListener("input", function(){v[key]=+i.value;show();commit(false);});
parent.appendChild(r);
inputs.push({key:key, show:show, el:i});
show();
}

const pix=section("Pixelation");
slider(pix, "px", "Pixel scale (render ÷)", 1, 5, 1);
toggle(toggles(pix), "pixelFilter", "Crisp pixel filter");
slider(pix, "posterize", "Posterize levels (0 off)", 0, 16, 1);

const out=section("Outlines");
toggle(toggles(out), "outline", "Outlines");
slider(out, "outlineThick", "Thickness", 0.5, 6, 0.5);
slider(out, "outlineDark", "Darkness", 0, 1, 0.05);
toggle(toggles(out), "outlineBlack", "Black ink (off = object tint)");
slider(out, "depthEdge", "Depth edge", 0.001, 0.2, 0.001);
slider(out, "normalEdge", "Normal edge (2 off)", 0.05, 2, 0.05);

const lit=section("Lighting");
slider(lit, "sunIntensity", "Sun intensity", 0, 3, 0.05);
slider(lit, "sunHour", "Sun angle (time of day)", 0, 24, 0.1, hourLabel);
slider(lit, "sunWarmth", "Sun warmth", -1, 1, 0.05);
slider(lit, "hemi", "Hemisphere", 0, 2, 0.02);
slider(lit, "shadeCool", "Shadow coolness", 0, 2, 0.05);
slider(lit, "shadeSteps", "Shade steps", 1, 8, 1);
toggle(toggles(lit), "shadows", "Shadows");
slider(lit, "shadowSoft", "Shadow softness", 0, 4, 0.1);
toggle(toggles(lit), "litDither", "Lighting dither");
choice(lit, "litPat", "Pattern", [[0,"Bayer 4×4"],[1,"Chunky 2×2"]]);
slider(lit, "litEdge", "Edge width", 0.02, 0.15, 0.005);
slider(lit, "litStrength", "Dither strength", 0, 1, 0.05);
slider(lit, "shHue", "Shadow hue °", 15, 25, 1);

const grade=section("Color grading");
slider(grade, "sat", "Saturation", 0, 2, 0.05);
slider(grade, "contrast", "Contrast", 0.5, 2, 0.05);
slider(grade, "bright", "Brightness", 0.4, 2, 0.05);
slider(grade, "gamma", "Gamma (1 = now)", 0.4, 2.2, 0.05);
slider(grade, "hue", "Hue shift °", -180, 180, 1);
color(grade, "grass", "Grass tint");

const atmo=section("Atmosphere");
slider(atmo, "fog", "Fog density", 0, 3, 0.05);
color(atmo, "haze", "Haze tint");
color(atmo, "skyTop", "Sky top");
color(atmo, "skyHor", "Sky horizon");
slider(atmo, "clouds", "Cloud density", 0, 1, 0.05);

const tex=section("Textures");
slider(tex, "texel", "Texel density", 0.5, 3, 0.05);
slider(tex, "dither", "Dither (0 off)", 0, 0.35, 0.01);
toggle(toggles(tex), "oldTiles", "Old nature textures");

const cam=section("Camera");
slider(cam, "camFov", "FOV", 15, 75, 1);
slider(cam, "camDist", "Distance", 2, 80, 0.5);
slider(cam, "camPitch", "Pitch °", -5, 85, 1);

const world=section("World");
slider(world, "scatter", "Foliage & scatter", 0, 1, 0.05);
slider(world, "flower", "Flower rate", 0, 1, 0.02);
slider(world, "wind", "Wind sway", 0, 1, 0.05);

const dbg=section("Debug");
toggle(toggles(dbg), "fps", "FPS counter");
toggle(toggles(dbg), "heightDebug", "Height tint");
toggle(toggles(dbg), "heightContour", "Contour lines");
const heightHint=document.createElement("p");
heightHint.className="hint";
heightHint.textContent="Height tint colours the ground by elevation (teal low, gold high). Contours are optional. Both start off. ?debug=height or ?debug=height,contour.";
dbg.appendChild(heightHint);
const bar=document.createElement("div");
bar.className="tg";
const reset=document.createElement("button");
reset.type="button";reset.textContent="Reset to defaults";
const copy=document.createElement("button");
copy.type="button";copy.textContent="Copy settings JSON";
bar.appendChild(reset);bar.appendChild(copy);dbg.appendChild(bar);
const hint=document.createElement("p");
hint.className="hint";
hint.textContent="Saved in this browser as tbVisuals. Reset restores the shipped look.";
body.appendChild(hint);

reset.addEventListener("click", ()=>{
Object.keys(FACTORY).forEach(k=>{v[k]=FACTORY[k]});
refresh();
commit(true);
});
copy.addEventListener("click", async ()=>{
const text=JSON.stringify(snapshot(), null, 2);
try{await navigator.clipboard.writeText(text);copy.textContent="Copied ✓"}
catch(e){
const ta=document.createElement("textarea");
ta.value=text;document.body.appendChild(ta);ta.select();
try{document.execCommand("copy");copy.textContent="Copied ✓"}catch(e2){copy.textContent="Copy blocked"}
ta.remove();
}
setTimeout(()=>{copy.textContent="Copy settings JSON"}, 1200);
});

const wrap=$(".wrap");
if(wrap)wrap.appendChild(panel);
const fpsEl=document.createElement("div");
fpsEl.id="fps";fpsEl.hidden=true;
if(wrap)wrap.appendChild(fpsEl);
const vb=$(".vbar");
const vbBtn=document.createElement("button");
vbBtn.id="vizb";vbBtn.type="button";vbBtn.title="Show visuals";vbBtn.textContent="Visuals";
if(vb)vb.insertBefore(vbBtn, vb.firstChild);
function setOpen(on){panel.classList.toggle("on", on);save()}
vbBtn.addEventListener("click", ()=>{setOpen(!panel.classList.contains("on"));vbBtn.blur()});
panel.querySelector("#vizx").addEventListener("click", ()=>{setOpen(false)});
panel.addEventListener("click", e=>{if(e.target.tagName==="BUTTON")e.target.blur()});
panel.addEventListener("keydown", e=>{const t=e.target;if(t&&(t.tagName==="INPUT"||t.tagName==="SELECT"||t.tagName==="TEXTAREA"))e.stopPropagation()});
panel.addEventListener("keyup", e=>{const t=e.target;if(t&&(t.tagName==="INPUT"||t.tagName==="SELECT"||t.tagName==="TEXTAREA"))e.stopPropagation()});
if(open)panel.classList.add("on");

let fpsPrev=0;
function frame(){
if(ctx&&ctx.P){
const a=document.activeElement;
["px","camFov","camDist","camPitch"].forEach(k=>{
if(a&&a.dataset&&a.dataset.k===k)return;
const live=+ctx.P[k];
if(Math.abs(live-v[k])>0.001){v[k]=live;const inp=inputs.find(i=>i.key===k);if(inp)inp.show()}
});
}
if(!v.fps){fpsEl.hidden=true;fpsPrev=0;return}
fpsEl.hidden=false;
const now=performance.now();
if(fpsPrev){const dt=now-fpsPrev;if(dt>0)fpsEl.textContent=Math.round(1000/dt)+" fps"}
fpsPrev=now;
}
function mount(c){
ctx=c;
if(!hadSave){v.px=c.P.px;v.camFov=c.P.camFov;v.camDist=c.P.camDist;v.camPitch=c.P.camPitch;refresh()}
applyLook();
if(hadSave)applyCam();
}
/* Apply look values without saving, e.g. the light lab lever. A reload brings back the saved set. */
function preview(o){Object.assign(v,o);refresh();applyWorld()}
window.TBVisuals={v:v, mount:mount, preview:preview, frame:frame, sunOffset:sunOffset, applySky:applySky, worldReady:applyWorld};
})();
