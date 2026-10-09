import {renderEpisodeCard,targetName} from './dashboard.js';
import {surface,color,lowerBound} from './map.js';

const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const clock=(t,ms=false)=>new Date(t+10800000).toISOString().slice(11,ms?23:19);
const dayName=d=>new Date(d+'T12:00:00+03:00').toLocaleDateString('ru-RU',{day:'numeric',month:'long',year:'numeric'});
const num=(v,d=1)=>v==null?'—':Number(v).toLocaleString('ru-RU',{maximumFractionDigits:d});
const TYPE={Brake:'Торможение',Warn:'Предупреждение',OverSpeed:'Превышение скорости'};
const SEVERITY={brake:['Торможение','--brake','islands#redCircleDotIcon'],warn:['Предупреждение','--warn','islands#orangeCircleDotIcon'],overspeed:['Превышение скорости','--purple','islands#violetCircleDotIcon']};
const HANDLE={driver:'водитель',cpilot:'система (cpilot)',undeterminable:'не определён'};
function el(tag,text,className){const e=document.createElement(tag);if(text!=null)e.textContent=text;if(className)e.className=className;return e;}
let noticeTimer;function notice(text){clearTimeout(noticeTimer);$('#notification').textContent=text;$('#notification').hidden=false;noticeTimer=setTimeout(()=>$('#notification').hidden=true,6000);}
async function api(path,params={}){const r=await fetch('/api/'+path+'?'+new URLSearchParams(params));const d=await r.json().catch(()=>({error:'Сервер вернул неверный ответ'}));if(!r.ok)throw Error(d.error||'Ошибка запроса');return d;}
const safe=fn=>(...a)=>Promise.resolve().then(()=>fn(...a)).catch(e=>notice(e.message));

const state={vehicle:null,day:null,filter:'all',incident:null,cursor:null};
let vehicles=[],route=null,settings=null,ymap=null,mapObjects=null,cursorMark=null,mapReady=null,detailToken=0;

/* ---------- Screen 1: vehicle by number ---------- */
async function boot(){
  const theme=localStorage.getItem('sirius-theme')||(matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light');document.documentElement.dataset.theme=theme;
  settings=await api('settings');const d=await api('vehicles');vehicles=d.vehicles;
  if(d.demo){$('#archive-badge').textContent='Демо-данные';$('#archive-badge').classList.add('demo');}
  $('#vehicle-options').replaceChildren(...vehicles.map(v=>new Option('Вагон '+v.vehicle,v.vehicle)));
  $('#pick-hint').textContent=vehicles.length?`В архиве ${vehicles.length} ваг. · ${vehicles.reduce((s,v)=>s+v.incidents,0)} групп срабатываний`:'Архив пуст: выполните импорт (python -m app.ingest) или демо (python -m app.demo).';
  const grid=$('#vehicle-grid');grid.replaceChildren();
  for(const v of vehicles){
    const b=el('button',undefined,'vehicle-card');b.type='button';
    b.append(el('span','Вагон','vehicle-label'),el('strong',v.vehicle,'vehicle-number'),
      el('span',`${v.days.length} ${v.days.length===1?'день':'дн.'} · ${num(v.hours)} ч · маршруты ${v.routes.map(r=>r==='0'?'?':r).join(', ')}`,'vehicle-meta'),
      el('span',v.incidents?`${v.incidents} срабатываний`:'без срабатываний','vehicle-incidents'+(v.incidents?'':' none')));
    b.onclick=safe(()=>openVehicle(v.vehicle));grid.append(b);
  }
  const m=location.hash.match(/^#vehicle=(\w+)(?:&day=([\d-]+))?(?:&incident=(\d+))?/);if(m)await openVehicle(m[1],m[2],m[3]&&+m[3]);
}
$('#pick-form').onsubmit=e=>{e.preventDefault();const raw=$('#vehicle-input').value.trim().replace(/\D/g,'');if(!raw){notice('Введите номер вагона');return;}
  const v=vehicles.find(v=>v.vehicle===raw.padStart(4,'0')||v.vehicle===raw);if(!v){notice(`Вагона ${raw} нет в архиве. Доступны: ${vehicles.map(v=>v.vehicle).join(', ')}`);return;}safe(()=>openVehicle(v.vehicle))();};

/* ---------- Screen 2: route, map, timeline, incident ---------- */
async function openVehicle(vehicle,day,incidentId){
  const v=vehicles.find(x=>x.vehicle===vehicle);if(!v)throw Error('Вагон не найден');
  state.vehicle=vehicle;state.day=day&&v.days.includes(day)?day:(v.days.find(d=>v.day_incidents?.[d])||v.days[0]);
  $('#pick-view').hidden=true;$('#route-view').hidden=false;$('#route-title').textContent='Вагон '+vehicle;
  const sel=$('#day-select');sel.replaceChildren(...v.days.map(d=>new Option(`${dayName(d)}${v.day_incidents?.[d]?' · '+v.day_incidents[d]+' сраб.':''}`,d)));sel.value=state.day;
  await loadDay(incidentId);
}
async function loadDay(incidentId){
  closeIncident();route=await api('route',{vehicle:state.vehicle,day:state.day});state.cursor=route.start;
  history.replaceState(null,'',`#vehicle=${state.vehicle}&day=${state.day}`);
  const counts={brake:0,warn:0,overspeed:0};for(const i of route.incidents)counts[i.severity]++;
  $('#route-summary').textContent=`${clock(route.start)}–${clock(route.end)} · ${route.points.length} точек · ${route.incidents.length} инцидентов (${counts.brake} с торможением)`;
  renderList();timeline.setData(route);await drawMap(true);
  if(incidentId){const i=route.incidents.find(i=>i.id===incidentId);if(i)await openIncident(i);}
}
const visible=()=>route.incidents.filter(i=>state.filter==='all'||i.severity===state.filter);
function renderList(){
  const list=$('#incident-list');list.replaceChildren();
  for(const i of visible()){const b=el('button',undefined,'incident-row');b.type='button';b.dataset.id=i.id;
    b.append(el('i',undefined,'dot '+i.severity),el('span',`${clock(i.start)} · ${i.types.map(t=>TYPE[t]||t).join(' → ')}`),el('small',(i.targets.map(targetName).join(', ')||'цель не указана')+` · ${num(i.speed)} км/ч`));
    b.onclick=safe(()=>openIncident(i));list.append(b);}
  if(!visible().length)list.append(el('p','Нет инцидентов этого типа за выбранный день.','muted small'));
}

/* Yandex Maps 2.1. Key: env YANDEX_MAPS_API_KEY or data/local-settings.json → maps.yandex_api_key. */
function loadYandex(){
  if(mapReady)return mapReady;
  mapReady=new Promise((resolve,reject)=>{
    if(window.ymaps){ymaps.ready(resolve);return;}
    const s=document.createElement('script'),key=settings?.maps?.yandex_api_key;
    s.src='https://api-maps.yandex.ru/2.1/?lang=ru_RU'+(key?'&apikey='+encodeURIComponent(key):'');s.async=true;
    s.onload=()=>window.ymaps?ymaps.ready(resolve,reject):reject(Error('ymaps not defined'));s.onerror=()=>reject(Error('script error'));
    setTimeout(()=>reject(Error('timeout')),15000);document.head.append(s);
  });
  return mapReady;
}
async function drawMap(fit){
  try{await loadYandex();}catch(e){
    $('#map-message').hidden=false;$('#map-message').replaceChildren(el('strong','Яндекс Карты не загрузились'),el('p','Проверьте доступ к api-maps.yandex.ru. Если нужен ключ, задайте YANDEX_MAPS_API_KEY или maps.yandex_api_key в data/local-settings.json. Таймлайн и инциденты работают и без карты.','small'));return;}
  $('#map-message').hidden=true;
  if(!ymap){
    ymap=new ymaps.Map('ymap',{center:[59.94,30.31],zoom:12,controls:['zoomControl','typeSelector','fullscreenControl','rulerControl']},{suppressMapOpenBlock:true});
    ymap.events.add('click',()=>{});
  }
  if(mapObjects)ymap.geoObjects.remove(mapObjects);mapObjects=new ymaps.GeoObjectCollection();
  const coords=route.points.map(p=>[p.lat,p.lon]);
  // Route line split at recording gaps, so a gap is never drawn as movement.
  let segment=[];const flush=()=>{if(segment.length>1)mapObjects.add(new ymaps.Polyline(segment,{},{strokeColor:'#146da2',strokeWidth:3,strokeOpacity:.35}));segment=[];};
  route.points.forEach((p,i)=>{if(i&&route.gaps.some(([a,b])=>route.points[i-1].t<=a&&p.t>=b))flush();segment.push([p.lat,p.lon]);});flush();
  const dotLayout=ymaps.templateLayoutFactory.createClass('<div class="route-dot"></div>');
  const step=Math.max(1,Math.ceil(route.points.length/400));
  route.points.forEach((p,i)=>{if(i%step)return;const pm=new ymaps.Placemark([p.lat,p.lon],{hintContent:`${clock(p.t)} · ${num(p.speed)} км/ч`},{iconLayout:dotLayout,iconShape:{type:'Circle',coordinates:[0,0],radius:6},iconOffset:[-4,-4]});
    pm.events.add('click',()=>{setCursor(p.t,false);showPoint(p);});mapObjects.add(pm);});
  for(const i of visible()){if(i.lat==null)continue;
    const pm=new ymaps.Placemark([i.lat,i.lon],{hintContent:`${clock(i.start)} · ${i.types.map(t=>TYPE[t]||t).join(' → ')}`,iconCaption:clock(i.start).slice(0,5)},{preset:SEVERITY[i.severity][2],zIndex:700});
    pm.events.add('click',()=>safe(()=>openIncident(i))());mapObjects.add(pm);}
  cursorMark=new ymaps.Placemark(coords[0]||[59.94,30.31],{hintContent:'Курсор'},{preset:'islands#blueDotIcon',zIndex:900});mapObjects.add(cursorMark);
  ymap.geoObjects.add(mapObjects);
  if(fit&&coords.length)ymap.setBounds(mapObjects.getBounds(),{checkZoomRange:true,zoomMargin:30});
  moveCursorMark();
}
function moveCursorMark(){
  if(!cursorMark||!route?.points.length)return;const i=Math.max(0,lowerBound(route.points,state.cursor+1)-1),p=route.points[i];cursorMark.geometry.setCoordinates([p.lat,p.lon]);
}
function setCursor(t,pan=true){
  state.cursor=t;timeline.update();$('#timeline-cursor').textContent=clock(t);moveCursorMark();
  if(pan&&ymap&&cursorMark)ymap.panTo(cursorMark.geometry.getCoordinates(),{flying:true,duration:300});
}
function showPoint(p){
  closeIncident();const box=$('#incident-detail');box.hidden=false;$('#incident-empty').hidden=true;box.replaceChildren();
  const head=el('div',undefined,'detail-head');head.append(el('h2','Точка маршрута'),closeButton());box.append(head);
  const dl=el('dl',undefined,'state-facts');for(const[k,v]of[['Время',clock(p.t,true)],['Скорость',num(p.speed)+' км/ч'],['Маршрут',p.route],['Управление',HANDLE[p.handle]||p.handle||'—'],['Координаты',`${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`]])dl.append(el('dt',k),el('dd',v));
  box.append(dl);const near=route.incidents.filter(i=>Math.abs(i.start-p.t)<180000);
  if(near.length){box.append(el('h3','Инциденты рядом (±3 мин)','state-sub'));for(const i of near){const b=el('button',`${clock(i.start)} · ${i.types.map(t=>TYPE[t]||t).join(' → ')}`,'incident-row');b.onclick=safe(()=>openIncident(i));box.append(b);}}
  else box.append(el('p','В пределах 3 минут инцидентов нет.','muted small'));
}
function closeButton(){const c=el('button','✕','icon-button');c.setAttribute('aria-label','Закрыть');c.onclick=closeIncident;return c;}
function closeIncident(){state.incident=null;$('#incident-detail').hidden=true;$('#incident-empty').hidden=false;timeline?.update();history.replaceState(null,'',state.vehicle?`#vehicle=${state.vehicle}&day=${state.day}`:'#');}

async function openIncident(i){
  const token=++detailToken;state.incident=i;setCursor(i.start);
  history.replaceState(null,'',`#vehicle=${state.vehicle}&day=${state.day}&incident=${i.id}`);
  const box=$('#incident-detail');box.hidden=false;$('#incident-empty').hidden=true;box.replaceChildren(el('p','Разбираем инцидент…','muted'));
  if(ymap&&i.lat!=null)ymap.setCenter([i.lat,i.lon],Math.max(ymap.getZoom(),16),{duration:300});
  const d=await api('incident',{vehicle:state.vehicle,start:i.start,end:i.end,route:i.route});if(token!==detailToken)return;
  box.replaceChildren();const [label,colorVar]=SEVERITY[i.severity];
  const head=el('div',undefined,'detail-head'),title=el('div');title.append(el('span',label,'severity '+i.severity),el('h2',`${clock(i.start)}–${clock(i.end)}`),el('p',`${i.types.map(t=>TYPE[t]||t).join(' → ')} · ${i.targets.map(targetName).join(', ')||'цель не указана'} · маршрут ${i.route} · ${i.records} записей`,'muted small'));
  head.append(title,closeButton());box.append(head);
  const facts=el('div',undefined,'incident-facts');const lines=d.card||[];
  const pick=k=>lines.find(l=>l.kind===k);const stop=pick('stop'),before=pick('speed_at'),decel=pick('decel');
  for(const[k,v]of[['Скорость в начале',before?before.text.split(': ').pop().replace(/\.$/,''):num(i.speed)+' км/ч'],['Остановка',stop?clock(stop.t)+` (${stop.text.match(/через ([\d.]+ с)/)?.[1]||''})`:'нет'],['Замедление',decel?decel.text.match(/≈ ([\d.]+ м\/с²)/)?.[1]:'—'],['Тормоза',lines.filter(l=>l.kind==='brake').map(l=>l.text.match(/: (\S+) тормоз/)?.[1]).filter(Boolean).join(', ')||'нет сигнала']]){const c=el('div');c.append(el('span',k),el('strong',v));facts.append(c);}
  box.append(facts,sparkline(d.speed_profile,i,colorVar),el('p',d.narrative,'incident-narrative'));
  const card=el('div',undefined,'episode-card compact');renderEpisodeCard(card,lines,id=>{const l=lines.find(l=>l.evidence_ids.includes(id));if(l?.t)setCursor(l.t);});box.append(card);
  const more=el('a','Открыть подробный разбор (графики, 3D, исходные записи) →','text-button');
  more.href=`/classic.html#work?${new URLSearchParams({vehicle:state.vehicle,day:state.day,route:i.route,start:i.start-15000,end:i.end+15000,time:i.start,mode:'3d'})}`;box.append(more);
}
function sparkline(rows,i,colorVar){
  const c=el('canvas',undefined,'sparkline');requestAnimationFrame(()=>{const s=surface(c);if(!s||!rows.length)return;const{ctx,w,h}=s,from=rows[0].t,to=rows.at(-1).t,max=Math.max(20,...rows.map(r=>r.speed));
    const x=t=>4+(t-from)/Math.max(1,to-from)*(w-8),y=v=>h-14-v/max*(h-24);
    ctx.fillStyle=color(colorVar);ctx.globalAlpha=.15;ctx.fillRect(x(i.start),0,Math.max(3,x(i.end)-x(i.start)),h-12);ctx.globalAlpha=1;
    ctx.strokeStyle=color('--accent');ctx.lineWidth=2;ctx.beginPath();rows.forEach((r,k)=>k?ctx.lineTo(x(r.t),y(r.speed)):ctx.moveTo(x(r.t),y(r.speed)));ctx.stroke();
    ctx.fillStyle=color('--muted');ctx.font='10px Inter,Segoe UI,sans-serif';ctx.fillText(clock(from),4,h-2);ctx.textAlign='right';ctx.fillText(clock(to),w-4,h-2);ctx.fillText(`макс ${Math.round(max)} км/ч`,w-4,10);});
  return c;
}

/* Day timeline: route samples as dots (height = speed), incidents as circles on top lane. */
const timeline={
  canvas:$('#day-timeline'),hover:null,
  setData(r){this.r=r;this.update();},
  x(t,w){return 12+(t-this.r.start)/Math.max(1,this.r.end-this.r.start)*(w-24);},
  t(x,w){return this.r.start+(x-12)/(w-24)*(this.r.end-this.r.start);},
  update(){
    if(!this.r)return;const s=surface(this.canvas);if(!s)return;const{ctx,w,h}=s,r=this.r,top=34,bottom=h-22;
    const max=Math.max(30,...r.points.map(p=>p.speed||0)),y=v=>bottom-Math.min(max,v||0)/max*(bottom-top);
    for(const[a,b]of r.gaps){ctx.fillStyle=color('--border');ctx.fillRect(this.x(a,w),top-4,this.x(b,w)-this.x(a,w),bottom-top+8);}
    ctx.fillStyle=color('--accent');ctx.globalAlpha=.55;for(const p of r.points){ctx.beginPath();ctx.arc(this.x(p.t,w),y(p.speed),1.6,0,7);ctx.fill();}ctx.globalAlpha=1;
    this.hits=[];for(const i of visible()){const px=this.x(i.start,w),cv=SEVERITY[i.severity][1],sel=state.incident?.id===i.id;
      ctx.fillStyle=color(cv);ctx.globalAlpha=.13;ctx.fillRect(px,top-4,Math.max(2,this.x(i.end,w)-px),bottom-top+8);ctx.globalAlpha=1;
      ctx.beginPath();ctx.arc(px,16,sel?8:6,0,7);ctx.fill();if(sel){ctx.strokeStyle=color('--text');ctx.lineWidth=2;ctx.stroke();}this.hits.push({x:px,i});}
    ctx.fillStyle=color('--muted');ctx.font='11px Inter,Segoe UI,sans-serif';ctx.textBaseline='alphabetic';const ticks=w<600?3:6;
    for(let k=0;k<=ticks;k++){const t=r.start+(r.end-r.start)*k/ticks;ctx.textAlign=k===0?'left':k===ticks?'right':'center';ctx.fillText(clock(t).slice(0,5),this.x(t,w),h-5);}
    if(state.cursor!=null){const cx=this.x(state.cursor,w);ctx.strokeStyle=color('--text');ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(cx,4);ctx.lineTo(cx,bottom+4);ctx.stroke();}
    if(this.hover!=null){const hx=this.hover.x;ctx.strokeStyle=color('--accent');ctx.setLineDash([3,3]);ctx.beginPath();ctx.moveTo(hx,4);ctx.lineTo(hx,bottom+4);ctx.stroke();ctx.setLineDash([]);
      const text=this.hover.text;ctx.font='600 11px Inter,Segoe UI,sans-serif';const tw=ctx.measureText(text).width+14,left=Math.max(4,Math.min(w-tw-4,hx+8));ctx.fillStyle=color('--dark');ctx.fillRect(left,top,tw,22);ctx.fillStyle=color('--on-dark');ctx.textAlign='left';ctx.fillText(text,left+7,top+15);}
  },
  pick(x){const w=this.canvas.clientWidth,hit=this.hits?.reduce((b,h)=>Math.abs(h.x-x)<=9&&(!b||Math.abs(h.x-x)<Math.abs(b.x-x))?h:b,null);
    if(hit)return{incident:hit.i,t:hit.i.start};const t=this.t(x,w),k=Math.max(0,Math.min(this.r.points.length-1,lowerBound(this.r.points,t)));return{point:this.r.points[k],t:this.r.points[k]?.t??t};},
};
timeline.canvas.addEventListener('pointermove',e=>{if(!timeline.r)return;const p=timeline.pick(e.offsetX);timeline.hover={x:e.offsetX,text:p.incident?`${clock(p.incident.start)} · ${p.incident.types.map(t=>TYPE[t]||t).join(' → ')}`:p.point?`${clock(p.point.t)} · ${num(p.point.speed)} км/ч`:''};timeline.update();});
timeline.canvas.addEventListener('pointerleave',()=>{timeline.hover=null;timeline.update();});
timeline.canvas.addEventListener('click',e=>{if(!timeline.r)return;const p=timeline.pick(e.offsetX);if(p.incident)safe(()=>openIncident(p.incident))();else if(p.point){setCursor(p.point.t);showPoint(p.point);}});
timeline.canvas.addEventListener('keydown',e=>{if(!route)return;const list=visible();if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();const next=e.key==='ArrowRight'?list.find(i=>i.start>state.cursor+1):list.findLast(i=>i.start<state.cursor-1);if(next)safe(()=>openIncident(next))();}});
new ResizeObserver(()=>timeline.update()).observe(timeline.canvas);

$('#day-select').onchange=e=>{state.day=e.target.value;safe(()=>loadDay())();};
$$('[data-filter]').forEach(b=>b.onclick=()=>{state.filter=b.dataset.filter;$$('[data-filter]').forEach(x=>x.setAttribute('aria-pressed',x===b));renderList();timeline.update();safe(()=>drawMap(false))();});
$('#back').onclick=()=>{closeIncident();$('#route-view').hidden=true;$('#pick-view').hidden=false;history.replaceState(null,'','#');};
$('.brand').onclick=e=>{e.preventDefault();$('#back').click();};
$('#theme-button').onclick=()=>{const t=document.documentElement.dataset.theme==='dark'?'light':'dark';document.documentElement.dataset.theme=t;localStorage.setItem('sirius-theme',t);timeline.update();};
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&state.incident)closeIncident();});
safe(boot)();
