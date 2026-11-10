/* Ported from trailbound-controller (deployed main). ESM, behaviour-faithful.
   Not typechecked: a full TS conversion of these files would stall the port.
   three r187: colorSpace, colorspace_fragment, per-fragment Lambert cel, asset root.
*/
/* Live link with the world map (protocol tb: 1).
   Inert until a map offers hello.live containing 1. Older one-shot handoffs
   never set that flag, so they stay a frozen copy of the place.
   The map owns the clock. This side extrapolates between tb-sim ticks and,
   when the link drops, keeps a clock-true zone pace: 1.4 game seconds per
   real second, so a walking pace of about 1.4 m/s is an honest 5 km/h and
   the day barely moves. NPC bodies are stepped by npcs.js at the speed the
   map sends (metres per real second) while the clock rate is above zero. */
(function(){
const PROTO=1;
const ZONE_GAME_SEC=1.4;
const ZONE_RATE=ZONE_GAME_SEC/3600;
const STORE="tbLive";
const ID_RE=/^[a-z0-9-]{1,40}$/;
const LIVE={
"tb-session-open":1,"tb-sim":1,"tb-chatter":1,"tb-close":1,
"tb-player":1,"tb-npc-event":1,"tb-exit":1,"tb-enter-building":1,
"tb-leave-building":1,"tb-npc-interact":1
};
const ALLOW_DEFAULT=["https://ambrandt94.github.io","http://localhost:4202","https://map.4thtower.com","https://trailbound-world-map.pages.dev"];

function finite(n){return typeof n==="number"&&isFinite(n);}
function r1(n){return Math.round(n*10)/10;}
function allowList(){
if(window.TBArea&&TBArea.allow)return TBArea.allow;
return ALLOW_DEFAULT;
}
function validateLive(msg,ctx){
ctx=ctx||{};
if(!msg||typeof msg!=="object")return "empty";
if(!LIVE[msg.type])return "ignore";
if(ctx.allow&&ctx.origin&&ctx.allow.indexOf(ctx.origin)<0)return "origin";
if(msg.tb!==PROTO)return msg.tb==null?"tb":"version";
if(typeof msg.sid!=="string"||!ID_RE.test(msg.sid))return "sid";
if(ctx.sid&&msg.sid!==ctx.sid)return "sid";
if(!finite(msg.seq)||msg.seq<=(ctx.lastSeq||0))return "seq";
const max=(ctx.gridW||512)*(ctx.meters||1)+64;
function pt(p){
if(!p||typeof p!=="object"||!finite(p.x)||!finite(p.z))return false;
if(p.x<-64||p.z<-64||p.x>max||p.z>max)return false;
return true;
}
function yawOk(y){return y==null||(finite(y)&&y>=-Math.PI*2-1e-6&&y<=Math.PI*2+1e-6);}
let size=ctx.jsonLength;
if(size==null){try{size=JSON.stringify(msg).length;}catch(e){size=0;}}
if(size>65536)return "size";
if(msg.type==="tb-chatter"){
if(typeof msg.text!=="string"||msg.text.length>160)return "text";
if(msg.name!=null&&String(msg.name).length>48)return "name";
if(!ID_RE.test(String(msg.speakerId||"")))return "id";
if(!ID_RE.test(String(msg.bubbleId||"b")))return "id";
}
if(msg.type==="tb-sim"||msg.type==="tb-session-open"){
if(msg.clock){
if(!finite(msg.clock.hours)||msg.clock.hours<0)return "hours";
if(!finite(msg.clock.rate))return "rate";
}
}
if(msg.type==="tb-session-open"&&msg.player&&!pt(msg.player))return "range";
if(msg.type==="tb-session-open"&&msg.player&&!yawOk(msg.player.yaw))return "yaw";
const ents=msg.ents,events=msg.events,npcs=msg.npcs;
if(ents&&ents.length>32)return "ents";
if(events&&events.length>32)return "events";
if(npcs&&npcs.length>32)return "npcs";
if(ents)for(let i=0;i<ents.length;i++){
const e=ents[i];
if(!e||!ID_RE.test(String(e.id||"")))return "id";
if(e.name!=null&&String(e.name).length>48)return "name";
if(e.pos&&!pt(e.pos))return "range";
if(!yawOk(e.yaw))return "yaw";
if(!finite(e.iv))return "nan";
if(e.members&&e.members.looks&&e.members.looks.length>16)return "looks";
if(e.intent&&e.intent.to&&!pt(e.intent.to))return "range";
if(e.intent&&e.intent.at&&!pt(e.intent.at))return "range";
if(e.intent&&e.intent.door&&typeof e.intent.door==="object"&&!pt(e.intent.door))return "range";
if(e.intent&&e.intent.exit&&typeof e.intent.exit==="object"&&!pt(e.intent.exit))return "range";
}
if(events)for(let i=0;i<events.length;i++){
const e=events[i];
if(!e||!ID_RE.test(String(e.id||"")))return "id";
if(e.at&&!pt(e.at))return "range";
}
if(npcs)for(let i=0;i<npcs.length;i++){
if(!npcs[i]||!ID_RE.test(String(npcs[i].id||"")))return "id";
if(npcs[i].pos&&!pt(npcs[i].pos))return "range";
}
return "";
}

function createSession(env){
env=env||{};
const allow=env.allow||allowList();
function now(){return env.now?env.now():(typeof performance!=="undefined"?performance.now():Date.now());}
const state={
mode:"idle",sid:null,hash:"",placeId:"",origin:null,source:null,
lastSeq:0,seq:0,clock:null,clockAt:0,lastSim:0,lastSend:0,lastNpcSend:0,lastReady:0,
drops:0,liveOffer:false,versionSent:false,pushT:0,exitSide:null,
inside:null,parked:false,area:null,gridW:184,meters:1,queue:[],
hz:4,heartbeat:1000,timeout:10000,counts:{},windowStart:0
};
function readStore(){
try{
const raw=env.storage?env.storage.get(STORE):sessionStorage.getItem(STORE);
return raw?JSON.parse(raw):null;
}catch(e){return null;}
}
function writeStore(obj){
try{
const s=JSON.stringify(obj);
if(env.storage)env.storage.set(STORE,s);
else sessionStorage.setItem(STORE,s);
}catch(e){}
}
function noteDrop(){state.drops++;}
function pin(from){if(from&&from.source){state.origin=from.origin;state.source=from.source;}}
function pinnedOk(from){
if(!state.source)return true;
return from&&from.source===state.source&&from.origin===state.origin;
}
function post(msg,origin,source){
if(!origin||origin==="*")return;
const src=source||state.source;
if(!src||!src.postMessage)return;
try{src.postMessage(msg,origin);}catch(e){}
if(env.onPost)env.onPost(msg,origin);
}
function nextSeq(){state.seq+=1;return state.seq;}
function envelope(type,body){
const msg={type:type,tb:PROTO,sid:state.sid,seq:nextSeq()};
if(body)for(const k in body)msg[k]=body[k];
return msg;
}
function sendReady(from){
const msg={type:"tb-area-ready"};
if(state.liveOffer)msg.live=1;
const saved=readStore();
if(saved&&saved.sid&&saved.hash)msg.resume={sid:saved.sid,hash:saved.hash,lastSeq:saved.lastSeq|0};
const origin=from&&from.origin||state.origin;
const source=from&&from.source||state.source;
if(origin&&source)post(msg,origin,source);
else if(env.opener&&env.opener.postMessage){
allow.forEach(function(o){try{env.opener.postMessage(msg,o);}catch(e){}});
if(env.onPost)env.onPost(msg,"*opener*");
}
state.lastReady=now();
}
function sendClose(reason,from){
if(!state.sid)return;
post(envelope("tb-close",{reason:reason||"user"}),from&&from.origin||state.origin,from&&from.source||state.source);
}
function valCtx(from){
const list=allow.slice();
if(state.harness){try{if(location.origin&&list.indexOf(location.origin)<0)list.push(location.origin);}catch(e){}}
return {origin:from&&from.origin,allow:list,sid:state.sid,lastSeq:state.lastSeq,gridW:state.gridW,meters:state.meters};
}
function rateOk(type){
const t=now();
if(t-state.windowStart>1000){state.windowStart=t;state.counts={};}
state.counts[type]=(state.counts[type]||0)+1;
return state.counts[type]<=20;
}
function setClock(clock){
state.clock={hours:+clock.hours,rate:+clock.rate,mode:clock.mode||"zone"};
state.clockAt=now();
}
function clockNow(){
if(!state.clock)return null;
const dt=Math.max(0,(now()-state.clockAt)/1000);
return {hours:state.clock.hours+state.clock.rate*dt,rate:state.clock.rate,mode:state.clock.mode};
}
function ensureZoneClock(hours){
if(state.mode==="live")return;
const h=isFinite(hours)?hours:(state.clock?clockNow().hours:8);
setClock({hours:h,rate:ZONE_RATE,mode:"zone"});
}
function goStandalone(){
if(state.mode==="exit"||state.mode==="standalone")return;
const c=clockNow();
state.mode="standalone";
setClock({hours:c?c.hours:(state.area&&state.area.npcs&&state.area.npcs.asOfHours)||8,rate:ZONE_RATE,mode:"zone"});
if(window.TBNpcs&&TBNpcs.setStandalone)TBNpcs.setStandalone(true);
}
function placePlayer(pose){
const ps=env.players?env.players():(ctxPlayers());
if(!ps||!ps[0]||!pose)return;
const p=ps[0];
p.x=+pose.x;p.z=+pose.z;
if(pose.yaw!=null)p.yaw=+pose.yaw;
p.vx=p.vy=p.vz=0;p.g=true;p.snap=true;
if(window.TBArea&&TBArea.groundY)p.y=TBArea.groundY(p.x,p.z)||0;
}
function ctxPlayers(){
return state.ctx&&state.ctx.players;
}
function applyOpen(msg){
if(state.hash&&msg.areaHash&&msg.areaHash!==state.hash){noteDrop();return;}
if(state.placeId&&msg.placeId&&msg.placeId!==state.placeId){noteDrop();return;}
state.sid=msg.sid;
state.mode="live";
state.lastSeq=msg.seq;
if(msg.rates){
let hz=+msg.rates.simHz||4;
if(hz<2)hz=2; if(hz>5)hz=5;
state.hz=hz;
if(msg.rates.heartbeatMs)state.heartbeat=+msg.rates.heartbeatMs;
if(msg.rates.timeoutMs)state.timeout=+msg.rates.timeoutMs;
}
if(msg.clock)setClock(msg.clock);
state.lastSim=now();
const pose=msg.player||(msg.resume&&readStore()&&readStore().lastPlayer);
if(msg.resume&&readStore()&&readStore().lastPlayer)placePlayer(readStore().lastPlayer);
else if(msg.player)placePlayer(msg.player);
writeStore({sid:state.sid,hash:state.hash,lastSeq:state.lastSeq,lastPlayer:playerSnap()});
if(window.TBNpcs&&TBNpcs.setStandalone)TBNpcs.setStandalone(false);
hideCard();
showBadge();
}
function playerSnap(){
const ps=ctxPlayers(); if(!ps||!ps[0])return null;
const p=ps[0];
return {x:r1(p.x),z:r1(p.z),yaw:p.yaw};
}
function handle(msg,from){
const err=validateLive(msg,valCtx(from));
if(err==="ignore")return;
if(err==="version"){noteDrop();if(!state.versionSent){state.versionSent=true;sendClose("version",from);}return;}
if(err){noteDrop();return;}
if(!rateOk(msg.type)){noteDrop();return;}
if(msg.type==="tb-session-open"){
if(!state.area){state.queue.push(msg);pin(from);return;}
applyOpen(msg);return;
}
if(!state.sid||msg.sid!==state.sid){noteDrop();return;}
state.lastSeq=msg.seq;
if(msg.type==="tb-sim"){
state.lastSim=now();
if(state.mode!=="live"&&state.mode!=="exit")state.mode="live";
if(msg.clock)setClock(msg.clock);
if(window.TBNpcs&&TBNpcs.applySim)TBNpcs.applySim(msg);
return;
}
if(msg.type==="tb-chatter"){
if(window.TBNpcs&&TBNpcs.chatter)TBNpcs.chatter(msg);
return;
}
if(msg.type==="tb-close"){
if(msg.reason==="exit"||msg.reason==="map-left-zone")showCard(state.exitSide);
else if(msg.reason==="unknown-session")goStandalone();
else state.mode="closed";
state.sid=null;state.source=null;state.origin=null;
return;
}
}
function hello(msg,from){
const majors=Array.isArray(msg.live)?msg.live:[];
let speaks=false;
for(let i=0;i<majors.length;i++)if(+majors[i]===PROTO)speaks=true;
if(!speaks)return false;
if(state.source&&!pinnedOk(from)&&state.mode==="live"){noteDrop();return true;}
if(state.mode==="exit"||state.mode==="closed"){
state.sid=null;state.lastSeq=0;state.seq=0;state.mode="idle";hideCard();
}
pin(from);
state.liveOffer=true;
sendReady(from);
return true;
}
function originOk(origin){
if(allow.indexOf(origin)>=0)return true;
if(state.harness&&typeof location!=="undefined"&&origin===location.origin)return true;
return false;
}
function route(msg,from){
if(!msg||typeof msg!=="object")return false;
if(!from||!originOk(from.origin)){
if(msg.tb===PROTO){noteDrop();return true;}
return false;
}
if(state.source&&!pinnedOk(from)){
if(msg.tb===PROTO||msg.type==="tb-area-hello"||msg.type==="tb-area"){noteDrop();return true;}
}
if(msg.type==="tb-area-hello")return hello(msg,from);
if(msg.type==="tb-area"){if(!state.source)pin(from);return false;}
if(msg.tb!=null&&msg.tb!==PROTO&&LIVE[msg.type]){
noteDrop();
if(!state.versionSent){state.versionSent=true;sendClose("version",from);}
return true;
}
if(LIVE[msg.type]){handle(msg,from);return true;}
return false;
}
function onArea(p,opt){
if(!p)return;
state.area=p;
state.hash=(p.meta&&p.meta.hash)||"";
state.placeId=(p.area&&p.area.id)||"";
state.gridW=p.grid&&p.grid.w||state.gridW;
state.meters=(p.units&&+p.units.metersPerTile)||1;
if(p.session&&p.session.sid){
/* sid is confirmed by tb-session-open; remember the offer only */
state.offeredSid=p.session.sid;
}
if(state.mode!=="live"&&state.mode!=="exit"){
const h=p.npcs&&isFinite(+p.npcs.asOfHours)?+p.npcs.asOfHours:8;
if(p.npcs&&p.npcs.list&&p.npcs.list.length){ensureZoneClock(h);if(state.mode==="idle")state.mode="standalone";}
}
const q=state.queue;state.queue=[];
for(let i=0;i<q.length;i++)handle(q[i],{source:state.source,origin:state.origin});
const saved=readStore();
if(saved&&saved.lastPlayer&&state.mode!=="live"){}
showBadge();
}
function sendPlayer(force){
if(state.mode!=="live"||!state.sid||!state.origin)return;
const ps=ctxPlayers(); if(!ps||!ps[0])return;
const p=ps[0];
const snap=playerSnap();
const body={
pos:{x:snap.x,z:snap.z},yaw:p.yaw,
moving:Math.hypot(p.vx,p.vz)>0.25,
sprint:p.st==="sprint"||p.sm>1.05,
inside:state.inside
};
if(state.parked)body.parked=true;
const t=now();
if(t-state.lastNpcSend>1000&&window.TBNpcs&&TBNpcs.actors){
const list=TBNpcs.actors();
const npcs=[];
for(let i=0;i<list.length&&npcs.length<32;i++){
if(list[i].hidden)continue;
npcs.push({id:list[i].id,pos:{x:r1(list[i].x),z:r1(list[i].z)}});
}
body.npcs=npcs;state.lastNpcSend=t;
}
post(envelope("tb-player",body),state.origin);
state.lastSend=t;
writeStore({sid:state.sid,hash:state.hash,lastSeq:state.lastSeq,lastPlayer:snap});
}
function buildingWatch(){
if(!window.TBInteriors||!TBInteriors.contains||!TBInteriors.info)return;
const ps=ctxPlayers(); if(!ps||!ps[0])return;
const p=ps[0];
const inside=TBInteriors.contains(p.x,p.z);
const info=inside?TBInteriors.info():null;
const id=info&&info.id||null;
if(id&&id!==state.inside){
state.inside=id;
if(state.mode==="live")post(envelope("tb-enter-building",{buildingId:id}),state.origin);
}else if(!inside&&state.inside){
const prev=state.inside;state.inside=null;
if(state.mode==="live")post(envelope("tb-leave-building",{buildingId:prev,pos:{x:r1(p.x),z:r1(p.z)}}),state.origin);
}
}
function watchEdge(dt){
if(state.mode!=="live"){state.pushT=0;return;}
const ps=ctxPlayers(); if(!ps||!ps[0])return;
const p=ps[0];
if(window.TBInteriors&&TBInteriors.contains&&TBInteriors.contains(p.x,p.z)){state.pushT=0;return;}
if(!window.TBNpcs||!TBNpcs.edgeHold)return;
const hit=TBNpcs.edgeHold(p.x,p.z,p.vx,p.vz);
if(!hit){state.pushT=0;return;}
state.pushT+=dt;
if(state.pushT<0.6)return;
state.pushT=0;
state.exitSide=hit.side;
post(envelope("tb-exit",{side:hit.side,pos:{x:r1(p.x),z:r1(p.z)},yaw:p.yaw}),state.origin);
showCard(hit.side);
}
function update(dt){
const t=now();
if(state.mode==="live"&&state.lastSim&&t-state.lastSim>state.timeout)goStandalone();
if(state.mode==="standalone"&&state.liveOffer){
const opener=env.opener||(typeof window!=="undefined"&&window.opener);
if(opener&&t-state.lastReady>2000)sendReady({source:opener,origin:state.origin||allow[0]});
}
if(state.mode==="live"){
const gap=1000/state.hz;
if(t-state.lastSend>=gap||t-state.lastSend>=state.heartbeat)sendPlayer();
}
buildingWatch();
watchEdge(dt||0);
sky();
showBadge();
}
function sky(){
/* The area look owns the sun angle (dayLightAt → setLook). Copying the zone
   clock into sunHour pinned NPC towns at the export hour, so night colours
   arrived with a morning sun. NPC schedules still read clockNow(). */
}
function placeName(){
if(window.TBArea&&TBArea.name)return TBArea.name()||"the place";
return (state.area&&state.area.area&&state.area.area.name)||"the place";
}
function showBadge(){
if(typeof document==="undefined"||!document.getElementById||!document.createElement)return;
let el=document.getElementById("tb-live-badge");
const on=state.mode==="live"||state.mode==="standalone";
if(!on){if(el&&el.style)el.style.display="none";return;}
if(!el){
el=document.createElement("div");
if(!el||!el.style)return;
el.id="tb-live-badge";
const wrap=document.querySelector&&document.querySelector(".wrap");
const parent=wrap||document.body;
if(!parent||!parent.appendChild)return;
parent.appendChild(el);
}
el.style.display="block";
const label=state.mode==="live"?"Live":"Standalone";
el.textContent=label+" · "+placeName();
try{document.title=(state.mode==="live"?"Live":"Standalone")+" · "+placeName();}catch(e){}
el.className=state.mode==="live"?"on":"off";
const hud=document.getElementById("hud");
if(hud&&hud.checked&&state.drops)el.textContent+="  ·  link drops "+state.drops;
el.title="link drops "+state.drops;
}
function requestExit(info){
if(state.mode==="exit"||state.mode==="closed")return;
const side=info&&info.side||null;
const pos=info&&info.pos||{x:0,z:0};
const yaw=info&&info.yaw;
state.exitSide=side;
const body={side:side,pos:pos,yaw:yaw};
if(state.sid&&state.origin){
post(envelope("tb-exit",body),state.origin);
}else if(state.source&&state.origin){
post({type:"tb-exit",side:side,pos:pos,yaw:yaw,area:placeName()},state.origin);
}
const opener=env.opener||(typeof window!=="undefined"?window.opener:null);
if(opener&&opener!==state.source&&opener.postMessage){
const msg={type:"tb-exit",side:side,pos:pos,yaw:yaw};
allow.forEach(function(o){try{opener.postMessage(msg,o);}catch(e){}});
}
showCard(side);
}
function showCard(side){
state.mode="exit";
state.pushT=0;
if(typeof document==="undefined"||!document.createElement)return;
let el=document.getElementById("tb-back-card");
if(!el){
el=document.createElement("div");
if(!el||!el.style||!el.appendChild)return;
el.id="tb-back-card";
const wrap=document.querySelector&&document.querySelector(".wrap");
const parent=wrap||document.body;
if(!parent||!parent.appendChild)return;
parent.appendChild(el);
}
if(!el.style||!el.appendChild)return;
el.textContent="";
const panel=document.createElement("div");
if(!panel.appendChild)return;
panel.className="panel";
const h=document.createElement("h2");h.textContent="Back on the map";
const p1=document.createElement("p");
const edge=side?("the "+({N:"north",E:"east",S:"south",W:"west"}[side]||side)+" edge of "):"";
p1.appendChild(document.createTextNode("You're just outside "+edge));
const name=document.createElement("b");name.textContent=placeName();p1.appendChild(name);
p1.appendChild(document.createTextNode("."));
const p2=document.createElement("p");
p2.textContent="This window stays open. Press Play in 3D on the map and it will use this same view.";
panel.appendChild(h);panel.appendChild(p1);panel.appendChild(p2);
el.appendChild(panel);
el.style.display="flex";
showBadge();
}
function hideCard(){
if(typeof document==="undefined"||!document.getElementById)return;
const el=document.getElementById("tb-back-card");
if(el)el.style.display="none";
}
function talk(id){
if(state.mode!=="live"||!state.sid)return;
if(!ID_RE.test(String(id||"")))return;
post(envelope("tb-npc-interact",{id:id,verb:"talk"}),state.origin);
if(window.TBNpcs&&TBNpcs.facePlayer)TBNpcs.facePlayer(id);
}
function npcEvent(ev){
if(state.mode!=="live"||!state.sid||!ev)return;
post(envelope("tb-npc-event",{
id:ev.id,iv:ev.iv|0,e:ev.e,at:ev.at||{x:0,z:0},
buildingId:ev.buildingId,side:ev.side
}),state.origin);
}
function readyExtras(){
const extra={};
const saved=readStore();
if(saved&&saved.sid&&saved.hash)extra.resume={sid:saved.sid,hash:saved.hash,lastSeq:saved.lastSeq|0};
if(state.liveOffer)extra.live=1;
return extra;
}
function attach(c){state.ctx=c;}
function replay(text){
state.harness=true;
const lines=String(text||"").split(/\n/);
let origin=allow[0];
try{if(location.origin)origin=location.origin;}catch(e){}
const from={source:typeof window!=="undefined"?window:null,origin:origin};
let lastClock=null, closed=false, maxT=0;
function play(row){
if(!row||!row.msg)return;
if(row.msg.clock)lastClock=row.msg.clock;
if(row.msg.type==="tb-close")closed=true;
const originRow=row.origin||from.origin;
route(row.msg,{source:from.source,origin:originRow});
}
lines.forEach(function(line){
line=line.trim();if(!line)return;
let row;try{row=JSON.parse(line);}catch(e){return;}
const delay=Math.max(0,(+row.t||0)*1000);
if((+row.t||0)>maxT)maxT=+row.t||0;
const fire=function(){play(row);};
if(env.schedule)env.schedule(delay,fire);
else if(typeof setTimeout==="function")setTimeout(fire,delay);
else fire();
});
/* A recorded script ends. A real map keeps tb-sim heartbeats going, or the
   link correctly drops to standalone after 10s. The dev replay does the same. */
let depth=0, beats=0;
function beat(){
if(depth>0||closed||beats>240)return;
if(state.mode==="exit"||state.mode==="closed")return;
depth++;
try{
if(state.sid){
const clock=lastClock||{hours:9.25,rate:ZONE_RATE,mode:"zone"};
route({type:"tb-sim",tb:PROTO,sid:state.sid,seq:(state.lastSeq||0)+1,clock:clock,key:false,ents:[],events:[]},{source:from.source,origin:from.origin});
beats++;
}
}finally{depth--;}
if(typeof setTimeout==="function")setTimeout(beat,250);
}
if(typeof setTimeout==="function")setTimeout(beat,(maxT+0.3)*1000);
}
return {
route:route,update:update,onArea:onArea,attach:attach,talk:talk,npcEvent:npcEvent,
readyExtras:readyExtras,sendReady:sendReady,replay:replay,showCard:showCard,requestExit:requestExit,
clock:clockNow,drops:function(){return state.drops;},
mode:function(){return state.mode;},
liveChosen:function(){return state.liveOffer;},
state:state
};
}

let session=null;
function sessionOr(){
if(!session){
session=createSession({
allow:allowList(),
opener:typeof window!=="undefined"?window.opener:null
});
}
return session;
}
function boot(){
sessionOr();
if(typeof document!=="undefined"&&document.addEventListener){
document.addEventListener("visibilitychange",function(){
const s=sessionOr();
s.state.parked=!!document.hidden;
if(document.hidden&&s.mode()==="live")s.update(0);
});
}
if(typeof document!=="undefined"){
const css=document.createElement("style");
css.textContent="#tb-live-badge{position:absolute;top:10px;left:10px;z-index:6;padding:4px 10px;border-radius:999px;font:600 13px/1.3 ui-monospace,monospace;background:#fff6e4;color:#3a2a22;border:2px solid #c4a574;pointer-events:none}#tb-live-badge.on{box-shadow:inset 4px 0 0 #2f7d4a}#tb-live-badge.off{box-shadow:inset 4px 0 0 #c4963a}#tb-back-card{position:absolute;inset:0;z-index:7;display:none;align-items:center;justify-content:center;background:rgba(48,36,24,.28)}#tb-back-card .panel{max-width:26em;padding:22px 26px 18px;background:#fff6e4;color:#3a2a22;border:3px solid #8a5a3a;border-radius:14px;box-shadow:0 12px 40px rgba(48,36,24,.28)}#tb-back-card h2{margin:0 0 8px;font:700 28px/1.2 Georgia,serif}#tb-back-card p{margin:0 0 8px;font:17px/1.45 Georgia,serif}";
if(document.head)document.head.appendChild(css);
}
let replayUrl=null;
try{replayUrl=new URLSearchParams(location.search).get("replay");}catch(e){}
if(replayUrl&&typeof fetch==="function"){
const start=function(){
fetch(replayUrl).then(function(r){return r.text();}).then(function(text){
const wait=function(){
if(window.TBArea&&TBArea.active&&TBArea.active())sessionOr().replay(text);
else setTimeout(wait,40);
};
wait();
}).catch(function(e){console.warn("tb replay",e);});
};
if(typeof window!=="undefined")start();
}
}
const api={
validateLive:validateLive,
createSession:createSession,
zoneRate:ZONE_RATE,
allow:ALLOW_DEFAULT,
route:function(m,f){return sessionOr().route(m,f);},
update:function(dt){sessionOr().update(dt);},
attach:function(c){sessionOr().attach(c);},
onArea:function(p,o){sessionOr().onArea(p,o);},
talk:function(id){sessionOr().talk(id);},
npcEvent:function(ev){sessionOr().npcEvent(ev);},
requestExit:function(info){sessionOr().requestExit(info);},
readyExtras:function(){return sessionOr().readyExtras();},
liveChosen:function(){return sessionOr().liveChosen();},
clock:function(){return sessionOr().clock();},
mode:function(){return sessionOr().mode();},
drops:function(){return sessionOr().drops();},
replay:function(t){sessionOr().replay(t);}
};
window.TBLive=api;
if(typeof window!=="undefined")boot();
})();
