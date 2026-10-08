from pathlib import Path
import sqlite3, json, zlib

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'data'
DB = DATA / 'sirius.sqlite3'
VERSION = 'sirius-mvp-1'

def connect():
    con = sqlite3.connect(DB, timeout=60)
    con.row_factory = sqlite3.Row
    con.execute('PRAGMA foreign_keys=ON')
    return con

def init():
    DATA.mkdir(exist_ok=True)
    with connect() as con:
        con.execute('PRAGMA journal_mode=WAL')
        con.executescript('''
        CREATE TABLE IF NOT EXISTS sources(id INTEGER PRIMARY KEY,path TEXT UNIQUE,sha TEXT,aliases TEXT,done INTEGER DEFAULT 0);
        CREATE TABLE IF NOT EXISTS records(
          id INTEGER PRIMARY KEY,h TEXT UNIQUE,vehicle TEXT,day TEXT,t INTEGER,route TEXT,variant TEXT,
          family TEXT,type TEXT,target TEXT,speed REAL,goal REAL,lat REAL,lon REAL,loc_lat REAL,loc_lon REAL,
          pos REAL,segment TEXT,handle TEXT,brakes INTEGER,act_danger TEXT,act_light TEXT,act_speed TEXT,
          flags TEXT,telemetry INTEGER,source_id INTEGER REFERENCES sources(id),seq INTEGER,pointer TEXT,payload BLOB);
        CREATE INDEX IF NOT EXISTS idx_records_time ON records(vehicle,t);
        CREATE INDEX IF NOT EXISTS idx_records_catalog ON records(vehicle,day,route,t);
        CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT);
        CREATE TABLE IF NOT EXISTS catalog(vehicle TEXT,day TEXT,route TEXT,variants TEXT,start INTEGER,end INTEGER,n INTEGER,json_n INTEGER,hours REAL,PRIMARY KEY(vehicle,day,route));
        CREATE TABLE IF NOT EXISTS episodes(id INTEGER PRIMARY KEY,vehicle TEXT,day TEXT,route TEXT,start INTEGER,end INTEGER,type TEXT,target TEXT,n INTEGER,evidence_id INTEGER);
        CREATE INDEX IF NOT EXISTS idx_episodes_time ON episodes(vehicle,start);
        CREATE TABLE IF NOT EXISTS history(id TEXT PRIMARY KEY,updated TEXT,state TEXT,kind TEXT,title TEXT);
        CREATE TABLE IF NOT EXISTS analyses(id TEXT PRIMARY KEY,created TEXT,vehicle TEXT,start INTEGER,end INTEGER,route TEXT,version TEXT,result TEXT);
        ''')

def raw_record(row):
    return json.loads(zlib.decompress(row['payload']))

def meta(con,key,default=None):
    row=con.execute('SELECT value FROM metadata WHERE key=?',(key,)).fetchone()
    return json.loads(row[0]) if row else default

PUBLIC_COLUMNS='id,vehicle,day,t,route,variant,family,type,target,speed,goal,lat,lon,loc_lat,loc_lon,pos,segment,handle,brakes,act_danger,act_light,act_speed,flags,telemetry'

def public(row):
    r=dict(row)
    if 'flags' in r:r['flags']=json.loads(r['flags'] or '[]')
    return r
