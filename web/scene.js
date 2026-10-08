import {surface,color,lowerBound,positionAt} from './map.js';
export class Scene{
  constructor(canvas){this.canvas=canvas;this.track=[];this.mode='3d';this.angle=220;this.zoom=1.25;this.time=0;this.vehicle='';this.snapshot=null;this.showSnapshot=false;this.current=null;new ResizeObserver(()=>this.draw()).observe(canvas);}
  setTrack(track,vehicle){this.track=track;this.vehicle=vehicle;}
  draw(){const surfaceData=surface(this.canvas);if(!surfaceData)return;const {ctx,w,h}=surfaceData;ctx.fillStyle=color('--bg');ctx.fillRect(0,0,w,h);let p=positionAt(this.track,this.time,this.current);if(!p)return;
    const i=lowerBound(this.track,this.time),around=this.track.slice(Math.max(0,i-30),Math.min(this.track.length,i+30)).filter(r=>r.lat&&r.lon);let heading=[0,1];for(let j=Math.max(1,i-5);j<Math.min(this.track.length,i+5);j++){const a=this.track[j-1],b=this.track[j];if(!a.lat||!b.lat||b.t-a.t>30000)continue;const v=[(b.lon-a.lon)*55660,(b.lat-a.lat)*111320];const d=Math.hypot(...v);if(d>2){heading=v.map(x=>x/d);break;}}
    const side=[heading[1],-heading[0]],local=r=>{const dx=(r.lon-p.lon)*55660,dy=(r.lat-p.lat)*111320;return [dx*side[0]+dy*side[1],dx*heading[0]+dy*heading[1]];};
    const theta=this.angle*Math.PI/180,tilt=.73,scale=Math.min(w/42,h/38)*this.zoom,top=this.mode==='2d';
    function project([x,y,z]){if(top)return[w/2+x*scale,h*.62-y*scale,-z];const X=x*Math.cos(theta)-y*Math.sin(theta),Y=x*Math.sin(theta)+y*Math.cos(theta);return[w/2+X*scale,h*.55-(Y*Math.sin(tilt)+z*Math.cos(tilt))*scale,Y*Math.cos(tilt)-z*Math.sin(tilt)];}
    function line(points,stroke,width=1,dash=[]){ctx.beginPath();points.forEach((p,i)=>{const a=project(p);i?ctx.lineTo(a[0],a[1]):ctx.moveTo(a[0],a[1]);});ctx.strokeStyle=stroke;ctx.lineWidth=width;ctx.setLineDash(dash);ctx.stroke();ctx.setLineDash([]);}
    const grid=color('--grid'),muted=color('--muted'),accent=color('--accent'),glass=color('--glass'),tram=color('--tram');
    // Static ground lattice in geographic space makes longitudinal movement visible.
    const shift=((p.lat*111320*heading[1]+p.lon*55660*heading[0])%5+5)%5;
    for(let x=-70;x<=70;x+=5)line([[x,-100,0],[x,100,0]],grid);
    for(let y=-100-shift;y<=100;y+=5)line([[-70,y,0],[70,y,0]],grid);
    let valid=[];for(let j=0;j<around.length;j++){const r=around[j];if(Math.abs(r.t-this.time)>180000)continue;const l=local(r);if(Math.hypot(...l)>250)continue;valid.push([l,r]);}
    for(let j=1;j<valid.length;j++){const [a,ra]=valid[j-1],[b,rb]=valid[j],dt=(rb.t-ra.t)/1000,d=Math.hypot(b[0]-a[0],b[1]-a[1]);if(dt<=0||dt>30||d/dt>40)continue;for(const dx of [-.76,.76])line([[a[0]+dx,a[1],0],[b[0]+dx,b[1],0]],muted,2);}
    if(valid.length<2)for(const x of [-.76,.76])line([[x,-40,0],[x,40,0]],muted,1,[4,4]);
    const faces=[];
    function box(x,y,z,dx,dy,dz,fill,ghost=false){const pts=[[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]].map(a=>[x+a[0]*dx/2,y+a[1]*dy/2,z+a[2]*dz/2]);[[0,1,2,3],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7],[4,5,6,7]].forEach((v,j)=>{const p=v.map(i=>project(pts[i]));faces.push({p,z:p.reduce((s,x)=>s+x[2],0)/4,fill,ghost,shade:[.14,.11,.09,.07,.04,0][j]});});}
    // Dimensions are a generic display model, never collision evidence.
    box(0,-3.5,.55,2.4,13,.8,muted);box(0,-3.5,2,2.6,14,2.5,tram);box(0,-3.5,3.38,2.65,13.7,.3,color('--panel'));
    for(const side of [-1,1])for(let y=-8.5;y<1;y+=2)box(side*1.32,y,2.4,.045,1.4,1.1,glass);
    box(0,3.52,2.5,2.18,.06,1.1,glass);box(0,-10.52,2.4,2.18,.06,1.1,glass);
    for(const side of [-1,1])for(const y of [-7,-6,0,1])box(side*1.04,y,.4,.32,.9,.65,glass);
    box(0,-4.1,3.65,1.4,2,.28,muted);
    let objects=[];
    if(this.showSnapshot&&this.snapshot&&this.time>=this.snapshot.t&&this.time-this.snapshot.t<=3000){const tel=this.snapshot.data;objects=tel.object?[tel.object]:(tel.trafficLights||[]);objects.forEach(o=>{const pose=o.pose||{},size=o.size||{};if(!Number.isFinite(pose.x)||!Number.isFinite(pose.y))return;const fill=o.type==='TRAFFIC_LIGHT'?muted:color('--warn');box(pose.x,pose.y,(size.height||2)/2,Math.min(size.width||2,8),Math.min(size.length||4,20),Math.min(size.height||2,7),fill,o.state!=='TRACKED');});}
    faces.sort((a,b)=>b.z-a.z).forEach(f=>{ctx.beginPath();f.p.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));ctx.closePath();if(!f.ghost){ctx.fillStyle=f.fill;ctx.fill();ctx.fillStyle=`rgba(0,0,0,${f.shade})`;ctx.fill();}ctx.strokeStyle=muted;ctx.lineWidth=f.ghost?1:.4;ctx.setLineDash(f.ghost?[3,3]:[]);ctx.stroke();ctx.setLineDash([]);});
    if(!top){line([[0,-5,3.8],[0,-3,5],[0,-5,5.8]],muted,2);line([[-1,-5,5.8],[1,-5,5.8]],muted,2);}
    line([[0,5,.15],[0,10,.15]],accent,2);line([[-.7,9,.15],[0,10,.15],[.7,9,.15]],accent,2);
    ctx.fillStyle=color('--text');ctx.font='600 13px Segoe UI';ctx.fillText('Вагон '+this.vehicle,14,24);ctx.font='11px Segoe UI';ctx.fillStyle=muted;ctx.fillText(top?'Вид сверху':'Типовая модель · обзор за вагоном',14,43);
    if(objects.length){ctx.fillStyle=color('--warn');ctx.fillText('Схема снимка: оси x/y и масштаб не подтверждены',14,62);}
  }
}
