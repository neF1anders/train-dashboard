import {surface,color,prepareTrack} from './map.js';
import {curveAt} from './motion.js';

export class Scene{
  constructor(canvas){
    Object.assign(this,{canvas,track:[],mode:'3d',angle:220,zoom:1.25,time:0,vehicle:'',snapshot:null,showSnapshot:false,current:null});
    new ResizeObserver(()=>this.draw()).observe(canvas);
  }
  setTrack(track,vehicle){this.track=track;this.model=prepareTrack(track);this.vehicle=vehicle;}
  draw(){
    const frame=surface(this.canvas);if(!frame)return;
    const {ctx,w,h}=frame,background=color('--bg'),muted=color('--muted'),accent=color('--accent'),glass=color('--glass'),tram=color('--tram'),panel=color('--panel');
    ctx.fillStyle=background;ctx.fillRect(0,0,w,h);
    const actual=this.model?.at(this.time),p=actual||this.model?.before(this.time);if(!p)return;
    const ghost=!actual,theta=this.angle*Math.PI/180,cos=Math.cos(theta),sin=Math.sin(theta),tilt=.72,top=this.mode==='2d';
    const scale=Math.min(w/62,h/48)*this.zoom;
    const project=([x,y,z=0])=>{
      const dx=x-p.x,dy=y-p.y,X=dx*cos-dy*sin,Y=dx*sin+dy*cos;
      return top?[w/2+dx*scale,h*.56-dy*scale,-z]:[w/2+X*scale,h*.57-(Y*Math.sin(tilt)+z*Math.cos(tilt))*scale,Y*Math.cos(tilt)-z*Math.sin(tilt)];
    };
    const line=(points,stroke,width=1,dash=[])=>{ctx.beginPath();points.forEach((a,i)=>{const q=project(a);i?ctx.lineTo(q[0],q[1]):ctx.moveTo(q[0],q[1]);});ctx.strokeStyle=stroke;ctx.lineWidth=width;ctx.setLineDash(dash);ctx.stroke();ctx.setLineDash([]);};
    const polygon=(points,fill)=>{ctx.beginPath();points.forEach((a,i)=>{const q=project(a);i?ctx.lineTo(q[0],q[1]):ctx.moveTo(q[0],q[1]);});ctx.closePath();ctx.fillStyle=fill;ctx.fill();};
    // Geographic grid: its world origin and orientation never jump with the heading.
    for(let x=Math.floor((p.x-100)/10)*10;x<=p.x+100;x+=10)line([[x,p.y-120,0],[x,p.y+120,0]],color('--grid'));
    for(let y=Math.floor((p.y-120)/10)*10;y<=p.y+120;y+=10)line([[p.x-100,y,0],[p.x+100,y,0]],color('--grid'));
    const path=this.model.geometry(p,150,1.5);
    const offset=(q,d,z=0)=>[q.x+q.ty*d,q.y-q.tx*d,z];
    if(path.length>1){
      polygon([...path.map(q=>offset(q,1.5)),...path.slice().reverse().map(q=>offset(q,-1.5))],color('--border'));
      const start=Math.max(0,p.s-100),end=Math.min(p.run.length,p.s+100);
      for(let s=Math.ceil(start/1.2)*1.2;s<end;s+=1.2){const q=curveAt(p.run,s);line([offset(q,-1.1),offset(q,1.1)],color('--map-road'),Math.max(1,scale*.16));}
      for(const side of [-.76,.76]){const rail=path.map(q=>offset(q,side,.12));line(rail,muted,3);line(rail,panel,1);}
    }
    // The rigid model follows the chord between its bogies, not one noisy GPS edge.
    const world=(x,y,z)=>[p.x+x*p.bodyTy+y*p.bodyTx,p.y-x*p.bodyTx+y*p.bodyTy,z];
    const faces=[];
    function box(x,y,z,dx,dy,dz,fill,dashed=false,external=false){
      const pts=[[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]].map(a=>world(x+a[0]*dx/2,y+a[1]*dy/2,z+a[2]*dz/2));
      [[0,1,2,3],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7],[4,5,6,7]].forEach((indices,j)=>{
        const points=indices.map(i=>project(pts[i]));faces.push({points,depth:points.reduce((s,q)=>s+q[2],0)/4,fill,dashed,external,shade:[.16,.13,.09,.07,.04,0][j]});
      });
    }
    ctx.globalAlpha=ghost?.35:1;
    polygon([world(-1.8,-7.6,0),world(1.8,-7.6,0),world(1.8,7.6,0),world(-1.8,7.6,0)],color('--grid'));
    box(0,0,.65,2.3,13.8,.8,muted);box(0,0,2.05,2.6,14,2.5,tram);box(0,0,3.4,2.64,13.6,.28,panel);
    for(const side of [-1,1])for(const y of [-5.5,-3.3,-1.1,1.1,3.3,5.5])box(side*1.31,y,2.5,.04,1.65,1.1,glass);
    box(0,7.02,2.5,2.16,.05,1.15,glass);box(0,-7.02,2.4,2.16,.05,1.0,glass);
    for(const side of [-1,1])for(const y of [-4.9,-3.9,3.9,4.9])box(side*1.04,y,.42,.35,.86,.7,glass);
    box(0,-1.7,3.7,1.45,2.3,.3,muted);
    for(const x of [-.82,.82])box(x,7.06,1.25,.36,.04,.22,'#f5e3a3');
    let objects=[];
    const snapshotVisible=this.showSnapshot&&this.snapshot&&this.time>=this.snapshot.t&&this.time-this.snapshot.t<=3000;
    if(snapshotVisible){const tel=this.snapshot.data;objects=tel.object?[tel.object]:(tel.trafficLights||[]);for(const o of objects){
      const pose=o.pose||{},size=o.size||{};if(!Number.isFinite(pose.x)||!Number.isFinite(pose.y))continue;
      box(pose.x,pose.y,(size.height||2)/2,Math.min(size.width||2,8),Math.min(size.length||4,20),Math.min(size.height||2,7),o.type==='TRAFFIC_LIGHT'?muted:color('--warn'),o.state!=='TRACKED',true);
    }}
    faces.sort((a,b)=>b.depth-a.depth).forEach(f=>{
      ctx.beginPath();f.points.forEach((q,i)=>i?ctx.lineTo(q[0],q[1]):ctx.moveTo(q[0],q[1]));ctx.closePath();
      if(!f.dashed){ctx.fillStyle=f.fill;ctx.fill();ctx.fillStyle=`rgba(0,0,0,${f.shade})`;ctx.fill();}
      ctx.strokeStyle=muted;ctx.lineWidth=f.dashed?1:.35;ctx.setLineDash(f.dashed?[3,3]:[]);ctx.stroke();ctx.setLineDash([]);
    });
    if(!top){line([world(0,-3.3,3.8),world(0,-1.5,5),world(0,-3.3,5.7)],muted,2);line([world(-1,-3.3,5.7),world(1,-3.3,5.7)],muted,2);}
    if(p.headingKnown){const forward=p.tx*p.bodyTx+p.ty*p.bodyTy>=0?1:-1;line([world(0,8*forward,.1),world(0,12*forward,.1)],accent,2);line([world(-.8,11*forward,.1),world(0,12*forward,.1),world(.8,11*forward,.1)],accent,2);}
    ctx.globalAlpha=1;
    ctx.fillStyle=color('--text');ctx.font='600 13px Segoe UI';ctx.fillText('Вагон '+this.vehicle,15,24);ctx.font='11px Segoe UI';ctx.fillStyle=muted;ctx.fillText(top?'Вид сверху · север вверху':'Обзор · камера сохраняет направление',15,43);
    if(snapshotVisible){ctx.fillStyle=color('--warn');ctx.fillText('Схема снимка · неподтверждённые оси и масштаб',15,62);}
    else if(this.showSnapshot&&this.snapshot){ctx.fillStyle=muted;ctx.fillText('Снимок вне своего времени · объекты скрыты',15,62);}
    this.canvas.dataset.position=actual?'observed':'last-known';this.canvas.dataset.run=String(p.run.index);
  }
}
