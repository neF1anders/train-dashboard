"""Streaming, resumable import. Originals are immutable; exact records are deduplicated."""
from .storage import ROOT,DATA,VERSION,init,connect
from datetime import datetime,timezone,timedelta
from collections import defaultdict
import csv,hashlib,json,math,zlib,time

TZ=timezone(timedelta(hours=3))

def blocks(path):
    with path.open('rb') as f:
        buf=b''
        for b in iter(lambda:f.read(1024*1024),b''):
            parts=(buf+b).split(b'\x1e');yield from parts[:-1];buf=parts[-1]
        if buf.strip():yield buf

def num(v):
    try:
        x=float(v)
        return x if math.isfinite(x) else None
    except (TypeError,ValueError):return None

def boolean(v):return str(v).lower() in ('1','true')

def variant(v):
    p=str(v or '').strip().split('.',1)
    if not p[0].isdigit():return '0','Не определён'
    route=str(int(p[0]));return route,route+('.'+p[1] if len(p)>1 else '')

def valid(lat,lon):return lat is not None and lon is not None and -90<=lat<=90 and -180<=lon<=180 and lat!=0 and lon!=0

def distance(a,b,c,d):
    return math.hypot((a-c)*111320,(b-d)*111320*math.cos(math.radians((a+c)/2)))

def normalize(r,family,source,seq,pointer):
    flags=[]
    if family=='json':
        dt=datetime.fromisoformat(r['timestamp']).astimezone(TZ)
        v=str(r.get('loco_number','')).removeprefix('trm').zfill(4)
        route,var=variant(r.get('m_current_route_name'))
        la,lo=num(r.get('latitude')),num(r.get('longitude'))
        ra,ro=num(r.get('raw_last_latitude')),num(r.get('raw_last_longitude'))
        if valid(ra,ro):
            lat,lon=ra,ro
            if valid(la,lo) and distance(ra,ro,la,lo)>75:flags.append('position_disagreement')
        else:lat,lon=la,lo;flags.append('localized_position')
        brakes=sum((1<<i) for i,k in enumerate(['is_mechanical_brake_fb','is_rail_brake_fb','is_emergency_brake_fb','is_crash_brake_fb']) if boolean(r.get(k)))
        values=[r.get('event_type','Track'),r.get('event_target'),num(r.get('speed')),num(r.get('goal_speed')),
                num(r.get('path_pos')),r.get('cur_railsegm_id'),r.get('handle'),brakes,
                r.get('m_danger_obj_act'),r.get('m_trafficlight_act'),r.get('m_speed_limit_act')]
        telemetry=int(isinstance(r.get('telemetry_data'),dict))
        if str(r.get('is_loc_converged','')).lower()=='false':flags.append('localization_not_converged')
    else:
        dt=datetime.strptime(r['date'],'%m/%d/%Y %H:%M:%S').replace(tzinfo=TZ)
        v=str(r['loco']).zfill(4);route,var=variant(r.get('route'))
        geo=r.get('geo','').split(',');lat,lon=(num(geo[0]),num(geo[1])) if len(geo)==2 else (None,None)
        la,lo=lat,lon;flags.append('csv_timezone_assumed_msk')
        brakes=sum((1<<i) for i,k in enumerate(['brakeMech','brakeRail','brakeEmergency','brakeCrash']) if boolean(r.get(k)))
        values=['Track',None,num(r.get('speed')),None,num(r.get('pathPos')),None,r.get('controller'),brakes,
                'CSV:'+r.get('dangObjAct',''),'CSV:'+r.get('trafLightAct',''),'CSV:'+r.get('speedLimitAct','')]
        telemetry=0
    if not valid(lat,lon):lat=lon=None;flags.append('missing_position')
    raw=json.dumps(r,sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()
    h=hashlib.sha256(family.encode()+b'\0'+raw).hexdigest()
    typ,target,speed,goal,pos,segment,handle,brakes,ad,al,asp=values
    if speed is not None and not 0<=speed<=150:flags.append('speed_out_of_range')
    return (h,v,dt.date().isoformat(),round(dt.timestamp()*1000),route,var,family,typ,target,speed,goal,
            lat,lon,la,lo,pos,segment,handle,brakes,ad,al,asp,json.dumps(flags),telemetry,source,seq,pointer,zlib.compress(raw,3))

def progress(**values):
    path=DATA/'import-progress.json';tmp=path.with_suffix('.tmp');tmp.write_text(json.dumps(values,ensure_ascii=False),encoding='utf-8');tmp.replace(path)

def run():
    init();started=time.time()
    inventory=json.loads((ROOT/'analysis/file-inventory.json').read_text(encoding='utf-8'))
    groups=defaultdict(list)
    for f in inventory:groups[(f.get('payload_sha256') or f['sha256'], 'json' if f['path'].endswith('.jsonseq') else 'csv')].append(f)
    failed=0;skipped=0
    with connect() as con:
        for file_index,((sha,family),items) in enumerate(groups.items()):
            item=items[0];path=ROOT/item['path'].replace('\\','/')
            con.execute('INSERT OR IGNORE INTO sources(path,sha,aliases) VALUES(?,?,?)',(item['path'],sha,json.dumps([x['path'] for x in items],ensure_ascii=False)))
            src=con.execute('SELECT * FROM sources WHERE path=?',(item['path'],)).fetchone()
            if src['done']:continue
            progress(status='importing',current=file_index,total=len(groups),source=item['path'],errors=failed)
            batch=[]
            def flush():
                if batch:
                    con.executemany('INSERT OR IGNORE INTO records(h,vehicle,day,t,route,variant,family,type,target,speed,goal,lat,lon,loc_lat,loc_lon,pos,segment,handle,brakes,act_danger,act_light,act_speed,flags,telemetry,source_id,seq,pointer,payload) VALUES('+','.join('?'*28)+')',batch)
                    con.commit();batch.clear()
            if family=='json':
                for seq,raw in enumerate(blocks(path)):
                    if not raw.strip():continue
                    try:packet=json.loads(raw)
                    except (ValueError,UnicodeDecodeError):skipped+=1;continue
                    if not isinstance(packet,dict):failed+=1;continue
                    entries=[(packet,'')] if packet.get('timestamp') else [(e,f'/events/{i}') for i,e in enumerate(packet.get('events',[]))]
                    for r,pointer in entries:
                        try:batch.append(normalize(r,family,src['id'],seq,pointer))
                        except (ValueError,TypeError,KeyError):failed+=1
                    if len(batch)>=3000:flush()
            else:
                with path.open(encoding='utf-8-sig',newline='') as f:
                    for seq,r in enumerate(csv.DictReader(f,delimiter=';'),2):
                        try:batch.append(normalize(r,family,src['id'],seq,''))
                        except (ValueError,TypeError,KeyError):failed+=1
                        if len(batch)>=3000:flush()
            flush();con.execute('UPDATE sources SET done=1 WHERE id=?',(src['id'],));con.commit()
            print(f'{file_index+1}/{len(groups)} {path.name}',flush=True)
        progress(status='indexing',current=len(groups),total=len(groups))
        con.execute('DELETE FROM catalog')
        con.execute('''INSERT INTO catalog SELECT vehicle,day,route,group_concat(DISTINCT variant),min(t),max(t),count(*),sum(family='json'),0 FROM records GROUP BY vehicle,day,route''')
        # Coverage counts only adjacent observations up to 30 s; CSV/JSON overlap counted once.
        coverage=defaultdict(float);previous={}
        for r in con.execute('SELECT DISTINCT vehicle,day,route,t FROM records ORDER BY vehicle,day,route,t'):
            key=(r['vehicle'],r['day'],r['route']);last=previous.get(key)
            if last is not None and 0<r['t']-last<=30000:coverage[key]+=(r['t']-last)/3600000
            previous[key]=r['t']
        con.executemany('UPDATE catalog SET hours=? WHERE vehicle=? AND day=? AND route=?',[(n,*k) for k,n in coverage.items()])
        con.execute('DELETE FROM episodes')
        groups2={};episodes=[]
        for r in con.execute("SELECT id,vehicle,day,route,t,type,target FROM records WHERE family='json' AND type!='Track' ORDER BY vehicle,t,id"):
            k=(r['vehicle'],r['day'],r['route'],r['type'],r['target'] or '')
            cur=groups2.get(k)
            if cur and r['t']-cur[4]<=8000:cur[4]=r['t'];cur[7]+=1
            else:
                if cur:episodes.append(cur)
                groups2[k]=[r['vehicle'],r['day'],r['route'],r['t'],r['t'],r['type'],r['target'],1,r['id']]
        episodes.extend(groups2.values())
        con.executemany('INSERT INTO episodes(vehicle,day,route,start,end,type,target,n,evidence_id) VALUES(?,?,?,?,?,?,?,?,?)',episodes)
        summary={'version':VERSION,'records':con.execute('SELECT count(*) FROM records').fetchone()[0],
                 'json_records':con.execute("SELECT count(*) FROM records WHERE family='json'").fetchone()[0],
                 'episodes':len(episodes),'skipped_preamble_blocks':skipped,'parse_errors':failed,
                 'source_files':len(inventory),'distinct_sources':len(groups),'seconds':round(time.time()-started,1)}
        con.execute('INSERT OR REPLACE INTO metadata VALUES(?,?)',('import',json.dumps(summary)))
        con.execute('INSERT OR REPLACE INTO metadata VALUES(?,?)',('data_version',json.dumps(hashlib.sha256(json.dumps(inventory,sort_keys=True).encode()).hexdigest())))
        con.commit()
    progress(status='ready',**summary);print(json.dumps(summary),flush=True)

if __name__=='__main__':
    try:run()
    except Exception as e:
        progress(status='error',error=str(e));raise
