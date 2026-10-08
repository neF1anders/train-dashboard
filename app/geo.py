"""Public map context stays local. Nearest lines are labelled candidates."""
from .storage import ROOT
from collections import defaultdict
from functools import lru_cache
import json,math,threading

_lock=threading.Lock();_features=None;_grid=defaultdict(list)
def xy(lat,lon):return (lon*55660,lat*111320)

def load():
    global _features
    with _lock:
        if _features is not None:return _features
        source=json.loads((ROOT/'analysis/osm-spb-public.json').read_text(encoding='utf-8'))
        _features=[]
        for e in source['elements']:
            ps=[[p['lon'],p['lat']] for p in e.get('geometry',[])];tags=e.get('tags',{})
            if len(ps)<2:continue
            f={'id':e['id'],'kind':'rail' if tags.get('railway')=='tram' else 'street','name':tags.get('name',''),'points':ps,
               'bounds':[min(p[0] for p in ps),min(p[1] for p in ps),max(p[0] for p in ps),max(p[1] for p in ps)]}
            idx=len(_features);_features.append(f)
            a,b,c,d=f['bounds']
            for x in range(math.floor(a/.005),math.floor(c/.005)+1):
                for y in range(math.floor(b/.0025),math.floor(d/.0025)+1):_grid[x,y].append(idx)
        return _features

def context(bounds):
    fs=load();a,b,c,d=bounds
    if c-a>1.8 or d-b>.9:raise ValueError('Слишком большая область карты')
    indices=set()
    for x in range(math.floor(a/.005),math.floor(c/.005)+1):
        for y in range(math.floor(b/.0025),math.floor(d/.0025)+1):indices.update(_grid.get((x,y),[]))
    result=[]
    for i in indices:
        f=fs[i];x,y,z,w=f['bounds']
        if z<a or x>c or w<b or y>d:continue
        result.append(f)
    return {'features':result,'attribution':'© OpenStreetMap contributors · ODbL','map_version':'2026-10-08T10:02:07Z'}

@lru_cache(maxsize=8192)
def nearest(lat,lon):
    local=context([lon-.005,lat-.0025,lon+.005,lat+.0025]);px,py=xy(lat,lon);best={}
    for f in local['features']:
        for a,b in zip(f['points'],f['points'][1:]):
            ax,ay=xy(a[1],a[0]);bx,by=xy(b[1],b[0]);dx,dy=bx-ax,by-ay
            u=max(0,min(1,((px-ax)*dx+(py-ay)*dy)/max(dx*dx+dy*dy,1e-9)))
            dist=math.hypot(px-ax-u*dx,py-ay-u*dy)
            if f['kind'] not in best or dist<best[f['kind']]['distance']:
                best[f['kind']]={'id':f['id'],'name':f['name'],'distance':round(dist,1),'points':f['points']}
    return best
