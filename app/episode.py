"""System state at a moment, signal series and the four-part episode card.

Every statement carries the timestamp and ids of its supporting records.
A logged target never establishes a physical cause. Nothing is inferred about
unobserved movement or the driver's intent.
"""
import math,json
from datetime import datetime,timezone,timedelta

TZ=timezone(timedelta(hours=3))
MODULES=[('speed_limit','Ограничение скорости','act_speed'),('trafficlight','Светофоры','act_light'),('danger_obj','Препятствия','act_danger')]
MODULE_GENITIVE={'speed_limit':'ограничения скорости','trafficlight':'распознавания светофоров','danger_obj':'обнаружения препятствий'}
BRAKES=[('is_mechanical_brake_fb','mechanical','механический'),('is_rail_brake_fb','rail','рельсовый'),('is_emergency_brake_fb','emergency','экстренный'),('is_crash_brake_fb','crash','аварийный')]
COMPONENTS=[('ubloxGps','GPS-приёмник'),('minsEth','Инерциальная навигация'),('leftImage','Левая камера'),('t25Front','Передняя камера T25'),
            ('tramSlaveVisor','TramSlaveVisor'),('tramPlannerService','Планировщик движения'),('dbwFbTram','Электронное управление'),
            ('odoFbTram','Одометрия'),('roadModel','Модель дороги')]
TARGETS={'Obstacle':'препятствие на пути','TrafficLightSignal':'сигнал светофора','ZoneSpeedLimit':'зона ограничения скорости'}
OBJECTS={'Vehicle':'транспортное средство','Human':'человек','TrafficLight':'светофор','SpeedLimit':'ограничение скорости','Unknown':None}
HANDLES={'driver':'водитель','cpilot':'система (cpilot)','undeterminable':'не определён'}
SNAPSHOT_OBJECTS={'CAR':'автомобиль','HUMAN':'человек','TRAFFIC_LIGHT':'светофор'}

def clock(t,ms=False):return datetime.fromtimestamp(t/1000,TZ).strftime('%H:%M:%S.%f')[:12 if ms else 8]
def flag(v):
    value=str(v).strip().lower()
    return True if value in ('1','true') else False if value in ('0','false') else None
def number(v):
    try:
        n=float(v)
        return n if math.isfinite(n) else None
    except (TypeError,ValueError):return None

def system_state(raw,family):
    """Readable state from one source record. Missing fields stay missing (None)."""
    if family!='json':
        return {'family':'csv','note':'CSV содержит упрощённые коды модулей; состояние компонентов в нём не передаётся.'}
    modules=[]
    for key,label,_ in MODULES:
        modules.append({'key':key,'label':label,'request':raw.get(f'm_{key}_req'),'status':raw.get(f'm_{key}_status'),
                        'fsm':raw.get(f'm_{key}_fsm_state'),'act':raw.get(f'm_{key}_act')})
    return {'family':'json','event_type':raw.get('event_type'),'event_target':raw.get('event_target'),
            'adas_on':flag(raw.get('is_adas_button_on')),'fsm_state':raw.get('fsm_state'),'handle':raw.get('handle'),
            'speed':number(raw.get('speed')),'goal_speed':number(raw.get('goal_speed')),'goal_obj_type':raw.get('goal_obj_type'),
            'speed_profile':number(raw.get('m_speed_profile')),'warn_level':number(raw.get('m_warn_level')),
            'speed_mode':number(raw.get('m_speed_mode')),'speed_mode_driver':number(raw.get('m_speed_mode_driver_fb')),
            'modules':modules,'brakes':{name:flag(raw.get(field)) for field,name,_ in BRAKES},
            'call':flag(raw.get('is_call_turned_on_fb')),'safety_pedal':flag(raw.get('is_safety_pedal_turned_on_fb')),
            'skid':flag(raw.get('as_is_skid')),'skid_score':number(raw.get('as_skid_score')),
            'localization':flag(raw.get('is_loc_converged')),'rtk':flag(raw.get('gps_with_rtk')),'voltage':number(raw.get('m_mains_voltage')),
            'reverser':raw.get('course_reverser_pos'),'cabin':raw.get('cabin_type'),'active_cabin':flag(raw.get('is_active_cabin')),
            'components':[{'key':k,'label':label,'ok':flag(raw.get(k))} for k,label in COMPONENTS]}

def signal_row(row,raw):
    out={k:row[k] for k in ('id','t','route','family','type','speed','goal','handle','brakes','act_danger','act_light','act_speed')}
    if row['family']=='json':
        out.update(warn=number(raw.get('m_warn_level')),mode=number(raw.get('m_speed_mode')),driver_mode=number(raw.get('m_speed_mode_driver_fb')),
                   skid=flag(raw.get('as_is_skid')))
    return out

def card(rows,raws,limitations):
    """rows: public records in time order; raws: id -> raw JSON for those with payloads decoded."""
    lines=[]
    def add(section,kind,row_or_rows,text):
        rs=row_or_rows if isinstance(row_or_rows,list) else [row_or_rows]
        lines.append({'section':section,'kind':kind,'t':rs[0]['t'],'text':text,'evidence_ids':[r['id'] for r in rs]})
    json_rows=[r for r in rows if r['family']=='json']
    # Keep speed comparisons within one source; delayed CSV must not alternate with JSON.
    speed_rows=[r for r in rows if r['type']=='Track' and r['speed'] is not None and 0<=r['speed']<=150]
    family='json' if any(r['family']=='json' for r in speed_rows) else 'csv'
    measured=[r for r in speed_rows if r['family']==family]
    raw=lambda r:raws.get(r['id'],{})

    # Circumstances: the starting state and what the system itself registered.
    if measured:
        first=measured[0];g=number(raw(first).get('goal_speed'))
        add('circumstances','state',first,f"В {clock(first['t'])} скорость {first['speed']:.1f} км/ч"+(f", требуемая скорость {g:.0f} км/ч" if g is not None else '')+
            (f", управление: {HANDLES.get(first['handle'],first['handle'])}" if first['handle'] else '')+'.')
    seen_targets=set();cause=None
    for r in json_rows:
        if r['type']=='Track' or not r['target'] or r['target'] in seen_targets:continue
        seen_targets.add(r['target']);obj=raw(r).get('goal_obj_type');obj_name=OBJECTS.get(obj,obj)
        text=f"В {clock(r['t'])} система зарегистрировала событие {r['type']} с целью «{TARGETS.get(r['target'],r['target'])}»"+(f", тип объекта: {obj_name}" if obj_name else '')+'.'
        add('circumstances','detection',r,text)
        if cause is None:cause=(r,obj_name)
    snapshots=[];seen_snapshots=set()
    for r in json_rows:
        if not isinstance(raw(r).get('telemetry_data'),dict):continue
        key=(raw(r).get('telemetry_timestamp'),json.dumps(raw(r)['telemetry_data'],sort_keys=True))
        if key not in seen_snapshots:snapshots.append(r);seen_snapshots.add(key)
    for r in snapshots[:3]:
        data=raw(r)['telemetry_data'];objects=[data['object']] if data.get('object') else data.get('trafficLights',[])
        tracked=[SNAPSHOT_OBJECTS.get(o.get('type'),o.get('type') or 'объект')+(f" ({o.get('tlSignal')})" if o.get('tlSignal') else '') for o in objects if isinstance(o,dict) and o.get('state')=='TRACKED']
        stamp=raw(r).get('telemetry_timestamp')
        try:st=clock(datetime.fromisoformat(stamp.replace('Z','+00:00')).timestamp()*1000,True)
        except (AttributeError,ValueError):st='время снимка не указано'
        add('circumstances','snapshot',r,f"Снимок распознавания {st}: "+(', '.join(dict.fromkeys(tracked))+' в состоянии TRACKED.' if tracked else 'наблюдаемых (TRACKED) объектов нет.'))
    if cause:
        r=next((r for r in json_rows if r['type']=='Brake' and r['target']),cause[0])
        add('circumstances','cause',r,f"Цель event_target: {TARGETS.get(r['target'],r['target'])}. Это обозначение системы; физическая причина реакции не установлена.")
    else:
        add('circumstances','cause',rows[0],'Причина не установлена: в интервале нет поля, которое называет причину реакции системы.')

    # Registered reaction: warnings, interventions, brakes, control source, alarms.
    for _,label,field in MODULES:
        warn=next((r for r in rows if r[field]=='WarningAct'),None);act=next((r for r in rows if r[field]=='ActuationAct'),None)
        if warn:add('reaction','warning',warn,f"В {clock(warn['t'])} модуль «{label}» выдал предупреждение водителю (WarningAct).")
        if act:add('reaction','intervention',act,f"В {clock(act['t'])} модуль «{label}» зарегистрировал запрос вмешательства (ActuationAct).")
    first_brake_event=next((r for r in rows if r['type']=='Brake'),None)
    if first_brake_event:add('reaction','brake_event',first_brake_event,f"В {clock(first_brake_event['t'])} зарегистрировано событие торможения (Brake)"+(f", цель «{TARGETS.get(first_brake_event['target'],first_brake_event['target'])}»" if first_brake_event['target'] else '')+'.')
    for bit,(field,name,label) in zip([1,2,4,8],BRAKES):
        on=next((r for r in rows if r['brakes']&bit),None)
        if on:add('reaction','brake',on,f"В {clock(on['t'])} получена обратная связь: {label} тормоз включён.")
    previous=None;changes=0
    for r in json_rows:
        h=r['handle']
        if previous and h and h!=previous['handle'] and changes<6:
            add('reaction','control',r,f"В {clock(r['t'])} источник управления: {HANDLES.get(previous['handle'],previous['handle'])} → {HANDLES.get(h,h)}.");changes+=1
        if h:previous=r
    call=next((r for r in json_rows if flag(raw(r).get('is_call_turned_on_fb'))),None)
    if call:add('reaction','call',call,f"В {clock(call['t'])} включён звуковой сигнал.")
    skid=next((r for r in json_rows if flag(raw(r).get('as_is_skid'))),None)
    if skid:add('reaction','skid',skid,f"В {clock(skid['t'])} зарегистрирован сигнал юза колёс.")
    peak=max((r for r in json_rows if number(raw(r).get('m_warn_level')) is not None),key=lambda r:number(raw(r).get('m_warn_level')),default=None)
    if peak and number(raw(peak).get('m_warn_level')):add('reaction','warn_level',peak,f"Максимальный уровень предупреждения {number(raw(peak).get('m_warn_level')):.0f} в {clock(peak['t'])} (исходное значение, шкала не подтверждена).")
    if not any(l['section']=='reaction' for l in lines):add('reaction','none',rows[0],'Предупреждений, вмешательств и сигналов тормозов в интервале не зарегистрировано.')

    # Observed result: speed before, during and after; stop; return of control.
    reaction_t=min((l['t'] for l in lines if l['section']=='reaction' and l['kind'] in ('warning','intervention','brake_event')),default=None)
    if measured:
        lowest=min(measured,key=lambda r:r['speed']);last=measured[-1]
        if reaction_t is not None:
            before=[r for r in measured if reaction_t-10000<=r['t']<reaction_t]
            at=next((r for r in measured if reaction_t<=r['t']<=reaction_t+1000),None)
            if before:
                extrema=list({r['id']:r for r in [min(before,key=lambda r:r['speed']),max(before,key=lambda r:r['speed'])]}.values())
                add('result','speed_before',extrema,f"В записях за 10 с до реакции: {min(r['speed'] for r in before):.1f}–{max(r['speed'] for r in before):.1f} км/ч.")
            if at:add('result','speed_at',at,f"Ближайшая запись после реакции ({clock(at['t'])}): {at['speed']:.1f} км/ч.")
        stop_pair=next(([a,b] for a,b in zip(measured,measured[1:]) if a['speed']<.5 and b['speed']<.5 and 0<b['t']-a['t']<=5000 and a['route']==b['route'] and (reaction_t is None or a['t']>=reaction_t)),None)
        if stop_pair:
            add('result','stop',stop_pair,f"В соседних записях {clock(stop_pair[0]['t'])}–{clock(stop_pair[1]['t'])} скорость ниже 0,5 км/ч. Признак остановки по данным скорости; её причина не установлена.")
        else:add('result','min_speed',lowest,f"Минимальная зарегистрированная скорость {lowest['speed']:.1f} км/ч. Данных для подтверждения остановки недостаточно.")
        add('result','speed_after',last,f"В конце интервала {clock(last['t'])}: {last['speed']:.1f} км/ч"+(f", управление: {HANDLES.get(last['handle'],last['handle'])}" if last['handle'] else '')+'.')
        if reaction_t is not None:
            phase=[]
            for r in measured:
                if r['t']>=reaction_t and (not phase or r['t']-phase[-1]['t']>=1000):phase.append(r)
            pair=max(((a,b) for a,b in zip(phase,phase[1:]) if 1000<=b['t']-a['t']<=5000 and a['route']==b['route']),key=lambda p:(p[0]['speed']-p[1]['speed'])/(p[1]['t']-p[0]['t']),default=None)
            if pair:
                a,b=pair;decel=(a['speed']-b['speed'])/3.6/((b['t']-a['t'])/1000)
                if decel>.05:add('result','decel',[a,b],f"Наибольшее расчётное замедление ≈ {decel:.2f} м/с² между {clock(a['t'])} и {clock(b['t'])}. Оценка по двум записям speed, без фильтрации выбросов.")
    else:add('result','unknown',rows[-1],'Нет последовательности записей движения для оценки результата.')
    # Missing information becomes explicit lines with record references when available.
    degraded=[]
    for r in json_rows:
        bad=[label for k,label in COMPONENTS if flag(raw(r).get(k)) is False]
        if bad and not degraded:degraded=[r,bad]
    if degraded:add('limits','components',degraded[0],f"В записи {clock(degraded[0]['t'])} отмечено отсутствие входных данных: {', '.join(degraded[1])}. Это не подтверждение неисправности оборудования.")
    for text in limitations:lines.append({'section':'limits','kind':'limit','t':None,'text':text,'evidence_ids':[]})
    lines.append({'section':'limits','kind':'limit','t':None,'text':'Видео с камер к записям не привязано; действия водителя восстанавливаются только по зарегистрированным полям.','evidence_ids':[]})

    key=[l for l in lines if l['kind'] in ('detection','warning','intervention','brake_event','brake','stop')]
    first={}
    for l in key:first.setdefault(l['kind'] if l['kind']!='brake' else l['text'],l)
    key=sorted(first.values(),key=lambda l:l['t'])
    while len(key)>6:key.remove(next(l for l in reversed(key) if l['kind']=='brake') if any(l['kind']=='brake' for l in key) else key[-2])
    phrases={'detection':'зарегистрирована цель','warning':'предупреждение','intervention':'запрос вмешательства','brake_event':'тормозное событие','stop':'скорость ниже 0,5 км/ч'}
    narrative='; '.join(f"{clock(l['t'])} — "+(phrases.get(l['kind']) or l['text'].split(': ',1)[-1].rstrip('.').lower()) for l in key[:4])
    summary=(narrative[0].upper()+narrative[1:]+'.') if narrative else 'В интервале нет зарегистрированных срабатываний системы; доступна только телеметрия движения.'
    return {'summary':summary,'lines':lines}
