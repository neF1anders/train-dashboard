"""Read-only audit of supplied hackathon files. No source files are modified."""
from pathlib import Path
from collections import Counter, defaultdict
from datetime import datetime
import hashlib, json, csv, statistics

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'analysis'
DATA = ROOT / 'materials' / 'extracted'

def sha(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for b in iter(lambda: f.read(1024*1024), b''): h.update(b)
    return h.hexdigest()

def records(path):
    with path.open('rb') as f:
        buf=b''
        for b in iter(lambda: f.read(1024*1024), b''):
            parts=(buf+b).split(b'\x1e')
            yield from parts[:-1]
            buf=parts[-1]
        if buf.strip(): yield buf

files=[]
payload_groups=defaultdict(list)
cached = OUT / 'file-inventory.json'
if cached.exists():
    files = json.loads(cached.read_text(encoding='utf-8'))
    for item in files:
        if 'payload_sha256' in item: payload_groups[item['payload_sha256']].append(item['path'])
for p in ([] if files else sorted(DATA.rglob('*'))):
    if not p.is_file(): continue
    item={'path':str(p.relative_to(ROOT)), 'bytes':p.stat().st_size,'sha256':sha(p)}
    if p.suffix=='.jsonseq':
        h=hashlib.sha256(); prefix=None
        for i,b in enumerate(records(p)):
            if i==0:
                prefix=b
                if not b.strip(): continue
                try: json.loads(b)
                except (json.JSONDecodeError,UnicodeDecodeError):
                    item['preamble_bytes']=len(b)
                    item['preamble_contains_comments']=b'//' in b
                    continue
            h.update(b.strip());h.update(b'\x1e')
        item['payload_sha256']=h.hexdigest()
        payload_groups[item['payload_sha256']].append(item['path'])
    files.append(item)
OUT.joinpath('file-inventory.json').write_text(json.dumps(files,ensure_ascii=False,indent=2),encoding='utf-8')
print('Inventoried',len(files),'files;',len(payload_groups),'unique JSON sequence payloads',flush=True)

selected_fields=['loco_number','device_id','timestamp_source','event_type','route_id','m_current_route_name','goal_obj_type','handle','fsm_state','m_warn_level','is_adas_button_on','is_loc_converged','m_danger_obj_act','m_trafficlight_act','m_speed_limit_act','m_danger_obj_status','m_trafficlight_status','m_speed_limit_status','m_danger_obj_fsm_state','m_trafficlight_fsm_state','m_speed_limit_fsm_state','is_emergency_brake_fb','is_mechanical_brake_fb','is_rail_brake_fb','is_crash_brake_fb','as_is_skid']
global_values=defaultdict(Counter); global_keys=Counter(); global_types=defaultdict(Counter)
seen=set(); identity_hash={}; conflict_keys=set(); unique_count=0; overlaps=0
summaries=[]; examples=[]; windows=[]; global_days=Counter(); pair_conflicts=0
for payload,paths in payload_groups.items():
    path=ROOT/paths[0]; n=0;bad=0;missing_time=0;missing_time_examples=[];keys=Counter();values=defaultdict(Counter);days=Counter();times=[]; gaps=[];zero_coords=0; speeds=[];brake_counts=Counter();state_changes=Counter();prev=None; prev_dt=None; first=None;last=None; nonmonotonic=0;duplicates=0
    for idx,b in enumerate(records(path)):
        if not b.strip(): continue
        try: r=json.loads(b)
        except (json.JSONDecodeError,UnicodeDecodeError): bad+=1;continue
        if not isinstance(r,dict) or not r.get('timestamp'):
            missing_time+=1
            if len(missing_time_examples)<3:missing_time_examples.append({'keys':list(r.keys()) if isinstance(r,dict) else [],'nested_events_count':len(r.get('events',[])) if isinstance(r,dict) else 0})
            continue
        n+=1
        canonical=json.dumps(r,sort_keys=True,separators=(',',':'),ensure_ascii=False)
        digest=hashlib.sha256(canonical.encode()).digest()
        identity=(r.get('device_id'),r.get('cabin_type'),r.get('timestamp'))
        if identity in identity_hash and identity_hash[identity]!=digest: conflict_keys.add(identity)
        identity_hash[identity]=digest
        is_new=digest not in seen
        if is_new: seen.add(digest);unique_count+=1
        else: overlaps+=1;duplicates+=1
        keys.update(r.keys())
        if is_new:
            global_keys.update(r.keys())
            for k,v in r.items():global_types[k][type(v).__name__]+=1
        for k in selected_fields:
            if k in r:
                values[k][str(r[k])]+=1
                if is_new:global_values[k][str(r[k])]+=1
        ts=r.get('timestamp','');days[ts[:10]]+=1
        if is_new:global_days[ts[:10]]+=1
        first=min(first,ts) if first else ts; last=max(last,ts) if last else ts
        try:
            dt=datetime.fromisoformat(ts)
            if prev_dt:
                delta=(dt-prev_dt).total_seconds()
                if delta<0: nonmonotonic+=1
                if delta>=0:times.append(delta)
                if delta>30:gaps.append({'before':prev['timestamp'],'after':ts,'seconds':delta})
            prev_dt=dt
        except ValueError:pass
        try:
            speeds.append(float(r['speed']))
            if float(r.get('latitude',0))==0 or float(r.get('longitude',0))==0:zero_coords+=1
        except (KeyError,ValueError):pass
        if prev:
            for k in selected_fields:
                if k in r and k in prev and r[k]!=prev[k]:state_changes[k]+=1
        for k in ['is_emergency_brake_fb','is_crash_brake_fb','is_rail_brake_fb','is_mechanical_brake_fb']:
            if str(r.get(k)).lower()=='true':
                brake_counts[k]+=1
                if is_new and prev and prev.get(k)=='false' and len([x for x in examples if x['field']==k])<3:
                    examples.append({'source':paths[0],'record_index':idx,'field':k,'previous':prev,'current':r})
        prev=r
    summary={'source':paths[0],'same_payload_files':paths,'records':n,'skipped_non_json_blocks':bad,'missing_time_records':missing_time,'missing_time_examples':missing_time_examples,'duplicate_rows_against_previously_scanned':duplicates,'first':first,'last':last,'dates':days,'keys':keys,'values':dict(values),'speed_min':min(speeds) if speeds else None,'speed_max':max(speeds) if speeds else None,'zero_coords':zero_coords,'median_dt_sec':statistics.median(times) if times else None,'dt_counts_top':Counter(round(t,3) for t in times).most_common(12),'gaps_over_30s':len(gaps),'largest_gaps':sorted(gaps,key=lambda x:x['seconds'],reverse=True)[:5],'backward_timestamps':nonmonotonic,'brake_true_rows':brake_counts,'field_transitions':state_changes}
    summaries.append(summary)
    print('Parsed',paths[0],n,'rows',flush=True)

csv_summaries=[];csv_hashes={}
for item in files:
    p=ROOT/item['path']
    if p.suffix!='.csv':continue
    if item['sha256'] in csv_hashes:
        csv_summaries.append({'source':item['path'],'duplicate_of':csv_hashes[item['sha256']]});continue
    csv_hashes[item['sha256']]=item['path']
    vals=defaultdict(Counter);n=0;first=None;last=None;bad=0;keys=[];dates=Counter()
    with p.open(encoding='utf-8-sig',newline='') as f:
        reader=csv.DictReader(f,delimiter=';');keys=reader.fieldnames
        for row in reader:
            n+=1;raw=row.get('date','')
            try:dt=datetime.strptime(raw,'%m/%d/%Y %H:%M:%S').isoformat()
            except ValueError:bad+=1;continue
            first=min(first,dt) if first else dt;last=max(last,dt) if last else dt;dates[dt[:10]]+=1
            for k in ['loco','controller','brakeMech','brakeRail','brakeCrash','brakeEmergency','dangObjAct','dangObjRealAct','trafLightAct','trafLightRealAct','speedLimitAct','speedLimitRealAct']:vals[k][row.get(k,'')]+=1
    csv_summaries.append({'source':item['path'],'rows':n,'columns':keys,'date_parse_errors':bad,'first':first,'last':last,'dates':dates,'values':dict(vals)})

report={'record_scope':'Flat Track records only. Root events containers are profiled separately in event-audit.json. missing_time_records counts these containers, not broken timestamps.','file_count':len(files),'extension_counts':Counter(Path(x['path']).suffix for x in files),'uncompressed_bytes':sum(x['bytes'] for x in files),'unique_json_payloads':len(payload_groups),'unique_json_records':unique_count,'overlap_rows_between_payloads':overlaps,'conflicting_identity_count':len(conflict_keys),'conflicting_identity_samples':list(conflict_keys)[:10],'global_dates':global_days,'global_fields':global_keys,'global_value_types':dict(global_types),'global_values':dict(global_values),'json_files':summaries,'csv_files':csv_summaries}
OUT.joinpath('data-audit.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
OUT.joinpath('episode-evidence-examples.json').write_text(json.dumps(examples,ensure_ascii=False,indent=2),encoding='utf-8')
print('DONE',json.dumps({k:report[k] for k in ['file_count','extension_counts','unique_json_payloads','unique_json_records','overlap_rows_between_payloads','conflicting_identity_count']}),flush=True)
