import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { DATA_SCHEMA_VERSION } from '../src/schema-contract.js';
import { validateClosedSeriesRows, validateDatasetStatuses } from './dataset-status.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
let aomlGateSummary = null;

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

function validSha256(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

async function sha256File(relativePath) {
  const bytes = await readFile(path.join(root, relativePath));
  return {
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
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

const NON_CONTINENTAL_STATES = new Set([
  'Alaska', 'American Samoa', 'Guam', 'Hawaii', 'Northern Mariana Islands',
  'Puerto Rico', 'U.S. Virgin Islands',
]);
const AOML_START_YEAR = 1983;
const AOML_END_YEAR = 1990;
const AOML_MIN_CATEGORY = 1;
const AOML_MATCH_TIME_HOURS = 12;
const AOML_MATCH_DISTANCE_KM = 125;

function haversineKm(a, b) {
  const toRadians = value => value * Math.PI / 180;
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const dLat = lat2 - lat1;
  const dLon = toRadians(b.lon) - toRadians(a.lon);
  const term = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(term)));
}

function matchAomlRecords(truth, predictions) {
  const pairs = [];
  truth.forEach((truthRecord, truthIndex) => {
    predictions.forEach((prediction, predictionIndex) => {
      if (prediction.storm_id !== truthRecord.storm_id) return;
      const timeHours = Math.abs(Date.parse(prediction.t) - Date.parse(truthRecord.t)) / (3600 * 1000);
      const distanceKm = haversineKm(truthRecord, prediction);
      if (timeHours <= AOML_MATCH_TIME_HOURS && distanceKm <= AOML_MATCH_DISTANCE_KM) {
        pairs.push({ timeHours, distanceKm, truthIndex, predictionIndex });
      }
    });
  });
  pairs.sort((a, b) => a.timeHours - b.timeHours || a.distanceKm - b.distanceKm);
  const usedTruth = new Set();
  const usedPredictions = new Set();
  let matched = 0;
  for (const pair of pairs) {
    if (usedTruth.has(pair.truthIndex) || usedPredictions.has(pair.predictionIndex)) continue;
    usedTruth.add(pair.truthIndex);
    usedPredictions.add(pair.predictionIndex);
    matched += 1;
  }
  return matched;
}

function ratio(numerator, denominator) {
  return denominator ? Math.round((numerator / denominator) * 1_000_000) / 1_000_000 : null;
}

const [landfalls, storms, stats, impacts, glossary, metadata, stormEvents, billions, forecastSkill, sourceLock, aoml] = await Promise.all([
  readJson('data/landfalls.json'),
  readJson('data/storms.json'),
  readJson('data/stats.json'),
  readJson('data/impacts.json'),
  readJson('data/glossary.json'),
  readJson('data/metadata.json'),
  readJson('data/storm-events.json'),
  readJson('data/billions.json'),
  readJson('data/forecast-skill.json'),
  readJson('data/hurdat2-sources.json'),
  readJson('data/aoml-landfalls.json'),
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
if (!isObject(forecastSkill)) fail('data/forecast-skill.json must contain an object.');
if (!isObject(sourceLock)) fail('data/hurdat2-sources.json must contain an object.');
if (!isObject(aoml)) fail('data/aoml-landfalls.json must contain an object.');

if (errors.length) {
  printErrorsAndExit();
}

if (forecastSkill.schema !== 1) fail('forecast-skill.schema must be 1.');
if (forecastSkill.model !== 'OFCL') fail('forecast-skill.model must identify official OFCL forecasts.');
if (forecastSkill.period?.startYear !== 2021 || forecastSkill.period?.endYear !== 2025) {
  fail('forecast-skill period must be the published 2021-2025 sample.');
}
if (!validIsoDate(forecastSkill.bestTrackAsOf)) fail('forecast-skill.bestTrackAsOf must be an absolute ISO date.');
for (const sourceKey of ['methodology', 'summary', 'format']) {
  if (!/^https:\/\/www\.nhc\.noaa\.gov\//.test(forecastSkill.sources?.[sourceKey] || '')) {
    fail(`forecast-skill.sources.${sourceKey} must be an official NHC URL.`);
  }
}
const skillLeads = [0, 12, 24, 36, 48, 60, 72, 96, 120];
for (const basinId of ['AL', 'EP']) {
  const basin = forecastSkill.basins?.[basinId];
  if (!isObject(basin)) {
    fail(`forecast-skill.basins.${basinId} is required.`);
    continue;
  }
  if (!/^https:\/\/www\.nhc\.noaa\.gov\/verification\/errors\//.test(basin.url || '')) {
    fail(`forecast-skill ${basinId} must link its official individual error file.`);
  }
  if (!/^[a-f0-9]{64}$/.test(basin.sourceSubsetSha256 || '')) {
    fail(`forecast-skill ${basinId} must record a SHA-256 for its source subset.`);
  }
  if (!Array.isArray(basin.rows) || JSON.stringify(basin.rows.map(row => row.leadHours)) !== JSON.stringify(skillLeads)) {
    fail(`forecast-skill ${basinId} must contain the complete official lead-time sequence.`);
    continue;
  }
  for (const row of basin.rows) {
    if (!isFiniteNumber(row.trackErrorNmi) || row.trackErrorNmi < 0) fail(`forecast-skill ${basinId} ${row.leadHours} h track error is invalid.`);
    if (!isFiniteNumber(row.intensityErrorKt) || row.intensityErrorKt < 0) fail(`forecast-skill ${basinId} ${row.leadHours} h intensity error is invalid.`);
    if (!Number.isInteger(row.trackSampleSize) || row.trackSampleSize < 1) fail(`forecast-skill ${basinId} ${row.leadHours} h track sample is invalid.`);
    if (!Number.isInteger(row.intensitySampleSize) || row.intensitySampleSize < 1) fail(`forecast-skill ${basinId} ${row.leadHours} h intensity sample is invalid.`);
  }
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

if (metadata.schema_version !== DATA_SCHEMA_VERSION) {
  fail(`metadata.schema_version must be ${DATA_SCHEMA_VERSION}.`);
}
if (!validIsoDate(metadata.generated_at_utc)) fail('metadata.generated_at_utc must be an ISO timestamp.');
const bundledDataPaths = new Set([
  'data/advisories.json', 'data/aoml-landfalls.json', 'data/aoml-us-landfalls.html',
  'data/billions.json', 'data/cone-radii.json', 'data/enso.json', 'data/forecast-skill.json',
  'data/glossary.json', 'data/hurdat2-atlantic.txt', 'data/hurdat2-nepac.txt',
  'data/hurdat2-sources.json', 'data/impacts.json', 'data/landfalls.json',
  'data/ncei-billions-1980-2024.csv', 'data/outlook.json', 'data/rainfall.json',
  'data/stats.json', 'data/storm-events.json', 'data/storms.json', 'data/storms.json.gz',
  'data/tide-stations.json', 'data/us-states.geojson', 'data/radar/manifest.json',
  'data/surge-obs/index.json',
]);
for (const error of validateDatasetStatuses(metadata.datasets, bundledDataPaths)) fail(error);
const nceiDataset = metadata.datasets?.find(dataset => dataset.id === 'ncei-billions');
for (const error of validateClosedSeriesRows(nceiDataset, billions, { idLabel: 'billions row' })) fail(error);
if (!isObject(metadata.generator)) {
  fail('metadata.generator must contain generator details.');
} else {
  if (typeof metadata.generator.name !== 'string' || !metadata.generator.name) fail('metadata.generator.name is required.');
  if (typeof metadata.generator.app_version !== 'string' || !metadata.generator.app_version) fail('metadata.generator.app_version is required.');
  if (!/^[a-f0-9]{40}$/.test(metadata.generator.source_commit || '')) fail('metadata.generator.source_commit must be a 40-character git revision.');
  if (metadata.generator.source_manifest !== 'data/hurdat2-sources.json') fail('metadata.generator.source_manifest must identify data/hurdat2-sources.json.');
  if (typeof metadata.generator.runtime !== 'string' || !metadata.generator.runtime) fail('metadata.generator.runtime is required.');
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
  const lockedSources = new Map(Array.isArray(sourceLock.sources) ? sourceLock.sources.map(source => [source.local_path, source]) : []);
  if (sourceLock.schema_version !== 1 || lockedSources.size !== 2) fail('data/hurdat2-sources.json must contain exactly two version 1 source entries.');
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
    if (!/^\d{4}-\d{2}-\d{2}$/.test(source.source_date || '')) fail(`${label}.source_date must be an absolute date.`);
    if (typeof source.source_file !== 'string' || !source.source_file.endsWith('.txt')) fail(`${label}.source_file is required.`);
    if (!/^https:\/\/www\.nhc\.noaa\.gov\/data\/hurdat\/hurdat2-.+\.txt$/.test(source.source_url || '')) fail(`${label}.source_url must be an official HTTPS HURDAT2 URL.`);
    if (!validSha256(source.sha256)) fail(`${label}.sha256 must be a SHA-256 digest.`);
    if (source.modified_utc !== `${source.source_date}T00:00:00Z`) fail(`${label}.modified_utc must be derived from source_date, not filesystem mtime.`);
    if (!Number.isInteger(source.storm_count) || source.storm_count <= 0) fail(`${label}.storm_count must be positive.`);
    if (!Array.isArray(source.storm_year_range) || source.storm_year_range.length !== 2) {
      fail(`${label}.storm_year_range must be [minYear, maxYear].`);
    } else if (!source.storm_year_range.every(Number.isInteger)) {
      fail(`${label}.storm_year_range values must be integers.`);
    }
    const locked = lockedSources.get(source.path);
    if (!locked) {
      fail(`${label}.path is missing from data/hurdat2-sources.json.`);
    } else {
      for (const field of ['basin', 'source_file', 'source_url', 'source_date', 'bytes', 'sha256']) {
        const metadataField = field === 'bytes' ? source.size_bytes : source[field];
        if (metadataField !== locked[field]) fail(`${label}.${field} does not match data/hurdat2-sources.json.`);
      }
      try {
        const digest = await sha256File(source.path);
        if (digest.bytes !== source.size_bytes || digest.sha256 !== source.sha256) {
          fail(`${label} does not match the bytes recorded in its source lock.`);
        }
      } catch (error) {
        fail(`${label}.path could not be read: ${error.message}`);
      }
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
    if (output.modified_utc !== metadata.generated_at_utc) fail(`metadata.outputs.${key}.modified_utc must match metadata.generated_at_utc.`);
    if (!validSha256(output.sha256)) fail(`metadata.outputs.${key}.sha256 must be a SHA-256 digest.`);
    try {
      const digest = await sha256File(output.path);
      if (digest.bytes !== output.size_bytes || digest.sha256 !== output.sha256) {
        fail(`metadata.outputs.${key} does not match its generated file bytes.`);
      }
    } catch (error) {
      fail(`metadata.outputs.${key}.path could not be read: ${error.message}`);
    }
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

if (aoml.schema_version !== 1) fail('aoml-landfalls.schema_version must be 1.');
if (!validIsoDate(aoml.generated_at_utc)) fail('aoml-landfalls.generated_at_utc must be an ISO timestamp.');
if (!isObject(aoml.source)) {
  fail('aoml-landfalls.source must be an object.');
} else {
  if (aoml.source.url !== 'https://www.aoml.noaa.gov/hrd/hurdat/UShurrs_detailed.html') {
    fail('aoml-landfalls.source.url must identify the current AOML detailed table.');
  }
  if (aoml.source.local_path !== 'data/aoml-us-landfalls.html') fail('aoml-landfalls.source.local_path must identify the checked-in HTML source.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(aoml.source.source_date || '')) fail('aoml-landfalls.source.source_date must be an absolute date.');
  if (typeof aoml.source.revision !== 'string' || !aoml.source.revision) fail('aoml-landfalls.source.revision is required.');
  if (aoml.source.encoding !== 'ISO-8859-1') fail('aoml-landfalls.source.encoding must preserve the page declaration.');
  if (!Number.isInteger(aoml.source.bytes) || aoml.source.bytes <= 0) fail('aoml-landfalls.source.bytes must be positive.');
  if (!validSha256(aoml.source.sha256)) fail('aoml-landfalls.source.sha256 must be a SHA-256 digest.');
  if (!Array.isArray(aoml.source.coverage_year_ranges) || aoml.source.coverage_year_ranges.length !== 2) {
    fail('aoml-landfalls.source.coverage_year_ranges must contain two declared year ranges.');
  }
  try {
    const digest = await sha256File(aoml.source.local_path);
    if (digest.bytes !== aoml.source.bytes || digest.sha256 !== aoml.source.sha256) {
      fail('aoml-landfalls.source does not match the checked-in HTML source bytes.');
    }
  } catch (error) {
    fail(`aoml-landfalls.source.local_path could not be read: ${error.message}`);
  }
}

if (!isObject(aoml.methodology)) fail('aoml-landfalls.methodology must be an object.');
if (!Array.isArray(aoml.records) || aoml.records.length === 0) {
  fail('aoml-landfalls.records must be a non-empty array.');
} else {
  const recordIds = new Set();
  for (const [index, record] of aoml.records.entries()) {
    const label = `aoml-landfalls.records[${index}]`;
    if (!isObject(record)) {
      fail(`${label} must be an object.`);
      continue;
    }
    if (typeof record.id !== 'string' || !record.id) fail(`${label}.id is required.`);
    if (recordIds.has(record.id)) fail(`${label}.id is duplicated.`);
    recordIds.add(record.id);
    if (!/^AL\d{6}$/.test(record.storm_id || '')) fail(`${label}.storm_id must be an Atlantic HURDAT2 identifier.`);
    if (!Number.isInteger(record.storm_number) || record.storm_number < 1 || record.storm_number > 99) fail(`${label}.storm_number is invalid.`);
    if (!Number.isInteger(record.year) || record.year < 1800 || record.year > 2100) fail(`${label}.year is invalid.`);
    if (record.storm_id !== `AL${String(record.storm_number).padStart(2, '0')}${record.year}`) fail(`${label}.storm_id does not match storm_number/year.`);
    if (!validOptionalString(record.name)) fail(`${label}.name must be a string or null.`);
    if (!validIsoDate(record.t)) fail(`${label}.t must be an ISO timestamp.`);
    assertNumberInRange(record.lat, -90, 90, `${label}.lat`);
    assertNumberInRange(record.lon, -180, 180, `${label}.lon`);
    for (const field of ['max_wind_kt', 'rmw_nm', 'central_pressure_mb', 'oci_mb', 'size_nm']) {
      if (record[field] != null && (!Number.isInteger(record[field]) || record[field] < 0)) fail(`${label}.${field} must be a non-negative integer or null.`);
    }
    if (record.category != null && !validCategory(record.category)) fail(`${label}.category must be -1..5 or null.`);
    if (typeof record.central_pressure_estimated !== 'boolean') fail(`${label}.central_pressure_estimated must be boolean.`);
    if (typeof record.states_raw !== 'string') fail(`${label}.states_raw must be a string.`);
    if (!Array.isArray(record.states_affected) || record.states_affected.some(state => typeof state !== 'string' || !state)) {
      fail(`${label}.states_affected must be a string array.`);
    }
    if (!Array.isArray(record.markers) || record.markers.some(marker => !['$', '#', '&', '%', '*'].includes(marker))) {
      fail(`${label}.markers contains an unsupported marker.`);
    }
    const expectedDirect = !record.markers?.some(marker => marker === '*' || marker === '#');
    if (record.direct_landfall !== expectedDirect) fail(`${label}.direct_landfall does not match its marker set.`);
  }
}

if (!isObject(aoml.validation)) {
  fail('aoml-landfalls.validation must be an object.');
} else {
  const truth = (aoml.records || []).filter(record => (
    record.year >= AOML_START_YEAR
    && record.year <= AOML_END_YEAR
    && record.direct_landfall
    && (record.category || 0) >= AOML_MIN_CATEGORY
  ));
  const predictions = (landfalls || []).filter(record => (
    record.year >= AOML_START_YEAR
    && record.year <= AOML_END_YEAR
    && record.category >= AOML_MIN_CATEGORY
    && !NON_CONTINENTAL_STATES.has(record.state)
  ));
  const inferred = (landfalls || []).filter(record => (
    record.year >= AOML_START_YEAR
    && record.year <= AOML_END_YEAR
    && record.inferred === true
  ));
  const inferredHurricane = inferred.filter(record => (
    record.category >= AOML_MIN_CATEGORY && !NON_CONTINENTAL_STATES.has(record.state)
  ));
  const matched = matchAomlRecords(truth, predictions);
  const inferredMatched = matchAomlRecords(truth, inferredHurricane);
  const expectedScope = {
    start_year: AOML_START_YEAR,
    end_year: AOML_END_YEAR,
    geography: 'continental U.S.',
    minimum_category: AOML_MIN_CATEGORY,
    matching: { storm_id: 'exact', time_window_hours: AOML_MATCH_TIME_HOURS, distance_km: AOML_MATCH_DISTANCE_KM },
  };
  const expectedDetected = {
    record_count: predictions.length,
    matched_count: matched,
    precision: ratio(matched, predictions.length),
    recall: ratio(matched, truth.length),
  };
  const expectedInferred = {
    candidate_count: inferred.length,
    hurricane_strength_candidate_count: inferredHurricane.length,
    matched_count: inferredMatched,
    precision: ratio(inferredMatched, inferredHurricane.length),
    recall: ratio(inferredMatched, truth.length),
  };
  if (JSON.stringify(aoml.validation.scope) !== JSON.stringify(expectedScope)) fail('aoml validation scope does not match the build gate.');
  if (aoml.validation.ground_truth?.record_count !== truth.length || aoml.validation.ground_truth?.direct_landfall_count !== truth.length) {
    fail('aoml validation ground_truth counts do not match the source rows.');
  }
  if (JSON.stringify(aoml.validation.detected) !== JSON.stringify(expectedDetected)) fail('aoml validation detected metrics are stale or incorrect.');
  for (const field of ['candidate_count', 'hurricane_strength_candidate_count', 'matched_count', 'precision', 'recall']) {
    if (aoml.validation.inferred?.[field] !== expectedInferred[field]) fail(`aoml validation inferred.${field} is stale or incorrect.`);
  }
  aomlGateSummary = { truth, predictions, matched, inferred, inferredHurricane, inferredMatched };
}

for (const [stormId, event] of Object.entries(billions)) {
  if (stormId === '_meta') {
    if (!isObject(event) || typeof event.source !== 'string') fail('billions.json _meta must record its source.');
    if (event.dataset_id !== 'ncei-billions' || event.status !== 'closed' || event.end_date !== nceiDataset?.end_date) {
      fail('billions.json _meta must identify the closed ncei-billions dataset and its end_date.');
    }
    const eventCitation = event.retirement_citation || {};
    const metadataCitation = nceiDataset?.retirement_citation || {};
    if (eventCitation.title !== metadataCitation.title || eventCitation.date !== metadataCitation.date || eventCitation.url !== metadataCitation.url) {
      fail('billions.json _meta retirement_citation must match metadata.datasets ncei-billions.');
    }
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
  if (!['high', 'medium', 'low'].includes(impact.impact_confidence)) {
    fail(`${stormId}.impact_confidence must be high, medium, or low.`);
  }
  if (typeof impact.impact_confidence_reason !== 'string' || !impact.impact_confidence_reason) {
    fail(`${stormId}.impact_confidence_reason is required.`);
  }
  if (!impact.deaths && !impact.damages) fail(`${stormId} must retain deaths or damages raw source text.`);
  if (!isObject(impact.impact_provenance)) {
    fail(`${stormId}.impact_provenance is required.`);
  } else {
    if (impact.impact_provenance.source !== 'Wikipedia infobox') fail(`${stormId}.impact_provenance.source must be Wikipedia infobox.`);
    if (impact.impact_provenance.source_title !== impact.wiki_title) fail(`${stormId}.impact_provenance.source_title must match wiki_title.`);
    if (impact.impact_provenance.source_url !== impact.wiki_url) fail(`${stormId}.impact_provenance.source_url must match wiki_url.`);
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

  if (impact.damages && impact.damage_millions_usd == null) {
    if (impact.damage_qualifier !== 'unparsed' || impact.damage_source_units !== 'unknown') {
      fail(`${stormId}: non-numeric damages text must be marked unparsed with unknown units.`);
    }
  }
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

if (aomlGateSummary) {
  const truthCount = aomlGateSummary.truth.length;
  const detectedPrecision = ratio(aomlGateSummary.matched, aomlGateSummary.predictions.length);
  const detectedRecall = ratio(aomlGateSummary.matched, truthCount);
  const inferredPrecision = ratio(aomlGateSummary.inferredMatched, aomlGateSummary.inferredHurricane.length);
  const inferredRecall = ratio(aomlGateSummary.inferredMatched, truthCount);
  const formatMetric = (value, numerator, denominator) => value == null
    ? `not-defined (${numerator} candidates)`
    : `${(value * 100).toFixed(1)}% (${numerator}/${denominator})`;
  console.log(
    'AOML 1983-1990 ground-truth gate (continental, category >= 1): '
    + `precision=${formatMetric(detectedPrecision, aomlGateSummary.matched, aomlGateSummary.predictions.length)}, `
    + `recall=${formatMetric(detectedRecall, aomlGateSummary.matched, truthCount)}; `
    + `inferred hurricane candidates=${aomlGateSummary.inferredHurricane.length}, `
    + `precision=${formatMetric(inferredPrecision, aomlGateSummary.inferredMatched, aomlGateSummary.inferredHurricane.length)}, `
    + `recall=${formatMetric(inferredRecall, aomlGateSummary.inferredMatched, truthCount)}`,
  );
}

console.log(`data ok (${storms.length} storms, ${landfalls.length} landfalls, ${Object.keys(impacts).length} impact rows)`);

function printErrorsAndExit() {
  console.error(`Data validation failed with ${errors.length} issue${errors.length === 1 ? '' : 's'}:`);
  for (const error of errors.slice(0, 100)) console.error(`- ${error}`);
  if (errors.length > 100) console.error(`- ...and ${errors.length - 100} more`);
  process.exit(1);
}
