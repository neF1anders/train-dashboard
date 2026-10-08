from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from urllib.parse import urlparse,parse_qs
from contextlib import closing
from datetime import datetime,timezone
from functools import lru_cache
from .storage import ROOT,DATA,VERSION,init,connect,meta,public,raw_record,PUBLIC_COLUMNS
from .analysis import scope,analyze,answer
from . import geo
import argparse,json,gzip,math,traceback,uuid,sqlite3

def thin(rows,limit=4000):
    if len(rows)<=limit:return rows
    selected={0,len(rows)-1};width=math.ceil(len(rows)/(limit//4))
    for start in range(0,len(rows),width):
        indices=list(range(start,min(len(rows),start+width)))
        selected.update([indices[0],indices[-1],min(indices,key=lambda i:rows[i]['speed'] or 0),max(indices,key=lambda i:rows[i]['speed'] or 0)])
    return [rows[i] for i in sorted(selected)]

def gaps(rows):
    ts=sorted(set(r['t'] for r in rows));return [[a,b] for a,b in zip(ts,ts[1:]) if b-a>30000]

class Handler(SimpleHTTPRequestHandler):
    server_version='SiriusMVP/1.0'
    def __init__(self,*a,**kw):super().__init__(*a,directory=str(ROOT/'web'),**kw)
    def send_json(self,value,status=200):
        payload=json.dumps(value,ensure_ascii=False,allow_nan=False,separators=(',',':')).encode()
        compressed='gzip' in self.headers.get('Accept-Encoding','') and len(payload)>4096
        if compressed:payload=gzip.compress(payload,compresslevel=3)
        self.send_response(status);self.send_header('Content-Type','application/json; charset=utf-8');self.send_header('Cache-Control','no-store')
        if compressed:self.send_header('Content-Encoding','gzip')
        self.send_header('Content-Length',str(len(payload)));self.end_headers();self.wfile.write(payload)
    def do_GET(self):
        url=urlparse(self.path)
        if not url.path.startswith('/api/'):
            if url.path not in ('/','/index.html','/app.js','/style.css','/map.js','/scene.js','/favicon.svg'):
                self.send_error(404);return
            return super().do_GET()
        try:
            p={k:v[0] for k,v in parse_qs(url.query).items()};result=self.api_get(url.path,p);self.send_json(result)
        except (ValueError,KeyError) as e:self.send_json({'error':str(e)},400)
        except (BrokenPipeError,ConnectionResetError):pass
        except Exception:
            traceback.print_exc();self.send_json({'error':'Ошибка обработки запроса. Подробности в журнале сервера.'},500)
    def do_POST(self):
        try:
            origin=self.headers.get('Origin')
            if origin and urlparse(origin).hostname not in ('localhost','127.0.0.1','::1'):raise ValueError('Недопустимый источник запроса')
            if not self.headers.get('Content-Type','').startswith('application/json'):raise ValueError('Ожидается JSON')
            length=int(self.headers.get('Content-Length','0'))
            if not 0<length<=200000:raise ValueError('Недопустимый размер запроса')
            body=json.loads(self.rfile.read(length));result=self.api_post(urlparse(self.path).path,body);self.send_json(result)
        except (ValueError,KeyError,TypeError) as e:self.send_json({'error':str(e)},400)
        except (BrokenPipeError,ConnectionResetError):pass
        except Exception:
            traceback.print_exc();self.send_json({'error':'Не удалось сохранить результат. Подробности в журнале сервера.'},500)
    def api_get(self,path,p):
        if path=='/api/health':
            progress_path=DATA/'import-progress.json'
            progress=json.loads(progress_path.read_text(encoding='utf-8')) if progress_path.exists() else {'status':'not_imported'}
            return {'service':'sirius','version':VERSION,'import':progress}
        if path=='/api/map':
            bounds=[float(x) for x in p['bounds'].split(',')]
            if len(bounds)!=4 or not all(math.isfinite(x) for x in bounds) or bounds[0]>=bounds[2] or bounds[1]>=bounds[3]:raise ValueError('Неверная область карты')
            return geo.context(bounds)
        if path=='/api/place':
            lat,lon=float(p['lat']),float(p['lon'])
            if not math.isfinite(lat+lon) or not(-90<=lat<=90 and -180<=lon<=180):raise ValueError('Неверные координаты')
            return geo.nearest(round(lat,6),round(lon,6))
        with closing(connect()) as con:
            if path=='/api/catalog':
                rows=[dict(r) for r in con.execute('SELECT * FROM catalog ORDER BY vehicle,day,CAST(route AS INTEGER)')]
                coverage=json.loads((ROOT/'analysis/coverage-summary.json').read_text(encoding='utf-8'))
                return {'entries':rows,'import':meta(con,'import'), 'coverage':coverage,'data_version':meta(con,'data_version')}
            if path=='/api/history':return {'items':[{**dict(r),'state':json.loads(r['state'])} for r in con.execute('SELECT * FROM history ORDER BY updated DESC LIMIT 30')]}
            if path=='/api/trip':
                vehicle=p['vehicle'];day=p['day'];datetime.strptime(day,'%Y-%m-%d');route=p.get('route','all')
                where='vehicle=? AND day=?';args=[vehicle,day]
                if route!='all':where+=' AND route=?';args.append(route)
                raw=[public(r) for r in con.execute('SELECT '+PUBLIC_COLUMNS+" FROM records WHERE "+where+" AND type='Track' ORDER BY t,CASE family WHEN 'json' THEN 0 ELSE 1 END",args)]
                buckets={}
                for r in raw:
                    key=r['t']//1000
                    if key not in buckets or (r['family']=='json' and buckets[key]['family']!='json'):buckets[key]=r
                track=sorted(buckets.values(),key=lambda r:r['t'])
                # A rare event-only route still remains selectable and inspectable.
                if not track:track=[public(r) for r in con.execute('SELECT '+PUBLIC_COLUMNS+' FROM records WHERE '+where+' ORDER BY t LIMIT 5000',args)]
                if not track:raise ValueError('Нет записей для выбранных фильтров')
                eps=[dict(r) for r in con.execute('SELECT * FROM episodes WHERE '+where+' ORDER BY start',args)]
                rich=[dict(r) for r in con.execute('SELECT id,t FROM records WHERE '+where+' AND telemetry=1 ORDER BY t',args)]
                bounds=con.execute('SELECT MIN(t),MAX(t) FROM records WHERE '+where,args).fetchone()
                # Full sparse track is retained for repeat-pass selection; graph is separately aggregated.
                return {'vehicle':vehicle,'day':day,'route':route,'start':bounds[0],'end':bounds[1],
                        'track':[{k:r[k] for k in ['id','t','route','lat','lon','speed','flags','family','pos','segment']} for r in track],
                        'series':thin(track,2200),'gaps':gaps(track),'episodes':eps,'snapshots':rich,'source_records':len(raw)}
            if path in ('/api/window','/api/analysis-preview'):
                vehicle,start,end,route=self.parse_scope(p);where,args=scope(vehicle,start,end,route)
                rows=[public(r) for r in con.execute('SELECT '+PUBLIC_COLUMNS+' FROM records WHERE '+where+' ORDER BY t,id',args)]
                # Include one predecessor solely as context; never relabel its timestamp.
                before_where='vehicle=? AND t<?';before_args=[vehicle,start]
                if route!='all':before_where+=' AND route=?';before_args.append(route)
                predecessor=con.execute('SELECT '+PUBLIC_COLUMNS+' FROM records WHERE '+before_where+' ORDER BY t DESC LIMIT 1',before_args).fetchone()
                n=len(rows);out=thin(rows,20000)
                return {'rows':out,'context':public(predecessor) if predecessor else None,'count':n,'sampled':n>len(out),'gaps':gaps(rows),'start':start,'end':end}
            if path=='/api/frame':
                t=int(float(p['t']));vehicle=p['vehicle'];route=p.get('route','all');condition='vehicle=? AND t<=?';args=[vehicle,t]
                if route!='all':condition+=' AND route=?';args.append(route)
                r=con.execute('SELECT '+PUBLIC_COLUMNS+' FROM records WHERE '+condition+" ORDER BY t DESC,CASE family WHEN 'json' THEN 0 ELSE 1 END LIMIT 1",args).fetchone()
                if not r:return {'record':None}
                return {'record':public(r),'age_ms':t-r['t']}
            if path=='/api/record':
                r=con.execute('SELECT * FROM records WHERE id=?',(int(p['id']),)).fetchone()
                if not r:raise ValueError('Запись не найдена')
                source=dict(con.execute('SELECT id,path,sha,aliases FROM sources WHERE id=?',(r['source_id'],)).fetchone());source['aliases']=json.loads(source['aliases'])
                return {'record':{k:public(r)[k] for k in PUBLIC_COLUMNS.split(',')},'raw':raw_record(r),'source':source,'sequence_index':r['seq'],'json_pointer':r['pointer'],'record_hash':r['h']}
            if path=='/api/analysis':
                r=con.execute('SELECT result FROM analyses WHERE id=?',(p['id'],)).fetchone()
                if not r:raise ValueError('Анализ не найден')
                return json.loads(r[0])
            raise ValueError('Неизвестный API-запрос')
    def parse_scope(self,p):
        start,end=int(float(p['start'])),int(float(p['end']))
        if end<start or end-start>172800000:raise ValueError('Интервал должен быть не больше двух суток и иметь корректные границы')
        return str(p['vehicle']),start,end,str(p.get('route','all'))
    def api_post(self,path,body):
        with closing(connect()) as con:
            if path=='/api/history':
                state=body['state'];vehicle=str(state['vehicle']);day=str(state['day']);route=str(state.get('route','all'))
                key=body.get('id') or vehicle+'|'+day+'|'+route
                title=f'Вагон {vehicle} · {day} · '+('все маршруты' if route=='all' else f'маршрут {route}')
                con.execute('INSERT OR REPLACE INTO history VALUES(?,?,?,?,?)',(key,datetime.now(timezone.utc).isoformat(),json.dumps(state,ensure_ascii=False),body.get('kind','view'),title));con.commit()
                return {'id':key}
            if path=='/api/analyze':
                result=analyze(con,*self.parse_scope(body))
                con.execute('INSERT INTO analyses VALUES(?,?,?,?,?,?,?,?)',(result['id'],result['created'],result['vehicle'],result['start'],result['end'],result['route'],result['rules_version'],json.dumps(result,ensure_ascii=False)));con.commit()
                return result
            if path=='/api/question':
                r=con.execute('SELECT result FROM analyses WHERE id=?',(str(body['analysis_id']),)).fetchone()
                if not r:raise ValueError('Сначала выполните анализ интервала')
                question=str(body['question']).strip()
                if not question or len(question)>2000:raise ValueError('Введите вопрос до 2000 символов')
                return answer(json.loads(r[0]),question)
            raise ValueError('Неизвестное действие')

class LocalServer(ThreadingHTTPServer):
    allow_reuse_address=False
    def server_bind(self):
        import socket
        if hasattr(socket,'SO_EXCLUSIVEADDRUSE'):self.socket.setsockopt(socket.SOL_SOCKET,socket.SO_EXCLUSIVEADDRUSE,1)
        super().server_bind()

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--port',type=int,default=5173);args=parser.parse_args();init()
    server=LocalServer(('127.0.0.1',args.port),Handler);print(f'Sirius MVP http://localhost:{args.port}',flush=True)
    server.serve_forever()
if __name__=='__main__':main()
