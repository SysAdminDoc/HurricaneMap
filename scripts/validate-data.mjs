import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];

async function readJson(relativePath) {
  const fullPath = path.join(root, relativePath);
  try {
    return JSON.parse(await readFile(fullPath, 'utf8'));
  } catch (error) {
    errors.push(`${relativePath}: ${error.message}`);
    return null;
  }
}

function fail(message) {
  errors.push(message);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function validIsoDate(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function validCategory(value) {
  return Number.isInteger(value) && value >= -1 && value <= 5;
}

function categoryStrength(category) {
  if (category === 0) return 0;
  if (category === -1) return 1;
  return category + 1;
}

function validOptionalString(value) {
  return value == null || typeof value === 'string';
}

function validNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function assertNumberInRange(value, min, max, label) {
  if (!isFiniteNumber(value) || value < min || value > max) {
    fail(`${label} must be a finite number in range ${min}..${max}`);
  }
}

function assertImpactNumber(value, label) {
  if (!isFiniteNumber(value) || value < 0) {
    fail(`${label} must be a finite non-negative number.`);
  }
}

const [landfalls, storms, stats, impacts, glossary, metadata, stormEvents, billions] = await Promise.all([
  readJson('data/landfalls.json'),
  readJson('data/storms.json'),
  readJson('data/stats.json'),
  readJson('data/impacts.json'),
  readJson('data/glossary.json'),
  readJson('data/metadata.json'),
  readJson('data/storm-events.json'),
  readJson('data/billions.json'),
]);

try {
  const [stormsJsonBytes, stormsGzipBytes] = await Promise.all([
    readFile(path.join(root, 'data/storms.json')),
    readFile(path.join(root, 'data/storms.json.gz')),
  ]);
  const expanded = gunzipSync(stormsGzipBytes);
  if (!expanded.equals(stormsJsonBytes)) {
    fail('data/storms.json.gz does not expand byte-for-byte to data/storms.json.');
  }
} catch (error) {
  fail(`data/storms.json.gz: ${error.message}`);
}

if (!Array.isArray(landfalls)) fail('data/landfalls.json must contain an array.');
if (!Array.isArray(storms)) fail('data/storms.json must contain an array.');
if (!isObject(stats)) fail('data/stats.json must contain an object.');
if (!isObject(impacts)) fail('data/impacts.json must contain an object.');
if (!Array.isArray(glossary)) fail('data/glossary.json must contain an array.');
if (!isObject(metadata)) fail('data/metadata.json must contain an object.');
if (!isObject(stormEvents)) fail('data/storm-events.json must contain an object.');
if (!isObject(billions)) fail('data/billions.json must contain an object.');

if (errors.length) {
  printErrorsAndExit();
}

const stormsById = new Map();
for (const storm of storms) {
  if (!isObject(storm)) {
    fail('storms.json contains a non-object storm row.');
    continue;
  }
  if (typeof storm.id !== 'string' || !storm.id) fail('storm row missing id.');
  if (stormsById.has(storm.id)) fail(`duplicate storm id: ${storm.id}`);
  stormsById.set(storm.id, storm);
  if (typeof storm.name !== 'string') fail(`${storm.id}: name must be a string.`);
  if (!Number.isInteger(storm.year) || storm.year < 1800 || storm.year > 2100) fail(`${storm.id}: invalid year.`);
  if (!isFiniteNumber(storm.peak_wind_kt)) fail(`${storm.id}: peak_wind_kt must be numeric.`);
  if (storm.min_pres_mb != null && !isFiniteNumber(storm.min_pres_mb)) fail(`${storm.id}: min_pres_mb must be numeric or null.`);
  if (!validCategory(storm.landfall_max_category)) fail(`${storm.id}: invalid landfall_max_category.`);
  if (!Array.isArray(storm.us_landfalls)) fail(`${storm.id}: us_landfalls must be an array.`);
  if (!Array.isArray(storm.track) || storm.track.length === 0) fail(`${storm.id}: track must be a non-empty array.`);
  if (Array.isArray(storm.us_landfalls) && storm.us_landfall_count !== storm.us_landfalls.length) {
    fail(`${storm.id}: us_landfall_count does not match us_landfalls length.`);
  }
  if (Array.isArray(storm.us_landfalls) && storm.us_landfalls.length > 0) {
    const strongest = storm.us_landfalls.reduce((best, landfall) => (
      best == null || categoryStrength(landfall.category) > categoryStrength(best)
        ? landfall.category
        : best
    ), null);
    if (storm.landfall_max_category !== strongest) {
      fail(`${storm.id}: landfall_max_category ${storm.landfall_max_category} does not match strongest U.S. landfall ${strongest}.`);
    }
  }
  if (!Array.isArray(storm.similarity_vector) || storm.similarity_vector.length !== 8) {
    fail(`${storm.id}: similarity_vector must be an 8-number array.`);
  } else {
    for (const [index, value] of storm.similarity_vector.entries()) {
      if (!isFiniteNumber(value) || value < 0 || value > 1) {
        fail(`${storm.id}: similarity_vector[${index}] must be finite and normalized to 0..1.`);
      }
    }
  }
  if (Array.isArray(storm.track)) {
    let previousTime = -Infinity;
    for (const [index, point] of storm.track.entries()) {
      const label = `${storm.id}.track[${index}]`;
      if (!isObject(point)) {
        fail(`${label}: track point must be an object.`);
        continue;
      }
      if (!validIsoDate(point.t)) fail(`${label}: invalid timestamp.`);
      const currentTime = Date.parse(point.t);
      if (currentTime < previousTime) fail(`${label}: timestamps must be chronological.`);
      previousTime = currentTime;
      assertNumberInRange(point.lat, -90, 90, `${label}.lat`);
      assertNumberInRange(point.lon, -180, 180, `${label}.lon`);
      // The preprocessor emits null for HURDAT2's -99 missing-wind sentinel
      // (preprocess_hurdat2.py rec["wind"]) — same contract as pres.
      if (point.wind != null && !isFiniteNumber(point.wind)) fail(`${label}.wind must be numeric or null.`);
      if (point.pres != null && !isFiniteNumber(point.pres)) fail(`${label}.pres must be numeric or null.`);
      if (typeof point.status !== 'string') fail(`${label}.status must be a string.`);
    }
  }
}

const landfallCountsByStorm = new Map();
const landfallCountsByState = new Map();
const landfallCountsByYear = new Map();
const categoryCounts = { ts_or_below: 0, cat1: 0, cat2: 0, cat3: 0, cat4: 0, cat5: 0 };
let hurricaneLandfalls = 0;
const landfallKeys = new Set();

for (const [index, landfall] of landfalls.entries()) {
  const label = `landfalls[${index}]`;
  if (!isObject(landfall)) {
    fail(`${label}: row must be an object.`);
    continue;
  }
  if (typeof landfall.storm_id !== 'string' || !landfall.storm_id) fail(`${label}: missing storm_id.`);
  if (!stormsById.has(landfall.storm_id)) fail(`${label}: unknown storm_id ${landfall.storm_id}.`);
  if (typeof landfall.name !== 'string') fail(`${label}: name must be a string.`);
  if (!Number.isInteger(landfall.year)) fail(`${label}: year must be an integer.`);
  if (!validIsoDate(landfall.t)) fail(`${label}: invalid timestamp.`);
  assertNumberInRange(landfall.lat, -90, 90, `${label}.lat`);
  assertNumberInRange(landfall.lon, -180, 180, `${label}.lon`);
  if (landfall.wind != null && !isFiniteNumber(landfall.wind)) fail(`${label}: wind must be numeric or null.`);
  if (landfall.pres != null && !isFiniteNumber(landfall.pres)) fail(`${label}: pres must be numeric or null.`);
  if (!validCategory(landfall.category)) fail(`${label}: invalid category.`);
  if (typeof landfall.state !== 'string' || !landfall.state) fail(`${label}: state must be a non-empty string.`);

  const key = `${landfall.storm_id}|${landfall.t}|${landfall.lat}|${landfall.lon}|${landfall.state}`;
  if (landfallKeys.has(key)) fail(`${label}: duplicate landfall event key ${key}.`);
  landfallKeys.add(key);

  landfallCountsByStorm.set(landfall.storm_id, (landfallCountsByStorm.get(landfall.storm_id) || 0) + 1);
  landfallCountsByState.set(landfall.state, (landfallCountsByState.get(landfall.state) || 0) + 1);
  landfallCountsByYear.set(String(landfall.year), (landfallCountsByYear.get(String(landfall.year)) || 0) + 1);
  if (landfall.category > 0) hurricaneLandfalls += 1;
  if (landfall.category <= 0) categoryCounts.ts_or_below += 1;
  else categoryCounts[`cat${landfall.category}`] += 1;
}

for (const [stormId, count] of landfallCountsByStorm.entries()) {
  const storm = stormsById.get(stormId);
  if (storm?.us_landfall_count !== count) {
    fail(`${stormId}: storm us_landfall_count ${storm?.us_landfall_count} does not match landfalls.json count ${count}.`);
  }
}

if (stats.total_storms !== storms.length) fail(`stats.total_storms ${stats.total_storms} does not match storms.json length ${storms.length}.`);
if (stats.total_landfall_events !== landfalls.length) fail(`stats.total_landfall_events ${stats.total_landfall_events} does not match landfalls.json length ${landfalls.length}.`);
if (stats.total_hurricane_landfalls !== hurricaneLandfalls) fail(`stats.total_hurricane_landfalls ${stats.total_hurricane_landfalls} does not match category count ${hurricaneLandfalls}.`);

if (!Array.isArray(stats.year_range) || stats.year_range.length !== 2) {
  fail('stats.year_range must be [minYear, maxYear].');
} else {
  const years = landfalls.map(landfall => landfall.year);
  const minYear = Math.min(...years);
  const maxYear = Math.max(...years);
  if (stats.year_range[0] !== minYear || stats.year_range[1] !== maxYear) {
    fail(`stats.year_range ${JSON.stringify(stats.year_range)} does not match landfall years [${minYear},${maxYear}].`);
  }
}

if (metadata.schema_version !== 1) fail('metadata.schema_version must be 1.');
if (!validIsoDate(metadata.generated_at_utc)) fail('metadata.generated_at_utc must be an ISO timestamp.');
if (!isObject(metadata.generator)) {
  fail('metadata.generator must contain generator details.');
} else {
  if (typeof metadata.generator.name !== 'string' || !metadata.generator.name) fail('metadata.generator.name is required.');
  if (typeof metadata.generator.app_version !== 'string' || !metadata.generator.app_version) fail('metadata.generator.app_version is required.');
}
if (!isObject(metadata.coverage)) {
  fail('metadata.coverage must contain coverage details.');
} else {
  if (metadata.coverage.storm_count !== stats.total_storms) {
    fail(`metadata.coverage.storm_count ${metadata.coverage.storm_count} does not match stats.total_storms ${stats.total_storms}.`);
  }
  if (metadata.coverage.landfall_event_count !== stats.total_landfall_events) {
    fail(`metadata.coverage.landfall_event_count ${metadata.coverage.landfall_event_count} does not match stats.total_landfall_events ${stats.total_landfall_events}.`);
  }
  if (metadata.coverage.hurricane_landfall_count !== stats.total_hurricane_landfalls) {
    fail(`metadata.coverage.hurricane_landfall_count ${metadata.coverage.hurricane_landfall_count} does not match stats.total_hurricane_landfalls ${stats.total_hurricane_landfalls}.`);
  }
  if (JSON.stringify(metadata.coverage.year_range) !== JSON.stringify(stats.year_range)) {
    fail(`metadata.coverage.year_range ${JSON.stringify(metadata.coverage.year_range)} does not match stats.year_range ${JSON.stringify(stats.year_range)}.`);
  }
  if (!Array.isArray(metadata.coverage.basins) || !metadata.coverage.basins.includes('AL') || !metadata.coverage.basins.includes('EP')) {
    fail('metadata.coverage.basins must include AL and EP.');
  }
}
if (!Array.isArray(metadata.sources) || metadata.sources.length < 2) {
  fail('metadata.sources must contain Atlantic and Eastern Pacific source entries.');
} else {
  const seenSources = new Set();
  for (const [index, source] of metadata.sources.entries()) {
    const label = `metadata.sources[${index}]`;
    if (!isObject(source)) {
      fail(`${label}: source must be an object.`);
      continue;
    }
    if (typeof source.id !== 'string' || !source.id) fail(`${label}.id is required.`);
    if (seenSources.has(source.id)) fail(`${label}.id is duplicated.`);
    seenSources.add(source.id);
    if (typeof source.basin !== 'string' || !source.basin) fail(`${label}.basin is required.`);
    if (!stats.generated_from?.includes(source.filename)) fail(`${label}.filename ${source.filename} is not listed in stats.generated_from.`);
    if (typeof source.path !== 'string' || !source.path.startsWith('data/')) fail(`${label}.path must be a data/ path.`);
    if (!Number.isInteger(source.size_bytes) || source.size_bytes <= 0) fail(`${label}.size_bytes must be positive.`);
    if (!validIsoDate(source.modified_utc)) fail(`${label}.modified_utc must be an ISO timestamp.`);
    if (!Number.isInteger(source.storm_count) || source.storm_count <= 0) fail(`${label}.storm_count must be positive.`);
    if (!Array.isArray(source.storm_year_range) || source.storm_year_range.length !== 2) {
      fail(`${label}.storm_year_range must be [minYear, maxYear].`);
    } else if (!source.storm_year_range.every(Number.isInteger)) {
      fail(`${label}.storm_year_range values must be integers.`);
    }
  }
}
if (!isObject(metadata.outputs)) {
  fail('metadata.outputs must describe generated output files.');
} else {
  for (const [key, expectedPath] of Object.entries({
    landfalls: 'data/landfalls.json',
    storms: 'data/storms.json',
    storms_gzip: 'data/storms.json.gz',
    stats: 'data/stats.json',
  })) {
    const output = metadata.outputs[key];
    if (!isObject(output)) {
      fail(`metadata.outputs.${key} must be an object.`);
      continue;
    }
    if (output.path !== expectedPath) fail(`metadata.outputs.${key}.path must be ${expectedPath}.`);
    if (!Number.isInteger(output.size_bytes) || output.size_bytes <= 0) fail(`metadata.outputs.${key}.size_bytes must be positive.`);
    if (!validIsoDate(output.modified_utc)) fail(`metadata.outputs.${key}.modified_utc must be an ISO timestamp.`);
  }
}

for (const [state, count] of landfallCountsByState.entries()) {
  const stateStats = stats.by_state?.[state];
  if (!stateStats) {
    fail(`stats.by_state missing ${state}.`);
  } else if (stateStats.total !== count) {
    fail(`stats.by_state.${state}.total ${stateStats.total} does not match landfall count ${count}.`);
  } else if (Array.isArray(stateStats.by_cat)) {
    const bucketSum = stateStats.by_cat.reduce((sum, value) => sum + value, 0);
    if (bucketSum !== stateStats.total) {
      fail(`stats.by_state.${state} by_cat sums to ${bucketSum}, expected total ${stateStats.total}.`);
    }
  }
}

for (const [year, count] of landfallCountsByYear.entries()) {
  if (stats.by_year?.[year] !== count) {
    fail(`stats.by_year.${year} ${stats.by_year?.[year]} does not match landfall count ${count}.`);
  }
}

for (const [key, count] of Object.entries(categoryCounts)) {
  if (stats.by_category?.[key] !== count) {
    fail(`stats.by_category.${key} ${stats.by_category?.[key]} does not match computed count ${count}.`);
  }
}

// Decade roll-up must match the landfall list it claims to summarize:
// totals recompute from landfalls.json, and each decade's category buckets
// must sum to its total.
if (isObject(stats.by_decade)) {
  const decadeCounts = {};
  for (const landfall of landfalls) {
    const decade = String(Math.floor(landfall.year / 10) * 10);
    decadeCounts[decade] = (decadeCounts[decade] || 0) + 1;
  }
  for (const [decade, entry] of Object.entries(stats.by_decade)) {
    if (!isObject(entry) || !Array.isArray(entry.by_cat)) {
      fail(`stats.by_decade.${decade} must be {total, by_cat[]}.`);
      continue;
    }
    if (decadeCounts[decade] !== entry.total) {
      fail(`stats.by_decade.${decade}.total ${entry.total} does not match computed count ${decadeCounts[decade] ?? 0}.`);
    }
    const bucketSum = entry.by_cat.reduce((sum, count) => sum + count, 0);
    if (bucketSum !== entry.total) {
      fail(`stats.by_decade.${decade} by_cat sums to ${bucketSum}, expected total ${entry.total}.`);
    }
  }
}

// Category must be derivable from the landfall wind. Mirrors
// preprocess_hurdat2.py saffir_simpson(): 0 = TD (<34 kt), -1 = TS (34-63).
function expectedCategory(windKt) {
  if (windKt < 34) return 0;
  if (windKt < 64) return -1;
  if (windKt < 83) return 1;
  if (windKt < 96) return 2;
  if (windKt < 113) return 3;
  if (windKt < 137) return 4;
  return 5;
}
for (const landfall of landfalls) {
  if (landfall.wind == null) continue;
  const expected = expectedCategory(landfall.wind);
  if (landfall.category !== expected) {
    fail(`${landfall.storm_id} landfall at ${landfall.t}: category ${landfall.category} inconsistent with wind ${landfall.wind} kt (expected ${expected}).`);
  }
}

for (const [stormId, event] of Object.entries(billions)) {
  if (stormId === '_meta') {
    if (!isObject(event) || typeof event.source !== 'string') fail('billions.json _meta must record its source.');
    continue;
  }
  if (!stormsById.has(stormId)) fail(`billions.json references unknown storm id ${stormId}.`);
  if (!isObject(event)) {
    fail(`${stormId}: billions row must be an object.`);
    continue;
  }
  if (typeof event.event !== 'string' || !event.event) fail(`${stormId}: billions event name is required.`);
  if (!isFiniteNumber(event.cost_cpi_musd) || event.cost_cpi_musd < 1000) fail(`${stormId}: billions cost_cpi_musd must be >= 1000 (billion-dollar threshold, millions USD).`);
  if (!isFiniteNumber(event.cost_nominal_musd) || event.cost_nominal_musd <= 0) fail(`${stormId}: billions cost_nominal_musd must be a positive number.`);
  if (!validNonNegativeInteger(event.deaths)) fail(`${stormId}: billions deaths must be a non-negative integer.`);
  if (!validIsoDate(event.begin) || !validIsoDate(event.end)) fail(`${stormId}: billions begin/end must be ISO dates.`);
}

for (const [stormId, impact] of Object.entries(impacts)) {
  if (!stormsById.has(stormId)) fail(`impacts.json references unknown storm id ${stormId}.`);
  if (!isObject(impact)) {
    fail(`${stormId}: impact row must be an object.`);
    continue;
  }

  if (!validOptionalString(impact.deaths)) fail(`${stormId}.deaths must be a string when present.`);
  if (!validOptionalString(impact.damages)) fail(`${stormId}.damages must be a string when present.`);
  if (!validOptionalString(impact.damage_prefix)) fail(`${stormId}.damage_prefix must be a string when present.`);
  if (!validOptionalString(impact.damage_suffix)) fail(`${stormId}.damage_suffix must be a string when present.`);
  if (!validOptionalString(impact.wiki_title)) fail(`${stormId}.wiki_title must be a string when present.`);
  if (!validOptionalString(impact.wiki_url)) fail(`${stormId}.wiki_url must be a string when present.`);
  if (impact.wiki_url != null && !/^https:\/\/en\.wikipedia\.org\/wiki\//.test(impact.wiki_url)) {
    fail(`${stormId}.wiki_url must point to an English Wikipedia article.`);
  }

  if (impact.impact_schema_version !== 1) fail(`${stormId}.impact_schema_version must be 1.`);
  if (!isObject(impact.impact_provenance)) {
    fail(`${stormId}.impact_provenance is required.`);
  } else {
    if (impact.impact_provenance.source !== 'Wikipedia infobox') fail(`${stormId}.impact_provenance.source must be Wikipedia infobox.`);
    if (impact.impact_provenance.scraper !== 'scripts/scrape_impacts.py') fail(`${stormId}.impact_provenance.scraper must name scripts/scrape_impacts.py.`);
    if (!validIsoDate(impact.impact_provenance.parsed_at_utc)) fail(`${stormId}.impact_provenance.parsed_at_utc must be an ISO timestamp.`);
  }

  if (impact.deaths && impact.deaths_total == null) fail(`${stormId}: deaths text is present but deaths_total is missing.`);
  if (impact.deaths_total != null) {
    if (!validNonNegativeInteger(impact.deaths_total)) fail(`${stormId}.deaths_total must be a non-negative integer.`);
    if (!validNonNegativeInteger(impact.deaths_min)) fail(`${stormId}.deaths_min must be a non-negative integer.`);
    if (impact.deaths_max != null && !validNonNegativeInteger(impact.deaths_max)) fail(`${stormId}.deaths_max must be a non-negative integer or null.`);
    if (validNonNegativeInteger(impact.deaths_min) && impact.deaths_min > impact.deaths_total) {
      fail(`${stormId}.deaths_min must be <= deaths_total.`);
    }
    if (validNonNegativeInteger(impact.deaths_max) && impact.deaths_max < impact.deaths_min) {
      fail(`${stormId}.deaths_max must be >= deaths_min.`);
    }
    if (typeof impact.deaths_qualifier !== 'string' || !impact.deaths_qualifier) {
      fail(`${stormId}.deaths_qualifier is required when deaths_total is present.`);
    }
  }

  if (impact.damages && impact.damage_millions_usd == null) fail(`${stormId}: damages text is present but damage_millions_usd is missing.`);
  if (impact.damage_millions_usd != null || impact.damage_usd_nominal != null) {
    assertImpactNumber(impact.damage_millions_usd, `${stormId}.damage_millions_usd`);
    if (!validNonNegativeInteger(impact.damage_usd_nominal)) fail(`${stormId}.damage_usd_nominal must be a non-negative integer.`);
    if (isFiniteNumber(impact.damage_millions_usd) && validNonNegativeInteger(impact.damage_usd_nominal)) {
      const expectedUsd = Math.round(impact.damage_millions_usd * 1_000_000);
      if (Math.abs(expectedUsd - impact.damage_usd_nominal) > 1) {
        fail(`${stormId}.damage_usd_nominal does not match damage_millions_usd.`);
      }
    }
    if (typeof impact.damage_source_units !== 'string' || !impact.damage_source_units) {
      fail(`${stormId}.damage_source_units is required when damage is present.`);
    }
    if (typeof impact.damage_qualifier !== 'string' || !impact.damage_qualifier) {
      fail(`${stormId}.damage_qualifier is required when damage is present.`);
    }
    if (impact.damage_usd_min != null || impact.damage_usd_max != null) {
      if (!validNonNegativeInteger(impact.damage_usd_min)) fail(`${stormId}.damage_usd_min must be a non-negative integer.`);
      if (!validNonNegativeInteger(impact.damage_usd_max)) fail(`${stormId}.damage_usd_max must be a non-negative integer.`);
      if (validNonNegativeInteger(impact.damage_usd_min) && validNonNegativeInteger(impact.damage_usd_max)) {
        if (impact.damage_usd_min > impact.damage_usd_nominal || impact.damage_usd_nominal > impact.damage_usd_max) {
          fail(`${stormId}.damage_usd_nominal must fall inside its damage range.`);
        }
      }
    }
    if (impact.damage_qualifier === 'range_high' && (impact.damage_usd_min == null || impact.damage_usd_max == null)) {
      fail(`${stormId}: range_high damage requires damage_usd_min and damage_usd_max.`);
    }
  }
}

const impactRowCount = Object.keys(impacts).filter(key => key !== '_meta').length;
if (metadata.coverage?.impact_row_count !== impactRowCount) {
  fail(`metadata.coverage.impact_row_count must match impacts.json (${impactRowCount}).`);
}

for (const [index, entry] of glossary.entries()) {
  if (!isObject(entry)) {
    fail(`glossary[${index}]: row must be an object.`);
    continue;
  }
  if (typeof entry.term !== 'string' || !entry.term.trim()) fail(`glossary[${index}]: term is required.`);
  if (entry.language !== 'en') fail(`glossary[${index}]: language must declare the English source as "en".`);
  if (typeof entry.definition !== 'string' || !entry.definition.trim()) fail(`glossary[${index}]: definition is required.`);
}

if (stormEvents.schema_version !== 1) fail('storm-events.schema_version must be 1.');
if (!validIsoDate(stormEvents.generated_at_utc)) fail('storm-events.generated_at_utc must be an ISO timestamp.');
if (!isObject(stormEvents.source)) fail('storm-events.source must be an object.');
if (!isObject(stormEvents.methodology)) fail('storm-events.methodology must be an object.');
if (!isObject(stormEvents.storms)) {
  fail('storm-events.storms must be an object.');
} else {
  for (const [stormId, record] of Object.entries(stormEvents.storms)) {
    if (!stormsById.has(stormId)) fail(`storm-events references unknown storm id ${stormId}.`);
    if (!isObject(record)) {
      fail(`storm-events.${stormId} must be an object.`);
      continue;
    }
    if (!validNonNegativeInteger(record.tornado_count)) fail(`storm-events.${stormId}.tornado_count must be a non-negative integer.`);
    if (!validNonNegativeInteger(record.hail_count)) fail(`storm-events.${stormId}.hail_count must be a non-negative integer.`);
    if (!Array.isArray(record.states) || record.states.some(state => typeof state !== 'string' || !state)) {
      fail(`storm-events.${stormId}.states must be a non-empty string array.`);
    }
    if (!isObject(record.state_counts)) fail(`storm-events.${stormId}.state_counts must be an object.`);
    if (!Array.isArray(record.sample_events)) fail(`storm-events.${stormId}.sample_events must be an array.`);
    if (record.max_hail_in != null && (!isFiniteNumber(record.max_hail_in) || record.max_hail_in <= 0)) {
      fail(`storm-events.${stormId}.max_hail_in must be a positive number when present.`);
    }
    if (record.strongest_tornado_scale != null && typeof record.strongest_tornado_scale !== 'string') {
      fail(`storm-events.${stormId}.strongest_tornado_scale must be a string when present.`);
    }
  }
}

if (errors.length) {
  printErrorsAndExit();
}

console.log(`data ok (${storms.length} storms, ${landfalls.length} landfalls, ${Object.keys(impacts).length} impact rows)`);

function printErrorsAndExit() {
  console.error(`Data validation failed with ${errors.length} issue${errors.length === 1 ? '' : 's'}:`);
  for (const error of errors.slice(0, 100)) console.error(`- ${error}`);
  if (errors.length > 100) console.error(`- ...and ${errors.length - 100} more`);
  process.exit(1);
}
