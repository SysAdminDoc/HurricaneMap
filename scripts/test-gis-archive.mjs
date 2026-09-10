// The GIS archive readers, against three real advisory zips checked in as they
// came off nhc.noaa.gov. They are not samples of one shape: each was chosen for
// something that changes between years and would break a reader tuned to a
// single file.
//
//   al042008_5day_010  Dolly, advisory 10. Carries only a 72 h cone, and its
//                      .dbf has ISSSTATUS and TIMEZONE on every part.
//   al042009_5day_006A Claudette, an intermediate advisory. Its number ends in
//                      a letter and it is issued at a synoptic hour.
//   al012014_5day_005  Arthur, advisory 5. Names its members with a hyphen,
//                      `al012014-005_...`, where the others use a dot, and its
//                      points table carries FLDATELBL and STORMSRC.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CONE_MAX_DEVIATION_KM,
  CONE_SIMPLIFY_TOLERANCE_DEGREES,
  memberEndingWith,
  parseAdvDateUtc,
  ringDeviationKm,
  parseValidTime,
  readAdvisoryArchive,
  readDbf,
  readShp,
  readZip,
  simplifyRing,
} from './gis-archive.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = name => readFile(path.join(root, 'tests', 'fixtures', 'gis', name));

const [dolly, claudette, arthur] = await Promise.all([
  fixture('al042008_5day_010.zip'),
  fixture('al042009_5day_006A.zip'),
  fixture('al012014_5day_005.zip'),
]);

// ------------------------------------------------------------------ the zip
{
  const members = readZip(dolly);
  assert.equal(members.size, 20, 'an advisory package is four parts of five files');
  const names = [...members.keys()];
  assert.ok(names.every(name => name.startsWith('al042008.010_')), `2008 names its members with a dot: ${names[0]}`);
  assert.ok(
    [...readZip(arthur).keys()].every(name => name.startsWith('al012014-005_')),
    '2014 names its members with a hyphen, which is why members are found by suffix',
  );

  // The suffix lookup is the whole reason the two naming shapes do not matter.
  assert.ok(memberEndingWith(members, '_5day_pgn.shp').length > 0);
  assert.throws(
    () => memberEndingWith(members, '_5day.shp'),
    /found 0/,
    'a suffix that matches nothing has to say so rather than return undefined',
  );
  assert.throws(
    () => memberEndingWith(members, '.shp'),
    /found 4/,
    'a suffix that matches several has to say so rather than pick one',
  );

  assert.throws(() => readZip(Buffer.alloc(64)), /no end-of-central-directory/);
  // A truncated member must fail the length check rather than return short data.
  const damaged = Buffer.from(dolly);
  damaged.writeUInt32LE(0xdeadbeef, damaged.length - 200);
  assert.throws(() => readZip(damaged), /./, 'a corrupted member is refused');
}

// ------------------------------------------------------------------ the dbf
{
  const points = readDbf(memberEndingWith(readZip(dolly), '_5day_pts.dbf'));
  assert.ok(points.fields.includes('TIMEZONE'), '2008 carries TIMEZONE');
  assert.ok(points.fields.includes('VALIDTIME') && points.fields.includes('TAU'));
  const arthurPoints = readDbf(memberEndingWith(readZip(arthur), '_5day_pts.dbf'));
  assert.ok(arthurPoints.fields.includes('FLDATELBL'), '2014 carries FLDATELBL');
  assert.ok(
    !readDbf(memberEndingWith(readZip(arthur), '_5day_pgn.dbf')).fields.includes('ISSSTATUS'),
    "2014's polygon table drops ISSSTATUS, which is why fields are read from the header",
  );
  assert.equal(points.rows[0].STORMNAME, 'DOLLY');
  assert.equal(points.rows[0].ADVDATE, '080722/2100');
}

// ------------------------------------------------------------------ the shp
{
  const cone = readShp(memberEndingWith(readZip(dolly), '_5day_pgn.shp'));
  assert.equal(cone.length, 1, 'Dolly advisory 10 has one cone, the 72 h one');
  assert.equal(cone[0].type, 5, 'a cone is a polygon');
  assert.equal(cone[0].rings.length, 1);
  assert.ok(cone[0].rings[0].length > 100, 'the published ring is a few hundred points');
  const track = readShp(memberEndingWith(readZip(dolly), '_5day_lin.shp'));
  assert.equal(track[0].type, 3, 'the forecast centreline is a polyline');

  const damaged = Buffer.from(memberEndingWith(readZip(dolly), '_5day_pgn.shp'));
  damaged.writeInt32BE(1234, 0);
  assert.throws(() => readShp(damaged), /bad file code/);
}

// ------------------------------------------------------------------- times
{
  assert.equal(parseAdvDateUtc('080722/2100').iso, '2008-07-22T21:00:00Z');
  assert.equal(parseAdvDateUtc('121029/2100').iso, '2012-10-29T21:00:00Z');
  // The two-digit year window is fixed, not sliding: the archive opens in 1998.
  assert.equal(parseAdvDateUtc('980903/1500').iso, '1998-09-03T15:00:00Z');
  assert.equal(parseAdvDateUtc('990903/1500').iso, '1999-09-03T15:00:00Z');
  assert.throws(() => parseAdvDateUtc('2008-07-22'), /not YYMMDD/);
  assert.throws(() => parseAdvDateUtc('081332/2100'), /does not name a real time/);

  // VALIDTIME is a day of the month, so the month has to be inferred, and an
  // advisory late in a month forecasts into the next one.
  assert.equal(parseValidTime('22/2100', '2008-07-22T21:00:00Z').leadHours, 0);
  assert.equal(parseValidTime('31/1800', '2012-10-31T15:00:00Z').leadHours, 3);
  assert.equal(parseValidTime('01/0600', '2012-10-31T15:00:00Z').leadHours, 15);
  assert.equal(parseValidTime('03/1800', '2012-10-29T21:00:00Z').leadHours, 117);
  assert.equal(parseValidTime('01/0000', '2013-12-31T21:00:00Z').iso, '2014-01-01T00:00:00Z');
  assert.throws(() => parseValidTime('3/1800', '2012-10-29T21:00:00Z'), /not DD\/HHMM/);
}

// ---------------------------------------------------------------- simplify
{
  const ring = readShp(memberEndingWith(readZip(dolly), '_5day_pgn.shp'))[0].rings[0];
  const reduced = simplifyRing(ring);
  assert.ok(reduced.length < ring.length / 3, `${ring.length} points reduced to ${reduced.length}`);
  assert.deepEqual(reduced[0], ring[0], 'the first point is kept');
  assert.deepEqual(reduced.at(-1), ring.at(-1), 'the last point is kept');

  // Two things move a vertex and they add: the simplification, and the
  // rounding applied to what it returns. Measuring the first alone in degrees
  // is true and is not what the dataset claims, which is a distance from the
  // outline NHC published. That mismatch shipped a 1.2 km promise that 291 of
  // the 776 cones broke.
  const shipped = simplifyRing(ring).map(([lon, lat]) => [
    Number(lat.toFixed(3)), Number(lon.toFixed(3)),
  ]);
  const deviation = ringDeviationKm(ring, shipped);
  assert.ok(
    deviation <= CONE_MAX_DEVIATION_KM,
    `the shipped cone departs from the published outline by ${deviation.toFixed(3)} km, over the ${CONE_MAX_DEVIATION_KM} km budget`,
  );
  // And the budget has to be doing something: coarser rounding must break it,
  // or this passes whatever the pipeline does.
  const coarse = simplifyRing(ring).map(([lon, lat]) => [
    Number(lat.toFixed(1)), Number(lon.toFixed(1)),
  ]);
  assert.ok(
    ringDeviationKm(ring, coarse) > CONE_MAX_DEVIATION_KM,
    'rounding to one decimal stays inside the budget, so the budget is not measuring the rounding',
  );
  // At zero tolerance the simplification drops nothing.
  assert.equal(simplifyRing(ring, 0).length, ring.length, 'a zero tolerance drops nothing');
  assert.ok(CONE_SIMPLIFY_TOLERANCE_DEGREES > 0, 'the simplification tolerance is a real number');
}

// ------------------------------------------------------- the row guards
// A package rebuilt from its own members, stored rather than deflated, so a
// field can be edited and put back. NHC ships nothing but deflate, so this is
// also the only thing that reads the stored branch.
function rezipStored(members) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const [name, content] of members) {
    const rawName = Buffer.from(name, 'latin1');
    const crc = (() => {
      let value = ~0;
      for (const byte of content) {
        value ^= byte;
        for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (0xedb88320 & -(value & 1));
      }
      return ~value >>> 0;
    })();
    const local = Buffer.alloc(30 + rawName.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(content.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(rawName.length, 26);
    rawName.copy(local, 30);
    locals.push(local, content);

    const entry = Buffer.alloc(46 + rawName.length);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0, 10);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(content.length, 20);
    entry.writeUInt32LE(content.length, 24);
    entry.writeUInt16LE(rawName.length, 28);
    entry.writeUInt32LE(offset, 42);
    rawName.copy(entry, 46);
    central.push(entry);
    offset += local.length + content.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(members.size, 8);
  end.writeUInt16LE(members.size, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

/** Blank one field of one row in the points table, keeping every length. */
function blankPointsField(source, fieldName, rowIndex) {
  const members = new Map([...readZip(source)].map(([name, content]) => [name, Buffer.from(content)]));
  const [dbfName, dbf] = [...members].find(([name]) => name.toLowerCase().endsWith('_5day_pts.dbf'));
  const headerLength = dbf.readUInt16LE(8);
  const recordLength = dbf.readUInt16LE(10);
  let position = 32;
  let cursor = 1;
  let target = null;
  while (position < headerLength - 1 && dbf[position] !== 0x0d) {
    const name = dbf.toString('latin1', position, position + 11).replace(/\0[\s\S]*$/, '').trim();
    const width = dbf[position + 16];
    if (name === fieldName) target = { at: cursor, width };
    cursor += width;
    position += 32;
  }
  assert.ok(target, `${fieldName} is not a field of the points table`);
  dbf.fill(0x20, headerLength + rowIndex * recordLength + target.at, headerLength + rowIndex * recordLength + target.at + target.width);
  members.set(dbfName, dbf);
  return rezipStored(members);
}

{
  // The rebuild itself has to be faithful, or every case below proves nothing.
  const rebuilt = rezipStored(new Map([...readZip(dolly)].map(([name, content]) => [name, Buffer.from(content)])));
  const control = readAdvisoryArchive(rebuilt, { stormId: 'AL042008' });
  const original = readAdvisoryArchive(dolly, { stormId: 'AL042008' });
  assert.deepEqual(control, original, 'a stored rebuild of the package does not read the same as the deflated one');

  // A blank position is missing, not the equator.
  assert.throws(
    () => readAdvisoryArchive(blankPointsField(dolly, 'LAT', 0), { stormId: 'AL042008' }),
    /no usable position/,
    'a blank LAT is read as 0 rather than refused',
  );
  assert.throws(
    () => readAdvisoryArchive(blankPointsField(dolly, 'LON', 2), { stormId: 'AL042008' }),
    /no usable position/,
  );

  // A blank intensity is missing, not a forecast of no wind.
  const noWind = readAdvisoryArchive(blankPointsField(dolly, 'MAXWIND', 1), { stormId: 'AL042008' });
  assert.equal(noWind.f[1][3], null, 'a blank MAXWIND is read as 0 kt rather than as missing');
  assert.equal(original.f[1][3], 70, 'the control still carries its real wind, so the case above measured something');

  // Without TAU there is no origin to recover.
  assert.throws(
    () => readAdvisoryArchive(blankPointsField(blankPointsField(blankPointsField(
      blankPointsField(blankPointsField(dolly, 'TAU', 0), 'TAU', 1), 'TAU', 2), 'TAU', 3), 'TAU', 4),
    { stormId: 'AL042008' }),
    /no row gives a usable VALIDTIME and TAU|only \d+ row/,
  );
}

// VALIDTIME names a day of the month, and a day that cannot belong to the
// forecast window is a fault rather than something to reinterpret. '11/0000'
// against an advisory issued on 1 October used to resolve to 11 September, a
// lead of minus 480 hours.
assert.throws(() => parseValidTime('11/0000', '2012-10-01T00:00:00Z'), /inside the forecast window/);
assert.throws(() => parseValidTime('31/0000', '2013-10-01T00:00:00Z'), /inside the forecast window/);
assert.throws(() => parseValidTime('30/0000', '2013-02-10T00:00:00Z'), /inside the forecast window/);
// And the days that can belong to it still do, on both sides of a month end.
assert.equal(parseValidTime('02/1200', '2012-10-01T00:00:00Z').leadHours, 36);
assert.equal(parseValidTime('30/1800', '2012-10-01T00:00:00Z').leadHours, -6);

// --------------------------------------------------------- a whole advisory
{
  const record = readAdvisoryArchive(dolly, { stormId: 'AL042008', label: 'Dolly 10' });
  assert.equal(record.n, 10, 'a full advisory number is a number, not the archive\'s text');
  // The advisory went out at 21:00 and its forecast is initialised on the 18:00
  // synoptic hour. `t` is the origin, because that is the clock the 2015-2024
  // records use; `issued` is when NHC put it out.
  assert.equal(record.t, '2008-07-22T18:00:00Z');
  assert.equal(record.issued, '2008-07-22T21:00:00Z');
  assert.equal(record.name, 'DOLLY');
  assert.equal(record.conePeriodHours, 72, 'this advisory has no 120 h cone, and the longest present is taken');
  // 3 is the current position, at issuance. The rest are the forecast leads NHC
  // itself prints. Measuring from ADVDATE instead gave 0, 9, 21, 33, 45.
  assert.deepEqual(record.f.map(entry => entry[0]), [3, 12, 24, 36, 48], 'leads sit on the synoptic clock');
  assert.ok(record.f.every(([, lat, lon]) => lat > 15 && lat < 35 && lon < -80 && lon > -110), 'Dolly is in the Gulf');
  assert.ok(record.c.length > 20 && record.c.length < 200, `cone reduced to ${record.c.length} points`);

  // The cone has to contain the position the same advisory reports. If the
  // polygon and the points came from different advisories this is where it
  // shows, and it is the check the ingest runs over all 776.
  const [, lat, lon] = record.f[0];
  let inside = false;
  for (let i = 0, j = record.c.length - 1; i < record.c.length; j = i, i += 1) {
    const [yi, xi] = record.c[i];
    const [yj, xj] = record.c[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  assert.ok(inside, 'the cone does not contain the position its own advisory reports');

  const intermediate = readAdvisoryArchive(claudette, { stormId: 'AL042009' });
  assert.equal(intermediate.n, '6A', 'an intermediate advisory keeps its letter, so it stays a string');
  assert.ok(intermediate.f.length >= 2);
  // Claudette 6A re-issues the 06:00 package with a fresh current position at
  // 12:00: TAU 0 at 12:00, then TAU 12, 24 and 36 at 18:00, 06:00 and 18:00.
  // The three forecast rows outvote the current-position row, which is the
  // whole point of taking the mode, and the leads come out as NHC labelled them
  // with the fresh position sitting at 6 h.
  assert.deepEqual(intermediate.f.map(entry => entry[0]), [6, 12, 24, 36]);
  assert.equal(intermediate.t, '2009-08-17T06:00:00Z');
  assert.equal(intermediate.issued, '2009-08-17T12:00:00Z');

  // The gap between the origin and the issue time is not a constant, so it
  // cannot be hard-coded: three hours for this full advisory, six for that
  // intermediate. Both are whole hours, and neither runs backwards.
  const gap = advisory => (Date.parse(advisory.issued) - Date.parse(advisory.t)) / 3600000;
  assert.equal(gap(record), 3, 'a full advisory goes out three hours after its own initial time');
  assert.equal(gap(intermediate), 6, 'this intermediate re-issues a package six hours old');
  for (const advisory of [record, intermediate, readAdvisoryArchive(arthur, { stormId: 'AL012014' })]) {
    assert.ok(Number.isInteger(gap(advisory)), 'the gap is a whole number of hours');
    assert.ok(gap(advisory) >= 0 && gap(advisory) <= 12, `gap out of range: ${gap(advisory)} h`);
  }

  const hyphenated = readAdvisoryArchive(arthur, { stormId: 'AL012014' });
  assert.equal(hyphenated.n, 5);
  assert.equal(hyphenated.name, 'ARTHUR');
  assert.equal(hyphenated.conePeriodHours, 120);
  // 2014 counts TAU from the synoptic hour and 2008 counted it from issuance.
  // Both land on leads NHC would recognise, which is the point of the vote.
  assert.deepEqual(
    hyphenated.f.map(entry => entry[0]), [3, 12, 24, 36, 48, 72, 96, 120],
    'the 2014 convention resolves to the same clock as the 2008 one',
  );
  const leads = hyphenated.f.map(entry => entry[0]);
  assert.deepEqual(leads, [...leads].sort((a, b) => a - b), 'leads are ordered');
  assert.equal(new Set(leads).size, leads.length, 'no lead appears twice');

  // The storm guard has to fire, or a mis-addressed download would be ingested
  // under the wrong storm.
  assert.throws(
    () => readAdvisoryArchive(dolly, { stormId: 'AL092008' }),
    /describes AL04, not AL092008/,
  );
}

console.log(
  'gis archive ok (3 recorded advisories: two member-naming shapes, two field sets, two TAU conventions '
  + 'resolved to one clock, a 72 h cone, an intermediate number, a bounded simplification and the storm guard)',
);
