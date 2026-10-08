import {METERS_LAT,METERS_LON} from './motion.js';
import {color} from './map.js';

// Local OSM street geometry, cached as vector paths and projected onto z=0.
// This is a city plan, not an elevation model or a measured track alignment.
export class CityGround{
  constructor(onChange){this.onChange=onChange;this.cache=new Map();this.status='loading';}
  reset(){this.abort?.abort();this.key=null;this.pending=null;this.tile=null;this.status='loading';}
  async request(p){
    const cx=Math.round(p.lon*METERS_LON/128)*128,cy=Math.round(p.lat*METERS_LAT/128)*128,key=cx+':'+cy;
    if(key===this.key||key===this.pending)return;
    if(this.cache.has(key)){this.tile=this.cache.get(key);this.key=key;this.status='ready';return;}
    this.abort?.abort();const abort=new AbortController();this.abort=abort;this.pending=key;
    const bounds=[(cx-256)/METERS_LON,(cy-256)/METERS_LAT,(cx+256)/METERS_LON,(cy+256)/METERS_LAT];
    try{
      const response=await fetch('/api/map?'+new URLSearchParams({bounds:bounds.join(',')}),{signal:abort.signal});
      if(!response.ok)throw Error('Map unavailable');const result=await response.json();if(abort.signal.aborted)return;
      this.tile={cx,cy,features:result.features.filter(f=>f.kind==='street')};this.key=key;this.status='ready';
      this.cache.set(key,this.tile);if(this.cache.size>24)this.cache.delete(this.cache.keys().next().value);
    }catch(e){if(e.name==='AbortError')return;this.status='unavailable';this.key=key;this.tile=null;}
    finally{if(this.pending===key)this.pending=null;}
    this.onChange();
  }
  prepare(tile){
    if(tile.path)return;tile.path=new Path2D();tile.labels=[];const names=new Set();
    const point=([lon,lat])=>[lon*METERS_LON-tile.cx+256,tile.cy+256-lat*METERS_LAT];
    for(const f of tile.features){
      const points=f.points.map(point);points.forEach((p,i)=>i?tile.path.lineTo(...p):tile.path.moveTo(...p));
      if(!f.name||names.has(f.name))continue;
      // Put the name at the closest point of the street to this tile's center.
      let best=null,dist=Infinity;
      for(let i=1;i<points.length;i++){
        const a=points[i-1],b=points[i],dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((256-a[0])*dx+(256-a[1])*dy)/(dx*dx+dy*dy||1))),p=[a[0]+t*dx,a[1]+t*dy],d=Math.hypot(p[0]-256,p[1]-256);
        if(d<dist){dist=d;best=p;}
      }
      if(!best||dist>220||tile.labels.some(q=>Math.hypot(q.x-best[0],q.y-best[1])<30))continue;
      tile.labels.push({x:best[0],y:best[1]-7,name:f.name});names.add(f.name);
    }
  }
  draw(ctx,p,origin,project,opacity){
    this.request(p);const tile=this.tile;if(!tile)return false;
    this.prepare(tile);
    const x=tile.cx-256-origin[0]*METERS_LON,y=tile.cy+256-origin[1]*METERS_LAT;
    const a=project([x,y,0]),b=project([x+512,y,0]),c=project([x,y-512,0]);
    ctx.save();ctx.globalAlpha=opacity;ctx.transform((b[0]-a[0])/512,(b[1]-a[1])/512,(c[0]-a[0])/512,(c[1]-a[1])/512,a[0],a[1]);
    ctx.beginPath();ctx.rect(0,0,512,512);ctx.clip();ctx.lineJoin='round';ctx.lineCap='round';
    ctx.strokeStyle=color('--muted');ctx.lineWidth=10;ctx.stroke(tile.path);ctx.strokeStyle=color('--map-road');ctx.lineWidth=9;ctx.stroke(tile.path);
    ctx.font='2.6px Segoe UI';ctx.textAlign='center';ctx.textBaseline='middle';
    for(const label of tile.labels){ctx.strokeStyle=color('--bg');ctx.lineWidth=.8;ctx.strokeText(label.name,label.x,label.y);ctx.fillStyle=color('--text');ctx.fillText(label.name,label.x,label.y);}
    ctx.restore();return true;
  }
}
