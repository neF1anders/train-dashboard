import unittest
from app.server import motion_track


class MotionSourceTests(unittest.TestCase):
    def row(self,t,family,route='6'):
        return {'t':t,'family':family,'route':route,'id':f'{family}-{t}'}

    def test_json_continuity_across_second_boundary(self):
        rows=[self.row(998,'json'),self.row(1000,'csv'),self.row(2000,'csv'),self.row(4000,'csv'),self.row(5998,'json')]
        self.assertEqual([r['family'] for r in motion_track(rows)],['json','json'])

    def test_csv_fills_actual_json_gap_and_csv_only_days(self):
        rows=[self.row(0,'json'),self.row(10000,'csv'),self.row(40000,'csv'),self.row(60000,'json')]
        self.assertEqual(len(motion_track(rows)),4)
        csv=[self.row(i*1000,'csv') for i in range(3)]
        self.assertEqual(motion_track(csv),csv)

    def test_route_boundaries_are_not_discarded(self):
        rows=[self.row(0,'json','6'),self.row(15000,'csv','7'),self.row(30000,'json','7')]
        self.assertEqual(len(motion_track(rows)),3)

if __name__=='__main__':unittest.main()
