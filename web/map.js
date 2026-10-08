import {prepareTrack, positionAt, lowerBound, METERS_LAT, METERS_LON} from './motion.js';
export {prepareTrack, positionAt, lowerBound};
let paletteKey='',palette={};
export function color(name){
  const key=document.documentElement.dataset.theme||'light';
  if(key!==paletteKey){palette={};paletteKey=key;}
  if(!(name in palette))palette[name]=getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return palette[name];
}
export function surface(canvas){
  const w=canvas.clientWidth,h=canvas.clientHeight,d=Math.min(devicePixelRatio||1,2);
  if(!w||!h)return null;
  if(canvas.width!==Math.round(w*d)||canvas.height!==Math.round(h*d)){canvas.width=Math.round(w*d);canvas.height=Math.round(h*d);}
  const ctx=canvas.getContext('2d');ctx.setTransform(d,0,0,d,0,0);ctx.clearRect(0,0,w,h);return {ctx,w,h,d};
}
const eventColor=e=>color(e.type==='Brake'?'--brake':e.type==='Warn'?'--warn':'--purple');
export const eventName=e=>({Brake:'Тормозное событие',Warn:'Предупреждение',OverSpeed:'Превышение скорости'})[e.type]||e.type;

export class CityMap{
  constructor(canvas,onPick,onError,onEvents){
    Object.assign(this,{canvas,onPick,onError,onEvents,center:[30.32,59.96],scale:.08,features:[],track:[],episodes:[],eventPoints:[],clusters:[],time:0,start:0,end:0,request:0,ready:false,active:false,filter:'all',selected:null});
    this.base=document.createElement('canvas');this.dirty=true;let drag=null;
    canvas.addEventListener('pointerdown',e=>{drag={x:e.offsetX,y:e.offsetY,center:[...this.center],moved:false};canvas.setPointerCapture(e.pointerId);canvas.style.cursor='grabbing';});
    canvas.addEventListener('pointermove',e=>{
      if(!drag){canvas.style.cursor=this.clusters.some(c=>Math.hypot(c.x-e.offsetX,c.y-e.offsetY)<c.radius+5)?'pointer':'grab';return;}
      const dx=e.offsetX-drag.x,dy=e.offsetY-drag.y;
      if(Math.hypot(dx,dy)>5)drag.moved=true;
      if(drag.moved){this.fitted=false;this.center=[drag.center[0]-dx/this.scale/METERS_LON,drag.center[1]+dy/this.scale/METERS_LAT];this.invalidate();}
    });
    canvas.addEventListener('pointerup',e=>{if(!drag)return;const moved=drag.moved;drag=null;canvas.style.cursor='grab';if(!moved)this.pick(e.offsetX,e.offsetY);else this.load();});
    canvas.addEventListener('pointercancel',()=>{drag=null;canvas.style.cursor='grab';});
    canvas.addEventListener('wheel',e=>{e.preventDefault();this.zoom(e.deltaY<0?1.25:.8,[e.offsetX,e.offsetY]);},{passive:false});
    new ResizeObserver(()=>{if(this.active){if(this.fitted)this.fit();else{this.invalidate();this.load();}}}).observe(canvas);
  }
  project(lon,lat){return[this.canvas.clientWidth/2+(lon-this.center[0])*METERS_LON*this.scale,this.canvas.clientHeight/2-(lat-this.center[1])*METERS_LAT*this.scale];}
  setTrack(track,episodes=[],route='all'){
    this.route=route;this.track=route==='all'?track:track.filter(r=>r.route===route);this.model=prepareTrack(this.track);
    this.episodes=episodes.filter(e=>route==='all'||e.route===route);this.eventPoints=[];
    for(const event of this.episodes){const p=this.model.at(event.start);if(p)this.eventPoints.push({event,lon:p.lon,lat:p.lat});}
    this.selected=null;this.dirty=true;this.fit();
  }
  fit(){
    const ps=this.model?.runs.flatMap(r=>r.knots)||[];if(!ps.length)return;
    let lo=Infinity,hi=-Infinity,la=Infinity,ha=-Infinity;
    for(const p of ps){lo=Math.min(lo,p.x);hi=Math.max(hi,p.x);la=Math.min(la,p.y);ha=Math.max(ha,p.y);}
    this.center=[this.model.origin[0]+(lo+hi)/2/METERS_LON,this.model.origin[1]+(la+ha)/2/METERS_LAT];
    this.scale=Math.min((this.canvas.clientWidth||360)/Math.max(180,hi-lo),(this.canvas.clientHeight||380)/Math.max(180,ha-la))*.78;
    this.ready=true;this.fitted=true;this.invalidate();this.load();
  }
  zoom(f,anchor){
    this.fitted=false;const old=this.scale;this.scale=Math.max(.009,Math.min(8,old*f));
    if(anchor){const dx=anchor[0]-this.canvas.clientWidth/2,dy=anchor[1]-this.canvas.clientHeight/2;this.center[0]+=dx*(1/old-1/this.scale)/METERS_LON;this.center[1]-=dy*(1/old-1/this.scale)/METERS_LAT;}
    this.invalidate();clearTimeout(this.loadTimer);this.loadTimer=setTimeout(()=>this.load(),120);
  }
  focus(p){if(!p)return;this.fitted=false;this.center=[p.lon,p.lat];this.scale=Math.max(this.scale,.7);this.invalidate();this.load();}
  async load(){
    if(!this.active||!this.canvas.clientWidth)return;
    this.abort?.abort();this.abort=new AbortController();const id=++this.request;
    const w=Math.min(.89,this.canvas.clientWidth/this.scale/METERS_LON/2),h=Math.min(.44,this.canvas.clientHeight/this.scale/METERS_LAT/2);
    try{
      const bounds=[this.center[0]-w,this.center[1]-h,this.center[0]+w,this.center[1]+h];
      const r=await fetch('/api/map?'+new URLSearchParams({bounds:bounds.join(',')}),{signal:this.abort.signal}),d=await r.json();
      if(!r.ok)throw Error(d.error);if(id!==this.request)return;
      this.features=d.features.filter(f=>f.kind==='street');this.invalidate();
    }catch(e){if(e.name!=='AbortError')this.onError(e.message);}
  }
  update(time,start,end){if(start!==this.start||end!==this.end)this.dirty=true;Object.assign(this,{time,start,end});this.draw();}
  setFilter(filter){this.filter=filter;this.invalidate();}
  select(event){this.selected=event.id;this.invalidate();}
  invalidate(){this.dirty=true;this.draw();}
  pick(x,y){
    const cluster=this.clusters.reduce((best,c)=>Math.hypot(c.x-x,c.y-y)<=c.radius+6&&(!best||Math.hypot(c.x-x,c.y-y)<Math.hypot(best.x-x,best.y-y))?c:best,null);
    if(cluster){this.onEvents?.(cluster.events);return;}
    let nearest=null,best=Infinity;
    for(const r of this.track){if(!r.lat||!r.lon)continue;const p=this.project(r.lon,r.lat),d=Math.hypot(p[0]-x,p[1]-y);if(d<best){best=d;nearest=r;}}
    if(!nearest||best>28){this.onError('Выберите линию маршрута или цветную точку события.');return;}
    const near=this.track.filter(r=>r.lat&&r.lon&&Math.hypot((r.lat-nearest.lat)*METERS_LAT,(r.lon-nearest.lon)*METERS_LON)<Math.max(12,8/this.scale));
    const passes=[];let group=[];
    for(const r of near){if(group.length&&r.t-group.at(-1).t>60000){passes.push(group);group=[];}group.push(r);}if(group.length)passes.push(group);
    this.onPick(passes.map(g=>({start:g[0].t,end:g.at(-1).t,record:g.reduce((a,r)=>Math.hypot(r.lat-nearest.lat,(r.lon-nearest.lon)*.5)<Math.hypot(a.lat-nearest.lat,(a.lon-nearest.lon)*.5)?r:a)})));
  }
  buildBase({w,h,d}){
    this.base.width=Math.round(w*d);this.base.height=Math.round(h*d);const ctx=this.base.getContext('2d');ctx.setTransform(d,0,0,d,0,0);
    ctx.fillStyle=color('--bg');ctx.fillRect(0,0,w,h);ctx.lineCap='round';ctx.lineJoin='round';
    const line=(ps,stroke,width)=>{ctx.strokeStyle=stroke;ctx.lineWidth=width;ctx.beginPath();ps.forEach((p,i)=>{const a=this.project(...p);i?ctx.lineTo(...a):ctx.moveTo(...a);});ctx.stroke();};
    const road=color('--map-road');for(const f of this.features)line(f.points,road,this.scale>.5?5:1.4);
    if(this.model)for(const run of this.model.runs){
      const points=run.knots.map(p=>[this.model.origin[0]+p.x/METERS_LON,this.model.origin[1]+p.y/METERS_LAT]);
      line(points,color('--panel'),6);line(points,color('--accent'),3);
      const selected=run.points.filter(p=>p.t>=this.start&&p.t<=this.end).map(p=>[this.model.origin[0]+p.x/METERS_LON,this.model.origin[1]+p.y/METERS_LAT]);
      if(selected.length>1)line(selected,color('--accent'),5);
    }
    if(this.scale>.22){const used=new Set(),boxes=[];ctx.font='11px Segoe UI';for(const f of this.features){
      if(!f.name||used.has(f.name))continue;const mid=f.points[Math.floor(f.points.length/2)],p=this.project(...mid),width=ctx.measureText(f.name).width;
      if(p[0]<10||p[0]+width>w-10||p[1]<35||p[1]>h-35||boxes.some(b=>Math.abs(b[1]-p[1])<24&&Math.abs(b[0]-p[0])<Math.max(width,b[2])))continue;
      ctx.fillStyle=color('--panel');ctx.fillRect(p[0]-3,p[1]-11,width+6,15);ctx.fillStyle=color('--muted');ctx.fillText(f.name,...p);boxes.push([...p,width]);used.add(f.name);
    }}
    const cells=new Map();
    for(const p of this.eventPoints){
      if(this.filter!=='all'&&p.event.type!==this.filter)continue;const [x,y]=this.project(p.lon,p.lat);if(x<-20||x>w+20||y<-20||y>h+20)continue;
      const key=Math.round(x/28)+':'+Math.round(y/28);if(!cells.has(key))cells.set(key,{x:0,y:0,events:[]});const c=cells.get(key);c.x+=x;c.y+=y;c.events.push(p.event);
    }
    this.clusters=[...cells.values()].map(c=>({...c,x:c.x/c.events.length,y:c.y/c.events.length,radius:c.events.length>1?13:7}));
    // Merge adjacent grid cells too: markers must remain separate click targets.
    for(let i=0;i<this.clusters.length;i++)for(let j=i+1;j<this.clusters.length;j++){
      const a=this.clusters[i],b=this.clusters[j];if(Math.hypot(a.x-b.x,a.y-b.y)>=a.radius+b.radius+7)continue;
      const n=a.events.length,m=b.events.length;a.x=(a.x*n+b.x*m)/(n+m);a.y=(a.y*n+b.y*m)/(n+m);a.events.push(...b.events);a.radius=13;this.clusters.splice(j,1);j=i;
    }
    for(const c of this.clusters){const chosen=c.events.some(e=>e.id===this.selected),mixed=new Set(c.events.map(e=>e.type)).size>1;ctx.beginPath();ctx.arc(c.x,c.y,c.radius+(chosen?4:0),0,Math.PI*2);ctx.fillStyle=color('--panel');ctx.fill();ctx.beginPath();ctx.arc(c.x,c.y,c.radius,0,Math.PI*2);ctx.fillStyle=mixed?color('--accent'):eventColor(c.events[0]);ctx.fill();if(chosen){ctx.strokeStyle=color('--text');ctx.lineWidth=2;ctx.stroke();}if(c.events.length>1){ctx.fillStyle=color('--on-dark');if(document.documentElement.dataset.theme==='dark')ctx.fillStyle='#152b3c';ctx.font='600 10px Segoe UI';ctx.textAlign='center';ctx.fillText(c.events.length>99?'99+':String(c.events.length),c.x,c.y+3.5);ctx.textAlign='left';}}
    ctx.font='11px Segoe UI';ctx.fillStyle=color('--muted');ctx.fillText('Север ↑',12,20);const meters=this.scale>1?25:this.scale>.2?100:this.scale>.04?500:1000;
    ctx.strokeStyle=color('--text');ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(12,h-24);ctx.lineTo(12+meters*this.scale,h-24);ctx.stroke();ctx.fillText(meters>=1000?meters/1000+' км':meters+' м',12,h-8);
    this.dirty=false;this.theme=document.documentElement.dataset.theme;
  }
  draw(){
    if(!this.active)return;const s=surface(this.canvas);if(!s)return;const {ctx,w,h}=s;
    if(this.dirty||this.base.width!==this.canvas.width||this.base.height!==this.canvas.height||this.theme!==document.documentElement.dataset.theme)this.buildBase(s);
    ctx.drawImage(this.base,0,0,w,h);const p=this.model?.at(this.time);
    if(p){const [x,y]=this.project(p.lon,p.lat);ctx.fillStyle=color('--panel');ctx.beginPath();ctx.arc(x,y,10,0,Math.PI*2);ctx.fill();ctx.fillStyle=color('--accent');ctx.beginPath();ctx.arc(x,y,6,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.moveTo(x+p.tx*17,y-p.ty*17);ctx.lineTo(x-p.ty*5,y-p.tx*5);ctx.lineTo(x+p.ty*5,y+p.tx*5);ctx.closePath();ctx.fill();}
    this.canvas.dataset.route=this.route;this.canvas.dataset.eventCount=String(this.eventPoints.length);
  }
}
