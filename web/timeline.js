import {surface,color,lowerBound,eventName} from './map.js';
const stamp=t=>new Date(t+10800000).toISOString().slice(11,23);
export class Timeline{
  constructor(canvas,{preview,commit,leave}){
    this.canvas=canvas;this.callbacks={preview,commit,leave};this.base=document.createElement('canvas');this.dirty=true;this.hover=null;this.dragging=false;this.hitEvents=[];
    canvas.addEventListener('pointermove',e=>{if(e.pointerType==='touch'&&!this.dragging)return;this.point(e.offsetX,e.offsetY);});
    canvas.addEventListener('pointerleave',()=>{if(!this.dragging)this.clear();});
    canvas.addEventListener('pointerdown',e=>{if(e.button!==0)return;this.dragging=true;canvas.setPointerCapture(e.pointerId);this.point(e.offsetX,e.offsetY);});
    canvas.addEventListener('pointerup',e=>{if(!this.dragging)return;this.dragging=false;this.point(e.offsetX,e.offsetY);if(this.hover)this.callbacks.commit(this.hover.t,this.hover.event);});
    canvas.addEventListener('pointercancel',()=>{this.dragging=false;this.clear();});
    canvas.addEventListener('keydown',e=>{if(!this.data)return;const step=(this.data.to-this.data.from)/1000;if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();const t=Math.max(this.data.from,Math.min(this.data.to,(this.hover?.t??this.time)+(e.key==='ArrowRight'?step:-step)));this.hover={t,event:null};this.callbacks.preview(t,null);this.draw();}if(e.key==='Enter'&&this.hover){e.preventDefault();this.callbacks.commit(this.hover.t,this.hover.event);}if(e.key==='Escape')this.clear();});
    canvas.addEventListener('blur',()=>this.clear());
    new ResizeObserver(()=>{this.dirty=true;this.draw();}).observe(canvas);
  }
  setData(data){this.data=data;this.dirty=true;this.draw();}
  update(t){this.time=t;this.draw();}
  clear(){this.hover=null;this.callbacks.leave();this.draw();}
  point(x,y){
    if(!this.data)return;const {from,to}=this.data,w=this.canvas.clientWidth;
    if(x<35||x>w-12||y<5||y>120){this.clear();return;}
    const hit=this.hitEvents.reduce((best,p)=>Math.abs(p.x-x)<=7&&Math.abs(p.y-y)<=8&&(!best||Math.abs(p.x-x)<Math.abs(best.x-x))?p:best,null);
    const t=hit?hit.event.start:Math.round(from+Math.max(0,Math.min(1,(x-35)/(w-47)))*(to-from));
    if(this.hover?.t===t&&this.hover.event?.id===hit?.event.id)return;
    this.hover={t,event:hit?.event||null};this.callbacks.preview(t,this.hover.event);this.draw();
  }
  build({w,h,d}){
    this.base.width=Math.round(w*d);this.base.height=Math.round(h*d);const ctx=this.base.getContext('2d');ctx.setTransform(d,0,0,d,0,0);
    const {from,to,start,end,series,gaps,events}=this.data,L=35,R=w-12,T=31,B=102,span=Math.max(1,to-from),x=t=>L+(t-from)/span*(R-L);
    const lo=lowerBound(series,from),hi=lowerBound(series,to+1),visible=series.slice(Math.max(0,lo-1),hi);
    let vmax=30;for(const r of visible)if(r.speed!=null&&!r.flags?.includes('speed_out_of_range'))vmax=Math.max(vmax,r.speed);
    const y=v=>B-Math.min(vmax,Math.max(0,v))/vmax*(B-T);
    ctx.fillStyle=color('--soft');ctx.fillRect(Math.max(L,x(start)),T,Math.max(0,Math.min(R,x(end))-Math.max(L,x(start))),B-T);
    ctx.font='11px Segoe UI';ctx.fillStyle=color('--muted');ctx.fillText('км/ч',2,22);
    for(const v of[0,Math.round(vmax/2),Math.ceil(vmax)]){ctx.strokeStyle=color('--grid');ctx.beginPath();ctx.moveTo(L,y(v));ctx.lineTo(R,y(v));ctx.stroke();ctx.fillText(String(v),3,y(v)+4);}
    const visibleGaps=gaps.filter(([a,b])=>b>=from&&a<=to);
    for(const[a,b]of visibleGaps){ctx.fillStyle=color('--border');ctx.fillRect(Math.max(L,x(a)),T,Math.max(0,Math.min(R,x(b))-Math.max(L,x(a))),B-T);}
    ctx.save();ctx.beginPath();ctx.rect(L,T,R-L,B-T);ctx.clip();ctx.beginPath();ctx.strokeStyle=color('--accent');ctx.lineWidth=1.7;
    let previous=null,lastX=-Infinity;
    for(const r of visible){if(r.speed==null||r.flags?.includes('speed_out_of_range')){previous=null;continue;}const px=x(r.t);if(!previous||visibleGaps.some(([a,b])=>previous.t<=a&&r.t>=b))ctx.moveTo(px,y(r.speed));else ctx.lineTo(px,y(r.speed));previous=r;lastX=px;}
    ctx.stroke();ctx.restore();this.hitEvents=[];const bins=new Set();
    for(const event of events){if(event.start<from||event.start>to)continue;const px=x(event.start),yy=event.type==='Brake'?11:event.type==='Warn'?21:31,key=Math.round(px/4)+event.type;
      this.hitEvents.push({x:px,y:yy,event});if(bins.has(key))continue;bins.add(key);ctx.fillStyle=color(event.type==='Brake'?'--brake':event.type==='Warn'?'--warn':'--purple');ctx.beginPath();ctx.arc(px,yy,3,0,Math.PI*2);ctx.fill();}
    for(let i=0;i<5;i++){const t=from+span*i/4;ctx.textAlign=i===0?'left':i===4?'right':'center';ctx.fillStyle=color('--muted');ctx.fillText(stamp(t).slice(0,8),x(t),126);}ctx.textAlign='left';
    this.dirty=false;this.theme=document.documentElement.dataset.theme;
  }
  draw(){
    if(!this.data)return;const s=surface(this.canvas);if(!s)return;const{ctx,w,h}=s;
    if(this.dirty||this.base.width!==this.canvas.width||this.base.height!==this.canvas.height||this.theme!==document.documentElement.dataset.theme)this.build(s);
    ctx.drawImage(this.base,0,0,w,h);
    const x=t=>35+(t-this.data.from)/Math.max(1,this.data.to-this.data.from)*(w-47);
    if(this.time>=this.data.from&&this.time<=this.data.to){ctx.strokeStyle=color('--text');ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(x(this.time),34);ctx.lineTo(x(this.time),105);ctx.stroke();}
    if(this.hover){const px=x(this.hover.t);ctx.strokeStyle=color('--accent');ctx.setLineDash([3,3]);ctx.beginPath();ctx.moveTo(px,5);ctx.lineTo(px,106);ctx.stroke();ctx.setLineDash([]);const text=stamp(this.hover.t)+(this.hover.event?' · '+eventName(this.hover.event):'');ctx.font='600 11px Segoe UI';const tw=Math.min(w-16,ctx.measureText(text).width+14),left=Math.max(8,Math.min(w-tw-8,px-tw/2));ctx.fillStyle=color('--dark');ctx.fillRect(left,134,tw,22);ctx.fillStyle=color('--on-dark');ctx.fillText(text,left+7,149);}
  }
}
