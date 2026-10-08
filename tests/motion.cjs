const assert=require('node:assert/strict');
const fs=require('node:fs');
(async()=>{
 const {TrackModel,curveAt}=await import('data:text/javascript;base64,'+fs.readFileSync('web/motion.js').toString('base64'));
 const point=(t,x,y,speed=20)=>({t,lon:30.3+x/55660,lat:59.95+y/111320,speed,route:'6'});
 const straight=new TrackModel([point(0,0,0),point(5000,0,20),point(10000,0,40)]);
 let last=-Infinity;
 for(let t=0;t<=10000;t+=20){const p=straight.at(t);assert(p);assert(p.y>=last-1e-8);assert(p.ty>.99);last=p.y;}
 assert.equal(straight.at(-1),null);assert.equal(straight.at(10001),null);
 const gap=new TrackModel([point(0,0,0),point(5000,0,20),point(60000,0,40),point(65000,0,60)]);
 assert.equal(gap.at(30000),null);assert.equal(gap.crossedGap(4999,5010).end,60000);assert.equal(gap.next(5000),60000);
 const spike=new TrackModel([point(0,0,0),point(5000,0,20),point(6000,900,900),point(10000,0,40)]);
 assert.equal(spike.rejected,1);assert(spike.at(6000));assert(Math.abs(spike.at(6000).x)<.01);
 const stationary=new TrackModel([point(0,0,0,0),point(1000,1,1,0),point(2000,-1,1,0),point(3000,.5,0,0)]);
 assert.equal(stationary.runs[0].knots.length,1);
 const reversing=new TrackModel([point(0,0,0),point(5000,0,15),point(10000,0,25,0),point(15000,0,15),point(20000,0,0)]);
 let lastBody=null;
 for(let t=0;t<=20000;t+=100){const p=reversing.at(t);assert(p);if(lastBody!==null)assert(Math.abs(p.bodyAngle-lastBody)<=.036,'Body spun during reverse');lastBody=p.bodyAngle;}
 const turn=new TrackModel([point(0,0,0),point(5000,0,20),point(10000,5,40),point(15000,20,55),point(20000,40,60)]);
 let previous=null,maxTurn=0;
 for(let t=0;t<=20000;t+=50){const p=turn.at(t);assert(p);assert(Number.isFinite(p.tx+p.ty));if(previous)maxTurn=Math.max(maxTurn,Math.acos(Math.min(1,Math.max(-1,p.tx*previous.tx+p.ty*previous.ty))));previous=p;}
 assert(maxTurn<.08,`heading discontinuity: ${maxTurn}`);
 for(let s=0;s<turn.runs[0].length;s+=.5){const p=curveAt(turn.runs[0],s);const left=[p.x+p.ty*.76,p.y-p.tx*.76],right=[p.x-p.ty*.76,p.y+p.tx*.76];assert(Math.abs(Math.hypot(left[0]-right[0],left[1]-right[1])-1.52)<1e-8);}
 console.log(JSON.stringify({monotonicMovement:true,stationaryHeading:true,isolatedSpike:true,gapBoundary:true,railGauge:1.52,maxTurnDegrees:maxTurn*180/Math.PI}));
})().catch(e=>{console.error(e);process.exit(1);});
