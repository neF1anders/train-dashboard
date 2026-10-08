"""Audit nested event packets separately from the sparse Track stream."""
from pathlib import Path
from collections import Counter,defaultdict
import json,hashlib

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'analysis'
inventory=json.loads((OUT/'file-inventory.json').read_text(encoding='utf-8'))
groups={}
for x in inventory:
    if 'payload_sha256' in x:groups.setdefault(x['payload_sha256'],x['path'])

def records(p):
    with p.open('rb') as f:
        buf=b''
        for b in iter(lambda:f.read(1024*1024),b''):
            parts=(buf+b).split(b'\x1e');yield from parts[:-1];buf=parts[-1]
        if buf.strip():yield buf

shapes=Counter();keys=Counter();values=defaultdict(Counter);nested_types=defaultdict(Counter);seen=set();duplicates=0;total=0;examples=defaultdict(list);file_info=[];numeric=defaultdict(lambda:[float('inf'),float('-inf')]);times=defaultdict(list)
selected=['event_type','event_target','loco_number','timestamp_source','goal_obj_type','handle','m_danger_obj_act','m_trafficlight_act','m_speed_limit_act','m_warn_level','is_emergency_brake_fb','is_crash_brake_fb','is_rail_brake_fb','status_skip']
for p in groups.values():
    per_file=Counter();wrappers=0
    for idx,b in enumerate(records(ROOT/p)):
        if not b.strip():continue
        try:r=json.loads(b)
        except (ValueError,UnicodeDecodeError):continue
        if r.get('timestamp'):shapes['flat_record']+=1;continue
        shape=','.join(sorted(r.keys()));shapes[shape]+=1
        if not isinstance(r.get('events'),list):continue
        wrappers+=1
        for j,e in enumerate(r['events']):
            total+=1
            h=hashlib.sha256(json.dumps(e,sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()).digest()
            if h in seen:duplicates+=1;continue
            seen.add(h);keys.update(e.keys())
            for k,v in e.items():
                nested_types[k][type(v).__name__]+=1
                if isinstance(v,str):
                    try:
                        n=float(v)
                        numeric[k][0]=min(numeric[k][0],n);numeric[k][1]=max(numeric[k][1],n)
                    except ValueError:pass
            for k in selected:
                if k in e:values[k][str(e[k])]+=1
            typ=e.get('event_type','missing');per_file[typ]+=1
            times[e.get('loco_number','missing')].append(e.get('timestamp',''))
            if len(examples[typ])<3:examples[typ].append({'source':p,'sequence_index':idx,'json_pointer':f'/events/{j}','data':e})
    file_info.append({'source':p,'packets':wrappers,'new_unique_event_records':per_file})
    print(p,'packets',wrappers,'unique',sum(per_file.values()),flush=True)
report={'root_shapes':shapes,'event_occurrences_in_distinct_payloads':total,'unique_exact_event_records':len(seen),'duplicate_event_occurrences':duplicates,'fields':keys,'field_types':dict(nested_types),'values':dict(values),'numeric_ranges':dict(numeric),'time_ranges':{k:{'first':min(v),'last':max(v)} for k,v in times.items()},'files':file_info}
(OUT/'event-audit.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
(OUT/'event-samples.json').write_text(json.dumps(dict(examples),ensure_ascii=False,indent=2),encoding='utf-8')
print('DONE',len(seen),dict(values['event_type']),flush=True)
