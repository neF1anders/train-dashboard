"""Summarize log coverage without counting duplicate files, overlaps or long gaps."""
from pathlib import Path
from collections import defaultdict,Counter
from datetime import datetime,timezone,timedelta
import json,csv

ROOT=Path(__file__).resolve().parents[1]
inventory=json.loads((ROOT/'analysis/file-inventory.json').read_text(encoding='utf-8'))
tz=timezone(timedelta(hours=3))
samples={name:defaultdict(set) for name in ['json','csv']}
routes={name:defaultdict(set) for name in ['json','csv']}
route_obs=defaultdict(set)

def normalize_route(value):
    value=str(value or '').strip()
    if not value:return ''
    parts=value.split('.',1)
    return str(int(parts[0]))+('.'+parts[1] if len(parts)>1 else '') if parts[0].isdigit() else value

def add(family,vehicle,ts,route):
    vehicle=str(vehicle).removeprefix('trm').zfill(4)
    if not vehicle or not ts:return
    t=round(ts.timestamp()*1000)
    samples[family][vehicle].add(t)
    route=normalize_route(route)
    if route:
        routes[family][vehicle].add(route)
        route_obs[(vehicle,route)].add(t)

def records(path):
    with path.open('rb') as f:
        buf=b''
        for b in iter(lambda:f.read(1024*1024),b''):
            parts=(buf+b).split(b'\x1e');yield from parts[:-1];buf=parts[-1]
        if buf.strip():yield buf

seen_json=set();seen_csv=set()
for item in inventory:
    path=ROOT/item['path']
    if path.suffix=='.jsonseq':
        h=item['payload_sha256']
        if h in seen_json:continue
        seen_json.add(h)
        for raw in records(path):
            if not raw.strip():continue
            try:r=json.loads(raw)
            except ValueError:continue
            for row in r.get('events',[r]):
                if not row.get('timestamp'):continue
                add('json',row.get('loco_number'),datetime.fromisoformat(row['timestamp']),row.get('m_current_route_name'))
        print('JSON',path.name,flush=True)
    elif path.suffix=='.csv':
        if item['sha256'] in seen_csv:continue
        seen_csv.add(item['sha256'])
        with path.open(encoding='utf-8-sig',newline='') as f:
            for row in csv.DictReader(f,delimiter=';'):
                t=datetime.strptime(row['date'],'%m/%d/%Y %H:%M:%S').replace(tzinfo=tz)
                add('csv',row['loco'],t,row['route'])

def merge(intervals):
    result=[]
    for a,b in sorted(intervals):
        if result and a<=result[-1][1]:result[-1][1]=max(b,result[-1][1])
        else:result.append([a,b])
    return result

def intervals(points,gap):
    pts=sorted(points)
    return merge((a,b) for a,b in zip(pts,pts[1:]) if 0<b-a<=gap*1000)

def hours(intervals):return sum(b-a for a,b in intervals)/3600000

report={'method':'Sum of per-vehicle unions of intervals between adjacent samples no more than 30 seconds apart. Overlaps within/between CSV and JSON count once. Stationary time included. CSV naive timestamps assumed UTC+03:00, consistent with matching JSON. No extrapolation before first or after last sample.', 'vehicles':[], 'sensitivity_hours':{},'routes':[]}
vehicles=sorted(set(samples['json'])|set(samples['csv']))
for gap in [10,30,60]:
    total=0;js=0;cs=0
    for vehicle in vehicles:
        ji=intervals(samples['json'][vehicle],gap);ci=intervals(samples['csv'][vehicle],gap)
        total+=hours(merge(ji+ci));js+=hours(ji);cs+=hours(ci)
    report['sensitivity_hours'][str(gap)]={'json':js,'csv':cs,'combined':total}

for vehicle in vehicles:
    jp=samples['json'][vehicle];cp=samples['csv'][vehicle];allp=jp|cp
    ji=intervals(jp,30);ci=intervals(cp,30);combined=merge(ji+ci)
    dates={datetime.fromtimestamp(t/1000,tz).date().isoformat() for t in allp}
    report['vehicles'].append({'vehicle':vehicle,'json_hours':hours(ji),'csv_hours':hours(ci),'combined_hours':hours(combined),'json_distinct_timestamps':len(jp),'csv_distinct_timestamps':len(cp),'first':datetime.fromtimestamp(min(allp)/1000,tz).isoformat(),'last':datetime.fromtimestamp(max(allp)/1000,tz).isoformat(),'calendar_dates':sorted(dates),'routes':sorted(routes['json'][vehicle]|routes['csv'][vehicle])})

names=sorted(set().union(*(v for fam in routes.values() for v in fam.values())),key=lambda x:tuple(int(p) for p in x.split('.')))
for route in names:
    points={v:route_obs[(v,route)] for v in vehicles if route_obs[(v,route)]}
    report['routes'].append({'route':route,'base_number':route.split('.')[0],'vehicles':list(points),'observations':sum(len(p) for p in points.values()),'same_route_coverage_hours':sum(hours(intervals(p,30)) for p in points.values())})
report['nonzero_route_numbers']=sorted({int(x['base_number']) for x in report['routes'] if x['base_number']!='0'})
report['nonzero_route_variants']=sum(x['base_number']!='0' for x in report['routes'])
report['total_hours']=report['sensitivity_hours']['30']['combined']
(ROOT/'analysis/coverage-summary.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(report,ensure_ascii=True,indent=2))
