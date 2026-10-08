import {METERS_LAT,METERS_LON} from './motion.js';

export const IMAGERY_URL='https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile';
export const IMAGERY_ATTRIBUTION='Esri, Vantor, Earthstar Geographics, and the GIS User Community';
export const tileXY=(lon,lat,z)=>{
  const n=2**z,r=Math.max(-85.05112878,Math.min(85.05112878,lat))*Math.PI/180;
  return {x:(lon+180)/360*n,y:(1-Math.asinh(Math.tan(r))/Math.PI)/2*n};
};
export const tileBounds=(x,y,z)=>{
  const n=2**z,latitude=v=>Math.atan(Math.sinh(Math.PI*(1-2*v/n)))*180/Math.PI;
  return {west:x/n*360-180,east:(x+1)/n*360-180,north:latitude(y),south:latitude(y+1)};
};

// Only visible tiles are streamed. No offline export or persistent tile store.
export class SatelliteGround{
  constructor(onChange){this.onChange=onChange;this.cache=new Map();this.active=0;this.status='approval-required';this.frame=0;this.lastVisible=[];this.authorized=false;}
  notify(){if(!this.frame)this.frame=requestAnimationFrame(()=>{this.frame=0;this.onChange();});}
  load(key,tile){
    if(!this.authorized)return null;
    let item=this.cache.get(key);
    if(item&&(item.state!=='error'||Date.now()-item.at<30000))return item;
    if(this.active>=6)return null;
    item={...tile,state:'loading',at:Date.now()};this.cache.set(key,item);this.active++;
    const img=new Image();img.crossOrigin='anonymous';img.referrerPolicy='no-referrer';img.decoding='async';item.image=img;
    const done=ok=>{clearTimeout(item.timer);img.onload=img.onerror=null;item.state=ok?'ready':'error';item.at=Date.now();this.active--;this.notify();};
    img.onload=()=>done(img.naturalWidth===256&&img.naturalHeight===256);img.onerror=()=>done(false);
    item.timer=setTimeout(()=>{done(false);img.src='';},12000);
    img.src=`${IMAGERY_URL}/${tile.z}/${tile.y}/${tile.x}`;return item;
  }
  draw(ctx,origin,view,opacity){
    if(!this.authorized){this.status='approval-required';return {loaded:0,total:0,status:this.status};}
    const coords=view.corners.map(p=>({lon:origin[0]+p.x/METERS_LON,lat:origin[1]+p.y/METERS_LAT}));
    // Match source resolution to the viewport; cap requests for wide/low-angle views.
    let z=Math.max(15,Math.min(19,Math.round(17+Math.log2(Math.max(.5,view.scale)/2))));
    let range;
    for(;;){
      const ps=coords.map(p=>tileXY(p.lon,p.lat,z)),n=2**z;
      range={left:Math.max(0,Math.floor(Math.min(...ps.map(p=>p.x)))),right:Math.min(n-1,Math.floor(Math.max(...ps.map(p=>p.x)))),top:Math.max(0,Math.floor(Math.min(...ps.map(p=>p.y)))),bottom:Math.min(n-1,Math.floor(Math.max(...ps.map(p=>p.y))))};
      if((range.right-range.left+1)*(range.bottom-range.top+1)<=40||z<=15)break;z--;
    }
    const tiles=[];for(let y=range.top;y<=range.bottom;y++)for(let x=range.left;x<=range.right;x++)tiles.push({x,y,z,key:`${z}/${y}/${x}`});
    const cx=(range.left+range.right)/2,cy=(range.top+range.bottom)/2;tiles.sort((a,b)=>Math.hypot(a.x-cx,a.y-cy)-Math.hypot(b.x-cx,b.y-cy));
    this.lastVisible=tiles;let loaded=0,failed=0;
    for(const tile of tiles){
      const item=this.load(tile.key,tile);if(!item||item.state==='loading')continue;if(item.state==='error'){failed++;continue;}
      loaded++;const bounds=tileBounds(tile.x,tile.y,tile.z);
      const x=(bounds.west-origin[0])*METERS_LON,y=(bounds.north-origin[1])*METERS_LAT;
      const width=(bounds.east-bounds.west)*METERS_LON,height=(bounds.north-bounds.south)*METERS_LAT;
      const a=view.project([x,y,0]),b=view.project([x+width,y,0]),c=view.project([x,y-height,0]);
      ctx.save();ctx.globalAlpha=opacity;ctx.transform((b[0]-a[0])/256,(b[1]-a[1])/256,(c[0]-a[0])/256,(c[1]-a[1])/256,a[0],a[1]);ctx.drawImage(item.image,-.15,-.15,256.3,256.3);ctx.restore();
    }
    const visibleKeys=new Set(tiles.map(t=>t.key));
    if(this.cache.size>128)for(const [key,item] of this.cache){if(this.cache.size<=128)break;if(item.state!=='loading'&&!visibleKeys.has(key))this.cache.delete(key);}
    this.status=loaded===tiles.length?'ready':failed===tiles.length?'unavailable':failed&&loaded+failed===tiles.length?'partial':'loading';
    return {loaded,total:tiles.length,status:this.status};
  }
}
