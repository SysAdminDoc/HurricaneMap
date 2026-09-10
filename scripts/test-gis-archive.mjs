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
  CONE_SIMPLIFY_TOLERANCE_DEGREES,
  memberEndingWith,
  parseAdvDateUtc,
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

  // The reduction has to be bounded by its own tolerance, measured against the
  // ring it came from rather than asserted. A tolerance that is not enforced is
  // a number in a comment.
  let worst = 0;
  for (const point of ring) {
    let nearest = Infinity;
    for (let index = 0; index + 1 < reduced.length; index += 1) {
      const [ax, ay] = reduced[index];
      const [bx, by] = reduced[index + 1];
      const dx = bx - ax;
      const dy = by - ay;
      const t = dx === 0 && dy === 0
        ? 0
        : Math.max(0, Math.min(1, ((point[0] - ax) * dx + (point[1] - ay) * dy) / (dx * dx + dy * dy)));
      nearest = Math.min(nearest, Math.hypot(point[0] - (ax + t * dx), point[1] - (ay + t * dy)));
    }
    worst = Math.max(worst, nearest);
  }
  assert.ok(
    worst <= CONE_SIMPLIFY_TOLERANCE_DEGREES + 1e-9,
    `simplification moved a vertex ${worst.toFixed(5)} deg, over the ${CONE_SIMPLIFY_TOLERANCE_DEGREES} tolerance`,
  );
  // And the tolerance has to be doing something: at zero it must keep the ring.
  assert.equal(simplifyRing(ring, 0).length, ring.length, 'a zero tolerance drops nothing');
}

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
