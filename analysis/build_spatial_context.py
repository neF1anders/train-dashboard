"""Local spatial comparison against the downloaded public city map.

Nearest features are candidates, not a verified route or track assignment.
No log coordinates are sent to a remote service.
"""
from pathlib import Path
from collections import defaultdict, Counter
import json, math, hashlib
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
osm_path = ROOT / 'analysis/osm-spb-public.json'
osm = json.loads(osm_path.read_text(encoding='utf-8'))
episode = json.loads((ROOT / 'analysis/demo-episode.json').read_text(encoding='utf-8'))
sx, sy = 111320 * math.cos(math.radians(60)), 111320
def xy(lat, lon): return [(lon - 30.32) * sx, (lat - 59.956) * sy]
def ll(x, y): return [y / sy + 59.956, x / sx + 30.32]
features = []
for e in osm['elements']:
    geom = e.get('geometry', [])
    if len(geom) < 2: continue
    tags = e.get('tags', {})
    features.append({'id': e['id'], 'kind': 'rail' if tags.get('railway') == 'tram' else 'street',
                     'name': tags.get('name', ''), 'points': [xy(p['lat'], p['lon']) for p in geom]})

segments, meta, grid = [], [], defaultdict(set)
cell = 160
for f in features:
    for a, b in zip(f['points'], f['points'][1:]):
        i = len(segments); segments.append([*a, *b]); meta.append((f['id'], f['kind'], f['name']))
        for x in range(math.floor(min(a[0], b[0])/cell), math.floor(max(a[0], b[0])/cell)+1):
            for y in range(math.floor(min(a[1], b[1])/cell), math.floor(max(a[1], b[1])/cell)+1):
                grid[(x,y)].add(i)
segments = np.array(segments)
def nearest(p, kind):
    cx, cy = (math.floor(v/cell) for v in p)
    candidates = set()
    for x in range(cx-2,cx+3):
        for y in range(cy-2,cy+3): candidates.update(grid.get((x,y), []))
    indices = np.array([i for i in candidates if meta[i][1] == kind], dtype=int)
    if not len(indices): return None
    s = segments[indices]; ab = s[:,2:]-s[:,:2]
    ratio = np.clip(np.sum((np.array(p)-s[:,:2])*ab,axis=1)/np.maximum(np.sum(ab*ab,axis=1),1e-12),0,1)
    q = s[:,:2]+ab*ratio[:,None]; distances = np.linalg.norm(q-np.array(p),axis=1)
    pick = int(np.argmin(distances)); m = meta[int(indices[pick])]
    return {'osm_way_id':m[0], 'name':m[2], 'distance_m_approx':round(float(distances[pick]),1),
            'projected_xy': [round(float(v),3) for v in q[pick]]}

rows=[]
for r in episode:
    raw = xy(float(r['raw_last_latitude']), float(r['raw_last_longitude']))
    loc = xy(float(r['latitude']), float(r['longitude']))
    rows.append({'timestamp':r['timestamp'], 'raw_xy':raw, 'localized_xy':loc,
                 'raw_localized_distance_m_approx':round(math.dist(raw,loc),1),
                 'nearest_street':nearest(raw,'street'), 'nearest_rail':nearest(raw,'rail')})
raws=np.array([r['raw_xy'] for r in rows]); center=np.mean([raws.min(axis=0),raws.max(axis=0)],axis=0)
context=[]
for f in features:
    p=np.array(f['points'])
    if p[:,0].max()<center[0]-240 or p[:,0].min()>center[0]+240 or p[:,1].max()<center[1]-240 or p[:,1].min()>center[1]+240:continue
    context.append({**f,'points':[[round(v,2) for v in a] for a in f['points']]})
report={
    'source':{'url':'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
              'query_scope':'All public tram ways and named primary/secondary/tertiary/residential/unclassified streets inside RU-SPE',
              'sha256':hashlib.sha256(osm_path.read_bytes()).hexdigest(), **osm['osm3s']},
    'city_feature_count':len(features),'tram_way_count':sum(f['kind']=='rail' for f in features),
    'method':'Local nearest line-segment candidate in a fixed-latitude equirectangular approximation; NOT sequence-aware map matching',
    'street_candidates':dict(Counter(r['nearest_street']['name'] for r in rows if r['nearest_street'])),
    'raw_localized_disagreements_over_50m':[r for r in rows if r['raw_localized_distance_m_approx']>50],
    'rows':rows
}
(ROOT/'analysis/spatial-context-audit.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
demo={'center':[round(float(x),3) for x in center], 'map':context, 'rows':[]}
keys=['timestamp','event_type','event_target','goal_obj_type','m_danger_obj_act','handle','speed','goal_speed','path_pos','cur_railsegm_id','is_mechanical_brake_fb','source_sequence_index','json_pointer']
for r,geo in zip(episode,rows):
    demo['rows'].append({**{k:r.get(k) for k in keys}, 'xy':[round(x,3) for x in geo['raw_xy']],
                         'location_conflict':geo['raw_localized_distance_m_approx']>50,
                         'street':geo['nearest_street']['name'] if geo['nearest_street'] else None})
(ROOT/'analysis/mvp-demo-data.json').write_text(json.dumps(demo,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
print(json.dumps({'city_features':len(features),'tram_ways':report['tram_way_count'],
                  'street_candidates':report['street_candidates'],'location_conflicts':len(report['raw_localized_disagreements_over_50m']),
                  'map_features_in_demo':len(context),'sample_rows':len(rows)},ensure_ascii=False))
