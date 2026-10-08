"""Archive evidence must remain scoped, deduplicated and temporally explicit."""
import unittest
from contextlib import closing
from app.storage import connect, raw_record
from app.observations import snapshots, link_episodes


class ObservationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with closing(connect()) as con:
            cls.rows = list(con.execute('SELECT * FROM records WHERE telemetry=1 ORDER BY t,id'))
            cls.snapshots = snapshots(cls.rows)
            cls.episodes = link_episodes([dict(r) for r in con.execute("SELECT * FROM episodes WHERE type='Brake'")], cls.snapshots)

    def test_duplicate_payloads_are_one_observation(self):
        self.assertEqual(len(self.rows), 212)
        self.assertEqual(len(self.snapshots), 43)
        self.assertEqual(sum(s['subsystem'] == 'TrafficLightSubSys' for s in self.snapshots), 20)
        self.assertEqual(sum(len(s['records']) for s in self.snapshots), 212)

    def test_links_are_to_same_trip_target_and_episode(self):
        self.assertEqual(sum(bool(e['snapshot_links']) for e in self.episodes), 29)
        for e in self.episodes:
            for link in e['snapshot_links']:
                s = next(s for s in self.snapshots if s['id'] == link['snapshot_id'])
                r = next(r for r in s['records'] if r['id'] == link['record_id'])
                self.assertEqual((s['vehicle'], s['day'], r['route'], r['target'], r['type']),
                                 (e['vehicle'], e['day'], e['route'], e['target'], e['type']))
                self.assertTrue(e['start'] <= r['t'] <= e['end'])
                self.assertEqual(link['delta_ms'], s['t'] - r['t'])

    def test_snapshot_time_and_origin_are_not_object_position(self):
        s = next(s for s in self.snapshots if any(r['id'] == 721979 for r in s['records']))
        row = next(r for r in self.rows if r['id'] == 721979)
        self.assertEqual(s['t'] - row['t'], -209)
        self.assertEqual(s['coordinate_role'], 'observation_origin')
        self.assertEqual(s['lat'], raw_record(row)['telemetry_data']['lat'])
        self.assertEqual(s['objects'], [{'type': 'CAR', 'state': 'TRACKED', 'tlSignal': None}])
        self.assertTrue(any(o['state'] == 'NO_OBS_TRACKED' for s in self.snapshots for o in s['objects']))


if __name__ == '__main__':
    unittest.main()
