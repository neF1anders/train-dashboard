import {CityMap,surface,color,lowerBound,positionAt} from './map.js';
import {Scene} from './scene.js';
import {Timeline} from './timeline.js';
import {eventName} from './map.js';
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const state={vehicle:'3139',day:'2026-09-14',route:'6',start:0,end:0,time:0,mode:'3d',map:false,analysisId:null};
let catalog=[],trip=null,windowData=null,analysis=null,exact=null,playing=false,frameId=0,lastTick=0,loadVersion=0,frameVersion=0,saveTimer,rangeTimer,noticeTimer,placeTimer,placeToken=0,passes=[];
const rawCache=new Map();
let timelineZoom=false,motion=null,previewTime=null,previewFrame=null,previewTimer,previewAbort,frameAbort;
let playbackData=null,bufferPending=null,bufferAbort=null,windowAbort=null,windowVersion=0,bufferVersion=0,lastPlaceUpdate=0;
let mapCluster=null,mapListLimit=30,timelineKey='',mapFocus=null,haltedGap=null;
const displayTime=()=>previewTime??state.time;
const time=(t,ms=false)=>new Date(t+10800000).toISOString().slice(11,ms?23:19);
const date=t=>new Date(t+10800000).toLocaleDateString('ru-RU',{timeZone:'UTC',day:'numeric',month:'long',year:'numeric'});
const inputDate=t=>new Date(t+10800000).toISOString().slice(0,23);
const parseDate=v=>Date.parse(v+'+03:00');
const n=(v,d=1)=>v==null?'—':Number(v).toLocaleString('ru-RU',{maximumFractionDigits:d});
const routeName=r=>r==='all'?'Все маршруты':r==='0'?'Маршрут не определён':'Маршрут '+r;
const handleName=h=>({driver:'Водитель',cpilot:'cpilot',undeterminable:'Не определено'})[h]||h||'Нет данных';
function notice(text){clearTimeout(noticeTimer);$('#notification').textContent=text;$('#notification').hidden=false;noticeTimer=setTimeout(()=>$('#notification').hidden=true,6500);}
async function api(path,params={},body,signal){const r=await fetch('/api/'+path+(body?'':'?'+new URLSearchParams(params)),body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal}:{signal});let d;try{d=await r.json();}catch{throw Error('Сервер недоступен или вернул неверный ответ.');}if(!r.ok)throw Error(d.error||'Не удалось выполнить запрос');return d;}
const safe=fn=>(...args)=>Promise.resolve().then(()=>fn(...args)).catch(e=>{if(e.name!=='AbortError')notice(e.message);});
function element(tag,text,className){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(className)e.className=className;return e;}
function options(select,values,chosen){select.replaceChildren();values.forEach(([value,label])=>select.add(new Option(label,value)));if(values.some(v=>v[0]===chosen))select.value=chosen;}
function setTheme(theme){document.documentElement.dataset.theme=theme;localStorage.setItem('sirius-theme',theme);redraw();}
const scene=new Scene($('#scene'));
scene.satellite.authorized=localStorage.getItem('sirius-esri-consent')==='tiles-v1';
async function loadSettings(){
  const settings=await api('settings');scene.satellite.authorized ||= settings.imagery.esri_allowed;
  const preference=localStorage.getItem('sirius-ground-style');
  scene.groundStyle=['satellite','streets'].includes(preference)?preference:settings.imagery.default_style;
  $('#ground-style').value=scene.groundStyle;
}
scene.onCameraChange=()=>{
  $('#camera-angle').value=scene.angle;$('#camera-pitch').value=scene.camera.pitch;$('#scene-zoom').value=scene.zoom;
  $('#camera-follow-state').textContent=scene.camera.following?'Камера за вагоном':'Свободный обзор';
};
let groundStatusKey='';
scene.onGroundStatus=status=>{
  const key=[scene.showGround,scene.groundStyle,status].join('|');if(key===groundStatusKey)return;groundStatusKey=key;
  $('#ground-style').disabled=!scene.showGround;$('#ground-opacity').disabled=!scene.showGround;$('#ground-attribution').hidden=!scene.showGround;
  $('#satellite-consent').hidden=!scene.showGround||scene.groundStyle!=='satellite'||scene.satellite.authorized;
  $('#ground-status').textContent=!scene.showGround?'':scene.groundStyle==='streets'?(status==='ready'?'Локальная карта':status==='unavailable'?'План недоступен':'Загрузка плана…'):({ready:'Снимки загружены',loading:'Загрузка спутниковых снимков…',partial:'Часть снимков недоступна',unavailable:'Снимки недоступны · показан план улиц','approval-required':'Ожидает разрешения на загрузку'})[status]||'';
  const link=element('a',scene.groundStyle==='satellite'?'Esri World Imagery':'© OpenStreetMap contributors');link.target='_blank';link.rel='noopener noreferrer';
  link.href=scene.groundStyle==='satellite'?'https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9':'https://www.openstreetmap.org/copyright';
  $('#ground-attribution').replaceChildren(link,document.createTextNode(scene.groundStyle==='satellite'?' · Esri, Vantor, Earthstar Geographics, and the GIS User Community. Съёмка не привязана ко времени события.':' · ODbL. План без высот; ширина улиц условная.'));
  if(scene.groundStyle==='satellite'&&status!=='ready'){const fallback=element('a','© OpenStreetMap contributors · ODbL');fallback.href='https://www.openstreetmap.org/copyright';fallback.target='_blank';fallback.rel='noopener noreferrer';$('#ground-attribution').append(document.createTextNode(' Фоновый план: '),fallback);}
};
const map=new CityMap($('#city-map'),items=>{
  passes=items;$('#map-place-choice').hidden=false;
  options($('#map-pass'),items.map((p,i)=>[String(i),`${time(p.start)}${p.end>p.start?'–'+time(p.end):''} · ${n(p.record.speed)} км/ч`]),'0');
  $('#map-status').textContent=items.length>1?`Здесь найдено ${items.length} проездов. Выберите нужное время.`:'Место выбрано. Перейдите к моменту или начните интервал здесь.';
  $('#map-set-start').disabled=!items.length;$('#map-seek').disabled=!items.length;
},notice,events=>{
  if(events.length===1){safe(()=>selectMapEvent(events[0]))();return;}
  mapCluster=events;mapListLimit=30;renderMapEvents();
  $('#map-status').textContent=`В этой точке ${events.length} событий. Выберите время в списке ниже.`;
  $('.map-incidents').scrollIntoView({block:'nearest',behavior:'smooth'});
});
const timeline=new Timeline($('#overview'),{preview:previewMoment,commit:safe(commitMoment),leave:clearPreview});
map.onObservations=items=>{renderMapObservations(items);$('#map-status').textContent='Точка наблюдения: выберите время снимка ниже. Это положение вагона, не светофора.';$('#map-observation-panel').scrollIntoView({block:'nearest',behavior:'smooth'});};

async function boot(){const theme=localStorage.getItem('sirius-theme')||(matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light');document.documentElement.dataset.theme=theme;$('#open-trip').disabled=true;const h=await api('health');$('#server-status').textContent='Сервер доступен';if(h.import.status!=='ready'){$('#import-state').hidden=false;$('#import-state').textContent=h.import.status==='error'?'Ошибка импорта: '+h.import.error:`Подготовка архива: ${h.import.current||0} из ${h.import.total||'…'} файлов. Каталог появится после индексации.`;setTimeout(()=>safe(boot)(),2500);return;}$('#import-state').hidden=true;const data=await api('catalog');catalog=data.entries;if(!catalog.length)throw Error('Каталог пока пуст');$('#archive-hours').textContent=n(data.coverage.total_hours??data.coverage.vehicles.reduce((s,r)=>s+r.combined_hours,0));const vehicles=[...new Set(catalog.map(r=>r.vehicle))];$('#catalog-summary').textContent=`${vehicles.length} вагонов · ${data.import.records.toLocaleString('ru-RU')} записей`;$('#archive-caption').textContent='14 сентября — 6 октября 2026 · с остановками';options($('#vehicle-select'),vehicles.map(v=>[v,'Вагон '+v]),state.vehicle);updateDates();$('#open-trip').disabled=false;await loadHistory();if(location.hash.startsWith('#work?')){const p=Object.fromEntries(new URLSearchParams(location.hash.slice(6)));await openTrip(p);} }
function updateDates(){const vehicle=$('#vehicle-select').value;const days=[...new Set(catalog.filter(r=>r.vehicle===vehicle).map(r=>r.day))];options($('#date-select'),days.map(d=>[d,date(Date.parse(d+'T12:00:00+03:00'))]),$('#date-select').value||state.day);updateRoutes();}
function updateRoutes(){const entries=catalog.filter(r=>r.vehicle===$('#vehicle-select').value&&r.day===$('#date-select').value);options($('#route-select'),[['all','Все маршруты за день'],...entries.map(r=>[r.route,routeName(r.route)+(r.n<5?' · единичные записи':'')])],$('#route-select').value||state.route);selectionDescription();}
function selectionDescription(){const entries=catalog.filter(r=>r.vehicle===$('#vehicle-select').value&&r.day===$('#date-select').value&&($('#route-select').value==='all'||r.route===$('#route-select').value));const hours=entries.reduce((s,r)=>s+r.hours,0),hasJson=entries.some(r=>r.json_n>0);$('#selection-description').textContent=`${n(hours)} ч наблюдений · ${hasJson?'подробные JSON + CSV':'только CSV'} · ${entries.length?time(Math.min(...entries.map(r=>r.start)))+'–'+time(Math.max(...entries.map(r=>r.end))):'нет данных'}`;}
async function loadHistory(){const data=await api('history');const list=$('#history-list');list.replaceChildren();if(!data.items.length){list.append(element('div','Открытые поездки и сохранённые разборы появятся здесь.','history-empty'));return;}for(const r of data.items){const b=element('button',undefined,'history-item');const title=element('div');title.append(element('strong',r.title),element('small',`${time(r.state.start)}–${time(r.state.end)} · курсор ${time(r.state.time)}`));b.append(title,element('span',r.kind==='analysis'?'Анализ':'Просмотр','badge '+(r.kind==='analysis'?'saved':'')),element('small',new Date(r.updated).toLocaleString('ru-RU')));b.onclick=safe(()=>openTrip(r.state));list.append(b);}}
function serialized(){return {...state,time:Math.round(state.time),start:Math.round(state.start),end:Math.round(state.end)};}
function urlState(){if(!trip)return;const p=new URLSearchParams(Object.entries(serialized()).filter(([,v])=>v!==null));history.replaceState(null,'','#work?'+p);}
function saveView(){clearTimeout(saveTimer);if(!trip||$('#work-view').hidden)return;saveTimer=setTimeout(()=>{urlState();api('history',{}, {state:serialized(),kind:'view'}).catch(e=>notice(e.message));},550);}
async function openTrip(input){
  stop();clearPreview();windowAbort?.abort();bufferAbort?.abort();const token=++loadVersion;
  $('#open-trip').disabled=true;$('#server-status').textContent='Загружаем поездку…';
  try{
    const vehicle=String(input.vehicle),day=String(input.day),route=String(input.route||'all');
    if(!catalog.some(r=>r.vehicle===vehicle&&r.day===day&&(route==='all'||r.route===route)))throw Error('Такой комбинации вагона, даты и маршрута нет в архиве');
    const data=await api('trip',{vehicle,day,route});if(token!==loadVersion)return;trip=data;
    Object.assign(state,{vehicle,day,route,mode:input.mode==='2d'?'2d':'3d',map:input.map===true||input.map==='true',mapRoute:input.mapRoute||route,analysisId:input.analysisId||null});
    const first=trip.episodes.find(e=>e.type==='Brake')||trip.episodes[0];
    state.start=Number(input.start)||Math.max(trip.start,(first?.start||trip.start)-15000);
    state.end=Number(input.end)||Math.min(trip.end,state.start+120000);
    state.start=Math.max(trip.start,Math.min(trip.end,state.start));state.end=Math.max(state.start,Math.min(trip.end,state.end));
    state.time=Math.max(state.start,Math.min(state.end,Number(input.time)||first?.start||state.start));
    analysis=null;windowData=null;playbackData=null;exact=null;timelineKey='';timeline.hover=null;
    $('#analysis-result').hidden=true;$('#home-view').hidden=true;$('#work-view').hidden=false;
    $('#trip-title').textContent=`Вагон ${vehicle} / ${routeName(route).toLowerCase()}`;
    $('#trip-caption').textContent=`${date(trip.start)} · ${time(trip.start)}–${time(trip.end)} · ${trip.gaps.length?trip.gaps.length+' разрывов записи':'непрерывное покрытие'}`;
    $('#source-badge').textContent=trip.series.some(r=>r.family==='json')?'JSON + CSV':'CSV';
    scene.setTrack(trip.track,vehicle);motion=scene.model;configureMap();
    passes=[];$('#map-pass').replaceChildren();$('#map-place-choice').hidden=true;
    $('#map-set-start').disabled=true;$('#map-seek').disabled=true;
    options($('#snapshot-select'),[['','Выберите снимок'],...trip.snapshots.map(r=>[String(r.id),time(r.t,true)+' · '+(r.subsystem==='TrafficLightSubSys'?'Светофоры':'Объект')])],'');
    $('#go-snapshot').disabled=!trip.snapshots.length;scene.snapshot=null;
    $('#snapshot-content').textContent=trip.snapshots.length?`Доступно ${trip.snapshots.length} уникальных снимков распознавания. Это данные об объектах, не фотографии. Выберите время для просмотра.`:'В этой записи нет расширенных снимков объектов. Геометрия препятствия неизвестна.';
    renderEventContext(trip.episodes.find(e=>e.start<=state.time&&e.end>=state.time));
    scene.showSnapshot=false;$('#show-snapshot').checked=false;renderRange();renderMode();renderCurrent();await loadWindow();
    if(state.analysisId){try{analysis=await api('analysis',{id:state.analysisId});renderAnalysis();}catch(e){state.analysisId=null;notice(e.message);}}
    saveView();window.scrollTo({top:0,behavior:'instant'});
  }finally{$('#open-trip').disabled=false;$('#server-status').textContent='Сервер доступен';}
}
function renderRange(){
  if(!trip)return;$('#range-start').value=inputDate(state.start);$('#range-end').value=inputDate(state.end);
  $('#start-output').textContent=time(state.start);$('#end-output').textContent=time(state.end);
  for(const key of ['start','end']){const el=$('#'+key+'-slider');el.min=trip.start;el.max=trip.end;el.value=state[key];}
  $('#cursor-slider').min=state.start;$('#cursor-slider').max=state.end;$('#cursor-slider').value=state.time;
  analysisStatus();timelineKey='';drawOverview();map.update(state.time,state.start,state.end);
}
function analysisStatus(){if(!analysis){$('#analysis-state').textContent='Выберите интервал и запустите анализ.';$('#analysis-state').classList.remove('error');return;}const stale=analysis.start!==state.start||analysis.end!==state.end;$('#analysis-state').textContent=(stale?'Для предыдущего интервала. ':'Сохранено · ')+time(analysis.start)+'–'+time(analysis.end)+(stale?' Выполните новый анализ.':' · правила '+analysis.rules_version);$('#analysis-state').classList.toggle('error',stale);}
async function loadWindow(){
  const token=++windowVersion;windowAbort?.abort();windowAbort=new AbortController();
  $('#play').disabled=true;
  const scope={vehicle:state.vehicle,route:state.route,start:state.start,end:state.end};
  const d=await api('window',scope,undefined,windowAbort.signal);if(token!==windowVersion)return;
  windowData=d;exact=null;timelineKey='';
  if(!d.sampled){playbackData=d;bufferAbort?.abort();bufferPending=null;bufferVersion++;}
  renderCurrent();await ensurePlaybackBuffer(state.time);if(token===windowVersion)$('#play').disabled=false;await fetchFrame();saveView();
}
async function ensurePlaybackBuffer(t){
  if(playbackData&&t>=playbackData.start&&t<=playbackData.end-8000)return;
  if(windowData&&!windowData.sampled&&t>=windowData.start&&t<=windowData.end){playbackData=windowData;return;}
  if(bufferPending)return bufferPending;
  const token=++bufferVersion,tripToken=loadVersion,scope={vehicle:state.vehicle,route:state.route,start:Math.max(trip.start,t-10000),end:Math.min(trip.end,t+65000)};
  bufferAbort?.abort();bufferAbort=new AbortController();
  bufferPending=api('window',scope,undefined,bufferAbort.signal).then(d=>{if(token===bufferVersion&&tripToken===loadVersion){playbackData=d;renderCurrent();}}).catch(e=>{if(e.name!=='AbortError')notice(e.message);}).finally(()=>{if(token===bufferVersion)bufferPending=null;});
  return bufferPending;
}
async function applyRange(start,end){
  stop();clearPreview();if(!Number.isFinite(start)||!Number.isFinite(end)||end<start)throw Error('Начало должно быть раньше конца. Укажите корректное время.');
  state.start=Math.max(trip.start,Math.min(trip.end,start));state.end=Math.max(state.start,Math.min(trip.end,end));state.time=Math.max(state.start,Math.min(state.end,state.time));
  exact=null;renderRange();renderCurrent();await loadWindow();
}
function currentRow(t=displayTime()){
  if(previewTime!==null&&previewFrame?.time===Math.round(t))return previewFrame.record;
  if(exact&&exact.time===Math.round(t))return exact.record;
  const data=playbackData&&t>=playbackData.start&&t<=playbackData.end?playbackData:windowData&&!windowData.sampled&&t>=windowData.start&&t<=windowData.end?windowData:null;
  if(data){const i=lowerBound(data.rows,t+1)-1;return data.rows[i]||(data.context?.t<=t?data.context:null);}
  const rows=trip?.track||[],i=lowerBound(rows,t+1)-1;return rows[i]||null;
}
async function fetchFrame(){
  frameAbort?.abort();frameAbort=new AbortController();const t=Math.round(state.time),vehicle=state.vehicle,route=state.route,token=loadVersion;
  const r=await api('frame',{vehicle,route,t},undefined,frameAbort.signal);
  if(t!==Math.round(state.time)||vehicle!==state.vehicle||route!==state.route||token!==loadVersion)return;
  exact={time:t,record:r.record};renderCurrent();schedulePlace();
  if($('#raw-details').open&&r.record)await showRaw(r.record.id);
}
function schedulePlace(){
  clearTimeout(placeTimer);const p=motion?.at(displayTime());if(!p){$('#scene-location').textContent='Участок без надёжной позиции';return;}
  const token=++placeToken;placeTimer=setTimeout(async()=>{try{const g=await api('place',{lat:p.lat,lon:p.lon});if(token!==placeToken)return;$('#scene-location').textContent=g.street?.name?g.street.name+(g.street.distance>30?' · рядом с улицей':''):'Название улицы не найдено';}catch{$('#scene-location').textContent='Название улицы недоступно';}},150);
}
function renderScene(){
  if(!trip)return;const t=displayTime(),p=motion.at(t);scene.time=t;scene.current=currentRow(t);scene.draw();
  const stoppedHere=haltedGap&&Math.abs(t-haltedGap.start)<1;$('#scene-gap').hidden=!!p&&!stoppedHere;$('#next-observation').hidden=motion.next(t)===null;
  if(stoppedHere)$('#scene-gap-text').textContent=haltedGap.reason==='time'?'Достигнут разрыв записи.':'Координаты скачут. Продолжите со следующего достоверного участка.';
  if(!p)$('#scene-gap-text').textContent=motion.before(t)?'Разрыв GPS. Показано последнее известное положение.':'В этот момент нет надёжных координат.';
}
function renderCurrent(draw=true){
  if(!trip)return;const t=displayTime(),r=currentRow(t),age=r?t-r.t:Infinity,gap=age>30000||age<0||!r,flags=r?.flags||[];
  $('#cursor-time').textContent=time(t,true);$('#cursor-slider').value=state.time;if(draw)renderScene();
  if(state.map)map.update(t,state.start,state.end);
  $('#current-speed').textContent=!gap&&r.speed!=null?(flags.includes('speed_out_of_range')?'Нужна проверка':n(r.speed)+' км/ч'):'—';
  $('#current-handle').textContent=gap?'Нет данных':handleName(r.handle);
  const acts=[];if(!gap)for(const[k,label]of[['act_danger','Препятствие'],['act_light','Светофор'],['act_speed','Скорость']]){
    if(r[k]==='ActuationAct')acts.push(label+': вмешательство');else if(r[k]==='WarningAct')acts.push(label+': предупреждение');else if(r[k]?.startsWith('CSV:')&&!['CSV:0','CSV:'].includes(r[k]))acts.push(label+': код '+r[k].slice(4));
  }
  $('#current-action').textContent=gap?'Нет данных':acts.join(' · ')||(r.act_danger===undefined?'Загрузка сигналов…':'Без активного запроса');
  const brakes=[];if(!gap)for(const[bit,label]of[[1,'Механический'],[2,'Рельсовый'],[4,'Экстренный'],[8,'Аварийный']])if(r.brakes&bit)brakes.push(label);
  $('#current-brake').textContent=gap||r.brakes===undefined?'Нет данных':brakes.join(', ')||'Нет сигнала';
  const notes=[];if(gap)notes.push('Дискретные сигналы устарели или отсутствуют.');else{
    notes.push(`${r.family==='json'?'JSON':'CSV'} · запись ${time(r.t,true)}${age>1000?' · возраст '+n(age/1000)+' с':''}.`);
    if(flags.includes('position_disagreement'))notes.push('Расчётная позиция расходится с GPS.');
    if(flags.includes('speed_out_of_range'))notes.push('Аномальная скорость в источнике: '+n(r.speed)+' км/ч.');
    if(flags.includes('localization_not_converged'))notes.push('Локализация не сошлась.');
  }
  $('#quality-note').textContent=notes.join(' ');$('#quality-note').classList.toggle('warning',gap||flags.includes('position_disagreement'));
  const p=motion.at(t);$('#scene-caption').textContent=p?'Типовая модель · сглаженный GPS · исходные координаты в записи':'Последняя позиция не означает движение в разрыве';
  $('#odometry-note').textContent=r?`Позиция на сегменте: ${r.pos??'нет данных'}; сегмент: ${r.segment??'не указан'}. Значения разных сегментов не суммируются.`:'';
  $('#preview-badge').hidden=previewTime===null;drawOverview();
}
async function seek(t,{pause=true,exactRecord=null}={}){
  if(pause)stop();clearPreview();haltedGap=null;state.time=Math.max(state.start,Math.min(state.end,Math.round(t)));exact=exactRecord?{time:state.time,record:exactRecord}:null;
  renderCurrent();if(pause){await ensurePlaybackBuffer(state.time);await fetchFrame();saveView();}
}
function renderMode(){
  scene.mode=state.mode;scene.angle=+$('#camera-angle').value;scene.zoom=+$('#scene-zoom').value;scene.camera.pitch=+$('#camera-pitch').value;
  $('#view-2d').setAttribute('aria-pressed',state.mode==='2d');$('#view-3d').setAttribute('aria-pressed',state.mode==='3d');$('#camera-label').hidden=state.mode==='2d';
  $('#pitch-label').hidden=state.mode==='2d';$('#camera-follow-state').textContent=scene.camera.following?'Камера за вагоном':'Свободный обзор';
  $('#scene-controls-help').textContent=state.mode==='2d'?'Перетаскивание — сдвиг · колесо — масштаб · двойной щелчок — к вагону':'Левая кнопка — поворот · правая или Shift — сдвиг · колесо — масштаб · двойной щелчок — к вагону';
  const opening=state.map&&$('#map-panel').hidden;$('#map-panel').hidden=!state.map;$('#map-backdrop').hidden=!state.map;document.body.classList.toggle('map-is-open',state.map);
  $('#map-toggle').setAttribute('aria-expanded',state.map);$('#map-fab').setAttribute('aria-expanded',state.map);map.active=state.map;
  scene.draw();if(state.map){if(opening){map.fit();requestAnimationFrame(()=>$('#map-close').focus());}map.draw();}
}
function drawOverview(){
  if(!trip)return;const key=[loadVersion,windowVersion,timelineZoom,state.start,state.end].join('|');
  if(key!==timelineKey){timelineKey=key;timeline.setData({from:timelineZoom?state.start:trip.start,to:timelineZoom?state.end:trip.end,start:state.start,end:state.end,series:trip.track,gaps:trip.gaps,events:trip.episodes});}
  timeline.update(displayTime());$('#overview').setAttribute('aria-valuenow',String(Math.round((displayTime()-trip.start)/Math.max(1,trip.end-trip.start)*100)));$('#overview').setAttribute('aria-valuetext',time(displayTime(),true));
}
function previewMoment(t,event){
  stop();previewTime=t;previewFrame=null;clearTimeout(previewTimer);previewAbort?.abort();renderCurrent();
  $('#preview-badge').textContent=(event?eventName(event):'Предпросмотр')+' · нажмите для перехода';
  previewTimer=setTimeout(async()=>{previewAbort=new AbortController();try{const r=await api('frame',{vehicle:state.vehicle,route:state.route,t},undefined,previewAbort.signal);if(previewTime!==t)return;previewFrame={time:t,record:r.record};renderCurrent();}catch(e){if(e.name!=='AbortError')notice(e.message);}},90);
}
function clearPreview(){
  clearTimeout(previewTimer);previewAbort?.abort();if(previewTime===null)return;previewTime=null;previewFrame=null;$('#preview-badge').hidden=true;renderCurrent();
}
async function navigateMoment(t){
  clearPreview();stop();t=Math.max(trip.start,Math.min(trip.end,Math.round(t)));state.time=t;
  if(t<state.start||t>state.end){const span=Math.min(120000,state.end-state.start||120000);await applyRange(Math.max(trip.start,t-span/4),Math.min(trip.end,t+span*.75));}
  await seek(t);
}
async function commitMoment(t,event){timeline.hover=null;if(event)return selectEvent(event);return navigateMoment(t);}
async function selectEvent(event){
  clearPreview();state.time=event.start;renderEventContext(event);
  await applyRange(Math.max(trip.start,event.start-15000),Math.min(trip.end,Math.max(event.end+15000,event.start+30000)));
  await seek(event.start);
}
function redraw(){drawOverview();scene.draw();map.invalidate();}
async function showRaw(id){let d=rawCache.get(id);if(!d){d=await api('record',{id});rawCache.set(id,d);}$('#raw-record').textContent=JSON.stringify(d.raw,null,2);$('#record-reference').textContent=`${d.source.path} · ${d.record.family==='json'?'блок':'строка'} ${d.sequence_index}${d.json_pointer?' · '+d.json_pointer:''} · SHA-256 записи ${d.record_hash}`;return d;}
async function evidence(id){const d=await showRaw(id);if(d.record.t<state.start||d.record.t>state.end){await applyRange(Math.max(trip.start,d.record.t-15000),Math.min(trip.end,d.record.t+30000));}await seek(d.record.t,{exactRecord:d.record});exact={time:d.record.t,record:d.record};renderCurrent();$('#raw-details').open=true;saveView();}
function evidenceButton(id,text){const b=element('button',text||'Запись #'+id,'evidence-link');b.type='button';b.dataset.evidenceId=id;b.onclick=safe(()=>evidence(id));return b;}
function renderAnalysis(){if(!analysis)return;$('#analysis-result').hidden=false;$('#analysis-summary').textContent=analysis.summary;analysisStatus();const cards=$('#evidence-cards');cards.replaceChildren();const priority=['intervention','brake','control','warning','speed','target'];const chosen=[...analysis.facts].sort((a,b)=>priority.indexOf(a.kind)-priority.indexOf(b.kind)).slice(0,3).sort((a,b)=>a.t-b.t);for(const f of chosen){const b=element('button',undefined,'evidence-card');b.type='button';b.dataset.evidenceId=f.evidence_ids[0];b.append(element('span',time(f.t,true),'time'),element('strong',f.title),element('p',f.text));b.onclick=safe(()=>evidence(f.evidence_ids[0]));cards.append(b);}const all=$('#all-facts');all.replaceChildren();for(const f of [...analysis.facts].sort((a,b)=>a.t-b.t)){const row=element('div',undefined,'fact-row'),body=element('div');body.append(element('h3',f.title),element('p',f.text));for(const id of f.evidence_ids)body.append(evidenceButton(id));row.append(element('span',time(f.t,true),'small tabular'),body);all.append(row);}$('#analysis-limits').replaceChildren(...analysis.limitations.map(t=>element('li',t)));$('#answer').replaceChildren();}
async function doAnalyze(){const button=$('#analyze-button');button.disabled=true;button.textContent='Анализируем…';const request={vehicle:state.vehicle,route:state.route,start:state.start,end:state.end};try{const result=await api('analyze',{},request);if(result.vehicle!==state.vehicle||result.route!==state.route)return;analysis=result;state.analysisId=result.id;renderAnalysis();urlState();await api('history',{}, {id:'analysis:'+result.id,kind:'analysis',state:{...serialized(),start:result.start,end:result.end,time:result.start,analysisId:result.id}});notice('Анализ сохранён. Каждое утверждение можно проверить по исходной записи.');}finally{button.disabled=false;button.textContent='Анализировать интервал';}}
async function ask(question){if(!analysis)throw Error('Сначала выполните анализ выбранного интервала');if(analysis.start!==state.start||analysis.end!==state.end)throw Error('Интервал изменился. Выполните новый анализ перед вопросом.');$('#answer').textContent='Проверяем записи…';const a=await api('question',{}, {analysis_id:analysis.id,question});$('#answer').replaceChildren(element('p',a.text));for(const id of a.evidence_ids)$('#answer').append(evidenceButton(id));}
const objectName=type=>({CAR:'Автомобиль',HUMAN:'Человек',TRAFFIC_LIGHT:'Светофор'})[type]||type||'Объект';
const signalName=signal=>({CAR_STOP:'красный для автомобилей',CAR_YELLOW:'жёлтый для автомобилей',CAR_FORWARD:'разрешающий для автомобилей',RU_TRAM_STOP:'запрещающий для трамвая',RU_TRAM_FORWARD:'разрешающий для трамвая',PEDESTRIAN_STOP:'запрещающий для пешеходов',PEDESTRIAN_FORWARD:'разрешающий для пешеходов'})[signal]||signal;
function snapshotDescription(s){
  const observed=s.objects.filter(o=>o.state==='TRACKED'),other=s.objects.filter(o=>o.state!=='TRACKED');
  const labels=[...new Set(observed.map(o=>o.type==='TRAFFIC_LIGHT'?'Светофор: '+signalName(o.tlSignal||'сигнал не указан'):objectName(o.type)))];
  // Keep unknown states explicit rather than silently interpreting them as visible objects.
  const otherLabels=[...new Set(other.map(o=>`${objectName(o.type)} — ${({NO_OBS_TRACKED:'прогноз без наблюдения',LOST:'потерян'})[o.state]||o.state||'статус неизвестен'}`))];
  return (labels.length?'Наблюдались (TRACKED): '+labels.join('; ')+'.':'Нет объектов со статусом TRACKED.')+(otherLabels.length?' '+otherLabels.join('; ')+'.':'');
}
function renderEventContext(event){
  $('#event-context').hidden=!event;if(!event)return;
  $('#event-context-title').textContent='Выбрано: '+eventName(event).toLowerCase();$('#event-context-time').textContent=time(event.start,true);
  const linked=event.snapshot_links||[],target=({Obstacle:'препятствие',TrafficLightSignal:'сигнал светофора',ZoneSpeedLimit:'ограничение скорости'})[event.target]||event.target||'не указана';
  $('#event-context-summary').textContent=`Цель в журнале: ${target}. `+(linked.length?'В записи события есть ссылка на снимок распознавания. Это связь, зарегистрированная системой, а не доказательство причины торможения.':'У этого события нет связанного снимка объектов или фотографии. Конкретный объект и его положение по этим записям восстановить нельзя.');
  const container=$('#event-context-evidence');container.replaceChildren(evidenceButton(event.evidence_id,'Исходное событие'));
  for(const link of linked){
    const s=trip.snapshots.find(s=>s.id===link.snapshot_id);if(!s)continue;
    const row=element('div',undefined,'snapshot-evidence'),actions=element('div',undefined,'inline');
    row.append(element('strong',snapshotDescription(s)),element('p',`Снимок ${time(s.t,true)} · ${link.delta_ms===0?'совпадает по времени с записью события':`${n(Math.abs(link.delta_ms)/1000,3)} с ${link.delta_ms>0?'после':'до'} связанной записи события`}.`));
    const open=element('button','Открыть схему снимка','small-button');open.dataset.snapshotId=s.id;open.onclick=safe(()=>openSnapshot(s.id));
    actions.append(open,evidenceButton(link.record_id,'Проверить связь в логе'));row.append(actions);container.append(row);
  }
}
async function selectSnapshot(){
  const id=+$('#snapshot-select').value,version=loadVersion;
  if(!id){scene.snapshot=null;$('#snapshot-content').textContent='Выберите снимок распознавания.';scene.draw();return;}
  const d=rawCache.get(id)||await api('record',{id});if(version!==loadVersion||+$('#snapshot-select').value!==id)return;rawCache.set(id,d);
  const tel=d.raw.telemetry_data,stamp=Date.parse(d.raw.telemetry_timestamp);scene.snapshot={data:tel,t:stamp};
  const container=$('#snapshot-content'),metadata=trip.snapshots.find(s=>s.id===id);
  container.replaceChildren(element('p',`Снимок ${time(stamp,true)} · ${tel.subsystem} · данные распознавания, не фотография`));
  if(metadata)container.append(element('p',snapshotDescription(metadata)));
  const objects=tel.object?[tel.object]:(tel.trafficLights||[]),table=element('table',undefined,'snapshot-table'),head=element('tr');
  for(const text of ['Тип / состояние','x / y','Сигнал'])head.append(element('th',text));table.append(head);
  objects.slice(0,30).forEach(o=>{const row=element('tr');row.append(element('td',`${objectName(o.type)} (${o.type}) · ${o.state}`),element('td',`${n(o.pose?.x)} / ${n(o.pose?.y)}`),element('td',signalName(o.tlSignal)||'—'));table.append(row);});
  container.append(table,element('p','Оси и единицы локальных координат не подтверждены. На схеме условно x — поперёк, y — вперёд. Пунктир — состояние, отличное от TRACKED. Схема неподвижна и видна только в первые 3 секунды от времени снимка; движение объектов неизвестно.','small'),evidenceButton(id,'Исходная запись снимка'));scene.draw();return scene.snapshot;
}
async function openSnapshot(id){
  $('#snapshot-select').value=String(id);const snapshot=await selectSnapshot();if(!snapshot||+$('#snapshot-select').value!==id)return;
  $('#snapshot-details').open=true;scene.showSnapshot=true;$('#show-snapshot').checked=true;
  $('#scene-zoom').value=.5;scene.zoom=.5;scene.camera.following=true;scene.onCameraChange();await navigateMoment(snapshot.t);scene.draw();
}
function stop(){playing=false;cancelAnimationFrame(frameId);$('#play').textContent='▶ Воспроизвести';}
function play(){
  clearPreview();if(playing){stop();safe(fetchFrame)();saveView();return;}
  if(!windowData?.rows.length){notice('В выбранном интервале нет записей.');return;}
  if(state.time>=state.end)state.time=state.start;
  if(!motion.at(state.time)){renderCurrent();notice('Здесь нет надёжной позиции. Перейдите к следующему участку.');return;}
  playing=true;lastTick=performance.now();$('#play').textContent='Ⅱ Пауза';let lastUI=0;
  function tick(now){
    if(!playing)return;const previous=state.time,delta=Math.min(100,Math.max(0,now-lastTick));lastTick=now;
    const next=Math.min(state.end,state.time+delta*+$('#play-speed').value),gap=motion.crossedGap(previous,next);
    if(gap){haltedGap=gap;state.time=gap.start;stop();renderCurrent();$('#scene-gap').hidden=false;$('#scene-gap-text').textContent=gap.reason==='time'?'Достигнут разрыв записи.':'Координаты скачут: движение до следующего участка не восстановлено.';$('#next-observation').hidden=false;safe(fetchFrame)();saveView();return;}
    state.time=next;exact=null;renderScene();
    if(now-lastUI>=100){renderCurrent(false);lastUI=now;safe(()=>ensurePlaybackBuffer(state.time))();}
    if(now-lastPlaceUpdate>3000){schedulePlace();lastPlaceUpdate=now;}
    if(state.time>=state.end){stop();renderCurrent();safe(fetchFrame)();saveView();return;}
    frameId=requestAnimationFrame(tick);
  }
  frameId=requestAnimationFrame(tick);
}
function step(direction){
  const rows=playbackData?.rows||windowData?.rows||[];if(!rows.length)return;
  let i=lowerBound(rows,state.time);if(direction<0)i=Math.max(0,i-1);else i=Math.min(rows.length-1,i+(rows[i]?.t<=state.time?1:0));return seek(rows[i].t);
}
async function nextEvent(direction){const eps=trip.episodes;const e=direction>0?eps.find(e=>e.start>state.time+1):eps.findLast(e=>e.start<state.time-1);if(!e){notice('Других событий в этом направлении нет.');return;}await selectEvent(e);}
function configureMap(){
  const routes=[...new Set(trip.track.map(r=>r.route))];
  if(!routes.includes(state.mapRoute))state.mapRoute=state.route!=='all'?state.route:(routes.find(r=>r!=='0')||routes[0]);
  options($('#map-route'),routes.map(r=>[r,routeName(r)]),state.mapRoute);$('#map-route').disabled=routes.length<=1;
  $('#map-caption').textContent=`Вагон ${state.vehicle} · ${date(trip.start)}`;
  map.setTrack(trip.track,trip.episodes,state.mapRoute);map.setObservations(trip.snapshots);renderMapObservations();mapCluster=null;mapListLimit=30;renderMapEvents();
}
function renderMapObservations(items=map.observations){
  const list=$('#map-observation-list');list.replaceChildren();
  if(!items.length){list.append(element('p','На этом маршруте нет снимков с координатами наблюдения.','small muted'));return;}
  for(const s of items){const b=element('button',`${time(s.t,true)} · ${s.subsystem==='TrafficLightSubSys'?'Светофоры':'Объект'} — открыть схему`);b.dataset.snapshotId=s.id;b.onclick=safe(async()=>{toggleMap(false);await openSnapshot(s.id);$('#scene').scrollIntoView({block:'center',behavior:'smooth'});});list.append(b);}
  if(items!==map.observations){const all=element('button','Все снимки маршрута','text-button');all.onclick=()=>renderMapObservations();list.append(all);}
}
function renderMapEvents(){
  const all=mapCluster||map.eventPoints.map(p=>p.event),events=all.filter(e=>map.filter==='all'||e.type===map.filter),list=$('#map-event-list');
  $('#map-event-count').textContent=events.length+' событий';$('#map-cluster-caption').hidden=!mapCluster;$('#map-all-events').hidden=!mapCluster;
  $('#map-cluster-caption').textContent=mapCluster?'Выбрана группа на карте. Время каждого события можно открыть отдельно.':'';
  const focused=document.activeElement?.dataset?.eventId;const ordered=[...events].sort((a,b)=>a.start-b.start);list.replaceChildren();
  for(const e of ordered.slice(0,mapListLimit)){
    const b=element('button',undefined,'map-event-row');b.dataset.eventId=e.id;b.setAttribute('aria-pressed',map.selected===e.id);
    const dot=element('i',undefined,'dot '+(e.type==='Brake'?'brake':e.type==='Warn'?'warn':'overspeed')),label=element('span');
    label.append(element('strong',eventName(e)),element('small',`${e.n} записей · ${time(e.start)}${e.end>e.start?'–'+time(e.end):''}`));b.append(dot,label,element('time',time(e.start)));
    b.onclick=safe(()=>selectMapEvent(e));list.append(b);if(String(e.id)===focused)b.focus({preventScroll:true});
  }
  if(!events.length)list.append(element('p','Нет событий с надёжной позицией для выбранного фильтра.','muted small'));
  $('#map-more-events').hidden=events.length<=mapListLimit;
}
async function selectMapEvent(event){
  map.select(event);renderMapEvents();$('#map-status').textContent=`${eventName(event)} · ${time(event.start,true)}. Курсор перемещён к событию.`;
  await selectEvent(event);
}
$('#vehicle-select').onchange=updateDates;$('#date-select').onchange=updateRoutes;$('#route-select').onchange=selectionDescription;
$('#selection-form').onsubmit=e=>{e.preventDefault();safe(()=>openTrip({vehicle:$('#vehicle-select').value,day:$('#date-select').value,route:$('#route-select').value}))();};
async function home(){stop();clearPreview();toggleMap(false);windowAbort?.abort();bufferAbort?.abort();clearTimeout(saveTimer);if(trip)await api('history',{}, {state:serialized(),kind:'view'});$('#work-view').hidden=true;$('#home-view').hidden=false;history.replaceState(null,'','#home');await loadHistory();window.scrollTo({top:0,behavior:'instant'});}
$('#back-home').onclick=safe(home);$('.brand').onclick=e=>{e.preventDefault();safe(home)();};
$('#timeline-zoom').onclick=()=>{timelineZoom=!timelineZoom;$('#timeline-zoom').textContent=timelineZoom?'Вся поездка':'Приблизить интервал';drawOverview();};
$('#apply-range').onclick=safe(()=>applyRange(parseDate($('#range-start').value),parseDate($('#range-end').value)));
for(const key of ['start','end']){$('#'+key+'-slider').oninput=e=>{stop();state[key]=+e.target.value;if(state.start>state.end)state[key==='start'?'end':'start']=state[key];state.time=Math.max(state.start,Math.min(state.end,state.time));renderRange();clearTimeout(rangeTimer);rangeTimer=setTimeout(()=>safe(loadWindow)(),250);};}
$$('[data-span]').forEach(b=>b.onclick=safe(()=>applyRange(Math.max(trip.start,state.time-+b.dataset.span*.25),Math.min(trip.end,state.time+ +b.dataset.span*.75))));$('#whole-trip').onclick=safe(()=>applyRange(trip.start,trip.end));
$('#cursor-slider').oninput=e=>{stop();clearPreview();state.time=+e.target.value;exact=null;renderCurrent();};$('#cursor-slider').onchange=safe(async()=>{await fetchFrame();saveView();});
$('#play').onclick=play;$('#step-back').onclick=safe(()=>step(-1));$('#step-forward').onclick=safe(()=>step(1));$('#previous-event').onclick=safe(()=>nextEvent(-1));$('#next-event').onclick=safe(()=>nextEvent(1));
for(const mode of ['2d','3d'])$('#view-'+mode).onclick=()=>{state.mode=mode;renderMode();saveView();};
$('#camera-angle').oninput=renderMode;$('#camera-pitch').oninput=renderMode;$('#scene-zoom').oninput=renderMode;$('#reset-camera').onclick=()=>scene.camera.reset();
$('#show-ground').onchange=e=>{scene.showGround=e.target.checked;scene.draw();};$('#ground-opacity').oninput=e=>{scene.groundOpacity=+e.target.value;scene.draw();};
$('#ground-style').onchange=e=>{scene.groundStyle=e.target.value;localStorage.setItem('sirius-ground-style',scene.groundStyle);scene.draw();};
$('#allow-satellite').onclick=()=>{localStorage.setItem('sirius-esri-consent','tiles-v1');scene.satellite.authorized=true;groundStatusKey='';scene.draw();};
function toggleMap(value){
  if(value)mapFocus=document.activeElement;state.map=value;renderMode();saveView();
  if(!value&&mapFocus?.isConnected)mapFocus.focus();
}
$('#map-toggle').onclick=()=>toggleMap(!state.map);$('#map-fab').onclick=()=>toggleMap(true);$('#map-close').onclick=()=>toggleMap(false);$('#map-backdrop').onclick=()=>toggleMap(false);
$('#map-plus').onclick=()=>map.zoom(1.5);$('#map-minus').onclick=()=>map.zoom(1/1.5);$('#map-fit').onclick=()=>map.fit();
$('#map-route').onchange=()=>{state.mapRoute=$('#map-route').value;configureMap();saveView();};
$('#map-observations').onchange=e=>{map.showObservations=e.target.checked;$('#map-observation-panel').hidden=!e.target.checked;renderMapObservations();map.invalidate();};
$$('[data-map-filter]').forEach(b=>b.onclick=()=>{map.setFilter(b.dataset.mapFilter);mapListLimit=30;$$('[data-map-filter]').forEach(x=>x.setAttribute('aria-pressed',x===b));renderMapEvents();});
$('#map-all-events').onclick=()=>{mapCluster=null;mapListLimit=30;renderMapEvents();};$('#map-more-events').onclick=()=>{mapListLimit+=30;renderMapEvents();};
$('#map-set-start').onclick=safe(async()=>{const p=passes[+$('#map-pass').value];if(!p)return;const span=state.end-state.start,start=p.record.t;state.time=start;await applyRange(start,Math.min(trip.end,start+span));await seek(start);notice('Начало интервала выбрано на карте.');});
$('#map-seek').onclick=safe(async()=>{const p=passes[+$('#map-pass').value];if(p)await navigateMoment(p.record.t);});
$('#next-observation').onclick=safe(async()=>{const next=motion.next(state.time);if(next!==null)await navigateMoment(next);});
$('#map-panel').addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();toggleMap(false);}if(e.key==='Tab'){const items=[...$('#map-panel').querySelectorAll('button,select,a')].filter(x=>!x.disabled&&!x.hidden&&x.getClientRects().length);const first=items[0],last=items.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&playing){stop();saveView();}});
$('#analyze-button').onclick=safe(doAnalyze);$$('[data-question]').forEach(b=>b.onclick=safe(()=>ask(b.dataset.question)));$('#question-form').onsubmit=e=>{e.preventDefault();safe(()=>ask($('#question-input').value))();};
$('#raw-details').ontoggle=()=>{if($('#raw-details').open&&currentRow())safe(()=>showRaw(currentRow().id))();};$('#snapshot-select').onchange=safe(selectSnapshot);$('#go-snapshot').onclick=safe(async()=>{const id=+$('#snapshot-select').value;if(!id){notice('Сначала выберите снимок.');return;}await openSnapshot(id);});$('#show-snapshot').onchange=e=>{scene.showSnapshot=e.target.checked;scene.draw();};
$('#export-analysis').onclick=()=>{if(!analysis)return;const file=new Blob([JSON.stringify(analysis,null,2)],{type:'application/json'}),a=element('a');a.href=URL.createObjectURL(file);a.download=`sirius-${analysis.vehicle}-${analysis.id.slice(0,8)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);};
$('#theme-button').onclick=()=>setTheme(document.documentElement.dataset.theme==='dark'?'light':'dark');new ResizeObserver(redraw).observe(document.querySelector('main'));
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&state.map){e.preventDefault();toggleMap(false);return;}if($('#work-view').hidden||state.map||e.target.id==='overview'||['INPUT','SELECT','TEXTAREA','BUTTON'].includes(e.target.tagName))return;if(e.code==='Space'){e.preventDefault();play();}if(e.code==='ArrowRight'){e.preventDefault();safe(()=>step(1))();}if(e.code==='ArrowLeft'){e.preventDefault();safe(()=>step(-1))();}});
safe(async()=>{await loadSettings();await boot();})();
