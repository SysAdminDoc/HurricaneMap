import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

function assertNumberInRange(value, min, max, label) {
  if (!isFiniteNumber(value) || value < min || value > max) {
    fail(`${label} must be a finite number in range ${min}..${max}`);
  }
}

const [landfalls, storms, stats, impacts, glossary] = await Promise.all([
  readJson('data/landfalls.json'),
  readJson('data/storms.json'),
  readJson('data/stats.json'),
  readJson('data/impacts.json'),
  readJson('data/glossary.json'),
]);

if (!Array.isArray(landfalls)) fail('data/landfalls.json must contain an array.');
if (!Array.isArray(storms)) fail('data/storms.json must contain an array.');
if (!isObject(stats)) fail('data/stats.json must contain an object.');
if (!isObject(impacts)) fail('data/impacts.json must contain an object.');
if (!Array.isArray(glossary)) fail('data/glossary.json must contain an array.');

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
      if (!isFiniteNumber(point.wind)) fail(`${label}.wind must be numeric.`);
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
  if (!isFiniteNumber(landfall.wind)) fail(`${label}: wind must be numeric.`);
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

for (const [state, count] of landfallCountsByState.entries()) {
  const stateStats = stats.by_state?.[state];
  if (!stateStats) {
    fail(`stats.by_state missing ${state}.`);
  } else if (stateStats.total !== count) {
    fail(`stats.by_state.${state}.total ${stateStats.total} does not match landfall count ${count}.`);
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

for (const stormId of Object.keys(impacts)) {
  if (!stormsById.has(stormId)) fail(`impacts.json references unknown storm id ${stormId}.`);
}

for (const [index, entry] of glossary.entries()) {
  if (!isObject(entry)) {
    fail(`glossary[${index}]: row must be an object.`);
    continue;
  }
  if (typeof entry.term !== 'string' || !entry.term.trim()) fail(`glossary[${index}]: term is required.`);
  if (typeof entry.definition !== 'string' || !entry.definition.trim()) fail(`glossary[${index}]: definition is required.`);
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
