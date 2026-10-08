from pathlib import Path
from collections import Counter,defaultdict
import json,hashlib
ROOT=Path(__file__).resolve().parents[1]
inventory=json.loads((ROOT/'analysis/file-inventory.json').read_text(encoding='utf-8'))
groups={}
for x in inventory:
    if 'payload_sha256' in x:groups.setdefault(x['payload_sha256'],x['path'])
seen=set();found=[]
for p in groups.values():
    with (ROOT/p).open('rb') as f:
        buf=b''
        for b in iter(lambda:f.read(1024*1024),b''):
            parts=(buf+b).split(b'\x1e');buf=parts[-1]
            for raw in parts[:-1]:
                if b'"telemetry_data"' not in raw:continue
                try:r=json.loads(raw)
                except ValueError:continue
                for e in r.get('events',[r]):
                    if 'telemetry_data' not in e:continue
                    h=hashlib.sha256(json.dumps(e,sort_keys=True).encode()).digest()
                    if h in seen:continue
                    seen.add(h);found.append({'source':p,'record':e})
fields=Counter();subsystems=Counter();nested=defaultdict(Counter)
for item in found:
    t=item['record']['telemetry_data'];fields.update(t.keys());subsystems[str(t.get('subsystem'))]+=1
    for k,v in t.items():
        if isinstance(v,list):
            for obj in v:
                if isinstance(obj,dict):nested[k].update(obj.keys())
        elif isinstance(v,dict):nested[k].update(v.keys())
summary={'records':len(found),'fields':fields,'subsystems':subsystems,'nested_keys':dict(nested),'examples':[]}
for subsystem in subsystems:
    summary['examples'].append(next(x for x in found if str(x['record']['telemetry_data'].get('subsystem'))==subsystem))
(ROOT/'analysis/rich-telemetry-audit.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({k:v for k,v in summary.items() if k!='examples'},ensure_ascii=True))
