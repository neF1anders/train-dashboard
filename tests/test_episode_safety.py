"""Regression cases for ambiguous causes, missing fields and broken speed series."""
import unittest, tempfile, subprocess, os, sys, sqlite3
from pathlib import Path
from app.episode import card,flag,number

ROOT=Path(__file__).resolve().parents[1]
def row(id,t,speed,**kw):
    return dict(id=id,t=t,speed=speed,route='10',family='json',type='Track',target=None,handle='driver',brakes=0,act_danger=None,act_light=None,act_speed=None,**kw)

class EpisodeSafety(unittest.TestCase):
    def test_unknown_is_not_false(self):
        self.assertIsNone(flag('unknown'));self.assertIsNone(flag(None))
        self.assertIs(flag('false'),False);self.assertIs(flag(True),True)
        self.assertIsNone(number('NaN'));self.assertIsNone(number('Infinity'))

    def test_gap_does_not_prove_stop_or_deceleration(self):
        rows=[row(1,1000,40),row(2,62000,0)]
        rows[0]['act_danger']='ActuationAct'
        result=card(rows,{},[])
        self.assertFalse(any(l['kind'] in ('stop','decel') for l in result['lines']))
        self.assertNotIn('остановки не было',str(result))

    def test_different_routes_and_sources_cannot_confirm_stop(self):
        rows=[row(1,1000,0),row(2,2000,0)]
        rows[1]['route']='20'
        self.assertFalse(any(l['kind']=='stop' for l in card(rows,{},[])['lines']))
        rows[1]['route']='10';rows[1]['family']='csv'
        self.assertFalse(any(l['kind']=='stop' for l in card(rows,{},[])['lines']))

    def test_target_is_not_a_physical_cause(self):
        r=row(1,1000,30);r.update(type='Brake',target='Obstacle')
        result=card([r],{1:{'event_target':'Obstacle'}},[])
        cause=next(l for l in result['lines'] if l['kind']=='cause')
        self.assertIn('физическая причина реакции не установлена',cause['text'])
        self.assertNotIn('telemetry_data',cause['text'])

    def test_braking_target_takes_priority_over_earlier_speed_event(self):
        earlier=row(1,1000,30);earlier.update(type='OverSpeed',target='ZoneSpeedLimit')
        brake=row(2,2000,20);brake.update(type='Brake',target='Obstacle')
        cause=next(l for l in card([earlier,brake],{},[])['lines'] if l['kind']=='cause')
        self.assertEqual(cause['evidence_ids'],[2]);self.assertIn('препятствие',cause['text'])

    def test_deceleration_references_exact_pair(self):
        rows=[row(1,1000,40),row(2,2000,30),row(3,3000,29)]
        rows[0]['act_danger']='ActuationAct'
        decel=next(l for l in card(rows,{},[])['lines'] if l['kind']=='decel')
        self.assertEqual(decel['evidence_ids'],[1,2]);self.assertEqual(decel['t'],1000)

    def test_demo_force_refuses_unmarked_database(self):
        with tempfile.TemporaryDirectory() as folder:
            db=Path(folder)/'sirius.sqlite3'
            with sqlite3.connect(db) as con:con.execute('CREATE TABLE keep_me(value TEXT)')
            con.close()
            before=db.read_bytes()
            result=subprocess.run([sys.executable,'-m','app.demo','--force'],cwd=ROOT,env={**os.environ,'SIRIUS_DATA':folder,'PYTHONIOENCODING':'utf-8'},capture_output=True)
            self.assertNotEqual(result.returncode,0);self.assertEqual(before,db.read_bytes())

if __name__=='__main__':unittest.main()
