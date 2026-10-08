from .storage import PUBLIC_COLUMNS,public,raw_record,VERSION,meta
from datetime import datetime,timezone
import json,uuid

LABELS={'act_danger':'Модуль препятствий','act_light':'Модуль светофоров','act_speed':'Модуль ограничения скорости'}
HANDLES={'driver':'водитель','cpilot':'cpilot','undeterminable':'неопределённый источник'}

def scope(vehicle,start,end,route=None):
    where='vehicle=? AND t>=? AND t<=?';args=[vehicle,start,end]
    if route is not None and route!='all':where+=' AND route=?';args.append(route)
    return where,args

def analyze(con,vehicle,start,end,route):
    where,args=scope(vehicle,start,end,route)
    rows=[public(r) for r in con.execute('SELECT '+PUBLIC_COLUMNS+' FROM records WHERE '+where+' ORDER BY t,id',args)]
    if not rows:raise ValueError('В интервале нет наблюдений. Расширьте границы.')
    # A claim always points to actual records, and every source remains inspectable.
    facts=[]
    def add(title,text,records,kind):
        facts.append({'title':title,'text':text,'kind':kind,'t':records[0]['t'],'evidence_ids':[r['id'] for r in records]})
    measured=[r for r in rows if r['speed'] is not None and 0<=r['speed']<=150]
    if measured:
        first,last=measured[0],measured[-1]
        add('Движение',f"В начале доступных записей скорость {first['speed']:.1f} км/ч, в конце — {last['speed']:.1f} км/ч.",[first,last],'speed')
    for field,label in LABELS.items():
        act=next((r for r in rows if r[field]=='ActuationAct'),None)
        warn=next((r for r in rows if r[field]=='WarningAct'),None)
        if act:add(label,f'{label} зарегистрировал ActuationAct — запрос вмешательства.',[act],'intervention')
        elif warn:add(label,f'{label} зарегистрировал WarningAct — предупреждение.',[warn],'warning')
    for bit,title in [(1,'Механический тормоз'),(2,'Рельсовый тормоз'),(4,'Экстренный тормоз'),(8,'Аварийный тормоз')]:
        row=next((r for r in rows if r['brakes']&bit),None)
        if row:add(title,f'Есть положительный сигнал обратной связи: {title.lower()}.',[row],'brake')
    controls=[];seen=set()
    for r in rows:
        if r['handle'] and r['handle'] not in seen:seen.add(r['handle']);controls.append(r)
    if controls:add('Источник управления','Встречаются: '+', '.join(HANDLES.get(r['handle'],r['handle']) for r in controls)+'. Это значения отдельных записей; непрерывное управление одним источником не предполагается.',controls,'control')
    targets=[];seen=set()
    for r in rows:
        if r['target'] and r['target'] not in seen:seen.add(r['target']);targets.append(r)
    if targets:add('Зарегистрированная цель',', '.join(r['target'] for r in targets)+'. Это обозначения системы, а не подтверждение физической причины.',targets,'target')
    times=sorted(set(r['t'] for r in rows));gaps=[[a,b] for a,b in zip(times,times[1:]) if b-a>30000]
    coverage=sum((b-a) for a,b in zip(times,times[1:]) if 0<b-a<=30000)/1000
    limits=['Снижение скорости не устанавливает единственную причину остановки. Корректность вмешательства требует экспертной проверки.']
    rich=[r for r in rows if r['telemetry']]
    if not rich:limits.append('В интервале нет расширенных снимков с геометрией объектов; точное положение препятствия восстановить нельзя.')
    else:limits.append('Есть расширенные снимки. Система координат и единицы pose требуют подтверждения; снимок не означает непрерывное наблюдение объекта.')
    if gaps:limits.append(f'Есть {len(gaps)} разрывов более 30 секунд; движение внутри них не восстанавливается.')
    if all(r['family']=='csv' for r in rows):limits.append('Доступны только CSV: подробных событий JSON нет. Часовой пояс CSV принят как Москва; числовые коды модулей сохранены без догадок.')
    if any('position_disagreement' in r['flags'] for r in rows):limits.append('Есть расхождение расчётных и исходных GPS-координат. Карта показывает исходный GPS с отметкой качества.')
    summary=' '.join(f['text'] for f in facts if f['kind'] in ('speed','intervention','brake'))
    if not summary:summary='Доступны наблюдения, но данных для подтверждённого вывода о вмешательстве недостаточно.'
    return {'id':uuid.uuid4().hex,'created':datetime.now(timezone.utc).isoformat(),'vehicle':vehicle,'start':start,'end':end,'route':route,
            'rules_version':VERSION,'data_version':meta(con,'data_version'),'engine':'rules','summary':summary,
            'facts':facts,'limitations':limits,'coverage_seconds':coverage,'records':len(rows),'gaps':gaps,'snapshot_ids':[r['id'] for r in rich],
            'speed_max':max((r['speed'] for r in measured),default=None)}

def answer(result,question):
    text=question.lower()
    kinds=[]
    if any(k in text for k in ['почему','причин','вмеш','сработ','опасн']):kinds=['intervention','warning','target']
    elif any(k in text for k in ['кто','управл','водител','пилот']):kinds=['control']
    elif any(k in text for k in ['тормоз','останов']):kinds=['brake','speed']
    elif any(k in text for k in ['скорост','движ','разгон']):kinds=['speed']
    elif any(k in text for k in ['не хватает','огранич','данны','достовер','геометр','объект','координат']):return {'text':' '.join(result['limitations']),'evidence_ids':[],'engine':'rules'}
    else:return {'text':'Разбор по правилам отвечает о вмешательстве, управлении, торможении, скорости и полноте данных. Уточните вопрос в одной из этих тем. Свободная генерация языковой моделью не подключена.','evidence_ids':[],'engine':'rules'}
    facts=[f for f in result['facts'] if f['kind'] in kinds]
    response=' '.join(f['text'] for f in facts) if facts else 'В этом интервале нет подтверждающих записей для такого вывода.'
    if 'intervention' in kinds:response+=' Причинная связь и обоснованность вмешательства по одному названию события не устанавливаются.'
    return {'text':response,'evidence_ids':list(dict.fromkeys(i for f in facts for i in f['evidence_ids'])),'engine':'rules'}
