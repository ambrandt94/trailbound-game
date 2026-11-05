/* Ported from trailbound-controller (deployed main). ESM, behaviour-faithful.
   Not typechecked: a full TS conversion of these files would stall the port.
   three r187: colorSpace, colorspace_fragment, per-fragment Lambert cel, asset root.
*/
import { THREE } from './three-runtime.js';
/* Hand-drawn tiles_v3 plus the authored building set.
   Terrain is 48 px over 3 m (16 texels/m). The atlas is nearest and unmipped
   so cells do not bleed; mips live on the baked ground chunk. Steep banks
   project rock_slab at the same 16 texels/m. */
(function(){
function tbCanvas(){
if(typeof window!=="undefined"&&window.TBRenderer&&window.TBRenderer.domElement)return window.TBRenderer.domElement;
if(typeof document!=="undefined"&&document.getElementById)return document.getElementById("c");
return null;
}

const TB_ROOT=(import.meta.env&&import.meta.env.BASE_URL?import.meta.env.BASE_URL:'./')+'assets/';
const CELL=3, TPM=16, K=TPM/48, KR=16/64;
let GRASS=[["v0",.18],["v1",.18],["v2",.16],["v3",.14],["v4",.14],["f0",.10],["f1",.10]];
let flowerRate=.2;
const TILES=["terrain_grass_v0_48","terrain_grass_v1_48","terrain_grass_v2_48","terrain_grass_v3_48","terrain_grass_v4_48","terrain_grass_f0_48","terrain_grass_f1_48","terrain_dirt_path_48","terrain_edge_N_48","terrain_edge_S_48","terrain_edge_W_48","terrain_edge_E_48","terrain_edge_inner_NW_48","terrain_edge_inner_NE_48","terrain_edge_inner_SE_48","terrain_edge_inner_SW_48","terrain_edge_outer_NW_48","terrain_edge_outer_NE_48","terrain_edge_outer_SE_48","terrain_edge_outer_SW_48","terrain_road_sandstone_48"];
const EDGE={12:8,3:9,9:10,6:11,8:12,4:13,2:14,1:15,7:16,11:17,13:18,14:19};
const blocks=[];

function hash01(cx,cy,seed){
let h=(Math.imul(cx|0,73856093)^Math.imul(cy|0,19349663)^Math.imul((seed||0)|0,83492791))>>>0;
h=Math.imul(h^(h>>>13),1274126177)>>>0;
return (h&0xFFFF)/65536;
}
function grassPick(cx,cy,seed){
const r=hash01(cx,cy,seed);let a=0;
for(let i=0;i<GRASS.length;i++){a+=GRASS[i][1];if(r<a)return i;}
return 0;
}
function crisp(t){
t.magFilter=THREE.NearestFilter;t.minFilter=THREE.NearestFilter;
t.generateMipmaps=false;t.anisotropy=1;
t.wrapS=t.wrapT=THREE.RepeatWrapping;
t.colorSpace=THREE.SRGBColorSpace;
t.needsUpdate=true;return t;
}
/* Same number three's renderer.capabilities.getMaxAnisotropy() reads. */
function maxAniso(){
if(typeof document==="undefined"||typeof document.getElementById!=="function")return 1;
const c=tbCanvas();
if(!c)return 1;
const gl=c.getContext("webgl2")||c.getContext("webgl");
if(!gl)return 1;
const ext=gl.getExtension("EXT_texture_filter_anisotropic")||gl.getExtension("WEBKIT_EXT_texture_filter_anisotropic");
if(!ext)return 1;
const n=gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT)||1;
return n>1?n:1;
}
const anisoQueue=[];
function queueAniso(t){
if(!t||anisoQueue.indexOf(t)>=0)return;
anisoQueue.push(t);
function kick(){
const a=maxAniso();
for(let i=0;i<anisoQueue.length;i++){
const tex=anisoQueue[i];
if(tex.anisotropy!==a){tex.anisotropy=a;tex.needsUpdate=true;}
}
}
if(typeof requestAnimationFrame==="function")requestAnimationFrame(kick);
else kick();
}
/* A repeating prop or ground tile (power-of-two, not an atlas). Nearest up
   close, nearest-mipmap so the far side stops sparkling. */
function groundRepeat(t){
t.magFilter=THREE.NearestFilter;
t.minFilter=THREE.NearestMipmapLinearFilter;
t.generateMipmaps=true;
t.wrapS=t.wrapT=THREE.RepeatWrapping;
t.anisotropy=1;
t.needsUpdate=true;
queueAniso(t);
return t;
}
function loadTex(url,hex){
const c=document.createElement("canvas");c.width=c.height=2;
const g=c.getContext("2d");g.fillStyle=hex||"#8a8a8a";g.fillRect(0,0,2,2);
const t=new THREE.CanvasTexture(c);crisp(t);
const img=new Image();img.onload=function(){t.image=img;t.needsUpdate=true;kickBake();};img.src=url;return t;
}
function plain(map){
const m=new THREE.MeshLambertMaterial({map:map||null,color:0xffffff});
m.toneMapped=false;m.polygonOffset=true;m.polygonOffsetFactor=-1;m.polygonOffsetUnits=-1;return m;
}
/* Water, foam and the arch show the painted ramp as-is. Lambert was turning a bad normal into pure black. */
function unlit(map){
const m=new THREE.MeshBasicMaterial({map:map||null,color:0xffffff});
m.toneMapped=false;m.polygonOffset=true;m.polygonOffsetFactor=-1;m.polygonOffsetUnits=-1;
m.onBeforeCompile=function(sh){
sh.uniforms.uTexel=SHADE.uTexel;
if(sh.fragmentShader.indexOf("uniform float uTexel;")<0)sh.fragmentShader="uniform float uTexel;\n"+sh.fragmentShader;
sh.fragmentShader=sh.fragmentShader.replace("#include <map_fragment>",MAP_UV);
};
m.needsUpdate=true;return m;
}
function lambert(map,opt){
opt=opt||{};
const m=new THREE.MeshLambertMaterial({map:map||null,color:0xffffff,transparent:!!opt.transparent,alphaTest:opt.alphaTest||0,side:opt.side||THREE.FrontSide,depthWrite:opt.depthWrite!==false});
m.toneMapped=false;
if(opt.polygonOffset){m.polygonOffset=true;m.polygonOffsetFactor=-2;m.polygonOffsetUnits=-2;}
cel(m);return m;
}
/* Lighting bands from N·L, then an ordered Bayer mix only on the step between
   two neighbours. The texture is the albedo; it is never dithered.
   Four steps use N·L 0.0 / 0.30 / 0.80 (shadow, lowlight, base, highlight).
   The scene target is already the low-res buffer, so uPix stays 1 and the
   Bayer cell is one render pixel: floor(gl_FragCoord.xy / uPix). */
const SHADE={
uSteps:{value:4},
uCool:{value:1},
uTexel:{value:1},
uGrass:{value:new THREE.Vector3(1,1,1)},
uDithOn:{value:1},
uPat:{value:0},
uEdge:{value:0.06},
uStrength:{value:0.6},
uShHue:{value:20},
uPix:{value:1},
uLit:{value:Math.PI*1.15},
uSunI:{value:1.15},
uHemi:{value:0.58},
uSunCol:{value:new THREE.Vector3(1,0.941,0.784)}
};
const BAYER_LIB=[
"float tbM2(vec2 p){",
"float x=mod(floor(p.x),2.0);float y=mod(floor(p.y),2.0);",
"if(y<1.0)return x<1.0?0.0:2.0;",
"return x<1.0?3.0:1.0;",
"}",
"float tbBayer4(vec2 p){vec2 f=floor(p);return (4.0*tbM2(f)+tbM2(f*0.5)+0.5)/16.0;}",
"float tbBayer2(vec2 p){return (tbM2(p)+0.5)/4.0;}",
"float tbBayer(vec2 frag){vec2 q=floor(frag/max(uPix,1.0));return uPat>0.5?tbBayer2(q):tbBayer4(q);}",
"float tbEdge(float nl,float boundary,float bayer,float w){",
"if(w<0.0001)return nl>boundary?1.0:0.0;",
"float t=boundary<=0.001?clamp(nl/w,0.0,1.0):clamp((nl-(boundary-w*0.5))/w,0.0,1.0);",
"return bayer<t?1.0:0.0;",
"}"
].join("\n");
const BAND_LIB=[
"vec3 tbRGB2HSV(vec3 c){",
"vec4 K=vec4(0.0,-1.0/3.0,2.0/3.0,-1.0);",
"vec4 p=mix(vec4(c.bg,K.wz),vec4(c.gb,K.xy),step(c.b,c.g));",
"vec4 q=mix(vec4(p.xyw,c.r),vec4(c.r,p.yzx),step(p.x,c.r));",
"float d=q.x-min(q.w,q.y);float e=1.0e-10;",
"return vec3(abs(q.z+(q.w-q.y)/(6.0*d+e)),d/(q.x+e),q.x);",
"}",
"vec3 tbHSV2RGB(vec3 c){",
"vec4 K=vec4(1.0,2.0/3.0,1.0/3.0,3.0);",
"vec3 p=abs(fract(c.xxx+K.xyz)*6.0-K.www);",
"return c.z*mix(K.xxx,clamp(p-K.xxx,0.0,1.0),c.y);",
"}",
"vec3 tbToward(vec3 rgb,float target,float deg,float satMul,float valMul,float capV){",
"vec3 h=tbRGB2HSV(rgb);",
"float d=fract(target-h.x+0.5)-0.5;",
"float m=max(deg,0.0)/360.0;",
"h.x=fract(h.x+clamp(d,-m,m));",
"h.y=clamp(h.y*satMul,0.0,1.0);",
"h.z=min(max(h.z*valMul,0.12),capV);",
"return tbHSV2RGB(h);",
"}",
"vec3 tbBandCol(vec3 alb,float band,float steps){",
"float b=clamp(band,0.0,max(steps-1.0,0.0));",
"float hue=uShHue*clamp(uCool,0.0,2.0);",
"vec3 sh=tbToward(alb,0.72,hue,1.08,0.72,1.0);",
"vec3 lo=tbToward(alb,0.72,0.0,1.0,0.84,1.0);",
"vec3 hi=tbToward(alb,0.125,10.0,1.0,1.18,0.94);",
"if(steps<1.5)return alb;",
"if(abs(steps-4.0)<0.1){",
"if(b<0.5)return sh;if(b<1.5)return lo;if(b<2.5)return alb;return hi;",
"}",
"float u=b/max(steps-1.0,1.0);",
"if(u<0.34)return mix(sh,lo,u/0.34);",
"if(u<0.67)return mix(lo,alb,(u-0.34)/0.33);",
"return mix(alb,hi,clamp((u-0.67)/0.33,0.0,1.0));",
"}"
].join("\n");
const CEL=[
"vec3 _lf=vec3(0.0);",
"#if NUM_DIR_LIGHTS > 0",
"for(int _li=0;_li<NUM_DIR_LIGHTS;_li++){",
"_lf+=directionalLights[_li].color*saturate(dot(geometryNormal,directionalLights[_li].direction));",
"}",
"#endif",
"float _mag=max(_lf.r,max(_lf.g,_lf.b));",
"float _nl=uLit<0.01?0.0:_mag/uLit;",
"float _steps=clamp(floor(uSteps+0.5),1.0,8.0);",
"float _bay=tbBayer(gl_FragCoord.xy);",
"float _w=uDithOn>0.5?uEdge*clamp(uStrength,0.0,1.0):0.0;",
"float _band=0.0;",
"if(_steps>=1.5){",
"if(abs(_steps-4.0)<0.1){",
"_band+=tbEdge(_nl,0.0,_bay,_w);",
"_band+=tbEdge(_nl,0.30,_bay,_w);",
"_band+=tbEdge(_nl,0.80,_bay,_w);",
"}else{",
"for(int _i=1;_i<8;_i++){if(float(_i)>=_steps)break;_band+=tbEdge(_nl,float(_i)/_steps,_bay,_w);}",
"}",
"}",
"float _mask=1.0;",
"float _drop=max(_band-1.0,0.0);",
"float _keep=1.0;",
"if(_w<0.0001){_keep=_mask>=0.5?1.0:0.0;}",
"else if(_mask>=0.62)_keep=1.0;",
"else if(_mask<=0.38)_keep=0.0;",
"else{_keep=_bay<clamp((_mask-0.38)/0.24,0.0,1.0)?1.0:0.0;}",
"_band=mix(_drop,_band,_keep);",
"vec3 _alb=diffuseColor.rgb;",
"vec3 _col=tbBandCol(_alb,_band,_steps);",
"_col*=uSunCol*max(uSunI,0.0)/1.15;",
"_col+=_alb*uHemi*0.18;",
"_col=min(_col,vec3(0.96));",
"float _mx=max(_col.r,max(_col.g,_col.b));",
"if(_mx<0.08)_col*=0.08/max(_mx,0.001);",
"reflectedLight.indirectDiffuse=vec3(0.0);",
"reflectedLight.directDiffuse=_col;"
].join("\n");
const SHADE_DECL="uniform float uDithOn;\nuniform float uPat;\nuniform float uEdge;\nuniform float uStrength;\nuniform float uShHue;\nuniform float uPix;\nuniform float uLit;\nuniform float uSunI;\nuniform float uHemi;\nuniform vec3 uSunCol;\n";
/* N·L bands and the cast-shadow edge. Fog and water depth already dither in the
   last fifth of a wide band, so this pass leaves #include <fog_fragment> alone. */
function patchLighting(fs){
if(fs.indexOf("uniform float uDithOn;")<0)fs=SHADE_DECL+fs;
if(fs.indexOf("float tbM2")<0)fs=fs.replace("void main()","\n"+BAYER_LIB+"\n"+BAND_LIB+"\nvoid main()");
const mul=/reflectedLight\.directDiffuse\s*\*=\s*BRDF_Diffuse_Lambert\(\s*diffuseColor\.rgb\s*\)\s*\*\s*getShadowMask\(\)\s*;/;
if(mul.test(fs))fs=fs.replace(mul,CEL);
else if(fs.indexOf("#include <lights_fragment_end>")>=0&&fs.indexOf("float _nl=uLit")<0){
fs=fs.replace("#include <lights_fragment_end>","#include <lights_fragment_end>\n"+CEL);
}
else if(typeof console!=="undefined")console.warn("trail cel: shadow multiply missing");
return fs;
}
const MAP_UV=["#ifdef USE_MAP","vec4 texelColor=texture2D(map,vMapUv*uTexel);","texelColor=(texelColor);","diffuseColor*=texelColor;","#endif"].join("\n");
function bindShade(sh){
sh.uniforms.uSteps=SHADE.uSteps;
sh.uniforms.uCool=SHADE.uCool;
sh.uniforms.uTexel=SHADE.uTexel;
sh.uniforms.uDithOn=SHADE.uDithOn;
sh.uniforms.uPat=SHADE.uPat;
sh.uniforms.uEdge=SHADE.uEdge;
sh.uniforms.uStrength=SHADE.uStrength;
sh.uniforms.uShHue=SHADE.uShHue;
sh.uniforms.uPix=SHADE.uPix;
sh.uniforms.uLit=SHADE.uLit;
sh.uniforms.uSunI=SHADE.uSunI;
sh.uniforms.uHemi=SHADE.uHemi;
sh.uniforms.uSunCol=SHADE.uSunCol;
}
function cel(m){
const prev=m.onBeforeCompile;
m.onBeforeCompile=function(sh){
if(prev)prev(sh);
bindShade(sh);
let fs=sh.fragmentShader;
if(fs.indexOf("uniform float uSteps;")<0)fs="uniform float uSteps;\nuniform float uCool;\nuniform float uTexel;\n"+fs;
sh.fragmentShader=patchLighting(fs.replace("#include <map_fragment>",MAP_UV));
};
m.needsUpdate=true;
}

const T={};
function authored(name,hex,opt){opt=opt||{};const t=loadTex(TB_ROOT+"textures/tiles_v3/authored/"+name,hex);if(opt.alpha)t.premultiplyAlpha=false;if(opt.clamp)t.wrapS=t.wrapT=THREE.ClampToEdgeWrapping;return t;}
T.plaster=authored("plaster_32.png","#f3dcba");
T.timber=authored("timber_32.png","#5c3a22");
T.clay=authored("roof_clay_32.png","#c46a3a");
T.slate=authored("roof_slate_32.png","#6a7c8c");
T.stone=authored("stone_block_32.png","#8a8e90");
T.cobble=authored("cobble_32.png","#a89880");
T.water=authored("water_32.png","#3a8fd0");
T.foam=authored("foam_32.png","#e8f4f6");
T.awning=authored("awning_32.png","#e8c8a0");
T.awningB=authored("awning_blue_32.png","#d0d4dc");
T.adobe=authored("adobe_32.png","#c49660");
T.pot=authored("pot_32.png","#b06040");
T.apple=authored("produce_apple_32.png","#c05040");
T.green=authored("produce_green_32.png","#5a9638");
T.palm=authored("palm_leaf_32.png","#4a8a40");
T.flowerR=authored("flower_red_16.png","#e05040");
T.flowerY=authored("flower_yellow_16.png","#e8c040");
T.flowerW=authored("flower_white_16.png","#f4f0e8");
T.tuft=authored("tuft_32.png","#5aaa48");
T.cloud=authored("cloud_96.png","#ffffff",{clamp:1});
T.signInn=authored("sign_inn.png","#ecd6aa",{clamp:1});
T.signMarket=authored("sign_market.png","#ecd6aa",{clamp:1});
T.signWell=authored("sign_well.png","#d6cebe",{clamp:1});
T.rock=groundRepeat(loadTex(TB_ROOT+"textures/tiles_v3/rock_slab_64.png","#9a9a96"));
/* Atlas cell 21 is the only wet-sand slot. v0/v1 share that ramp and swap per 3.2 m tile. */
T.wet0=groundRepeat(loadTex(TB_ROOT+"textures/tiles_v3/water/textures/terrain_wet_sand_v0_48.png","#D6BA85"));
T.wet1=groundRepeat(loadTex(TB_ROOT+"textures/tiles_v3/water/textures/terrain_wet_sand_v1_48.png","#D6BA85"));
groundRepeat(T.cobble);
T.leaf=loadTex(TB_ROOT+"textures/tiles_v3/foliage_leaf_32.png","#3f8a32");
T.pine=loadTex(TB_ROOT+"textures/tiles_v3/foliage_pine_32.png","#2f6a34");
T.bark=loadTex(TB_ROOT+"textures/tiles_v3/prop_bark_32.png","#6a4a30");
T.planks=loadTex(TB_ROOT+"textures/tiles_v3/prop_planks_32.png","#a07848");
T.crate=loadTex(TB_ROOT+"textures/tiles_v3/prop_crate_face_32.png","#b08050");
T.canvas=loadTex(TB_ROOT+"textures/tiles_v3/prop_canvas_32.png","#d8c8a4");
T.autumn=authored("foliage_autumn_32.png","#e09030");
T.cluster=authored("leaf_cluster_32.png","#5aaa48");
T.clusterP=authored("pine_cluster_32.png","#3a8a48");
T.clusterA=authored("autumn_cluster_32.png","#e09030");

const MAT={
plaster:lambert(T.plaster),
timber:lambert(T.timber),
clay:lambert(T.clay),
slate:lambert(T.slate),
stone:lambert(T.stone,{flat:true}),
cobble:lambert(T.cobble,{polygonOffset:true}),
water:unlit(T.water),
foam:unlit(T.foam),
awning:lambert(T.awning),
awningB:lambert(T.awningB),
adobe:lambert(T.adobe),
pot:lambert(T.pot),
apple:lambert(T.apple),
green:lambert(T.green),
palm:lambert(T.palm,{transparent:true,alphaTest:.45,side:THREE.DoubleSide,depthWrite:true}),
flowerR:lambert(T.flowerR,{transparent:true,alphaTest:.4,side:THREE.DoubleSide}),
flowerY:lambert(T.flowerY,{transparent:true,alphaTest:.4,side:THREE.DoubleSide}),
flowerW:lambert(T.flowerW,{transparent:true,alphaTest:.4,side:THREE.DoubleSide}),
tuft:lambert(T.tuft,{transparent:true,alphaTest:.35,side:THREE.DoubleSide}),
cloud:new THREE.MeshBasicMaterial({map:T.cloud,transparent:true,alphaTest:.25,depthWrite:false,fog:false,side:THREE.DoubleSide}),
signInn:lambert(T.signInn),
signMarket:lambert(T.signMarket),
signWell:lambert(T.signWell),
rock:lambert(T.rock,{flat:true}),
leaf:lambert(T.leaf),
pine:lambert(T.pine),
bark:lambert(T.bark),
planks:lambert(T.planks),
crate:lambert(T.crate),
canvas:lambert(T.canvas),
autumn:lambert(T.autumn),
cluster:lambert(T.cluster,{transparent:true,alphaTest:.4,side:THREE.DoubleSide,depthWrite:false}),
clusterP:lambert(T.clusterP,{transparent:true,alphaTest:.4,side:THREE.DoubleSide,depthWrite:false}),
clusterA:lambert(T.clusterA,{transparent:true,alphaTest:.4,side:THREE.DoubleSide,depthWrite:false}),
dark:lambert(null),
glass:lambert(null)
};
/* Window glass is a dark teal, never black. Door panels stay timber. */
MAT.dark.map=null;MAT.dark.color.set(0x6a5438);
MAT.glass.map=null;MAT.glass.color.set(0x6e9eb4);

/* ---------- terrain atlas + pick map ---------- */
/* Meadow stays on the 8×3 canvas (ids 0–20). An imported area uses the
   16×6 biome atlas and, where no authored pair exists, the 12 edge masks. */
const EDGE_I={12:0,3:1,9:2,6:3,8:4,4:5,2:6,1:7,7:8,11:9,13:10,14:11};
const DIRT_CLASS=15, DIRT_PRIO=16, DIRT_TILE=7;
let biomeTable=null, biomeWait=[], groundBiome=false;
let biomeAtlas=null, maskAtlas=null, rimTex=null, dummyPick=null, dummyMask=null, dummyRim=null;
/* Box-filter each atlas tile on its own so a mip never averages grass into sand.
   The chain stops at one texel per tile; WebGL2 TEXTURE_MAX_LEVEL keeps the GPU
   from going coarser, where tiles would share a texel. */
function canvasOf(img){
const c=document.createElement("canvas");c.width=img.width;c.height=img.height;
const g=c.getContext("2d");g.imageSmoothingEnabled=false;g.drawImage(img,0,0);return c;
}
function downsampleTiles(src,cols,rows){
const sw=src.width,sh=src.height,tw=sw/cols,th=sh/rows;
const dw=sw>>1,dh=sh>>1,ntw=dw/cols,nth=dh/rows;
const sd=src.getContext("2d").getImageData(0,0,sw,sh).data;
const c=document.createElement("canvas");c.width=dw;c.height=dh;
const g=c.getContext("2d");
const out=g.createImageData(dw,dh),od=out.data;
for(let ty=0;ty<rows;ty++)for(let tx=0;tx<cols;tx++){
for(let y=0;y<nth;y++)for(let x=0;x<ntw;x++){
const x0=tx*tw+Math.floor(x*tw/ntw),x1=tx*tw+Math.floor((x+1)*tw/ntw);
const y0=ty*th+Math.floor(y*th/nth),y1=ty*th+Math.floor((y+1)*th/nth);
let r=0,gg=0,b=0,a=0,n=0;
for(let yy=y0;yy<y1;yy++)for(let xx=x0;xx<x1;xx++){
const o=(yy*sw+xx)*4;r+=sd[o];gg+=sd[o+1];b+=sd[o+2];a+=sd[o+3];n++;
}
const o=((ty*nth+y)*dw+(tx*ntw+x))*4;
od[o]=r/n;od[o+1]=gg/n;od[o+2]=b/n;od[o+3]=a/n;
}
}
g.putImageData(out,0,0);return c;
}
function atlasMips(img,cols,rows){
const levels=[canvasOf(img)];
while(levels[levels.length-1].width/cols>=2&&levels[levels.length-1].height/rows>=2){
levels.push(downsampleTiles(levels[levels.length-1],cols,rows));
}
return levels;
}
function webgl2(){
if(typeof document==="undefined"||typeof document.getElementById!=="function")return false;
const c=tbCanvas();
return !!(c&&c.getContext("webgl2"));
}
function armAtlasMips(tex,levels){
if(!levels||!levels.length)return;
tex.image=levels[0];
tex.magFilter=THREE.NearestFilter;
tex.generateMipmaps=false;
tex.wrapS=tex.wrapT=THREE.ClampToEdgeWrapping;
if(webgl2()&&levels.length>1){
tex.mipmaps=levels;
tex.minFilter=THREE.NearestMipmapLinearFilter;
const maxLevel=levels.length-1;
tex.onUpdate=function(){
const gl=tbCanvas().getContext("webgl2");
if(gl)gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAX_LEVEL,maxLevel);
};
queueAniso(tex);
}else{
tex.mipmaps=[];
tex.minFilter=THREE.NearestFilter;
tex.anisotropy=1;
}
tex.needsUpdate=true;
}
function buildAtlas(){
const c=document.createElement("canvas");c.width=384;c.height=144;
const g=c.getContext("2d");g.fillStyle="#6cbf4a";g.fillRect(0,0,384,144);
const t=new THREE.CanvasTexture(c);t.flipY=false;crisp(t);t.wrapS=t.wrapT=THREE.ClampToEdgeWrapping;
TILES.forEach(function(name,i){
const img=new Image();
img.onload=function(){g.drawImage(img,(i%8)*48,Math.floor(i/8)*48,48,48);t.needsUpdate=true;kickBake();};
img.src=TB_ROOT+"textures/tiles_v3/"+name+".png";
});
return t;
}
function nearestTex(img,srgb){
const t=new THREE.Texture(img);
t.flipY=false;t.magFilter=t.minFilter=THREE.NearestFilter;t.generateMipmaps=false;t.anisotropy=1;
t.wrapS=t.wrapT=THREE.ClampToEdgeWrapping;
t.colorSpace=srgb?THREE.SRGBColorSpace:THREE.LinearSRGBColorSpace;
return t;
}
function loadImageTex(url,srgb){
const img=new Image();
const t=nearestTex(img,srgb);
img.onload=function(){t.needsUpdate=true;kickBake();};
img.src=url;return t;
}
function solidTex(w,h,fill){
const data=new Uint8Array(w*h*4);
if(fill!=null)data.fill(fill);
const t=new THREE.DataTexture(data,w,h,THREE.RGBAFormat,THREE.UnsignedByteType);
t.flipY=false;t.magFilter=t.minFilter=THREE.NearestFilter;t.generateMipmaps=false;
t.wrapS=t.wrapT=THREE.ClampToEdgeWrapping;t.unpackAlignment=1;t.needsUpdate=true;return t;
}
function dummyTextures(){
if(!dummyPick)dummyPick=solidTex(1,1,0);
if(!dummyMask)dummyMask=solidTex(1,1,0);
if(!dummyRim)dummyRim=solidTex(1,1,255);
return {pick2:dummyPick,mask:dummyMask,rim:dummyRim};
}
function hexByte(s){
const n=parseInt(String(s).replace("#",""),16);
return [(n>>16)&255,(n>>8)&255,n&255];
}
function loadBiomeTable(j){
const prio=[],names=[],ground=[];
const rim=new Uint8Array(16*3*4);rim.fill(255);
const biomes=(j&&j.biomes)||[];
biomes.forEach(function(b){
prio[b.id]=b.priority;
names[b.id]=b.enum;
ground[b.id]=(b.ground||[]).map(function(g){return [g.atlas_id,g.weight];});
const rows=[b.rim&&b.rim.lit,b.rim&&b.rim.shaded,b.rim&&b.rim.shadow_received];
rows.forEach(function(hex,row){
if(!hex)return;
const c=hexByte(hex),o=(row*16+b.id)*4;
rim[o]=c[0];rim[o+1]=c[1];rim[o+2]=c[2];rim[o+3]=255;
});
});
/* Dirt paths are a surface class, not a biome. Column 15 is their rim. */
const dirt=[["#E8C896"],["#C4A06A"],["#A07848"]];
dirt.forEach(function(pair,row){
const c=hexByte(pair[0]),o=(row*16+15)*4;
rim[o]=c[0];rim[o+1]=c[1];rim[o+2]=c[2];rim[o+3]=255;
});
const pairs={};
((j&&j.pair_sets)||[]).forEach(function(p){pairs[p.fg+"|"+p.bg]=p.first_atlas_id;});
const book={};
biomes.forEach(function(b){
const rec={id:b.id,enum:b.enum,dry:b.dry,ringDress:b.ringDress||null};
book[b.enum]=rec;
(b.aliases||[]).forEach(function(a){book[a]=rec;});
if(b.enum==="Heath")book.Badlands=rec;
if(b.enum==="Badlands")book.Heath=rec;
});
biomeTable={prio:prio,names:names,ground:ground,pairs:pairs,rim:rim,book:book};
if(typeof THREE!=="undefined"){
rimTex=new THREE.DataTexture(rim,16,3,THREE.RGBAFormat,THREE.UnsignedByteType);
rimTex.flipY=false;rimTex.magFilter=rimTex.minFilter=THREE.NearestFilter;rimTex.generateMipmaps=false;
rimTex.wrapS=rimTex.wrapT=THREE.ClampToEdgeWrapping;rimTex.unpackAlignment=1;rimTex.needsUpdate=true;
}
const q=biomeWait||[];biomeWait=[];
q.forEach(function(fn){try{fn();}catch(e){console.warn("biome table",e);}});
}
function whenBiomes(fn){
if(biomeTable)fn();
else biomeWait.push(fn);
}
function prioOf(id){
if(id===DIRT_CLASS)return DIRT_PRIO;
const p=biomeTable&&biomeTable.prio[id];
return p==null?0:p;
}
function variantOf(bid,cx,cz){
if(bid===DIRT_CLASS)return DIRT_TILE;
if(bid===2)return grassPick(cx,cz,0);
const g=biomeTable&&biomeTable.ground[bid];
if(!g||!g.length)return 0;
const r=hash01(cx,cz,bid);let a=0;
for(let i=0;i<g.length;i++){a+=g[i][1];if(r<a)return g[i][0];}
return g[g.length-1][0];
}
function cornerTally(v){
const ids=[],ns=[];
for(let i=0;i<v.length;i++){
const k=ids.indexOf(v[i]);
if(k<0){ids.push(v[i]);ns.push(1);}else ns[k]++;
}
return {ids:ids,ns:ns};
}
/* Corner-level pre-filter from BIOMES.md: a cell with 3+ biomes rewrites its
   rarest corner onto the dominant biome. The edit is the shared corner. */
function prefilterBiomes(corner,cw,w,h){
for(let pass=0;pass<4;pass++){
let changed=false;
for(let iz=0;iz<h;iz++)for(let ix=0;ix<w;ix++){
const idx=[iz*cw+ix,iz*cw+ix+1,(iz+1)*cw+ix+1,(iz+1)*cw+ix];
const v=idx.map(function(i){return corner[i];});
const t=cornerTally(v);
if(t.ids.length<=2)continue;
let dom=t.ids[0],odd=t.ids[0],dn=-1,dp=-1,on=99,op=99;
for(let i=0;i<t.ids.length;i++){
const b=t.ids[i],n=t.ns[i],p=prioOf(b);
if(n>dn||(n===dn&&p>dp)){dom=b;dn=n;dp=p;}
if(n<on||(n===on&&p<op)){odd=b;on=n;op=p;}
}
for(let i=0;i<idx.length;i++)if(corner[idx[i]]===odd){corner[idx[i]]=dom;changed=true;}
}
if(!changed)break;
}
}
function reduceTwo(c){
const t=cornerTally(c);
if(t.ids.length<=2)return c.slice();
const order=t.ids.map(function(b,i){return {b:b,n:t.ns[i]};});
order.sort(function(a,b){return (b.n-a.n)||(prioOf(b.b)-prioOf(a.b));});
const top=[order[0].b,order[1].b];
const lo=prioOf(top[0])<=prioOf(top[1])?top[0]:top[1];
return c.map(function(b){return top.indexOf(b)>=0?b:lo;});
}
function emitBiomeCell(c,cx,cz){
const t=cornerTally(c);
if(t.ids.length===1){
const id=variantOf(t.ids[0],cx,cz);
return {id:id,mode:0,mask:0,bg:0,fg:t.ids[0],bgb:t.ids[0]};
}
const order=t.ids.map(function(b,i){return {b:b,n:t.ns[i]};});
order.sort(function(a,b){return (b.n-a.n)||(prioOf(b.b)-prioOf(a.b));});
let fg=order[0].b,bg=order[1].b;
if(prioOf(bg)>prioOf(fg)){const s=fg;fg=bg;bg=s;}
const sw=c[0],se=c[1],ne=c[2],nw=c[3];
const bits=((nw===fg)?8:0)|((ne===fg)?4:0)|((se===fg)?2:0)|((sw===fg)?1:0);
if(bits===5||bits===10||EDGE_I[bits]==null){
return {id:variantOf(fg,cx,cz),mode:0,mask:0,bg:0,fg:fg,bgb:bg};
}
/* Every two-biome edge uses the scalloped mask. Authored pair tiles are
   painted per cell, so sand/dirt and the other pairs stepped along the grid. */
return {id:variantOf(fg,cx,cz),mode:0,mask:EDGE_I[bits]+1,bg:variantOf(bg,cx,cz),fg:fg,bgb:bg};
}
function modeOf(ids){
const t=cornerTally(ids);
let best=t.ids[0],bn=-1,bp=-1;
for(let i=0;i<t.ids.length;i++){
const b=t.ids[i],n=t.ns[i],p=prioOf(b);
if(n>bn||(n===bn&&p>bp)){best=b;bn=n;bp=p;}
}
return best;
}
/* Lots and plazas stay crisp. Roads and dirt paths do too when an area draws
   them as smooth ribbons (softPaths): the cell paint is skipped so the
   stair-stepped tiles do not show under the ribbon. A two-cell ring stays
   crisp so jitter on open ground cannot drag a yard or a street sideways. */
function dilateCrisp(src,w,h,times){
let cur=src;
for(let t=0;t<times;t++){
const n=new Uint8Array(cur);
for(let iz=0;iz<h;iz++)for(let ix=0;ix<w;ix++){
if(cur[iz*w+ix])continue;
let hit=0;
for(let dz=-1;dz<=1&&!hit;dz++)for(let dx=-1;dx<=1;dx++){
const x=ix+dx,z=iz+dz;
if(x<0||z<0||x>=w||z>=h)continue;
if(cur[z*w+x])hit=1;
}
if(hit)n[iz*w+ix]=1;
}
cur=n;
}
return cur;
}
function bakeBiomeCells(bio,surf,w,h,cx0,cz0,softPaths){
if(!biomeTable)return null;
const cw=w+1,ch=h+1;
const corner=bio instanceof Uint8Array?new Uint8Array(bio):Uint8Array.from(bio);
const surface=surf instanceof Uint8Array?surf:Uint8Array.from(surf);
prefilterBiomes(corner,cw,w,h);
const cells=[];
const crisp=new Uint8Array(w*h);
for(let iz=0;iz<h;iz++)for(let ix=0;ix<w;ix++){
const i00=iz*cw+ix,i10=i00+1,i11=i00+cw+1,i01=i00+cw;
const rawS=[surface[i00],surface[i10],surface[i11],surface[i01]];
const gi=iz*w+ix;
if(softPaths){if(rawS.some(function(v){return v===1||v===2||v===3;}))crisp[gi]=1;}
else if(rawS.some(function(v){return v===2||v===3;}))crisp[gi]=1;
const s=softPaths?rawS.map(function(v){return v===1||v===2?0:v;}):rawS;
const roadN=s.reduce(function(n,v){return n+(v===2?1:0);},0);
if(roadN){
const sw=s[0]===2,se=s[1]===2,ne=s[2]===2,nw=s[3]===2;
const bits=(nw?8:0)|(ne?4:0)|(se?2:0)|(sw?1:0);
if(roadN===4||bits===5||bits===10||EDGE_I[bits]==null){
cells.push({id:20,mode:2,mask:0,bg:0,fg:0,bgb:0,crisp:1});
continue;
}
const others=[];
const bioC=[corner[i00],corner[i10],corner[i11],corner[i01]];
for(let k=0;k<4;k++)if(s[k]!==2)others.push(s[k]===1?DIRT_CLASS:bioC[k]);
const bgId=others.length?modeOf(others):2;
cells.push({id:20,mode:2,mask:EDGE_I[bits]+1,bg:variantOf(bgId,cx0+ix,cz0+iz),fg:15,bgb:bgId,crisp:1});
continue;
}
let c=[corner[i00],corner[i10],corner[i11],corner[i01]];
for(let k=0;k<4;k++)if(s[k]===1)c[k]=DIRT_CLASS;
c=reduceTwo(c);
const cell=emitBiomeCell(c,cx0+ix,cz0+iz);
cell.crisp=0;
cells.push(cell);
}
const dil=dilateCrisp(crisp,w,h,2);
for(let i=0;i<cells.length;i++)if(dil[i])cells[i].crisp=1;
return cells;
}
function buildPick(cover,roadMode,rec){
rec=rec||{};
const x0=rec.x0!=null?rec.x0:-48,x1=rec.x1!=null?rec.x1:460,z0=rec.z0!=null?rec.z0:-460,z1=rec.z1!=null?rec.z1:460;
const cx0=Math.floor(x0/CELL),cx1=Math.floor(x1/CELL);
const cz0=Math.floor(z0/CELL),cz1=Math.floor(z1/CELL);
const w=cx1-cx0+1,h=cz1-cz0+1,cw=w+1,ch=h+1;
const corner=new Uint8Array(cw*ch);
for(let iz=0;iz<ch;iz++){
const z=(cz0+iz)*CELL;
for(let ix=0;ix<cw;ix++)corner[iz*cw+ix]=cover((cx0+ix)*CELL,z);
}
const at=(ix,iz)=>corner[iz*cw+ix];
function bitsAt(ix,iz){
const sw=at(ix,iz),se=at(ix+1,iz),nw=at(ix,iz+1),ne=at(ix+1,iz+1);
const bit=v=>v===0?1:0;
return{bits:(bit(nw)<<3)|(bit(ne)<<2)|(bit(se)<<1)|bit(sw),sw:sw,se:se,nw:nw,ne:ne};
}
for(let pass=0;pass<4;pass++){
for(let iz=0;iz<h;iz++)for(let ix=0;ix<w;ix++){
const c=bitsAt(ix,iz);
if(c.bits!==5&&c.bits!==10)continue;
const any=[c.nw,c.ne,c.se,c.sw].some(v=>v===2),fill=any?2:1;
if(c.bits===5){if(c.sw===0)corner[iz*cw+ix]=fill;if(c.ne===0)corner[(iz+1)*cw+ix+1]=fill;}
else{if(c.nw===0)corner[(iz+1)*cw+ix]=fill;if(c.se===0)corner[iz*cw+ix+1]=fill;}
}
}
const data=new Uint8Array(w*h*4);
let flowers=0,cells=0;
for(let iz=0;iz<h;iz++)for(let ix=0;ix<w;ix++){
const c=bitsAt(ix,iz),b=c.bits;
const corners=[c.nw,c.ne,c.se,c.sw];
const anyRoad=corners.some(v=>v===2);
let id,mode=0,lip=0;
if(b===15){id=grassPick(cx0+ix,cz0+iz,0);if(id>=5)flowers++;cells++;}
else if(b===0){id=anyRoad?20:7;mode=anyRoad?roadMode((cx0+ix+.5)*CELL,(cz0+iz+.5)*CELL):0;}
else{id=EDGE[b]||7;if(anyRoad){lip=1;mode=roadMode((cx0+ix+.5)*CELL,(cz0+iz+.5)*CELL);}}
const o=(iz*w+ix)*4;
data[o]=id;data[o+1]=mode===2?255:mode===1?128:0;data[o+2]=lip?255:0;data[o+3]=255;
}
const tex=new THREE.DataTexture(data,w,h,THREE.RGBAFormat,THREE.UnsignedByteType);
tex.flipY=false;tex.magFilter=tex.minFilter=THREE.NearestFilter;tex.generateMipmaps=false;
tex.wrapS=tex.wrapT=THREE.ClampToEdgeWrapping;tex.unpackAlignment=1;tex.needsUpdate=true;
console.info("trail tiles: grass flowers",(cells?flowers/cells:0).toFixed(3),"of",cells,"cells");
return{tex:tex,cx0:cx0,cz0:cz0,w:w,h:h};
}
/* Areas pick on the 1 m ground grid. The meadow stays on CELL (3.2 m). */
const CELL_B=1, AREA_JITTER=1.7;
function buildBiomePick(rec){
const x0=rec.x0!=null?rec.x0:-48,x1=rec.x1!=null?rec.x1:460,z0=rec.z0!=null?rec.z0:-460,z1=rec.z1!=null?rec.z1:460;
const cx0=Math.floor(x0/CELL_B),cx1=Math.floor(x1/CELL_B);
const cz0=Math.floor(z0/CELL_B),cz1=Math.floor(z1/CELL_B);
const w=cx1-cx0+1,h=cz1-cz0+1,cw=w+1,ch=h+1;
const bio=new Uint8Array(cw*ch),surf=new Uint8Array(cw*ch);
for(let iz=0;iz<ch;iz++){
const z=(cz0+iz)*CELL_B;
for(let ix=0;ix<cw;ix++){
const x=(cx0+ix)*CELL_B,i=iz*cw+ix;
let b=rec.biome(x,z)|0;if(b<0||b>14)b=2;
bio[i]=b;
surf[i]=rec.surface?rec.surface(x,z)|0:0;
}
}
const cells=bakeBiomeCells(bio,surf,w,h,cx0,cz0,!!rec.softPaths);
const data=new Uint8Array(w*h*4),data2=new Uint8Array(w*h*4);
let masks=0,authored=0,plain=0;
for(let i=0;i<cells.length;i++){
const cell=cells[i],o=i*4;
data[o]=cell.id;data[o+1]=cell.mode===2?255:0;data[o+2]=0;data[o+3]=255;
data2[o]=cell.bg;data2[o+1]=cell.mask;data2[o+2]=cell.fg;data2[o+3]=(cell.bgb|0)+(cell.crisp?128:0);
if(cell.mask)masks++;
else if(cell.id>=60)authored++;
else plain++;
}
function texOf(bytes){
const tex=new THREE.DataTexture(bytes,w,h,THREE.RGBAFormat,THREE.UnsignedByteType);
tex.flipY=false;tex.magFilter=tex.minFilter=THREE.NearestFilter;tex.generateMipmaps=false;
tex.wrapS=tex.wrapT=THREE.ClampToEdgeWrapping;tex.unpackAlignment=1;tex.needsUpdate=true;return tex;
}
console.info("trail biomes: plain",plain,"authored",authored,"masks",masks);
/* pave 1 keeps roads and ribbons on the same 10 texels/m as the biome tiles.
   (10/32)*pave texels per metre; 3.2 was one tile per metre, too fine next to grass. */
return{tex:texOf(data),tex2:texOf(data2),cx0:cx0,cz0:cz0,w:w,h:h,cell:CELL_B,jitter:AREA_JITTER,pave:1};
}
const BNOISE=[
"float bnoise(vec2 p){",
"vec2 i=floor(p);vec2 f=fract(p);f=f*f*(3.0-2.0*f);",
"float a=fract(sin(dot(i,vec2(127.1,311.7)))*43758.5453);",
"float b=fract(sin(dot(i+vec2(1.0,0.0),vec2(127.1,311.7)))*43758.5453);",
"float c=fract(sin(dot(i+vec2(0.0,1.0),vec2(127.1,311.7)))*43758.5453);",
"float d=fract(sin(dot(i+vec2(1.0,1.0),vec2(127.1,311.7)))*43758.5453);",
"return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);}"
].join("\n");
const MAP_CHUNK=[
"vec3 tileW=vTileW;",
"float area=step(0.5,uAtlas.z);",
"float cell=mix(3.0,max(uCell,0.25),area);",
"float cx0=floor(tileW.x/cell);float cz0=floor(tileW.z/cell);",
"vec2 puv0=vec2((cx0-uPickOrg.x+0.5)/uPickOrg.z,(cz0-uPickOrg.y+0.5)/uPickOrg.w);",
"float crisp=step(100.0,floor(texture2D(uPick2,puv0).a*255.0+0.5))*area;",
"vec2 wob=vec2(0.0);",
"if(area>0.5&&crisp<0.5){",
"vec2 wp=tileW.xz*0.13;",
"wob=(vec2(bnoise(wp),bnoise(wp+vec2(5.2,1.3)))-0.5)*uJitter;",
"wob+=(vec2(bnoise(wp*2.4+3.0),bnoise(wp*2.4+vec2(8.0,2.0)))-0.5)*uJitter*0.38;",
"vec2 wq=tileW.xz*1.15;",
"wob+=(vec2(bnoise(wq),bnoise(wq+vec2(4.1,2.2)))-0.5)*1.25;",
"}",
"float cx=floor((tileW.x+wob.x)/cell);float cz=floor((tileW.z+wob.y)/cell);",
"vec2 puv=vec2((cx-uPickOrg.x+0.5)/uPickOrg.z,(cz-uPickOrg.y+0.5)/uPickOrg.w);",
"vec4 pk=texture2D(uPick,puv);",
"vec4 pk2=texture2D(uPick2,puv);",
"float id=floor(pk.r*255.0+0.5);float col=mod(id,uAtlas.x);float row=floor(id/uAtlas.x+0.001);",
"float den=max(uTexel,0.25);",
"float tu=fract((tileW.x+wob.x)/cell*den);float tv=1.0-fract((tileW.z+wob.y)/cell*den);",
"tu=(floor(tu*48.0)+0.5)/48.0;tv=(floor(tv*48.0)+0.5)/48.0;",
"float gu=fract(tileW.x/3.0*den);float gv=1.0-fract(tileW.z/3.0*den);",
"gu=(floor(gu*48.0)+0.5)/48.0;gv=(floor(gv*48.0)+0.5)/48.0;",
"float useCell=step(59.5,id)*area;",
"float uu=mix(mix(tu,gu,area),tu,useCell);float vv=mix(mix(tv,gv,area),tv,useCell);",
"vec2 atlasUV=vec2((col+uu)/uAtlas.x,(row+vv)/uAtlas.y);",
"float mode=pk.g*255.0;",
"float pave=mix(1.0,max(uPave,0.25),area);",
"float rimX=-33.7+sin(tileW.z*0.0155)*1.45+sin(tileW.z*0.0057+0.9)*0.7;",
"float su=fract(tileW.z*(16.0/48.0)*den);float sv=clamp((tileW.x-rimX)/3.0+0.5,0.001,0.999);",
"if(mode>200.0){su=fract(tileW.x*(16.0/48.0)*den*pave);sv=fract(tileW.z*(16.0/48.0)*den*pave);}",
"su=(floor(su*48.0)+0.5)/48.0;sv=(floor(sv*48.0)+0.5)/48.0;",
"float roadCol=mod(20.0,uAtlas.x);float roadRow=floor(20.0/uAtlas.x+0.001);",
"vec2 roadUV=vec2((roadCol+su)/uAtlas.x,(roadRow+sv)/uAtlas.y);",
"vec4 texelColor=texture2D(map,(id>19.5&&id<20.5)?roadUV:atlasUV);",
"if(id<19.5&&pk.b>0.5&&texelColor.g<texelColor.r+0.02)texelColor=texture2D(map,roadUV);",
"texelColor=(texelColor);",
"if(id<6.5)texelColor.rgb*=uGrass;",
"float bgId=floor(pk2.r*255.0+0.5);",
"float maskI=floor(pk2.g*255.0+0.5);",
"float fgBio=min(floor(pk2.b*255.0+0.5),15.0);",
"float bgRaw=floor(pk2.a*255.0+0.5);",
"float bgBio=min(bgRaw-step(100.0,bgRaw)*128.0,15.0);",
"float bgCol=mod(bgId,uAtlas.x);float bgRow=floor(bgId/uAtlas.x+0.001);",
"vec4 bgTex=(texture2D(map,vec2((bgCol+uu)/uAtlas.x,(bgRow+vv)/uAtlas.y)));",
"if(bgId<6.5)bgTex.rgb*=uGrass;",
"vec2 _wcell=floor(tileW.xz/3.0);",
"float _wh=fract(sin(dot(_wcell,vec2(19.7,47.3)))*43758.5453);",
"vec3 _wv0=(texture2D(uWet0,vec2(gu,gv))).rgb;",
"vec3 _wv1=(texture2D(uWet1,vec2(gu,gv))).rgb;",
"vec3 _wet=mix(_wv0,_wv1,step(0.5,_wh));",
"if(id>20.5&&id<21.5)texelColor.rgb=_wet;",
"if(bgId>20.5&&bgId<21.5)bgTex.rgb=_wet;",
"float mi=max(maskI-1.0,0.0);",
"float m=texture2D(uMask,vec2((mi+tu)/12.0,tv)).r;",
"vec3 rimLit=(texture2D(uRim,vec2((fgBio+0.5)/16.0,0.5/3.0))).rgb;",
"vec3 rimSh=(texture2D(uRim,vec2((fgBio+0.5)/16.0,1.5/3.0))).rgb;",
"vec3 rimSw=(texture2D(uRim,vec2((bgBio+0.5)/16.0,2.5/3.0))).rgb;",
"float body=step(0.88,m);",
"float lit=step(0.62,m)*(1.0-body);",
"float shd=step(0.38,m)*(1.0-step(0.62,m));",
"float shw=step(0.12,m)*(1.0-step(0.38,m));",
"float bgw=1.0-step(0.12,m);",
"vec3 mixed=texelColor.rgb*body+rimLit*lit+rimSh*shd+rimSw*shw+bgTex.rgb*bgw;",
"texelColor.rgb=mix(texelColor.rgb,mixed,step(0.5,uAtlas.z)*step(0.5,maskI));",
"vec3 _fn=cross(dFdx(vTileW),dFdy(vTileW));",
"float _fnl=length(_fn);",
"_fn=_fnl>1e-5?_fn/_fnl:vec3(0.0,1.0,0.0);",
"float _rockW=smoothstep(0.50,0.70,length(_fn.xz));",
"vec2 _ruv=abs(_fn.x)>=abs(_fn.z)?(floor(vTileW.zy*16.0)+0.5)/64.0:(floor(vTileW.xy*16.0)+0.5)/64.0;",
"vec3 _rock=(texture2D(uRock,_ruv)).rgb;",
"texelColor.rgb=mix(texelColor.rgb,_rock,_rockW);",
"vec2 _ribUV=(tileW.xz-uRibOrg.xy)*uRibOrg.zw;",
"float _ribOn=step(1e-5,uRibOrg.z);",
"vec2 _rib=texture2D(uRibbon,_ribUV).rg;",
"float _rn=(bnoise(tileW.xz*0.35)-0.5)*0.14;",
"float _rk=step(0.5,_rib.r+_rn)*_ribOn;",
"float _dk=step(0.5,_rib.g+_rn)*_ribOn*(1.0-_rk);",
"float _psu=fract(tileW.x*(16.0/48.0)*den*pave);",
"float _psv=fract(tileW.z*(16.0/48.0)*den*pave);",
"_psu=(floor(_psu*48.0)+0.5)/48.0;_psv=(floor(_psv*48.0)+0.5)/48.0;",
"vec2 _suv=vec2((mod(20.0,uAtlas.x)+_psu)/uAtlas.x,(floor(20.0/uAtlas.x+0.001)+_psv)/uAtlas.y);",
"vec2 _duv=vec2((mod(7.0,uAtlas.x)+_psu)/uAtlas.x,(floor(7.0/uAtlas.x+0.001)+_psv)/uAtlas.y);",
"vec3 _sand=(texture2D(map,_suv)).rgb;",
"vec3 _dirt=(texture2D(map,_duv)).rgb;",
"texelColor.rgb=mix(texelColor.rgb,_dirt,_dk);",
"texelColor.rgb=mix(texelColor.rgb,_sand,_rk);",
"if(uChunkPx.x>0.5&&uBakePass<0.5){",
"vec2 _cuv=(tileW.xz-uChunkOrg.xy)*uChunkOrg.zw;",
"_cuv.x=1.0-_cuv.x;",
"_cuv=clamp(_cuv,0.5/uChunkPx.xy,1.0-0.5/uChunkPx.xy);",
"vec2 _cdx=dFdx(_cuv)*uChunkPx.xy;vec2 _cdy=dFdy(_cuv)*uChunkPx.xy;",
"float _foot=max(length(_cdx),length(_cdy));",
"float _bias=_foot<3.0?-1.5:(_foot<8.0?-0.8:0.0);",
"texelColor=(texture2D(uChunk,_cuv,_bias));",
"}",
"diffuseColor*=texelColor;"
].join("\n");
let pickRef=null, groundMat=null, atlasNew=null, atlasOld=null;
function ribbonTexture(rib){
if(!rib||!rib.data||typeof THREE==="undefined")return null;
const t=new THREE.DataTexture(rib.data,rib.w,rib.h,THREE.RGBAFormat,THREE.UnsignedByteType);
t.flipY=false;t.magFilter=t.minFilter=THREE.LinearFilter;t.generateMipmaps=false;
t.wrapS=t.wrapT=THREE.ClampToEdgeWrapping;t.unpackAlignment=1;t.needsUpdate=true;
return t;
}
function bindGround(sh,rec,pick){
const dummies=dummyTextures();
sh.uniforms.uPick={value:rec.tex};
rec.uniform=sh.uniforms.uPick;
sh.uniforms.uPick2={value:rec.tex2||dummies.pick2};
rec.uniform2=sh.uniforms.uPick2;
sh.uniforms.uMask={value:rec.maskTex||dummies.mask};
sh.uniforms.uRim={value:rec.rimTex||dummies.rim};
sh.uniforms.uPickOrg={value:new THREE.Vector4(pick.cx0,pick.cz0,pick.w,pick.h)};
sh.uniforms.uAtlas={value:rec.atlas};
sh.uniforms.uCell={value:pick.cell||3.2};
sh.uniforms.uJitter={value:pick.jitter||0};
sh.uniforms.uPave={value:pick.pave||1};
sh.uniforms.uRibbon={value:rec.ribbonTex||dummies.pick2};
sh.uniforms.uRibOrg={value:rec.ribOrg||new THREE.Vector4(0,0,0,0)};
sh.uniforms.uRock={value:T.rock};
sh.uniforms.uWet0={value:T.wet0};
sh.uniforms.uWet1={value:T.wet1};
sh.uniforms.uChunk={value:dummyTextures().pick2};
sh.uniforms.uChunkOrg={value:new THREE.Vector4(0,0,0,0)};
sh.uniforms.uChunkPx={value:new THREE.Vector2(0,0)};
sh.uniforms.uBakePass={value:pendingBake};
if(groundMat){
groundMat.userData.uBakePass=sh.uniforms.uBakePass;
groundMat.userData.chunkU=sh.uniforms.uChunk;
groundMat.userData.chunkOrg=sh.uniforms.uChunkOrg;
groundMat.userData.chunkPx=sh.uniforms.uChunkPx;
}
bindShade(sh);
sh.uniforms.uGrass=SHADE.uGrass;
}
function install(mat,opt){
opt=opt||{};
if(opt.biome&&!biomeTable){whenBiomes(function(){install(mat,opt);});return;}
const b=opt.bounds||{};
const meadow=!opt.biome;
const rec={
cover:opt.cover,roadMode:opt.roadMode||function(){return 0;},
biome:opt.biome||null,surface:opt.surface||null,softPaths:!!opt.ribbon,
x0:b.x0,x1:b.x1,z0:b.z0,z1:b.z1,
tex:null,tex2:null,uniform:null,uniform2:null,
atlas:new THREE.Vector3(meadow?8:16,meadow?3:6,meadow?0:1),
maskTex:meadow?null:maskAtlasTex(),
rimTex:meadow?null:rimTex
};
rec.ribbonTex=ribbonTexture(opt.ribbon);
if(opt.ribbon&&opt.ribbon.worldW&&opt.ribbon.worldH)rec.ribOrg=new THREE.Vector4(opt.ribbon.x0||0,opt.ribbon.z0||0,1/opt.ribbon.worldW,1/opt.ribbon.worldH);
else rec.ribOrg=new THREE.Vector4(0,0,0,0);
pickRef=rec;
groundBiome=!meadow;
const pick=meadow?buildPick(rec.cover,rec.roadMode,rec):buildBiomePick(rec);
rec.tex=pick.tex;rec.tex2=pick.tex2||null;
if(meadow)atlasNew=buildAtlas();
else atlasNew=biomeAtlasTex();
groundMat=mat;
mat.map=atlasNew;if(mat.color)mat.color.set(0xffffff);
mat.extensions=mat.extensions||{};
mat.extensions.derivatives=true;
if(mat.map){
mat.map.magFilter=THREE.NearestFilter;
if(!(mat.map.mipmaps&&mat.map.mipmaps.length>1)){mat.map.minFilter=THREE.NearestFilter;mat.map.generateMipmaps=false;}
queueAniso(mat.map);
}
mat.precision="highp";
const prev=mat.onBeforeCompile;
mat.onBeforeCompile=function(sh){
bindGround(sh,rec,pick);
sh.vertexShader="varying vec3 vTileW;\nvarying vec3 vTileN;\n"+sh.vertexShader.replace("#include <project_vertex>","vTileW=(modelMatrix*vec4(transformed,1.0)).xyz;\nvTileN=normalize(mat3(modelMatrix)*objectNormal);\n#include <project_vertex>");
sh.fragmentShader="varying vec3 vTileW;\nvarying vec3 vTileN;\nuniform sampler2D uPick;\nuniform sampler2D uPick2;\nuniform sampler2D uMask;\nuniform sampler2D uRim;\nuniform sampler2D uRibbon;\nuniform sampler2D uRock;\nuniform sampler2D uWet0;\nuniform sampler2D uWet1;\nuniform sampler2D uChunk;\nuniform vec4 uChunkOrg;\nuniform vec2 uChunkPx;\nuniform float uBakePass;\nuniform vec4 uRibOrg;\nuniform vec4 uPickOrg;\nuniform vec3 uAtlas;\nuniform float uCell;\nuniform float uJitter;\nuniform float uPave;\nuniform float uSteps;\nuniform float uCool;\nuniform float uTexel;\nuniform vec3 uGrass;\n"+BNOISE+"\n"+sh.fragmentShader.replace("#include <map_fragment>",MAP_CHUNK);
sh.fragmentShader=patchLighting(sh.fragmentShader);
if(prev)prev(sh);
sh.fragmentShader=sh.fragmentShader.replace("#include <colorspace_fragment>","if(uBakePass>0.5) gl_FragColor=vec4(diffuseColor.rgb,diffuseColor.a);\n#include <colorspace_fragment>");
sh.fragmentShader=sh.fragmentShader.replace("#include <fog_fragment>","if(uBakePass<0.5){\n#include <fog_fragment>\n}");
bindHeight(sh);
};
mat.needsUpdate=true;
}
/* Elevation debug. Off until the Visuals panel (or ?debug=height) asks.
   The ramp stays in colour — deep teal up through gold — so low ground is never black. */
const HEIGHT={
uHeightDbg:{value:0},
uContour:{value:0},
uHeightRng:{value:new THREE.Vector2(0,6)}
};
const HEIGHT_GLSL=[
"if(uHeightDbg>0.5){",
"float _hs=max(uHeightRng.y-uHeightRng.x,0.25);",
"float _ht=clamp((vTileW.y-uHeightRng.x)/_hs,0.0,1.0);",
"vec3 _lo=vec3(0.24,0.62,0.78);",
"vec3 _mid=vec3(0.95,0.78,0.36);",
"vec3 _hi=vec3(0.45,0.78,0.48);",
"vec3 _ramp=mix(_lo,_mid,smoothstep(0.0,0.55,_ht));",
"_ramp=mix(_ramp,_hi,smoothstep(0.40,1.0,_ht));",
"gl_FragColor.rgb=_ramp;",
"if(uContour>0.5){",
"float _f=fract(vTileW.y);",
"float _dist=min(_f,1.0-_f);",
"float _ln=1.0-smoothstep(0.0,0.12,_dist);",
"gl_FragColor.rgb=mix(gl_FragColor.rgb,vec3(0.36,0.24,0.16),_ln);",
"}",
"}"
].join("\n");
function bindHeight(sh){
if(!sh||sh.fragmentShader.indexOf("uHeightDbg")>=0)return;
sh.uniforms.uHeightDbg=HEIGHT.uHeightDbg;
sh.uniforms.uContour=HEIGHT.uContour;
sh.uniforms.uHeightRng=HEIGHT.uHeightRng;
sh.fragmentShader="uniform float uHeightDbg;\nuniform float uContour;\nuniform vec2 uHeightRng;\n"+sh.fragmentShader;
if(sh.fragmentShader.indexOf("vTileW")<0)sh.fragmentShader="varying vec3 vTileW;\n"+sh.fragmentShader;
if(sh.vertexShader.indexOf("vTileW")<0){
sh.vertexShader="varying vec3 vTileW;\n"+sh.vertexShader.replace("#include <project_vertex>","vTileW=(modelMatrix*vec4(transformed,1.0)).xyz;\n#include <project_vertex>");
}
sh.fragmentShader=sh.fragmentShader.replace("#include <tonemapping_fragment>",HEIGHT_GLSL+"\n#include <tonemapping_fragment>");
}
function setHeightDebug(on,contour,span){
HEIGHT.uHeightDbg.value=on?1:0;
HEIGHT.uContour.value=contour?1:0;
if(span&&isFinite(span.min)&&isFinite(span.max)&&span.max>span.min){
const pad=Math.max(0.2,(span.max-span.min)*0.05);
HEIGHT.uHeightRng.value.set(span.min-pad,span.max+pad);
}
}
function biomeAtlasTex(){
if(!biomeAtlas){
const img=new Image();
biomeAtlas=nearestTex(img,true);
img.onload=function(){biomeAtlas.needsUpdate=true;kickBake();};
img.src=TB_ROOT+"textures/tiles_v3/atlas_terrain_768x288.png";
}
return biomeAtlas;
}
function maskAtlasTex(){
if(!maskAtlas)maskAtlas=loadImageTex(TB_ROOT+"textures/tiles_v3/atlas_edgemask_576x48.png",false);
return maskAtlas;
}
function setFlowerRate(r){
const next=Math.max(0,Math.min(1,+r||0));
if(Math.abs(next-flowerRate)<1e-6)return;
flowerRate=next;
const base=[["v0",.18],["v1",.18],["v2",.16],["v3",.14],["v4",.14]];
const scale=(1-flowerRate)/.8;
GRASS=base.map(function(b){return [b[0],b[1]*scale];});
GRASS.push(["f0",flowerRate*.5],["f1",flowerRate*.5]);
if(!pickRef)return;
const pick=pickRef.biome?buildBiomePick(pickRef):buildPick(pickRef.cover,pickRef.roadMode,pickRef);
if(pickRef.tex&&pickRef.tex.dispose)pickRef.tex.dispose();
if(pickRef.tex2&&pick.tex2&&pickRef.tex2.dispose)pickRef.tex2.dispose();
pickRef.tex=pick.tex;
if(pick.tex2)pickRef.tex2=pick.tex2;
if(pickRef.uniform)pickRef.uniform.value=pick.tex;
if(pickRef.uniform2&&pick.tex2)pickRef.uniform2.value=pick.tex2;
}
function oldMap(url){
if(oldMap.cache[url])return oldMap.cache[url];
const t=loadTex(url,"#8a8a8a");
oldMap.cache[url]=t;return t;
}
oldMap.cache={};
function buildOldAtlas(){
const c=document.createElement("canvas");c.width=256;c.height=96;
const g=c.getContext("2d");g.fillStyle="#6cbf4a";g.fillRect(0,0,256,96);
const t=new THREE.CanvasTexture(c);t.flipY=false;crisp(t);t.wrapS=t.wrapT=THREE.ClampToEdgeWrapping;
const grass=new Image(),dirt=new Image(),road=new Image();
let left=3;
function paint(){
if(--left)return;
for(let i=0;i<21;i++){
const img=i<7?grass:i<20?dirt:road;
try{g.drawImage(img,(i%8)*32,Math.floor(i/8)*32,32,32);}catch(e){}
}
t.needsUpdate=true;
}
grass.onload=paint;dirt.onload=paint;road.onload=paint;
grass.src=TB_ROOT+"textures/nature/grass_64.png";
dirt.src=TB_ROOT+"textures/nature/dirt_64.png";
road.src=TB_ROOT+"textures/nature/road_sandstone_64.png";
return t;
}
function setOldTiles(on){
on=!!on;
if(setOldTiles.cur===on&&setOldTiles.mat===groundMat)return;
if(!on&&!setOldTiles.used){setOldTiles.cur=false;setOldTiles.mat=groundMat;return}
setOldTiles.used=true;
setOldTiles.cur=on;
setOldTiles.mat=groundMat;
const mats=[
[MAT.leaf,TB_ROOT+"textures/nature/leaf_64.png"],
[MAT.pine,TB_ROOT+"textures/nature/leaf_64.png"],
[MAT.autumn,TB_ROOT+"textures/nature/leaf_64.png"],
[MAT.bark,TB_ROOT+"textures/nature/bark_64.png"],
[MAT.timber,TB_ROOT+"textures/nature/bark_64.png"],
[MAT.planks,TB_ROOT+"textures/nature/bark_64.png"],
[MAT.crate,TB_ROOT+"textures/nature/bark_64.png"],
[MAT.rock,TB_ROOT+"textures/nature/rock_64.png"],
[MAT.stone,TB_ROOT+"textures/nature/rock_64.png"],
[MAT.cobble,TB_ROOT+"textures/nature/rock_64.png"],
[MAT.slate,TB_ROOT+"textures/nature/rock_64.png"],
[MAT.clay,TB_ROOT+"textures/nature/dirt_64.png"],
[MAT.plaster,TB_ROOT+"textures/nature/dirt_64.png"],
[MAT.adobe,TB_ROOT+"textures/nature/dirt_64.png"]
];
mats.forEach(function(p){
if(!p[0])return;
if(!p[0].userData.v3)p[0].userData.v3=p[0].map;
p[0].map=on?oldMap(p[1]):p[0].userData.v3;
p[0].needsUpdate=true;
});
if(!groundMat)return;
if(groundBiome){if(atlasNew)groundMat.map=atlasNew;}
else if(on){if(!atlasOld)atlasOld=buildOldAtlas();groundMat.map=atlasOld;}
else if(atlasNew)groundMat.map=atlasNew;
groundMat.needsUpdate=true;
}
if(typeof fetch==="function"){
fetch(TB_ROOT+"textures/tiles_v3/biomes_48.json").then(function(r){if(!r.ok)throw new Error("HTTP "+r.status);return r.json();}).then(loadBiomeTable).catch(function(e){
console.warn("biome table",e);
loadBiomeTable({biomes:[],pair_sets:[]});
});
}


/* ---------- geometry helpers ---------- */
function facetUV(geo,k,rand){
const g=geo.index?geo.toNonIndexed():geo.clone();
const pos=g.attributes.position;
const nrm=new Float32Array(pos.count*3),uv=new Float32Array(pos.count*2);
for(let i=0;i<pos.count;i+=3){
const ax=pos.getX(i),ay=pos.getY(i),az=pos.getZ(i);
const bx=pos.getX(i+1),by=pos.getY(i+1),bz=pos.getZ(i+1);
const cxp=pos.getX(i+2),cy=pos.getY(i+2),cz=pos.getZ(i+2);
let nx=(by-ay)*(cz-az)-(bz-az)*(cy-ay);
let ny=(bz-az)*(cxp-ax)-(bx-ax)*(cz-az);
let nz=(bx-ax)*(cy-ay)-(by-ay)*(cxp-ax);
let ln=Math.hypot(nx,ny,nz)||1;nx/=ln;ny/=ln;nz/=ln;
let ux=nz,uy=0,uz=-nx;
if(ux*ux+uy*uy+uz*uz<1e-8){ux=1;uy=0;uz=0;}
else{const ul=Math.hypot(ux,uy,uz);ux/=ul;uy/=ul;uz/=ul;}
let vx=ny*uz-nz*uy,vy=nz*ux-nx*uz,vz=nx*uy-ny*ux;
const vl=Math.hypot(vx,vy,vz)||1;vx/=vl;vy/=vl;vz/=vl;
let ox=0,oy=0;
if(rand){
const plane=Math.round((ax*nx+ay*ny+az*nz)*4);
let h=(Math.imul(Math.round(nx*50),73856093)^Math.imul(Math.round(ny*50),19349663)^Math.imul(plane,83492791))>>>0;
ox=(h&255)/255;oy=((h>>>8)&255)/255;
}
for(let kvi=0;kvi<3;kvi++){
const x=pos.getX(i+kvi),y=pos.getY(i+kvi),z=pos.getZ(i+kvi),j=i+kvi;
nrm[j*3]=nx;nrm[j*3+1]=ny;nrm[j*3+2]=nz;
uv[j*2]=(x*ux+y*uy+z*uz)*k+ox;uv[j*2+1]=(x*vx+y*vy+z*vz)*k+oy;
}
}
g.setAttribute("normal",new THREE.BufferAttribute(nrm,3));
g.setAttribute("uv",new THREE.BufferAttribute(uv,2));
return g;
}
function addBox(parent,w,h,d,x,y,z,mat){
const m=new THREE.Mesh(facetUV(new THREE.BoxGeometry(w,h,d),K,false),mat);
m.position.set(x,y,z);m.castShadow=m.receiveShadow=true;parent.add(m);return m;
}
function plane(w,h,mat){
const m=new THREE.Mesh(new THREE.PlaneGeometry(w,h),mat);
m.castShadow=m.receiveShadow=true;return m;
}

/* ---------- trees ---------- */
function trunkGeo(r,h){
const seg=8,tiles=Math.max(1,Math.round(2*Math.PI*r*16/32)),vTiles=h*16/32;
const pos=[],nrm=[],uv=[],idx=[];
for(let y=0;y<=1;y++)for(let i=0;i<=seg;i++){
const u=i/seg,th=u*Math.PI*2;
pos.push(Math.sin(th)*r*(y?1:1.12),y*h,Math.cos(th)*r*(y?1:1.12));
nrm.push(Math.sin(th),0,Math.cos(th));
uv.push(u*tiles,y*vTiles);
}
for(let i=0;i<seg;i++){const a=i,b=i+1,c=seg+1+i,d=seg+1+i+1;idx.push(a,c,b,b,c,d);}
const g=new THREE.BufferGeometry();
g.setAttribute("position",new THREE.Float32BufferAttribute(pos,3));
g.setAttribute("normal",new THREE.Float32BufferAttribute(nrm,3));
g.setAttribute("uv",new THREE.Float32BufferAttribute(uv,2));
g.setIndex(idx);
g.rotateY(Math.PI/4-0.58*Math.PI*2);
return g;
}
/* One drooping pine tier: wide scalloped brim, narrower tip, the brim sags. */
function pineTier(R,H){
const seg=14,rows=4,tiles=Math.max(1,Math.round(2*Math.PI*R*TPM/32));
const pos=[],uv=[],idx=[];
for(let y=0;y<=rows;y++){
const t=y/rows;
const droop=Math.pow(1-t,2)*R*0.62;
const flare=1+0.22*Math.pow(1-t,2);
const rad=R*(1-t)*flare;
for(let i=0;i<=seg;i++){
const u=i/seg,th=u*Math.PI*2;
const jag=y===0&&i%2===0?1.2:1;
pos.push(Math.sin(th)*rad*jag,t*H-droop,Math.cos(th)*rad*jag);
uv.push(u*tiles,(t*H+droop)*TPM/32);
}
}
for(let y=0;y<rows;y++)for(let i=0;i<seg;i++){
const a=y*(seg+1)+i,b=a+1,c=a+(seg+1),d=c+1;
idx.push(a,c,b,b,c,d);
}
const g=new THREE.BufferGeometry();
g.setAttribute("position",new THREE.Float32BufferAttribute(pos,3));
g.setAttribute("uv",new THREE.Float32BufferAttribute(uv,2));
g.setIndex(idx);g.computeVertexNormals();return g;
}
let pineParts=null;
function pineGeos(){
if(pineParts)return pineParts;
const tiers=[[1.9,1.05,1.05],[1.6,.95,1.75],[1.32,.88,2.4],[1.05,.8,3.0],[.78,.7,3.55],[.5,.58,4.05]];
pineParts=[{geo:trunkGeo(.2,1.85),mat:MAT.bark,trunk:1}];
tiers.forEach(function(t){pineParts.push({geo:pineTier(t[0],t[1]),mat:MAT.pine,y:t[2]});});
return pineParts;
}
function addPines(scene,spots){
if(!spots.length)return;
const dummy=new THREE.Object3D();
pineGeos().forEach(function(part){
const im=new THREE.InstancedMesh(part.geo,part.mat,spots.length);
spots.forEach(function(s,i){
dummy.position.set(s.x,(s.y||0)+(part.y||0)*s.s,s.z);
dummy.rotation.set(0,s.yaw||0,0);
dummy.scale.setScalar(s.s);
dummy.updateMatrix();im.setMatrixAt(i,dummy.matrix);
});
im.instanceMatrix.needsUpdate=true;im.castShadow=im.receiveShadow=true;im.frustumCulled=false;
noteWind(im);scene.add(im);
});
}
function makePine(s){
const g=new THREE.Group();g.scale.setScalar(s);
pineGeos().forEach(function(part){
const m=new THREE.Mesh(part.geo,part.mat);
if(part.y)m.position.y=part.y;
m.castShadow=m.receiveShadow=true;
if(part.trunk)m.name="trunk";
g.add(m);
});
noteWind(g);return g;
}
function blobGeo(r,seed,squash){
const g=new THREE.IcosahedronGeometry(r,1);
const p=g.attributes.position;
for(let i=0;i<p.count;i++){
const x=p.getX(i),y=p.getY(i),z=p.getZ(i),len=Math.hypot(x,y,z)||1;
let ny=y/len;
let lump=1+.1*Math.sin(x*3.1+seed)+.08*Math.sin(z*2.7+seed*1.7);
if(ny<0)lump*=.88;
let yy=y*squash;if(ny<0)yy*=.7;
p.setXYZ(i,x/len*r*lump,yy/len*r*lump,z/len*r*lump);
}
g.computeVertexNormals();
const nrm=g.attributes.normal,uv=new Float32Array(p.count*2);
for(let i=0;i<p.count;i++){
const x=p.getX(i),y=p.getY(i),z=p.getZ(i);
const nx=Math.abs(nrm.getX(i)),ny=Math.abs(nrm.getY(i)),nz=Math.abs(nrm.getZ(i));
let u,v;if(ny>=nx&&ny>=nz){u=x;v=z;}else if(nx>=nz){u=z;v=y;}else{u=x;v=y;}
uv[i*2]=u*K;uv[i*2+1]=v*K;
}
g.setAttribute("uv",new THREE.BufferAttribute(uv,2));
return g;
}
function addClump(g,mat,x,y,z,r,seed){
const m=new THREE.Mesh(blobGeo(r,seed,.84),mat);
m.position.set(x,y,z);m.castShadow=m.receiveShadow=true;g.add(m);return m;
}
function addCards(g,mat,spots){
spots.forEach(function(s){
const m=plane(s[3]||.55,s[4]||.42,mat);
m.position.set(s[0],s[1],s[2]);m.rotation.y=s[5]||0;m.castShadow=true;g.add(m);
});
}
function makeBroadleaf(s,seed,autumn){
const g=new THREE.Group();g.scale.setScalar(s);
const trunk=new THREE.Mesh(trunkGeo(.2,1.55),MAT.bark);trunk.name="trunk";trunk.castShadow=trunk.receiveShadow=true;g.add(trunk);
const leaf=autumn?MAT.autumn:MAT.leaf;
const clumps=[[0,.35,0,1.05],[.72,.2,.28,.62],[-.68,.28,-.18,.6],[.22,.55,-.62,.55],[-.3,.62,.55,.52],[.85,.5,-.2,.42],[-.82,.48,.3,.44],[.1,.95,.08,.5],[-.42,.9,-.32,.4],[.48,.88,.38,.38],[0,1.25,0,.36],[-.15,.4,.85,.4],[.2,-.05,-.15,.48]];
clumps.forEach(function(b,i){addClump(g,leaf,b[0],1.7+b[1],b[2],b[3],seed+i);});
[[1.15,2.15,.15,.42],[-1.05,2.3,-.1,.38],[.15,2.75,.85,.34],[-.25,2.6,-.95,.36],[.9,1.9,-.75,.32],[-.95,1.95,.7,.32]].forEach(function(b,i){
addClump(g,leaf,b[0],b[1],b[2],b[3],seed+20+i);
});
noteWind(g);return g;
}
function makeBush(s,seed){
const g=new THREE.Group();g.scale.setScalar(s);
[[0,.05,0,.58],[.32,.16,.12,.4],[-.28,.1,-.18,.38],[.08,.32,-.22,.32],[-.12,.28,.26,.3],[.22,.02,-.28,.28]].forEach(function(b,i){
addClump(g,MAT.leaf,b[0],b[3]*.45+b[1],b[2],b[3],seed+i);
});
[[.45,.55,.12,.22],[-.38,.48,-.16,.2],[.05,.72,.28,.18]].forEach(function(b,i){addClump(g,MAT.leaf,b[0],b[1],b[2],b[3],seed+10+i);});
const sprig=plane(.32,.32,MAT[["flowerR","flowerY","flowerW"][Math.abs(seed|0)%3]]);
sprig.position.set(.12,.62,.2);g.add(sprig);
noteWind(g);return g;
}
function isTree(f){return /tree_|fir|spruce|oak|conifer/.test(f);}
function isPine(f){return /fir|spruce|conifer|pine/.test(f);}
function isBush(f){return /bush|shrub/.test(f);}
function makeTree(f,s,x,z){
const sc=(s&&s>.65)?s:.9;
if(isPine(f))return makePine(sc);
const seed=Math.round(x*3+z*5);
return makeBroadleaf(sc,seed,(seed%5)===0);
}
function faceKnot(group,yaw){
const trunk=group.getObjectByName("trunk");
if(trunk)trunk.rotation.y=-yaw;
}

/* ---------- props ---------- */
function kindOf(f){
f=(f||"").toLowerCase();
if(/crate|box/.test(f))return "crate";
if(/tent/.test(f))return "canvas";
if(/log|stump/.test(f))return "bark";
if(/barrel/.test(f))return "bark";
if(/rock|stone/.test(f))return "rock";
if(/fence|stand|guidepost|table|bench|wagon|carriage|cart/.test(f))return "wood";
return "";
}
function projectMesh(mesh,mat,k){
const g=facetUV(mesh.geometry,k,false);
mesh.geometry=g;mesh.material=mat;
}
function makeCrate(w,h,d,topMat){
const g=new THREE.Group();
function side(sx,sy,px,py,pz,ry){
const m=plane(sx,sy,MAT.crate);m.position.set(px,py,pz);m.rotation.y=ry;g.add(m);
}
side(w,h,0,h/2,d/2,0);
side(w,h,0,h/2,-d/2,Math.PI);
side(d,h,w/2,h/2,0,Math.PI/2);
side(d,h,-w/2,h/2,0,-Math.PI/2);
const top=plane(w,d,topMat||MAT.planks);top.rotation.x=-Math.PI/2;top.position.y=h;
const uv=top.geometry.attributes.uv;
for(let i=0;i<uv.count;i++)uv.setXY(i,uv.getX(i)*w*K,uv.getY(i)*d*K);
g.add(top);return g;
}
function dress(o,file,stripe){
const kind=kindOf(file);if(!kind||!o)return;
const meshes=[];o.traverse(n=>{if(n.isMesh)meshes.push(n);});
if(kind==="crate"){
meshes.forEach(m=>{
if(!m.geometry.boundingBox)m.geometry.computeBoundingBox();
const bb=m.geometry.boundingBox;
const c=makeCrate(Math.max(.2,bb.max.x-bb.min.x),Math.max(.2,bb.max.y-bb.min.y),Math.max(.2,bb.max.z-bb.min.z),MAT.planks);
c.position.set((bb.min.x+bb.max.x)/2,bb.min.y,(bb.min.z+bb.max.z)/2);
(m.parent||o).add(c);m.visible=false;
});
return;
}
if(kind==="rock"){meshes.forEach(m=>{m.geometry=facetUV(m.geometry,KR,true);m.material=MAT.rock;});return;}
if(kind==="canvas"){meshes.forEach(m=>projectMesh(m,MAT.canvas,K));return;}
if(kind==="bark"){meshes.forEach(m=>projectMesh(m,MAT.bark,K));return;}
if(kind==="wood"){
const awning=/stand/.test(file)?(stripe==="blue"?MAT.awningB:MAT.awning):(/wagon|carriage|cart/.test(file)?MAT.canvas:null);
meshes.forEach(m=>{
if(!awning){projectMesh(m,MAT.planks,K);return;}
const g=m.geometry.index?m.geometry.toNonIndexed():m.geometry.clone();
const pos=g.attributes.position;let minY=1e9,maxY=-1e9;
for(let i=0;i<pos.count;i++){const y=pos.getY(i);if(y<minY)minY=y;if(y>maxY)maxY=y;}
const mid=minY+(maxY-minY)*.55;
const buckets={planks:[],awning:[]};
for(let i=0;i<pos.count;i+=3){
const y=(pos.getY(i)+pos.getY(i+1)+pos.getY(i+2))/3;
const ax=pos.getX(i),ay=pos.getY(i),az=pos.getZ(i);
const bx=pos.getX(i+1),by=pos.getY(i+1),bz=pos.getZ(i+1);
const cx=pos.getX(i+2),cy=pos.getY(i+2),cz=pos.getZ(i+2);
let ny=(bz-az)*(cx-ax)-(bx-ax)*(cz-az);
const up=ny>0&&y>mid;
(up?buckets.awning:buckets.planks).push(ax,ay,az,bx,by,bz,cx,cy,cz);
}
function bake(arr,mat){
if(!arr.length)return;
const bg=new THREE.BufferGeometry();
bg.setAttribute("position",new THREE.Float32BufferAttribute(arr,3));
const mesh=new THREE.Mesh(facetUV(bg,K,false),mat);
mesh.castShadow=mesh.receiveShadow=true;(m.parent||o).add(mesh);
}
bake(buckets.planks,MAT.planks);bake(buckets.awning,awning);m.visible=false;
});
}
}

/* ---------- village, stream, bridge ---------- */
/* Meadow brook. channelDrop is the ditch depth; groundY subtracts it. */
const STREAM=[[8,74],[7.4,64],[8.6,52],[10.2,40],[10.6,32.4],[9.2,22],[11.4,10],[8.6,-6]];
function streamDist(x,z){
let best=1e9;
for(let i=0;i<STREAM.length-1;i++){
const ax=STREAM[i][0],az=STREAM[i][1],bx=STREAM[i+1][0],bz=STREAM[i+1][1];
const dx=bx-ax,dz=bz-az,l2=dx*dx+dz*dz||1e-6;
let u=((x-ax)*dx+(z-az)*dz)/l2;if(u<0)u=0;else if(u>1)u=1;
const d=Math.hypot(x-(ax+dx*u),z-(az+dz*u));if(d<best)best=d;
}
return best;
}
function inWater(x,z){return streamDist(x,z)<2.35;}
function channelDrop(x,z){
if(x<-4||x>28||z<-14||z>82)return 0;
const R=2.7,d=streamDist(x,z);if(d>=R)return 0;
const u=1-d/R,s=u*u*(3-2*u);
let drop=.95*s;
/* the path crosses at the bridge: keep the ditch under the arch, lift the approaches to grade */
const dz=Math.abs(z-32.4),dx=Math.abs(x-10.6);
if(dz<2.4&&dx>1.25){
const path=dz<1.15?1:(2.4-dz)/1.25,bank=Math.min(1,(dx-1.25)/1.45),k=path*path*(3-2*path);
drop*=1-k*bank;
}
return drop;
}
function block(BX,x,z,w,d,h){if(BX)BX.push({x:x,z:z,w:w,d:d,h:h});blocks.push({x:x,z:z,w:w,d:d});}
function occupies(x,z){for(let i=0;i<blocks.length;i++){const b=blocks[i];if(Math.abs(x-b.x)<b.w*.5+.5&&Math.abs(z-b.z)<b.d*.5+.5)return true;}return false;}
/* one house: foundation, a single plaster shell, timber on every face, roof seated on the plate.
   Meadow calls omit the sizing fields, so found / wall / rise / base stay the values this was tuned with.
   Area lots pass found, wallH, rise, baseY and wallMat. */
function house(parent,groundY,o){
const g=new THREE.Group(),fw=o.w||3.6,fd=o.d||3.05,floors=o.floors===2?2:1;
const found=o.found!=null?o.found:.4,wallH=o.wallH!=null?o.wallH:(floors===2?3.2:2.35),rise=o.rise!=null?o.rise:(floors===2?1.55:1.45),roofM=o.roofMat||(o.slate?MAT.slate:MAT.clay);
const wallMat=o.wallMat||MAT.plaster;
const y=o.baseY!=null?o.baseY:groundY(o.x,o.z),beam=.22,yTop=found+wallH;
const yMid=found+(o.wallH!=null?(floors===2?wallH*0.34:wallH*0.48):1.15),yPlate=yTop-beam*.35;
const story=o.wallH!=null?wallH*0.63:2.02;
addBox(g,fw+.42,found,fd+.42,0,found/2,0,MAT.stone);
addBox(g,fw,wallH,fd,0,found+wallH/2,0,wallMat);
[[-1,-1],[1,-1],[1,1],[-1,1]].forEach(function(s){addBox(g,beam,wallH,beam,s[0]*(fw/2),found+wallH/2,s[1]*(fd/2),MAT.timber);});
function railX(yR,xSign){addBox(g,beam,beam,fd+beam,xSign*(fw/2),yR,0,MAT.timber);}
function railBack(yR){addBox(g,fw+beam,beam,beam,0,yR,-fd/2,MAT.timber);}
[-1,1].forEach(function(s){railX(found+.08,s);railX(yMid,s);railX(yPlate,s);});
[found+.08,yMid,yPlate].forEach(railBack);
addBox(g,fw+beam,beam,beam,0,yPlate,fd/2,MAT.timber);
const doorW=.86,doorH=1.7,gap=doorW/2+.08;
if(o.door===0){
addBox(g,fw+beam,beam,beam,0,found+.08,fd/2,MAT.timber);
addBox(g,fw+beam,beam,beam,0,yMid,fd/2,MAT.timber);
}else{
[-1,1].forEach(function(s){
const len=fw/2-gap,cx=s*(gap+len/2);
addBox(g,len,beam,beam,cx,found+.08,fd/2,MAT.timber);
addBox(g,len,beam,beam,cx,yMid,fd/2,MAT.timber);
addBox(g,beam,wallH,beam,s*(doorW/2+.02),found+wallH/2,fd/2,MAT.timber);
addBox(g,beam,wallH,beam,s*(fw*.30+.38),found+wallH/2,fd/2,MAT.timber);
});
}
addBox(g,beam,wallH,beam,0,found+wallH/2,-fd/2,MAT.timber);
if(floors===2){
const yFloor=found+story;
[-1,1].forEach(function(s){railX(yFloor,s);});
railBack(yFloor);
addBox(g,fw+beam,beam,beam,0,yFloor,fd/2,MAT.timber);
}
gable(g,fw,fd,rise,yTop,roofM,sideMat(wallMat));
if(o.chimney!==0){
const chimX=fw*.2,chimZ=-fd*.22;
const roofAt=yTop+rise*(1-Math.abs(chimZ)/(fd/2)),chimH=1.02;
addBox(g,.4,chimH,.4,chimX,roofAt-.18+chimH/2,chimZ,MAT.stone);
addBox(g,.52,.1,.52,chimX,roofAt-.18+chimH,chimZ,MAT.stone);
}
if(o.door!==0){
const dz=fd/2+.03,doorY=found+doorH/2;
addBox(g,doorW-.16,doorH-.08,.05,0,doorY,dz,MAT.dark);
addBox(g,.1,doorH+.04,.1,-doorW/2,doorY,dz+.03,MAT.timber);
addBox(g,.1,doorH+.04,.1,doorW/2,doorY,dz+.03,MAT.timber);
addBox(g,doorW+.12,.12,.1,0,found+doorH,dz+.03,MAT.timber);
}
function winZ(x,wy,flower){
const ww=.56,wh=.64,z=fd/2+.025;
addBox(g,ww-.12,wh-.12,.04,x,wy,z,MAT.glass);
addBox(g,.08,wh,.08,x-ww/2,wy,z+.03,MAT.timber);
addBox(g,.08,wh,.08,x+ww/2,wy,z+.03,MAT.timber);
addBox(g,ww+.08,.08,.08,x,wy+wh/2,z+.03,MAT.timber);
addBox(g,ww,.08,.08,x,wy-wh/2,z+.03,MAT.timber);
if(!flower)return;
addBox(g,ww+.14,.1,.18,x,wy-wh/2,z+.12,MAT.timber);
const a=plane(.18,.2,MAT.flowerR);a.position.set(x-.1,wy-wh/2+.1,z+.24);g.add(a);
const b=plane(.18,.2,MAT.flowerW);b.position.set(x+.1,wy-wh/2+.12,z+.24);g.add(b);
}
function winX(wz,wy,xSign){
const ww=.5,wh=.58,x=xSign*(fw/2+.025),o=xSign*.03;
addBox(g,.04,wh-.1,ww-.1,x,wy,wz,MAT.glass);
addBox(g,.08,wh,.08,x+o,wy,wz-ww/2,MAT.timber);
addBox(g,.08,wh,.08,x+o,wy,wz+ww/2,MAT.timber);
addBox(g,.08,.08,ww+.08,x+o,wy+wh/2,wz,MAT.timber);
addBox(g,.08,.08,ww,x+o,wy-wh/2,wz,MAT.timber);
}
const winY=yMid+.08+.32,flower=o.flowers!==0;
winZ(-fw*.30,winY,flower);winZ(fw*.30,winY,flower);
winX(-fd*.16,winY,-1);winX(fd*.16,winY,1);
if(fw>8){
winZ(-fw*.15,winY,false);winZ(fw*.15,winY,false);
winZ(-fw*.45,winY,flower);winZ(fw*.45,winY,flower);
const n=Math.max(2,Math.round(fw/4));
for(let i=1;i<n;i++){
const x=-fw/2+fw*i/n;
if(o.door!==0&&Math.abs(x)<doorW*0.85)continue;
addBox(g,beam,wallH,beam,x,found+wallH/2,fd/2,MAT.timber);
addBox(g,beam,wallH,beam,x,found+wallH/2,-fd/2,MAT.timber);
}
}
if(fd>8){winX(-fd*.38,winY,-1);winX(fd*.38,winY,-1);winX(-fd*.38,winY,1);winX(fd*.38,winY,1);}
if(floors===2){
const uy=found+story+.14+.32;
winZ(-fw*.30,uy,false);winZ(fw*.30,uy,false);winZ(0,uy,false);
winX(-fd*.16,uy,-1);winX(fd*.16,uy,1);
if(fw>8){winZ(-fw*.15,uy,false);winZ(fw*.15,uy,false);winZ(-fw*.45,uy,false);winZ(fw*.45,uy,false);}
if(fd>8){winX(-fd*.38,uy,-1);winX(fd*.38,uy,-1);winX(-fd*.38,uy,1);winX(fd*.38,uy,1);}
}
if(o.sign&&o.door!==0){const board=plane(1.25,.38,o.sign);board.position.set(0,found+doorH+.3,fd/2+.3);g.add(board);}
g.position.set(o.x,y,o.z);g.rotation.y=o.yaw||0;
g.traverse(function(n){if(n.isMesh)n.castShadow=n.receiveShadow=true;});
parent.add(g);return g;
}
/* Roof sits on the plate: at the wall face the tiles are at y0, and the eave continues the slope past the wall. */
const sideCache=new Map();
function sideMat(src){
if(!src||src===MAT.plaster)return null;
let m=sideCache.get(src);
if(!m){m=src.clone();m.side=THREE.DoubleSide;sideCache.set(src,m);}
return m;
}
function gable(parent,w,d,rise,y0,mat,endMat){
const hw=w/2,hd=d/2,oh=.38,k=K,thick=.16;
const yE=y0-rise*(oh/hd);
function addMesh(pos,uv,mat){
const geo=new THREE.BufferGeometry();
geo.setAttribute("position",new THREE.Float32BufferAttribute(pos,3));
geo.setAttribute("uv",new THREE.Float32BufferAttribute(uv,2));
geo.computeVertexNormals();
const m=new THREE.Mesh(geo,mat);m.castShadow=m.receiveShadow=true;parent.add(m);
}
function slope(sign){
const zE=sign*(hd+oh);
const eL=[-hw-oh,yE,zE],eR=[hw+oh,yE,zE],rR=[hw+oh,y0+rise,0],rL=[-hw-oh,y0+rise,0];
let tris=sign>0?[[eL,eR,rR],[eL,rR,rL]]:[[eR,eL,rL],[eR,rL,rR]];
const pos=[],uv=[];
tris.forEach(function(t){
const ax=t[1][0]-t[0][0],az=t[1][2]-t[0][2],bx=t[2][0]-t[0][0],bz=t[2][2]-t[0][2];
const ny=az*bx-ax*bz;if(ny<0){const s=t[1];t[1]=t[2];t[2]=s;}
t.forEach(function(p){
pos.push(p[0],p[1],p[2]);
uv.push((p[0]+hw+oh)*k,Math.hypot(p[2]-zE,p[1]-yE)*k);
});
});
/* a second skin just under the tiles so the eave has an edge and the soffit reads */
const n=pos.length;
for(let i=0;i<n;i+=9){
const x1=pos[i],y1=pos[i+1],z1=pos[i+2],x2=pos[i+3],y2=pos[i+4],z2=pos[i+5],x3=pos[i+6],y3=pos[i+7],z3=pos[i+8];
pos.push(x1,y1-thick,z1,x3,y3-thick,z3,x2,y2-thick,z2);
uv.push(uv[i/3*2],uv[i/3*2+1],uv[(i+6)/3*2],uv[(i+6)/3*2+1],uv[(i+3)/3*2],uv[(i+3)/3*2+1]);
}
addMesh(pos,uv,mat);
addBox(parent,w+oh*2,.1,.1,0,yE+.02,zE,MAT.timber);
}
slope(1);slope(-1);
function end(xSign){
const xo=xSign*hw,xi=xSign*(hw-.16);
const oBL=[xo,y0,-hd],oBR=[xo,y0,hd],oP=[xo,y0+rise,0];
const iBL=[xi,y0,-hd],iBR=[xi,y0,hd],iP=[xi,y0+rise,0];
const pos=[],uv=[];
function push(a,b,c){[a,b,c].forEach(function(p){pos.push(p[0],p[1],p[2]);uv.push((p[2]+hd)*k,(p[1]-y0)*k);});}
push(oBL,oBR,oP);push(iBL,iP,iBR);
push(oBL,oP,iP);push(oBL,iP,iBL);
push(oBR,iBR,iP);push(oBR,iP,oP);
if(!end.mat){end.mat=MAT.plaster.clone();end.mat.side=THREE.DoubleSide;}
addMesh(pos,uv,endMat||end.mat);
}
end(1);end(-1);
addBox(parent,w+oh*2,.14,.16,0,y0+rise+.04,0,MAT.timber);
}
function well(parent,groundY,x,z){
const g=new THREE.Group(),y=groundY(x,z);
const ring=new THREE.Mesh(new THREE.CylinderGeometry(.7,.8,.7,10),MAT.stone);
ring.position.y=.35;ring.castShadow=ring.receiveShadow=true;
const uv=ring.geometry.attributes.uv;
for(let i=0;i<uv.count;i++)uv.setXY(i,uv.getX(i)*2,uv.getY(i)*.4);
g.add(ring);
addBox(g,.12,1.3,.12,-.55,.9,0,MAT.timber);
addBox(g,.12,1.3,.12,.55,.9,0,MAT.timber);
addBox(g,1.3,.1,.12,0,1.55,0,MAT.timber);
const sign=plane(.9,.3,MAT.signWell);sign.position.set(0,1.15,.6);g.add(sign);
g.position.set(x,y,z);parent.add(g);
}
function stall(parent,groundY,x,z,yaw,blue){
const g=new THREE.Group(),y=groundY(x,z);
addBox(g,1.6,.9,1.1,0,.45,0,MAT.planks);
const bin=makeCrate(1.3,.35,1.0,Math.abs(x+z)%2?MAT.apple:MAT.green);
bin.position.y=.9;g.add(bin);
[[-.7,.2],[-.7,-.2],[.7,.2],[.7,-.2]].forEach(function(p){addBox(g,.1,1.5,.1,p[0],.75,p[1],MAT.timber);});
const aw=plane(2.3,1.15,blue?MAT.awningB:MAT.awning);
aw.position.set(0,1.55,.15);aw.rotation.x=.55;g.add(aw);
g.position.set(x,y,z);g.rotation.y=yaw||0;parent.add(g);
}
function pot(parent,groundY,x,z,s){
const g=new THREE.Mesh(new THREE.CylinderGeometry(.18*s,.26*s,.34*s,8),MAT.pot);
g.position.set(x,groundY(x,z)+.17*s,z);g.castShadow=g.receiveShadow=true;parent.add(g);
}
function palm(parent,groundY,x,z){
const g=new THREE.Group(),y=groundY(x,z);
const trunk=new THREE.Mesh(trunkGeo(.16,2.4),MAT.bark);trunk.castShadow=true;g.add(trunk);
for(let i=0;i<6;i++){
const fr=plane(1.5,.7,MAT.palm);
fr.position.set(Math.sin(i)*0.15,2.35,Math.cos(i)*.15);
fr.rotation.y=i;fr.rotation.z=.7;g.add(fr);
}
g.position.set(x,y,z);noteWind(g);parent.add(g);
}
function adobeHouse(parent,groundY,x,z,yaw){
const g=new THREE.Group(),y=groundY(x,z),w=4.2,d=3.4,h=2.8;
addBox(g,w+1.2,.7,d+1.2,0,.35,0,MAT.adobe);
addBox(g,w,h,d,0,.7+h/2,0,MAT.adobe);
addBox(g,w+1.1,.28,d+1.1,0,.7+h+.1,0,MAT.adobe);
addBox(g,.7,1.6,.12,0,.7+.9,d/2+.04,MAT.dark);
/* wind tower */
addBox(g,1.1,2.4,1.1,w*.2,.7+h+1.3,0,MAT.adobe);
addBox(g,.7,.35,.12,w*.2,.7+h+2.2,.56,MAT.dark);
addBox(g,.7,.35,.12,w*.2,.7+h+2.2,-.56,MAT.dark);
g.position.set(x,y,z);g.rotation.y=yaw||0;
g.traverse(n=>{if(n.isMesh)n.castShadow=n.receiveShadow=true;});
parent.add(g);return g;
}
function ribbon(pts,half,lift,mat,yAt){
const L=[],R=[],acc=[0];
for(let i=0;i<pts.length;i++){
const a=pts[Math.max(0,i-1)],b=pts[Math.min(pts.length-1,i+1)];
let dx=b[0]-a[0],dz=b[1]-a[1],ln=Math.hypot(dx,dz)||1;dx/=ln;dz/=ln;
L.push([pts[i][0]-dz*half,pts[i][1]+dx*half]);
R.push([pts[i][0]+dz*half,pts[i][1]-dx*half]);
if(i)acc.push(acc[i-1]+Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1]));
}
const pos=[],uv=[],nrm=[],ind=[];
for(let i=0;i<pts.length;i++){
const y=yAt(pts[i][0],pts[i][1])+lift;
pos.push(L[i][0],y,L[i][1],R[i][0],y,R[i][1]);
uv.push(acc[i]*K,0,acc[i]*K,half*2*K);
nrm.push(0,1,0,0,1,0);
if(i){const o=(i-1)*2;ind.push(o,o+2,o+1,o+1,o+2,o+3);}
}
const geo=new THREE.BufferGeometry();
geo.setAttribute("position",new THREE.Float32BufferAttribute(pos,3));
geo.setAttribute("normal",new THREE.Float32BufferAttribute(nrm,3));
geo.setAttribute("uv",new THREE.Float32BufferAttribute(uv,2));
geo.setIndex(ind);
const m=new THREE.Mesh(geo,mat);m.receiveShadow=true;m.userData.surface=1;return m;
}
function offsetLine(pts,dist){
return pts.map(function(p,i){
const a=pts[Math.max(0,i-1)],b=pts[Math.min(pts.length-1,i+1)];
let dx=b[0]-a[0],dz=b[1]-a[1],ln=Math.hypot(dx,dz)||1;dx/=ln;dz/=ln;
return [p[0]-dz*dist,p[1]+dx*dist];
});
}
/* Long arched bridge. The deck is a gentle hump the player can walk; the stone ring under it is a round arch of light blocks. */
function bridge(parent,grade,x,z,yaw){
const g=new THREE.Group();
const len=12.6,wid=2.55,endH=.18,crown=1.62,slab=.2;
const Yc=-.22,Rin=1.28,thick=.46,Rmid=Rin+thick/2,maxA=1.78,n=14;
const archMat=unlit(T.stone);archMat.side=THREE.DoubleSide;
function deckTop(lx){
const u=Math.min(1,Math.abs(lx)/(len/2));
const s=.5+.5*Math.cos(Math.PI*u);
return endH+(crown-endH)*s;
}
for(let i=0;i<16;i++){
const lx=-len/2+(i+.5)*len/16;
const y=deckTop(lx);
addBox(g,len/16*1.08,slab,wid,lx,y-slab/2,0,MAT.cobble);
[-1,1].forEach(function(s){
addBox(g,len/16*1.08,.34,.16,lx,y+.16,s*(wid/2-.1),MAT.stone);
});
}
for(let i=0;i<n;i++){
const a=-maxA+(i+.5)/n*2*maxA;
const chord=(2*maxA*Rmid/n)*1.08;
const m=addBox(g,chord,thick,wid-.2,Math.sin(a)*Rmid,Yc+Math.cos(a)*Rmid,0,archMat);
m.rotation.z=-a;
}
/* spandrels: stone from the arch's shoulders up to the deck, so the ring reads as part of the bridge */
const shoulders=[-1.7,-.9,.9,1.7];
shoulders.forEach(function(lx){
const top=deckTop(lx)-slab;
const foot=Yc+Math.cos(Math.min(maxA,Math.abs(Math.asin(Math.min(1,Math.abs(lx)/Rmid)))))*Rmid+thick*.2;
const h=Math.max(.2,top-foot);
addBox(g,.7,h,wid-.35,lx,foot+h/2,0,archMat);
});
[-1,1].forEach(function(s){
addBox(g,.8,1.15,wid-.15,s*2.15,-.15,0,archMat);
});
g.position.set(x,grade,z);g.rotation.y=yaw||0;parent.add(g);
const steps=[];
for(let lx=-len/2+.4;lx<=len/2-.2;lx+=.55){
const h=grade+deckTop(lx);
const wx=x+Math.cos(yaw)*lx,wz=z-Math.sin(yaw)*lx;
steps.push({x:wx,z:wz,w:1.0,d:2.35,h:h});
}
return steps;
}
function barrel(parent,groundY,x,z){
const y=groundY(x,z);
const c=new THREE.Mesh(new THREE.CylinderGeometry(.26,.3,.64,8),MAT.bark);
c.position.set(x,y+.32,z);c.castShadow=c.receiveShadow=true;parent.add(c);
[.2,.48].forEach(function(h){
const hoop=new THREE.Mesh(new THREE.TorusGeometry(.3,.03,4,8),MAT.timber);
hoop.rotation.x=Math.PI/2;hoop.position.set(x,y+h,z);hoop.castShadow=true;parent.add(hoop);
});
}
function fenceRun(parent,groundY,x0,z0,x1,z1,posts){
const n=posts||4,dx=x1-x0,dz=z1-z0,len=Math.hypot(dx,dz)||1,yaw=Math.atan2(dx,dz);
for(let i=0;i<=n;i++){
const t=i/n,x=x0+dx*t,z=z0+dz*t,y=groundY(x,z);
addBox(parent,.1,.82,.1,x,y+.41,z,MAT.timber);
}
const my=(groundY(x0,z0)+groundY(x1,z1))/2,mx=(x0+x1)/2,mz=(z0+z1)/2;
[0.32,0.62].forEach(function(h){const r=addBox(parent,.07,.07,len,mx,my+h,mz,MAT.timber);r.rotation.y=yaw;});
}
function buildVillage(scene,groundY,BX){
const root=new THREE.Group();root.name="village";scene.add(root);
/* street faces the cobble. Local +Z is the front; yaw ±90° turns it toward x=17.4. */
const homes=[
{x:13.6,z:47,yaw:Math.PI/2,slate:1},
{x:13.6,z:53.2,yaw:Math.PI/2,slate:0},
{x:13.6,z:59.4,yaw:Math.PI/2,slate:1,w:3.8},
{x:21.2,z:46.4,yaw:-Math.PI/2,slate:0},
{x:21.2,z:53,yaw:-Math.PI/2,slate:0,sign:MAT.signMarket,w:3.9},
{x:21.2,z:59.6,yaw:-Math.PI/2,slate:1,floors:2,sign:MAT.signInn,w:4.2,d:3.2},
{x:27.2,z:-35.6,yaw:.4,w:3.8,d:3.2},
{x:47.4,z:-33.2,yaw:-.5,slate:1,w:4.0,d:3.3}
];
homes.forEach(function(h){
house(root,groundY,h);
const fw=h.w||3.6,fd=h.d||3.05,yaw=h.yaw||0,c=Math.abs(Math.cos(yaw)),s=Math.abs(Math.sin(yaw));
block(BX,h.x,h.z,fw*c+fd*s+.4,fw*s+fd*c+.4,h.floors===2?5.3:4.25);
});
well(root,groundY,16.2,63.4);block(BX,16.2,63.4,1.6,1.6,1.2);
/* stalls in the gaps between houses, opening onto the street */
stall(root,groundY,13.6,50.1,Math.PI/2,false);
stall(root,groundY,13.6,56.3,Math.PI/2,true);
stall(root,groundY,21.2,49.7,-Math.PI/2,true);
stall(root,groundY,21.2,56.2,-Math.PI/2,false);
[[14.2,49.4],[14.5,49.8],[20.4,50.2],[20.1,55.5],[16.0,62.4],[15.5,62.7],[19.4,44.6]].forEach(function(p){barrel(root,groundY,p[0],p[1]);});
[[14.6,50.6],[14.4,56.8],[19.7,49.2],[19.6,52.4],[16.9,62.5],[15.2,44.9],[20.6,57.0]].forEach(function(p,i){
const c=makeCrate(i%3===0?.85:.62,i%2?.5:.42,i%3===0?.7:.55,i%2?MAT.green:MAT.apple);
c.position.set(p[0],groundY(p[0],p[1]),p[1]);c.rotation.y=i*.7;root.add(c);
});
[[15.0,47.8],[19.9,46.9],[15.05,53.9],[19.85,59.0],[16.8,61.6]].forEach(function(p,i){pot(root,groundY,p[0],p[1],.75+(i%3)*.2);});
fenceRun(root,groundY,11.55,45.2,11.55,61.6,8);
fenceRun(root,groundY,23.35,44.4,23.35,62.2,8);
fenceRun(root,groundY,14.4,64.5,20.2,64.5,4);
const street=new THREE.Mesh(new THREE.PlaneGeometry(4.6,20,4,14),MAT.cobble);
street.rotation.x=-Math.PI/2;street.position.set(17.4,0,53);
const sp=street.geometry.attributes.position;
for(let i=0;i<sp.count;i++){
const wx=sp.getX(i)+17.4,wz=53-sp.getY(i);
sp.setZ(i,groundY(wx,wz)+.04);
}
sp.needsUpdate=true;street.geometry.computeVertexNormals();
const suv=street.geometry.attributes.uv;
for(let i=0;i<suv.count;i++)suv.setXY(i,suv.getX(i)*4.6*K,suv.getY(i)*20*K);
street.receiveShadow=true;street.userData.surface=1;root.add(street);
/* flat water in the ditch; foam is only the shore band, not a sheet over the water */
function waterY(x,z){return groundY(x,z)+channelDrop(x,z)-.58;}
root.add(ribbon(STREAM,1.12,0,MAT.water,waterY));
root.add(ribbon(offsetLine(STREAM,1.32),.3,.03,MAT.foam,groundY));
root.add(ribbon(offsetLine(STREAM,-1.32),.3,.03,MAT.foam,groundY));
for(let i=0;i<STREAM.length-1;i++){
const ax=STREAM[i][0],az=STREAM[i][1],bx0=STREAM[i+1][0],bz0=STREAM[i+1][1];
const len=Math.hypot(bx0-ax,bz0-az),n=Math.max(1,Math.ceil(len/1.3));
for(let k=0;k<=n;k++){const t=k/n;blocks.push({x:ax+(bx0-ax)*t,z:az+(bz0-az)*t,w:5.2,d:5.2});}
}
blocks.push({x:17.4,z:53,w:6.2,d:24});
const bx=10.6,bz=32.4,yaw=-Math.atan2(1.8,8.4),grade=groundY(bx,bz)+channelDrop(bx,bz);
bridge(root,grade,bx,bz,yaw).forEach(function(s){block(BX,s.x,s.z,s.w,s.d,s.h);});
/* canyon-edge adobe, off the rim road */
adobeHouse(root,groundY,-26.6,15.2,.6);block(BX,-26.6,15.2,5.2,4.4,3.5);
adobeHouse(root,groundY,-26.2,22.4,-.4);block(BX,-26.2,22.4,5.2,4.4,4.5);
palm(root,groundY,-24.6,18.6);
palm(root,groundY,-25.2,12.4);
/* a stand of drooping pines and a few orange broadleaf, east of the start and clear of the brook */
[[22,4,1.15],[26,9,1.35],[19,12,1.05],[30,4,1.25],[28,14,1.1],[34,10,1.4],[16,8,1.0]].forEach(function(p,i){
const pine=makePine(p[2]);pine.position.set(p[0],groundY(p[0],p[1]),p[1]);pine.rotation.y=i*1.3;root.add(pine);
block(BX,p[0],p[1],.7,.7,3.2);
});
[[24,2,1.15],[32,7,1.2],[21,16,1.05]].forEach(function(p,i){
const t=makeBroadleaf(p[2],i+3,1);t.position.set(p[0],groundY(p[0],p[1]),p[1]);t.rotation.y=i*.8;root.add(t);
block(BX,p[0],p[1],.8,.8,2.6);
});
return root;
}
function grassLip(scene,cEx,grassMat){
const top=[],face=[];
for(let z=-96;z<=96;z+=4){
const x0=cEx(z)+.2,x1=cEx(z)-.95,z1=z+4;
const x0b=cEx(z1)+.2,x1b=cEx(z1)-.95;
top.push(x0,.16,z,x1,.12,z,x0b,.16,z1,x1,.12,z,x1b,.12,z1,x0b,.16,z1);
face.push(x1,.12,z,x1,-.35,z,x1b,.12,z1,x1,-.35,z,x1b,-.35,z1,x1b,.12,z1);
}
function mesh(arr,mat,surface){
const g=new THREE.BufferGeometry();
g.setAttribute("position",new THREE.Float32BufferAttribute(arr,3));
g.computeVertexNormals();
const m=new THREE.Mesh(facetUV(g,K,false),mat);
m.receiveShadow=true;m.castShadow=true;if(surface)m.userData.surface=1;scene.add(m);
}
mesh(top,grassMat,1);mesh(face,MAT.rock,0);
}
function scatterDress(scene,groundY,avoid){
const tuftG=new THREE.PlaneGeometry(.55,.7);
tuftG.translate(0,.35,0);
const flowers=[MAT.flowerR,MAT.flowerY,MAT.flowerW];
const lists=[[],[],[]],tufts=[],pebbles=[];
for(let i=0;i<1700;i++){
const x=-6+hash(i,1)*58,z=-60+hash(i,2)*130;
if(avoid&&avoid(x,z))continue;
if(inWater(x,z)||occupies(x,z))continue;
const r=hash(i,3);
if(r<.45)tufts.push([x,z,hash(i,4)*6.28,.75+hash(i,5)*.55]);
else if(r<.75)lists[i%3].push([x,z,hash(i,4)*6.28,.5+hash(i,6)*.35]);
else pebbles.push([x,z,hash(i,7)*6.28,.35+hash(i,8)*.45]);
}
function inst(geo,mat,pts,lift,kind){
if(!pts.length)return;
const im=new THREE.InstancedMesh(geo,mat,pts.length),d=new THREE.Object3D();
pts.forEach(function(p,i){d.position.set(p[0],groundY(p[0],p[1])+(lift||0),p[1]);d.rotation.y=p[2]||0;d.scale.setScalar(p[3]||1);d.updateMatrix();im.setMatrixAt(i,d.matrix);});
im.instanceMatrix.needsUpdate=true;im.receiveShadow=true;im.frustumCulled=false;
im.userData.tbFull=pts.length;im.userData.tbKind=kind||"prop";
dressList.push(im);
if(kind!=="pebble")noteWind(im);
scene.add(im);
}
inst(tuftG,MAT.tuft,tufts,0,"tuft");
flowers.forEach(function(mat,k){inst(tuftG,mat,lists[k],0,"flower");});
const pebble=facetUV(new THREE.DodecahedronGeometry(.22,0),KR,true);
inst(pebble,MAT.rock,pebbles,.1,"pebble");
}
function hash(i,s){const v=Math.sin(i*127.1+s*311.7)*43758.5453;return v-Math.floor(v);}

/* ---------- sky ---------- */
let sky=null,skyT=0;
function makeSky(scene){
const geo=new THREE.SphereGeometry(340,28,16);
const mat=new THREE.ShaderMaterial({
side:THREE.BackSide,fog:false,depthWrite:false,
uniforms:{uSun:{value:new THREE.Vector3(-.62,.78,.55)},uZen:{value:new THREE.Vector3(.12,.36,.95)},uHor:{value:new THREE.Vector3(.20,.45,.85)}},
vertexShader:"varying vec3 vD;void main(){vD=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}",
fragmentShader:[
"varying vec3 vD;uniform vec3 uSun,uZen,uHor;",
"void main(){",
"vec3 d=normalize(vD);vec3 sun=normalize(uSun);",
"vec3 col=mix(uHor,uZen,smoothstep(0.0,0.55,d.y));",
"float s=max(dot(d,sun),0.0);",
"col+=vec3(1.0,0.86,0.55)*pow(s,64.0)*0.35;",
"gl_FragColor=vec4(col,1.0);}"
].join("\n")
});
sky=new THREE.Mesh(geo,mat);sky.frustumCulled=false;sky.renderOrder=-1;sky.userData.surface=1;
for(let i=0;i<12;i++){
const c=new THREE.Mesh(new THREE.PlaneGeometry(34+(i%4)*12,16+(i%3)*8),MAT.cloud);
const a=i/12*6.28+0.35,rad=80+(i%5)*26;
c.position.set(Math.sin(a)*rad,32+(i%5)*14,Math.cos(a)*rad);
c.lookAt(0,8,0);sky.add(c);
}
scene.add(sky);
}
function followSky(cam){if(sky&&cam)sky.position.copy(cam.position);}
function setClouds(d){
if(!sky)return;
const clouds=[];
sky.children.forEach(function(c){if(c.material===MAT.cloud)clouds.push(c);});
const n=Math.round(Math.max(0,Math.min(1,d))*clouds.length);
clouds.forEach(function(c,i){c.visible=i<n;});
}
const dressList=[];
function setDress(density, flower){
if(window.TBArea&&TBArea.active&&TBArea.active())density=0;
const f=flower>=.2?1:Math.max(0,flower/.2);
dressList.forEach(function(im){
const k=im.userData.tbKind==="flower"?density*f:density;
const n=Math.max(0,Math.round((im.userData.tbFull||0)*k));
im.count=n;im.visible=n>0;
});
}
const winds=[];
let windAmt=0, windOn=false;
const _wm=new THREE.Matrix4(), _wr=new THREE.Matrix4();
function noteWind(obj){
if(!obj||obj.userData._wind)return;
obj.userData._wind=1;
if(obj.isInstancedMesh){
const n=obj.count, base=new Float32Array(n*16);
for(let i=0;i<n;i++){obj.getMatrixAt(i,_wm);_wm.toArray(base,i*16);}
winds.push({obj:obj, base:base, n:n});
}else winds.push({obj:obj});
}
function setWind(w){windAmt=+w||0;}
/* Area water. 128 px macros repeat every 12.8 m (10 texels/m). Frames step;
   the shore ribbons pulse between the still tile and _f1 and do not scroll. */
const WATER_DIR=TB_ROOT+"textures/tiles_v3/water/textures/";
function waterTex(url,repeat,hex){
const c=document.createElement("canvas");c.width=c.height=4;
const g=c.getContext("2d");g.fillStyle=hex||"#4A9EB2";g.fillRect(0,0,4,4);
const t=new THREE.CanvasTexture(c);
t.magFilter=THREE.NearestFilter;
t.minFilter=THREE.NearestMipmapNearestFilter;
t.generateMipmaps=true;t.anisotropy=1;
t.wrapS=t.wrapT=repeat?THREE.RepeatWrapping:THREE.ClampToEdgeWrapping;
t.colorSpace=THREE.SRGBColorSpace;
const img=new Image();
img.onload=function(){t.image=img;t.needsUpdate=true;};
img.src=url;
return t;
}
function waterFrames(base,n,repeat,hex){
const out=[];
for(let i=0;i<n;i++)out.push(waterTex(base+i+".png",repeat,hex));
return out;
}
const WATER={
shallow:waterFrames(WATER_DIR+"anim/water_shallow_128_f",4,true,"#4A9EB2"),
deep:waterFrames(WATER_DIR+"anim/water_deep_128_f",4,true,"#356DA8"),
foam:[waterTex(WATER_DIR+"shore_foam_wet_64x16.png",true,"#F6FCF8"),waterTex(WATER_DIR+"shore_foam_wet_64x16_f1.png",true,"#F6FCF8")],
thin:[waterTex(WATER_DIR+"shore_foam_64x16.png",true,"#F6FCF8"),waterTex(WATER_DIR+"shore_foam_64x16_f1.png",true,"#F6FCF8")],
grass:[waterTex(WATER_DIR+"bank_grass_64x16.png",true,"#6aaa48"),waterTex(WATER_DIR+"bank_grass_64x16_f1.png",true,"#6aaa48")],
mud:[waterTex(WATER_DIR+"bank_mud_64x16.png",true,"#C4A06A"),waterTex(WATER_DIR+"bank_mud_64x16_f1.png",true,"#C4A06A")],
lake:[waterTex(WATER_DIR+"shore_wet_band_64x16.png",true,"#E8C896")],
wetsand:[waterTex(WATER_DIR+"shore_wet_to_sand_64x16.png",true,"#E8C896")],
wet:[waterTex(WATER_DIR+"terrain_wet_sand_v0_32.png",true,"#D6BA85"),waterTex(WATER_DIR+"terrain_wet_sand_v1_32.png",true,"#C4A478")],
live:[]
};
function waterMat(frames,opt){
opt=opt||{};
const m=new THREE.MeshBasicMaterial({map:frames[0],color:0xffffff,alphaTest:opt.alphaTest||0,transparent:false,depthWrite:opt.depthWrite!==false,side:opt.side||THREE.FrontSide});
m.toneMapped=false;
if(opt.offset){m.polygonOffset=true;m.polygonOffsetFactor=-2;m.polygonOffsetUnits=-2;}
m.userData.frames=frames;
m.userData.waterKind=opt.kind||"ribbon";
const prev=m.dispose.bind(m);
m.dispose=function(){
const i=WATER.live.indexOf(m);if(i>=0)WATER.live.splice(i,1);
if(m.userData.shoreTex&&m.userData.shoreTex.dispose)m.userData.shoreTex.dispose();
prev();
};
WATER.live.push(m);
return m;
}
function stepWater(){
const f=Math.floor(skyT/0.28)%4,r=Math.floor(skyT/0.6)%2;
if(stepWater.f===f&&stepWater.r===r)return;
stepWater.f=f;stepWater.r=r;
for(let i=0;i<WATER.live.length;i++){
const m=WATER.live[i];
if(m.userData.waterKind==="sheet"){
if(m.userData.uShallow)m.userData.uShallow.value=WATER.shallow[f];
if(m.userData.uDeep)m.userData.uDeep.value=WATER.deep[f];
}else if(m.userData.frames&&m.userData.frames.length>1){
const fr=m.userData.frames[r%m.userData.frames.length];
if(m.map!==fr){m.map=fr;m.needsUpdate=true;}
}
}
}
function tick(dt){
skyT+=dt;
if(MAT.water.map)MAT.water.map.offset.x=Math.floor(skyT*6)/32;
stepWater();
if(windAmt>0)windOn=true;
else if(!windOn)return;
if(windAmt<=0)windOn=false;
for(let i=0;i<winds.length;i++){
const it=winds[i];
if(it.base){
for(let k=0;k<it.n;k++){
_wm.fromArray(it.base,k*16);
if(windAmt>0){_wr.makeRotationZ(Math.sin(skyT*1.7+k*.37)*.05*windAmt);_wm.multiply(_wr);}
it.obj.setMatrixAt(k,_wm);
}
it.obj.instanceMatrix.needsUpdate=true;
}else if(it.obj){
const o=it.obj;
o.rotation.z=windAmt>0?Math.sin(skyT*1.6+o.position.x*.15)*.05*windAmt:0;
o.rotation.x=windAmt>0?Math.sin(skyT*1.2+o.position.z*.15)*.035*windAmt:0;
}
}
}
function skyUniforms(){return sky?sky.material.uniforms:null;}

let groundRef=null, pendingBake=0;
function kickBake(){
if(!groundRef||!window.TBRenderer)return;
try{bakeGround(window.TBRenderer,groundRef);}catch(e){console.warn("chunk bake",e);}
}
/* Orthographic albedo of the area ground. The atlas stays unmipped; this
   chunk is one continuous image, so nearest-mipmap-linear cannot bleed tiles. */
function bakeGround(R,mesh){
if(!R||!mesh||!mesh.geometry)return;
mesh.geometry.computeBoundingBox();
const bb=mesh.geometry.boundingBox;
if(!bb)return;
const x0=bb.min.x,x1=bb.max.x,z0=bb.min.z,z1=bb.max.z;
const ppm=16;
let tw=Math.max(2,Math.ceil((x1-x0)*ppm)),th=Math.max(2,Math.ceil((z1-z0)*ppm));
const cap=4096,sc=Math.min(1,cap/tw,cap/th);
tw=Math.max(2,Math.floor(tw*sc));th=Math.max(2,Math.floor(th*sc));
const rt=new THREE.WebGLRenderTarget(tw,th,{
magFilter:THREE.NearestFilter,
minFilter:THREE.NearestMipmapLinearFilter,
generateMipmaps:true,
depthBuffer:true,
stencilBuffer:false
});
rt.texture.generateMipmaps=true;
rt.texture.minFilter=THREE.NearestMipmapLinearFilter;
rt.texture.magFilter=THREE.NearestFilter;
rt.texture.wrapS=rt.texture.wrapT=THREE.ClampToEdgeWrapping;
rt.texture.anisotropy=R.capabilities.getMaxAnisotropy();
rt.texture.needsUpdate=true;
rt.texture.colorSpace=THREE.NoColorSpace;
const cx=(x0+x1)/2,cz=(z0+z1)/2;
const cam=new THREE.OrthographicCamera(-(x1-x0)/2,(x1-x0)/2,(z1-z0)/2,-(z1-z0)/2,0.1,4000);
cam.position.set(cx,900,cz);
cam.up.set(0,0,1);
cam.lookAt(cx,0,cz);
cam.updateProjectionMatrix();
const mat=mesh.material;
pendingBake=1;
if(mat.userData.uBakePass)mat.userData.uBakePass.value=1;
const parent=mesh.parent;
const hold=new THREE.Scene();
hold.add(mesh);
const prev=R.getRenderTarget();
const prevClear=new THREE.Color();
R.getClearColor(prevClear);
const prevA=R.getClearAlpha();
R.setClearColor(new THREE.Color(0.20,0.45,0.85),1);
R.setRenderTarget(rt);
R.clear(true,true,true);
try{R.render(hold,cam);}finally{
R.setRenderTarget(prev);
R.setClearColor(prevClear,prevA);
pendingBake=0;
if(mat.userData.uBakePass)mat.userData.uBakePass.value=0;
if(parent)parent.add(mesh);
}
if(mat.userData.chunkRT)mat.userData.chunkRT.dispose();
mat.userData.chunkRT=rt;
if(mat.userData.chunkU){
mat.userData.chunkU.value=rt.texture;
mat.userData.chunkOrg.value.set(x0,z0,1/Math.max(1e-4,x1-x0),1/Math.max(1e-4,z1-z0));
mat.userData.chunkPx.value.set(tw,th);
}
}
function noteGround(mesh){
groundRef=mesh;
kickBake();
}
window.TBTiles={
install:install,grassPick:grassPick,whenBiomes:whenBiomes,loadBiomeTable:loadBiomeTable,biomeBook:function(){return biomeTable&&biomeTable.book||null;},bakeBiome:bakeBiomeCells,facetUV:facetUV,rockMaterial:function(){return MAT.rock;},
addPines:addPines,makeTree:makeTree,makeBush:makeBush,isTree:isTree,isBush:isBush,faceKnot:faceKnot,
dress:dress,buildVillage:buildVillage,grassLip:grassLip,scatterDress:scatterDress,occupies:occupies,channelDrop:channelDrop,inWater:inWater,
house:house,well:well,stall:stall,adobeHouse:adobeHouse,addBox:addBox,lambert:lambert,
reserve:function(x,z,w,d){blocks.push({x:x,z:z,w:w,d:d});},
makeSky:makeSky,followSky:followSky,tick:tick,MAT:MAT,
shade:SHADE,setFlowerRate:setFlowerRate,setOldTiles:setOldTiles,setClouds:setClouds,setDress:setDress,setWind:setWind,noteWind:noteWind,skyUniforms:skyUniforms,waterMat:waterMat,WATER:WATER,noteGround:noteGround,rebake:kickBake,
bindHeight:bindHeight,setHeightDebug:setHeightDebug
};
})();
