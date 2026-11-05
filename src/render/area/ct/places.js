/* Ported from trailbound-controller (deployed main). ESM, behaviour-faithful.
   Not typechecked: a full TS conversion of these files would stall the port.
   three r187: colorSpace, colorspace_fragment, per-fragment Lambert cel, asset root.
*/
import { THREE } from './three-runtime.js';
/* Points of interest and who lives there.
   Adding a wanderer is one ROSTER entry (kind, file, home, radius).
   pack defaults from kind ("heroes" / "animals"); set pack for another folder.
   Replacements that keep the file name drop in without a code change.
   tasks lists pause clips; unknown names are ignored, so new clips can be added in life.js. */
(function(){
const TB_ROOT=(import.meta.env&&import.meta.env.BASE_URL?import.meta.env.BASE_URL:'./')+'assets/';
const outdoor={x1:56,rim:-28.5,meadowZ:76};
/* Ellipses (x, z, radii) kept free of the instanced backdrop forest. */
const OPEN=[
{x:0,z:0,rx:4.2,rz:78},
{x:8.2,z:27,rx:8,rz:7},
{x:17,z:53,rx:12,rz:9},
{x:12,z:40,rx:8,rz:8},
{x:24,z:34.5,rx:14,rz:4.5},
{x:41,z:36,rx:14,rz:10},
{x:38,z:-24,rx:12,rz:10},
{x:16,z:-26,rx:14,rz:4},
{x:43,z:-42,rx:6,rz:12},
{x:47.5,z:-55,rx:12,rz:11},
{x:22,z:2,rx:14,rz:16},
{x:44,z:4,rx:10,rz:10}
];
function openGround(x,z){
for(let i=0;i<OPEN.length;i++){
const c=OPEN[i],dx=(x-c.x)/c.rx,dz=(z-c.z)/c.rz;
if(dx*dx+dz*dz<1)return true;
}
return false;
}

/* props: f file, x z yaw, s uniform or sx/sy/sz, block 1 | "trunk", stripe "red"|"blue".
   Scales are chosen so a 1.8 m hero reads against hay, barrels, crates and rocks.
   Yaw is a few degrees off the nearest axis. Fairground dressing has no collision. */
const PROPS=[
/* —— wagon camp: three wagons ring the fire, seats and people face in —— */
{f:"ult_campfire_cooker",x:38.2,z:-24,yaw:.22,s:.55,block:1},
{f:"ult_cookingpot_tribal",x:39.05,z:-24.55,yaw:1.05},
{f:"ult_horse_wagon",x:38.4,z:-18.7,yaw:Math.PI+.18,s:.82,block:1},
{f:"ult_carriage",x:33.35,z:-26.85,yaw:.72,block:1},
{f:"syn_cart_02",x:43.15,z:-26.35,yaw:-.88,block:1},
{f:"ult_log_bench_long",x:38.15,z:-26.45,yaw:.08,block:1},
{f:"ult_campfire_bench",x:40.05,z:-22.65,yaw:-2.15,s:.9,block:1},
{f:"syn_tent_02",x:44.9,z:-20.4,yaw:.62,s:.8,block:1},
{f:"ult_barrel_old",x:40.35,z:-17.45,yaw:.45,s:.79,block:1},
{f:"ult_crate_box",x:37.15,z:-17.25,yaw:.28,s:.85,block:1},
{f:"ult_bag",x:39.15,z:-16.7,yaw:1.2,s:1.15},
{f:"syn_crate_01",x:33.55,z:-25.55,yaw:-.35,s:1.45,block:1},
{f:"ult_barrel_old",x:31.7,z:-26.15,yaw:1.1,s:.79,block:1},
{f:"ult_bag",x:34.35,z:-28.45,yaw:.7,s:1.15},
{f:"ult_crate_box",x:44.85,z:-25.15,yaw:.55,s:.8,block:1},
{f:"syn_alcohol_barrel_01",x:42.45,z:-28.15,yaw:-.4,s:1.45,block:1},
{f:"ult_torch_standing_tribal",x:34.15,z:-19.35,yaw:.55,s:1.05},
{f:"ult_stakes",x:45.35,z:-23.15,yaw:.3,s:.65,block:1},
{f:"ult_lantern",x:36.05,z:-21.25,yaw:.35},

/* —— market: two stalls face each other across a short lane —— */
{f:"ult_marketplace_stand_simple",x:13.55,z:53.35,yaw:1.75,block:1,stripe:"red"},
{f:"ult_marketplace_stand_simple",x:20.85,z:53.05,yaw:-1.38,block:1,stripe:"blue"},
{f:"syn_table_01",x:17.15,z:52.15,yaw:.2,block:1},
{f:"syn_basket_01",x:16.55,z:52.05,yaw:.85},
{f:"syn_basket_01",x:17.85,z:51.85,yaw:2.05},
{f:"ult_bag",x:17.05,z:52.7,y:.62,yaw:.4,s:1.15},
{f:"ult_bag",x:17.7,z:52.55,y:.62,yaw:1.5,s:1.1},
{f:"syn_basket_01",x:14.7,z:53.05,y:1.02,yaw:.55},
{f:"ult_bag",x:14.2,z:53.55,y:1.02,yaw:1.15,s:1.1},
{f:"syn_basket_01",x:14.95,z:53.7,y:1.02,yaw:1.8},
{f:"syn_basket_01",x:19.7,z:53.2,y:1.02,yaw:2.1},
{f:"ult_bag",x:20.15,z:52.75,y:1.02,yaw:.45,s:1.1},
{f:"ult_flower_red",x:19.55,z:53.55,y:1.02,yaw:.3,s:1.25},
{f:"syn_crate_01",x:11.7,z:54.85,yaw:.25,s:1.45,block:1},
{f:"ult_crate_box",x:12.35,z:55.55,yaw:-.4,s:.85,block:1},
{f:"ult_crate_box",x:22.55,z:54.55,yaw:.7,s:.9,block:1},
{f:"ult_barrel_old",x:22.15,z:53.35,yaw:1.15,s:.79,block:1},
{f:"ult_flower_red",x:12.7,z:51.55,yaw:.55,s:1.35},

/* —— homestead: well in the yard, pen with a gate and a broken north run —— */
{f:"ult_house_medieval_small",x:49.2,z:40.5,yaw:-Math.PI/2+.14,s:.78,block:1},
{f:"ult_well",x:40.15,z:36.55,yaw:.42,s:.62,block:1},
{f:"ult_fence_classic",x:34.55,z:32.15,yaw:.06,sy:.82,block:1},
{f:"ult_fence_classic",x:36.45,z:32.28,yaw:-.08,sy:.82,block:1},
{f:"ult_fence_classic",x:40.35,z:32.05,yaw:.1,sy:.82,block:1},
{f:"ult_fence_classic",x:42.3,z:32.22,yaw:-.04,sy:.82,block:1},
{f:"ult_fence_classic",x:44.2,z:32.08,yaw:.12,sy:.82,block:1},
{f:"ult_fence_classic",x:33.35,z:34.15,yaw:Math.PI/2+.05,sy:.82,block:1},
{f:"ult_fence_classic",x:33.28,z:36.1,yaw:Math.PI/2-.06,sy:.82,block:1},
{f:"ult_fence_classic",x:33.42,z:38.05,yaw:Math.PI/2+.04,sy:.82,block:1},
{f:"ult_fence_classic",x:35.15,z:39.55,yaw:.15,sy:.82,block:1},
{f:"ult_fence_classic",x:39.45,z:39.7,yaw:-.1,sy:.82,block:1},
{f:"ult_fence_classic",x:41.5,z:39.48,yaw:.08,sy:.82,block:1},
{f:"ult_fence_classic",x:45.65,z:35.4,yaw:Math.PI/2-.12,sy:.82,block:1},
{f:"ult_fence_classic",x:45.5,z:37.45,yaw:Math.PI/2+.08,sy:.82,block:1},
{f:"ult_haystack",x:47.85,z:39.65,yaw:.22,sx:.67,sy:.4,sz:.62,block:1},
{f:"ult_hay_pile",x:44.55,z:38.9,yaw:1.15,sx:.58,sy:.42,sz:.55,block:1},
{f:"ult_wheelbarrow",x:36.7,z:32.85,yaw:.95},
{f:"ult_pitchfork",x:34.45,z:33.55,yaw:.32},
{f:"ult_shovel",x:34.85,z:34.35,yaw:-.22},
{f:"ult_bucket_milk",x:39.35,z:35.95,yaw:.4,s:1.15},
{f:"syn_watertrough_01",x:43.35,z:33.55,yaw:.22,s:.8,block:1},
{f:"syn_cart_01",x:37.15,z:30.25,yaw:.7,block:1},
{f:"syn_logpile_01",x:44.15,z:38.85,yaw:-.55,s:.42,block:1},
{f:"ult_grass_tall",x:36.4,z:37.7,yaw:.5,s:.42},
{f:"ult_grass_tall",x:37.55,z:38.45,yaw:1.4,s:.38},
{f:"ult_flower_red",x:38.7,z:37.85,yaw:.8,s:1.3},

/* —— wild edge: one rounded outcrop, a tree cluster, deer at the edge —— */
{f:"ult_rock_large",x:49.15,z:-56.35,yaw:.55,sx:.78,sy:.5,sz:.7,block:1},
{f:"ult_rock_pillar",x:51.85,z:-57.55,yaw:.3,s:.48,block:1},
{f:"ult_stone_flat_brown",x:46.05,z:-53.85,yaw:.9,s:.72,block:1},
{f:"ult_stone_flat_brown",x:47.65,z:-52.45,yaw:-.35,s:.58},
{f:"ult_rocks_small_brown",x:44.85,z:-54.85,yaw:.6,s:1.55},
{f:"ult_rocks_small_brown",x:50.45,z:-53.65,yaw:1.2,s:1.45},
{f:"ult_rocks_small_brown",x:44.25,z:-52.65,yaw:.4,s:1.2},
{f:"ult_tree_round",x:41.15,z:-50.15,yaw:.35,s:.92,block:"trunk"},
{f:"ult_tree_round",x:43.55,z:-47.75,yaw:1.15,s:1,block:"trunk"},
{f:"ult_tree_round",x:46.35,z:-46.75,yaw:.7,s:.85,block:"trunk"},
{f:"ult_tree_elipse",x:39.95,z:-47.55,yaw:2.1,s:.7,block:"trunk"},
{f:"ult_tree_oak",x:44.15,z:-50.75,yaw:.9,s:.48,block:"trunk"},
{f:"ult_mushroom_toadstool",x:41.95,z:-50.75,yaw:.5,s:.5},
{f:"ult_mushroom_boletus",x:43.15,z:-48.55,yaw:1.3,s:.65},
{f:"ult_mushroom_toadstool",x:44.95,z:-47.35,yaw:.2,s:.48},
{f:"ult_mushroom_boletus",x:41.35,z:-48.15,yaw:1.8,s:.6},

/* —— waypoint: sign at the fork, one bench, one lantern post, one traveller —— */
{f:"ult_guidepost",x:7.35,z:28.55,yaw:.48,s:1.2,block:1},
{f:"ult_log_bench_long",x:9.55,z:25.35,yaw:-.4,block:1},
{f:"ult_torche",x:10.9,z:28.4,yaw:.2,s:1.2},
{f:"syn_lantern_01",x:10.9,z:28.4,y:2.2,yaw:.45},
{f:"ult_flower_red",x:6.55,z:26.75,yaw:.7,s:1.3},

/* a tree or two beside the trails, not a scatter of props */
{f:"ult_tree_round",x:6.15,z:20.2,yaw:.4,s:.8,block:"trunk"},
{f:"ult_tree_fir",x:10.2,z:38.4,yaw:.9,s:.75,block:"trunk"},
{f:"ult_tree_simple",x:30.2,z:-30.4,yaw:1.6,s:.85,block:"trunk"},

/* —— minigame fair: booths and rock frames. No collision, so the nodes stay reachable.
   The floating name cards are drawn by minigames.js and are left alone. —— */
{f:"ult_marketplace_stand_simple",x:15.15,z:-11.35,yaw:.95,s:.78,stripe:"red"},
{f:"ult_marketplace_stand_simple",x:21.4,z:-.9,yaw:.18,s:.78,stripe:"red"},
{f:"ult_marketplace_stand_simple",x:27.55,z:-1.15,yaw:-.16,s:.78,stripe:"blue"},
{f:"ult_crate_box",x:16.4,z:-10.2,yaw:.4,s:.75},
{f:"ult_barrel_old",x:22.7,z:-2.15,yaw:.8,s:.7},
{f:"ult_rock_large",x:17.15,z:6.65,yaw:.5,s:.32},
{f:"ult_rock_large",x:20.85,z:6.75,yaw:1.1,s:.3},
{f:"ult_rock_large",x:17.25,z:3.35,yaw:-.4,s:.28},
{f:"ult_shrub_round",x:16.7,z:5.15,yaw:.6,s:.7},
{f:"ult_rock_large",x:26.65,z:6.45,yaw:.3,s:.32},
{f:"ult_rock_large",x:22.95,z:6.7,yaw:1.4,s:.28},
{f:"ult_rock_large",x:26.45,z:3.25,yaw:-.2,s:.3},
{f:"ult_bush_medium",x:23.4,z:4.15,yaw:.8,s:.75},
{f:"ult_rocks_small_brown",x:17.4,z:12.35,yaw:.5,s:1.2},
{f:"ult_shrub_flowers",x:20.7,z:12.15,yaw:1.1,s:.7},
{f:"ult_rocks_small_brown",x:26.35,z:12.25,yaw:-.3,s:1.15},
{f:"ult_mushroom_toadstool",x:23.2,z:12.4,yaw:.6,s:.55}
];

/* Wanderers: the FF3 cast near the start, animals out on the trails. */
const ROSTER=[
/* Final Fantasy III (DS) cast near the start, native chibi height. Walk is foot-locked, so speed sets the cadence (about 1.3 m/s is the rip's own pace). */
{kind:"hero",pack:"ff3",file:"gulgan.glb",x:6.2,z:4.4,yaw:-2.2,radius:1.6,speed:1,native:1,tasks:["Interact","Cheer"],taskBias:.5,pause:[2.6,5]},
{kind:"hero",pack:"ff3",file:"dwarf.glb",x:-5.2,z:-6.2,yaw:.8,radius:2.6,speed:1.1,native:1,tasks:["Interact"],taskBias:.4},
{kind:"hero",pack:"ff3",file:"base_human.glb",x:2.6,z:5.2,yaw:3.1,radius:1.2,speed:.9,native:1,tasks:["Cheer"],taskBias:.3,pause:[3,6]},
{kind:"animal",file:"horse.glb",x:43.9,z:-23.4,yaw:-.7,radius:1.35,speed:.65,tasks:["Eat"],taskBias:.9,pause:[3.2,6]},
{kind:"animal",file:"ox.glb",x:41.55,z:34.95,yaw:.6,radius:1.45,speed:.55,tasks:["Eat"],taskBias:.85,pause:[3,6]},
{kind:"animal",file:"deer.glb",x:42.7,z:-52.35,yaw:.8,radius:3.2,speed:1.2,tasks:["Eat"],taskBias:.7},
{kind:"animal",file:"wolf.glb",x:51.1,z:-61.4,yaw:-1.2,radius:4.2,speed:1.25,tasks:["Howl"],taskBias:.45,pause:[2.4,4.8]}
];

let scene,BX,cEx,players,goView,root,ready=false,fire=null,t=0,sun=null,hook=null,horse=null;
const _v=new THREE.Vector3();

/* rounded clearings and the worn trails between them, painted into one ground material */
const PATCHES=[
{x:38.2,z:-24,rx:6.6,rz:5.8,seed:1.2},
{x:17.4,z:53,rx:2.6,rz:2.2,seed:2.4},
{x:41.2,z:36.2,rx:7.4,rz:5.6,seed:3.1},
{x:47.2,z:-54.2,rx:6.2,rz:5.4,seed:4.2},
{x:8.5,z:27.1,rx:4.4,rz:3.8,seed:5.3}
];
const TRAILS=[
[[1.15,16],[2.7,20.4],[4.6,23.5],[6.9,26.5]],
[[8.7,29.4],[7.1,34.2],[9.6,40.6],[13.4,46.8],[16.4,51.4]],
[[1.7,28.2],[6.8,31.6],[15.2,33.4],[25.5,34.5],[34.2,35.5]],
[[1.15,-12],[3.6,-17.2],[7.2,-22.4],[14,-26.6],[24,-27.1],[33.5,-25.2]],
[[40.2,-29.5],[42.4,-37.5],[43.2,-45.5],[46.2,-52]]
];
const PINES=[[-4,-12],[6,-10],[12,0],[-11,3],[3,9],[-9,10],[14,8],[-14,-3],[-3,-14],[-2,-8],[-12,-5]];
const ROAD_R=1.65,DIRT_R=1.62;

function propUrl(f){return TB_ROOT+"models/props/"+f+".glb";}
function actorUrl(d){return TB_ROOT+"models/"+(d.pack||(d.kind==="hero"?"heroes":"animals"))+"/"+d.file;}
function walkable(x,z){
if(x>53.6||z<-72||z>72)return false;
/* the rim road, west of the meadow, so wanderers can patrol the canyon stretch by the spur */
if(x<-8){
if(z<-36||z>48)return false;
const lip=cEx?cEx(z):-40;
if(x<lip+1.6||x>-28.6)return false;
}
if(Math.abs(x)<2.3&&z>-16&&z<14)return false;
if(cEx&&x<cEx(z)+1.8)return false;
return true;
}
function fade(v,a,b){
if(v<=a)return 0;if(v>=b)return 1;
const u=(v-a)/(b-a);return u*u*(3-2*u);
}
/* ellipse with 3–5 soft lobes. 1 is the edge. */
function blobEr(x,z,p){
const dx=(x-p.x)/p.rx,dz=(z-p.z)/p.rz,a=Math.atan2(dx,dz);
const wob=1+.07*Math.sin(3*a+p.seed)+.045*Math.sin(5*a-p.seed*1.3)+.03*Math.sin(4*a+p.seed*2.1);
return Math.hypot(dx/wob,dz/wob);
}
function distPoly(x,z,pts){
let best=1e9;
for(let i=0;i<pts.length-1;i++){
const ax=pts[i][0],az=pts[i][1],bx=pts[i+1][0],bz=pts[i+1][1];
const dx=bx-ax,dz=bz-az,l2=dx*dx+dz*dz||1e-6;
let u=((x-ax)*dx+(z-az)*dz)/l2;if(u<0)u=0;else if(u>1)u=1;
const d=Math.hypot(x-(ax+dx*u),z-(az+dz*u));if(d<best)best=d;
}
return best;
}
/* canyon rim road: a slow S so the wagon isn't on a ruler line. Exported for the wagon. */
function rimRoadX(z){return -33.7+Math.sin(z*0.0155)*1.45+Math.sin(z*0.0057+.9)*.7;}
/* meadow path joins the rim road in one bowed spur, same soft edge as the other trails */
let SPUR=[];
(function(){
const z0=12,z1=24,x0=roadX(z0),x1=rimRoadX(z1),pts=[];
for(let i=0;i<=14;i++){const u=i/14,s=u*u*(3-2*u);pts.push([x0*(1-s)+x1*s+Math.sin(u*Math.PI)*.55,z0+(z1-z0)*u+Math.sin(u*Math.PI)*1.8]);}
SPUR=pts;TRAILS.push(pts);
})();
/* meadow wagon road: straight under the wagon, a slow curve everywhere else */
function clearOf(x,z){
if(window.TBTiles&&TBTiles.inWater(x,z))return false;
if(Math.abs(x-roadX(z))<2.05)return false;
if(x<-26&&Math.abs(x-rimRoadX(z))<2.5)return false;
return true;
}
function roadX(z){
const curve=Math.sin(z*.028)*2.15+Math.sin(z*.011+.7)*1.35;
let damp=1;
if(z>-18&&z<16){const u=z<-14?(z+18)/4:z>12?(16-z)/4:0;damp=u<0?0:u>1?1:u;}
return curve*damp;
}
/* 0 on paths, clearings, the wagon lane and the start meadow; 1 in open grass */
/* village pads stay level; the meadow around them rolls */
const PADS=[[13.6,47,3.0],[13.6,53.2,3.0],[13.6,59.4,3.0],[21.2,46.4,3.0],[21.2,53,3.2],[21.2,59.6,3.4],[17.4,53,2.6],[16.2,63.4,2.0],[27.2,-35.6,3.6],[47.4,-33.2,3.8],[10.6,32.4,2.4],[44,4,8.6]];
function flatWeight(x,z){
let w=1;
w*=fade(x,2,8);
w*=1-fade(x,46,54);
w*=1-fade(Math.abs(z),62,78);
w*=fade(Math.abs(x-roadX(z)),1.6,4.2);
w*=fade(Math.hypot(x+1,z-4),10,16);
if(x>12&&x<34)w*=fade(Math.abs(z),18,26);
for(let i=0;i<PATCHES.length;i++)w*=fade(blobEr(x,z,PATCHES[i]),.95,1.5);
for(let i=0;i<TRAILS.length;i++)w*=fade(distPoly(x,z,TRAILS[i]),1.8,4.2);
for(let i=0;i<PADS.length;i++)w*=fade(Math.hypot(x-PADS[i][0],z-PADS[i][1]),PADS[i][2],PADS[i][2]+2.4);
return w;
}
function groundY(x,z){
if(x<-8||x>58||z<-88||z>88)return 0;
const w=flatWeight(x,z);
const drop=(window.TBTiles&&TBTiles.channelDrop)?TBTiles.channelDrop(x,z):0;
if(w<0.002)return -drop;
const n=Math.sin(x*.09+.6)*Math.cos(z*.075)+.62*Math.sin(x*.17+z*.04+1.4)+.38*Math.cos(z*.2-x*.03+.5);
/* the ditch replaces the hills instead of stacking on them, so a valley doesn't become a pit */
const hills=n*1.55*w,k=drop>0?1-Math.min(1,drop/.95):1;
return hills*k-drop;
}
/* Corner cover for the tiles_v3 baker. 0 grass, 1 dirt, 2 sandstone.
   Half-widths sit just over half a cell so a path marks one corner column
   and the edge tiles supply the grass lip. Road wins over dirt. */
function roadModeAt(x,z){
if(z>10&&z<28&&x>rimRoadX(z)-2.6&&distPoly(x,z,SPUR)<3.4)return 2;
return 1;
}
function coverAt(x,z){
if(x<-27.5&&Math.abs(x-rimRoadX(z))<ROAD_R)return 2;
if(z>8&&z<30&&distPoly(x,z,SPUR)<ROAD_R)return 2;
for(let i=0;i<PATCHES.length;i++){
const p=PATCHES[i];if(Math.abs(x-p.x)>p.rx+1||Math.abs(z-p.z)>p.rz+1)continue;
const er=blobEr(x,z,p),avg=(p.rx+p.rz)*.5,dirtE=Math.max(.3,1-1.7/avg);
if(er<dirtE)return 1;
}
if(Math.abs(x-roadX(z))<DIRT_R)return 1;
for(let i=0;i<TRAILS.length;i++){if(TRAILS[i]===SPUR)continue;if(distPoly(x,z,TRAILS[i])<DIRT_R)return 1;}
return 0;
}
function sculpt(mesh){
const geo=mesh.geometry,pos=geo.attributes.position,ox=mesh.position.x,oz=mesh.position.z;
for(let i=0;i<pos.count;i++)pos.setZ(i,groundY(pos.getX(i)+ox,-pos.getY(i)+oz));
pos.needsUpdate=true;geo.computeVertexNormals();mesh.receiveShadow=true;
}
function paintGround(mesh){
if(window.TBTiles)TBTiles.install(mesh.material,{cover:coverAt,roadMode:roadModeAt});
}
function footprint(o){
o.updateMatrix();o.matrixWorld.copy(o.matrix);
let minX=1e9,minZ=1e9,maxX=-1e9,maxZ=-1e9,maxY=-1e9,n=0;
o.traverse(node=>{
if(node!==o){node.updateMatrix();node.matrixWorld.multiplyMatrices(node.parent.matrixWorld,node.matrix);}
if(!node.isMesh||!node.geometry)return;
const g=node.geometry;if(!g.boundingBox)g.computeBoundingBox();
const bb=g.boundingBox;
for(let xi=0;xi<2;xi++)for(let yi=0;yi<2;yi++)for(let zi=0;zi<2;zi++){
_v.set(xi?bb.max.x:bb.min.x,yi?bb.max.y:bb.min.y,zi?bb.max.z:bb.min.z).applyMatrix4(node.matrixWorld);
if(_v.x<minX)minX=_v.x;if(_v.x>maxX)maxX=_v.x;
if(_v.z<minZ)minZ=_v.z;if(_v.z>maxZ)maxZ=_v.z;
if(_v.y>maxY)maxY=_v.y;n++;
}
});
if(!n||maxY<.3)return null;
return{x:(minX+maxX)/2,z:(minZ+maxZ)/2,w:Math.max(.2,(maxX-minX)*.76),d:Math.max(.2,(maxZ-minZ)*.76),h:maxY};
}
function shade(o){if(o)o.traverse(n=>{if(n.isMesh){n.castShadow=true;n.receiveShadow=true;}});}
function place(p){
if(window.TBTiles&&TBTiles.isTree(p.f)){
const o=TBTiles.makeTree(p.f,p.s||1,p.x,p.z);
o.position.set(p.x,groundY(p.x,p.z),p.z);o.rotation.y=p.yaw||0;TBTiles.faceKnot(o,p.yaw||0);
shade(o);root.add(o);
if(p.block==="trunk")BX.push({x:p.x,z:p.z,w:.55,d:.55,h:2.4});
return true;
}
if(window.TBTiles&&TBTiles.isBush(p.f)){
const o=TBTiles.makeBush(p.s||1,Math.round(p.x*4+p.z));
o.position.set(p.x,p.y!=null?p.y:groundY(p.x,p.z),p.z);o.rotation.y=p.yaw||0;
shade(o);root.add(o);
if(p.block){const b=footprint(o);if(b)BX.push(b);}
return true;
}
const o=TBAssets.cloneProp(propUrl(p.f),p.stripe?{stripe:p.stripe}:null);
if(!o)return false;
const sx=p.sx!=null?p.sx:(p.s||1),sy=p.sy!=null?p.sy:sx,sz=p.sz!=null?p.sz:sx,s=Math.max(sx,sz);
o.position.set(p.x,p.y!=null?p.y:groundY(p.x,p.z),p.z);o.rotation.y=p.yaw||0;o.scale.set(sx,sy,sz);
if(window.TBTiles)TBTiles.dress(o,p.f,p.stripe);
shade(o);root.add(o);
if(p.block==="trunk")BX.push({x:p.x,z:p.z,w:.7*s,d:.7*s,h:2.2});
else if(p.block){const b=footprint(o);if(b)BX.push(b);}
if(p.f==="ult_campfire_cooker"&&!fire){
fire=new THREE.PointLight(0xffb060,1.7,14,2);
fire.position.set(p.x,.7,p.z);root.add(fire);
}
return true;
}
function swapCarry(t,file,s){
const o=TBAssets.cloneProp(propUrl(file));if(!o||!t.mesh)return;
o.scale.setScalar(s);if(t.k==="rock")o.rotation.y=t.x*1.3;if(window.TBTiles)TBTiles.dress(o,file);shade(o);
o.position.copy(t.mesh.position);scene.add(o);t.mesh.visible=false;if(t.mesh.parent)t.mesh.parent.remove(t.mesh);
t.mesh=o;t.oy=0;
}
let oxTeam=null;
function playOx(a,name){
if(!a||!a.actions[name]||a.clip===name)return;
const next=a.actions[name],prev=a.clip?a.actions[a.clip]:null;
if(!prev){next.reset().play();a.clip=name;return;}
next.reset().fadeIn(.2).play();prev.fadeOut(.2);a.clip=name;
}
function dressOxen(ctx){
const W=(ctx.WAG||[]).find(w=>w.ox);if(!W)return;
const hide=[];W.ox.traverse(n=>{if(n.isMesh)hide.push(n);});hide.forEach(n=>n.visible=false);
const team=[];
[-.78,.78].forEach(x=>{
const built=TBAssets.cloneSkinned(TB_ROOT+"models/animals/ox.glb");if(!built)return;
built.root.scale.setScalar(.8);built.root.position.set(x,0,.15);
shade(built.root);built.root.traverse(n=>{n.frustumCulled=false;});W.ox.add(built.root);
const mixer=new THREE.AnimationMixer(built.root),actions={};
built.clips.forEach(c=>{const act=mixer.clipAction(c);act.setLoop(THREE.LoopRepeat,Infinity);actions[c.name]=act;});
const a={mixer,actions,clip:""};team.push(a);playOx(a,"Idle");
});
oxTeam={W:W,team:team};
}
function stepOxen(dt){
if(!oxTeam)return;
const sp=Math.abs(oxTeam.W.v||0),name=sp>2.4?"Run":sp>.12?"Walk":"Idle";
oxTeam.team.forEach(a=>{playOx(a,name);a.mixer.timeScale=name==="Run"?.85+Math.min(.3,sp*.08):name==="Walk"?.55+Math.min(.5,sp*.12):1;a.mixer.update(dt);});
}
/* colliders for these pads already exist; the grey cubes do not */
function dressSteps(){
[{f:"ult_stone_flat_brown",x:4,z:-2,yaw:.4,sx:.9,sy:.58,sz:.88},
{f:"ult_rock_large",x:6,z:-2,yaw:.55,sx:.46,sy:.3,sz:.55},
{f:"ult_stone_big_tall",x:8,z:-2,yaw:-.35,sx:.7,sy:.44,sz:.72},
{f:"ult_rock_terrasse",x:-7,z:-5,yaw:.18,sx:.95,sy:.55,sz:.78},
{f:"ult_stone_flat_brown",x:-3,z:4,yaw:1.15,sx:.55,sy:.72,sz:.55},
{f:"ult_stone_flat_brown",x:9,z:5,yaw:.7,sx:.62,sy:.68,sz:.62}].forEach(p=>{
const o=TBAssets.cloneProp(propUrl(p.f));if(!o)return;
o.position.set(p.x,0,p.z);o.rotation.y=p.yaw||0;o.scale.set(p.sx,p.sy,p.sz);if(window.TBTiles)TBTiles.dress(o,p.f);shade(o);scene.add(o);
});
}
function dressLegacy(ctx){
const TH=ctx.TH||[];
TH.forEach(t=>{if(t.k==="rock")swapCarry(t,"ult_rock_large",.15);else if(t.k==="crate")swapCarry(t,"ult_crate_box",.85);});
(ctx.WAG||[]).forEach(W=>{
const hide=[];W.g.traverse(n=>{if(n.isMesh)hide.push(n);});
const o=TBAssets.cloneProp(propUrl("ult_horse_wagon"));if(!o)return;
hide.forEach(n=>n.visible=false);o.scale.setScalar(.8);if(window.TBTiles)TBTiles.dress(o,"ult_horse_wagon");shade(o);W.g.add(o);
});
if(ctx.HG){
const built=TBAssets.cloneSkinned(TB_ROOT+"models/animals/horse.glb");
if(built){
const hide=[];ctx.HG.traverse(n=>{if(n.isMesh)hide.push(n);});hide.forEach(n=>n.visible=false);
built.root.scale.setScalar(.88);shade(built.root);built.root.traverse(n=>{n.frustumCulled=false;});ctx.HG.add(built.root);
const mixer=new THREE.AnimationMixer(built.root),actions={};
built.clips.forEach(c=>{const act=mixer.clipAction(c);act.setLoop(THREE.LoopRepeat,Infinity);actions[c.name]=act;});
horse={mixer,actions,clip:""};playHorse("Idle");
}
}
const cabin=TBAssets.cloneProp(propUrl("ult_building_cabin_small"));
if(cabin){
scene.traverse(n=>{
if(!n.isMesh)return;
const p=n.position;if(Math.abs(p.x+13)<.35&&(Math.abs(p.z+10)<.6||Math.abs(p.z+8.46)<.4))n.visible=false;
});
const s=.9,depth=6.673*s;cabin.scale.setScalar(s);cabin.position.set(-13,0,-8.15-depth/2);shade(cabin);scene.add(cabin);
}
dressPines();dressSteps();dressOxen(ctx);
[[19,-1],[24.6,-1]].forEach(sp=>{
scene.children.forEach(o=>{
if(!o.isGroup)return;
if(Math.abs(o.position.x-sp[0])<.25&&Math.abs(o.position.z-sp[1])<.25)o.traverse(n=>{if(n.isMesh)n.visible=false;});
});
});
}
function dressPines(){
const spots=[];
scene.traverse(n=>{
if(!n.isInstancedMesh||!n.geometry)return;
if(n.geometry.type==="CylinderGeometry"){
const m=new THREE.Matrix4(),p=new THREE.Vector3(),q=new THREE.Quaternion(),s=new THREE.Vector3();
for(let i=0;i<n.count;i++){n.getMatrixAt(i,m);m.decompose(p,q,s);if(clearOf(p.x,p.z))spots.push({x:p.x,z:p.z,s:s.x*.78,yaw:i*1.7});}
n.visible=false;
}else if(n.geometry.type==="ConeGeometry")n.visible=false;
});
PINES.forEach((pz,i)=>{
scene.traverse(n=>{
if(!n.isMesh||n.isInstancedMesh||!n.geometry)return;
if(Math.hypot(n.position.x-pz[0],n.position.z-pz[1])<.45&&(n.geometry.type==="ConeGeometry"||n.geometry.type==="CylinderGeometry"))n.visible=false;
});
if(clearOf(pz[0],pz[1]))spots.push({x:pz[0],z:pz[1],s:.74+(i%4)*.04,yaw:i*1.3});
});
if(window.TBTiles)TBTiles.addPines(scene,spots.map(s=>({x:s.x,y:groundY(s.x,s.z),z:s.z,s:s.s,yaw:(s.yaw||0)*.25})));
}
function playHorse(name){
if(!horse||!horse.actions[name]||horse.clip===name)return;
const next=horse.actions[name],prev=horse.clip?horse.actions[horse.clip]:null;
if(!prev){next.reset().play();horse.clip=name;return;}
next.reset().fadeIn(.18).play();prev.fadeOut(.18);horse.clip=name;
}
function stepHorse(dt){
if(!horse)return;
const h=hook&&hook.TH&&hook.TH.find(t=>t.k==="horse");
const sp=h?h.sp||0:0;
const name=sp>.72&&horse.actions.Run?"Run":sp>.08&&horse.actions.Walk?"Walk":"Idle";
playHorse(name);
horse.mixer.timeScale=name==="Run"?.9+Math.min(.35,sp*.15):name==="Walk"?.6+Math.min(.55,sp):1;
horse.mixer.update(dt);
}
const FLOWER={};
function flowerMaterial(src,mode){
if(FLOWER[mode])return FLOWER[mode];
const img=src.map&&src.map.image;if(!img||!img.width)return src;
const c=document.createElement("canvas");c.width=img.width;c.height=img.height;const g=c.getContext("2d");g.drawImage(img,0,0);
const im=g.getImageData(0,0,c.width,c.height),d=im.data;
for(let i=0;i<d.length;i+=4){
const r=d[i],gv=d[i+1],b=d[i+2];
if(r>gv+30&&r>b+20&&r>80){
if(mode==="yellow"){d[i]=Math.min(255,r);d[i+1]=Math.min(255,r*.82)|0;d[i+2]=(r*.22)|0;}
else{d[i]=Math.min(255,r*.5+150)|0;d[i+1]=Math.min(255,r*.48+155)|0;d[i+2]=Math.min(255,r*.46+150)|0;}
}
}
g.putImageData(im,0,0);
const t=new THREE.CanvasTexture(c);t.flipY=src.map.flipY;t.magFilter=t.minFilter=THREE.NearestFilter;t.generateMipmaps=false;t.colorSpace=src.map.colorSpace||THREE.SRGBColorSpace;
const m=src.clone();m.map=t;FLOWER[mode]=m;return m;
}
function hash(i,s){const v=Math.sin(i*127.1+s*311.7)*43758.5453;return v-Math.floor(v);}
const scattered=[];
function markScatter(o,file){
if(!o)return;
o.userData.tbRoll=hash(scattered.length+1,9);
o.userData.tbFlower=/flower/.test(file)?1:0;
scattered.push(o);
}
function applyScatter(density, flower){
if(window.TBArea&&TBArea.active&&TBArea.active()){
scattered.forEach(function(o){o.visible=false;});
if(window.TBTiles&&TBTiles.setDress)TBTiles.setDress(0,0);
return;
}
const f=flower>=.2?1:Math.max(0,flower/.2);
scattered.forEach(function(o){
const show=o.userData.tbRoll<density;
o.visible=o.userData.tbFlower?show&&o.userData.tbRoll<f:show;
});
if(window.TBTiles&&TBTiles.setDress)TBTiles.setDress(density, flower);
}
function dropProp(file,x,z,s,yaw,mode,cast){
if(window.TBTiles&&TBTiles.isBush(file)){
const o=TBTiles.makeBush(s,Math.round(x*5+z));
o.position.set(x,groundY(x,z),z);o.rotation.y=yaw||0;
if(cast)shade(o);markScatter(o,file);root.add(o);return;
}
const o=TBAssets.cloneProp(propUrl(file));if(!o)return;
if(mode)o.traverse(n=>{if(n.isMesh&&n.material&&!Array.isArray(n.material))n.material=flowerMaterial(n.material,mode);});
if(window.TBTiles)TBTiles.dress(o,file);
o.position.set(x,groundY(x,z),z);o.rotation.y=yaw||0;o.scale.setScalar(s);
if(cast)shade(o);else o.traverse(n=>{if(n.isMesh)n.receiveShadow=true;});
markScatter(o,file);root.add(o);
}
function scatter(){
const trees=[];PROPS.forEach(p=>{if(p.block==="trunk")trees.push([p.x,p.z,0]);});PINES.forEach(p=>trees.push([p[0],p[1],1]));
const pois=[[38,-24],[17,53],[42,36],[48,-55],[8,27]];
let n=0;
for(let i=0;i<2400&&n<260;i++){
const x=-12+hash(i,1)*66,z=-68+hash(i,2)*136;
if(x>14&&x<32&&Math.abs(z)<24)continue;
if(Math.abs(x)<2.6&&z>-16&&z<14)continue;
if(!clearOf(x,z))continue;
let core=false;for(let k=0;k<PATCHES.length;k++)if(blobEr(x,z,PATCHES[k])<.7){core=true;break;}
if(core)continue;
if(x<-14||x>55||z<-72||z>72)continue;
if(window.TBTiles&&TBTiles.occupies(x,z))continue;
let dens=.15;
for(let k=0;k<trees.length;k++){const d=Math.hypot(x-trees[k][0],z-trees[k][1]);if(d<7)dens+=.5*(1-d/7);}
for(let k=0;k<pois.length;k++){const d=Math.hypot(x-pois[k][0],z-pois[k][1]);if(d<12)dens+=.38*(1-d/12);}
if(hash(i,3)>Math.min(.9,dens))continue;
const r=hash(i,4);let file,s,mode=null,cast=false;
if(r<.44){file=["ult_grass_basic","ult_grass_clumb","ult_grass_tall"][i%3];s=file==="ult_grass_clumb"?.75:.4;}
else if(r<.64){file="ult_flower_red";s=1.2;mode=r<.5?null:r<.57?"yellow":"white";}
else if(r<.74){file="ult_shrub_flowers";s=.5;}
else if(r<.88){if(trees.some(t=>t[2]&&Math.hypot(x-t[0],z-t[1])<2.3))continue;file=r<.82?"ult_bush_small":"ult_shrub_round";s=r<.82?.9:.55;cast=true;}
else if(r<.96){file="ult_rocks_small_brown";s=.8+hash(i,5)*.55;cast=true;}
else{file="ult_stump_small";s=.9;cast=true;}
dropProp(file,x,z,s*(.85+hash(i,7)*.3),hash(i,6)*6.28,mode,cast);n++;
}
trees.forEach((tr,ti)=>{
for(let k=0;k<4;k++){
/* pine skirts reach ~1.5m, so a bush closer than that pokes through the branches like a green ball */
const a=hash(ti,k+2)*6.28,rad=(tr[2]&&k===0?2.3:1.5)+hash(ti,k+8)*2.1,x=tr[0]+Math.sin(a)*rad,z=tr[1]+Math.cos(a)*rad;
if(x>14&&x<32&&Math.abs(z)<22)continue;
if(!clearOf(x,z))continue;
const file=k===0?"ult_bush_small":k===1?"ult_flower_red":"ult_grass_clumb";
const mode=k===1?(ti%3===0?"yellow":ti%3===1?"white":null):null;
dropProp(file,x,z,k===0?.75:k===1?1.25:.7,a,mode,k===0);
}
});
}
function peek(x,z,view){
if(!players||!players[0])return;
const p=players[0];
p.x=x;p.z=z;p.y=groundY(x,z);p.vx=p.vy=p.vz=0;p.g=true;p.snap=true;
if(goView&&view!=null)goView(view);
}
async function boot(ctx){
if(!window.THREE||!THREE.GLTFLoader||!THREE.SkeletonUtils){console.warn("trail world: GLTFLoader missing");return;}
scene=ctx.scene;BX=ctx.BX;cEx=ctx.cEx;players=ctx.players||null;goView=ctx.goView||null;sun=ctx.sun||null;hook=ctx;
root=new THREE.Group();root.name="trailworld";scene.add(root);
if(ctx.ground){sculpt(ctx.ground);paintGround(ctx.ground);}
if(window.TBTiles){TBTiles.makeSky(scene);TBTiles.buildVillage(scene,groundY,BX);if(window.TBLightLab)TBLightLab.build(scene,groundY,BX,ctx.TH);if(cEx&&ctx.ground)TBTiles.grassLip(scene,cEx,ctx.ground.material);}
const urls=[],extra=["ult_horse_wagon","ult_building_cabin_small","ult_crate_box","ult_rock_large","ult_rock_terrasse","ult_stone_flat_brown","ult_stone_big_tall","ult_tree_conifer","ult_grass_clumb","ult_grass_basic","ult_grass_tall","ult_flower_red","ult_shrub_flowers","ult_bush_small","ult_shrub_round","ult_rocks_small_brown","ult_stump_small"];
PROPS.forEach(p=>{const u=propUrl(p.f);if(urls.indexOf(u)<0)urls.push(u);});
extra.forEach(f=>{const u=propUrl(f);if(urls.indexOf(u)<0)urls.push(u);});
ROSTER.forEach(d=>{const u=actorUrl(d);if(urls.indexOf(u)<0)urls.push(u);});
if(window.TBAvatar)TBAvatar.urls().forEach(u=>{if(urls.indexOf(u)<0)urls.push(u);});
try{
await TBAssets.warm(urls);
if(window.TBAvatar)TBAvatar.dressAll();
if(ctx.rigs)ctx.rigs.forEach(rg=>{if(rg&&rg.root)rg.root.traverse(n=>{if(n.isMesh){n.castShadow=true;n.receiveShadow=true;}});});
dressLegacy(ctx);scatter();
if(window.TBTiles)TBTiles.scatterDress(scene,groundY,function(x,z){return !clearOf(x,z);});
let n=0;PROPS.forEach(p=>{if(place(p))n++;});
TBLife.start({root:root,roster:ROSTER,BX:BX,walkable:walkable});
ready=true;
console.info("trail world ready:",n,"props,",TBLife.count(),"wanderers");
if(window.TBVisuals)TBVisuals.worldReady();
}catch(e){console.warn("trail world failed",e);}
}
function update(dt){
if(!ready)return;
t+=dt;TBLife.update(dt);stepHorse(dt);
if(fire)fire.intensity=1.45+Math.sin(t*7.5)*.22+Math.sin(t*17)*.07;
if(sun&&players&&players[0]){const p=players[0];let ox=-27,oy=28,oz=27;if(window.TBVisuals){const o=TBVisuals.sunOffset();ox=o.x;oy=o.y;oz=o.z;}sun.position.set(p.x+ox,oy,p.z+oz);sun.target.position.set(p.x,.4,p.z);}
if(window.TBTiles)TBTiles.tick(dt);
stepOxen(dt);
}
window.TBWorld={outdoor:outdoor,openGround:openGround,boot:boot,update:update,peek:peek,groundY:groundY,rimRoadX:rimRoadX,clearOf:clearOf,applyScatter:applyScatter,ready:()=>ready};
})();
