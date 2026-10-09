import {surface,color,lowerBound,eventName} from './map.js';

const clock=(t,ms=false)=>new Date(t+10800000).toISOString().slice(11,ms?23:19);
const num=(v,d=1)=>v==null||!Number.isFinite(+v)?'—':Number(v).toLocaleString('ru-RU',{maximumFractionDigits:d});
function el(tag,text,className){const e=document.createElement(tag);if(text!==undefined&&text!==null)e.textContent=text;if(className)e.className=className;return e;}

/* Synchronised chart: speed, control position, warning level and state bands on one time axis. */
const LEFT=118,RIGHT=12;
const BANDS=[
  ['Препятствия',r=>r.act_danger],['Светофоры',r=>r.act_light],['Огр. скорости',r=>r.act_speed],
  ['Тормоза (ОС)',r=>r.brakes?'Brake':null],['Управление',r=>r.handle==='cpilot'?'cpilot':r.handle==='undeterminable'?'unknown':null],
];
export class SignalChart{
  constructor(canvas,{commit,preview,leave}){
    this.canvas=canvas;this.callbacks={commit,preview,leave};this.base=document.createElement('canvas');this.rows=[];this.events=[];this.hover=null;
    canvas.addEventListener('pointermove',e=>this.point(e.offsetX));
    canvas.addEventListener('pointerleave',()=>{this.hover=null;this.callbacks.leave();this.draw();});
    canvas.addEventListener('click',e=>{const t=this.timeAt(e.offsetX);if(t!==null)this.callbacks.commit(t);});
    canvas.addEventListener('keydown',e=>{if(!this.range)return;const step=(this.range.to-this.range.from)/200;if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();this.callbacks.commit(Math.max(this.range.from,Math.min(this.range.to,this.time+(e.key==='ArrowRight'?step:-step))));}});
    new ResizeObserver(()=>{this.dirty=true;this.draw();}).observe(canvas);
  }
  setData(rows,range,events,gaps,sampled=false){this.rows=rows;this.range=range;this.events=events||[];this.gaps=gaps||[];this.sampled=sampled;this.hover=null;this.dirty=true;this.draw();}
  continuous(a,b){return a&&b&&a.family===b.family&&a.route===b.route&&b.t-a.t<=5000&&!this.gaps.some(([x,y])=>a.t<y&&b.t>x);}
  update(t){this.time=t;this.draw();}
  timeAt(x){if(!this.range)return null;const w=this.canvas.clientWidth;if(x<LEFT||x>w-RIGHT)return null;return Math.round(this.range.from+(x-LEFT)/(w-LEFT-RIGHT)*(this.range.to-this.range.from));}
  point(x){const t=this.timeAt(x);this.hover=t===null?null:t;if(t!==null)this.callbacks.preview?.(t);this.draw();}
  layout(h){const speed={top:10,bottom:118},control={top:136,bottom:194},warn={top:212,bottom:240},bands={top:256,row:17};return {speed,control,warn,bands,h};}
  build({w,h,d}){
    this.base.width=Math.round(w*d);this.base.height=Math.round(h*d);const ctx=this.base.getContext('2d');ctx.setTransform(d,0,0,d,0,0);
    const {from,to}=this.range,L=LEFT,R=w-RIGHT,x=t=>L+(t-from)/Math.max(1,to-from)*(R-L),lay=this.layout(h),rows=this.rows;
    ctx.font='11px Inter, Segoe UI, sans-serif';ctx.textBaseline='middle';
    const label=(text,y,strong)=>{ctx.fillStyle=color(strong?'--text':'--muted');ctx.textAlign='left';ctx.fillText(text,8,y);};
    // gaps
    for(const[a,b]of this.gaps){if(b<from||a>to)continue;ctx.fillStyle=color('--border');ctx.globalAlpha=.55;ctx.fillRect(Math.max(L,x(a)),4,Math.min(R,x(b))-Math.max(L,x(a)),h-8);ctx.globalAlpha=1;}
    // event markers
    for(const e of this.events){if(e.end<from||e.start>to)continue;ctx.fillStyle=color(e.type==='Brake'?'--brake':e.type==='Warn'?'--warn':'--purple');ctx.globalAlpha=.09;ctx.fillRect(x(Math.max(from,e.start)),4,Math.max(2,x(Math.min(to,e.end))-x(Math.max(from,e.start))),h-8);ctx.globalAlpha=1;}
    // speed
    const s=lay.speed;let vmax=20;for(const r of rows){if(r.speed!=null&&r.speed<=150)vmax=Math.max(vmax,r.speed);if(r.goal!=null&&r.goal<=150)vmax=Math.max(vmax,r.goal);}vmax=Math.ceil(vmax/10)*10;
    const ys=v=>s.bottom-Math.max(0,Math.min(vmax,v))/vmax*(s.bottom-s.top);
    label('Скорость, км/ч',s.top+8,true);
    for(const v of[0,vmax/2,vmax]){ctx.strokeStyle=color('--grid');ctx.beginPath();ctx.moveTo(L,ys(v));ctx.lineTo(R,ys(v));ctx.stroke();ctx.fillStyle=color('--muted');ctx.textAlign='right';ctx.fillText(String(v),L-6,ys(v));}
    const line=(get,y,style,width=1.8,dash=[],step=false)=>{ctx.save();ctx.beginPath();ctx.rect(L,0,R-L,h);ctx.clip();ctx.strokeStyle=style;ctx.lineWidth=width;ctx.setLineDash(dash);ctx.beginPath();let prev=null;
      for(const r of rows){const v=get(r);if(v==null||!Number.isFinite(v)){prev=null;continue;}const px=x(r.t),py=y(v);if(!this.continuous(prev,r))ctx.moveTo(px,py);else if(step){ctx.lineTo(px,y(get(prev)));ctx.lineTo(px,py);}else ctx.lineTo(px,py);prev=r;}
      ctx.stroke();ctx.restore();};
    line(r=>r.goal,ys,color('--muted'),1.3,[5,4],true);
    line(r=>r.speed!=null&&r.speed<=150?r.speed:null,ys,color('--accent'),2);
    // control
    const c=lay.control,controlMax=Math.max(15,...rows.flatMap(r=>[Math.abs(r.mode||0),Math.abs(r.driver_mode||0)])),yc=v=>(c.top+c.bottom)/2-v/controlMax*(c.bottom-c.top)/2;
    label('Рукоятка',(c.top+c.bottom)/2,true);ctx.fillStyle=color('--muted');ctx.textAlign='right';ctx.fillText('тяга',L-6,c.top+6);ctx.fillText('торм.',L-6,c.bottom-6);
    ctx.strokeStyle=color('--grid');ctx.beginPath();ctx.moveTo(L,yc(0));ctx.lineTo(R,yc(0));ctx.stroke();
    line(r=>r.driver_mode,yc,color('--muted'),1.4,[2,3],true);
    line(r=>r.mode,yc,color('--purple'),1.8,[],true);
    // warn level
    const wv=lay.warn;let wmax=10;for(const r of rows)if(r.warn!=null)wmax=Math.max(wmax,r.warn);
    label('Уровень предупр.',(wv.top+wv.bottom)/2,true);
    ctx.save();ctx.beginPath();ctx.rect(L,0,R-L,h);ctx.clip();ctx.fillStyle=color('--warn');
    for(let i=0;i<rows.length;i++){const r=rows[i];if(!r.warn)continue;const hh=Math.max(0,r.warn)/wmax*(wv.bottom-wv.top);ctx.globalAlpha=.75;const width=!this.sampled&&this.continuous(r,rows[i+1])?Math.max(1,x(rows[i+1].t)-x(r.t)):1.5;ctx.fillRect(x(r.t),wv.bottom-hh,width,hh);}
    ctx.globalAlpha=1;ctx.restore();ctx.strokeStyle=color('--grid');ctx.beginPath();ctx.moveTo(L,wv.bottom+.5);ctx.lineTo(R,wv.bottom+.5);ctx.stroke();
    // bands
    BANDS.forEach(([name,get],i)=>{const y0=lay.bands.top+i*lay.bands.row;label(name,y0+7);ctx.fillStyle=color('--bg');ctx.fillRect(L,y0+1,R-L,lay.bands.row-4);
      for(let j=0;j<rows.length;j++){const v=get(rows[j]);if(!['WarningAct','ActuationAct','Brake','cpilot','unknown'].includes(v))continue;
        const width=!this.sampled&&this.continuous(rows[j],rows[j+1])?Math.max(1.5,x(rows[j+1].t)-x(rows[j].t)):1.5;
        ctx.fillStyle=color(v==='WarningAct'?'--warn':v==='cpilot'?'--purple':v==='unknown'?'--muted':'--brake');ctx.fillRect(x(rows[j].t),y0+1,width,lay.bands.row-4);}});
    // time axis
    ctx.fillStyle=color('--muted');const axisY=lay.bands.top+BANDS.length*lay.bands.row+10;
    const ticks=w<600?2:4;for(let i=0;i<=ticks;i++){const t=from+(to-from)*i/ticks;ctx.textAlign=i===0?'left':i===ticks?'right':'center';ctx.fillText(clock(t),x(t),axisY);}
    this.dirty=false;this.theme=document.documentElement.dataset.theme;
  }
  draw(){
    if(!this.range||!this.canvas.getClientRects().length)return;const s=surface(this.canvas);if(!s)return;const {ctx,w,h}=s;
    if(this.dirty||this.base.width!==this.canvas.width||this.base.height!==this.canvas.height||this.theme!==document.documentElement.dataset.theme)this.build(s);
    ctx.drawImage(this.base,0,0,w,h);const {from,to}=this.range,x=t=>LEFT+(t-from)/Math.max(1,to-from)*(w-LEFT-RIGHT);
    if(this.time>=from&&this.time<=to){ctx.strokeStyle=color('--text');ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(x(this.time),4);ctx.lineTo(x(this.time),h-18);ctx.stroke();}
    if(this.hover!==null){
      const px=x(this.hover),i=lowerBound(this.rows,this.hover+1)-1,r=this.rows[i];ctx.strokeStyle=color('--accent');ctx.setLineDash([3,3]);ctx.beginPath();ctx.moveTo(px,4);ctx.lineTo(px,h-18);ctx.stroke();ctx.setLineDash([]);
      if(r){const missing=this.hover-r.t>5000||this.gaps.some(([a,b])=>this.hover>a&&this.hover<b);const text=missing?`${clock(this.hover,true)} · нет наблюдений`:`${clock(r.t,true)} · ${num(r.speed)} км/ч`;ctx.font='600 11px Inter, Segoe UI, sans-serif';const tw=Math.min(w-LEFT-8,ctx.measureText(text).width+14),left=Math.max(LEFT,Math.min(w-tw-6,px+8));ctx.fillStyle=color('--dark');ctx.fillRect(left,6,tw,22);ctx.fillStyle=color('--on-dark');ctx.textBaseline='middle';ctx.textAlign='left';ctx.fillText(text,left+7,17,tw-14);}
    }
  }
}

/* System state card at the cursor. Unknown stays visibly unknown. */
const STATUS={ProperlyWork:['Работает','ok'],TemporaryOff:['Временно выкл.','warn'],TurnOff:['Выключен','muted'],Error:['Ошибка','bad']};
const ACT={No:['Нет запроса','muted'],WarningAct:['Предупреждение','warn'],ActuationAct:['Вмешательство','bad']};
const OBJECT={Vehicle:'транспорт',Human:'человек',TrafficLight:'светофор',SpeedLimit:'огр. скорости',Unknown:'не задан'};
const HANDLE={driver:'Водитель',cpilot:'Система (cpilot)',undeterminable:'Не определён'};
function pill(text,tone){return el('span',text,'pill '+(tone||'muted'));}
export function renderSystemState(container,frame,{gap}={}){
  container.replaceChildren();const s=frame?.state;
  if(!s||gap){container.append(el('p',gap?'Нет свежей записи: состояние неизвестно.':'Загрузка состояния…','muted small'));return;}
  if(s.family!=='json'){container.append(el('p',s.note,'muted small'));return;}
  const modules=el('div',undefined,'module-table');
  modules.append(el('span','Модуль','th'),el('span','Состояние','th'),el('span','Запрос','th'));
  for(const m of s.modules){const st=STATUS[m.status]||[m.status||'нет данных','muted'],act=ACT[m.act]||[m.act||'—','muted'];
    const name=el('span',m.label,'module-name');name.title=`FSM: ${m.fsm||'—'} · запрос включения: ${m.request||'—'}`;modules.append(name,pill(...st),pill(...act));}
  const brakes=el('div',undefined,'brake-row');
  for(const[k,label]of[['mechanical','Механический'],['rail','Рельсовый'],['emergency','Экстренный'],['crash','Аварийный']]){const v=s.brakes[k],item=pill(label+(v==null?' · ?':''),v?'bad':v===false?'off':'muted');item.title=v?'Положительный сигнал обратной связи':v===false?'Отрицательный сигнал обратной связи':'Нет данных об обратной связи';brakes.append(item);}
  const facts=el('dl',undefined,'state-facts');
  const add=(k,v)=>facts.append(el('dt',k),el('dd',v));
  add('Требуемая скорость',s.goal_speed==null?'—':num(s.goal_speed,0)+' км/ч');
  add('Цель скорости',OBJECT[s.goal_obj_type]||s.goal_obj_type||'—');
  add('Уровень предупреждения',s.warn_level==null?'—':num(s.warn_level,0)+' (шкала не подтверждена)');
  add('Рукоятка: система / водитель',`${num(s.speed_mode,0)} / ${num(s.speed_mode_driver,0)}`);
  add('Источник управления',HANDLE[s.handle]||s.handle||'—');
  add('Автомат вагона',s.fsm_state||'—');
  add('Звуковой сигнал',s.call?'включён':s.call===false?'нет':'—');
  add('Юз колёс',s.skid?`да (${num(s.skid_score,2)})`:s.skid===false?'нет':'—');
  add('Напряжение сети',s.voltage==null?'—':num(s.voltage,0)+' В');
  const comps=el('div',undefined,'components');
  for(const c of s.components){const item=el('span',c.label,'component '+(c.ok?'ok':c.ok===false?'bad':'muted'));item.title=c.ok?'данные поступают':c.ok===false?'данные не поступают':'нет поля';comps.append(item);}
  comps.append(el('span','Локализация',`component ${s.localization?'ok':s.localization===false?'bad':'muted'}`),el('span','RTK',`component ${s.rtk?'ok':s.rtk===false?'warn':'muted'}`),el('span','АБПВ включена',`component ${s.adas_on?'ok':s.adas_on===false?'bad':'muted'}`));
  container.append(el('h3','Подсистемы АБПВ','state-sub'),modules,el('h3','Обратная связь тормозов','state-sub'),brakes,facts,el('h3','Источники данных','state-sub'),comps);
}

/* Four-part episode card. Each statement is a button that moves the shared cursor to its record. */
const SECTIONS=[['circumstances','Что зарегистрировано'],['reaction','Реакция системы'],['result','Результат'],['limits','Ограничения']];
export function renderEpisodeCard(container,lines,onEvidence){
  container.replaceChildren();
  for(const[key,title]of SECTIONS){
    const section=el('section',undefined,'card-section '+key),list=el('ol');section.append(el('h3',title),list);
    const items=lines.filter(l=>l.section===key).sort((a,b)=>(a.t??Infinity)-(b.t??Infinity));
    const preferred={circumstances:['cause','state'],reaction:['intervention','brake_event','warning'],result:['stop','min_speed','unknown','speed_after'],limits:['limit','components']}[key];
    const visible=[...items].sort((a,b)=>{const rank=l=>preferred.includes(l.kind)?preferred.indexOf(l.kind):99;return rank(a)-rank(b);}).slice(0,2);
    const details=el('details'),more=el('ol');details.append(el('summary','Подробнее'),more);
    for(const l of items){const li=el('li',undefined,l.kind==='cause'?'cause':'');
      if(l.t!=null&&l.evidence_ids.length){const b=el('button',clock(l.t,true),'time-link');b.type='button';b.title='Перейти к исходной записи';b.dataset.evidenceId=l.evidence_ids[0];b.onclick=()=>onEvidence(l.evidence_ids[0]);li.append(b);}
      const text=l.t!=null?l.text.replace(/^В \d\d:\d\d:\d\d(\.\d+)?\s*/,''):l.text;li.append(el('span',text.charAt(0).toUpperCase()+text.slice(1)));(visible.includes(l)?list:more).append(li);}
    if(more.children.length)section.append(details);
    if(!items.length)list.append(el('li','Нет подтверждённых утверждений.','muted'));
    container.append(section);
  }
}

/* Episode list in the left rail and on the home screen. */
const TARGET={Obstacle:'Препятствие',TrafficLightSignal:'Сигнал светофора',ZoneSpeedLimit:'Зона ограничения скорости'};
export const targetName=t=>TARGET[t]||t||'Цель не указана';
export function episodeRow(e,{selected,onOpen,extra}){
  const b=el('button',undefined,'episode-row');b.type='button';b.dataset.episodeId=e.id;b.setAttribute('aria-pressed',!!selected);
  const dot=el('i',undefined,'dot '+(e.type==='Brake'?'brake':e.type==='Warn'?'warn':'overspeed'));
  const body=el('span',undefined,'episode-body'),head=el('span',undefined,'episode-head');head.append(el('strong',eventName(e)),el('time',clock(e.start)));body.append(head,el('small',targetName(e.target)));b.title=`${e.n} записей · ${num((e.end-e.start)/1000,1)} с`;
  if(e.snapshot_links?.length)body.append(el('small','есть снимок распознавания','snapshot-tag'));
  b.append(dot,body);if(extra)b.append(extra);b.onclick=onOpen;return b;
}
