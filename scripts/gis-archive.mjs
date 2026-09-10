// Readers for NHC's GIS forecast archive, which is where the advisories issued
// before 2015 live. The ATCF a-decks reach back further than the replay does,
// but the cone they imply needs a per-year radii table and `data/cone-radii.json`
// only has eras from 2015. The GIS archive carries the cone NHC actually drew,
// as a shapefile, one zip per advisory.
//
// Node builtins only: zlib for the deflate members, everything else by hand.
// Both formats are small and stable, and a dependency for two hundred lines of
// binary reading is a dependency to audit and pin forever.
//
// Everything below was measured against live files on 2026-09-09 and 10, across
// 776 advisories and nineteen storms. The five things a reader written from the
// specification alone would get wrong, each seen in a real file:
//
//   1. Member names change shape between years. 2008 and 2012 name the parts
//      `al092008.025_5day_pgn.shp`; 2014 uses `al012014-005_5day_pgn.shp`. Find
//      members by suffix, never by rebuilding the stem.
//   2. The .dbf field set changes between years. 2008 carries ISSSTATUS and
//      TIMEZONE on every part, 2012 drops them from the polygon and adds
//      TCDVLP, SSNUM, FLDATELBL and STORMSRC to the points. Read the header.
//   3. Not every advisory has a 120 h cone. Dolly 2008 advisory 10 carries only
//      the 72 h polygon, so take the longest forecast period present.
//   4. ADVDATE is UTC whatever TIMEZONE says. That field labels the readable
//      DATELBL and FLDATELBL. Sandy advisory 30 is stamped `121029/2100` with
//      TIMEZONE EDT and FLDATELBL "2012-10-29 5:00 PM Mon EDT", and 5 PM EDT is
//      21:00 UTC. FLDATELBL agreed with ADVDATE-as-UTC on every file carrying it.
//   5. TAU changed meaning between the eras, and ADVDATE is not the origin of
//      the forecast clock. A full advisory goes out three hours after the
//      synoptic hour its forecast is initialised on, and only its first row,
//      the current position, is at issuance. Ike 2008 advisory 25 starts at
//      TAU 0 with VALIDTIME equal to ADVDATE; Sandy 2012 advisory 30 starts at
//      TAU 3 with the same VALIDTIME. Measuring leads from ADVDATE gives Dolly
//      advisory 10 the leads 0, 9, 21, 33, 45 where NHC's own advisory says 12,
//      24, 36 and 48. So the origin is recovered from the file: VALIDTIME minus
//      TAU, for every row, agreed on. TAU only locates the origin; the lead
//      itself is VALIDTIME minus that origin, so a wrong TAU cannot move a
//      point. The origin is the synoptic hour, which is what the 2015-2024
//      records are keyed on, so both eras end up on one clock.

import { inflateRawSync } from 'node:zlib';

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_FILE_HEADER = 0x02014b50;
const SHAPE_NULL = 0;
const SHAPE_POINT = 1;
const SHAPE_POLYLINE = 3;
const SHAPE_POLYGON = 5;
const SHAPEFILE_MAGIC = 9994;
const DBF_FIELD_TERMINATOR = 0x0d;
const DBF_DELETED = 0x2a;

/** Every member of a zip, by name, decompressed. Stored and deflated only. */
export function readZip(buffer) {
  let eocd = -1;
  const floor = Math.max(0, buffer.length - 22 - 65535);
  for (let index = buffer.length - 22; index >= floor; index -= 1) {
    if (buffer.readUInt32LE(index) === END_OF_CENTRAL_DIRECTORY) { eocd = index; break; }
  }
  if (eocd < 0) throw new Error('not a zip: no end-of-central-directory record');
  const entryCount = buffer.readUInt16LE(eocd + 10);
  let cursor = buffer.readUInt32LE(eocd + 16);

  const members = new Map();
  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(cursor) !== CENTRAL_FILE_HEADER) {
      throw new Error(`zip central directory entry ${index} has no signature`);
    }
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.toString('latin1', cursor + 46, cursor + 46 + nameLength);

    // The local header's own name and extra lengths, not the central record's.
    // A writer is allowed to differ, and reading the wrong ones puts the data
    // start off by however many bytes the difference is.
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const raw = buffer.subarray(start, start + compressedSize);
    let content;
    if (method === 0) content = Buffer.from(raw);
    else if (method === 8) content = inflateRawSync(raw);
    else throw new Error(`${name}: compression method ${method} is not supported`);
    if (content.length !== uncompressedSize) {
      throw new Error(`${name}: inflated to ${content.length} bytes, the directory says ${uncompressedSize}`);
    }
    members.set(name, content);
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return members;
}

/** The one member whose name ends with this suffix, or an error naming why not. */
export function memberEndingWith(members, suffix) {
  const hits = [...members.keys()].filter(name => name.toLowerCase().endsWith(suffix));
  if (hits.length !== 1) {
    throw new Error(`expected exactly one member ending "${suffix}", found ${hits.length}${hits.length ? `: ${hits.join(', ')}` : ''}`);
  }
  return members.get(hits[0]);
}

/** Geometry records from a .shp. Rings are [[lon, lat], ...] in file order. */
export function readShp(buffer) {
  if (buffer.readInt32BE(0) !== SHAPEFILE_MAGIC) throw new Error('not a shapefile: bad file code');
  const declared = buffer.readInt32BE(24) * 2;
  if (declared !== buffer.length) {
    throw new Error(`shapefile header says ${declared} bytes, the member is ${buffer.length}`);
  }
  const records = [];
  let cursor = 100;
  while (cursor + 8 <= buffer.length) {
    const contentWords = buffer.readInt32BE(cursor + 4);
    const body = cursor + 8;
    const type = buffer.readInt32LE(body);
    if (type === SHAPE_NULL) {
      records.push({ type, rings: [] });
    } else if (type === SHAPE_POINT) {
      records.push({ type, rings: [[[buffer.readDoubleLE(body + 4), buffer.readDoubleLE(body + 12)]]] });
    } else if (type === SHAPE_POLYGON || type === SHAPE_POLYLINE) {
      const partCount = buffer.readInt32LE(body + 36);
      const pointCount = buffer.readInt32LE(body + 40);
      const partsAt = body + 44;
      const pointsAt = partsAt + partCount * 4;
      const starts = [];
      for (let part = 0; part < partCount; part += 1) starts.push(buffer.readInt32LE(partsAt + part * 4));
      const rings = [];
      for (let part = 0; part < partCount; part += 1) {
        const from = starts[part];
        const to = part + 1 < partCount ? starts[part + 1] : pointCount;
        const ring = [];
        for (let point = from; point < to; point += 1) {
          ring.push([buffer.readDoubleLE(pointsAt + point * 16), buffer.readDoubleLE(pointsAt + point * 16 + 8)]);
        }
        rings.push(ring);
      }
      records.push({ type, rings });
    } else {
      throw new Error(`shape type ${type} is not one this reader handles`);
    }
    cursor = body + contentWords * 2;
  }
  return records;
}

/** Attribute rows from a .dbf, keyed by the field names in its own header. */
export function readDbf(buffer) {
  const recordCount = buffer.readUInt32LE(4);
  const headerLength = buffer.readUInt16LE(8);
  const recordLength = buffer.readUInt16LE(10);
  const fields = [];
  for (let position = 32; position < headerLength - 1 && buffer[position] !== DBF_FIELD_TERMINATOR; position += 32) {
    fields.push({
      name: buffer.toString('latin1', position, position + 11).replace(/\0[\s\S]*$/, '').trim(),
      type: String.fromCharCode(buffer[position + 11]),
      length: buffer[position + 16],
    });
  }
  const rows = [];
  for (let index = 0; index < recordCount; index += 1) {
    let position = headerLength + index * recordLength;
    const deleted = buffer[position] === DBF_DELETED;
    position += 1;
    const row = {};
    for (const field of fields) {
      row[field.name] = buffer.toString('latin1', position, position + field.length).trim();
      position += field.length;
    }
    if (!deleted) rows.push(row);
  }
  return { fields: fields.map(field => field.name), rows };
}

/** ADVDATE, `YYMMDD/HHMM`, always UTC. See note 4 at the top of this file. */
export function parseAdvDateUtc(advdate) {
  const match = /^(\d{2})(\d{2})(\d{2})\/(\d{2})(\d{2})$/.exec(String(advdate).trim());
  if (!match) throw new Error(`ADVDATE ${JSON.stringify(advdate)} is not YYMMDD/HHMM`);
  const [, yy, mm, dd, hh, mi] = match;
  // The archive opens in 1998 and the years are two digits, so the window is
  // fixed rather than sliding: 98 and 99 are the 1990s, the rest the 2000s.
  const year = Number(yy) >= 98 ? 1900 + Number(yy) : 2000 + Number(yy);
  const iso = `${year}-${mm}-${dd}T${hh}:${mi}:00Z`;
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) throw new Error(`ADVDATE ${advdate} does not name a real time`);
  return { iso, time };
}

const DAY_MS = 86400000;

/**
 * VALIDTIME, `DD/HHMM`. Day of month only, so the month and year come from the
 * advisory's own issue time, and a forecast issued on the 29th reaching the 3rd
 * crosses into the next month. A forecast never runs backwards and never runs
 * past about eight days, which is what makes the rollover decidable.
 */
export function parseValidTime(validtime, issuedIso) {
  const match = /^(\d{2})\/(\d{2})(\d{2})$/.exec(String(validtime).trim());
  if (!match) throw new Error(`VALIDTIME ${JSON.stringify(validtime)} is not DD/HHMM`);
  const [, dd, hh, mi] = match;
  const issued = new Date(issuedIso);
  if (!Number.isFinite(issued.getTime())) throw new Error(`issue time ${JSON.stringify(issuedIso)} does not parse`);
  const day = Number(dd);
  // setUTCMonth on a day the target month does not have rolls forward silently:
  // 31 September becomes 1 October, which turned a lead of 0 into a plausible
  // wrong answer. Build each candidate explicitly and keep only the real ones.
  const candidates = [-1, 0, 1]
    .map(offset => new Date(Date.UTC(issued.getUTCFullYear(), issued.getUTCMonth() + offset, day, Number(hh), Number(mi))))
    .filter(date => date.getUTCDate() === day);
  const inWindow = candidates.filter(date => {
    const lead = date.getTime() - issued.getTime();
    return lead > -DAY_MS && lead <= 9 * DAY_MS;
  });
  if (inWindow.length !== 1) {
    throw new Error(
      `VALIDTIME ${validtime} against an advisory issued ${issuedIso} names `
      + `${inWindow.length === 0 ? 'no time' : `${inWindow.length} times`} inside the forecast window`,
    );
  }
  const [candidate] = inWindow;
  return {
    iso: candidate.toISOString().replace('.000', ''),
    leadHours: Math.round((candidate.getTime() - issued.getTime()) / 3600000),
  };
}

// A cone ring is about 350 points as published, and about 86 after this
// tolerance. Two things move a vertex, and they add: the simplification, and
// the rounding applied to what it returns.
//
// CONE_MAX_DEVIATION_KM is the budget for both together, measured over all 776
// cones of the era rather than reasoned about. At two decimals the worst was
// 1.560 km and 291 cones were over 1.2, so the earlier claim of 1.19 km was
// wrong for a third of them: that number was the simplification alone. Three
// decimals brings the worst to 1.093 km for 0.12 MB more across the era. On a
// five-day cone some 370 km across that is three parts in a thousand, and the
// full rings would be 3.9 MB rather than 1.0.
export const CONE_SIMPLIFY_TOLERANCE_DEGREES = 0.01;
export const CONE_COORDINATE_DECIMALS = 3;
export const CONE_MAX_DEVIATION_KM = 1.2;

/**
 * How far the worst published vertex ends up from the shipped outline, in km.
 * Longitude is squeezed by the cosine of its own latitude, floored so a polar
 * ring cannot report a flattering number.
 */
export function ringDeviationKm(published, shipped) {
  let worst = 0;
  for (const [lon, lat] of published) {
    let nearest = Infinity;
    for (let index = 0; index + 1 < shipped.length; index += 1) {
      const [ay, ax] = shipped[index];
      const [by, bx] = shipped[index + 1];
      const dx = bx - ax;
      const dy = by - ay;
      const t = dx === 0 && dy === 0
        ? 0
        : Math.max(0, Math.min(1, ((lon - ax) * dx + (lat - ay) * dy) / (dx * dx + dy * dy)));
      nearest = Math.min(nearest, Math.hypot(lon - (ax + t * dx), lat - (ay + t * dy)));
    }
    worst = Math.max(worst, nearest * 111.32 * Math.max(Math.cos(lat * Math.PI / 180), 0.3));
  }
  return worst;
}

function perpendicular([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  if (dx === 0 && dy === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Douglas-Peucker, keeping the first and last points. */
export function simplifyRing(points, tolerance = CONE_SIMPLIFY_TOLERANCE_DEGREES) {
  if (points.length < 3) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    let worst = 0;
    let at = -1;
    for (let index = first + 1; index < last; index += 1) {
      const distance = perpendicular(points[index], points[first], points[last]);
      if (distance > worst) { worst = distance; at = index; }
    }
    if (at >= 0 && worst > tolerance) {
      keep[at] = 1;
      stack.push([first, at], [at, last]);
    }
  }
  return points.filter((_, index) => keep[index]);
}

/**
 * One advisory, read from its zip: the forecast NHC issued and the cone it drew.
 *
 * Returns `{ n, t, f, c, conePeriodHours, name }` where `f` is
 * `[leadHours, lat, lon, windKt|null]` sorted by lead, matching the shape the
 * a-deck path already produces, and `c` is the cone as `[lat, lon]` pairs.
 */
export function readAdvisoryArchive(buffer, { stormId, label = 'advisory' } = {}) {
  const members = readZip(buffer);
  const points = readDbf(memberEndingWith(members, '_5day_pts.dbf'));
  if (!points.rows.length) throw new Error(`${label}: the forecast points table is empty`);
  const head = points.rows[0];
  const issued = parseAdvDateUtc(head.ADVDATE);

  // The forecast's origin, voted on by the rows themselves. See note 5.
  const votes = new Map();
  for (const row of points.rows) {
    // Digits, not Number(): a blank TAU became 0, so every row voted for its own
    // VALIDTIME and a package with none of them produced a five-way tie rather
    // than saying it carried no usable clock.
    if (!/^\d+$/.test(row.TAU)) continue;
    const tau = Number(row.TAU);
    if (tau === 9999) continue;
    let valid;
    try {
      valid = parseValidTime(row.VALIDTIME, issued.iso);
    } catch {
      continue;
    }
    const origin = Date.parse(valid.iso) - tau * 3600000;
    votes.set(origin, (votes.get(origin) || 0) + 1);
  }
  if (!votes.size) throw new Error(`${label}: no row gives a usable VALIDTIME and TAU, so the forecast has no origin`);
  const ranked = [...votes.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const [initial, best] = ranked[0];
  // A tie is not a majority. Two origins with equal support means the file's two
  // clocks genuinely disagree, and picking the earlier one would be a coin toss
  // dressed as a rule.
  if (ranked.length > 1 && ranked[1][1] === best) {
    throw new Error(`${label}: ${ranked.filter(entry => entry[1] === best).length} forecast origins are equally supported`);
  }
  // Dissent is the current-position row, and the 2014-era packages repeat it
  // once per forecast period, so two is normal and three is not. The old form
  // of this also admitted four dissenters in ten rows, and could not fire at
  // all on a single-row table, where `best < rows.length - 1` is `1 < 0`.
  const dissent = [...votes.values()].reduce((total, count) => total + count, 0) - best;
  if (dissent > 2) {
    throw new Error(`${label}: ${dissent} of ${points.rows.length} rows disagree with the forecast origin`);
  }
  if (best < 2) {
    throw new Error(`${label}: only ${best} row supports the forecast origin, which is not enough to cross-check it`);
  }
  const initialIso = new Date(initial).toISOString().replace('.000', '');

  const byLead = new Map();
  for (const row of points.rows) {
    // Not Number(): the empty string becomes 0, and a blank LAT would ship
    // every position of that advisory on the equator rather than fail.
    if (!/^-?\d+(?:\.\d+)?$/.test(row.LAT) || !/^-?\d+(?:\.\d+)?$/.test(row.LON)) {
      throw new Error(`${label}: a forecast row has no usable position (LAT ${JSON.stringify(row.LAT)}, LON ${JSON.stringify(row.LON)})`);
    }
    const lat = Number(row.LAT);
    const lon = Number(row.LON);
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      throw new Error(`${label}: a forecast row is at [${lat}, ${lon}], which is not on the earth`);
    }
    const valid = parseValidTime(row.VALIDTIME, issued.iso);
    const leadHours = Math.round((Date.parse(valid.iso) - initial) / 3600000);
    if (leadHours < 0) continue;
    // 9999 is the archive's own missing marker, and it is on MSLP, TCDIR and
    // TCSPD for every row past the first. A blank is missing too, and reading it
    // as Number('') would have shipped a forecast of 0 kt.
    const wind = /^\d+(?:\.\d+)?$/.test(row.MAXWIND) ? Number(row.MAXWIND) : NaN;
    // A lead can appear twice, once per forecast period, and the rows agree
    // where they overlap. First wins, as with the a-deck's repeated wind-radii
    // rows.
    if (!byLead.has(leadHours)) {
      byLead.set(leadHours, [leadHours, lat, lon, Number.isFinite(wind) && wind !== 9999 ? wind : null]);
    }
  }
  const forecasts = [...byLead.values()].sort((a, b) => a[0] - b[0]);
  if (!forecasts.length) throw new Error(`${label}: no usable forecast positions`);

  const coneShapes = readShp(memberEndingWith(members, '_5day_pgn.shp'));
  const coneRows = readDbf(memberEndingWith(members, '_5day_pgn.dbf')).rows;
  if (coneShapes.length !== coneRows.length) {
    throw new Error(`${label}: ${coneShapes.length} cone shapes but ${coneRows.length} attribute rows`);
  }
  const periods = coneRows.map(row => Number(row.FCSTPRD));
  const longest = Math.max(...periods);
  const coneIndex = periods.indexOf(longest);
  const rings = coneShapes[coneIndex].rings;
  if (!rings.length) throw new Error(`${label}: the cone polygon has no ring`);
  // A cone is one outline. More than one would mean this has picked up
  // something else, and quietly taking the first would hide that.
  if (rings.length > 1) throw new Error(`${label}: the cone has ${rings.length} rings, expected one`);

  if (head.ADVISNUM !== coneRows[coneIndex].ADVISNUM) {
    throw new Error(`${label}: the points say advisory ${head.ADVISNUM} and the cone says ${coneRows[coneIndex].ADVISNUM}`);
  }
  if (stormId) {
    const described = `${coneRows[coneIndex].BASIN}${String(coneRows[coneIndex].STORMNUM).padStart(2, '0')}`.toUpperCase();
    if (!stormId.toUpperCase().startsWith(described)) {
      throw new Error(`${label}: the file describes ${described}, not ${stormId}`);
    }
  }

  // A full advisory is a number, the way the a-deck era already records it; an
  // intermediate keeps its letter, and only this archive has those.
  const advisoryNumber = /^\d+$/.test(head.ADVISNUM) ? Number(head.ADVISNUM) : head.ADVISNUM;
  if (!/^[1-9]\d*[A-Z]?$/.test(String(advisoryNumber))) {
    throw new Error(`${label}: advisory number ${JSON.stringify(head.ADVISNUM)} is not a number with an optional letter`);
  }

  return {
    n: advisoryNumber,
    // The synoptic hour the forecast is initialised on, which is what the
    // 2015-2024 records built from the a-deck are keyed on.
    t: initialIso,
    // When NHC actually put the advisory out, three hours later for a full one
    // and on the hour for an intermediate.
    issued: issued.iso,
    f: forecasts,
    c: simplifyRing(rings[0]).map(([lon, lat]) => [
      Number(lat.toFixed(CONE_COORDINATE_DECIMALS)),
      Number(lon.toFixed(CONE_COORDINATE_DECIMALS)),
    ]),
    conePeriodHours: longest,
    name: head.STORMNAME,
  };
}
