"""Synthetic demo archive for running the interface without the private logs.

The generator follows the field reference «Значение полей json.docx»: flat Track
records and `events` containers, string-typed values, JSONSEQ with 0x1E. Movement
follows a real tram line from the public OSM extract. Every value here is
invented for demonstration and is marked as such in the catalog; it must never be
mixed with the real archive. Usage:

    python -m app.demo            # writes SIRIUS_DATA (default ./data-demo) and imports it
    SIRIUS_DATA=data-demo python -m app.server
"""
import os,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
os.environ.setdefault('SIRIUS_DATA',str(ROOT/'data-demo'))
from datetime import datetime,timedelta,timezone
import hashlib,json,math,random
from . import ingest
from .storage import DATA,DB

TZ=timezone(timedelta(hours=3))
COMPONENTS=['ubloxGps','tramSlaveVisor','minsEth','tramPlannerService','leftImage','t25Front','dbwFbTram','odoFbTram','roadModel']

def tram_line(min_length=9000):
    data=json.loads((ROOT/'analysis/osm-spb-public.json').read_text(encoding='utf-8'))
    ways=sorted((e for e in data['elements'] if e.get('tags',{}).get('railway')=='tram' and len(e.get('geometry',[]))>1),key=lambda e:e['id'])
    key=lambda p:(round(p['lat'],6),round(p['lon'],6))
    adj={}
    for w in ways:
        g=w['geometry'];adj.setdefault(key(g[0]),[]).append((w['id'],g));adj.setdefault(key(g[-1]),[]).append((w['id'],g[::-1]))
    dist=lambda a,b:math.hypot((a['lat']-b['lat'])*111320,(a['lon']-b['lon'])*111320*math.cos(math.radians(a['lat'])))
    heading=lambda a,b:math.atan2((b['lat']-a['lat'])*111320,(b['lon']-a['lon'])*55660)
    best=(0,None)
    for w in ways[::3]:
        pts=list(w['geometry']);used={w['id']};length=sum(dist(a,b) for a,b in zip(pts,pts[1:]))
        while length<14000:
            h=heading(pts[-2],pts[-1]);options=[]
            for wid,g in adj.get(key(pts[-1]),[]):
                turn=abs((heading(g[0],g[1])-h+math.pi)%(2*math.pi)-math.pi)
                if wid not in used and turn<.6:options.append((turn,wid,g))
            if not options:break
            _,wid,g=min(options);used.add(wid);length+=sum(dist(a,b) for a,b in zip(g,g[1:]));pts+=g[1:]
        if length>best[0]:best=(length,pts)
        if best[0]>=14000:break
    if best[0]<min_length:raise RuntimeError('В OSM-выгрузке не найдена достаточно длинная трамвайная линия')
    pts=best[1];cum=[0.0]
    for a,b in zip(pts,pts[1:]):cum.append(cum[-1]+dist(a,b))
    return pts,cum

def locate(pts,cum,s):
    s=max(0,min(cum[-1],s));i=max(1,min(len(cum)-1,next((k for k in range(1,len(cum)) if cum[k]>=s),len(cum)-1)))
    a,b=pts[i-1],pts[i];u=(s-cum[i-1])/max(cum[i]-cum[i-1],1e-6)
    return a['lat']+(b['lat']-a['lat'])*u,a['lon']+(b['lon']-a['lon'])*u

class Trip:
    """Kinematic tram with scripted ADAS episodes. Times are milliseconds since epoch."""
    def __init__(self,vehicle,start,route,s0,stations,episodes,gaps=(),degraded=(),seed=1):
        self.vehicle=vehicle;self.t=start;self.route=route;self.s=s0;self.v=0.0;self.stations=list(stations);self.episodes=episodes
        self.gaps=gaps;self.degraded=degraded;self.rng=random.Random(seed);self.blocks=[];self.dwell_until=None;self.grab=5_000_000
        self.last_track=-10**12;self.next_event={};self.handle='driver'

    def raw(self,lat,lon,st):
        f=lambda x,d=3:repr(round(x,d)) if isinstance(x,float) else str(x)
        b=lambda x:'true' if x else 'false'
        stamp=datetime.fromtimestamp(self.t/1000,TZ)
        r={'device_id':'tramdroid-demo-'+self.vehicle,'timestamp':stamp.isoformat(timespec='milliseconds'),'timestamp_source':'GpsTime',
           'timestamp_local':(stamp+timedelta(milliseconds=110)).isoformat(timespec='milliseconds'),'loco_number':'trm'+self.vehicle,
           'cabin_type':'Primary','is_active_cabin':'true','left_turnsignal_on':'false','right_turnsignal_on':'false','grab_msec':str(self.grab),
           'latitude':f(lat,7),'longitude':f(lon,7),'probability':'1','speed':f(self.v*3.6,4),'event_type':'Track','is_adas_button_on':'true',
           'is_wiper_on':'false','is_loc_converged':'true','goal_handle':str(st['goal_handle']),'gps_with_rtk':b(st['rtk']),
           'raw_last_latitude':f(lat+self.rng.gauss(0,3e-6),7),'raw_last_longitude':f(lon+self.rng.gauss(0,5e-6),7),
           'course_reverser_pos':'forward' if self.v>0.05 or self.s>0 else 'neutrally',
           'is_emergency_brake_fb':b(st['emergency']),'is_mechanical_brake_fb':b(st['mechanical']),'is_rail_brake_fb':b(st['rail']),'is_crash_brake_fb':'false',
           'is_call_turned_on_fb':b(st.get('call',False)),'is_safety_pedal_turned_on_fb':'true',
           'm_speeds_values_1':f(self.v*3.6,2),'m_speeds_values_2':f(max(0,self.v*3.6+self.rng.gauss(0,.15)),2),'m_speeds_values_3':f(max(0,self.v*3.6+self.rng.gauss(0,.15)),2),
           'm_mains_voltage':str(round(780+self.rng.gauss(0,6))),'goal_speed':str(st['goal_speed']),'goal_obj_type':st['goal_obj'],
           'm_speed_profile':str(st['profile']),'m_warn_level':str(st['warn']),
           'm_danger_obj_req':'ProperlyWork','m_trafficlight_req':'ProperlyWork','m_speed_limit_req':'ProperlyWork',
           'm_danger_obj_status':st['status']['danger'],'m_trafficlight_status':st['status']['light'],'m_speed_limit_status':st['status']['speed'],
           'm_danger_obj_fsm_state':st['fsm']['danger'],'m_trafficlight_fsm_state':st['fsm']['light'],'m_speed_limit_fsm_state':st['fsm']['speed'],
           'm_danger_obj_act':st['act']['danger'],'m_trafficlight_act':st['act']['light'],'m_speed_limit_act':st['act']['speed'],
           'm_desired_sens_level':'128','m_speed_mode':str(st['mode']),'m_speed_mode_driver_fb':str(st['driver_mode']),
           'm_current_route_name':self.route,'fsm_state':st['tram_fsm'],'handle':st['handle'],
           'as_is_skid':b(st['skid']),'as_skid_score':f(st['skid_score'],2),'as_skid_duration_ms':str(st['skid_ms']),
           'as_input_speed_mode':str(st['mode']),'as_output_speed_mode':str(st['mode'] if not st['skid'] else max(st['mode'],-6)),
           'path_pos':f(self.s,1),'cur_railsegm_id':str(1000+int(self.s//400))}
        r.update({c:b(ok) for c,ok in st['components'].items()})
        return r

    def run(self,duration_s,line):
        pts,cum=line;dt=.25;end=self.t+duration_s*1000
        while self.t<end and self.s<cum[-1]-30:
            st={'goal_speed':40,'goal_obj':'Unknown','profile':0,'warn':0,'mode':0,'driver_mode':0,'goal_handle':0,'handle':'driver','tram_fsm':'Drive',
                'act':{'danger':'No','light':'No','speed':'No'},'status':{'danger':'ProperlyWork','light':'ProperlyWork','speed':'ProperlyWork'},
                'fsm':{'danger':'Active','light':'Active','speed':'Active'},'emergency':False,'mechanical':False,'rail':False,'skid':False,'skid_score':0.0,'skid_ms':0,
                'components':{c:True for c in COMPONENTS},'rtk':True,'events':[],'decel':1.1,'target':None}
            for a,b,names in self.degraded:
                if a<=self.t<=b:
                    for c in names:st['components'][c]=False
            if not st['components']['leftImage'] or not st['components']['t25Front']:
                st['status']['light']='TemporaryOff';st['fsm']['light']='Off';st['status']['danger']='TemporaryOff';st['fsm']['danger']='Off'
            if not st['components']['ubloxGps']:st['rtk']=False
            v_target=st['goal_speed']/3.6
            # Station stops: braking curve to the platform, then dwell.
            if self.stations and self.dwell_until is None:
                gap=self.stations[0]-self.s
                if gap<=1.5 and self.v<.3:self.dwell_until=self.t+self.rng.randint(14,24)*1000;self.v=0
                else:v_target=min(v_target,math.sqrt(max(0,2*1.0*(gap-1))))
            if self.dwell_until is not None:
                v_target=0;st['tram_fsm']='Stop';st['mechanical']=True
                if self.t>=self.dwell_until:self.dwell_until=None;self.stations.pop(0)
            for ep in self.episodes:ep.apply(self,st)
            v_target=max(0,v_target if st['target'] is None else min(v_target,st['target']))
            if self.v>v_target+.05:
                self.v=max(v_target,self.v-st['decel']*dt);st['mode']=st['mode'] or -max(3,min(15,round(st['decel']*8)))
                if st['handle']=='driver':st['driver_mode']=st['mode']
                if self.v<1.5:st['mechanical']=True
            elif self.v<v_target-.05:
                self.v=min(v_target,self.v+.9*dt);st['mode']=st['mode'] or 9
                if st['handle']=='driver':st['driver_mode']=st['mode']
            if self.v<.05 and self.dwell_until is None and v_target<.05:st['mechanical']=True
            st['goal_handle']=st['mode']
            self.s+=self.v*dt;self.grab+=int(dt*1000)
            in_gap=any(a<=self.t<=b for a,b in self.gaps)
            lat,lon=locate(pts,cum,self.s)
            if not in_gap:
                if self.t-self.last_track>=1000:
                    self.blocks.append(self.raw(lat,lon,st));self.last_track=self.t
                for typ,target,extra in st['events']:
                    k=(typ,target)
                    if self.t>=self.next_event.get(k,0):
                        e=self.raw(lat,lon,st);e['event_type']=typ;e['event_target']=target;e.update(extra(self,lat,lon) if callable(extra) else extra or {})
                        self.blocks.append({'events':[e]});self.next_event[k]=self.t+500
            self.t+=int(dt*1000)
        return self

class Episode:
    """Scripted reaction keyed to path position; phases are relative to trigger time."""
    def __init__(self,at,kind,**kw):self.at=at;self.kind=kind;self.kw=kw;self.t0=None;self.done=False
    def apply(self,trip,st):
        if self.done:return
        if self.t0 is None:
            if trip.s<self.at:return
            self.t0=trip.t;self.v0=trip.v
        dt=(trip.t-self.t0)/1000;getattr(self,self.kind)(trip,st,dt)

    def snapshot(self,subsystem,objects):
        def make(trip,lat,lon):
            stamp=datetime.fromtimestamp((trip.t+self.kw.get('snapshot_delay',350))/1000,timezone.utc)
            data={'subsystem':subsystem,'lat':round(lat,7),'lon':round(lon,7)}
            data.update({'object':objects[0]} if subsystem=='DangerObjSubSys' else {'trafficLights':objects})
            return {'telemetry_data':data,'telemetry_timestamp':stamp.isoformat(timespec='milliseconds').replace('+00:00','Z')}
        return make

    def obstacle(self,trip,st,dt):
        """Vehicle on the track: warning, driver does not react, system takes control and stops."""
        car={'type':'CAR','state':'TRACKED','pose':{'x':0.4,'y':max(6,24-dt*3.2),'z':0},'size':{'x':1.9,'y':4.6,'z':1.5},'uid':41}
        if dt<2.6:
            st['act']['danger']='WarningAct';st['warn']=min(6,2+int(dt*2));st['goal_obj']='Vehicle';st['goal_speed']=15
            st['events'].append(('Warn','Obstacle',self.snapshot('DangerObjSubSys',[car]) if dt<.3 else {}))
        elif dt<11:
            st['act']['danger']='ActuationAct';st['warn']=9;st['goal_obj']='Vehicle';st['goal_speed']=0;st['target']=0;st['decel']=1.6
            st['handle']='cpilot';st['mode']=-11;st['mechanical']=trip.v<2;st['call']=dt<4
            st['events'].append(('Warn','Obstacle',{}));st['events'].append(('Brake','Obstacle',self.snapshot('DangerObjSubSys',[car]) if 4<dt<4.3 else {}))
        elif dt<16:
            st['target']=0;st['mechanical']=True;st['handle']='undeterminable' if dt<12.5 else 'driver';st['goal_speed']=0
            if dt<12.5:st['events'].append(('Brake','Obstacle',{}))
        else:self.done=True

    def zone(self,trip,st,dt):
        """Speed limit zone entered too fast: OverSpeed, then actuation down to the limit."""
        length=self.kw.get('length',420)
        if trip.s>self.at+length:self.done=True;return
        st['goal_speed']=20;st['goal_obj']='SpeedLimit';st['profile']=2
        over=trip.v*3.6>21;engaged=getattr(self,'engaged',False)
        if engaged:st['target']=19/3.6
        elif dt<3.5:st['target']=trip.v  # the driver keeps speed after entering the zone
        if over and not engaged and dt<3.5:
            st['act']['speed']='WarningAct';st['warn']=4;st['events'].append(('OverSpeed','ZoneSpeedLimit',{}))
        elif over:
            self.engaged=True;st['act']['speed']='ActuationAct';st['warn']=6;st['handle']='cpilot';st['mode']=-6;st['decel']=.8;st['target']=19/3.6
            st['events'].append(('OverSpeed','ZoneSpeedLimit',{}));st['events'].append(('Brake','ZoneSpeedLimit',{}))

    def red_light(self,trip,st,dt):
        """Prohibiting signal: warning only, driver brakes on their own."""
        light=[{'type':'TRAFFIC_LIGHT','state':'TRACKED','tlSignal':'RU_TRAM_STOP','pose':{'x':-3.2,'y':max(4,48-dt*6),'z':4.5},'uid':7},
               {'type':'TRAFFIC_LIGHT','state':'TRACKED','tlSignal':'CAR_STOP','pose':{'x':6.5,'y':max(6,52-dt*6),'z':4.5},'uid':8}]
        if dt<22:
            st['goal_obj']='TrafficLight';st['goal_speed']=0 if dt<17 else 40
            if dt<2.2:st['act']['light']='WarningAct';st['warn']=3;st['events'].append(('Warn','TrafficLightSignal',self.snapshot('TrafficLightSubSys',light) if dt<.3 else {}))
            if dt>1.6 and dt<17:st['target']=0;st['decel']=1.2;st['driver_mode']=-8;st['mode']=-8
        else:self.done=True

    def pedestrian(self,trip,st,dt):
        """Person steps onto the track close ahead: emergency and rail brakes, short skid."""
        person={'type':'HUMAN','state':'TRACKED' if dt<3 else 'LOST','pose':{'x':-.6,'y':max(3,13-dt*4),'z':0},'size':{'x':.6,'y':.6,'z':1.75},'uid':93}
        if dt<.7:
            st['act']['danger']='WarningAct';st['warn']=8;st['goal_obj']='Human';st['goal_speed']=0
            st['events'].append(('Warn','Obstacle',self.snapshot('DangerObjSubSys',[person],) if dt<.3 else {}))
        elif dt<9:
            st['act']['danger']='ActuationAct';st['warn']=10;st['goal_obj']='Human';st['goal_speed']=0;st['target']=0;st['decel']=2.8
            st['handle']='cpilot';st['mode']=-15;st['emergency']=trip.v>.05;st['rail']=trip.v>.05;st['call']=True
            if 1.1<dt<1.8:st['skid']=True;st['skid_score']=.62;st['skid_ms']=int((dt-1.1)*1000)
            st['events'].append(('Brake','Obstacle',self.snapshot('DangerObjSubSys',[person]) if 1<dt<1.3 else {}))
        elif dt<14:st['target']=0;st['mechanical']=True;st['handle']='driver'
        else:self.done=True

    def false_warning(self,trip,st,dt):
        """Short warning with no reaction: speed continues."""
        if dt<1.6:st['act']['danger']='WarningAct';st['warn']=2;st['goal_obj']='Vehicle';st['events'].append(('Warn','Obstacle',{}))
        else:self.done=True

def write(trips,folder):
    folder.mkdir(parents=True,exist_ok=True);inventory=[]
    for name,trip in trips:
        path=folder/f'{name}.jsonseq'
        with path.open('wb') as f:
            for block in trip.blocks:f.write(b'\x1e'+json.dumps(block,ensure_ascii=False).encode()+b'\n')
        data=path.read_bytes();inventory.append({'path':str(path),'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()})
    (folder/'inventory.json').write_text(json.dumps(inventory,ensure_ascii=False,indent=1),encoding='utf-8')
    return folder/'inventory.json'

def build():
    line=tram_line();t=lambda s:int(datetime.fromisoformat(s).timestamp()*1000)
    a=Trip('7826',t('2026-09-27T09:40:00+03:00'),'7.2',0,stations=[650,1450,2350,3300,4200,5150,6150,7050,8000],seed=7,
           episodes=[Episode(980,'false_warning'),Episode(1900,'obstacle'),Episode(2750,'zone',length=380),Episode(3950,'red_light'),
                     Episode(5650,'pedestrian')],
           gaps=[(t('2026-09-27T09:55:20+03:00'),t('2026-09-27T09:56:12+03:00'))],
           degraded=[(t('2026-09-27T10:01:00+03:00'),t('2026-09-27T10:01:40+03:00'),['leftImage'])]).run(40*60,line)
    b=Trip('3139',t('2026-09-28T07:12:00+03:00'),'40.1',2200,stations=[2800,3700,4600,5500,6400,7300],seed=11,
           episodes=[Episode(3200,'red_light'),Episode(4100,'zone',length=300),Episode(6000,'obstacle')]).run(25*60,line)
    return write([('7826_27_09_demo',a),('3139_28_09_demo',b)],DATA/'demo-src')

if __name__=='__main__':
    if DATA.resolve()==(ROOT/'data').resolve():raise SystemExit('Демо-данные не записываются в каталог реального архива data/. Укажите SIRIUS_DATA.')
    if DB.exists() and '--force' not in sys.argv:
        print(f'{DB} уже существует. Повторите с --force, чтобы пересоздать демо-базу.');sys.exit(1)
    for p in (DB,DB.with_name(DB.name+'-wal'),DB.with_name(DB.name+'-shm'),DATA/'import-progress.json'):
        if p.exists():p.unlink()
    inventory=build();ingest.run(inventory)
    with ingest.connect() as con:con.execute("INSERT OR REPLACE INTO metadata VALUES('demo','true')");con.commit()
    print('Демо-архив готов:',DATA)
