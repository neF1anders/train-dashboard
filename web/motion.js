// Display geometry only. Original coordinates and telemetry remain untouched.
export const METERS_LAT = 111320;
export const METERS_LON = 55660;
export const MAX_GAP = 30000;
const cache = new WeakMap();
const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
const valid = p => Number.isFinite(p.lat) && Number.isFinite(p.lon) && p.lat > 59.4 && p.lat < 60.5 && p.lon > 29 && p.lon < 31.5;

export function lowerBound(rows, t, key = 't') {
  let a = 0, b = rows.length;
  while (a < b) { const m = (a + b) >> 1; if (rows[m][key] < t) a = m + 1; else b = m; }
  return a;
}

function compatible(a, b) {
  const dt = b.t - a.t;
  return dt > 0 && dt <= MAX_GAP && a.route === b.route && distance(a, b) <= 6 + dt * .025;
}

function smoothRun(points, index) {
  // A small time window damps GNSS noise without rounding off genuine corners.
  const smoothed = points.map((p, i) => {
    if(i===0||i===points.length-1)return {...p};
    let x = p.x * 4, y = p.y * 4, weight = 4;
    for (const j of [i - 1, i + 1]) {
      const q = points[j];
      if (!q || Math.abs(q.t - p.t) > 6500 || distance(q, p) > 80) continue;
      x += q.x; y += q.y; weight++;
    }
    return {...p, x: x / weight, y: y / weight};
  });
  const knots = [], timed = [];
  let length = 0;
  for (const p of smoothed) {
    const previous = knots.at(-1);
    const d = previous ? distance(previous, p) : 0;
    // Keep stationary jitter from turning the vehicle through 180 degrees.
    const threshold = p.speed != null && p.speed <= 1.5 ? 4 : 2;
    if (!previous || d >= threshold) {
      length += d;
      knots.push({x: p.x, y: p.y, s: length});
    }
    timed.push({...p, s: length});
  }
  // Tangents have bounded length, so a short noisy edge cannot overshoot its neighbours.
  knots.forEach((p, i) => {
    const a = knots[Math.max(0, i - 1)], b = knots[Math.min(knots.length - 1, i + 1)];
    const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
    p.tx = d ? dx / d : 0; p.ty = d ? dy / d : 1;
  });
  const run={index, start: points[0].t, end: points.at(-1).t, points: timed, knots, length, route: points[0].route};
  let previous=null;
  for(const p of timed){
    const rear=curveAt(run,Math.max(0,p.s-6)),front=curveAt(run,Math.min(length,p.s+6));
    let angle=Math.atan2(front.x-rear.x,front.y-rear.y);
    if(previous){
      // A bidirectional tram reverses travel without spinning its body around.
      while(angle-previous.angle>Math.PI/2)angle-=Math.PI;
      while(angle-previous.angle<-Math.PI/2)angle+=Math.PI;
      const limit=Math.min((p.t-previous.t)*.00035,(p.s-previous.s)/8);
      angle=previous.angle+Math.max(-limit,Math.min(limit,angle-previous.angle));
    }
    p.angle=angle;previous=p;
  }
  return run;
}

export function curveAt(run, s) {
  const nodes = run.knots;
  if (nodes.length === 1) return {...nodes[0], tx: 0, ty: 1};
  const i = Math.max(1, Math.min(nodes.length - 1, lowerBound(nodes, s, 's')));
  const a = nodes[i - 1], b = nodes[i], d = b.s - a.s;
  const u = Math.max(0, Math.min(1, (s - a.s) / d)), u2 = u * u, u3 = u2 * u;
  const h00 = 2*u3-3*u2+1, h10 = u3-2*u2+u, h01 = -2*u3+3*u2, h11 = u3-u2;
  const x = h00*a.x + h10*d*a.tx + h01*b.x + h11*d*b.tx;
  const y = h00*a.y + h10*d*a.ty + h01*b.y + h11*d*b.ty;
  let tx = (6*u2-6*u)*a.x+(3*u2-4*u+1)*d*a.tx+(-6*u2+6*u)*b.x+(3*u2-2*u)*d*b.tx;
  let ty = (6*u2-6*u)*a.y+(3*u2-4*u+1)*d*a.ty+(-6*u2+6*u)*b.y+(3*u2-2*u)*d*b.ty;
  const norm = Math.hypot(tx,ty); tx = norm ? tx/norm : a.tx; ty = norm ? ty/norm : a.ty;
  return {x,y,tx,ty,s};
}

export class TrackModel {
  constructor(track) {
    this.track = track; this.runs = []; this.gaps = []; this.rejected = 0; this.missing = 0;
    const first = track.find(valid);
    this.origin = first ? [first.lon, first.lat] : [30.32, 59.96];
    const points = track.map(r => ({...r, x:(r.lon-this.origin[0])*METERS_LON, y:(r.lat-this.origin[1])*METERS_LAT}));
    const clean = [];
    for (let i=0; i<points.length; i++) {
      const p = points[i];
      if (!valid(p)) { this.missing++; continue; }
      const a = clean.at(-1), b = points[i+1];
      // Remove an isolated teleport only when the neighbouring observations agree.
      if (a && b && valid(b) && compatible(a,b) && !compatible(a,p) && !compatible(p,b)) { this.rejected++; continue; }
      clean.push(p);
    }
    let run = [];
    const flush = () => { if (run.length) this.runs.push(smoothRun(run, this.runs.length)); run=[]; };
    for (const p of clean) {
      if (run.length && !compatible(run.at(-1),p)) flush();
      run.push(p);
    }
    flush();
    this.runs.forEach((run,i) => {
      const next = this.runs[i+1];
      if (next) this.gaps.push({start:run.end, end:next.start, reason:next.start-run.end>MAX_GAP?'time':'position'});
    });
  }
  at(t) {
    if (!this.runs.length) return null;
    const ri = Math.max(0, lowerBound(this.runs,t,'start') - 1);
    let run = this.runs[ri];
    if (this.runs[ri+1]?.start===t) run=this.runs[ri+1];
    if (t<run.start || t>run.end) return null;
    const i = Math.min(run.points.length-1,lowerBound(run.points,t));
    const a = run.points[Math.max(0,i-1)], b=run.points[i];
    const f = a.t===b.t ? 0 : (t-a.t)/(b.t-a.t);
    const s = a.s+(b.s-a.s)*Math.max(0,Math.min(1,f));
    const p = curveAt(run,s);
    // The bogie chord gives a stable body orientation at bends and at a stop.
    const rear = curveAt(run,Math.max(0,s-4)), front = curveAt(run,Math.min(run.length,s+4));
    const d = distance(rear,front);
    const tx = d>.5?(front.x-rear.x)/d:p.tx, ty=d>.5?(front.y-rear.y)/d:p.ty;
    const bodyAngle=a.angle+(b.angle-a.angle)*Math.max(0,Math.min(1,f));
    return {...a,...p,tx,ty,bodyTx:Math.sin(bodyAngle),bodyTy:Math.cos(bodyAngle),bodyAngle,t,run,lat:this.origin[1]+p.y/METERS_LAT,lon:this.origin[0]+p.x/METERS_LON,
      interpolated:t!==a.t,method:'smoothed-gps',speed:a.speed==null?b.speed:a.speed,headingKnown:run.length>2};
  }
  before(t) {
    const i = lowerBound(this.runs,t,'start')-1;
    return i>=0 ? this.at(Math.min(t,this.runs[i].end)) : null;
  }
  next(t) {
    const i=lowerBound(this.runs,t+1,'start'); return this.runs[i]?.start ?? null;
  }
  crossedGap(a,b) {
    const i=Math.max(0,lowerBound(this.gaps,a,'start')-1);
    for(let j=i;j<this.gaps.length && this.gaps[j].start<=b;j++) {
      const g=this.gaps[j];if(a<=g.start && b>g.start)return g;
    }
    return null;
  }
  geometry(p, radius=180, step=2) {
    if(!p)return [];
    const result=[],from=Math.max(0,p.s-radius),to=Math.min(p.run.length,p.s+radius);
    for(let s=Math.floor(from/step)*step;s<to;s+=step)result.push(curveAt(p.run,Math.max(0,s)));
    result.push(curveAt(p.run,to));return result;
  }
}

export function prepareTrack(track) {
  if(!cache.has(track))cache.set(track,new TrackModel(track));
  return cache.get(track);
}
export function positionAt(track,t) { return prepareTrack(track).at(t); }
