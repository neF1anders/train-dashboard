"""Recognition snapshots, with explicit event links and observation origins.

Repeated telemetry payloads are one snapshot, not multiple camera frames.
Coordinates belong to the observing vehicle; object poses remain local.
"""
from datetime import datetime
import json
from .storage import raw_record


def snapshots(rows):
    unique = {}
    for row in rows:
        raw = raw_record(row)
        data = raw.get('telemetry_data')
        stamp = raw.get('telemetry_timestamp')
        if not isinstance(data, dict) or not stamp:
            continue
        try:
            t = round(datetime.fromisoformat(stamp.replace('Z', '+00:00')).timestamp() * 1000)
        except (ValueError, TypeError):
            continue
        key = (row['vehicle'], t, json.dumps(data, sort_keys=True, ensure_ascii=False))
        if key not in unique:
            objects = [data['object']] if data.get('object') else data.get('trafficLights', [])
            unique[key] = {
                'id': row['id'], 't': t, 'vehicle': row['vehicle'], 'day': row['day'], 'subsystem': data.get('subsystem'),
                'lat': data.get('lat'), 'lon': data.get('lon'),
                'coordinate_role': 'observation_origin', 'routes': [], 'records': [],
                'objects': [{k: obj.get(k) for k in ('type', 'state', 'tlSignal')} for obj in objects],
            }
        item = unique[key]
        if row['route'] not in item['routes']:
            item['routes'].append(row['route'])
        item['records'].append({k: row[k] for k in ('id', 't', 'type', 'target', 'route')})
    return sorted(unique.values(), key=lambda s: s['t'])


def link_episodes(episodes, observations):
    for episode in episodes:
        links = []
        for observation in observations:
            if observation['vehicle'] != episode['vehicle'] or observation['day'] != episode['day']:
                continue
            matches = [r for r in observation['records']
                       if r['route'] == episode['route'] and r['type'] == episode['type']
                       and r['target'] == episode['target'] and episode['start'] <= r['t'] <= episode['end']]
            if matches:
                record = min(matches, key=lambda r: abs(r['t'] - observation['t']))
                links.append({'snapshot_id': observation['id'], 'record_id': record['id'],
                              'event_t': record['t'], 'delta_ms': observation['t'] - record['t']})
        episode['snapshot_links'] = links
    return episodes
