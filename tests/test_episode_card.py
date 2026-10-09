"""Episode card on the synthetic demo archive: four sections, timestamps and evidence for every dated claim."""
import os,subprocess,sys,tempfile,unittest,json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]

class EpisodeCardTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp=tempfile.TemporaryDirectory();env={**os.environ,'SIRIUS_DATA':cls.tmp.name,'PYTHONIOENCODING':'utf-8'}
        subprocess.run([sys.executable,'-m','app.demo'],cwd=ROOT,env=env,check=True,capture_output=True)
        code=r'''
import json,sys
from app.storage import connect
from app.analysis import analyze,answer
from app.server import Handler
con=connect();out={}
eps=[dict(r) for r in con.execute("SELECT * FROM episodes WHERE vehicle='7826' ORDER BY start")]
brake=next(e for e in eps if e['type']=='Brake' and e['target']=='Obstacle')
r=analyze(con,'7826',brake['start']-15000,brake['end']+15000,'7')
out['card']=r['card'];out['narrative']=r['narrative']
out['brakes_answer']=answer(r,'Какие типы торможения применялись?')
quiet=analyze(con,'7826',eps[0]['start']-60000,eps[0]['start']-30000,'7')
out['quiet']=quiet['card']
print(json.dumps(out,ensure_ascii=False))
'''
        cls.result=json.loads(subprocess.run([sys.executable,'-c',code],cwd=ROOT,env=env,check=True,capture_output=True,text=True,encoding='utf-8').stdout)
    @classmethod
    def tearDownClass(cls):cls.tmp.cleanup()

    def test_four_sections_present(self):
        self.assertEqual({l['section'] for l in self.result['card']},{'circumstances','reaction','result','limits'})
    def test_dated_claims_have_evidence(self):
        for l in self.result['card']:
            if l['t'] is not None:self.assertTrue(l['evidence_ids'],l)
    def test_cause_named_only_from_fields(self):
        cause=next(l for l in self.result['card'] if l['kind']=='cause')
        self.assertIn('event_target',cause['text'])
        quiet_cause=next(l for l in self.result['quiet'] if l['kind']=='cause')
        self.assertIn('Причина не установлена',quiet_cause['text'])
    def test_reaction_and_stop(self):
        kinds={l['kind'] for l in self.result['card']}
        self.assertTrue({'warning','intervention','brake_event','stop'}<=kinds)
        self.assertIn(' — ',self.result['narrative'])
    def test_brake_question_lists_feedback(self):
        self.assertIn('тормоз',self.result['brakes_answer']['text'])
        self.assertTrue(self.result['brakes_answer']['evidence_ids'])

if __name__=='__main__':unittest.main(verbosity=2)
