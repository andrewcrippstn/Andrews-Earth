// ###########################################################################################
//  dino-egg/dino-egg.js   —   the DINOSAUR EASTER EGG ENGINE ("Dino Tracker")   [HEAVY: ~120 KB, read only if the task is about the egg]
//  Part of the optional  dino-egg/  folder that sits next to Andrew's Earth's index.html:
//      dino-sprites.js   images (heavy data)
//      dino-egg.js       this file: simulation, sounds, renderer, scenes. Defines  window.DinoEgg.
//      dino-ae-ui.js     the Andrew's Earth glue: panel UI, hotkey, host adapter, visible-region logic
//  Andrew's Earth runs fine without any of them. See dino-egg/README-AI.md for the contract with index.html.
//
//    HOW TO USE THE EGG IN A HOST APP (Andrew's Earth: Google Maps / Cesium / Leaflet)
//    - Load this file. It defines one global, `DinoEgg`. It needs no libraries. (Sprites come from dino-sprites.js.)
//    - Write a `host` adapter and call:   DinoEgg.init(host, {onAnnounce, onSceneStart, onFrame});
//        host.el            positioned (relative/absolute) element that contains the map. The egg appends a
//                           pointer-events:none <canvas id="dinoegg-canvas"> to it (z-index 450: above the map,
//                           below your UI). Put it above tiles but below menus.
//        host.getSize()     -> {x,y}  map size in CSS px
//        host.getZoom()     -> number, WEB-MERCATOR EQUIVALENT zoom (256 px tiles: metres/px = 156543*cos(lat)/2^zoom).
//                              For Cesium convert camera height to this scale.
//        host.getCenter()   -> {lat,lng}
//        host.makeView(now) -> {size:{x,y}, z, anim:boolean, mppOf(lat)->metres per px, proj({lat,lng})->{x,y} px,
//                             rect:{x0,y0,x1,y1} (optional) = the part of the map the user can SEE, in px. Return a
//                             smaller rect when panels cover the map: animals then enter, walk and leave inside it,
//                             and no scene starts if it is under ~220 px. Default = the whole map.
//                              relative to host.el's top-left}. Called every frame. If your map animates zoom,
//                              make proj/mppOf follow the animation (see the Leaflet example in the test harness).
//        host.setDragging(bool)  switch map panning off while the user holds an animal (optional but recommended)
//        host.shake(css)    optional camera tremor: set the map pane's CSS `translate` ('' resets)
//        host.ignoreTarget(el)   optional: true for map controls that must not grab animals
//    - Call  DinoEgg.touch()  on every map pan / zoom / wheel / key (but not for moves your own code makes) so the
//      "hold still for 3.5 s" timer restarts.
//    - Settings:  DinoEgg.set({autoTrigger:true, zoomTrigger:17, sceneType:'hunt'|'random'|'solo'|'herd'|'pack',
//                 displayScale:1.5, timeScale:3, gore:0..3, sound:true, remains:true, footprints:true, paused:false})
//    - Water / steep ground:  DinoEgg.setWalkable((lat,lng)=>boolean)  (return false for elevation <= 0).
//    - Remove it at runtime:  DinoEgg.destroy()  (removes canvas, listeners, timers and audio; init() can be called again).
//    - Egg DOM/CSS names are all prefixed `dinoegg-`. It adds window listeners (pointer/mouse/key/resize) and removes them in destroy().
//    - Sound is synthesised (no files). Browsers keep it silent until the user has clicked or pressed a key once.
//    - Idle cost: when no animals or marks exist the egg wakes ~5x/second only to watch for the zoom/pause trigger.
// ###########################################################################################

window.DinoEgg=(()=>{
'use strict';
const {dinoAssets,dinoSkeletons,SKEL_H}=window.DINO_EGG_SPRITES||{dinoAssets:{},dinoSkeletons:{},SKEL_H:{}};
/* DINO EASTER EGG sections: 1 species+sprites · 2 simulation · 3 effects · 4 audio · 5 renderer · 6 input · 7 scenes · 8 loop+API */
/* =====================================================================
   DINO EASTER EGG  ·  single-file prototype
   ---------------------------------------------------------------------
   1. constants, species, sprite preparation (cut-out limbs)
   2. simulation   (pure maths: metres / seconds / degrees, no Leaflet)
   3. effects      (blood, chunks, dust, decals)
   4. audio        (Web Audio, synthesised, no files, no permission prompt)
   5. renderer     (one canvas over the map, geo-anchored)
   6. map glue     (projection, zoom-animation tracking, pointer input)
   7. scenes + trigger + UI
   Integration seams for Andrew's Earth are marked  >>> PORT <<<
   ===================================================================== */
const D2R=Math.PI/180,R2D=180/Math.PI,TAU=Math.PI*2,M_PER_DEG=111320;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const rand=(a,b)=>a+Math.random()*(b-a);
const randInt=n=>Math.floor(Math.random()*n);
const pick=a=>a[randInt(a.length)];
const angDiff=(a,b)=>((b-a+540)%360)-180;
const hdgOf=(dx,dy)=>(Math.atan2(dx,dy)*R2D+360)%360;
const dirOf=h=>({x:Math.sin(h*D2R),y:Math.cos(h*D2R)});
const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const $=id=>document.getElementById(id);
const lerp=(a,b,t)=>a+(b-a)*t;

/* ---- tuning knobs ---- */
let host=null,opts={};   // host adapter + callbacks, supplied by init()
const IDLE_MS=3500;      // map must sit still this long to trigger a scene
let zoomTrigger=17;      // map zoom at or above which the easter egg may start (settable)
const PREY_ALERT=75, PREY_CALM=130;

/* >>> PORT <<<  ground test. Return false for water / too steep / elevation<=0.
   Andrew's Earth: look up elevation (cached coarse grid around the view). */
let walkableFn=null;     // (lat,lng)=>boolean ; null = everywhere is land

/* walk = km/h, run = sprint multiplier, stride = body lengths per full step cycle (visual),
   hip = where the hips sit along the sprite (0 head … 1 tail), flex = tail sweep (fraction of length)
   limbs: cut-out leg pieces {side,y0,y1 (rows 0..1),cut (inner edge, fraction of half width),ph,amp} */
const PI=Math.PI;
const SPECIES=[
 {id:'rex',name:'Tyrannosaurus rex',short:'T. rex',length:12,walk:3.2,run:3.4,stride:.17,hip:.50,flex:.05,pred:true,color:'#9a6845',
  limbs:[{side:-1,y0:0.43,y1:0.64,cut:0.52,ph:0,amp:0.2},{side:1,y0:0.43,y1:0.64,cut:0.52,ph:PI,amp:0.2}]},
 {id:'raptor',name:'Velociraptor',short:'Velociraptor',length:2,walk:8.4,run:2.2,stride:.35,hip:.42,flex:.08,pred:true,color:'#b58b52',
  limbs:[{side:-1,y0:0.39,y1:0.6,cut:0.28,ph:0,amp:0.22},{side:1,y0:0.39,y1:0.6,cut:0.28,ph:PI,amp:0.22}]},
 {id:'trike',name:'Triceratops',short:'Triceratops',length:9,walk:2.8,run:2.2,stride:.15,hip:.58,flex:.035,color:'#8b9870',
  limbs:[{side:-1,y0:0.24,y1:0.38,cut:0.78,ph:0,amp:0.16},{side:1,y0:0.24,y1:0.38,cut:0.78,ph:PI,amp:0.16},
         {side:-1,y0:0.57,y1:0.74,cut:0.6,ph:PI,amp:0.18},{side:1,y0:0.57,y1:0.74,cut:0.6,ph:0,amp:0.18}]},
 {id:'stego',name:'Stegosaurus',short:'Stegosaurus',length:9,walk:2.5,run:2.0,stride:.14,hip:.60,flex:.03,color:'#b77d4a',
  limbs:[{side:-1,y0:0.3,y1:0.42,cut:0.8,ph:0,amp:0.16},{side:1,y0:0.3,y1:0.42,cut:0.8,ph:PI,amp:0.16},
         {side:-1,y0:0.52,y1:0.67,cut:0.7,ph:PI,amp:0.16},{side:1,y0:0.52,y1:0.67,cut:0.7,ph:0,amp:0.16}]},
 {id:'brachio',name:'Brachiosaurus',short:'Brachiosaurus',length:22,walk:2.1,run:1.6,stride:.12,hip:.62,flex:.025,bend:.3,fsw:.25,fph:.5,color:'#8c9c83',
  limbs:[{side:-1,y0:0.33,y1:0.47,cut:0.72,ph:0,amp:0.14},{side:1,y0:0.33,y1:0.47,cut:0.72,ph:PI,amp:0.14},
         {side:-1,y0:0.56,y1:0.68,cut:0.66,ph:PI,amp:0.14},{side:1,y0:0.56,y1:0.68,cut:0.66,ph:0,amp:0.14}]},
 {id:'spino',name:'Spinosaurus',short:'Spinosaurus',length:15,walk:4.1,run:2.0,stride:.17,hip:.52,flex:.045,pred:true,color:'#98765b',
  limbs:[{side:-1,y0:.38,y1:.48,cut:.70,ph:PI,amp:.10},{side:1,y0:.38,y1:.48,cut:.70,ph:0,amp:.10},
         {side:-1,y0:.52,y1:.70,cut:.52,ph:0,amp:.18},{side:1,y0:.52,y1:.70,cut:.52,ph:PI,amp:.18}]}
];
const SP=id=>SPECIES.find(s=>s.id===id);

/* gore levels: spray droplets, meat chunks, pool size (× prey length), blood trail, bones, feeding blood */
const GORE=[
 {name:'Off',    spray:0,  chunk:0, pool:0,   trail:0, bones:false, feed:0},
 {name:'Mild',   spray:16, chunk:0, pool:.35, trail:0, bones:true,  feed:.3},
 {name:'Medium', spray:50, chunk:5, pool:.6,  trail:1, bones:true,  feed:.7},
 {name:'Extreme',spray:120,chunk:16,pool:.9,  trail:2, bones:true,  feed:1}
];
let goreLevel=3;

/* ---------- sprite preparation: body with leg pieces cut out ---------- */
const mkCanvas=(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c;};
function silhouette(c){const o=mkCanvas(c.width,c.height),x=o.getContext('2d');x.drawImage(c,0,0);x.globalCompositeOperation='source-in';x.fillStyle='#000';x.fillRect(0,0,o.width,o.height);return o;}
function prepSprite(sp,img){
  const W=img.naturalWidth,H=img.naturalHeight,hw=W/2;
  sp.W=W;sp.H=H;sp.ratio=W/H;
  const orig=mkCanvas(W,H);orig.getContext('2d').drawImage(img,0,0);
  const base=mkCanvas(W,H),bx=base.getContext('2d');bx.drawImage(orig,0,0);
  sp.pieces=[];
  for(const lb of sp.limbs){
    const inner=Math.round(lb.side<0?hw-lb.cut*hw:hw+lb.cut*hw);
    const x0=lb.side<0?0:inner,x1=lb.side<0?inner:W,y0=Math.round(lb.y0*H),y1=Math.round(lb.y1*H);
    const pw=x1-x0,ph=y1-y0; if(pw<4||ph<4)continue;
    const pc=mkCanvas(pw,ph),px=pc.getContext('2d');
    px.drawImage(orig,x0,y0,pw,ph,0,0,pw,ph);
    const fw=Math.min(8,pw*.4);                                   // feather the inner edge
    const g=lb.side<0?px.createLinearGradient(pw-fw,0,pw,0):px.createLinearGradient(0,0,fw,0);
    g.addColorStop(0,lb.side<0?'rgba(0,0,0,1)':'rgba(0,0,0,0)');g.addColorStop(1,lb.side<0?'rgba(0,0,0,0)':'rgba(0,0,0,1)');
    px.globalCompositeOperation='destination-in';px.fillStyle=g;px.fillRect(0,0,pw,ph);
    const fillW=Math.max(3,Math.round(hw*.16)),colX=lb.side<0?x1:x0-1,sx0=lb.side<0?x1-fillW:x0;
    const tmp=mkCanvas(fillW,ph),tx=tmp.getContext('2d');          // flank colour smear fills the hole
    tx.drawImage(base,colX,y0,1,ph,0,0,fillW,ph);
    tx.globalCompositeOperation='destination-in';tx.drawImage(orig,sx0,y0,fillW,ph,0,0,fillW,ph);
    bx.clearRect(x0,y0,pw,ph);bx.drawImage(tmp,sx0,y0);
    sp.pieces.push({img:pc,sh:silhouette(pc),x0,y0,pivX:lb.side<0?x1:x0,side:lb.side,ph:lb.ph,amp:lb.amp,w:pw,h:ph,k:sp.pieces.length});
  }
  sp.base=base;sp.shadow=silhouette(base);
}
function spriteSrc(id){return (typeof dinoAssets!=='undefined'&&dinoAssets&&dinoAssets[id])||'';}
const skelImg={};
function loadSkeletons(){for(const k in dinoSkeletons){const i=new Image();i.onload=()=>{skelImg[k]=i;};i.src=dinoSkeletons[k];}}
let spritesReady=false;
const spriteLoad=Promise.all(SPECIES.map(sp=>new Promise(res=>{
  const img=new Image();
  img.onload=()=>{try{prepSprite(sp,img);}catch(e){console.error('sprite',sp.id,e);}res();};
  img.onerror=()=>res();
  img.src=spriteSrc(sp.id);
}))).then(()=>{spritesReady=SPECIES.every(s=>s.base);});
loadSkeletons();

/* =====================================================================
   2. SIMULATION
   x = metres east of scene origin, y = metres north, heading 0° = north, clockwise
   ===================================================================== */
let displayScale=3, timeScale=3, paused=false;
let ACTOR_ID=0;
class Actor{
  constructor(sp,x,y,heading,role){
    Object.assign(this,{id:++ACTOR_ID,sp,x,y,heading,role,speed:0,targetSpeed:0,turnRate:0,phase:rand(0,TAU),gait:0,
      wander:0,state:'walk',timer:0,simT:0,stamina:60,slot:null,goal:null,leaving:false,
      dead:false,gone:false,rem:1,frozen:false,held:false,noticed:false,vol:0,fade:0,seen:false,
      jaw:0,jawT:0,headExt:0,headT:0,headShake:0,flail:0,curl:0,bloodAmt:0,limbK:[],kapS:0,
      sx:0,sy:0,hPx:0,wPx:0,hRad:0,vis:true,target:null,age:0,bobPh:0,shakePh:0,lastTrail:0,sc:null});
  }
  get walkMs(){return this.sp.walk/3.6;}
  get L(){return this.sp.length*displayScale;}
}
class Scene{
  constructor(type,origin){
    this.type=type;this.origin=origin;this.actors=[];this.particles=[];this.alpha=1;this.alphaT=1;
    this.age=0;this.unseenT=0;this.ended=false;this.status='';this.arenaR=60;this.goal=null;this.meet=null;this.meetDone=true;this.dir={x:0,y:1};this.boost=1;
    this.cosLat=Math.cos(origin.lat*D2R);
  }
  toLatLng(x,y){return {lat:this.origin.lat+y/M_PER_DEG,lng:this.origin.lng+x/(M_PER_DEG*this.cosLat)};}
}
let scenes=[];

function integrate(a,dt){
  const acc=a.walkMs*.7,dec=a.walkMs*1.5;
  a.speed+=clamp(a.targetSpeed-a.speed,-dec*dt,acc*dt);
  if(a.speed<.0005&&a.targetSpeed===0)a.speed=0;
  const h=a.heading*D2R,dx=Math.sin(h)*a.speed*dt,dy=Math.cos(h)*a.speed*dt;
  a.x+=dx;a.y+=dy;
  a.phase+=Math.hypot(dx,dy)/(a.L*a.sp.stride)*TAU;       // gait advances with distance → no foot skating
  const g=clamp(a.speed/a.walkMs,0,1.6);
  a.gait+=(g-a.gait)*(1-Math.exp(-dt*8));
  /* body curvature from turning, low-passed so long animals bend smoothly instead of snapping */
  const kT=clamp(a.turnRate*D2R/Math.max(a.speed,.25),-1/a.L,1/a.L);
  a.kapS+=(kT-a.kapS)*(1-Math.exp(-dt*(a.sp.length>15?.9:3)));
  if(a.gait>.2)detectSteps(a);
}
/* foot-plant events: footprints, dust, thud, tremor */
function detectSteps(a){
  const sp=a.sp;
  for(let i=0;i<sp.pieces.length;i++){
    const pc=sp.pieces[i],k=Math.floor((a.phase+pc.ph+1.5*PI)/TAU);
    if(a.limbK[i]===undefined){a.limbK[i]=k;continue;}
    if(k>a.limbK[i]){a.limbK[i]=k;onFootfall(a,pc);}
  }
}
function onFootfall(a,pc){
  const sc=a.sc;if(!sc)return;
  const sp=a.sp,L=a.L,h=a.heading*D2R,f={x:Math.sin(h),y:Math.cos(h)},r={x:Math.cos(h),y:-Math.sin(h)};
  const fx=(pc.x0+pc.w*(pc.side<0?.4:.6))/sp.W,fy=(pc.y0+pc.h*.9*(1-pc.amp*.4))/sp.H;
  const lx=(fx-.5)*L*sp.ratio,ly=(fy-.5)*L;
  const wx=a.x+r.x*lx-f.x*ly,wy=a.y+r.y*lx-f.y*ly;
  if(printsOn)addDecal({kind:'foot',sc,x:wx,y:wy,size:L*.05+.1,h:a.heading,life:25,quad:sp.limbs.length>2});
  if(L>=9){puff(sc,wx,wy,L*.03);if(a.vis&&a.hPx>60)tremor(clamp(L/22,.3,1)*.9);}
  sfx('step',a,.6);
}

function steerToward(a,desired,dt){
  if(walkableFn)desired=avoidBlocked(a,desired);
  const d=angDiff(a.heading,desired);
  const maxRate=Math.max(4,(a.speed/(a.L*1.1))*R2D);
  const want=clamp(d*2.5,-maxRate,maxRate);
  a.turnRate+=(want-a.turnRate)*(1-Math.exp(-dt*5));
  a.heading=(a.heading+a.turnRate*dt+360)%360;
}
/* look ahead for blocked ground and steer around it */
function avoidBlocked(a,desired){
  const sc=a.sc,L=a.L,ok=h=>{const d=dirOf(h);
    for(const k of [1,2.2]){const ll=sc.toLatLng(a.x+d.x*L*k,a.y+d.y*L*k);if(!walkableFn(ll.lat,ll.lng))return false;}return true;};
  if(ok(desired))return desired;
  for(const o of [35,-35,70,-70,110,-110,150,-150]){if(ok(desired+o))return desired+o;}
  return a.heading+180;
}
function wanderStep(a,dt){a.wander=clamp(a.wander+(Math.random()-.5)*dt*50,-30,30)*(1-dt*.3);}
function separation(a,list){
  let sx=0,sy=0;
  for(const b of list){if(b===a||b.dead||b.gone)continue;
    const dx=a.x-b.x,dy=a.y-b.y,d=Math.hypot(dx,dy),min=(a.L+b.L)*.5*.9;
    if(d<min&&d>.01){const k=(min-d)/min;sx+=dx/d*k;sy+=dy/d*k;}}
  return {x:sx,y:sy};
}
function followSlot(a,Ld,slot,dt,list){
  const f=dirOf(Ld.heading),r={x:f.y,y:-f.x};
  const sx=Ld.x+(f.x*slot[0]+r.x*slot[1])*displayScale,sy=Ld.y+(f.y*slot[0]+r.y*slot[1])*displayScale;
  const ex=sx-a.x,ey=sy-a.y,d=Math.hypot(ex,ey),w=clamp(d/20,0,1);
  const tx=d>.01?ex/d:f.x,ty=d>.01?ey/d:f.y,sep=separation(a,list);
  steerToward(a,hdgOf(f.x*(1-w)+tx*w+sep.x*1.5,f.y*(1-w)+ty*w+sep.y*1.5),dt);
  const along=ex*f.x+ey*f.y;
  a.targetSpeed=clamp(Ld.speed+along*.25,0,a.walkMs*Math.max(1.8,(a.sc?a.sc.boost:1)*1.4));
}
const toGoal=(a,g)=>hdgOf(g.x-a.x,g.y-a.y);
function arenaPull(sc,a,desired){
  /* near the edge of the arena, run along it (tangentially, slightly inward) instead of out of it,
     so the chase stays in front of the viewer */
  const R=sc.arenaR,r=Math.hypot(a.x,a.y);
  if(r<R*.6)return desired;
  const w=clamp((r-R*.6)/(R*.35),0,1),hc=hdgOf(-a.x,-a.y);
  const t1=hc+90,t2=hc-90,tan=Math.abs(angDiff(desired,t1))<Math.abs(angDiff(desired,t2))?t1:t2;
  const target=tan+angDiff(tan,hc)*.3;
  return desired+angDiff(desired,target)*w;
}
function leaveGoal(a){const f=dirOf(a.heading);a.goal={x:a.x+f.x*700,y:a.y+f.y*700};a.leaving=true;}

/* ---------- scene behaviours ---------- */
function behaveSolo(sc,dt){
  const a=sc.actors[0];if(!a||a.gone)return;
  if(a.frozen){a.targetSpeed=0;return;}
  a.timer-=dt;
  if(a.timer<=0){
    if(a.state==='walk'&&Math.random()<.3){a.state='idle';a.timer=rand(3,6);}
    else if(a.state==='walk')a.timer=rand(10,25);
    else{a.state='walk';a.timer=rand(15,30);}
  }
  wanderStep(a,dt);
  a.targetSpeed=a.state==='idle'?0:a.walkMs;
  steerToward(a,toGoal(a,sc.goal)+a.wander*.6,dt);
  sc.status=a.state==='idle'?a.sp.short+' is resting':a.sp.short+' is wandering through';
}
function behaveHerd(sc,dt){
  const live=sc.actors.filter(a=>!a.gone),free=live.filter(a=>!a.frozen);
  for(const a of live){if(a.frozen)a.targetSpeed=0;}
  if(!free.length)return;
  /* the leader is the first animal that is not being held, so holding one animal (even the leader)
     only stops that animal; the rest of the pack/herd carries on */
  const lead=free.includes(sc.actors[0])?sc.actors[0]:free[0];
  wanderStep(lead,dt);
  lead.targetSpeed=Math.min(...free.map(a=>a.walkMs))*.95;
  steerToward(lead,toGoal(lead,sc.goal)+lead.wander*.5,dt);
  for(const a of free){if(a===lead)continue;followSlot(a,lead,a.slot||[-20,0],dt,free);}
  sc.status=sc.type==='pack'?'Raptor pack on the move':'Herd travelling through';
}
function behaveHunt(sc,dt,rdt){
  const pred=sc.pred,ds=displayScale;
  const live=sc.preys.filter(p=>!p.dead&&!p.gone&&p.state!=='seized');
  let tgt=pred.target;
  if(!tgt||!live.includes(tgt))tgt=pred.target=live.reduce((m,b)=>!m||dist(pred,b)<dist(pred,m)?b:m,null);
  const dT=tgt?dist(pred,tgt):1e9,predL=pred.L,catchD=tgt?(predL+tgt.L)*.3:0;

  if(!pred.frozen&&!pred.gone){
    pred.jaw+=(pred.jawT-pred.jaw)*(1-Math.exp(-rdt*10));
    pred.headExt+=(pred.headT-pred.headExt)*(1-Math.exp(-rdt*8));
    switch(pred.state){
      case 'stalk':{
        if(!tgt){pred.state='leave';leaveGoal(pred);break;}
        pred.simT+=dt;
        if(sc.meet&&!sc.meetDone){
          /* opening of the hunt: the prey is crossing the map, the predator times its approach so they meet mid-map */
          const dm=dist(pred,sc.meet),tp=dist(tgt,sc.meet)/Math.max(.3,tgt.speed);
          const passed=((tgt.x-sc.meet.x)*sc.dir.x+(tgt.y-sc.meet.y)*sc.dir.y)>0;
          if(dm<25||passed)sc.meetDone=true;
          else{
            steerToward(pred,toGoal(pred,sc.meet),dt);
            pred.targetSpeed=clamp(dm/Math.max(tp,1),pred.walkMs*.6,pred.walkMs*pred.sp.run*1.1*sc.boost);
            if(dT<110){pred.state='sprint';pred.simT=0;pred.stamina=150;}
            else if(pred.simT>600){pred.state='leave';leaveGoal(pred);}
            sc.status=pred.sp.short+' stalking its prey';break;
          }
        }
        steerToward(pred,toGoal(pred,tgt),dt);pred.targetSpeed=pred.walkMs*1.3;
        if(pred.simT>10||dT<110){pred.state='sprint';pred.simT=0;pred.stamina=150;}
        sc.status=pred.sp.short+' stalking its prey';break;}
      case 'sprint':{
        if(!tgt){pred.state='leave';leaveGoal(pred);break;}
        const sp=pred.walkMs*pred.sp.run,lead=clamp(dT/sp,0,5)*.6,td=dirOf(tgt.heading);
        steerToward(pred,hdgOf(tgt.x+td.x*tgt.speed*lead-pred.x,tgt.y+td.y*tgt.speed*lead-pred.y),dt);
        pred.targetSpeed=sp;pred.stamina-=dt;
        if(dT<catchD*1.45){pred.state='lunge';pred.timer=0;sfx('roar',pred,1);}
        else if(pred.stamina<=0){pred.state='rest';pred.simT=0;}
        sc.status=dT<40?pred.sp.short+' closing in!':pred.sp.short+' chasing · '+Math.round(dT)+' m';break;}
      case 'lunge':
        pred.timer+=rdt;pred.jawT=1;pred.headT=1;
        if(!tgt){pred.state='leave';leaveGoal(pred);break;}
        steerToward(pred,toGoal(pred,tgt),dt);pred.targetSpeed=pred.walkMs*pred.sp.run*1.35;
        if(dT<catchD)doBite(sc,pred,tgt);
        else if(pred.timer>.9){pred.state='sprint';pred.jawT=0;pred.headT=0;}
        sc.status='Strike!';break;
      case 'shake':{
        pred.timer+=rdt;pred.targetSpeed=0;pred.shakePh+=rdt*26;
        pred.headShake=Math.sin(pred.shakePh);pred.jawT=.35;pred.headT=.25;
        const held=sc.hunted;
        if(held){held.flail=Math.sin(pred.shakePh*.8)*35;
          if(Math.floor(pred.timer*10)!==Math.floor((pred.timer-rdt)*10))bloodBurst(sc,pred,.18,held);}
        if(pred.timer>1.5){
          pred.headShake=0;
          if(goreLevel===0&&held){held.gone=true;puff(sc,held.x,held.y,2.5);nextAfterKill(sc,pred);}
          else{pred.state='drag';pred.timer=0;}
        }
        sc.status=pred.sp.short+' shaking its kill';break;}
      case 'drag':{
        pred.timer+=rdt;pred.headShake*=.9;pred.jawT=.2;pred.headT=.1;
        steerToward(pred,pred.heading+Math.sin(pred.timer*2)*18,dt);pred.targetSpeed=pred.walkMs*.8;
        const held=sc.hunted;
        if(held&&GORE[goreLevel].trail&&pred.timer-pred.lastTrail>.18){pred.lastTrail=pred.timer;
          addDecal({kind:'splat',sc,x:held.x+rand(-.5,.5),y:held.y+rand(-.5,.5),size:rand(.2,.5)*GORE[goreLevel].trail,h:0,life:150});}
        if(pred.timer>2.6){
          if(held){held.dead=true;held.state='carcass';held.speed=0;held.targetSpeed=0;held.flail=0;held.bloodAmt=1;held.heading=(pred.heading+90)%360;
            if(GORE[goreLevel].pool)addDecal({kind:'pool',sc,x:held.x,y:held.y,size:held.sp.length*displayScale*GORE[goreLevel].pool*.5,h:0,life:260});}
          pred.state='feed';pred.timer=0;pred.targetSpeed=0;
        }
        sc.status=pred.sp.short+' dragging its kill';break;}
      case 'feed':{
        pred.timer+=rdt;pred.targetSpeed=0;pred.headShake=0;
        const held=sc.hunted,prev=pred.bobPh;pred.bobPh+=rdt*7;
        const s=Math.sin(pred.bobPh);pred.headT=.45+.4*s;pred.jawT=s>.2?.5:.05;
        if(Math.floor(pred.bobPh/PI)!==Math.floor(prev/PI)&&s>=0===false){ // each head-lift tears off a mouthful
          if(held&&held.dead){held.rem=Math.max(.15,held.rem-.075);tearBite(sc,pred,held);}
        }
        if(pred.timer>11){
          if(held){held.gone=true;
            if(GORE[goreLevel].bones)addDecal({kind:'bones',sc,x:held.x,y:held.y,size:held.sp.length*displayScale,h:held.heading,life:200,sp:held.sp});}
          sfx('roar',pred,.9);nextAfterKill(sc,pred);
        }
        sc.status=pred.sp.short+' is feeding';break;}
      case 'rest':
        pred.targetSpeed=0;pred.jawT=0;pred.headT=0;pred.simT+=dt;
        if(pred.simT>20){pred.state='stalk';pred.simT=0;}
        sc.status=pred.sp.short+' catching its breath · prey escaped';break;
      case 'leave':
        for(const p of sc.preys)if(!p.dead&&!p.gone&&p.state!=='seized'&&!p.leaving)leaveGoal(p);   // survivors drift off too
        steerToward(pred,toGoal(pred,pred.goal),dt);pred.targetSpeed=pred.walkMs*1.1;pred.jawT=0;pred.headT=0;
        sc.status=pred.sp.short+' wanders off';break;
    }
  }else if(pred.frozen){pred.targetSpeed=0;}

  const predActive=['stalk','sprint','lunge'].includes(pred.state);
  for(const p of sc.preys){
    if(p.dead||p.gone||p.state==='seized')continue;
    if(p.frozen){p.targetSpeed=0;continue;}
    if(p.leaving){steerToward(p,toGoal(p,p.goal),dt);p.targetSpeed=p.walkMs*1.2;continue;}
    const d=dist(pred,p);
    if(p.state!=='flee'&&predActive&&d<PREY_ALERT){p.state='flee';p.stamina=70;}
    else if(p.state==='flee'&&(d>PREY_CALM||!predActive))p.state='walk';
    if(p.state==='flee'){
      p.stamina-=dt;const tire=p.stamina>0?1:.5;
      const away=hdgOf(p.x-pred.x,p.y-pred.y)+Math.sin(simClock*.5+p.phase)*25;
      steerToward(p,arenaPull(sc,p,away),dt);p.targetSpeed=p.walkMs*p.sp.run*tire;
    }else if(p===sc.preys[0]||sc.preys[0].dead||sc.preys[0].gone||sc.preys[0].leaving){
      /* unaware prey walks straight across the map; if it makes it to the far side it keeps walking off */
      wanderStep(p,dt);steerToward(p,toGoal(p,sc.goal)+p.wander*.3,dt);p.targetSpeed=p.walkMs*sc.boost;
      /* prey never leave while the predator is still hunting: at the end of the walk (or at the edge of the visible map) they turn round */
      const atEnd=dist(p,sc.goal)<30*ds||(p.seen&&!p.vis&&p.age>5&&simClock-(p.turnAt||-99)>6);
      if(atEnd){
        if(pred.state==='leave'||pred.gone)leaveGoal(p);
        else{p.turnAt=simClock;sc.goal=sc.goal===sc.goalFar?sc.goalNear:sc.goalFar;}
      }
    }else followSlot(p,sc.preys[0],p.slot||[-14,-16],dt,sc.preys);
  }
}
function doBite(sc,pred,tgt){
  tgt.state='seized';tgt.targetSpeed=0;tgt.speed*=.2;tgt.bloodAmt=.5;
  sc.hunted=tgt;pred.state='shake';pred.timer=0;pred.targetSpeed=0;pred.speed*=.3;pred.shakePh=0;
  bloodBurst(sc,pred,1,tgt);
  sfx('crunch',pred,1);sfx('roar',pred,.7);tremor(3.2);
}
/* after a kill: hunt the next animal that is still on screen, otherwise wander off */
function nextAfterKill(sc,pred){
  pred.jawT=0;pred.headT=0;pred.headShake=0;
  const left=sc.preys.filter(p=>!p.dead&&!p.gone&&p.state!=='seized'&&!p.leaving);   // the predator always goes on to the second prey
  if(left.length){sc.meetDone=true;pred.state='stalk';pred.simT=0;pred.timer=0;pred.target=null;pred.stamina=150;return;}
  pred.state='leave';leaveGoal(pred);
}
/* seized prey hangs across the predator's jaws */
function attachSeized(sc){
  const pred=sc.pred,held=sc.hunted;
  if(!held||held.dead||held.gone||!['shake','drag'].includes(pred.state))return;
  const f=dirOf(pred.heading),off=pred.L*.5+held.L*.06;
  held.x=pred.x+f.x*off;held.y=pred.y+f.y*off;held.heading=(pred.heading+90+held.flail+360)%360;
  held.speed=0;
}
const simClock0=0;let simClock=0;

function stepScene(sc,dt,rdt){
  sc.age+=rdt;
  if(sc.type==='solo')behaveSolo(sc,dt);
  else if(sc.type==='herd'||sc.type==='pack')behaveHerd(sc,dt);
  else if(sc.type==='hunt')behaveHunt(sc,dt,rdt);
  for(const a of sc.actors){
    if(a.gone)continue;
    a.age+=rdt;a.fade=Math.min(1,a.fade+rdt*1.2);
    if(a.noticed)a.vol=Math.min(1,a.vol+rdt/1.5);
    if(a.dead){a.speed=0;a.gait=0;continue;}
    if(a.state==='seized'){a.gait=0;continue;}
    integrate(a,dt);
  }
  if(sc.type==='hunt')attachSeized(sc);
}
function stepSim(dt){
  const n=Math.max(1,Math.ceil(dt/.05)),h=dt/n;
  for(let i=0;i<n;i++){
    simClock+=h;
    for(const sc of scenes)stepScene(sc,h,h/timeScale);
  }
}

/* =====================================================================
   3. EFFECTS: particles (per scene) + decals (geo-anchored, outlive the scene)
   ===================================================================== */
const decals=[];
let remainsOn=true,printsOn=true;
const BLOOD=['bones','pool','splat','chunk'];
function clearDecals(kinds){for(let i=decals.length-1;i>=0;i--)if(!kinds||kinds.includes(decals[i].kind))decals.splice(i,1);}
function addDecal(o){
  o.ll=o.sc.toLatLng(o.x,o.y);o.born=performance.now()/1000;o.sc=null;
  if(o.kind==='pool'){o.lobes=[{a:0,d:0,r:.62}];for(let i=0;i<7;i++)o.lobes.push({a:rand(0,TAU),d:rand(.25,.6),r:rand(.28,.5)});}
  decals.push(o);
  while(decals.length>800){            // evict small stuff first so bones and pools survive
    let i=decals.findIndex(d=>d.kind==='foot'||d.kind==='splat'||d.kind==='chunk');
    decals.splice(i<0?0:i,1);
  }
}
function pushP(sc,p){if(sc.particles.length<500)sc.particles.push(p);}
function puff(sc,x,y,size){pushP(sc,{type:'dust',x,y,z:0,vx:rand(-.4,.4),vy:rand(-.4,.4),vz:0,life:rand(.7,1.1),max:1,size:size||.8});}
/* arterial spray + droplets thrown from the bite point */
function bloodBurst(sc,pred,k,prey){
  const G=GORE[goreLevel];if(!G.spray)return;
  const f=dirOf(pred.heading),off=pred.L*.5,x=pred.x+f.x*off,y=pred.y+f.y*off,n=Math.round(G.spray*k);
  for(let i=0;i<n;i++){
    const h=(pred.heading+rand(-95,95))*D2R,s=rand(2,10)*(.5+k*.7);
    pushP(sc,{type:'drop',x,y,z:rand(.3,1.2),vx:Math.sin(h)*s,vy:Math.cos(h)*s,vz:rand(1.5,6),life:3,max:3,size:rand(.08,.22)});
  }
  for(let i=0,c=Math.round(G.chunk*k);i<c;i++){
    const h=rand(0,TAU),s=rand(2,7);
    pushP(sc,{type:'chunk',x,y,z:.6,vx:Math.sin(h)*s,vy:Math.cos(h)*s,vz:rand(2,6),life:4,max:4,size:rand(.25,.55),bounce:0});
  }
  if(G.pool&&k>=.9)addDecal({kind:'pool',sc,x,y,size:prey.L*G.pool*.28,h:0,life:260});
}
function tearBite(sc,pred,carcass){
  const G=GORE[goreLevel];sfx('tear',pred,.9);
  if(!G.feed)return;
  const f=dirOf(pred.heading),off=pred.L*.52;
  const x=pred.x+f.x*off,y=pred.y+f.y*off;
  for(let i=0,n=Math.round(30*G.feed);i<n;i++){
    const h=(pred.heading+rand(-70,70))*D2R,s=rand(1,6);
    pushP(sc,{type:'drop',x,y,z:.5,vx:Math.sin(h)*s,vy:Math.cos(h)*s,vz:rand(1,4),life:2.5,max:2.5,size:rand(.08,.2)});
  }
  for(let i=0,c=Math.round(G.chunk*.3);i<c;i++){
    const h=(pred.heading+rand(-80,80))*D2R,s=rand(2,6);
    pushP(sc,{type:'chunk',x,y,z:.5,vx:Math.sin(h)*s,vy:Math.cos(h)*s,vz:rand(2,5),life:4,max:4,size:rand(.25,.5),bounce:0});
  }
  const pool=decals.findLast?decals.findLast(d=>d.kind==='pool'):null;
  if(pool&&G.pool)pool.size=Math.min(pool.size*1.06,carcass.L*G.pool*.8);
}
function updParticles(sc,rdt){
  const ps=sc.particles;
  for(let i=ps.length-1;i>=0;i--){
    const q=ps[i];q.life-=rdt;if(q.life<=0){ps.splice(i,1);continue;}
    q.x+=q.vx*rdt;q.y+=q.vy*rdt;
    if(q.type==='dust'){q.size+=rdt*1.6;continue;}
    q.vz-=14*rdt;q.z+=q.vz*rdt;
    if(q.z<=0){
      q.z=0;
      if(q.type==='drop'){if(Math.random()<.5)addDecal({kind:'splat',sc,x:q.x,y:q.y,size:q.size*rand(1,2),h:0,life:140});ps.splice(i,1);}
      else if(q.type==='chunk'){
        if(q.bounce<1){q.bounce++;q.vz=-q.vz*.35;q.vx*=.5;q.vy*=.5;}
        else{addDecal({kind:'chunk',sc,x:q.x,y:q.y,size:q.size,h:rand(0,360),life:70});addDecal({kind:'splat',sc,x:q.x,y:q.y,size:q.size*1.5,h:0,life:140});ps.splice(i,1);}
      }
    }
  }
}

/* camera tremor (rex footfalls, bites). Shakes the whole map element a hair. */
let tremorAmp=0;
let mapEl=null;
function tremor(a){tremorAmp=Math.min(4,Math.max(tremorAmp,a));}
function applyTremor(rdt){
  if(tremorAmp>.06){
    const t=`${((Math.random()-.5)*2*tremorAmp).toFixed(2)}px ${((Math.random()-.5)*2*tremorAmp).toFixed(2)}px`;
    if(host.shake)host.shake(t);cv.style.translate=t;tremorAmp*=Math.exp(-rdt*10);
  }else if(tremorAmp!==0){tremorAmp=0;if(host.shake)host.shake('');cv.style.translate='';}
}

/* =====================================================================
   4. AUDIO — synthesised. No files, no permission prompt. Browsers keep audio silent
   until the page has had one click / tap / key press (dragging the map counts).
   ===================================================================== */
/* Sound lab engines: every species has its own synthesised footstep / eating / roar.
   They are scheduled onto a per-event bus (distance low-pass + stereo pan + reverb send) so the
   same voice sounds big and close or small and far depending on where the animal is on screen. */
let audioCtx=null,noiseBuffer=null,dryGain=null,convolver=null;
const params={massScale:1};
        /**
 * Generates a stereo algorithmic impulse response simulating a vast Mesozoic valley.
 */
function createCanyonImpulseResponse(duration, decay) {
    const rate = audioCtx.sampleRate;
    const length = Math.floor(rate * duration);
    const impulse = audioCtx.createBuffer(2, length, rate);

    for (let channel = 0; channel < 2; channel++) {
        const data = impulse.getChannelData(channel);
        for (let i = 0; i < length; i++) {
            const t = i / rate;
            // Early discrete reflections + exponential diffuse tail
            let env = Math.pow(1 - i / length, decay);
            if (t < 0.12 && Math.random() < 0.04) env *= 1.8;
            // Low-pass air absorption over time
            const airDamping = Math.exp(-t * 1.4);
            data[i] = (Math.random() * 2 - 1) * env * airDamping;
        }
    }
    return impulse;
}

/**
 * Creates a reusable white noise buffer for transient snaps, breath, water, and foliage.
 */
function createNoiseBuffer(seconds) {
    const length = Math.floor(audioCtx.sampleRate * seconds);
    const buffer = audioCtx.createBuffer(1, length, audioCtx.sampleRate);
    const output = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
        output[i] = Math.random() * 2 - 1;
    }
    return buffer;
}

/**
 * Helper: Organic variation multiplier around 1.0 (±variance).
 */
function vary(base, variance = 0.08) {
    return base * (1 + (Math.random() * 2 - 1) * variance);
}

/**
 * Helper: Pitch multiplier adjusted by the user's Body Mass Scale slider.
 * Larger mass = lower fundamental frequencies.
 */
function scaleFreq(freq, variance = 0.06) {
    return vary(freq, variance) / params.massScale;
}

/**
 * Helper: Connects any node to both the dry bus and the canyon reverb send.
 */
function routeToMaster(node, reverbSendMultiplier = 1.0) {
    node.connect(dryGain);
    if (reverbSendMultiplier > 0) {
        const send = audioCtx.createGain();
        send.gain.value = reverbSendMultiplier;
        node.connect(send);
        send.connect(convolver);
    }
}

/**
 * Helper: Creates a soft-clipping waveshaper curve for vocal fold grit and saturation.
 */
function createDistortionCurve(amount = 25) {
    const samples = 44100;
    const curve = new Float32Array(samples);
    const deg = Math.PI / 180;
    for (let i = 0; i < samples; ++i) {
        const x = (i * 2) / samples - 1;
        curve[i] = ((3 + amount) * x * 20 * deg) / (Math.PI + amount * Math.abs(x));
    }
    return curve;
}

/**
 * Helper: Plays a filtered noise burst with custom envelope.
 */
function triggerNoiseBurst({
    startTime,
    duration,
    filterType = 'bandpass',
    freqStart = 1000,
    freqEnd = 600,
    Q = 1.5,
    gainPeak = 0.5,
    attack = 0.01,
    reverbSend = 0.7
}) {
    const src = audioCtx.createBufferSource();
    src.buffer = noiseBuffer;
    src.loop = true;
    // Random offset in noise buffer so every trigger has unique micro-texture
    const offset = Math.random() * (noiseBuffer.duration - 0.5);

    const filter = audioCtx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.setValueAtTime(Math.max(20, freqStart), startTime);
    filter.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), startTime + duration);
    filter.Q.setValueAtTime(Q, startTime);

    const env = audioCtx.createGain();
    env.gain.setValueAtTime(0.0001, startTime);
    env.gain.linearRampToValueAtTime(gainPeak, startTime + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    src.connect(filter);
    filter.connect(env);
    routeToMaster(env, reverbSend);

    src.start(startTime, offset, duration + 0.05);
    src.stop(startTime + duration + 0.06);
}


const SynthEngines = {
    // ------------------------------------------------------------------------
    // 1. TYRANNOSAURUS REX
    // ------------------------------------------------------------------------
    trex: {
        footstep(t) {
            // Massive tectonic sub-bass drop
            const subOsc = audioCtx.createOscillator();
            const subGain = audioCtx.createGain();
            subOsc.type = 'sine';
            subOsc.frequency.setValueAtTime(scaleFreq(72, 0.07), t);
            subOsc.frequency.exponentialRampToValueAtTime(scaleFreq(22, 0.05), t + 0.45);

            subGain.gain.setValueAtTime(0.001, t);
            subGain.gain.linearRampToValueAtTime(1.15, t + 0.018);
            subGain.gain.exponentialRampToValueAtTime(0.001, t + 0.85);

            subOsc.connect(subGain);
            routeToMaster(subGain, 1.1);
            subOsc.start(t);
            subOsc.stop(t + 0.9);

            // Heavy chest/ground thump body
            const bodyOsc = audioCtx.createOscillator();
            const bodyGain = audioCtx.createGain();
            bodyOsc.type = 'triangle';
            bodyOsc.frequency.setValueAtTime(scaleFreq(125, 0.08), t);
            bodyOsc.frequency.exponentialRampToValueAtTime(scaleFreq(34, 0.06), t + 0.25);

            bodyGain.gain.setValueAtTime(0.001, t);
            bodyGain.gain.linearRampToValueAtTime(0.7, t + 0.01);
            bodyGain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);

            bodyOsc.connect(bodyGain);
            routeToMaster(bodyGain, 0.8);
            bodyOsc.start(t);
            bodyOsc.stop(t + 0.4);

            // Dirt & gravel compression crunch
            triggerNoiseBurst({
                startTime: t,
                duration: 0.38,
                filterType: 'lowpass',
                freqStart: vary(950, 0.15),
                freqEnd: vary(180, 0.1),
                Q: 1.2,
                gainPeak: 0.55,
                attack: 0.015,
                reverbSend: 0.9
            });
        },

        eating(t) {
            // 1. Heavy jaw slam transient
            const jawOsc = audioCtx.createOscillator();
            const jawGain = audioCtx.createGain();
            jawOsc.type = 'sine';
            jawOsc.frequency.setValueAtTime(scaleFreq(180, 0.1), t);
            jawOsc.frequency.exponentialRampToValueAtTime(scaleFreq(45, 0.08), t + 0.12);
            jawGain.gain.setValueAtTime(0.85, t);
            jawGain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
            jawOsc.connect(jawGain);
            routeToMaster(jawGain, 0.5);
            jawOsc.start(t);
            jawOsc.stop(t + 0.16);

            // 2. Crisp bone fracture bursts (multiple micro-cracks)
            const crackTimes = [0.02, 0.09, 0.19, 0.28];
            crackTimes.forEach((offset, idx) => {
                triggerNoiseBurst({
                    startTime: t + offset,
                    duration: vary(0.07, 0.2),
                    filterType: 'bandpass',
                    freqStart: vary(2400 - idx * 250, 0.15),
                    freqEnd: vary(900, 0.15),
                    Q: 3.5,
                    gainPeak: vary(0.65, 0.15),
                    attack: 0.003,
                    reverbSend: 0.4
                });
            });

            // 3. Wet sinew & flesh tearing rip
            triggerNoiseBurst({
                startTime: t + 0.16,
                duration: vary(0.55, 0.12),
                filterType: 'bandpass',
                freqStart: vary(650, 0.12),
                freqEnd: vary(1450, 0.15),
                Q: 2.2,
                gainPeak: 0.52,
                attack: 0.06,
                reverbSend: 0.45
            });
        },

        roar(t) {
            const dur = vary(2.6, 0.08);
            // Primary vocal fold sawtooth + sub-harmonic octave
            const osc1 = audioCtx.createOscillator();
            const osc2 = audioCtx.createOscillator();
            const subOsc = audioCtx.createOscillator();

            // Laryngeal vocal fold FM flutter (guttural rasp)
            const fmOsc = audioCtx.createOscillator();
            const fmGain = audioCtx.createGain();
            fmOsc.type = 'sine';
            fmOsc.frequency.setValueAtTime(vary(34, 0.1), t);
            fmOsc.frequency.linearRampToValueAtTime(vary(24, 0.1), t + dur);
            fmGain.gain.setValueAtTime(vary(28, 0.15), t);
            fmGain.gain.exponentialRampToValueAtTime(8, t + dur);

            const baseF = scaleFreq(96, 0.07);
            osc1.type = 'sawtooth';
            osc2.type = 'sawtooth';
            subOsc.type = 'sine';

            // Pitch contour: rapid attack swell, sustained bellow, deep tail drop
            [osc1, osc2].forEach((osc, i) => {
                const detune = i === 0 ? 1.0 : 1.018;
                osc.frequency.setValueAtTime(baseF * 0.72 * detune, t);
                osc.frequency.exponentialRampToValueAtTime(baseF * 1.28 * detune, t + 0.28);
                osc.frequency.exponentialRampToValueAtTime(baseF * 0.85 * detune, t + dur * 0.75);
                osc.frequency.exponentialRampToValueAtTime(baseF * 0.48 * detune, t + dur);
            });

            subOsc.frequency.setValueAtTime(baseF * 0.45, t);
            subOsc.frequency.exponentialRampToValueAtTime(baseF * 0.62, t + 0.3);
            subOsc.frequency.exponentialRampToValueAtTime(baseF * 0.28, t + dur);

            fmOsc.connect(fmGain);
            fmGain.connect(osc1.frequency);
            fmGain.connect(osc2.frequency);

            // Waveshaper for roaring vocal cord saturation
            const shaper = audioCtx.createWaveShaper();
            shaper.curve = createDistortionCurve(35);

            // Parallel Vocal Tract Formants (Open-jaw throat resonance)
            const f1 = audioCtx.createBiquadFilter();
            f1.type = 'bandpass';
            f1.Q.value = 3.2;
            f1.frequency.setValueAtTime(scaleFreq(220), t);
            f1.frequency.exponentialRampToValueAtTime(scaleFreq(380), t + 0.35);
            f1.frequency.exponentialRampToValueAtTime(scaleFreq(180), t + dur);

            const f2 = audioCtx.createBiquadFilter();
            f2.type = 'bandpass';
            f2.Q.value = 4.0;
            f2.frequency.setValueAtTime(scaleFreq(580), t);
            f2.frequency.exponentialRampToValueAtTime(scaleFreq(890), t + 0.3);
            f2.frequency.exponentialRampToValueAtTime(scaleFreq(420), t + dur);

            const masterEnv = audioCtx.createGain();
            masterEnv.gain.setValueAtTime(0.001, t);
            masterEnv.gain.linearRampToValueAtTime(0.85, t + 0.18);
            masterEnv.gain.setValueAtTime(0.8, t + dur * 0.55);
            masterEnv.gain.exponentialRampToValueAtTime(0.001, t + dur);

            osc1.connect(shaper);
            osc2.connect(shaper);
            shaper.connect(f1);
            shaper.connect(f2);
            f1.connect(masterEnv);
            f2.connect(masterEnv);
            subOsc.connect(masterEnv);

            routeToMaster(masterEnv, 1.25);

            // Exhale air blast noise
            triggerNoiseBurst({
                startTime: t + 0.05,
                duration: dur * 0.9,
                filterType: 'bandpass',
                freqStart: scaleFreq(600),
                freqEnd: scaleFreq(260),
                Q: 1.4,
                gainPeak: 0.35,
                attack: 0.2,
                reverbSend: 1.1
            });

            [osc1, osc2, subOsc, fmOsc].forEach(o => {
                o.start(t);
                o.stop(t + dur + 0.05);
            });
        }
    },

    // ------------------------------------------------------------------------
    // 2. VELOCIRAPTOR
    // ------------------------------------------------------------------------
    velociraptor: {
        footstep(t) {
            // Rapid 3-step agile scurry with sickle-claw clicks
            const steps = [0, vary(0.11, 0.15), vary(0.22, 0.15)];
            steps.forEach((offset, idx) => {
                const st = t + offset;
                // Light pad thud
                const osc = audioCtx.createOscillator();
                const gain = audioCtx.createGain();
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(scaleFreq(220, 0.1), st);
                osc.frequency.exponentialRampToValueAtTime(scaleFreq(85, 0.1), st + 0.05);
                gain.gain.setValueAtTime(0.32 - idx * 0.04, st);
                gain.gain.exponentialRampToValueAtTime(0.001, st + 0.06);
                osc.connect(gain);
                routeToMaster(gain, 0.45);
                osc.start(st);
                osc.stop(st + 0.07);

                // Sharp keratin claw tap on stone/dirt
                triggerNoiseBurst({
                    startTime: st,
                    duration: 0.035,
                    filterType: 'highpass',
                    freqStart: vary(3200, 0.15),
                    freqEnd: vary(1800, 0.15),
                    Q: 2.5,
                    gainPeak: 0.42,
                    attack: 0.002,
                    reverbSend: 0.5
                });
            });
        },

        eating(t) {
            // Snappy dual beak/jaw clicks + rapid flesh stripping
            [0, 0.14].forEach((offset) => {
                const st = t + offset;
                triggerNoiseBurst({
                    startTime: st,
                    duration: 0.045,
                    filterType: 'bandpass',
                    freqStart: vary(2800, 0.15),
                    freqEnd: vary(1100, 0.15),
                    Q: 4.5,
                    gainPeak: 0.65,
                    attack: 0.001,
                    reverbSend: 0.4
                });
            });

            // Quick jerky tear
            triggerNoiseBurst({
                startTime: t + 0.18,
                duration: vary(0.32, 0.15),
                filterType: 'bandpass',
                freqStart: vary(1200, 0.15),
                freqEnd: vary(2600, 0.15),
                Q: 2.8,
                gainPeak: 0.48,
                attack: 0.03,
                reverbSend: 0.45
            });
        },

        roar(t) {
            // Piercing avian/reptilian shriek followed by a sharp pack bark
            const dur = vary(0.95, 0.1);
            const carrier = audioCtx.createOscillator();
            const mod = audioCtx.createOscillator();
            const modGain = audioCtx.createGain();

            carrier.type = 'sawtooth';
            mod.type = 'sine';

            const startF = scaleFreq(780, 0.08);
            const peakF = scaleFreq(1580, 0.09);
            const endF = scaleFreq(540, 0.08);

            carrier.frequency.setValueAtTime(startF, t);
            carrier.frequency.exponentialRampToValueAtTime(peakF, t + 0.14);
            carrier.frequency.exponentialRampToValueAtTime(peakF * 0.88, t + 0.45);
            carrier.frequency.exponentialRampToValueAtTime(endF, t + dur);

            // High-frequency syrinx rasp modulation
            mod.frequency.setValueAtTime(vary(68, 0.12), t);
            mod.frequency.linearRampToValueAtTime(vary(42, 0.12), t + dur);
            modGain.gain.setValueAtTime(vary(160, 0.15), t);
            modGain.gain.exponentialRampToValueAtTime(25, t + dur);

            mod.connect(modGain);
            modGain.connect(carrier.frequency);

            const bandpass = audioCtx.createBiquadFilter();
            bandpass.type = 'bandpass';
            bandpass.Q.value = 3.8;
            bandpass.frequency.setValueAtTime(scaleFreq(1450), t);
            bandpass.frequency.exponentialRampToValueAtTime(scaleFreq(2200), t + 0.2);
            bandpass.frequency.exponentialRampToValueAtTime(scaleFreq(1100), t + dur);

            const env = audioCtx.createGain();
            env.gain.setValueAtTime(0.001, t);
            env.gain.linearRampToValueAtTime(0.68, t + 0.05);
            env.gain.exponentialRampToValueAtTime(0.001, t + dur);

            carrier.connect(bandpass);
            bandpass.connect(env);
            routeToMaster(env, 0.95);

            // Airy hiss layer
            triggerNoiseBurst({
                startTime: t,
                duration: dur * 0.85,
                filterType: 'bandpass',
                freqStart: scaleFreq(2900),
                freqEnd: scaleFreq(1800),
                Q: 2.2,
                gainPeak: 0.35,
                attack: 0.04,
                reverbSend: 0.8
            });

            carrier.start(t);
            mod.start(t);
            carrier.stop(t + dur + 0.02);
            mod.stop(t + dur + 0.02);
        }
    },

    // ------------------------------------------------------------------------
    // 3. TRICERATOPS
    // ------------------------------------------------------------------------
    triceratops: {
        footstep(t) {
            // Heavy, dense 4-legged column stomp
            const sub = audioCtx.createOscillator();
            const subGain = audioCtx.createGain();
            sub.type = 'sine';
            sub.frequency.setValueAtTime(scaleFreq(84, 0.06), t);
            sub.frequency.exponentialRampToValueAtTime(scaleFreq(26, 0.05), t + 0.36);

            subGain.gain.setValueAtTime(0.001, t);
            subGain.gain.linearRampToValueAtTime(1.05, t + 0.015);
            subGain.gain.exponentialRampToValueAtTime(0.001, t + 0.65);

            sub.connect(subGain);
            routeToMaster(subGain, 0.95);
            sub.start(t);
            sub.stop(t + 0.7);

            // Earth thud noise
            triggerNoiseBurst({
                startTime: t,
                duration: 0.32,
                filterType: 'lowpass',
                freqStart: vary(750, 0.12),
                freqEnd: vary(140, 0.1),
                Q: 1.5,
                gainPeak: 0.55,
                attack: 0.01,
                reverbSend: 0.8
            });
        },

        eating(t) {
            // 1. Sharp keratin beak shear snapping woody cycad branches
            triggerNoiseBurst({
                startTime: t,
                duration: 0.08,
                filterType: 'bandpass',
                freqStart: vary(1950, 0.15),
                freqEnd: vary(750, 0.15),
                Q: 3.2,
                gainPeak: 0.68,
                attack: 0.004,
                reverbSend: 0.45
            });

            // 2. Rhythmic dental battery grinding (3 heavy jaw chews)
            [0.14, 0.34, 0.54].forEach((offset) => {
                triggerNoiseBurst({
                    startTime: t + offset,
                    duration: 0.15,
                    filterType: 'bandpass',
                    freqStart: vary(620, 0.12),
                    freqEnd: vary(980, 0.12),
                    Q: 2.6,
                    gainPeak: 0.45,
                    attack: 0.025,
                    reverbSend: 0.35
                });
            });
        },

        roar(t) {
            // Deep brassy nasal horn bellow
            const dur = vary(2.1, 0.08);
            const osc1 = audioCtx.createOscillator();
            const osc2 = audioCtx.createOscillator();
            osc1.type = 'sawtooth';
            osc2.type = 'square';

            const baseF = scaleFreq(82, 0.06);
            osc1.frequency.setValueAtTime(baseF * 0.85, t);
            osc1.frequency.linearRampToValueAtTime(baseF * 1.15, t + 0.35);
            osc1.frequency.exponentialRampToValueAtTime(baseF * 0.72, t + dur);

            osc2.frequency.setValueAtTime(baseF * 0.5, t);
            osc2.frequency.linearRampToValueAtTime(baseF * 0.58, t + 0.35);
            osc2.frequency.exponentialRampToValueAtTime(baseF * 0.36, t + dur);

            const shaper = audioCtx.createWaveShaper();
            shaper.curve = createDistortionCurve(20);

            // Nasal chamber resonant formants (brassy trombone/elk-like character)
            const nasal1 = audioCtx.createBiquadFilter();
            nasal1.type = 'bandpass';
            nasal1.Q.value = 5.5;
            nasal1.frequency.setValueAtTime(scaleFreq(290), t);
            nasal1.frequency.linearRampToValueAtTime(scaleFreq(410), t + 0.4);
            nasal1.frequency.exponentialRampToValueAtTime(scaleFreq(240), t + dur);

            const nasal2 = audioCtx.createBiquadFilter();
            nasal2.type = 'bandpass';
            nasal2.Q.value = 6.0;
            nasal2.frequency.setValueAtTime(scaleFreq(720), t);
            nasal2.frequency.linearRampToValueAtTime(scaleFreq(960), t + 0.4);
            nasal2.frequency.exponentialRampToValueAtTime(scaleFreq(580), t + dur);

            const env = audioCtx.createGain();
            env.gain.setValueAtTime(0.001, t);
            env.gain.linearRampToValueAtTime(0.78, t + 0.22);
            env.gain.exponentialRampToValueAtTime(0.001, t + dur);

            osc1.connect(shaper);
            osc2.connect(shaper);
            shaper.connect(nasal1);
            shaper.connect(nasal2);
            nasal1.connect(env);
            nasal2.connect(env);

            routeToMaster(env, 1.15);

            osc1.start(t);
            osc2.start(t);
            osc1.stop(t + dur + 0.03);
            osc2.stop(t + dur + 0.03);
        }
    },

    // ------------------------------------------------------------------------
    // 4. STEGOSAURUS
    // ------------------------------------------------------------------------
    stegosaurus: {
        footstep(t) {
            // Steady herbivore thud
            const sub = audioCtx.createOscillator();
            const subGain = audioCtx.createGain();
            sub.type = 'sine';
            sub.frequency.setValueAtTime(scaleFreq(92, 0.07), t);
            sub.frequency.exponentialRampToValueAtTime(scaleFreq(32, 0.06), t + 0.32);

            subGain.gain.setValueAtTime(0.001, t);
            subGain.gain.linearRampToValueAtTime(0.85, t + 0.015);
            subGain.gain.exponentialRampToValueAtTime(0.001, t + 0.52);

            sub.connect(subGain);
            routeToMaster(subGain, 0.85);
            sub.start(t);
            sub.stop(t + 0.55);

            // Subtle hollow keratin dermal plate rattle on stride
            [0.04, 0.13].forEach((offset, idx) => {
                const plateOsc = audioCtx.createOscillator();
                const plateGain = audioCtx.createGain();
                plateOsc.type = 'triangle';
                plateOsc.frequency.setValueAtTime(scaleFreq(410 - idx * 65, 0.12), t + offset);
                plateOsc.frequency.exponentialRampToValueAtTime(scaleFreq(220, 0.1), t + offset + 0.06);

                plateGain.gain.setValueAtTime(0.14, t + offset);
                plateGain.gain.exponentialRampToValueAtTime(0.001, t + offset + 0.07);

                plateOsc.connect(plateGain);
                routeToMaster(plateGain, 0.5);
                plateOsc.start(t + offset);
                plateOsc.stop(t + offset + 0.08);
            });
        },

        eating(t) {
            // Soft leafy fern stripping + wet rhythmic chewing
            triggerNoiseBurst({
                startTime: t,
                duration: 0.38,
                filterType: 'bandpass',
                freqStart: vary(1600, 0.15),
                freqEnd: vary(2400, 0.15),
                Q: 1.8,
                gainPeak: 0.45,
                attack: 0.04,
                reverbSend: 0.4
            });

            [0.25, 0.46].forEach((offset) => {
                triggerNoiseBurst({
                    startTime: t + offset,
                    duration: 0.16,
                    filterType: 'lowpass',
                    freqStart: vary(900, 0.12),
                    freqEnd: vary(420, 0.12),
                    Q: 2.0,
                    gainPeak: 0.38,
                    attack: 0.03,
                    reverbSend: 0.3
                });
            });
        },

        roar(t) {
            // Low throaty groan followed by a breathy defensive snort
            const dur = vary(1.65, 0.08);
            const osc = audioCtx.createOscillator();
            const fm = audioCtx.createOscillator();
            const fmGain = audioCtx.createGain();

            osc.type = 'sawtooth';
            fm.type = 'sine';

            const baseF = scaleFreq(74, 0.07);
            osc.frequency.setValueAtTime(baseF * 0.9, t);
            osc.frequency.linearRampToValueAtTime(baseF * 1.12, t + 0.4);
            osc.frequency.exponentialRampToValueAtTime(baseF * 0.65, t + dur);

            fm.frequency.value = vary(22, 0.15);
            fmGain.gain.value = 14;
            fm.connect(fmGain);
            fmGain.connect(osc.frequency);

            const filter = audioCtx.createBiquadFilter();
            filter.type = 'bandpass';
            filter.Q.value = 3.4;
            filter.frequency.setValueAtTime(scaleFreq(260), t);
            filter.frequency.linearRampToValueAtTime(scaleFreq(340), t + 0.4);
            filter.frequency.exponentialRampToValueAtTime(scaleFreq(190), t + dur);

            const env = audioCtx.createGain();
            env.gain.setValueAtTime(0.001, t);
            env.gain.linearRampToValueAtTime(0.68, t + 0.25);
            env.gain.exponentialRampToValueAtTime(0.001, t + dur);

            osc.connect(filter);
            filter.connect(env);
            routeToMaster(env, 1.0);

            // Breathy nostril snort at end
            triggerNoiseBurst({
                startTime: t + dur * 0.65,
                duration: 0.42,
                filterType: 'bandpass',
                freqStart: scaleFreq(820),
                freqEnd: scaleFreq(380),
                Q: 2.0,
                gainPeak: 0.45,
                attack: 0.04,
                reverbSend: 0.85
            });

            osc.start(t);
            fm.start(t);
            osc.stop(t + dur + 0.02);
            fm.stop(t + dur + 0.02);
        }
    },

    // ------------------------------------------------------------------------
    // 5. BRACHIOSAURUS
    // ------------------------------------------------------------------------
    brachiosaurus: {
        footstep(t) {
            // Colossal 48-ton seismic shockwave
            const sub = audioCtx.createOscillator();
            const subGain = audioCtx.createGain();
            sub.type = 'sine';
            sub.frequency.setValueAtTime(scaleFreq(58, 0.05), t);
            sub.frequency.exponentialRampToValueAtTime(scaleFreq(18, 0.04), t + 0.65);

            subGain.gain.setValueAtTime(0.001, t);
            subGain.gain.linearRampToValueAtTime(1.25, t + 0.03);
            subGain.gain.exponentialRampToValueAtTime(0.001, t + 1.35);

            sub.connect(subGain);
            routeToMaster(subGain, 1.35);
            sub.start(t);
            sub.stop(t + 1.4);

            // Deep earth displacement rumble
            triggerNoiseBurst({
                startTime: t,
                duration: 0.75,
                filterType: 'lowpass',
                freqStart: vary(420, 0.1),
                freqEnd: vary(85, 0.08),
                Q: 1.2,
                gainPeak: 0.65,
                attack: 0.03,
                reverbSend: 1.2
            });
        },

        eating(t) {
            // High canopy branch rustle + deep resonant throat swallow
            triggerNoiseBurst({
                startTime: t,
                duration: 0.55,
                filterType: 'bandpass',
                freqStart: vary(2200, 0.15),
                freqEnd: vary(1300, 0.15),
                Q: 1.4,
                gainPeak: 0.42,
                attack: 0.08,
                reverbSend: 0.7
            });

            // Massive esophagus gulp/swallow
            const gulpOsc = audioCtx.createOscillator();
            const gulpGain = audioCtx.createGain();
            gulpOsc.type = 'sine';
            const gt = t + 0.42;
            gulpOsc.frequency.setValueAtTime(scaleFreq(145, 0.08), gt);
            gulpOsc.frequency.exponentialRampToValueAtTime(scaleFreq(52, 0.08), gt + 0.32);

            gulpGain.gain.setValueAtTime(0.001, gt);
            gulpGain.gain.linearRampToValueAtTime(0.55, gt + 0.06);
            gulpGain.gain.exponentialRampToValueAtTime(0.001, gt + 0.38);

            gulpOsc.connect(gulpGain);
            routeToMaster(gulpGain, 0.65);
            gulpOsc.start(gt);
            gulpOsc.stop(gt + 0.4);
        },

        roar(t) {
            // Long, melancholic, whale-like nasal crest trumpet
            const dur = vary(3.4, 0.07);
            const osc1 = audioCtx.createOscillator();
            const osc2 = audioCtx.createOscillator();
            const sub = audioCtx.createOscillator();

            osc1.type = 'triangle';
            osc2.type = 'sawtooth';
            sub.type = 'sine';

            const baseF = scaleFreq(118, 0.05);
            // Graceful rising and falling resonant contour
            [osc1, osc2].forEach((osc, i) => {
                const mult = i === 0 ? 1.0 : 1.006;
                osc.frequency.setValueAtTime(baseF * 0.75 * mult, t);
                osc.frequency.exponentialRampToValueAtTime(baseF * 1.45 * mult, t + dur * 0.35);
                osc.frequency.exponentialRampToValueAtTime(baseF * 1.15 * mult, t + dur * 0.7);
                osc.frequency.exponentialRampToValueAtTime(baseF * 0.58 * mult, t + dur);
            });

            sub.frequency.setValueAtTime(baseF * 0.38, t);
            sub.frequency.exponentialRampToValueAtTime(baseF * 0.72, t + dur * 0.35);
            sub.frequency.exponentialRampToValueAtTime(baseF * 0.29, t + dur);

            // Nasal dome chamber resonant filters
            const dome1 = audioCtx.createBiquadFilter();
            dome1.type = 'bandpass';
            dome1.Q.value = 6.5;
            dome1.frequency.setValueAtTime(scaleFreq(240), t);
            dome1.frequency.exponentialRampToValueAtTime(scaleFreq(460), t + dur * 0.35);
            dome1.frequency.exponentialRampToValueAtTime(scaleFreq(210), t + dur);

            const dome2 = audioCtx.createBiquadFilter();
            dome2.type = 'bandpass';
            dome2.Q.value = 5.0;
            dome2.frequency.setValueAtTime(scaleFreq(520), t);
            dome2.frequency.exponentialRampToValueAtTime(scaleFreq(880), t + dur * 0.35);
            dome2.frequency.exponentialRampToValueAtTime(scaleFreq(410), t + dur);

            const osc2Gain = audioCtx.createGain();
            osc2Gain.gain.value = 0.35; // Soften sawtooth harmonics for warm horn timbre

            const env = audioCtx.createGain();
            env.gain.setValueAtTime(0.001, t);
            env.gain.linearRampToValueAtTime(0.82, t + 0.45);
            env.gain.setValueAtTime(0.76, t + dur * 0.65);
            env.gain.exponentialRampToValueAtTime(0.001, t + dur);

            osc1.connect(dome1);
            osc2.connect(osc2Gain);
            osc2Gain.connect(dome1);
            osc2Gain.connect(dome2);
            sub.connect(env);
            dome1.connect(env);
            dome2.connect(env);

            routeToMaster(env, 1.45);

            [osc1, osc2, sub].forEach(o => {
                o.start(t);
                o.stop(t + dur + 0.05);
            });
        }
    },

    // ------------------------------------------------------------------------
    // 6. SPINOSAURUS
    // ------------------------------------------------------------------------
    spinosaurus: {
        footstep(t) {
            // Heavy riverbank mud thud + water splash
            const sub = audioCtx.createOscillator();
            const subGain = audioCtx.createGain();
            sub.type = 'sine';
            sub.frequency.setValueAtTime(scaleFreq(78, 0.07), t);
            sub.frequency.exponentialRampToValueAtTime(scaleFreq(26, 0.06), t + 0.38);

            subGain.gain.setValueAtTime(0.001, t);
            subGain.gain.linearRampToValueAtTime(0.95, t + 0.015);
            subGain.gain.exponentialRampToValueAtTime(0.001, t + 0.65);

            sub.connect(subGain);
            routeToMaster(subGain, 0.95);
            sub.start(t);
            sub.stop(t + 0.7);

            // Wet water splash spray
            triggerNoiseBurst({
                startTime: t + 0.02,
                duration: vary(0.48, 0.15),
                filterType: 'bandpass',
                freqStart: vary(1800, 0.15),
                freqEnd: vary(650, 0.15),
                Q: 1.1,
                gainPeak: 0.58,
                attack: 0.02,
                reverbSend: 0.95
            });
        },

        eating(t) {
            // Hollow elongated snout jaw clap + fish scale/bone crunch
            const clapOsc = audioCtx.createOscillator();
            const clapGain = audioCtx.createGain();
            clapOsc.type = 'triangle';
            clapOsc.frequency.setValueAtTime(scaleFreq(340, 0.09), t);
            clapOsc.frequency.exponentialRampToValueAtTime(scaleFreq(95, 0.08), t + 0.09);

            clapGain.gain.setValueAtTime(0.75, t);
            clapGain.gain.exponentialRampToValueAtTime(0.001, t + 0.11);
            clapOsc.connect(clapGain);
            routeToMaster(clapGain, 0.6);
            clapOsc.start(t);
            clapOsc.stop(t + 0.12);

            // Crisp conical tooth snap & wet splash
            triggerNoiseBurst({
                startTime: t,
                duration: 0.06,
                filterType: 'bandpass',
                freqStart: vary(2600, 0.12),
                freqEnd: vary(1200, 0.12),
                Q: 4.0,
                gainPeak: 0.72,
                attack: 0.002,
                reverbSend: 0.5
            });

            triggerNoiseBurst({
                startTime: t + 0.12,
                duration: 0.34,
                filterType: 'bandpass',
                freqStart: vary(1400, 0.15),
                freqEnd: vary(750, 0.15),
                Q: 2.0,
                gainPeak: 0.45,
                attack: 0.02,
                reverbSend: 0.65
            });
        },

        roar(t) {
            // Crocodilian-meets-theropod hollow tubular snout bellow
            const dur = vary(2.35, 0.08);
            const osc1 = audioCtx.createOscillator();
            const sub = audioCtx.createOscillator();
            const fm = audioCtx.createOscillator();
            const fmGain = audioCtx.createGain();

            osc1.type = 'sawtooth';
            sub.type = 'sine';
            fm.type = 'triangle';

            const baseF = scaleFreq(68, 0.07);
            osc1.frequency.setValueAtTime(baseF * 0.85, t);
            osc1.frequency.exponentialRampToValueAtTime(baseF * 1.22, t + 0.3);
            osc1.frequency.exponentialRampToValueAtTime(baseF * 0.74, t + dur);

            sub.frequency.setValueAtTime(baseF * 0.48, t);
            sub.frequency.exponentialRampToValueAtTime(baseF * 0.62, t + 0.3);
            sub.frequency.exponentialRampToValueAtTime(baseF * 0.36, t + dur);

            // Deep crocodilian water-dance rumble modulation (18Hz)
            fm.frequency.setValueAtTime(vary(19, 0.12), t);
            fmGain.gain.setValueAtTime(vary(24, 0.15), t);
            fm.connect(fmGain);
            fmGain.connect(osc1.frequency);

            const shaper = audioCtx.createWaveShaper();
            shaper.curve = createDistortionCurve(42);

            // Narrow elongated rostrum resonant tube filter
            const snoutTube = audioCtx.createBiquadFilter();
            snoutTube.type = 'bandpass';
            snoutTube.Q.value = 6.2;
            snoutTube.frequency.setValueAtTime(scaleFreq(310), t);
            snoutTube.frequency.exponentialRampToValueAtTime(scaleFreq(470), t + 0.35);
            snoutTube.frequency.exponentialRampToValueAtTime(scaleFreq(245), t + dur);

            const chestFormant = audioCtx.createBiquadFilter();
            chestFormant.type = 'bandpass';
            chestFormant.Q.value = 3.0;
            chestFormant.frequency.setValueAtTime(scaleFreq(150), t);

            const env = audioCtx.createGain();
            env.gain.setValueAtTime(0.001, t);
            env.gain.linearRampToValueAtTime(0.84, t + 0.2);
            env.gain.exponentialRampToValueAtTime(0.001, t + dur);

            osc1.connect(shaper);
            shaper.connect(snoutTube);
            shaper.connect(chestFormant);
            snoutTube.connect(env);
            chestFormant.connect(env);
            sub.connect(env);

            routeToMaster(env, 1.25);

            [osc1, sub, fm].forEach(o => {
                o.start(t);
                o.stop(t + dur + 0.04);
            });
        }
    }
};

const SND_ID={rex:'trex',raptor:'velociraptor',trike:'triceratops',stego:'stegosaurus',brachio:'brachiosaurus',spino:'spinosaurus'};
const Snd={ctx:null,master:null,dry:null,conv:null,muted:false,last:-99,lastStep:0,
  unlock(){
    if(this.ctx){if(this.ctx.state==='suspended')this.ctx.resume();return;}
    try{
      const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return;
      const c=this.ctx=audioCtx=new AC(),t=c.currentTime;
      const comp=c.createDynamicsCompressor();comp.threshold.setValueAtTime(-14,t);comp.knee.setValueAtTime(18,t);comp.ratio.setValueAtTime(6,t);comp.attack.setValueAtTime(.004,t);comp.release.setValueAtTime(.22,t);
      const m=this.master=c.createGain();m.gain.value=0;comp.connect(m);m.connect(c.destination);
      this.dry=c.createGain();this.dry.connect(comp);
      const wet=c.createGain();wet.gain.value=.38;wet.connect(comp);
      this.conv=c.createConvolver();this.conv.buffer=createCanyonImpulseResponse(2.8,2.4);this.conv.connect(wet);
      noiseBuffer=createNoiseBuffer(4);
    }catch(e){this.ctx=audioCtx=null;}
  },
  ready(){return !!this.ctx&&this.ctx.state==='running'&&!this.muted;},
  wake(){ /* first sound after a quiet spell ramps up instead of popping in */
    const c=this.ctx,t=c.currentTime,g=this.master.gain;g.cancelScheduledValues(t);
    if(t-this.last>12){g.setValueAtTime(.0001,t);g.linearRampToValueAtTime(.9,t+1);}else g.setTargetAtTime(.9,t,.1);
    this.last=t;
  },
  /* sp: species id, action: footstep|eating|roar, vol 0..1+, pan -1..1, mass pitch scale, near = on screen */
  play(sp,action,vol,pan,mass,near){
    const c=this.ctx,eng=SynthEngines[SND_ID[sp]];if(!eng||!eng[action])return;
    this.wake();
    const dryIn=c.createGain(),revIn=c.createGain(),lp=c.createBiquadFilter(),g=c.createGain();
    g.gain.value=vol;lp.type='lowpass';lp.frequency.value=near?16000:900;lp.Q.value=.3;
    dryIn.connect(lp);lp.connect(g);
    let out=g;if(c.createStereoPanner){const p=c.createStereoPanner();p.pan.value=pan;g.connect(p);out=p;}
    out.connect(this.dry);
    const rg=c.createGain();rg.gain.value=near?vol:vol*1.6;revIn.connect(rg);rg.connect(this.conv);
    const sd=dryGain,sc=convolver;dryGain=dryIn;convolver=revIn;params.massScale=mass;
    try{eng[action](c.currentTime+.01);}catch(e){console.error('snd',sp,action,e);}
    dryGain=sd;convolver=sc;
  }
};
const SND_UNLOCK_EVENTS=['pointerdown','pointerup','keydown','touchend','click'];   // bound in init() so destroy() can undo it
/* Event -> sound.  footfall: species footstep.  bite / tear / feeding: species "eating" (the T. rex's is the
   bone-and-flesh crunch).  lunge, kill and noticing an animal: species roar (quieter when it is only saying hello).
   step / call / growl are "ambient" and only play once you have noticed that dinosaur (hover, tap or hold);
   roar / crunch / tear are hunt events and always play. */
const SND_ACTION={step:'footstep',crunch:'eating',tear:'eating',roar:'roar',call:'roar',growl:'roar',hover:'roar'};
const SND_GAIN={step:1,crunch:1,tear:.8,roar:1,call:.55,growl:.5,hover:.85};
const SND_GAP={step:0,crunch:.25,tear:.5,roar:2.5,call:5,growl:5,hover:4};      // minimum seconds between repeats per animal
const HUNT_SFX={roar:1,crunch:1,tear:1,hover:1};
function sfx(kind,a,k=1){
  if(!Snd.ready()||!a)return;
  if(!HUNT_SFX[kind]&&!a.noticed)return;
  const now=performance.now();
  if(kind==='step'){if(now-Snd.lastStep<70)return;Snd.lastStep=now;}
  const gap=SND_GAP[kind]*1000,T=a.sfxT||(a.sfxT={});
  if(gap&&now-(T[kind]||-1e9)<gap)return;
  const sz=clamp(a.L/12,.35,1.8),W=view?view.size.x:800;
  let vol=k*Math.pow(sz,.35)*(a.vis?1:.2);
  if(!HUNT_SFX[kind])vol*=a.vol;
  vol*=SND_GAIN[kind]||1;
  if(vol<.02)return;
  T[kind]=now;
  Snd.play(a.sp.id,SND_ACTION[kind],vol*.9,clamp((a.sx-W/2)/(W/2),-1,1)||0,clamp(a.L/a.sp.length,.75,1.35),!!a.vis);
}

/* =====================================================================
   5. RENDERER  (one canvas over the map; everything is geo-anchored)
   ===================================================================== */
let cv=null,ctx=null;
let view=null,dpr=1,tint=mkCanvas(8,8),shadowCv=mkCanvas(8,8);
function resizeCanvas(){
  const s=mapEl.getBoundingClientRect();dpr=Math.min(2,window.devicePixelRatio||1);
  cv.width=Math.max(1,Math.round(s.width*dpr));cv.height=Math.max(1,Math.round(s.height*dpr));
  cv.style.width=s.width+'px';cv.style.height=s.height+'px';
}

/* body: strips sheared along a flexing spine + cut-out legs that foreshorten as they step */
function drawBody(c,a,Hpx,Wpx,shadow,mpp){
  const sp=a.sp,src=shadow?sp.shadow:sp.base,W=sp.W,H=sp.H,L=a.L,N=26,g=Math.min(a.gait,1.2);
  const wavA=L*sp.flex*g/mpp,kap=a.kapS*(sp.bend||1),hip=sp.hip,fsw=sp.fsw===undefined?1:sp.fsw,fph=sp.fph||1;
  const hs=a.headShake*Hpx*.045,curl=a.curl*Hpx*.3;
  const d=t=>{
    let o=0;
    if(wavA){o+=t>hip?wavA*Math.pow((t-hip)/(1-hip),1.3)*Math.sin(a.phase-(t-hip)*4):
                  -wavA*.45*fsw*Math.pow((hip-t)/hip,1.6)*Math.sin(a.phase*fph);}
    const ds=(t-hip)*L;o+=.5*kap*ds*ds/mpp;
    if(hs&&t<.3){const u=(.3-t)/.3;o+=hs*u*u;}
    if(curl)o+=curl*Math.sin(t*PI);
    if(a.flail)o+=a.flail*.012*Hpx*Math.sin(t*PI*1.5);
    return o;};
  const ye=t=>(a.headExt&&t<.28)?-a.headExt*Hpx*.06*Math.pow((.28-t)/.28,1.5):0;
  const yAt=t=>-Hpx/2+t*Hpx+ye(t);
  let pt=0,py=yAt(0),pd=d(0);
  for(let i=1;i<=N;i++){
    const t=i/N,y=yAt(t),dd=d(t),h=y-py,sk=(dd-pd)/Math.max(.001,h);
    c.save();c.transform(1,0,sk,1,pd-sk*py,0);
    c.drawImage(src,0,pt*H,W,(t-pt)*H,-Wpx/2,py,Wpx,h+.8);
    c.restore();pt=t;py=y;pd=dd;
  }
  for(const pc of sp.pieces){
    const t=pc.y0/H,x=(pc.pivX/W-.5)*Wpx+d(t),y=yAt(t),e=.01,ang=-Math.atan2(d(t+e)-d(t-e),2*e*Hpx);
    const u=a.phase+pc.ph,s=1-pc.amp*Math.sin(u)*g,lift=1+.05*Math.max(0,Math.cos(u))*g;
    c.save();c.translate(x,y);c.rotate(ang);c.scale(Wpx/W*lift,Hpx/H*s);
    c.drawImage(shadow?pc.sh:pc.img,pc.x0-pc.pivX,0);c.restore();
  }
}
function drawJaw(c,a,Hpx,Wpx){
  if(a.jaw<.05||!a.sp.pred)return;
  const j=a.jaw,hw=Wpx*.075,ext=-a.headExt*Hpx*.06,y=-Hpx/2+ext;
  c.save();c.translate(a.headShake*Hpx*.045,y);
  c.fillStyle='rgba(95,12,16,.95)';c.beginPath();c.ellipse(0,-Hpx*.012*j,hw*(.5+.5*j),Hpx*.03*j,0,0,TAU);c.fill();
  c.fillStyle='rgba(235,225,200,.95)';
  for(let i=-2;i<=2;i++){if(!i)continue;c.beginPath();c.moveTo(i*hw*.32,-Hpx*.005*j);c.lineTo(i*hw*.32+hw*.09,-Hpx*.027*j);c.lineTo(i*hw*.32-hw*.09,-Hpx*.027*j);c.fill();}
  c.restore();
}
function drawActor(a,sc,v){
  const sp=a.sp,ll=sc.toLatLng(a.x,a.y),p=v.proj(ll),mpp=v.mppOf(ll.lat),L=a.L,Hpx=L/mpp,Wpx=Hpx*sp.ratio;
  a.sx=p.x;a.sy=p.y;a.hPx=Hpx;a.wPx=Wpx;a.hRad=a.heading*D2R;a.mpp=mpp;
  const m=Hpx*.7+20,R=v.rect||{x0:0,y0:0,x1:v.size.x,y1:v.size.y};   // R = part of the map the user can actually see
  a.vis=p.x>R.x0-m&&p.y>R.y0-m&&p.x<R.x1+m&&p.y<R.y1+m;
  if(a.vis)a.seen=true;
  if(!a.vis||Hpx<2.5)return;
  const alpha=sc.alpha*a.fade;if(alpha<.01)return;
  const sxs=a.dead?.6+.4*a.rem:1,sys=a.dead?.7+.3*a.rem:1;
  /* soft ground shadow (sun from the north-west). Drawn opaque to a scratch canvas, then
     composited once at low alpha so the strip seams never double up. */
  {const R=Math.ceil(Hpx*.75+10);
   if(R<1000){if(shadowCv.width!==R*2){shadowCv.width=R*2;shadowCv.height=R*2;}
     const t=shadowCv.getContext('2d');t.setTransform(1,0,0,1,0,0);t.clearRect(0,0,R*2,R*2);t.translate(R,R);t.rotate(a.hRad);t.scale(sxs,sys);
     drawBody(t,a,Hpx,Wpx,true,mpp);
     ctx.globalAlpha=.3*alpha;ctx.drawImage(shadowCv,p.x+Hpx*.03-R,p.y+Hpx*.045-R);}}
  ctx.globalAlpha=alpha;
  const blood=a.bloodAmt>0&&goreLevel>0;
  if(blood&&Hpx<1100){
    const R=Math.ceil(Hpx*.75+10);if(tint.width!==R*2){tint.width=R*2;tint.height=R*2;}
    const t=tint.getContext('2d');t.setTransform(1,0,0,1,0,0);t.clearRect(0,0,R*2,R*2);t.translate(R,R);t.scale(sxs,sys);
    drawBody(t,a,Hpx,Wpx,false,mpp);
    t.setTransform(1,0,0,1,0,0);t.globalCompositeOperation='source-atop';t.fillStyle=`rgba(130,4,8,${.55*a.bloodAmt})`;t.fillRect(0,0,R*2,R*2);
    t.globalCompositeOperation='source-over';
    ctx.save();ctx.translate(p.x,p.y);ctx.rotate(a.hRad);ctx.drawImage(tint,-R,-R);ctx.restore();
  }else{
    ctx.save();ctx.translate(p.x,p.y);ctx.rotate(a.hRad);ctx.scale(sxs,sys);drawBody(ctx,a,Hpx,Wpx,false,mpp);ctx.restore();
  }
  ctx.save();ctx.translate(p.x,p.y);ctx.rotate(a.hRad);drawJaw(ctx,a,Hpx,Wpx);ctx.restore();
  ctx.globalAlpha=1;
}

function drawDecals(v,now){
  const W=v.size.x,H=v.size.y;
  for(let pass=0;pass<3;pass++){
    for(let i=decals.length-1;i>=0;i--){
      const d=decals[i],rank=d.kind==='bones'?2:(d.kind==='foot'||d.kind==='chunk')?1:0;
      const age=now-d.born;
      if(age>d.life){if(pass===0)decals.splice(i,1);continue;}
      if(rank!==pass)continue;
      const p=v.proj(d.ll),mpp=v.mppOf(d.ll.lat),r=d.size/mpp;
      if(p.x<-r-40||p.y<-r-40||p.x>W+r+40||p.y>H+r+40)continue;
      const fade=Math.min(1,(d.life-age)/Math.max(8,d.life*.2));
      if(d.kind==='foot'){
        if(r<1.2)continue;
        const al=.3*Math.min(1,fade);
        ctx.save();ctx.translate(p.x,p.y);ctx.rotate(d.h*D2R);ctx.fillStyle=`rgba(35,22,12,${al})`;
        if(d.quad){ctx.beginPath();ctx.ellipse(0,0,r*.9,r*.7,0,0,TAU);ctx.fill();}
        else{ctx.beginPath();ctx.ellipse(0,r*.25,r*.45,r*.5,0,0,TAU);ctx.fill();
          for(const k of [-1,0,1]){ctx.beginPath();ctx.ellipse(k*r*.55,-r*.6+Math.abs(k)*r*.2,r*.18,r*.5,k*.35,0,TAU);ctx.fill();}}
        ctx.restore();
      }else if(d.kind==='splat'){
        const rr=Math.max(1,r);
        ctx.fillStyle=`rgba(${lerp(140,60,Math.min(1,age/40))|0},8,10,${.8*fade})`;ctx.beginPath();ctx.arc(p.x,p.y,rr,0,TAU);ctx.fill();
      }else if(d.kind==='chunk'){
        const rr=Math.max(2,r);ctx.fillStyle=`rgba(${lerp(190,110,Math.min(1,age/50))|0},40,48,${.95*fade})`;
        ctx.beginPath();ctx.arc(p.x,p.y,rr,0,TAU);ctx.fill();ctx.fillStyle=`rgba(255,150,150,${.25*fade})`;ctx.beginPath();ctx.arc(p.x-rr*.25,p.y-rr*.25,rr*.4,0,TAU);ctx.fill();
      }else if(d.kind==='pool'){
        const gr=Math.min(1,age/6),k=.25+.75*(1-Math.pow(1-gr,3)),R=d.size*k/mpp,dry=Math.min(1,age/70);
        if(R<1)continue;
        ctx.fillStyle=`rgba(${lerp(150,62,dry)|0},${lerp(8,12,dry)|0},${lerp(10,12,dry)|0},${.88*fade})`;
        ctx.beginPath();
        for(const l of d.lobes){const x=p.x+Math.cos(l.a)*l.d*R,y=p.y+Math.sin(l.a)*l.d*R,rr=l.r*R;ctx.moveTo(x+rr,y);ctx.arc(x,y,rr,0,TAU);}
        ctx.fill();
        if(age<35){ctx.fillStyle=`rgba(255,140,140,${.14*(1-age/35)*fade})`;ctx.beginPath();ctx.ellipse(p.x-R*.15,p.y-R*.15,R*.35,R*.2,-.5,0,TAU);ctx.fill();}
      }else if(d.kind==='bones'){drawBones(p,d,r,fade);}
    }
  }
}
function drawBones(p,d,Hp,fade){
  if(Hp<6)return;
  const sp=d.sp,c=ctx,id=sp.id==='spino'?'rex':sp.id,im=skelImg[id];   // no skeleton art for Spinosaurus: borrow the theropod
  if(!im)return;
  const hr=SKEL_H[id]*(sp.id==='spino'?1.05:1),Hs=Hp*hr,Ws=Hs*im.naturalWidth/im.naturalHeight*(sp.id==='spino'?1.15:1);
  c.save();c.translate(p.x,p.y);c.rotate(d.h*D2R);c.globalAlpha=fade*.96;
  c.drawImage(im,-Ws/2,-Hp/2,Ws,Hs);c.restore();
}
function drawParticles(sc,v){
  const ll=sc.toLatLng(0,0),base=v.proj(ll),mpp=v.mppOf(ll.lat),c=ctx;
  const mx=111320*mpp**-1;                                     // not used; positions go through proj for accuracy
  for(const q of sc.particles){
    const p=v.proj(sc.toLatLng(q.x,q.y)),lift=q.z*6/mpp*.0;
    if(q.type==='dust'){const a=Math.max(0,q.life/1.1)*.3;c.fillStyle=`rgba(190,172,140,${a})`;c.beginPath();c.arc(p.x,p.y,Math.max(1,q.size/mpp),0,TAU);c.fill();}
    else if(q.type==='drop'){const r=Math.max(1.2,q.size/mpp)*(1+q.z*.08);c.fillStyle='rgba(150,6,10,.95)';c.beginPath();c.arc(p.x,p.y-q.z*2,r,0,TAU);c.fill();}
    else{const r=Math.max(2.4,q.size/mpp)*(1+q.z*.06);c.fillStyle='rgb(176,40,50)';c.beginPath();c.arc(p.x,p.y-q.z*3,r,0,TAU);c.fill();c.fillStyle='rgba(255,170,170,.35)';c.beginPath();c.arc(p.x-r*.25,p.y-q.z*3-r*.25,r*.4,0,TAU);c.fill();}
  }
}
function render(now){
  const v=view,W=v.size.x,H=v.size.y;
  ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,W,H);
  drawDecals(v,now/1000);
  for(const sc of scenes){
    const list=sc.actors.filter(a=>!a.gone).sort((a,b)=>(a.dead?0:a.role==='predator'?2:1)-(b.dead?0:b.role==='predator'?2:1));
    for(const a of list)drawActor(a,sc,v);
    drawParticles(sc,v);
  }
  if(highlight&&!highlight.gone&&highlight.vis){
    const a=highlight,r=Math.max(a.hPx,a.wPx)*.55+8,t=now/1000;
    ctx.save();ctx.translate(a.sx,a.sy);ctx.rotate(t*.8);ctx.setLineDash([8,6]);ctx.lineWidth=2.5;ctx.strokeStyle='rgba(255,255,255,.9)';
    ctx.beginPath();ctx.arc(0,0,r,0,TAU);ctx.stroke();ctx.restore();
  }
}


/* =====================================================================
   6. HOST ADAPTER + INPUT   (everything map-specific comes from the `host` object)
   ===================================================================== */
const mppAt=(lat,z)=>156543.03392*Math.cos(lat*D2R)/Math.pow(2,z);
let lastActivity=performance.now(),pointerDown=false;
const touch=()=>{lastActivity=performance.now();};
let autoOn=true,sceneType='hunt',lastSceneEnd=0,highlight=null,tip=null;
const EGG_NODES=[];   // DOM nodes the egg adds (removed by destroy)

/* ---------- pointer interaction: hover = name + roar, press & hold = freeze that one animal ---------- */
let ptr=null,hover=null,held=null,lastHover=null;
function hitTest(pt){
  if(!pt)return null;let best=null,bd=1e9;
  for(const sc of scenes)for(const a of sc.actors){
    if(a.gone||!a.vis||a.fade<.3)continue;
    const dx=pt.x-a.sx,dy=pt.y-a.sy,c=Math.cos(-a.hRad),s=Math.sin(-a.hRad),lx=dx*c-dy*s,ly=dx*s+dy*c;
    const rx=Math.max(a.wPx*.5,9)*.95,ry=Math.max(a.hPx*.5,9)*.98;
    const k=(lx*lx)/(rx*rx)+(ly*ly)/(ry*ry);
    if(k<=1&&k<bd){bd=k;best=a;}
  }
  return best;
}
/* noticing an animal (hover / hold / list click) lets its ambient sounds (footsteps) play */
function notice(a){a.noticed=true;}
/* hovering or grabbing an animal makes it roar (rate-limited per animal) */
function roarAt(a){if(a&&!a.dead&&a.state!=='seized')sfx('hover',a,.9);}
const STATE_TXT={stalk:'stalking',sprint:'chasing',lunge:'lunging',shake:'attacking',drag:'dragging its kill',feed:'feeding',leave:'moving on',rest:'catching its breath',flee:'fleeing',walk:'walking',idle:'resting',seized:'caught!',carcass:'carcass'};
function describe(a){return held===a?'held still':a.dead?'carcass':STATE_TXT[a.state]||'';}
/* predator / prey / herbivore label for UI lists */
function roleOf(a){
  if(a.role==='predator'||(a.sp.pred&&a.role!=='prey'))return {key:'predator',label:'Predator'};
  if(a.role==='prey')return {key:'prey',label:'Prey'};
  return {key:'herbivore',label:'Herbivore'};
}
function release(){if(!held)return;held.held=held.frozen=false;held=null;host.setDragging(true);}
function updateHover(){
  hover=held||hitTest(ptr);
  mapEl.style.cursor=hover?(held?'grabbing':'pointer'):'';
  if(hover!==lastHover){if(hover&&!held)roarAt(hover);lastHover=hover;}
  if(hover){
    notice(hover);
    tip.textContent=`${hover.sp.name} · ${roleOf(hover).label} · ${describe(hover)}`;tip.style.display='block';
    const cx=ptr?ptr.cx:0,cy=ptr?ptr.cy:0;tip.style.left=(cx+14)+'px';tip.style.top=(cy+14)+'px';
  }else tip.style.display='none';
}
const LISTENERS=[];
function on(t,ev,fn,o){t.addEventListener(ev,fn,o);LISTENERS.push([t,ev,fn,o]);}
function bindInput(){
  ['wheel','keydown','touchstart'].forEach(ev=>on(mapEl,ev,touch,{passive:true}));
  on(mapEl,'pointerdown',()=>{pointerDown=true;touch();},{passive:true});
  on(window,'pointerup',()=>{pointerDown=false;touch();},{passive:true});
  /* hover is tracked on window (capture) so a map library that swallows events inside its own container cannot hide the pointer from us */
  on(window,'mousemove',e=>{
    const r=mapEl.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;
    ptr=(x>=0&&y>=0&&x<=r.width&&y<=r.height&&mapEl.contains(e.target))?{x,y,cx:e.clientX,cy:e.clientY}:null;
  },{capture:true,passive:true});
  on(window,'pointerdown',e=>{
    if(!mapEl.contains(e.target)||(host.ignoreTarget&&host.ignoreTarget(e.target)))return;
    const r=mapEl.getBoundingClientRect(),pt={x:e.clientX-r.left,y:e.clientY-r.top};
    const a=hitTest(pt);if(!a||a.dead||a.state==='seized')return;
    held=a;a.held=a.frozen=true;notice(a);roarAt(a);host.setDragging(false);ptr={x:pt.x,y:pt.y,cx:e.clientX,cy:e.clientY};
  },{capture:true});
  on(window,'pointerup',release);on(window,'pointercancel',release);on(window,'blur',release);
  on(window,'resize',resizeCanvas);
  SND_UNLOCK_EVENTS.forEach(ev=>on(window,ev,()=>Snd.unlock(),{passive:true}));   // browsers keep audio silent until one gesture
}

/* =====================================================================
   7. SCENES + TRIGGER
   ===================================================================== */
/* The scene is laid out in the VISIBLE part of the map: view.rect (container px) excludes anything the host has covered
   with panels. Animals enter and leave at the edges of that rectangle, and the scene origin is its centre. */
function viewBox(){
  const s=host.getSize(),c=host.getCenter(),mpp=mppAt(c.lat,host.getZoom()),v=view||host.makeView(performance.now());
  const R=v.rect||{x0:0,y0:0,x1:s.x,y1:s.y},W=R.x1-R.x0,H=R.y1-R.y0;
  const dx=((R.x0+R.x1)/2-s.x/2)*mpp,dy=-((R.y0+R.y1)/2-s.y/2)*mpp;     // visible-region centre relative to the map centre, metres
  return {W,H,mpp,c:{lat:c.lat+dy/M_PER_DEG,lng:c.lng+dx/(M_PER_DEG*Math.cos(c.lat*D2R))}};
}
const SIDE_NAMES=['north','east','south','west'];
function announce(side,type){
  const msg=type==='hunt'?`🦖 A predator is coming in from the ${SIDE_NAMES[side]}…`:`🦖 Dinosaurs arriving from the ${SIDE_NAMES[side]}…`;
  if(glowEl){view=view||host.makeView(performance.now());placeGlow();glowEl.classList.remove('on');void glowEl.offsetWidth;glowEl.classList.add('on');glowUntil=performance.now()+3300;}
  if(opts.onAnnounce)opts.onAnnounce(msg,type,side);
}

function spawnScene(type){
  if(!spritesReady||!host)return false;
  if(!type||type==='random')type=pickAutoType();
  const vb=viewBox();
  if(vb.W<220||vb.H<220)return false;   // the visible part of the map (not covered by panels) is too small for a scene
  for(let attempt=0;attempt<12;attempt++){
    const sc=new Scene(type,vb.c);let sideP=-1;
    const maxL=type==='herd'?22*displayScale:type==='pack'?2*displayScale:type==='hunt'?15*displayScale:12*displayScale;
    const off=40+maxL/vb.mpp*.55,side=randInt(4);
    const edge=(sd,off2)=>{const u=rand(.2,.8);
      return sd===0?{px:u*vb.W,py:-off2}:sd===1?{px:vb.W+off2,py:u*vb.H}:sd===2?{px:u*vb.W,py:vb.H+off2}:{px:-off2,py:u*vb.H};};
    const xy=p=>({x:(p.px-vb.W/2)*vb.mpp,y:(vb.H/2-p.py)*vb.mpp});
    const ent=xy(edge(side,off)),goal=xy(edge((side+2)%4,off*3));
    const hd=hdgOf(goal.x-ent.x,goal.y-ent.y);
    sc.goal=goal;sc.goalFar=goal;sc.goalNear=ent;   // hunt prey walk back and forth between these two while the predator is about
    if(type==='solo'){
      const sp=SPECIES[randInt(SPECIES.length)],a=new Actor(sp,ent.x,ent.y,hd,'solo');a.timer=rand(10,22);sc.actors=[a];
    }else if(type==='herd'){
      const n=3+randInt(3),kinds=['trike','stego','brachio','trike','stego'].sort(()=>Math.random()-.5).slice(0,n);
      const slots=[null,[-18,-24],[-34,16],[-12,26],[-52,-8]];
      sc.actors=kinds.map((k,i)=>{const a=new Actor(SP(k),ent.x,ent.y,hd,'herbivore');a.slot=slots[i]||[-20,0];
        if(slots[i]){const f=dirOf(hd),r={x:f.y,y:-f.x};a.x+=(f.x*slots[i][0]+r.x*slots[i][1])*displayScale;a.y+=(f.y*slots[i][0]+r.y*slots[i][1])*displayScale;}return a;});
    }else if(type==='pack'){
      const slots=[null,[-4,-4.5],[-8,4.5],[-3,9],[-11,-9]];
      sc.actors=slots.slice(0,3+randInt(2)).map((s,i)=>{const a=new Actor(SP('raptor'),ent.x,ent.y,hd,'pack');a.slot=s||[0,0];
        if(s){const f=dirOf(hd),r={x:f.y,y:-f.x};a.x+=(f.x*s[0]+r.x*s[1])*displayScale;a.y+=(f.y*s[0]+r.y*s[1])*displayScale;}return a;});
    }else{
      sc.arenaR=clamp(.3*Math.min(vb.W,vb.H)*vb.mpp,40,150);
      /* always one predator + two prey. The prey walk from one side of the map to the opposite side;
         the predator enters at the same moment from a different edge and times its approach to meet them mid-map. */
      const predSp=SP(Math.random()<.65?'rex':'spino'),preyKinds=[Math.random()<.5?'trike':'stego',Math.random()<.5?'trike':'stego'];
      sideP=(side+1+randInt(2)*2)%4;
      const pent=xy(edge(sideP,off*.8)),hp=hd;
      const pr=new Actor(SP(preyKinds[0]),ent.x,ent.y,hp,'prey'),pc=new Actor(SP(preyKinds[1]),ent.x,ent.y,hp,'prey');
      const f=dirOf(hp);pc.x-=f.x*16*displayScale+f.y*14;pc.y-=f.y*16*displayScale-f.x*14;pc.slot=[-14,-16];
      const span=Math.hypot(goal.x-ent.x,goal.y-ent.y),mf=rand(.42,.58);
      sc.meet={x:ent.x+(goal.x-ent.x)*mf,y:ent.y+(goal.y-ent.y)*mf};sc.meetDone=false;sc.dir={x:(goal.x-ent.x)/span,y:(goal.y-ent.y)/span};
      sc.boost=clamp(span/2/(40*timeScale*pr.walkMs),1,8);   // keep the crossing to roughly 40 s of real time at any zoom
      const pred=new Actor(predSp,pent.x,pent.y,hdgOf(sc.meet.x-pent.x,sc.meet.y-pent.y),'predator');pred.state='stalk';
      sc.pred=pred;sc.preys=[pr,pc];sc.actors=[pr,pc,pred];
    }
    for(const a of sc.actors){a.sc=sc;a.speed=a.walkMs*(a.role==='predator'?1:.8)*(type==='hunt'&&a.role==='prey'?sc.boost:1);a.fade=0;}
    // entry & route must be on walkable ground
    if(walkableFn){
      const ok=p=>{const ll=sc.toLatLng(p.x,p.y);return walkableFn(ll.lat,ll.lng);};
      if(!ok(ent)||!ok(goal))continue;
    }
    clearScenes(true);scenes.push(sc);
    announce(type==='hunt'?sideP:side,type);
    if(opts.onSceneStart)opts.onSceneStart(sc);
    return true;
  }
  return false;
}
function clearScenes(silent){for(const sc of scenes)sc.ended=true;scenes=[];if(!remainsOn)clearDecals(BLOOD);if(!silent)lastSceneEnd=performance.now();}
function pickAutoType(){const r=Math.random();return r<.45?'hunt':r<.70?'herd':r<.85?'solo':'pack';}

/* scene housekeeping: remove departed animals, end empty / abandoned scenes */
function housekeeping(rdt){
  const R=view.rect||{x0:0,y0:0,x1:view.size.x,y1:view.size.y},vb=viewBox(),tooFar=host.getZoom()<zoomTrigger-.7;
  for(const sc of scenes){
    sc.alphaT=tooFar?0:1;sc.alpha+=(sc.alphaT-sc.alpha)*(1-Math.exp(-rdt*2.2));
    let anyVisible=false;
    for(const a of sc.actors){
      if(a.gone)continue;
      if(a.vis)anyVisible=true;
      if(a.seen&&!a.vis&&(a.leaving||sc.type!=='hunt')&&a.age>5){
        const m=a.hPx*.6+60;if(a.sx<R.x0-m||a.sy<R.y0-m||a.sx>R.x1+m||a.sy>R.y1+m)a.gone=true;}
    }
    sc.unseenT=anyVisible?0:sc.unseenT+rdt;
    const alive=sc.actors.some(a=>!a.gone);
    if(!alive||sc.unseenT>(sc.age<30?40:20)||(tooFar&&sc.alpha<.03))sc.ended=true;
  }
  const before=scenes.length;scenes=scenes.filter(s=>!s.ended);
  if(before&&!scenes.length){lastSceneEnd=performance.now();if(!remainsOn)clearDecals(BLOOD);}
}



/* =====================================================================
   8. MAIN LOOP + PUBLIC API
   ===================================================================== */
let last=performance.now(),rafId=0,tmrId=0,idleDrawn=false;
function frame(now){
  if(!started)return;
  const dt=Math.min(.1,(now-last)/1000);last=now;
  view=host.makeView(now);
  if(!paused&&scenes.length){
    stepSim(dt*timeScale);
    for(const sc of scenes)updParticles(sc,dt);
  }
  /* the trigger: easter egg enabled, zoomed in far enough, user has paused on a spot, nothing running */
  if(autoOn&&!scenes.length&&spritesReady&&!document.hidden&&!pointerDown&&!view.anim&&host.getZoom()>=zoomTrigger&&
     now-lastActivity>IDLE_MS&&now-lastSceneEnd>2500){if(spawnScene(sceneType)===false)lastSceneEnd=now;}   // false = nowhere to put a scene right now; retry in a few seconds
  /* idle = nothing to draw. The loop then only wakes ~5x a second to watch for the trigger, so the egg costs the app almost nothing. */
  const idle=!scenes.length&&!decals.length;
  if(!idle||!idleDrawn){render(now);idleDrawn=idle;}
  housekeeping(dt);
  if(!idle||lastHover)updateHover();
  applyTremor(dt);
  if(now<glowUntil)placeGlow();
  if(opts.onFrame)opts.onFrame(now,dt);
  if(!started)return;
  if(idle)tmrId=setTimeout(()=>{rafId=requestAnimationFrame(frame);},200);else rafId=requestAnimationFrame(frame);
}
const EGG_CSS=`
#dinoegg-canvas{position:absolute;left:0;top:0;z-index:450;pointer-events:none}
#dinoegg-tip{position:fixed;z-index:1200;display:none;pointer-events:none;background:#091927;border:1px solid #39536a;color:#f3f8fc;border-radius:7px;padding:5px 9px;font:11px/1.3 system-ui,sans-serif;box-shadow:0 4px 14px #0007;white-space:nowrap}
.dinoegg-glow{position:fixed;z-index:700;pointer-events:none;opacity:0;display:none}
.dinoegg-glow i{position:absolute;display:block}
.dinoegg-glow i:nth-child(1){left:0;right:0;top:0;height:110px;background:linear-gradient(to bottom,#ff4a2dcc,transparent)}
.dinoegg-glow i:nth-child(2){top:0;bottom:0;right:0;width:110px;background:linear-gradient(to left,#ff4a2dcc,transparent)}
.dinoegg-glow i:nth-child(3){left:0;right:0;bottom:0;height:110px;background:linear-gradient(to top,#ff4a2dcc,transparent)}
.dinoegg-glow i:nth-child(4){top:0;bottom:0;left:0;width:110px;background:linear-gradient(to right,#ff4a2dcc,transparent)}
.dinoegg-glow.on{display:block;animation:dinoeggGlow 3.2s ease-out}
@keyframes dinoeggGlow{0%{opacity:0}12%{opacity:1}100%{opacity:0}}`;
let started=false,glowEl=null,glowUntil=0;
/* put the flash exactly over the visible part of the map (client px), so panels covering the map never hide it */
function placeGlow(){
  if(!glowEl||!view)return;
  const mr=mapEl.getBoundingClientRect(),R=view.rect||{x0:0,y0:0,x1:view.size.x,y1:view.size.y};
  glowEl.style.left=(mr.left+R.x0)+'px';glowEl.style.top=(mr.top+R.y0)+'px';glowEl.style.width=(R.x1-R.x0)+'px';glowEl.style.height=(R.y1-R.y0)+'px';
}
function addNode(parent,el){parent.appendChild(el);EGG_NODES.push(el);return el;}
function init(h,o){
  if(started)return;started=true;
  host=h;opts=o||{};mapEl=host.el;
  addNode(document.head,Object.assign(document.createElement('style'),{textContent:EGG_CSS}));
  cv=addNode(mapEl,Object.assign(document.createElement('canvas'),{id:'dinoegg-canvas'}));ctx=cv.getContext('2d');
  tip=addNode(document.body,Object.assign(document.createElement('div'),{id:'dinoegg-tip'}));
  glowEl=addNode(document.body,Object.assign(document.createElement('div'),{className:'dinoegg-glow',innerHTML:'<i></i><i></i><i></i><i></i>'}));   // red flash framing the VISIBLE map on all four sides
  resizeCanvas();bindInput();
  last=performance.now();idleDrawn=false;rafId=requestAnimationFrame(frame);
}
/* Remove everything the egg added (canvas, listeners, timers, audio) so it can be switched off at runtime or re-initialised. */
function destroy(){
  if(!started)return;started=false;
  cancelAnimationFrame(rafId);clearTimeout(tmrId);
  release();
  for(const [t,ev,fn,o] of LISTENERS)t.removeEventListener(ev,fn,o);LISTENERS.length=0;
  clearScenes(true);clearDecals();highlight=null;hover=lastHover=null;ptr=null;
  if(host&&host.shake)host.shake('');
  for(const n of EGG_NODES)n.remove();EGG_NODES.length=0;cv=ctx=tip=null;
  if(Snd.ctx){try{Snd.ctx.close();}catch(e){}Snd.ctx=null;audioCtx=null;}
  host=null;opts={};
}
/* settings can be changed at any time: set({autoTrigger,zoomTrigger,sceneType,displayScale,timeScale,gore,sound,remains,footprints,paused}) */
function set(o){
  if('autoTrigger' in o){autoOn=!!o.autoTrigger;touch();}
  if('zoomTrigger' in o){zoomTrigger=+o.zoomTrigger;touch();}
  if('sceneType' in o)sceneType=o.sceneType;
  if('displayScale' in o)displayScale=+o.displayScale;
  if('timeScale' in o)timeScale=+o.timeScale;
  if('gore' in o)goreLevel=clamp(+o.gore,0,GORE.length-1);
  if('sound' in o)Snd.muted=!o.sound;
  if('remains' in o){remainsOn=!!o.remains;if(!remainsOn&&!scenes.length)clearDecals(BLOOD);}
  if('footprints' in o){printsOn=!!o.footprints;if(!printsOn)clearDecals(['foot']);}
  if('paused' in o)paused=!!o.paused;
}
return {
  init,destroy,set,touch,resize:resizeCanvas,
  spawn:spawnScene,clear:()=>clearScenes(true),clearRemains:()=>clearDecals(),
  scenes:()=>scenes,actors:()=>{const r=[];for(const sc of scenes)for(const a of sc.actors)if(!a.gone)r.push(a);return r;},
  latLngOf:a=>a.sc.toLatLng(a.x,a.y),
  notice,describe,roleOf,spriteSrc,highlight:a=>{highlight=a;},isHeld:a=>held===a,
  setWalkable:f=>{walkableFn=f;},          // (lat,lng)=>boolean  — water / steep ground returns false
  state:()=>({autoTrigger:autoOn,zoomTrigger,sceneType,sceneRunning:scenes.length>0,idleMs:pointerDown?0:performance.now()-lastActivity,idleNeedMs:IDLE_MS,ready:spritesReady}),
  GORE,SPECIES,get goreLevel(){return goreLevel;},get displayScale(){return displayScale;},get timeScale(){return timeScale;},
};

})();
