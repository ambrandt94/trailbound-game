/* Ported from trailbound-controller (deployed main). ESM, behaviour-faithful.
   Not typechecked: a full TS conversion of these files would stall the port.
   three r187: colorSpace, colorspace_fragment, per-fragment Lambert cel, asset root.
*/
import { THREE } from './three-runtime.js';
/* Street buildings for an AreaExport.
   One row per world-map type (trailbound-world-map src/app/engine/buildings.ts).
   `model` stays null until a Model Forge glb replaces that type; the recipe is
   the procedural house / stall / well builders exported from tiles.js.
   Meadow houses do not come through this table, so their calls stay as they were.
   Map +y is south. three.z = (innerY - innerOrigin.y) * metres.
   v0.2: `tiles` is the plot mask (already world-aligned). Walls, the door and
   the roof follow that mask. A building with no mask keeps the fitted recipe
   shell (cottage 6×5, shop 7×6, civic at most 10×8) and the yard around it.
   1 inner tile stays 1 m. The player rig is about 1.6 m. */
(function(){
/* `kit` / kitW / kitD / kitH size a v0.6 shell. Legacy rows keep today's
   recipe unless the building sets `kit` or shape "kit". `model` stays null
   until a GLB replaces that row. family is the placeholder colour. */
const BUILDING_MAP={
"cottage-1":{recipe:"house",floors:1,roof:"vary",wall:"vary",model:null,family:"res"},
"cottage-2":{recipe:"house",floors:1,roof:"vary",wall:"vary",model:null,family:"res"},
"cottage-3":{recipe:"house",floors:1,roof:"vary",wall:"vary",model:null,family:"res"},
"house-1":{recipe:"house",floors:1,roof:"vary",wall:"vary",model:null,family:"res"},
"house-2":{recipe:"house",floors:1,roof:"vary",wall:"vary",model:null,family:"res"},
"house-3":{recipe:"house",floors:1,roof:"vary",wall:"vary",model:null,family:"res"},
"house-5":{recipe:"house",floors:1,roof:"vary",wall:"vary",model:null,family:"res"},
"house-7":{recipe:"house",floors:2,roof:"vary",wall:"vary",model:null,family:"res"},
"house-8":{recipe:"house",floors:2,roof:"slate",wall:"plaster",model:null,family:"res"},
"shop":{recipe:"shop",floors:1,roof:"clay",wall:"plaster",sign:"market",awning:1,stall:1,model:null,family:"shop"},
"blacksmith":{recipe:"smith",floors:1,roof:"slate",wall:"stone",flowers:0,model:null,family:"work"},
"inn":{recipe:"inn",floors:2,roof:"clay",wall:"plaster",sign:"inn",awning:1,model:null,family:"shop",kit:"bld_shop_inn_temperate_9x12",kitW:9,kitD:12,kitH:11},
"inn-2":{recipe:"inn",floors:2,roof:"slate",wall:"timber",sign:"inn",model:null,family:"shop"},
"tavern":{recipe:"inn",floors:2,roof:"clay",wall:"timber",sign:"inn",awning:1,model:null,family:"shop",kit:"bld_shop_tavern_temperate_9x9",kitW:9,kitD:9,kitH:10.25},
"church":{recipe:"church",floors:1,roof:"slate",wall:"stone",flowers:0,chimney:0,tower:1,model:null,family:"civic"},
"town-hall":{recipe:"hall",floors:2,roof:"slate",wall:"stone",flowers:0,model:null,family:"civic",kit:"bld_civic_town_hall_temperate_12x12",kitW:12,kitD:12,kitH:20.375},
"farm":{recipe:"farm",floors:1,roof:"clay",wall:"timber",model:null,family:"farm",kit:"bld_farm_barn_temperate_9x12",kitW:9,kitD:12,kitH:9},
"general_store":{recipe:"shop",floors:2,roof:"clay",wall:"plaster",sign:"market",awning:1,stall:1,model:null,family:"shop",kit:"bld_shop_general_store_temperate_6x9",kitW:6,kitD:9,kitH:8.75},
"market_stall":{recipe:"shop",floors:1,roof:"clay",wall:"plaster",sign:"market",awning:1,stall:1,model:null,family:"shop",kit:"bld_shop_market_stall_temperate_3x1.5",kitW:3,kitD:1.5,kitH:2.5},
"provisioner":{recipe:"shop",floors:2,roof:"clay",wall:"plaster",sign:"market",awning:1,stall:1,model:null,family:"shop",kit:"bld_shop_provisioner_temperate_6x6",kitW:6,kitD:6,kitH:7.5},
"bank":{recipe:"hall",floors:2,roof:"slate",wall:"stone",flowers:0,model:null,family:"shop",kit:"bld_shop_exchange_temperate_9x9",kitW:9,kitD:9,kitH:12},
"outfitter":{recipe:"shop",floors:2,roof:"clay",wall:"plaster",sign:"market",awning:1,model:null,family:"shop",kit:"bld_shop_outfitter_temperate_6x6",kitW:6,kitD:6,kitH:7.5},
"bakery":{recipe:"shop",floors:1,roof:"clay",wall:"plaster",sign:"market",awning:1,model:null,family:"shop",kit:"bld_shop_bakery_temperate_6x6",kitW:6,kitD:6,kitH:6.125},
"apothecary":{recipe:"shop",floors:2,roof:"clay",wall:"plaster",sign:"market",model:null,family:"shop",kit:"bld_shop_apothecary_temperate_6x6",kitW:6,kitD:6,kitH:8.75},
"butcher":{recipe:"shop",floors:1,roof:"clay",wall:"plaster",sign:"market",model:null,family:"shop",kit:"bld_shop_butcher_temperate_6x6",kitW:6,kitD:6,kitH:6.125},
"fishmonger":{recipe:"shop",floors:1,roof:"clay",wall:"plaster",sign:"market",awning:1,model:null,family:"shop",kit:"bld_shop_fishmonger_temperate_6x6",kitW:6,kitD:6,kitH:6.125},
"jeweller":{recipe:"shop",floors:2,roof:"slate",wall:"plaster",sign:"market",model:null,family:"shop",kit:"bld_shop_jeweller_temperate_3x6",kitW:3,kitD:6,kitH:9.875},
"chandler":{recipe:"shop",floors:2,roof:"clay",wall:"plaster",sign:"market",model:null,family:"shop",kit:"bld_shop_chandler_temperate_6x6",kitW:6,kitD:6,kitH:8.75},
"cartographer":{recipe:"shop",floors:2,roof:"slate",wall:"plaster",sign:"market",model:null,family:"shop",kit:"bld_shop_cartographer_temperate_6x6",kitW:6,kitD:6,kitH:8.75},
"curio":{recipe:"shop",floors:2,roof:"slate",wall:"plaster",sign:"market",model:null,family:"shop",kit:"bld_shop_curio_temperate_6x9",kitW:6,kitD:9,kitH:8.75},
"enchanter":{recipe:"shop",floors:2,roof:"slate",wall:"plaster",sign:"market",model:null,family:"shop",kit:"bld_shop_enchanter_temperate_6x6",kitW:6,kitD:6,kitH:8.75},
"smithy":{recipe:"smith",floors:1,roof:"slate",wall:"stone",flowers:0,model:null,family:"work",kit:"bld_work_smithy_temperate_6x9",kitW:6,kitD:9,kitH:8.125},
"armourer":{recipe:"smith",floors:1,roof:"slate",wall:"stone",flowers:0,model:null,family:"work",kit:"bld_work_armourer_temperate_6x9",kitW:6,kitD:9,kitH:8.125},
"carpenter":{recipe:"house",floors:1,roof:"clay",wall:"timber",model:null,family:"work",kit:"bld_work_carpenter_temperate_6x9",kitW:6,kitD:9,kitH:6.125},
"tanner":{recipe:"house",floors:1,roof:"clay",wall:"timber",model:null,family:"work",kit:"bld_work_tannery_temperate_6x9",kitW:6,kitD:9,kitH:6.125},
"tannery":{recipe:"house",floors:1,roof:"clay",wall:"timber",model:null,family:"work",kit:"bld_work_tannery_temperate_6x9",kitW:6,kitD:9,kitH:6.125},
"weaver":{recipe:"house",floors:2,roof:"clay",wall:"plaster",model:null,family:"work",kit:"bld_work_weaver_temperate_6x6",kitW:6,kitD:6,kitH:8.75},
"cooper":{recipe:"house",floors:1,roof:"clay",wall:"timber",model:null,family:"work",kit:"bld_work_cooper_temperate_6x6",kitW:6,kitD:6,kitH:6.125},
"potter":{recipe:"house",floors:1,roof:"clay",wall:"timber",model:null,family:"work",kit:"bld_work_potter_temperate_6x6",kitW:6,kitD:6,kitH:6.125},
"stables":{recipe:"farm",floors:1,roof:"clay",wall:"timber",model:null,family:"work",kit:"bld_work_stables_temperate_6x12",kitW:6,kitD:12,kitH:6.125},
"wagonwright":{recipe:"house",floors:1,roof:"clay",wall:"timber",model:null,family:"work",kit:"bld_work_wagonwright_temperate_6x9",kitW:6,kitD:9,kitH:6.125},
"mill_water":{recipe:"farm",floors:2,roof:"clay",wall:"timber",model:null,family:"work",kit:"bld_work_mill_water_temperate_6x9",kitW:6,kitD:9,kitH:8.75},
"mill_wind":{recipe:"farm",floors:2,roof:"clay",wall:"timber",model:null,family:"work",kit:"bld_work_mill_wind_temperate_6x6",kitW:6,kitD:6,kitH:23.375},
"lumber_mill":{recipe:"farm",floors:1,roof:"clay",wall:"timber",model:null,family:"work",kit:"bld_work_lumber_mill_temperate_6x12",kitW:6,kitD:12,kitH:8.75},
"smelter":{recipe:"smith",floors:1,roof:"slate",wall:"stone",flowers:0,model:null,family:"work",kit:"bld_work_smelter_temperate_6x9",kitW:6,kitD:9,kitH:8.125},
"fishery":{recipe:"shop",floors:1,roof:"clay",wall:"timber",model:null,family:"work",kit:"bld_work_fishery_coastal_6x9",kitW:6,kitD:9,kitH:6.125},
"glassblower":{recipe:"house",floors:1,roof:"clay",wall:"stone",model:null,family:"work",kit:"bld_work_glassblower_temperate_6x6",kitW:6,kitD:6,kitH:6.125},
"bookbinder":{recipe:"shop",floors:2,roof:"slate",wall:"plaster",model:null,family:"work",kit:"bld_work_bookbinder_temperate_6x6",kitW:6,kitD:6,kitH:8.75},
"royal_forge":{recipe:"smith",floors:2,roof:"slate",wall:"stone",flowers:0,model:null,family:"work",kit:"bld_work_royal_forge_temperate_12x15",kitW:12,kitD:15,kitH:12},
"barn":{recipe:"farm",floors:1,roof:"clay",wall:"timber",model:null,family:"farm",kit:"bld_farm_barn_temperate_9x12",kitW:9,kitD:12,kitH:9},
"granary":{recipe:"farm",floors:1,roof:"clay",wall:"stone",model:null,family:"farm",kit:"bld_farm_granary_temperate_6x6",kitW:6,kitD:6,kitH:6},
"shed":{recipe:"farm",floors:1,roof:"clay",wall:"timber",model:null,family:"farm",kit:"bld_farm_shed_temperate_3x3",kitW:3,kitD:3,kitH:3},
"hovel":{recipe:"house",floors:1,roof:"clay",wall:"timber",model:null,family:"res",kit:"bld_res_hovel_temperate_3x6",kitW:3,kitD:6,kitH:4.625},
"tent":{recipe:"house",floors:1,roof:"clay",wall:"plaster",flowers:0,chimney:0,model:null,family:"res",kit:"bld_res_tent_3x3",kitW:3,kitD:3,kitH:2.25},
"cottage":{recipe:"house",floors:1,roof:"vary",wall:"vary",model:null,family:"res",kit:"bld_res_cottage_temperate_6x6",kitW:6,kitD:6,kitH:7.5},
"townhouse":{recipe:"house",floors:2,roof:"slate",wall:"plaster",model:null,family:"res",kit:"bld_res_townhouse_temperate_6x6",kitW:6,kitD:6,kitH:11.375},
"manor":{recipe:"house",floors:2,roof:"slate",wall:"stone",model:null,family:"res",kit:"bld_res_manor_temperate_9x9",kitW:9,kitD:9,kitH:12},
"estate":{recipe:"house",floors:2,roof:"slate",wall:"stone",model:null,family:"res",kit:"bld_res_estate_temperate_12x12",kitW:12,kitD:12,kitH:14.875},
"temple":{recipe:"church",floors:2,roof:"slate",wall:"stone",flowers:0,chimney:0,tower:1,model:null,family:"civic",kit:"bld_civic_temple_temperate_9x15",kitW:9,kitD:15,kitH:17.75},
"healer":{recipe:"church",floors:1,roof:"slate",wall:"stone",flowers:0,chimney:0,model:null,family:"civic",kit:"bld_civic_healer_temperate_6x9",kitW:6,kitD:9,kitH:8},
"town_hall":{recipe:"hall",floors:2,roof:"slate",wall:"stone",flowers:0,model:null,family:"civic",kit:"bld_civic_town_hall_temperate_12x12",kitW:12,kitD:12,kitH:20.375},
"guildhall":{recipe:"hall",floors:2,roof:"slate",wall:"stone",flowers:0,model:null,family:"civic",kit:"bld_civic_guildhall_temperate_12x15",kitW:12,kitD:15,kitH:14.375},
"guard_post":{recipe:"house",floors:1,roof:"slate",wall:"stone",flowers:0,model:null,family:"civic",kit:"bld_civic_guard_post_temperate_6x6",kitW:6,kitD:6,kitH:6},
"watchtower":{recipe:"church",floors:2,roof:"slate",wall:"stone",flowers:0,chimney:0,tower:1,model:null,family:"civic",kit:"civ_wall_tower_6x6",kitW:6,kitD:6,kitH:10.5},
"library":{recipe:"hall",floors:2,roof:"slate",wall:"stone",flowers:0,model:null,family:"civic",kit:"bld_civic_library_temperate_12x15",kitW:12,kitD:15,kitH:14.375},
"arena":{recipe:"hall",floors:1,roof:"slate",wall:"stone",flowers:0,chimney:0,model:null,family:"civic",kit:"bld_civic_arena_temperate_24x30",kitW:24,kitD:30,kitH:8},
"keep":{recipe:"hall",floors:2,roof:"slate",wall:"stone",flowers:0,model:null,family:"civic",kit:"bld_civic_keep_temperate_15x15",kitW:15,kitD:15,kitH:16},
"well":{recipe:"marker",floors:1,model:null,family:"deco",kit:"prop_well_roofed",kitW:3,kitD:3,kitH:3},
"shrine":{recipe:"marker",floors:1,model:null,family:"deco",kit:"deco_shrine_wayside",kitW:1,kitD:1,kitH:1.75},
"notice_board":{recipe:"marker",floors:1,model:null,family:"deco",kit:"prop_notice_board",kitW:1.5,kitD:0.5,kitH:2},
"fountain":{recipe:"marker",floors:1,model:null,family:"deco",kit:"deco_fountain_s_3x3",kitW:3,kitD:3,kitH:1.5},
"statue":{recipe:"marker",floors:1,model:null,family:"deco",kit:"deco_statue_s",kitW:1.5,kitD:1.5,kitH:3.25},
"dock":{recipe:"marker",floors:1,model:null,family:"deco",kit:"prop_pier_3x3",kitW:3,kitD:3,kitH:0.5},
"bridge":{recipe:"marker",floors:1,model:null,family:"deco",kit:"prop_bridge_plank_6m",kitW:3,kitD:6,kitH:1}
};
const FALLBACK={recipe:"house",floors:1,roof:"vary",wall:"vary",model:null};

function hashId(id){
const s=String(id==null?"":id);
let h=2166136261;
for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}
return h>>>0;
}
function seedOf(id){
const h=hashId(id);
return {slate:(h&1)===1,timber:(h&2)===2,tall:(h&4)===4,blue:(h&8)===8};
}
function recipeFor(type){
const rec=BUILDING_MAP[type];
return rec||FALLBACK;
}
function legacyType(type){
return !!BUILDING_MAP[type]&&(type==="cottage-1"||type==="cottage-2"||type==="cottage-3"||type==="house-1"||type==="house-2"||type==="house-3"||type==="house-5"||type==="house-7"||type==="house-8"||type==="shop"||type==="blacksmith"||type==="inn"||type==="inn-2"||type==="tavern"||type==="church"||type==="town-hall"||type==="farm");
}
/* Kit bbox from the building's kit name, then a style swap, then the map row. */
function kitBox(b,rec){
const name=(b&&b.kit)||(rec&&rec.kit)||"";
if(name&&window.TBKit&&TBKit.get){
const item=TBKit.get(name);
if(item&&item.w&&item.d)return {w:item.w,d:item.d,h:item.h||(rec&&rec.kitH)||0,name:name};
}
if(b&&b.style&&rec&&rec.kit&&window.TBKit&&TBKit.get){
const swapped=String(rec.kit).replace("_temperate_","_"+b.style+"_");
const item=TBKit.get(swapped);
if(item&&item.w&&item.d)return {w:item.w,d:item.d,h:item.h||0,name:swapped};
}
if(rec&&rec.kitW&&rec.kitD)return {w:rec.kitW,d:rec.kitD,h:rec.kitH||0,name:name};
return null;
}
function wantsKit(b,rec){
if(!b||!rec||!kitBox(b,rec))return false;
if(b.shape==="kit"||b.kit)return true;
if(legacyType(b.type||b.sprite||""))return false;
return !!(rec.kitW&&rec.kitD);
}
function kitMetrics(box,rec,b){
const storeys=+((b&&b.storeys)||(rec&&rec.floors)||1);
const floors=storeys>=2?2:1;
const rise=floors>1?1.6:1.35;
const h=+box.h||0;
const wallH=h>2?Math.max(1.5,h-rise-0.45):(floors>1?3.2:2.2);
return {floors:floors,rise:rise,wallH:wallH};
}
/* AreaExport tiles legend. The stamp is already rotated, so the mask is world-aligned. */
const VOID=0,YARD=1,FLOOR=2,WALL=3,DOOR=4,WIN=5,TOWER=6;
const SIDE={
N:{nx:0,nz:-1,yaw:Math.PI},
S:{nx:0,nz:1,yaw:0},
E:{nx:1,nz:0,yaw:Math.PI/2},
W:{nx:-1,nz:0,yaw:-Math.PI/2}
};
function decodeB64(data){
if(data==null)return null;
if(typeof data!=="string"){
const u=new Uint8Array(data.length);
for(let i=0;i<data.length;i++)u[i]=data[i]&255;
return u;
}
const chars="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const s=String(data).replace(/[^A-Za-z0-9+/=]/g,"");
const out=[];
let buf=0,bits=0;
for(let i=0;i<s.length;i++){
const c=s.charAt(i);
if(c==="=")break;
const v=chars.indexOf(c);
if(v<0)continue;
buf=(buf<<6)|v;bits+=6;
if(bits>=8){bits-=8;out.push((buf>>bits)&255);}
}
const u=new Uint8Array(out.length);
for(let i=0;i<out.length;i++)u[i]=out[i];
return u;
}
function maskOf(b){
if(!b||!b.tiles||b.tiles.data==null)return null;
const w=b.tiles.w|0,h=b.tiles.h|0;
if(!(w>0)||!(h>0))return null;
const grid=decodeB64(b.tiles.data);
if(!grid||grid.length!==w*h)return null;
return {w:w,h:h,grid:grid};
}
function prettyName(b,rec){
if(b&&b.label&&String(b.label).trim())return String(b.label).trim();
const t=String(b&&b.type||"");
if(/^house|^cottage/.test(t))return "House";
if(t==="blacksmith")return "Smithy";
if(t==="town-hall")return "Town hall";
if(!t)return (rec&&rec.recipe)||"Building";
if(t.indexOf("_")>=0){
return t.split("_").map(function(w){return w?w.charAt(0).toUpperCase()+w.slice(1):"";}).join(" ");
}
return t.charAt(0).toUpperCase()+t.slice(1);
}
function yawInOf(yaw){
let y=yaw+Math.PI;
if(y>Math.PI)y-=Math.PI*2;
if(y<-Math.PI)y+=Math.PI*2;
return y;
}
/* u 0 west → 1 east, v 0 north → 1 south. Same cuts as buildings.ts footprintAt. */
function inShape(shape,u,v){
if(shape==="t-south"){
if(v<0.6)return true;
return u>=0.3&&u<=0.7;
}
if(shape==="l-east"){
if(u<0.66)return true;
return v>=0.46;
}
return true;
}
/* Visual parts may overlap a little so the joint has no crack.
   cw/cd/cox/coz are the solid footprint used for collision. */
function partsFor(shape,fw,fd){
if(shape==="t-south"){
const barD=fd*0.6,stemD=fd*0.4,stemW=fw*0.4,visD=barD+0.35;
return [
{w:fw,d:visD,ox:0,oz:-fd/2+visD/2,door:0,hall:1,cw:fw,cd:barD,cox:0,coz:-fd/2+barD/2},
{w:stemW,d:stemD,ox:0,oz:fd/2-stemD/2,door:1,hall:0,cw:stemW,cd:stemD,cox:0,coz:fd/2-stemD/2}
];
}
if(shape==="l-east"){
const westW=fw*0.66,eastW=fw-westW,wingD=fd*0.54,visW=westW+0.35;
return [
{w:visW,d:fd,ox:-fw/2+visW/2,oz:0,door:1,hall:1,cw:westW,cd:fd,cox:-fw/2+westW/2,coz:0},
{w:eastW,d:wingD,ox:fw/2-eastW/2,oz:fd/2-wingD/2,door:0,hall:0,cw:eastW,cd:wingD,cox:fw/2-eastW/2,coz:fd/2-wingD/2}
];
}
return [{w:fw,d:fd,ox:0,oz:0,door:1,hall:1,cw:fw,cd:fd,cox:0,coz:0}];
}
function anchorOf(b,origin,meters){
const m=meters||1,ox=origin&&origin.x||0,oy=origin&&origin.y||0;
return {x:(+b.x-ox)*m,z:(+b.y-oy)*m};
}
function sampleLot(groundY,cx,cz,fw,fd,shape){
let min=Infinity,max=-Infinity,sum=0,n=0;
const nx=Math.max(3,Math.ceil(fw/2)),nz=Math.max(3,Math.ceil(fd/2));
for(let iz=0;iz<=nz;iz++)for(let ix=0;ix<=nx;ix++){
const u=ix/nx,v=iz/nz;
if(!inShape(shape,u,v))continue;
const y=groundY(cx-fw/2+fw*u,cz-fd/2+fd*v);
if(!isFinite(y))continue;
if(y<min)min=y;if(y>max)max=y;sum+=y;n++;
}
if(!n){
const y=groundY(cx,cz)||0;
return {min:y,max:y,avg:y};
}
return {min:min,max:max,avg:sum/n};
}
/* Floor sits just above the highest ground under the lot. Stone fills down to the lowest, plus a short bury so the skirt doesn't show a crack. */
function foundation(sample){
const bury=0.06,plinth=0.28;
const baseY=sample.min-bury;
const found=(sample.max-sample.min)+plinth+bury;
return {baseY:baseY,found:found,floorY:baseY+found};
}
/* Human sizes, in metres. Clamped down so the shell stays inside the plot
   with a yard; never grown to fill a large lot. */
const TARGET={
cottage:{w:6,d:5},
house:{w:6.2,d:5.2},
house2:{w:8,d:6.2},
shop:{w:7,d:6},
farm:{w:8,d:6},
civic:{w:10,d:8}
};
function targetOf(rec,type){
const r=rec.recipe;
if(r==="church"||r==="inn"||r==="hall")return TARGET.civic;
if(r==="shop"||r==="smith")return TARGET.shop;
if(r==="farm")return TARGET.farm;
if(rec.floors===2)return TARGET.house2;
if(String(type||"").indexOf("cottage")===0)return TARGET.cottage;
return TARGET.house;
}
function sizes(rec,floors){
if(rec.recipe==="church")return {wallH:3.15,rise:2.15};
if(floors===2)return {wallH:3.55,rise:1.6};
return {wallH:2.5,rise:1.45};
}
/* ox/oz are offsets from the plot centre. The door stays on the south face. */
function shellFits(shape,fw,fd,ox,oz,w,d,pad){
const hw=w/2+pad,hd=d/2+pad;
for(let j=0;j<=4;j++)for(let i=0;i<=4;i++){
const x=ox-hw+hw*2*i/4,z=oz-hd+hd*2*j/4;
const u=(x+fw/2)/fw,v=(z+fd/2)/fd;
if(u<-0.02||v<-0.02||u>1.02||v>1.02)return false;
if(!inShape(shape,Math.min(1,Math.max(0,u)),Math.min(1,Math.max(0,v))))return false;
}
return true;
}
function fitShell(shape,fw,fd,tw,td){
const pad=0.55,edge=0.7;
const oxs=[0],ozs=[0];
for(let k=1;k<=8;k++){oxs.push(-k*0.4,k*0.3);ozs.push(-k*0.4,k*0.25);}
for(let s=0;s<=18;s++){
const w=Math.min(tw,fw-1.2)-s*0.3;
const d=Math.min(td,fd-1.2)-s*0.25;
if(w<3.05||d<2.65)break;
for(let zi=0;zi<ozs.length;zi++)for(let xi=0;xi<oxs.length;xi++){
const ox=oxs[xi],oz=ozs[zi];
if(ox-w/2<-fw/2+edge||ox+w/2>fw/2-edge)continue;
if(oz-d/2<-fd/2+edge||oz+d/2>fd/2-edge)continue;
if(shellFits(shape,fw,fd,ox,oz,w,d,pad))return {w:w,d:d,ox:ox,oz:oz};
}
}
return {w:Math.max(2.6,Math.min(tw,fw*0.62)),d:Math.max(2.4,Math.min(td,fd*0.55)),ox:0,oz:0};
}
function yardPlan(id,rec){
const h=hashId(id);
const recipe=rec.recipe,church=recipe==="church",civic=church||recipe==="hall";
return {
dirt:!church&&(h&16)===16,
fence:recipe==="farm"||(!civic&&(h&32)===32),
garden:!civic&&recipe!=="smith"&&(h&64)===64,
crate:recipe==="shop"||recipe==="farm"||(!church&&(h&128)===128)
};
}
/* True when a prop is clear of the walk up to the door.
   Mask buildings clear a corridor along the real door side. Recipe shells
   still clear the south walk from the anchor to the face. */
function doorClear(row,x,z){
if(row&&row.masked&&row.door){
const d=row.door,dx=x-d.x,dz=z-d.z;
const along=dx*d.nx+dz*d.nz;
const across=dx*(-d.nz)+dz*d.nx;
if(Math.abs(across)>1.6)return true;
if(along<-0.45||along>3.5)return true;
return false;
}
const hx=row.cx+row.ox,face=row.cz+row.oz+row.houseD/2;
if(Math.abs(x-hx)>1.45)return true;
if(z<face-0.3)return true;
if(z>row.anchor.z+0.35)return true;
return false;
}
function yardMaskProps(row){
const out=[];
if(!row||!row.yard||!row.mask)return out;
const y=row.yard,g=row.mask.grid,w=row.mask.w,h=row.mask.h,cell=row.cell||1;
const yards=[];
for(let ty=0;ty<h;ty++)for(let tx=0;tx<w;tx++){
if(g[ty*w+tx]!==YARD)continue;
yards.push({tx:tx,ty:ty,x:row.originX+(tx+0.5)*cell,z:row.originZ+(ty+0.5)*cell});
}
function edgeSide(c){
const sides=[];
if(c.ty===0||g[(c.ty-1)*w+c.tx]===VOID)sides.push("n");
if(c.ty+1>=h||g[(c.ty+1)*w+c.tx]===VOID)sides.push("s");
if(c.tx===0||g[c.ty*w+c.tx-1]===VOID)sides.push("w");
if(c.tx+1>=w||g[c.ty*w+c.tx+1]===VOID)sides.push("e");
return sides;
}
function keep(p){if(doorClear(row,p.x,p.z))out.push(p);}
function pick(salt){
if(!yards.length)return null;
const start=(hashId(String(row.id)+"|"+salt))%yards.length;
for(let i=0;i<yards.length;i++){
const c=yards[(start+i)%yards.length];
if(doorClear(row,c.x,c.z))return c;
}
return null;
}
if(y.garden){const c=pick("garden");if(c)keep({kind:"garden",x:c.x,z:c.z});}
if(y.crate){const c=pick("crate");if(c)keep({kind:"crate",x:c.x,z:c.z});}
if(y.fence){
yards.forEach(function(c){
const sides=edgeSide(c);
if(!sides.length)return;
if(((c.tx*3+c.ty*5)&1)!==0)return;
const side=sides[0];
const t=side==="n"||side==="s"?c.tx:c.ty;
keep({kind:"post",x:c.x,z:c.z,side:side,t:t});
});
}
return out;
}
function yardProps(row){
if(row&&row.masked)return yardMaskProps(row);
const out=[];
if(!row||!row.yard)return out;
const hx=row.cx+row.ox,hz=row.cz+row.oz,face=hz+row.houseD/2;
const y=row.yard;
function keep(p){
const u=(p.x-(row.cx-row.fw/2))/row.fw,v=(p.z-(row.cz-row.fd/2))/row.fd;
if(u<0.04||u>0.96||v<0.04||v>0.96)return;
if(!inShape(row.shape,u,v))return;
if(!doorClear(row,p.x,p.z))return;
out.push(p);
}
if(y.garden)keep({kind:"garden",x:hx+(row.seed&&row.seed.blue?0.8:-0.7),z:hz-row.houseD/2-0.85});
if(y.crate){
const side=row.seed&&row.seed.blue?-1:1;
keep({kind:"crate",x:hx+side*(row.houseW/2+0.55),z:face-0.15});
}
if(y.fence){
const x0=row.cx-row.fw/2+0.45,x1=row.cx+row.fw/2-0.45;
const z0=row.cz-row.fd/2+0.45,z1=row.cz+row.fd/2-0.45;
function seg(ax,az,bx,bz,side){
const len=Math.hypot(bx-ax,bz-az),n=Math.max(1,Math.round(len/1.7));
for(let i=0;i<=n;i++){
const t=i/n;
keep({kind:"post",x:ax+(bx-ax)*t,z:az+(bz-az)*t,side:side,t:t});
}
}
seg(x0,z0,x1,z0,"n");
seg(x0,z1,x1,z1,"s");
seg(x0,z0,x0,z1,"w");
seg(x1,z0,x1,z1,"e");
}
return out;
}
function cellCenter(originX,originZ,cell,tx,ty){
return {x:originX+(tx+0.5)*cell,z:originZ+(ty+0.5)*cell};
}
function layoutMask(b,mask,origin,meters,groundY,rec,seed){
const m=meters||1;
const ox0=origin&&origin.x||0,oy0=origin&&origin.y||0;
const plotX=b.plotX!=null?+b.plotX:+b.x-(+b.footW||mask.w)/2;
const plotY=b.plotY!=null?+b.plotY:+b.y-(+b.footD||mask.h);
const plotW=b.plotW!=null?+b.plotW:mask.w;
const plotD=b.plotD!=null?+b.plotD:mask.h;
const originX=(plotX-ox0)*m, originZ=(plotY-oy0)*m;
const g=mask.grid,w=mask.w,h=mask.h;
let minTX=w,minTY=h,maxTX=-1,maxTY=-1,sx=0,sz=0,sn=0,nStruct=0;
const doorCells=[];
const structPts=[];
for(let ty=0;ty<h;ty++)for(let tx=0;tx<w;tx++){
const v=g[ty*w+tx];
if(v<FLOOR)continue;
if(tx<minTX)minTX=tx;if(ty<minTY)minTY=ty;if(tx>maxTX)maxTX=tx;if(ty>maxTY)maxTY=ty;
nStruct++;
const c=cellCenter(originX,originZ,m,tx,ty);
structPts.push(c);
if(v===DOOR)doorCells.push({tx:tx,ty:ty,x:c.x,z:c.z});
}
if(!nStruct)return null;
const side=SIDE[String(b.door||"S").toUpperCase()]||SIDE.S;
let dx=0,dz=0;
if(!doorCells.length&&b.doorCell&&isFinite(+b.doorCell.x)){
const tx=Math.floor(+b.doorCell.x-plotX),ty=Math.floor(+b.doorCell.y-plotY);
const c=cellCenter(originX,originZ,m,tx,ty);
doorCells.push({tx:tx,ty:ty,x:c.x,z:c.z});
}
doorCells.forEach(function(c){dx+=c.x;dz+=c.z;});
if(doorCells.length){dx/=doorCells.length;dz/=doorCells.length;}
else{
dx=originX+(minTX+maxTX+1)/2*m;
dz=originZ+(maxTY+0.5)*m;
}
const outX=dx+side.nx*(0.5*m+0.8), outZ=dz+side.nz*(0.5*m+0.8);
const outGY=groundY(outX,outZ);
let min=Infinity,max=-Infinity,sum=0,ns=0;
structPts.forEach(function(c){
const y=groundY(c.x,c.z);
if(!isFinite(y))return;
if(y<min)min=y;if(y>max)max=y;sum+=y;ns++;
});
if(!ns){const y=groundY(dx,dz)||0;min=max=sum=y;ns=1;}
const sample={min:min,max:max,avg:sum/ns};
const found=foundation(sample);
let floors=Math.max(1,(b.storeys|0)||(rec.floors===2?2:1));
let wallTotal=(+b.wallHeightM>0)?+b.wallHeightM:floors*2.8;
let rise=floors>1?1.65:1.4;
let kitSized=false;
if(wantsKit(b,rec)&&!(+b.wallHeightM>0)){
const km=kitMetrics(kitBox(b,rec),rec,b);
floors=km.floors;wallTotal=km.wallH*km.floors;rise=km.rise;kitSized=true;
}
const storyH=wallTotal/floors;
const slate=rec.roof==="slate"?1:rec.roof==="clay"?0:(seed.slate?1:0);
const wall=rec.wall==="stone"?"stone":rec.wall==="timber"?"planks":rec.wall==="plaster"?"plaster":(seed.timber?"planks":"plaster");
const roof=b.roof||{};
const blocks=[];
for(let ty=0;ty<h;ty++)for(let tx=0;tx<w;tx++){
const v=g[ty*w+tx];
if(v<FLOOR)continue;
const c=cellCenter(originX,originZ,m,tx,ty);
const top=found.floorY+wallTotal+(v===TOWER?storyH:0);
blocks.push({x:c.x,z:c.z,w:m,d:m,h:top,tbBldg:1});
}
const pcx=originX+plotW*m/2, pcz=originZ+plotD*m/2;
const sw=(maxTX-minTX+1)*m, sd=(maxTY-minTY+1)*m;
const scx=originX+(minTX+maxTX+1)/2*m, scz=originZ+(minTY+maxTY+1)/2*m;
const anchor=anchorOf(b,origin,m);
const row={
id:b.id,type:b.type||"",label:b.label||"",name:prettyName(b,rec),
rec:rec,seed:seed,fw:plotW*m,fd:plotD*m,shape:b.shape||"mask",
anchor:anchor,cx:pcx,cz:pcz,ox:scx-pcx,oz:scz-pcz,houseW:sw,houseD:sd,
sample:sample,baseY:found.baseY,found:found.found,floorY:found.floorY,
floors:floors,storeys:floors,wallH:storyH,storyH:storyH,wallTotal:wallTotal,rise:rise,
slate:slate,wall:wall,roofStyle:roof.style||"gable",ridge:roof.ridge||"E-W",
masked:true,mask:{w:w,h:h,grid:g},originX:originX,originZ:originZ,cell:m,
plotX:plotX,plotY:plotY,
door:{
side:String(b.door||"S").toUpperCase(),nx:side.nx,nz:side.nz,
yawOut:side.yaw,yawIn:yawInOf(side.yaw),
x:dx,z:dz,outX:outX,outZ:outZ,outY:isFinite(outGY)?outGY:found.floorY,
cells:doorCells
},
parts:[],blocks:blocks,kitSized:kitSized,family:rec.family||""
};
row.yard=yardPlan(b.id||b.type||"b",rec);
return row;
}
function layoutOne(b,origin,meters,groundY){
const rec=recipeFor(b.type||b.sprite||"");
const seed=seedOf(b.id||b.type||"b");
const mask=maskOf(b);
if(mask&&rec.recipe!=="marker"){
const row=layoutMask(b,mask,origin,meters,groundY,rec,seed);
if(row)return row;
}
const kit=wantsKit(b,rec)?kitBox(b,rec):null;
const fw=kit?kit.w:Math.max(2,+b.footW||10),fd=kit?kit.d:Math.max(2,+b.footD||8);
const shape=kit?"rect":(b.shape||"rect");
const anchor=anchorOf(b,origin,meters);
const cx=anchor.x,cz=anchor.z-fd/2;
const goal=targetOf(rec,b.type||b.sprite||"");
const shell=kit?{w:fw,d:fd,ox:0,oz:0}:fitShell(shape,fw,fd,goal.w,goal.d);
const hx=cx+shell.ox,hz=cz+shell.oz;
const sample=sampleLot(groundY,hx,hz,shell.w,shell.d,"rect");
const found=foundation(sample);
const floors=kit?kitMetrics(kit,rec,b).floors:(rec.floors===2?2:1);
const sz=kit?kitMetrics(kit,rec,b):sizes(rec,floors);
const slate=rec.roof==="slate"?1:rec.roof==="clay"?0:(seed.slate?1:0);
const wall=rec.wall==="stone"?"stone":rec.wall==="timber"?"planks":rec.wall==="plaster"?"plaster":(seed.timber?"planks":"plaster");
const parts=[{w:shell.w,d:shell.d,ox:shell.ox,oz:shell.oz,door:1,hall:1,cw:shell.w,cd:shell.d,cox:shell.ox,coz:shell.oz}];
const blocks=parts.map(function(p){
const tower=!!(rec.tower&&p.hall);
const top=found.baseY+found.found+sz.wallH+sz.rise+(tower?1.35:0.55);
return {x:cx+p.cox,z:cz+p.coz,w:p.cw,d:p.cd,h:top,tbBldg:1};
});
const row={
id:b.id,type:b.type||"",rec:rec,seed:seed,fw:fw,fd:fd,shape:shape,
anchor:anchor,cx:cx,cz:cz,ox:shell.ox,oz:shell.oz,houseW:shell.w,houseD:shell.d,
sample:sample,baseY:found.baseY,found:found.found,floorY:found.floorY,
floors:floors,wallH:sz.wallH,rise:sz.rise,slate:slate,wall:wall,parts:parts,blocks:blocks,
kitSized:!!kit,family:rec.family||""
};
row.yard=kit?{dirt:0,fence:0,garden:0,crate:0}:yardPlan(b.id||b.type||"b",rec);
row.name=prettyName(b,rec);
row.masked=false;
row.storyH=row.wallH;
row.wallTotal=row.wallH*(row.floors||1);
row.floors=row.floors||1;
if(rec.recipe==="marker"){
const side=SIDE[String((b&&b.door)||"S").toUpperCase()]||SIDE.S;
row.door={side:String((b&&b.door)||"S").toUpperCase(),nx:side.nx,nz:side.nz,yawOut:side.yaw,yawIn:yawInOf(side.yaw),x:cx,z:cz,outX:cx+side.nx,outZ:cz+side.nz,outY:row.floorY,cells:[]};
return row;
}
attachRecipeDoor(row,groundY);
if(kit){row.storyH=sz.wallH;row.wallH=sz.wallH;row.rise=sz.rise;row.wallTotal=sz.wallH*(floors||1);row.floors=floors;}
return row;
}
/* A fitted shell has no mask. Synthesise a rectangular plan so it can still be entered. */
function attachRecipeDoor(row,groundY){
const w=Math.max(4,Math.round(row.houseW)),h=Math.max(4,Math.round(row.houseD));
const grid=new Uint8Array(w*h);
const doorX0=Math.max(1,Math.floor(w/2)-1),doorX1=Math.min(w-2,doorX0+1);
const cells=[];
for(let ty=0;ty<h;ty++)for(let tx=0;tx<w;tx++){
const edge=tx===0||ty===0||tx===w-1||ty===h-1;
const door=ty===h-1&&tx>=doorX0&&tx<=doorX1;
grid[ty*w+tx]=edge?(door?DOOR:WALL):FLOOR;
if(door)cells.push({tx:tx,ty:ty});
}
const west=row.cx+row.ox-row.houseW/2, north=row.cz+row.oz-row.houseD/2;
row.mask={w:w,h:h,grid:grid};
row.originX=west;row.originZ=north;row.cell=1;
row.storyH=2.8;row.wallTotal=row.floors*2.8;
row.roofStyle="gable";row.ridge=row.houseW>=row.houseD?"E-W":"N-S";
const hx=row.cx+row.ox, face=row.cz+row.oz+row.houseD/2;
const gy=groundY||function(){return 0;};
row.door={
side:"S",nx:0,nz:1,yawOut:0,yawIn:Math.PI,
x:hx,z:face,outX:hx,outZ:face+0.85,outY:gy(hx,face+0.85)||row.floorY,
cells:cells.map(function(c){return {tx:c.tx,ty:c.ty,x:west+(c.tx+0.5),z:north+(c.ty+0.5)};})
};
}
function layout(buildings,origin,meters,groundY){
if(!buildings||!buildings.length)return [];
const gy=groundY||function(){return 0;};
const out=[];
for(let i=0;i<buildings.length;i++){
const b=buildings[i];
if(!b||!isFinite(+b.x)||!isFinite(+b.y))continue;
out.push(layoutOne(b,origin||{x:0,y:0},meters||1,gy));
}
return out;
}
function clearBlocks(blocks){
if(!blocks)return;
for(let i=blocks.length-1;i>=0;i--)if(blocks[i]&&blocks[i].tbBldg)blocks.splice(i,1);
}
function matOf(name){
const M=window.TBTiles&&TBTiles.MAT;
if(!M)return null;
if(name==="stone")return M.stone;
if(name==="planks")return M.planks;
return M.plaster;
}
function signMat(kind){
const M=TBTiles.MAT;
if(kind==="market")return M.signMarket;
if(kind==="inn")return M.signInn;
return null;
}
function dress(g,row,part){
const M=TBTiles.MAT;
if(!M||!TBTiles.addBox)return;
const fw=part.w,fd=part.d,found=row.found,wallH=row.wallH,rise=row.rise;
if(row.rec.awning&&part.door){
const yAw=found+Math.min(wallH-0.15,2.55);
const aw=row.seed.blue&&row.rec.recipe==="shop"?M.awningB:M.awning;
const awW=Math.min(fw*0.62,7.2);
TBTiles.addBox(g,awW,0.08,1.35,0,yAw,fd/2+0.55,aw);
[-1,1].forEach(function(s){
TBTiles.addBox(g,0.12,yAw,0.12,s*(awW*0.42),yAw/2,fd/2+1.1,M.timber);
});
}
if(row.rec.tower&&part.hall){
const tw=Math.min(3.3,Math.max(2.1,fw*0.2));
const th=wallH+rise*0.92;
TBTiles.addBox(g,tw,th,tw,-fw*0.18,found+th/2,-fd*0.16,M.stone);
TBTiles.addBox(g,tw+0.4,0.26,tw+0.4,-fw*0.18,found+th+0.08,-fd*0.16,M.slate);
TBTiles.addBox(g,0.16,0.85,0.16,-fw*0.18,found+th+0.55,-fd*0.16,M.timber);
}
}
function dressYard(holder,groundY,row,blocks){
const M=TBTiles.MAT;
if(!M||!TBTiles.addBox)return;
const props=yardProps(row);
const posts={};
props.forEach(function(p){
const y=groundY(p.x,p.z);
if(p.kind==="post"){
TBTiles.addBox(holder,0.12,0.9,0.12,p.x,y+0.45,p.z,M.timber);
posts[p.side]=posts[p.side]||[];
posts[p.side].push(p);
}else if(p.kind==="crate"){
TBTiles.addBox(holder,0.62,0.5,0.62,p.x,y+0.25,p.z,M.crate);
}else if(p.kind==="garden"){
TBTiles.addBox(holder,1.15,0.32,0.7,p.x,y+0.16,p.z,M.planks);
TBTiles.addBox(holder,0.34,0.36,0.34,p.x-0.28,y+0.46,p.z,M.tuft);
TBTiles.addBox(holder,0.3,0.32,0.3,p.x+0.26,y+0.42,p.z+0.08,row.seed&&row.seed.blue?M.flowerW:M.flowerR);
}
});
Object.keys(posts).forEach(function(side){
const list=posts[side].slice().sort(function(a,b){return a.t-b.t;});
for(let i=1;i<list.length;i++){
const a=list[i-1],b=list[i];
const dist=Math.hypot(b.x-a.x,b.z-a.z);
if(dist<0.2||dist>2.15)continue;
const mx=(a.x+b.x)/2,mz=(a.z+b.z)/2;
if(!doorClear(row,mx,mz))continue;
const y=groundY(mx,mz);
const len=dist,thick=0.08,alongX=Math.abs(b.x-a.x)>=Math.abs(b.z-a.z);
TBTiles.addBox(holder,alongX?len:thick,0.1,alongX?thick:len,mx,y+0.62,mz,M.timber);
if(blocks)blocks.push({x:mx,z:mz,w:alongX?len:0.28,d:alongX?0.28:len,h:y+0.86,tbBldg:1});
}
});
}
function buildShell(holder,row){
const M=TBTiles.MAT;
if(!M||!TBTiles.addBox||typeof THREE==="undefined"||!row.mask)return null;
const g=new THREE.Group();
g.name=String(row.id||row.type||"building");
g.userData.tbBuilding=row.type||row.rec.recipe||1;
g.position.set(row.originX,0,row.originZ);
holder.add(g);
const cell=row.cell||1,w=row.mask.w,h=row.mask.h,grid=row.mask.grid;
const floorY=row.floorY,baseY=row.baseY,foundH=Math.max(0.12,row.found);
const wallTop=floorY+row.wallTotal,storyH=row.storyH||row.wallTotal;
function at(tx,ty){if(tx<0||ty<0||tx>=w||ty>=h)return VOID;return grid[ty*w+tx];}
function solid(v){return v===WALL||v===TOWER;}
function struct(v){return v>=FLOOR;}
function box(ww,hh,dd,x,y,z,mat){if(hh<=0.02||ww<=0.02||dd<=0.02)return null;return TBTiles.addBox(g,ww,hh,dd,x,y,z,mat);}
const wallMat=matOf(row.wall)||M.plaster;
const roofMat=row.slate?M.slate:M.clay;
for(let ty=0;ty<h;ty++){
let tx=0;
while(tx<w){
if(!struct(at(tx,ty))){tx++;continue;}
let x1=tx;while(x1+1<w&&struct(at(x1+1,ty)))x1++;
const len=(x1-tx+1)*cell,cx=(tx+x1+1)/2*cell,cz=(ty+0.5)*cell;
box(len,foundH,cell*0.98,cx,baseY+foundH/2,cz,M.stone);
tx=x1+1;
}
}
const claimed={};
function key(tx,ty){return tx+","+ty;}
for(let ty=0;ty<h;ty++){
let tx=0;
while(tx<w){
const v=at(tx,ty);
const same=function(q){return solid(q)&&(q===TOWER)===(v===TOWER);};
if(!solid(v)||claimed[key(tx,ty)]||(!same(at(tx+1,ty))&&!same(at(tx-1,ty)))){tx++;continue;}
let x1=tx;while(same(at(x1+1,ty)))x1++;
for(let i=tx;i<=x1;i++)claimed[key(i,ty)]=1;
const top=floorY+row.wallTotal+(v===TOWER?storyH:0),hh=top-floorY;
const len=(x1-tx+1)*cell,cx=(tx+x1+1)/2*cell,cz=(ty+0.5)*cell;
box(len,hh,cell,cx,floorY+hh/2,cz,wallMat);
box(len+0.04,0.16,cell+0.08,cx,top-0.06,cz,M.timber);
if(len>cell*1.4){
box(0.16,hh,0.16,tx*cell+0.1,floorY+hh/2,cz,M.timber);
box(0.16,hh,0.16,(x1+1)*cell-0.1,floorY+hh/2,cz,M.timber);
}
tx=x1+1;
}
}
for(let tx=0;tx<w;tx++){
let ty=0;
while(ty<h){
const v=at(tx,ty);
if(!solid(v)||claimed[key(tx,ty)]){ty++;continue;}
const same=function(q){return solid(q)&&(q===TOWER)===(v===TOWER);};
let y1=ty;
while(y1+1<h&&same(at(tx,y1+1))&&!claimed[key(tx,y1+1)])y1++;
for(let i=ty;i<=y1;i++)claimed[key(tx,i)]=1;
let z0=ty,z1=y1;
if(solid(at(tx,ty-1)))z0-=0.16;
if(solid(at(tx,y1+1)))z1+=0.16;
const top=floorY+row.wallTotal+(v===TOWER?storyH:0),hh=top-floorY;
const len=(z1-z0+1)*cell,cz=(z0+(z1-z0+1)/2)*cell;
box(cell,hh,len,(tx+0.5)*cell,floorY+hh/2,cz,wallMat);
box(cell+0.08,0.16,len+0.04,(tx+0.5)*cell,top-0.06,cz,M.timber);
ty=y1+1;
}
}
for(let ty=0;ty<h;ty++)for(let tx=0;tx<w;tx++){
if(!solid(at(tx,ty))||claimed[key(tx,ty)])continue;
const v=at(tx,ty),top=floorY+row.wallTotal+(v===TOWER?storyH:0),hh=top-floorY;
box(cell,hh,cell,(tx+0.5)*cell,floorY+hh/2,(ty+0.5)*cell,wallMat);
}
function outward(tx,ty){
const ds=[[1,0],[-1,0],[0,1],[0,-1]];
for(let i=0;i<ds.length;i++){
const v=at(tx+ds[i][0],ty+ds[i][1]);
if(v===VOID||v===YARD)return ds[i];
}
return [row.door.nx,row.door.nz];
}
for(let ty=0;ty<h;ty++)for(let tx=0;tx<w;tx++){
const v=at(tx,ty);
if(v!==WIN&&v!==DOOR)continue;
const o=outward(tx,ty),cx=(tx+0.5)*cell,cz=(ty+0.5)*cell,alongX=o[0]!==0;
if(v===DOOR){
const head=floorY+Math.min(2.05,row.storyH*0.78);
if(wallTop>head+0.05){
box(cell+0.02,wallTop-head,cell+0.02,cx,(head+wallTop)/2,cz,wallMat);
box(cell+0.06,0.14,cell+0.06,cx,wallTop-0.05,cz,M.timber);
}
const leafH=Math.max(1.2,head-floorY-0.06);
const lx=cx+o[0]*(cell*0.5-0.05),lz=cz+o[1]*(cell*0.5-0.05);
box(alongX?0.07:cell*0.62,leafH,alongX?cell*0.62:0.07,lx,floorY+leafH/2,lz,M.dark);
box(alongX?0.1:0.08,leafH+0.06,alongX?0.08:0.1,lx+(alongX?0:cell*0.36),floorY+leafH/2,lz+(alongX?cell*0.36:0),M.timber);
box(alongX?0.1:0.08,leafH+0.06,alongX?0.08:0.1,lx-(alongX?0:cell*0.36),floorY+leafH/2,lz-(alongX?cell*0.36:0),M.timber);
box(alongX?0.1:cell*0.78,0.1,alongX?cell*0.78:0.1,lx,head-0.02,lz,M.timber);
}else{
let yCursor=floorY;
for(let s=0;s<row.floors;s++){
const base=floorY+s*storyH;
const sill=base+Math.min(0.92,storyH*0.32);
const head=base+Math.min(1.82,storyH*0.7);
if(sill>yCursor+0.02)box(cell,sill-yCursor,cell,cx,(yCursor+sill)/2,cz,wallMat);
const gh=Math.max(0.28,head-sill);
const gx=cx+o[0]*(cell*0.5+0.03),gz=cz+o[1]*(cell*0.5+0.03);
box(alongX?0.05:cell*0.52,gh,alongX?cell*0.52:0.05,gx,sill+gh/2,gz,M.glass);
box(alongX?0.08:cell*0.64,0.08,alongX?cell*0.64:0.08,gx+o[0]*0.02,head,gz+o[1]*0.02,M.timber);
box(alongX?0.08:cell*0.64,0.08,alongX?cell*0.64:0.08,gx+o[0]*0.02,sill,gz+o[1]*0.02,M.timber);
yCursor=head;
}
if(wallTop>yCursor+0.02)box(cell,wallTop-yCursor,cell,cx,(yCursor+wallTop)/2,cz,wallMat);
}
}
addRoof(g,row,roofMat,wallMat);
addShellDress(g,row,M);
return g;
}
function addRoof(g,row,roofMat,wallMat){
const cell=row.cell||1,w=row.mask.w,h=row.mask.h,grid=row.mask.grid;
const base=row.floorY+row.wallTotal,rise=row.rise||1.4,storyH=row.storyH||2.8;
let minX=w,minY=h,maxX=0,maxY=0;
function isRoof(tx,ty){
if(tx<0||ty<0||tx>=w||ty>=h)return false;
const v=grid[ty*w+tx];
return v>=FLOOR&&v!==TOWER;
}
for(let ty=0;ty<h;ty++)for(let tx=0;tx<w;tx++){
if(!isRoof(tx,ty))continue;
if(tx<minX)minX=tx;if(ty<minY)minY=ty;if(tx+1>maxX)maxX=tx+1;if(ty+1>maxY)maxY=ty+1;
}
if(maxX<=minX)return;
const cx=(minX+maxX)/2,cy=(minY+maxY)/2;
const spanX=(maxX-minX)/2||0.5,spanZ=(maxY-minY)/2||0.5;
const style=row.roofStyle||"gable",ridge=row.ridge||"E-W";
function factor(tx,ty){
const distX=spanX-Math.abs(tx-cx),distZ=spanZ-Math.abs(ty-cy);
const gNS=Math.max(0,Math.min(1,distX/spanX)),gEW=Math.max(0,Math.min(1,distZ/spanZ));
if(style==="shed"){
if(ridge==="N-S")return Math.max(0,Math.min(1,(maxX-tx)/(maxX-minX||1)));
return Math.max(0,Math.min(1,(maxY-ty)/(maxY-minY||1)));
}
if(style==="hip"){
if(ridge==="N-S")return Math.max(0,Math.min(1,Math.min(gNS,distZ/Math.max(0.4,spanX))));
return Math.max(0,Math.min(1,Math.min(gEW,distX/Math.max(0.4,spanZ))));
}
if(style==="cross-gable")return Math.max(gNS,gEW);
return ridge==="N-S"?gNS:gEW;
}
function heightAt(tx,ty){return base+0.05+rise*factor(tx,ty);}
const roofP=[],roofU=[],wallP=[],wallU=[],k=10/32;
function push(buf,uv,x,y,z){buf.push(x,y,z);uv.push(x*k,(y+z)*k);}
function tri(buf,uv,a,b,c){[a,b,c].forEach(function(p){push(buf,uv,p[0],p[1],p[2]);});}
const oh=0.34;
for(let ty=0;ty<h;ty++)for(let tx=0;tx<w;tx++){
if(!isRoof(tx,ty))continue;
function corner(px,pz){
let x=px,z=pz;
if(px===tx&&!isRoof(tx-1,ty))x-=oh/cell;
if(px!==tx&&!isRoof(tx+1,ty))x+=oh/cell;
if(pz===ty&&!isRoof(tx,ty-1))z-=oh/cell;
if(pz!==ty&&!isRoof(tx,ty+1))z+=oh/cell;
return [x*cell,heightAt(x,z),z*cell];
}
const p00=corner(tx,ty),p10=corner(tx+1,ty),p11=corner(tx+1,ty+1),p01=corner(tx,ty+1);
tri(roofP,roofU,p00,p10,p11);tri(roofP,roofU,p00,p11,p01);
const t=0.1;
function drop(p){return [p[0],p[1]-t,p[2]];}
tri(roofP,roofU,drop(p00),drop(p11),drop(p10));
tri(roofP,roofU,drop(p00),drop(p01),drop(p11));
function fill(a,b){
if(a[1]<base+0.12&&b[1]<base+0.12)return;
const a0=[a[0],base,a[2]],b0=[b[0],base,b[2]];
tri(wallP,wallU,a0,b0,b);tri(wallP,wallU,a0,b,a);
}
if(!isRoof(tx,ty-1))fill(p00,p10);
if(!isRoof(tx,ty+1))fill(p01,p11);
if(!isRoof(tx-1,ty))fill(p00,p01);
if(!isRoof(tx+1,ty))fill(p10,p11);
}
for(let ty=0;ty<h;ty++)for(let tx=0;tx<w;tx++){
if(grid[ty*w+tx]!==TOWER)continue;
const y0=base+storyH+0.02;
const x0=tx*cell-0.16,x1=(tx+1)*cell+0.16,z0=ty*cell-0.16,z1=(ty+1)*cell+0.16;
const ym=y0+Math.max(0.8,rise*0.75),mx=(x0+x1)/2,mz=(z0+z1)/2;
tri(roofP,roofU,[x0,y0,z0],[x1,y0,z0],[mx,ym,mz]);
tri(roofP,roofU,[x1,y0,z0],[x1,y0,z1],[mx,ym,mz]);
tri(roofP,roofU,[x1,y0,z1],[x0,y0,z1],[mx,ym,mz]);
tri(roofP,roofU,[x0,y0,z1],[x0,y0,z0],[mx,ym,mz]);
}
function mesh(pos,uv,mat){
if(!pos.length)return;
const geo=new THREE.BufferGeometry();
geo.setAttribute("position",new THREE.Float32BufferAttribute(pos,3));
geo.setAttribute("uv",new THREE.Float32BufferAttribute(uv,2));
geo.computeVertexNormals();
const m=new THREE.Mesh(geo,mat);
m.castShadow=m.receiveShadow=true;g.add(m);
}
mesh(roofP,roofU,roofMat);
mesh(wallP,wallU,wallMat);
}
function addShellDress(g,row,M){
const cell=row.cell||1,d=row.door;
if(!d||!d.cells||!d.cells.length)return;
let minU=Infinity,maxU=-Infinity;
const useZ=Math.abs(d.nx)>0.5;
d.cells.forEach(function(c){
const u=useZ?(c.z-row.originZ):(c.x-row.originX);
if(u<minU)minU=u;if(u>maxU)maxU=u;
});
const span=Math.max(cell*0.9,(maxU-minU)+cell*0.55);
const midX=d.x-row.originX,midZ=d.z-row.originZ;
if(row.rec.awning){
const y=row.floorY+Math.min((row.storyH||2.6)-0.25,2.4);
const aw=row.seed&&row.seed.blue&&row.rec.recipe==="shop"?M.awningB:M.awning;
const depth=1.15,ox=d.nx*(cell*0.45+depth/2),oz=d.nz*(cell*0.45+depth/2);
TBTiles.addBox(g,Math.abs(d.nx)>0.5?depth:span,0.07,Math.abs(d.nz)>0.5?depth:span,midX+ox,y,midZ+oz,aw);
}
if(row.rec.sign){
const mat=signMat(row.rec.sign);
if(mat){
const y=row.floorY+Math.min((row.storyH||2.6)-0.05,2.75);
const ox=d.nx*(cell*0.5+0.16),oz=d.nz*(cell*0.5+0.16);
TBTiles.addBox(g,Math.abs(d.nx)>0.5?0.06:Math.min(1.5,span),0.4,Math.abs(d.nz)>0.5?0.06:Math.min(1.5,span),midX+ox,y,midZ+oz,mat);
}
}
if(row.rec.chimney!==0&&row.rec.recipe!=="church"){
const tx=Math.max(0,Math.floor(row.mask.w/2)),ty=Math.max(0,Math.floor(row.mask.h/2));
TBTiles.addBox(g,0.4,0.95,0.4,(tx+0.55)*cell,row.floorY+row.wallTotal+row.rise*0.35,(ty+0.35)*cell,M.stone);
}
}
function place(parent,groundY,buildings,origin,meters,blocks){
const rows=layout(buildings,origin,meters,groundY);
window.TBBuildings.rows=rows;
clearBlocks(blocks);
if(!parent||!window.TBTiles||!TBTiles.house)return rows;
const holder=new THREE.Group();
holder.name="tb-buildings";
parent.add(holder);
rows.forEach(function(row){
if(row.rec&&row.rec.recipe==="marker"){
if(window.TBProps&&TBProps.stamp)TBProps.stamp(holder,row.rec.kit||row.type,row.cx,row.cz,(row.door&&row.door.yawOut)||0,groundY);
row.blocks.forEach(function(b){if(blocks)blocks.push(b);});
return;
}
if(row.masked){
buildShell(holder,row);
if(row.rec.stall&&TBTiles.stall&&row.door){
const d=row.door,side=row.seed&&row.seed.blue?1:-1;
const sx=d.outX-d.nz*side*1.9,sz=d.outZ+d.nx*side*1.9;
if(doorClear(row,sx,sz))TBTiles.stall(holder,groundY,sx,sz,d.yawOut,!!(row.seed&&row.seed.blue));
}
dressYard(holder,groundY,row,blocks);
row.blocks.forEach(function(b){if(blocks)blocks.push(b);});
return;
}
row.parts.forEach(function(part){
const door=part.door?1:0;
let wallMat=matOf(row.wall);
if(row.kitSized&&window.TBProps&&TBProps.familyMaterial){
const fam=TBProps.familyMaterial(row.family||row.rec.family||"res");
if(fam)wallMat=fam;
}
const g=TBTiles.house(holder,groundY,{
x:row.cx+part.ox,z:row.cz+part.oz,w:part.w,d:part.d,yaw:0,
floors:row.floors,baseY:row.baseY,found:row.found,wallH:row.wallH,rise:row.rise,
slate:row.slate,wallMat:wallMat,
door:door,chimney:row.rec.chimney===0?0:(row.parts.length>1?door:1),
flowers:row.rec.flowers===0?0:1,
sign:door?signMat(row.rec.sign):null
});
if(g){
g.name=String(row.id||row.type||"building");
g.userData.tbBuilding=row.type||row.rec.recipe||1;
dress(g,row,part);
}
});
if(row.rec.stall&&TBTiles.stall){
const side=row.seed.blue?1:-1;
const hx=row.cx+row.ox,face=row.cz+row.oz+row.houseD/2;
let sx=hx+side*(row.houseW/2+1.2),sz=face-0.35;
const plotL=row.cx-row.fw/2+1,plotR=row.cx+row.fw/2-1;
sx=Math.max(plotL,Math.min(plotR,sx));
if(doorClear(row,sx,sz))TBTiles.stall(holder,groundY,sx,sz,0,!!row.seed.blue);
}
dressYard(holder,groundY,row,blocks);
row.blocks.forEach(function(b){if(blocks)blocks.push(b);});
});
if(rows.length)console.info("tb buildings",rows.length);
return rows;
}
window.TBBuildings={
MAP:BUILDING_MAP,recipeFor:recipeFor,hashId:hashId,seedOf:seedOf,
inShape:inShape,partsFor:partsFor,anchorOf:anchorOf,sampleLot:sampleLot,foundation:foundation,
fitShell:fitShell,targetOf:targetOf,doorClear:doorClear,yardProps:yardProps,
layout:layout,place:place,decodeB64:decodeB64,maskOf:maskOf,prettyName:prettyName,kitBox:kitBox,wantsKit:wantsKit,
SIDE:SIDE,rows:[]
};
})();
