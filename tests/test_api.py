"""Integration checks against the real local archive, with isolated test history entries."""
import json,unittest,urllib.request,urllib.error
from app.storage import connect,raw_record
from app.ingest import normalize
from app.analysis import analyze

BASE='http://127.0.0.1:5173/api/'
def get(path):
    with urllib.request.urlopen(BASE+path,timeout=45) as r:return json.load(r)
def post(path,body):
    req=urllib.request.Request(BASE+path,data=json.dumps(body).encode(),headers={'Content-Type':'application/json'})
    with urllib.request.urlopen(req,timeout=45) as r:return json.load(r)

class ArchiveTests(unittest.TestCase):
    def test_complete_import_and_catalog(self):
        health=get('health');self.assertEqual(health['import']['status'],'ready');self.assertEqual(health['import']['json_records'],647576);self.assertEqual(health['import']['parse_errors'],0)
        catalog=get('catalog')['entries'];self.assertEqual(len(set(r['vehicle'] for r in catalog)),6)
        self.assertEqual(max(r['day'] for r in catalog),'2026-10-06')
        self.assertIn('100',{r['route'] for r in catalog})
    def test_known_braking_episode_evidence(self):
        from datetime import datetime
        start=round(datetime.fromisoformat('2026-09-14T05:08:49.389+03:00').timestamp()*1000)
        end=round(datetime.fromisoformat('2026-09-14T05:09:24.680+03:00').timestamp()*1000)
        with connect() as con:
            result=analyze(con,'3139',start,end,'6')
            self.assertTrue(any(f['kind']=='intervention' for f in result['facts']))
            self.assertTrue(any(f['kind']=='brake' for f in result['facts']))
            for f in result['facts']:
                self.assertTrue(f['evidence_ids'])
                for id in f['evidence_ids']:
                    row=con.execute('SELECT * FROM records WHERE id=?',(id,)).fetchone()
                    self.assertEqual(row['vehicle'],'3139');self.assertGreaterEqual(row['t'],start);self.assertLessEqual(row['t'],end)
                    self.assertTrue(raw_record(row))
        frame=get(f'frame?vehicle=3139&route=6&t={start+12730}')
        self.assertEqual(frame['record']['handle'],'cpilot')
        self.assertEqual(frame['record']['t'],start+12730)
    def test_csv_only_period(self):
        trip=get('trip?vehicle=3119&day=2026-10-05&route=all')
        self.assertTrue(trip['track']);self.assertTrue(all(r['family']=='csv' for r in trip['series']))
        self.assertTrue(all(r['t']>=trip['start'] for r in trip['track']))
    def test_every_vehicle_has_working_trip(self):
        from urllib.parse import urlencode
        catalog=get('catalog')['entries']
        for vehicle in sorted(set(r['vehicle'] for r in catalog)):
            choice=max((r for r in catalog if r['vehicle']==vehicle),key=lambda r:r['n'])
            with self.subTest(vehicle=vehicle):
                trip=get('trip?'+urlencode({'vehicle':vehicle,'day':choice['day'],'route':choice['route']}))
                self.assertTrue(trip['track']);self.assertLessEqual(trip['start'],trip['end'])
                self.assertTrue(all(r['vehicle']==vehicle for r in trip['series']))
                with connect() as con:
                    bounds=con.execute('SELECT MIN(t),MAX(t) FROM records WHERE vehicle=? AND day=? AND route=?',(vehicle,choice['day'],choice['route'])).fetchone()
                    self.assertEqual((trip['start'],trip['end']),tuple(bounds))
    def test_geographic_lookup_is_local_and_plausible(self):
        place=get('place?lat=59.9557258&lon=30.3222148')
        self.assertEqual(place['street']['name'],'Кронверкский проспект')
        self.assertLess(place['rail']['distance'],10)
    def test_invalid_range_rejected(self):
        with self.assertRaises(urllib.error.HTTPError) as error:get('window?vehicle=3139&start=9&end=1')
        self.assertEqual(error.exception.code,400)
    def test_history_and_saved_analysis_round_trip(self):
        trip=get('trip?vehicle=0210&day=2026-10-03&route=100')
        result=post('analyze',{'vehicle':'0210','route':'100','start':trip['start'],'end':trip['start']+60000})
        try:
            stored=get('analysis?id='+result['id']);self.assertEqual(stored,result)
            answer=post('question',{'analysis_id':result['id'],'question':'Кто управлял?'})
            self.assertIn('text',answer)
            state={'vehicle':'0210','day':'2026-10-03','route':'100','start':result['start'],'end':result['end'],'time':result['start'],'analysisId':result['id']}
            post('history',{'id':'test-api-history','kind':'analysis','state':state})
            row=next(x for x in get('history')['items'] if x['id']=='test-api-history');self.assertEqual(row['state'],state)
        finally:
            with connect() as con:con.execute('DELETE FROM history WHERE id=?',('test-api-history',));con.execute('DELETE FROM analyses WHERE id=?',(result['id'],))

if __name__=='__main__':unittest.main(verbosity=2)
