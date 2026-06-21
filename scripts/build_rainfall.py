"""Build data/rainfall.json from WPC tropical cyclone rainfall observations.

Source: NOAA Weather Prediction Center
https://www.wpc.ncep.noaa.gov/tropical/rain/tcrainfall.html

Reads CONUS_rainfall_obs_1900-2020.csv (station-level observations) and
storms.json (for HURDAT2 ID matching). Outputs a JSON keyed by storm_id
with peak rainfall, station name, and location.
"""

from __future__ import annotations

import csv
import json
import os
import re
import sys
import urllib.request

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(SCRIPT_DIR)
DATA_DIR = os.path.join(ROOT, 'data')

CSV_URL = 'https://www.wpc.ncep.noaa.gov/tropical/rain/CONUS_rainfall_obs_1900-2020.csv'
CSV_CACHE = os.path.join(ROOT, '.tmp-stormevents', 'tc_rainfall.csv')

def download_csv():
    os.makedirs(os.path.dirname(CSV_CACHE), exist_ok=True)
    if os.path.exists(CSV_CACHE):
        return CSV_CACHE
    print(f'Downloading {CSV_URL}...')
    urllib.request.urlretrieve(CSV_URL, CSV_CACHE)
    return CSV_CACHE

def load_storms():
    with open(os.path.join(DATA_DIR, 'storms.json'), encoding='utf-8') as f:
        return json.load(f)

def build_name_year_index(storms):
    idx = {}
    for s in storms:
        name = (s.get('name') or '').strip().upper()
        year = s.get('year')
        if name and name != 'UNNAMED' and year:
            idx[(name, year)] = s['id']
    return idx

def parse_storm_key(raw_storm, raw_year):
    raw = raw_storm.strip()
    year = int(raw_year.strip().strip('"'))
    m = re.match(r'^(.+?)\s+\d{4}$', raw)
    if m:
        name = m.group(1).strip().upper()
    else:
        name = raw.upper()
    return name, year

def main():
    csv_path = download_csv()
    storms = load_storms()
    name_idx = build_name_year_index(storms)

    peaks = {}
    with open(csv_path, encoding='utf-8', errors='replace') as f:
        reader = csv.DictReader(f)
        for row in reader:
            try:
                total = float(row['Total'])
            except (ValueError, TypeError):
                continue
            name, year = parse_storm_key(row['Storm'], row['Year'])
            storm_id = name_idx.get((name, year))
            if not storm_id:
                continue
            if storm_id not in peaks or total > peaks[storm_id]['peak_inches']:
                station = row['Station'].strip()
                try:
                    lat = float(row['Lat'])
                    lon = float(row['Lon'])
                except (ValueError, TypeError):
                    lat, lon = None, None
                peaks[storm_id] = {
                    'peak_inches': round(total, 2),
                    'station': station,
                    'lat': lat,
                    'lon': lon,
                    'year': year,
                }

    out_path = os.path.join(DATA_DIR, 'rainfall.json')
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(peaks, f, separators=(',', ':'))

    print(f'Wrote {out_path} ({len(peaks)} storms with rainfall data)')

if __name__ == '__main__':
    main()
