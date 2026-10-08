const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export const CAMERA_DEFAULTS={angle:220,pitch:42,zoom:1.25};

// Orthographic orbit camera. Ground-plane inverse is also used for dragging
// and cursor-anchored zoom, so navigation and map projection cannot diverge.
export class OrbitCamera{
  constructor(canvas,onChange){
    Object.assign(this,CAMERA_DEFAULTS,{canvas,onChange,center:{x:0,y:0},following:true,pointers:new Map()});
    this.bind();
  }
  reset(){Object.assign(this,CAMERA_DEFAULTS,{following:true});this.changed();}
  changed(){this.angle=(this.angle%360+360)%360;this.pitch=clamp(this.pitch,20,85);this.zoom=clamp(this.zoom,.25,4);this.onChange();}
  view(w,h,mode,target){
    if(target&&this.following)this.center={x:target.x,y:target.y};
    const {x:cx,y:cy}=this.center,theta=this.angle*Math.PI/180,cos=Math.cos(theta),sin=Math.sin(theta),tilt=this.pitch*Math.PI/180,top=mode==='2d';
    const scale=Math.min(w/62,h/48)*this.zoom,ox=w/2,oy=h*(top?.56:.57),st=Math.sin(tilt),ct=Math.cos(tilt);
    const project=([x,y,z=0])=>{
      const dx=x-cx,dy=y-cy,X=dx*cos-dy*sin,Y=dx*sin+dy*cos;
      return top?[ox+dx*scale,oy-dy*scale,-z]:[ox+X*scale,oy-(Y*st+z*ct)*scale,Y*ct-z*st];
    };
    const unproject=(x,y)=>{const X=(x-ox)/scale,Y=(oy-y)/scale/(top?1:st);return top?{x:cx+X,y:cy+Y}:{x:cx+X*cos+Y*sin,y:cy-X*sin+Y*cos};};
    const corners=[[0,0],[w,0],[w,h],[0,h]].map(([x,y])=>unproject(x,y));
    this.lastView={w,h,mode,scale,project,unproject,corners};return this.lastView;
  }
  pan(dx,dy){
    const view=this.lastView;if(!view)return;
    const a=view.unproject(0,0),b=view.unproject(dx,dy);this.center.x-=b.x-a.x;this.center.y-=b.y-a.y;this.following=false;this.changed();
  }
  zoomAt(factor,x,y){
    const view=this.lastView;if(!view)return;const before=view.unproject(x,y);
    this.zoom=clamp(this.zoom*factor,.25,4);const after=this.view(view.w,view.h,view.mode).unproject(x,y);
    this.center.x+=before.x-after.x;this.center.y+=before.y-after.y;this.following=false;this.changed();
  }
  bind(){
    const canvas=this.canvas,local=e=>{const r=canvas.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top};};
    const pair=()=>{const [a,b]=[...this.pointers.values()];return {x:(a.x+b.x)/2,y:(a.y+b.y)/2,d:Math.hypot(a.x-b.x,a.y-b.y)};};
    canvas.addEventListener('contextmenu',e=>e.preventDefault());
    canvas.addEventListener('pointerdown',e=>{
      if(![0,1,2].includes(e.button))return;e.preventDefault();canvas.focus({preventScroll:true});
      this.pointers.set(e.pointerId,{...local(e),pan:e.button!==0||e.shiftKey});canvas.setPointerCapture(e.pointerId);canvas.classList.add('is-dragging');
    });
    canvas.addEventListener('pointermove',e=>{
      const previous=this.pointers.get(e.pointerId);if(!previous)return;e.preventDefault();const next={...local(e),pan:previous.pan};
      if(this.pointers.size>=2){const a=pair();this.pointers.set(e.pointerId,next);const b=pair();this.pan(b.x-a.x,b.y-a.y);if(a.d>5&&b.d>5)this.zoomAt(b.d/a.d,b.x,b.y);return;}
      this.pointers.set(e.pointerId,next);const dx=next.x-previous.x,dy=next.y-previous.y;
      if(previous.pan||e.shiftKey||this.lastView?.mode==='2d')this.pan(dx,dy);
      else{this.angle+=dx*.4;this.pitch-=dy*.25;this.changed();}
    });
    const release=e=>{this.pointers.delete(e.pointerId);if(!this.pointers.size)canvas.classList.remove('is-dragging');};
    for(const event of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(event,release);
    canvas.addEventListener('wheel',e=>{e.preventDefault();const p=local(e),delta=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?canvas.clientHeight:1);this.zoomAt(Math.exp(-clamp(delta,-240,240)*.002),p.x,p.y);},{passive:false});
    canvas.addEventListener('dblclick',e=>{e.preventDefault();this.reset();});
    canvas.addEventListener('keydown',e=>{
      const direction={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[e.key];
      if(direction){e.preventDefault();e.stopPropagation();const [x,y]=direction;if(e.shiftKey||this.lastView?.mode==='2d')this.pan(x*24,y*24);else{this.angle+=x*5;this.pitch-=y*3;this.changed();}}
      else if(['+','=','-','0','Home'].includes(e.key)){e.preventDefault();e.stopPropagation();if(e.key==='0'||e.key==='Home')this.reset();else this.zoomAt(e.key==='-'?1/1.15:1.15,this.canvas.clientWidth/2,this.canvas.clientHeight*.57);}
    });
    window.addEventListener('blur',()=>{this.pointers.clear();canvas.classList.remove('is-dragging');});
  }
}
