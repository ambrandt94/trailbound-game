/* Ported from trailbound-controller (deployed main). ESM, behaviour-faithful.
   Not typechecked: a full TS conversion of these files would stall the port.
   three r187: colorSpace, colorspace_fragment, per-fragment Lambert cel, asset root.
*/
import { THREE } from './three-runtime.js';
/* Interiors for AreaExport buildings.
   One room exists at a time, parked at x>=5000 so it never shares a camera
   layer with the trail or the town. The test cabin in main.js stays on its
   own x-range and is not touched. Enter/leave are ordinary portal interactables. */
(function(){
const IX=5000,IZ=0;
/* Interiors are their own instance, so a mask tile is wider than the 1 m
   outdoor tile. Wall height and prop size stay human; only the footprint grows. */
const INTERIOR_TILE_M=1.6;
const FLOOR=2,WALL=3,DOOR=4,WIN=5,TOWER=6;
const INV={N:{x:0,y:1},S:{x:0,y:-1},E:{x:-1,y:0},W:{x:1,y:0}};
let ctx=null,active=null;

function bind(c){ctx=c;}
function gridAt(grid,w,h,x,y){
if(x<0||y<0||x>=w||y>=h)return 0;
return grid[y*w+x];
}
function kindOf(row){
const t=String(row.type||""),r=row.rec&&row.rec.recipe||"";
if(/inn|tavern/.test(t)||r==="inn")return "inn";
if(/shop|market/.test(t)||r==="shop")return "shop";
if(/church|temple/.test(t)||r==="church")return "church";
if(/blacksmith|smith/.test(t)||r==="smith")return "smith";
if(/house|cottage|farm/.test(t)||r==="house"||r==="farm")return "house";
return "generic";
}
function rng(seed){
let s=seed>>>0||1;
return function(){s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296;};
}
function runsOf(set,minLen){
const runs=[];
Object.keys(set).forEach(function(k){
const p=k.split(","),x=+p[0],y=+p[1];
if(!set[(x-1)+","+y]){
const cells=[];
for(let i=x;set[i+","+y];i++)cells.push({x:i,y:y});
if(cells.length>=minLen)runs.push({axis:"x",cells:cells});
}
if(!set[x+","+(y-1)]){
const cells=[];
for(let i=y;set[x+","+i];i++)cells.push({x:x,y:i});
if(cells.length>=minLen)runs.push({axis:"z",cells:cells});
}
});
return runs;
}
function doorDist(c,doors){
let best=1e9;
for(let i=0;i<doors.length;i++){
const d=Math.abs(c.x-doors[i].tx)+Math.abs(c.y-doors[i].ty);
if(d<best)best=d;
}
return best;
}
function bfs(set,from,to){
const prev={},q=[from];
prev[from.x+","+from.y]="s";
for(let qi=0;qi<q.length;qi++){
const c=q[qi];
if(c.x===to.x&&c.y===to.y)break;
[[1,0],[-1,0],[0,1],[0,-1]].forEach(function(d){
const nx=c.x+d[0],ny=c.y+d[1],k=nx+","+ny;
if(!set[k]||prev[k])return;
prev[k]=c.x+","+c.y;q.push({x:nx,y:ny});
});
}
const out=[];
let k=to.x+","+to.y;
if(!prev[k])return out;
while(k&&k!=="s"){
const p=k.split(",");
out.push({x:+p[0],y:+p[1]});
k=prev[k];
}
return out;
}
function layoutFurn2(kind,rand,floorSet,reserved,stepKey,grid,w,h,upper,landing){
const furn=[];
const used={};
function wallish(x,y){const v=gridAt(grid,w,h,x,y);return v===WALL||v===WIN||v===TOWER;}
function isWall(c){return wallish(c.x+1,c.y)||wallish(c.x-1,c.y)||wallish(c.x,c.y+1)||wallish(c.x,c.y-1);}
function avail(floor){
const out=[];
Object.keys(floorSet).forEach(function(k){
if(used[floor+"|"+k])return;
if(stepKey[k])return;
const p=k.split(","),c={x:+p[0],y:+p[1],k:k};
if(floor===0&&reserved[k])return;
if(floor>0&&landing&&c.x===landing.x&&c.y===landing.y)return;
out.push(c);
});
return out;
}
function take(floor,pred){
const list=avail(floor).filter(pred||function(){return true;});
if(!list.length)return null;
const i=Math.floor(rand()*list.length)%list.length;
const c=list[i];
used[floor+"|"+c.k]=1;
return c;
}
function takePair(floor){
const list=avail(floor);
for(let n=0;n<list.length;n++){
const c=list[Math.floor(rand()*list.length)%list.length];
const nbrs=[{x:c.x+1,y:c.y,ax:"x"},{x:c.x,y:c.y+1,ax:"z"}];
for(let i=0;i<nbrs.length;i++){
const nb=nbrs[i],k=nb.x+","+nb.y;
if(!floorSet[k]||used[floor+"|"+k]||stepKey[k])continue;
if(floor===0&&reserved[k])continue;
used[floor+"|"+c.k]=1;used[floor+"|"+k]=1;
return {x:Math.min(c.x,nb.x),y:Math.min(c.y,nb.y),tw:nb.ax==="x"?2:1,td:nb.ax==="z"?2:1,floor:floor};
}
}
const c=take(floor);
if(!c)return null;
return {x:c.x,y:c.y,tw:1,td:1,floor:floor};
}
function add(kindName,floor,span){
const spot=span?takePair(floor):null;
const c=!span?take(floor,function(q){return isWall(q);} )||take(floor):null;
if(span&&spot){furn.push({kind:kindName,tx:spot.x,ty:spot.y,tw:spot.tw,td:spot.td,floor:floor});return;}
if(!span&&c)furn.push({kind:kindName,tx:c.x,ty:c.y,tw:1,td:1,floor:floor});
}
function takeBar(){
const list=avail(0),set={};
list.forEach(function(c){set[c.k]=c;});
const runs=[];
list.forEach(function(c){
if(!set[(c.x-1)+","+c.y]){
const run=[c];
for(let x=c.x;set[(x+1)+","+c.y];x++)run.push(set[(x+1)+","+c.y]);
[[0,-1],[0,1]].forEach(function(p){
if(run.length>=2&&run.every(function(q){return wallish(q.x+p[0],q.y+p[1]);}))runs.push({cells:run,wx:p[0],wz:p[1],tw:1,td:0});
});
}
if(!set[c.x+","+(c.y-1)]){
const run=[c];
for(let y=c.y;set[c.x+","+(y+1)];y++)run.push(set[c.x+","+(y+1)]);
[[-1,0],[1,0]].forEach(function(p){
if(run.length>=2&&run.every(function(q){return wallish(q.x+p[0],q.y+p[1]);}))runs.push({cells:run,wx:p[0],wz:p[1],tw:0,td:1});
});
}
});
runs.sort(function(a,b){return b.cells.length-a.cells.length;});
const run=runs.length?runs[Math.floor(rand()*Math.min(3,runs.length))%runs.length]:null;
if(!run){add("bar",0,true);return;}
const n=Math.min(3,run.cells.length);
const cells=run.cells.slice(0,n);
cells.forEach(function(c){used["0|"+c.k]=1;});
const x0=Math.min.apply(null,cells.map(function(c){return c.x;}));
const y0=Math.min.apply(null,cells.map(function(c){return c.y;}));
furn.push({kind:"bar",tx:x0,ty:y0,tw:run.tw?n:1,td:run.td?n:1,floor:0,wx:run.wx,wz:run.wz});
}
function addInnTables(){
let guard=0;
while(guard++<8){
const list=avail(0);
if(!list.length)return;
const scored=list.map(function(c){
let walls=0;
[[1,0],[-1,0],[0,1],[0,-1]].forEach(function(d){if(wallish(c.x+d[0],c.y+d[1]))walls++;});
return {c:c,walls:walls};
});
scored.sort(function(a,b){return a.walls-b.walls||a.c.y-b.c.y||a.c.x-b.c.x;});
const open=scored.filter(function(s){return s.walls===scored[0].walls;});
const c=open[Math.floor(rand()*open.length)%open.length].c;
used["0|"+c.k]=1;
[[1,0],[-1,0],[0,1],[0,-1]].forEach(function(d){
const k=(c.x+d[0])+","+(c.y+d[1]);
if(floorSet[k])used["0|"+k]=1;
});
furn.push({kind:"table",tx:c.x,ty:c.y,tw:1,td:1,floor:0});
}
}
if(kind==="house"){
add("hearth",0,false);add("table",0,false);add("bed",upper?1:0,true);
if(upper)add("chest",1,false);
}else if(kind==="inn"){
takeBar();
addInnTables();
add("bed",upper?1:0,true);add("bed",upper?1:0,true);add("chest",upper?1:0,false);
}else if(kind==="shop"){
add("counter",0,true);add("shelf",0,false);add("shelf",0,false);add("crate",0,false);add("crate",0,false);
}else if(kind==="church"){
add("altar",0,false);
const pews=avail(0);
for(let i=0;i<pews.length&&i<8;i++)add("pew",0,false);
}else if(kind==="smith"){
add("forge",0,false);add("anvil",0,false);add("crate",0,false);
}else{
add("table",0,false);add("chest",0,false);add("shelf",0,false);
}
return furn;
}
/* replace the stubby placeFurniture with the real one */
function placeFurnitureReal(row,floorSet,reserved,stepCells,landing,floors){
const stepKey={};
stepCells.forEach(function(c){stepKey[c.x+","+c.y]=1;});
const rand=rng(window.TBBuildings?TBBuildings.hashId(String(row.id||"b")+"|furn"):1);
return layoutFurn2(kindOf(row),rand,floorSet,reserved,stepKey,row.mask.grid,row.mask.w,row.mask.h,floors>1,landing);
}

function planFixed(row){
const mask=row.mask,grid=mask.grid,w=mask.w,h=mask.h;
const cell=INTERIOR_TILE_M,floors=Math.max(1,row.floors|0||1);
const storyH=row.storyH||2.8,wallTotal=row.wallTotal||storyH*floors;
const doors=(row.door&&row.door.cells)||[];
const inv=INV[row.door&&row.door.side]||INV.S;
const floorSet={};
const floorsL=[];
for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(grid[y*w+x]===FLOOR){floorSet[x+","+y]=1;floorsL.push({x:x,y:y});}
let entry=null;
for(let i=0;i<doors.length&&!entry;i++){
const nx=doors[i].tx+inv.x,ny=doors[i].ty+inv.y;
if(floorSet[nx+","+ny])entry={x:nx,y:ny};
}
if(!entry&&floorsL.length){
let best=floorsL[0],bd=doorDist(best,doors);
for(let i=1;i<floorsL.length;i++){const d=doorDist(floorsL[i],doors);if(d<bd){bd=d;best=floorsL[i];}}
entry=best;
}
if(!entry)entry={x:0,y:0};
const reserved={};
function hold(x,y){if(x!=null)reserved[x+","+y]=1;}
doors.forEach(function(d){hold(d.tx,d.ty);});
hold(entry.x,entry.y);
let steps=[],stepCells=[],landing=null;
if(floors>1){
let runs=runsOf(floorSet,4);
if(!runs.length)runs=runsOf(floorSet,3);
runs.sort(function(a,b){
if(b.cells.length!==a.cells.length)return b.cells.length-a.cells.length;
const da=doorDist(a.cells[0],doors)+doorDist(a.cells[a.cells.length-1],doors);
const db=doorDist(b.cells[0],doors)+doorDist(b.cells[b.cells.length-1],doors);
return db-da;
});
if(runs.length){
const run=runs[0],cells=run.cells.slice();
if(doorDist(cells[0],doors)>doorDist(cells[cells.length-1],doors))cells.reverse();
let slice=cells.length>5?cells.slice(cells.length-5):cells;
landing=slice[slice.length-1];
stepCells=slice.length>1?slice.slice(0,-1):slice.slice();
const usable=Math.max(1,stepCells.length);
let n=Math.max(4,Math.round(storyH/0.3));
while(n>3&&usable/n<0.28)n--;
const tread=usable/n,rise=storyH/n,axis=run.axis;
const along0=axis==="x"?stepCells[0].x:stepCells[0].y;
const cross=axis==="x"?stepCells[0].y+0.5:stepCells[0].x+0.5;
for(let i=0;i<n;i++){
const mid=along0+i*tread+tread/2;
const lx=axis==="x"?mid:cross,lz=axis==="z"?mid:cross;
steps.push({
x:IX+lx*cell,z:IZ+lz*cell,
w:(axis==="x"?tread:0.9)*cell,d:(axis==="z"?tread:0.9)*cell,h:(i+1)*rise
});
}
/* Stair footprint plus one cell of clearance on every side, so a table cannot sit against the run. */
function reserveAround(c){
if(!c)return;
for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)hold(c.x+dx,c.y+dy);
}
stepCells.forEach(reserveAround);
reserveAround(landing);
bfs(floorSet,entry,stepCells[0]).forEach(function(c){hold(c.x,c.y);});
}
}
const slabs=[];
const stepKey={};
stepCells.forEach(function(c){stepKey[c.x+","+c.y]=1;});
for(let level=1;level<floors;level++)floorsL.forEach(function(c){
if(stepKey[c.x+","+c.y])return;
slabs.push({x:IX+(c.x+0.5)*cell,z:IZ+(c.y+0.5)*cell,w:cell,d:cell,h:storyH*level,tx:c.x,ty:c.y,level:level});
});
const furniture=placeFurnitureReal(row,floorSet,reserved,stepCells,landing,floors);
let fx0=w,fx1=0,fz0=h,fz1=0;
floorsL.forEach(function(c){if(c.x<fx0)fx0=c.x;if(c.x+1>fx1)fx1=c.x+1;if(c.y<fz0)fz0=c.y;if(c.y+1>fz1)fz1=c.y+1;});
if(!floorsL.length){fx0=0;fx1=Math.max(1,w);fz0=0;fz1=Math.max(1,h);}
let lsx=0,lsz=0,ln=0;
doors.forEach(function(d){lsx+=d.tx+0.5;lsz+=d.ty+0.5;ln++;});
if(!ln){lsx=entry.x+0.5;lsz=entry.y+0.5;ln=1;}
return {
id:String(row.id),name:row.name||pretty(row),kind:kindOf(row),
floors:floors,storyH:storyH,wallTotal:wallTotal,cell:cell,w:w,h:h,grid:grid,
entry:{x:IX+(entry.x+0.5)*cell,z:IZ+(entry.y+0.5)*cell,yaw:row.door?row.door.yawIn:0,tx:entry.x,ty:entry.y},
leaveLocal:{x:IX+(lsx/ln)*cell,z:IZ+(lsz/ln)*cell},
steps:steps,stepCells:stepCells,landing:landing,slabs:slabs,furniture:furniture,reserved:reserved,
bounds:{minX:IX,maxX:IX+w*cell,minZ:IZ,maxZ:IZ+h*cell},
floorBounds:{minX:IX+fx0*cell,maxX:IX+fx1*cell,minZ:IZ+fz0*cell,maxZ:IZ+fz1*cell}
};
}
function pretty(row){return window.TBBuildings?TBBuildings.prettyName(row,row.rec):"Building";}

/* 16px nearest tile, half a repeat per metre: 8 texels/m, same as the cabin floor. */
const UVK=0.5,STUB=0.78,THICK=0.16;
let roomMat=null;
const rnd=(x,y,s)=>{const v=Math.sin(x*12.9898+y*78.233+s*37.7)*43758.5453;return v-Math.floor(v)};
function canvasTex(paint){
const s=16,c=document.createElement("canvas");c.width=c.height=s;
const g=c.getContext("2d"),img=g.createImageData(s,s);
paint(function(x,y,r,gc,b){
const i=(y*s+x)*4;
img.data[i]=r;img.data[i+1]=gc;img.data[i+2]=b;img.data[i+3]=255;
},s);
g.putImageData(img,0,0);
const t=new THREE.CanvasTexture(c);
t.magFilter=t.minFilter=THREE.NearestFilter;
t.generateMipmaps=false;
t.wrapS=t.wrapT=THREE.RepeatWrapping;
t.needsUpdate=true;
return t;
}
function rgbOf(hex,x,y,sd,amt){
const b=new THREE.Color(hex);
let k=1+(rnd(x,y,sd)-.5)*amt;
if((x+y*2)%7===0)k-=.06;
return [b.r,b.g,b.b].map(function(v){return Math.round(Math.min(1,Math.max(0.1,v*k))*255);});
}
function grain(hex,sd,amt){
return canvasTex(function(put,s){
for(let y=0;y<s;y++)for(let x=0;x<s;x++){
const p=rgbOf(hex,x,y,sd,amt==null?0.28:amt);
put(x,y,p[0],p[1],p[2]);
}
});
}
function phong(map){
return new THREE.MeshPhongMaterial({map:map,color:0xffffff,flatShading:true,shininess:0,specular:0});
}
function roomMats(){
if(roomMat)return roomMat;
const boards=["#e4c48a","#d2aa68","#f0d2a0","#c49858","#e8c898"];
const floor=canvasTex(function(put,s){
for(let y=0;y<s;y++)for(let x=0;x<s;x++){
const seam=y%4===0;
const hex=seam?"#a07840":boards[Math.floor(y/4)%boards.length];
const p=rgbOf(hex,x,y,42,seam?0.1:0.22);
put(x,y,p[0],p[1],p[2]);
}
});
const tread=canvasTex(function(put,s){
for(let y=0;y<s;y++)for(let x=0;x<s;x++){
const hex=y%4===0?"#8a5c30":"#d0a868";
const p=rgbOf(hex,x,y,47,.22);
put(x,y,p[0],p[1],p[2]);
}
});
const flag=canvasTex(function(put,s){
for(let y=0;y<s;y++)for(let x=0;x<s;x++){
const mortar=x%8===0||y%8===0;
const band=Math.floor(x/8)+Math.floor(y/8);
const hex=mortar?"#7a7468":(band%2?"#c8c0b0":"#b0a898");
const p=rgbOf(hex,x,y,53,mortar?0.1:0.24);
put(x,y,p[0],p[1],p[2]);
}
});
const plaster=grain("#c4b49a",41,.26);
const wain=canvasTex(function(put,s){
const cols=["#b88858","#8a5c38","#c49868","#a07040"];
for(let y=0;y<s;y++)for(let x=0;x<s;x++){
const seam=x%4===0;
const hex=seam?"#5c3c24":cols[Math.floor(x/4)%cols.length];
const p=rgbOf(hex,x,y,44,seam?0.1:0.26);
put(x,y,p[0],p[1],p[2]);
}
});
const stone=canvasTex(function(put,s){
for(let y=0;y<s;y++)for(let x=0;x<s;x++){
const mortar=(y%8===0)||(x+Math.floor(y/8)*4)%8===0;
const hex=mortar?"#6e685c":"#b7b1a4";
const p=rgbOf(hex,x,y,59,mortar?0.1:0.22);
put(x,y,p[0],p[1],p[2]);
}
});
function chip(hex,sd){return phong(grain(hex,sd,.22));}
roomMat={
floor:phong(floor),tread:phong(tread),flag:phong(flag),
plaster:phong(plaster),wain:phong(wain),stone:phong(stone),
wood:chip("#a56b3c",11),woodDk:chip("#6b4328",12),
blanket:chip("#c4473a",13),blanketB:chip("#2f6f86",14),
pillow:chip("#d2c4b0",15),top:chip("#c4a06a",16),
stool:chip("#8d5a32",17),mug:chip("#c4b09a",18),
bottle:chip("#3d8a4a",19),metal:chip("#8a9098",20),
metalDk:chip("#5c626a",21),fire:chip("#d07028",22),
flame:chip("#e07830",23),cloth:chip("#d4c4a4",24),
gold:chip("#c4a04a",25),apple:chip("#c4473a",26),
leaf:chip("#4e9a3c",27),pot:chip("#b45430",28),
trim:chip("#6e4528",29),glass:chip("#8eb4c8",30)
};
roomMat.floor.side=THREE.DoubleSide;
roomMat.flag.side=THREE.DoubleSide;
return roomMat;
}
function meshBox(parent,w,h,d,x,y,z,mat,near){
if(!window.TBTiles||!TBTiles.facetUV||typeof THREE==="undefined")return null;
if(w<=0.02||h<=0.02||d<=0.02||!mat)return null;
const src=new THREE.BoxGeometry(w,h,d);
const geo=TBTiles.facetUV(src,UVK,false);
if(geo!==src)src.dispose();
const m=new THREE.Mesh(geo,mat);
m.position.set(x,y,z);
m.castShadow=m.receiveShadow=true;
if(near)m.userData.tbNear=near;
parent.add(m);
return m;
}
function box(parent,w,h,d,x,y,z,mat,near){return meshBox(parent,w,h,d,x,y,z,mat,near);}
function puck(parent,r,h,x,y,z,mat){
if(typeof THREE==="undefined"||h<=0.02)return null;
const m=new THREE.Mesh(new THREE.CylinderGeometry(r,r*0.92,h,8),mat);
m.position.set(x,y,z);m.castShadow=m.receiveShadow=true;parent.add(m);return m;
}
function addFloor(parent,cells,y,mat,cell){
if(typeof THREE==="undefined"||!cells.length||!mat)return;
const pos=[],uv=[];
cells.forEach(function(c){
const x0=c.tx*cell,x1=x0+cell,z0=c.ty*cell,z1=z0+cell;
function push(x,z){pos.push(x,y,z);uv.push(x*UVK,z*UVK);}
/* +Y normal. The opposite winding is the underside and the vista camera culls it. */
push(x0,z0);push(x1,z1);push(x1,z0);push(x0,z0);push(x0,z1);push(x1,z1);
});
const geo=new THREE.BufferGeometry();
geo.setAttribute("position",new THREE.Float32BufferAttribute(pos,3));
geo.setAttribute("uv",new THREE.Float32BufferAttribute(uv,2));
geo.computeVertexNormals();
const mesh=new THREE.Mesh(geo,mat);
mesh.receiveShadow=true;mesh.castShadow=false;mesh.userData.surface=1;
parent.add(mesh);
}
function buildWalls(g,row,blocks,IM){
const grid=row.mask.grid,w=row.mask.w,h=row.mask.h,cell=INTERIOR_TILE_M;
const storyH=row.storyH||2.8;
const stone=IM&&(row.rec&&(row.rec.recipe==="church"||row.rec.recipe==="smith"));
const upperMat=stone?IM.stone:IM.plaster,stubMat=stone?IM.stone:IM.wain;
function at(tx,ty){return gridAt(grid,w,h,tx,ty);}
function solid(v){return v===WALL||v===TOWER;}
function topOf(v){return (row.wallTotal||storyH)+(v===TOWER?storyH:0);}
const dirs=[[1,0],[-1,0],[0,1],[0,-1]];
for(let ty=0;ty<h;ty++)for(let tx=0;tx<w;tx++){
const v=at(tx,ty);
if(solid(v)||v===WIN){
blocks.push({x:IX+(tx+0.5)*cell,z:IZ+(ty+0.5)*cell,w:cell*0.92,d:cell*0.92,h:topOf(v),tbRoom:1});
}
if(v===DOOR){
let ox=row.door?row.door.nx:0,oz=row.door?row.door.nz:1;
dirs.forEach(function(d){const n=at(tx+d[0],ty+d[1]);if(n===0||n===1){ox=d[0];oz=d[1];}});
const alongX=Math.abs(ox)>0.5;
blocks.push({x:IX+(tx+0.5)*cell+ox*(cell*0.55),z:IZ+(ty+0.5)*cell+oz*(cell*0.55),w:alongX?0.2:Math.max(cell*0.7,0.7),d:alongX?Math.max(cell*0.7,0.7):0.2,h:2.15,tbRoom:1});
}
}
/* A wall exists only on an edge between a floor cell and something else.
   Wall-to-window and door-to-door edges are inside the shell, so they get no fin. */
const faces=[];
for(let ty=0;ty<h;ty++)for(let tx=0;tx<w;tx++){
if(at(tx,ty)!==FLOOR)continue;
dirs.forEach(function(d){
const nv=at(tx+d[0],ty+d[1]);
if(nv===FLOOR)return;
const oz=d[1],ox=d[0],alongX=oz!==0;
faces.push({
axis:alongX?"x":"z",
dir:oz||ox,
line:oz>0?ty+1:(oz<0?ty:(ox>0?tx+1:tx)),
u:alongX?tx:ty,
top:topOf(nv===TOWER?TOWER:WALL),
win:nv===WIN,door:nv===DOOR,tower:nv===TOWER
});
});
}
function merge(list){
list.sort(function(a,b){
if(a.axis!==b.axis)return a.axis<b.axis?-1:1;
if(a.line!==b.line)return a.line-b.line;
if(a.dir!==b.dir)return a.dir-b.dir;
if(a.top!==b.top)return a.top-b.top;
return a.u-b.u;
});
const runs=[];
list.forEach(function(f){
const prev=runs[runs.length-1];
if(prev&&prev.axis===f.axis&&prev.line===f.line&&prev.dir===f.dir&&prev.top===f.top&&prev.u1===f.u){
prev.u1=f.u+1;
if(f.win)prev.win[f.u]=1;
if(f.door)prev.door[f.u]=1;
}else{
const win={},door={};
if(f.win)win[f.u]=1;
if(f.door)door[f.u]=1;
runs.push({axis:f.axis,line:f.line,dir:f.dir,top:f.top,u0:f.u,u1:f.u+1,win:win,door:door});
}
});
return runs;
}
function geom(run,pad){
pad=pad||0;
const u0=run.u0*cell-pad,u1=run.u1*cell+pad,mid=(u0+u1)/2,len=Math.max(THICK,u1-u0);
const edge=run.line*cell,inset=run.dir>0?-THICK/2:THICK/2;
if(run.axis==="x")return {x:mid,z:edge+inset,ww:len,dd:THICK,len:len};
return {x:edge+inset,z:mid,ww:THICK,dd:len,len:len};
}
function spans(run,keep){
const out=[];
let a=null;
for(let u=run.u0;u<run.u1;u++){
if(keep(u)){if(a==null)a=u;}
else if(a!=null){out.push([a,u]);a=null;}
}
if(a!=null)out.push([a,run.u1]);
return out;
}
function spanBox(host,run,u0,u1,y0,y1,mat){
if(!mat||y1-y0<=0.02||u1<=u0)return;
const p=geom({axis:run.axis,line:run.line,dir:run.dir,u0:u0,u1:u1});
box(host,p.ww,y1-y0,p.dd,p.x,(y0+y1)/2,p.z,mat);
}
function fadeMat(src){
if(!src)return null;
const m=src.clone();
m.userData.tbClone=1;
m.opacity=1;
m.transparent=false;
m.depthWrite=true;
return m;
}
/* One group per straight perimeter run, doors and windows included, so corners meet
   and a cutaway cannot drop a segment out of the outline. */
merge(faces).forEach(function(run){
const ug=new THREE.Group();
const mats={upper:fadeMat(upperMat),stub:fadeMat(stubMat),trim:fadeMat(IM.trim),glass:fadeMat(IM.glass)};
const edge=run.line*cell,inset=run.dir>0?-THICK/2:THICK/2;
let x0,z0,x1,z1;
if(run.axis==="x"){x0=IX+run.u0*cell;x1=IX+run.u1*cell;z0=z1=IZ+edge+inset;}
else{z0=IZ+run.u0*cell;z1=IZ+run.u1*cell;x0=x1=IX+edge+inset;}
ug.userData.tbFade={
op:1,target:1,from:1,t:1,
mats:[mats.upper,mats.stub,mats.trim,mats.glass].filter(Boolean),
x0:x0,z0:z0,x1:x1,z1:z1,y0:0,y1:run.top,thick:THICK,
cx:(x0+x1)/2,cz:(z0+z1)/2
};
g.add(ug);
if(run.top>STUB+0.06)spanBox(ug,run,run.u0,run.u1,run.top-0.08,run.top,mats.trim);
spans(run,function(u){return !run.door[u];}).forEach(function(s){
const hh=Math.min(STUB,run.top);
spanBox(ug,run,s[0],s[1],0,hh,mats.stub);
spanBox(ug,run,s[0],s[1],hh-0.06,hh,mats.trim);
});
spans(run,function(u){return !run.door[u]&&!run.win[u];}).forEach(function(s){
spanBox(ug,run,s[0],s[1],STUB,run.top-0.08,mats.upper);
});
spans(run,function(u){return run.win[u];}).forEach(function(s){
const p=geom({axis:run.axis,line:run.line,dir:run.dir,u0:s[0],u1:s[1]});
const sill=Math.min(STUB,run.top),head=Math.min(1.72,run.top-0.28),alongX=run.axis==="x";
if(head>sill+0.2){
const jy=sill+(head-sill)/2;
box(ug,alongX?p.len:0.04,head-sill,alongX?0.04:p.len,p.x,jy,p.z,mats.glass);
}
if(run.top>head+0.1)spanBox(ug,run,s[0],s[1],head,run.top-0.08,mats.upper);
});
spans(run,function(u){return run.door[u];}).forEach(function(s){
spanBox(ug,run,s[0],s[1],2.05,run.top-0.08,mats.upper);
});
});
}
function furnish(parent,item,blocks,y0,kind){
const IM=roomMats();
const cell=INTERIOR_TILE_M;
const cx=(item.tx+item.tw/2)*cell,cz=(item.ty+item.td/2)*cell;
const alongZ=item.td>=item.tw;
function put(w,h,d,x,y,z,mat){return box(parent,w,h,d,x,y0+y,z,mat);}
function hit(w,h,d){blocks.push({x:IX+cx,z:IZ+cz,w:w,d:d,h:y0+h,y0:y0,tbRoom:1});}
if(item.kind==="bed"){
const len=Math.min(alongZ?item.td:item.tw,1.75),wid=Math.min(alongZ?item.tw:item.td,0.95);
const dx=alongZ?0:1,dz=alongZ?1:0;
const blanket=kind==="inn"?IM.blanketB:IM.blanket;
put(alongZ?wid:len,0.16,alongZ?len:wid,cx,0.2,cz,IM.wood);
put(alongZ?wid*0.92:len*0.55,0.1,alongZ?len*0.55:wid*0.92,cx+dx*len*0.16,0.32,cz+dz*len*0.16,blanket);
put(alongZ?wid*0.55:0.32,0.1,alongZ?0.32:wid*0.55,cx-dx*len*0.32,0.34,cz-dz*len*0.32,IM.pillow);
put(alongZ?wid:0.08,0.5,alongZ?0.08:wid,cx-dx*(len*0.5-0.04),0.4,cz-dz*(len*0.5-0.04),IM.woodDk);
hit(Math.min(wid+0.05,1),0.42,Math.min(len,1.8));
}else if(item.kind==="table"){
const tw=Math.min(1.05,item.tw+0.15),td=Math.min(0.7,item.td+0.05);
put(tw,0.07,td,cx,0.74,cz,IM.top);
[[-1,-1],[1,-1],[-1,1],[1,1]].forEach(function(s){put(0.07,0.7,0.07,cx+s[0]*(tw*0.4),0.35,cz+s[1]*(td*0.38),IM.woodDk);});
puck(parent,0.16,0.08,cx-0.22,y0+0.82,cz,IM.mug);
puck(parent,0.18,0.06,cx+0.2,y0+0.8,cz+0.08,IM.stool);
[[-1,0],[1,0]].forEach(function(s){
const ox=s[0]*Math.min(0.32,tw*0.34);
puck(parent,0.15,0.07,cx+ox,y0+0.28,cz,IM.stool);
put(0.06,0.22,0.06,cx+ox,0.11,cz,IM.woodDk);
});
hit(tw,0.8,td);
}else if(item.kind==="hearth"||item.kind==="forge"){
const wide=item.kind==="forge"?1.2:0.95;
put(wide,0.42,0.7,cx,0.21,cz,IM.stone);
put(wide*0.7,0.28,0.42,cx,0.48,cz,IM.stone);
put(0.28,0.1,0.4,cx,0.58,cz,IM.woodDk);
put(0.22,0.16,0.22,cx,0.72,cz,IM.fire);
put(0.1,0.14,0.1,cx,0.86,cz,IM.flame);
hit(wide,0.7,0.72);
}else if(item.kind==="bar"){
const along=Math.max(item.tw,item.td);
const vertical=item.td>item.tw;
const bw=(item.wx||item.wz)?Math.min(along*cell*0.94,along*cell):Math.max(item.tw,1.25);
const shift=Math.max(0,cell*0.5-0.32);
const bx=cx+(item.wx||0)*shift,bz=cz+(item.wz||0)*shift;
put(vertical?0.42:bw,0.86,vertical?bw:0.42,bx,0.43,bz,IM.woodDk);
put(vertical?0.58:bw+0.08,0.08,vertical?bw+0.08:0.58,bx,0.9,bz,IM.top);
puck(parent,0.07,0.12,bx-(vertical?0:bw*0.28),y0+1.02,bz-(vertical?bw*0.28:0),IM.mug);
puck(parent,0.06,0.16,bx,y0+1.04,bz,IM.bottle);
puck(parent,0.07,0.1,bx+(vertical?0:bw*0.28),y0+1.0,bz+(vertical?bw*0.28:0),IM.apple);
blocks.push({x:IX+bx,z:IZ+bz,w:vertical?0.55:bw,d:vertical?bw:0.55,h:y0+1,y0:y0,tbRoom:1});
}else if(item.kind==="counter"){
const bw=Math.max(item.tw,1.25);
put(bw,0.86,0.42,cx,0.43,cz,IM.woodDk);
put(bw+0.08,0.08,0.58,cx,0.9,cz,IM.top);
puck(parent,0.07,0.12,cx-bw*0.22,y0+1.02,cz,IM.mug);
puck(parent,0.06,0.16,cx,y0+1.04,cz+0.08,IM.bottle);
puck(parent,0.07,0.1,cx+bw*0.22,y0+1.0,cz,IM.apple);
hit(bw,1.0,0.55);
}else if(item.kind==="shelf"){
put(0.1,1.35,0.28,cx-0.4,0.68,cz,IM.wood);
put(0.1,1.35,0.28,cx+0.4,0.68,cz,IM.wood);
[0.42,0.84,1.2].forEach(function(y){put(0.86,0.05,0.26,cx,y,cz,IM.top);});
put(0.16,0.2,0.16,cx-0.22,1.32,cz,IM.apple);
put(0.14,0.16,0.14,cx,1.3,cz,IM.leaf);
put(0.16,0.22,0.16,cx+0.22,1.34,cz,IM.pot);
put(0.18,0.16,0.14,cx-0.18,0.94,cz,IM.bottle);
put(0.16,0.14,0.16,cx+0.16,0.92,cz,IM.gold);
hit(0.9,1.45,0.32);
}else if(item.kind==="crate"){
put(0.52,0.4,0.52,cx,0.2,cz,IM.wood);
put(0.54,0.06,0.08,cx,0.42,cz,IM.woodDk);
put(0.08,0.06,0.54,cx,0.42,cz,IM.woodDk);
hit(0.54,0.48,0.54);
}else if(item.kind==="pew"){
const len=Math.min(1.2,Math.max(item.tw,item.td));
put(len,0.08,0.36,cx,0.42,cz,IM.wood);
put(len,0.36,0.07,cx,0.64,cz-0.16,IM.woodDk);
put(0.07,0.4,0.38,cx-len*0.48,0.4,cz,IM.trim);
put(0.07,0.4,0.38,cx+len*0.48,0.4,cz,IM.trim);
hit(len,0.7,0.4);
}else if(item.kind==="altar"){
put(1.15,0.72,0.55,cx,0.36,cz,IM.stone);
put(1.05,0.06,0.48,cx,0.75,cz,IM.cloth);
put(0.7,0.05,0.28,cx,0.8,cz,IM.gold);
puck(parent,0.05,0.22,cx-0.28,y0+0.94,cz,IM.wood);
puck(parent,0.04,0.08,cx-0.28,y0+1.08,cz,IM.flame);
puck(parent,0.05,0.22,cx+0.28,y0+0.94,cz,IM.wood);
puck(parent,0.04,0.08,cx+0.28,y0+1.08,cz,IM.flame);
hit(1.15,0.85,0.58);
}else if(item.kind==="anvil"){
put(0.4,0.38,0.4,cx,0.19,cz,IM.woodDk);
put(0.55,0.16,0.28,cx,0.46,cz,IM.metalDk);
put(0.28,0.1,0.16,cx+0.28,0.5,cz,IM.metal);
put(0.12,0.18,0.12,cx-0.1,0.6,cz,IM.metal);
hit(0.7,0.62,0.42);
}else{
put(0.72,0.32,0.46,cx,0.16,cz,IM.wood);
put(0.74,0.08,0.48,cx,0.36,cz,IM.woodDk);
put(0.08,0.06,0.08,cx,0.42,cz,IM.gold);
hit(0.74,0.42,0.5);
}
}
function construct(row){
if(!ctx||!ctx.scene||typeof THREE==="undefined"||!window.TBTiles)throw new Error("interior scene not ready");
const P=planFixed(row);
const g=new THREE.Group();
g.name="tb-interior";
g.userData.tbKeep=1;g.userData.tbInterior=1;
g.position.set(IX,0,IZ);
ctx.scene.add(g);
const blocks=[];
const IM=roomMats();
const cell=P.cell,floorsL=[];
for(let y=0;y<P.h;y++)for(let x=0;x<P.w;x++)if(P.grid[y*P.w+x]===FLOOR)floorsL.push({tx:x,ty:y});
const stepKey={},floorSet={};
P.stepCells.forEach(function(c){stepKey[c.x+","+c.y]=1;});
floorsL.forEach(function(c){floorSet[c.tx+","+c.ty]=1;});
const floorMat=(P.kind==="church"||P.kind==="smith")?IM.flag:IM.floor;
addFloor(g,floorsL,0.045,floorMat,cell);
buildWalls(g,row,blocks,IM);
P.furniture.forEach(function(item){
if(item.floor>0)return;
furnish(g,item,blocks,0,P.kind);
});
for(let level=1;level<P.floors;level++){
const up=new THREE.Group();
up.userData.tbStorey=level;
g.add(up);
const cells=floorsL.filter(function(c){return !stepKey[c.tx+","+c.ty];});
if(!cells.length)continue;
const upMat=floorMat.clone();
upMat.userData.tbClone=1;
upMat.opacity=1;upMat.transparent=false;upMat.depthWrite=true;
const y=level*P.storyH;
addFloor(up,cells,y,upMat,cell);
let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;
cells.forEach(function(c){
const x0=IX+c.tx*cell,z0=IZ+c.ty*cell;
if(x0<minX)minX=x0;if(x0+cell>maxX)maxX=x0+cell;
if(z0<minZ)minZ=z0;if(z0+cell>maxZ)maxZ=z0+cell;
});
up.userData.tbFade={
op:1,target:1,from:1,t:1,mats:[upMat],slab:1,
x0:minX,z0:minZ,x1:maxX,z1:maxZ,y0:y-0.2,y1:y+0.2,thick:Math.max(maxX-minX,maxZ-minZ),
cx:(minX+maxX)/2,cz:(minZ+maxZ)/2
};
P.furniture.forEach(function(item){
if(item.floor!==level)return;
furnish(up,item,blocks,level*P.storyH,P.kind);
});
P.stepCells.forEach(function(c){
[[1,0],[-1,0],[0,1],[0,-1]].forEach(function(d){
const k=(c.x+d[0])+","+(c.y+d[1]);
if(!floorSet[k]||stepKey[k])return;
const alongX=d[1]!==0;
const ex=(c.x+0.5+d[0]*0.5)*cell,ez=(c.y+0.5+d[1]*0.5)*cell;
box(g,alongX?cell:0.1,0.1,alongX?0.1:cell,ex,level*P.storyH+0.08,ez,IM.trim);
});
});
}
P.steps.forEach(function(s,i){
const localX=s.x-IX,localZ=s.z-IZ;
const prev=i?P.steps[i-1].h:0;
const rise=Math.max(0.1,s.h-prev);
box(g,s.w,rise,s.d,localX,s.h-rise/2,localZ,IM.woodDk);
box(g,s.w+0.04,0.05,s.d+0.04,localX,s.h-0.025,localZ,IM.tread);
});
if(P.steps.length>1){
const a=P.steps[0],b=P.steps[P.steps.length-1];
const alongX=Math.abs(b.x-a.x)>=Math.abs(b.z-a.z);
const off=((alongX?a.d:a.w)*0.5)+0.04;
[-1,1].forEach(function(s){
const x0=(a.x-IX)+(alongX?0:s*off),z0=(a.z-IZ)+(alongX?s*off:0);
const x1=(b.x-IX)+(alongX?0:s*off),z1=(b.z-IZ)+(alongX?s*off:0);
const mx=(x0+x1)/2,mz=(z0+z1)/2,len=Math.hypot(x1-x0,z1-z0)+0.16;
const hy=(a.h+b.h)*0.5+0.58;
box(g,alongX?len:0.06,0.06,alongX?0.06:len,mx,hy,mz,IM.wood);
box(g,0.08,a.h+0.72,0.08,x0,(a.h+0.72)/2,z0,IM.trim);
box(g,0.08,b.h+0.72,0.08,x1,(b.h+0.72)/2,z1,IM.trim);
});
}
const fb=P.floorBounds;
const lx=(fb.minX+fb.maxX)/2-IX,lz=(fb.minZ+fb.maxZ)/2-IZ;
const span=Math.hypot(fb.maxX-fb.minX,fb.maxZ-fb.minZ);
const lamp=new THREE.PointLight(0xffcc88,0.9,Math.max(14,span));
lamp.position.set(lx,2.4,lz);
g.add(lamp);
const th=ctx.things;
if(th){
th.push({
k:"portal",tbLeave:1,_tbOff:0,
x:P.leaveLocal.x,z:P.leaveLocal.z,y:0,r:1.35,hy:2.6,
label:"Leave "+P.name,
prepare:function(t){const d=row.door;t.to=[d.outX,d.outZ,d.yawOut];}
});
}
blocks.forEach(function(b){ctx.BX.push(b);});
return {id:P.id,name:P.name,group:g,plan:P,steps:P.steps,slabs:P.slabs,floors:P.floors,storyH:P.storyH,bounds:P.bounds,floorBounds:P.floorBounds,lamp:lamp};
}
function contains(x,z){
if(!active)return false;
const b=active.bounds;
return x>=b.minX-0.3&&x<=b.maxX+0.3&&z>=b.minZ-0.3&&z<=b.maxZ+0.3;
}
function groundY(x,z,y){
if(!active)return 0;
const yy=y==null?0:y;
let h=0;
const steps=active.steps,slabs=active.slabs;
for(let i=0;i<steps.length;i++){
const s=steps[i];
if(Math.abs(x-s.x)<=s.w/2&&Math.abs(z-s.z)<=s.d/2)h=Math.max(h,s.h);
}
for(let i=0;i<slabs.length;i++){
const s=slabs[i];
if(Math.abs(x-s.x)<=s.w/2+0.02&&Math.abs(z-s.z)<=s.d/2+0.02&&s.h<=yy+0.5)h=Math.max(h,s.h);
}
return h;
}
function clampTo(x,z){
if(!active)return {x:x,z:z};
const b=active.bounds,m=0.42;
return {x:Math.max(b.minX+m,Math.min(b.maxX-m,x)),z:Math.max(b.minZ+m,Math.min(b.maxZ-m,z))};
}
function frame(p){
if(!active)return null;
const b=active.floorBounds||active.bounds;
const rw=Math.max(1,b.maxX-b.minX),rd=Math.max(1,b.maxZ-b.minZ);
/* Cabin floor is 16 m on its long side and the vista camera sits at 60 m.
   That frames the whole room. Match the ratio at the current pitch. */
const d=Math.max(rw,rd)*(60/16);
return {x:(b.minX+b.maxX)/2,y:p?p.y:0,z:(b.minZ+b.maxZ)/2,d:d};
}
function distSeg(px,pz,x0,z0,x1,z1){
const dx=x1-x0,dz=z1-z0,l2=dx*dx+dz*dz;
let t=l2>1e-8?((px-x0)*dx+(pz-z0)*dz)/l2:0;
t=t<0?0:t>1?1:t;
const x=x0+dx*t,z=z0+dz*t;
return Math.hypot(px-x,pz-z);
}
function rayHits(f,eye,p){
const ax=eye.x,ay=eye.y,az=eye.z,bx=p.x,by=p.y+0.9,bz=p.z,rad=0.8;
for(let i=1;i<=14;i++){
const t=i/15,x=ax+(bx-ax)*t,y=ay+(by-ay)*t,z=az+(bz-az)*t;
if(f.slab){
if(y<f.y0||y>f.y1)continue;
if(x<f.x0-rad||x>f.x1+rad||z<f.z0-rad||z>f.z1+rad)continue;
if(Math.hypot(x-p.x,z-p.z)<1.1)continue;
return true;
}
if(y<f.y0-0.25||y>f.y1+0.25)continue;
if(distSeg(x,z,f.x0,f.z0,f.x1,f.z1)<=f.thick*0.5+rad)return true;
}
return false;
}
function showFor(p,yawDeg,cam,dt){
if(!active||!active.group||!p||!contains(p.x,p.z))return;
const sh=active.storyH||2.8;
let f=0;
for(let i=active.floors-1;i>=1;i--)if(p.y>=i*sh-0.45){f=i;break;}
if(active.lamp)active.lamp.position.y=f*sh+2.4;
const th=(yawDeg==null?45:yawDeg)*Math.PI/180,dx=Math.sin(th),dz=Math.cos(th);
active.group.traverse(function(o){
if(o.userData&&o.userData.tbStorey!=null)o.visible=o.userData.tbStorey<=f;
});
const eye=cam&&cam.position;
active.group.traverse(function(o){
const fade=o.userData&&o.userData.tbFade;
if(!fade||!fade.mats)return;
if(!o.visible)return;
const near=!fade.slab&&(fade.cx-p.x)*dx+(fade.cz-p.z)*dz>=0.35;
const hit=eye?rayHits(fade,eye,p):false;
const target=(near||hit)?0.25:1;
if(fade.target!==target){fade.target=target;fade.from=fade.op;fade.t=0;}
fade.t+=(dt>0?dt:0);
const u=fade.t>=0.15?1:fade.t/0.15;
fade.op=fade.from+(fade.target-fade.from)*u;
const op=fade.op,ghost=op<0.99;
fade.mats.forEach(function(m){
m.opacity=op;
m.transparent=ghost;
m.depthWrite=!ghost;
});
});
}
function nameAt(x,z){return contains(x,z)&&active?active.name:"";}
function disposeBuilt(){
if(!active)return;
const g=active.group;
if(g){
g.traverse(function(o){
if(o.geometry&&o.geometry.dispose)o.geometry.dispose();
const mats=o.userData&&o.userData.tbFade&&o.userData.tbFade.mats;
if(mats)mats.forEach(function(m){if(m&&m.dispose)m.dispose();});
});
if(g.parent)g.parent.remove(g);
}
const bx=ctx&&ctx.BX;
if(bx)for(let i=bx.length-1;i>=0;i--)if(bx[i]&&bx[i].tbRoom)bx.splice(i,1);
const th=ctx&&ctx.things;
if(th)for(let i=th.length-1;i>=0;i--)if(th[i]&&th[i].tbLeave)th.splice(i,1);
active=null;
}
function forget(){
disposeBuilt();
const th=ctx&&ctx.things;
if(!th)return;
for(let i=th.length-1;i>=0;i--)if(th[i]&&th[i].tbDoor)th.splice(i,1);
}
function arm(){
const th=ctx&&ctx.things;
if(!th)return;
for(let i=th.length-1;i>=0;i--)if(th[i]&&th[i].tbDoor)th.splice(i,1);
const rows=window.TBBuildings&&TBBuildings.rows||[];
rows.forEach(function(row){
if(!row.door||!row.mask)return;
th.push({
k:"portal",tbDoor:1,_tbOff:0,
x:row.door.outX,z:row.door.outZ,y:row.door.outY||0,
r:1.55,hy:2.6,
label:"Enter "+(row.name||"building"),
building:row.id,
prepare:function(t){prepareEnter(row,t);}
});
});
}
function prepareEnter(row,portal){
try{
if(!active||active.id!==String(row.id)){
disposeBuilt();
active=construct(row);
}
const e=active.plan.entry;
portal.to=[e.x,e.z,e.yaw];
}catch(err){
console.warn("tb interior",err);
if(row.door)portal.to=[row.door.outX,row.door.outZ,row.door.yawOut];
}
}
function othersInside(except){
const ps=ctx&&ctx.players||[];
for(let i=0;i<ps.length;i++){
const p=ps[i];
if(p===except)continue;
if(contains(p.x,p.z))return true;
}
return false;
}
function onArrive(p){
if(!active||!p)return;
if(contains(p.x,p.z))return;
if(othersInside(p))return;
disposeBuilt();
}
function info(){
if(!active)return null;
return {id:active.id,name:active.name,entry:active.plan.entry,leave:active.plan.leaveLocal,steps:active.steps,slabs:active.slabs,furniture:active.plan.furniture,floors:active.floors,storyH:active.storyH,bounds:active.bounds};
}
window.TBInteriors={
bind:bind,arm:arm,forget:forget,plan:planFixed,contains:contains,groundY:groundY,clamp:clampTo,
showFor:showFor,frame:frame,nameAt:nameAt,onArrive:onArrive,info:info,prepareEnter:prepareEnter,
IX:IX,IZ:IZ,INTERIOR_TILE_M:INTERIOR_TILE_M
};
})();
