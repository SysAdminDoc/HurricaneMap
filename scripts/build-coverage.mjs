import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function buildCoverage({ root: base = root } = {}) {
  const readJson = async relative => JSON.parse(await readFile(path.join(base, relative), 'utf8'));
  const [metadata, manifest, storms, landfalls, advisories, radar, hwm, aoml, impacts, billions, enso, outlook, forecastSkill, stormEvents, rainfall, tideStations, boundaries, glossary] = await Promise.all([
    readJson('data/metadata.json'),
    readJson('data/release-manifest.json'),
    readJson('data/storms.json'),
    readJson('data/landfalls.json'),
    readJson('data/advisories.json'),
    readJson('data/radar/manifest.json'),
    readJson('data/surge-obs/index.json'),
    readJson('data/aoml-landfalls.json'),
    readJson('data/impacts.json'),
    readJson('data/billions.json'),
    readJson('data/enso.json'),
    readJson('data/outlook.json'),
    readJson('data/forecast-skill.json'),
    readJson('data/storm-events.json'),
    readJson('data/rainfall.json'),
    readJson('data/tide-stations.json'),
    readJson('data/us-states.geojson'),
    readJson('data/glossary.json'),
  ]);
  const datasetById = new Map(metadata.datasets.map(dataset => [dataset.id, dataset]));
  const artifactByPath = new Map(manifest.artifacts.map(artifact => [artifact.path, artifact]));
  const stormsById = new Map(storms.map(storm => [storm.id, storm]));
  const idsFromObject = value => Object.keys(value).filter(key => !key.startsWith('_'));
  const yearRange = values => {
    const years = values.map(Number).filter(Number.isInteger);
    return years.length ? [Math.min(...years), Math.max(...years)] : null;
  };
  const yearRangeFromIds = ids => yearRange(ids.map(id => String(id).slice(-4)));
  const basinsFromIds = ids => [...new Set(ids.map(id => String(id).slice(0, 2)).filter(basin => ['AL', 'EP'].includes(basin)))].sort();
  const sourceFromArtifact = (name, relative, url = null, revisionDate = null, basin = null) => {
    const artifact = artifactByPath.get(relative);
    return {
      name,
      url: url || artifact?.source_url || 'https://www.nhc.noaa.gov/data/hurdat/',
      revision_date: revisionDate || artifact?.source_date || metadata.generated_at_utc.slice(0, 10),
      ...(basin ? { basin } : {}),
    };
  };
  const source = (name, url, revisionDate, basin = null) => ({
    name,
    url,
    revision_date: revisionDate || metadata.generated_at_utc.slice(0, 10),
    ...(basin ? { basin } : {}),
  });
  const dataset = (id, {
    sources,
    basins = [],
    year_range = null,
    value_status = 'final',
    availability,
    distribution = ['core', 'full'],
    notes = [],
  }) => {
    const definition = datasetById.get(id);
    if (!definition) throw new Error(`metadata is missing coverage dataset ${id}`);
    return {
      id,
      label: definition.label,
      paths: definition.paths,
      sources,
      basins,
      year_range,
      end_date: definition.end_date,
      lifecycle_status: definition.status,
      value_status,
      availability,
      distribution,
      notes,
    };
  };
  const availability = (overrides = {}) => ({
    runnable: true,
    records: null,
    storms: null,
    frames: null,
    advisories: null,
    marks: null,
    detail: 'Availability is not measured for this dataset.',
    ...overrides,
  });
  const radarFrames = Object.entries(radar).flatMap(([stormId, record]) => Object.keys(record.frames || {}).map(stamp => ({ stormId, stamp, year: Number(stamp.slice(0, 4)) })));
  const radarStormIds = [...new Set(radarFrames.map(frame => frame.stormId))];
  const advisoryStormIds = Object.keys(advisories.storms || {});
  const hwmStormIds = Object.keys(hwm);
  const impactStormIds = idsFromObject(impacts);
  const billionsStormIds = idsFromObject(billions);
  const stormEventIds = Object.keys(stormEvents.storms || {});
  const rainfallStormIds = idsFromObject(rainfall);
  const hwmMarks = Object.values(hwm).reduce((sum, entry) => sum + Number(entry.count || 0), 0);
  const coverage = {
    schema_version: 1,
    generated_at_utc: metadata.generated_at_utc,
    source_commit: metadata.generator.source_commit,
    catalog: {
      basins: metadata.coverage.basins,
      year_range: metadata.coverage.year_range,
      storm_count: metadata.coverage.storm_count,
      landfall_event_count: metadata.coverage.landfall_event_count,
      hurricane_landfall_count: metadata.coverage.hurricane_landfall_count,
    },
    datasets: [
      dataset('hurdat2', {
        sources: metadata.sources.map(item => ({ name: `${item.filename} (${item.basin})`, url: item.source_url, revision_date: item.source_date, basin: item.basin })),
        basins: metadata.coverage.basins,
        year_range: metadata.coverage.year_range,
        availability: availability({
          storms: metadata.coverage.storm_count,
          records: metadata.coverage.landfall_event_count,
          detail: `${metadata.coverage.storm_count} final best-track storms; ${metadata.coverage.landfall_event_count} landfall events, including ${landfalls.filter(landfall => landfall.inferred).length} inferred events.`,
        }),
        notes: ['Best-track values are final HURDAT2 records; inferred landfalls remain explicitly tagged.'],
      }),
      dataset('aoml-landfalls', {
        sources: [source('AOML detailed U.S. hurricane landfall table', aoml.source.url, aoml.source.source_date, 'AL')],
        basins: basinsFromIds(aoml.records.map(record => record.storm_id)),
        year_range: [aoml.source.coverage_year_ranges[0][0], aoml.source.coverage_year_ranges.at(-1)[1]],
        availability: availability({ records: aoml.records.length, detail: `${aoml.records.length} normalized reference rows; ${aoml.records.filter(record => record.direct_landfall).length} direct-landfall rows used for scoring.` }),
        notes: ['Independent reference table; marker-qualified rows outside direct landfall remain visible but are excluded from the direct score.'],
      }),
      dataset('storm-impacts', {
        sources: [sourceFromArtifact('Wikipedia storm impact records', 'data/impacts.json', 'https://en.wikipedia.org/', '2026-07-25')],
        basins: basinsFromIds(impactStormIds),
        year_range: yearRangeFromIds(impactStormIds),
        value_status: 'inferred',
        availability: availability({ records: impactStormIds.length, storms: impactStormIds.length, detail: `${impactStormIds.length} storms have normalized community-source impact records; missing storms are unavailable, not zero.` }),
        notes: ['Parsed community-source values carry field-level confidence; some legacy damage units are inferred.'],
      }),
      dataset('ncei-billions', {
        sources: [source('NOAA NCEI Billion-Dollar Weather and Climate Disasters', 'https://www.ncei.noaa.gov/access/billions/', '2025-05-08')],
        basins: basinsFromIds(billionsStormIds),
        year_range: yearRangeFromIds(billionsStormIds),
        value_status: 'closed',
        availability: availability({ runnable: false, records: billionsStormIds.length, storms: billionsStormIds.length, detail: `${billionsStormIds.length} matched storm records; series closed after 2024-12-31.` }),
        notes: ['NOAA retired the product on 2025-05-08; no future rows are accepted.'],
      }),
      dataset('enso', {
        sources: [source('NOAA CPC Oceanic Niño Index', enso._meta.url, enso._meta.issued)],
        year_range: yearRange(Object.keys(enso).filter(key => /^\d{4}$/.test(key))),
        availability: availability({ records: Object.keys(enso).filter(key => /^\d{4}$/.test(key)).length, detail: `${Object.keys(enso).filter(key => /^\d{4}$/.test(key)).length} annual snapshot records; valid through ${enso._meta.valid_until}.` }),
        notes: ['Snapshot values are not a live feed; validity is bounded by the published date.'],
      }),
      dataset('seasonal-outlook', {
        sources: outlook.sources.map(item => source(item.agency, item.url, item.issued, 'AL')),
        basins: ['AL'],
        year_range: [outlook.season, outlook.season],
        value_status: 'operational',
        availability: availability({ records: outlook.sources.length, detail: `${outlook.sources.length} seasonal outlook sources for ${outlook.season}; valid through ${outlook.valid_until}.` }),
        notes: ['This is a dated forecast snapshot, not a historical best-track value.'],
      }),
      dataset('forecast-skill', {
        sources: [source('NOAA/NHC official forecast skill summary', forecastSkill.sources.methodology, forecastSkill.sourceUpdated), source('NHC five-year averages', forecastSkill.sources.summary, forecastSkill.sourceUpdated)],
        basins: Object.keys(forecastSkill.basins),
        year_range: [forecastSkill.period.startYear, forecastSkill.period.endYear],
        availability: availability({ records: Object.values(forecastSkill.basins).reduce((sum, basin) => sum + basin.rows.length, 0), detail: `Post-season verification rows for ${forecastSkill.period.label}; model ${forecastSkill.model}.` }),
        notes: ['Forecast skill is a verified summary and does not represent a forecast for a selected storm.'],
      }),
      dataset('advisory-replay', {
        sources: [source('NHC archived ATCF advisories', advisories.sources.adeckArchive, metadata.generated_at_utc.slice(0, 10), 'AL'), source('NHC advisory discussions', advisories.sources.productArchive, metadata.generated_at_utc.slice(0, 10), 'AL')],
        basins: basinsFromIds(advisoryStormIds),
        year_range: [advisories.era.startYear, advisories.era.endYear],
        value_status: 'operational',
        availability: availability({ storms: advisories.totals.storms, advisories: advisories.totals.advisories, detail: `${advisories.totals.advisories} preliminary operational advisories across ${advisories.totals.storms} storms; exact-time HURDAT2 verification only.` }),
        notes: ['Forecast positions and winds are operational values as issued; final best-track comparisons are separate.'],
      }),
      dataset('storm-events', {
        sources: [source('NOAA/NCEI Storm Events Database', stormEvents.source.base_url, stormEvents.generated_at_utc.slice(0, 10))],
        basins: basinsFromIds(stormEventIds),
        year_range: yearRangeFromIds(stormEventIds),
        availability: availability({ storms: stormEventIds.length, records: stormEventIds.length, detail: `${stormEventIds.length} storm coincidence records from the bundled NOAA/NCEI extract.` }),
        notes: ['Coincidence records are not a complete damage or impact census.'],
      }),
      dataset('rainfall', {
        sources: [sourceFromArtifact('NOAA tropical cyclone rainfall reports', 'data/rainfall.json', 'https://www.wpc.ncep.noaa.gov/tropical/rain/tcrainfall.html', '2026-06-20')],
        basins: basinsFromIds(rainfallStormIds),
        year_range: yearRangeFromIds(rainfallStormIds),
        availability: availability({ storms: rainfallStormIds.length, records: rainfallStormIds.length, detail: `${rainfallStormIds.length} storms have bundled tropical-cyclone rainfall summaries.` }),
        notes: ['Missing storm records are unavailable, not zero rainfall.'],
      }),
      dataset('radar-archive', {
        sources: [source('Iowa State IEM NEXRAD mosaic archive', 'https://mesonet.agron.iastate.edu/docs/nexrad_mosaic/', artifactByPath.get('data/radar/manifest.json')?.source_date || metadata.generated_at_utc.slice(0, 10))],
        basins: basinsFromIds(radarStormIds),
        year_range: yearRange(radarFrames.map(frame => frame.year)),
        availability: availability({ storms: radarStormIds.length, frames: radarFrames.length, detail: `${radarFrames.length} archived frames across ${radarStormIds.length} storms; core ships metadata and full ships PNG frames.` }),
        notes: ['Only in-coverage frames are archived; missing local frames may use the online IEM fallback when available.'],
      }),
      dataset('hwm', {
        sources: [source('USGS Short-Term Network observed high-water marks', 'https://stn.wim.usgs.gov/STNServices/', artifactByPath.get('data/surge-obs/index.json')?.source_date || metadata.generated_at_utc.slice(0, 10))],
        basins: basinsFromIds(hwmStormIds),
        year_range: yearRange(hwmStormIds.map(id => hwm[id].event.match(/\b(19|20)\d{2}\b/)?.[0])),
        availability: availability({ storms: hwmStormIds.length, marks: hwmMarks, detail: `${hwmMarks} observed marks across ${hwmStormIds.length} matched storm events; absent marks are unavailable.` }),
        notes: ['Observed elevations are survey measurements used beside the modeled surge product.'],
      }),
      dataset('tide-stations', {
        sources: [source('NOAA CO-OPS tide station index', 'https://tidesandcurrents.noaa.gov/', artifactByPath.get('data/tide-stations.json')?.source_date || metadata.generated_at_utc.slice(0, 10))],
        availability: availability({ records: tideStations.length, detail: `${tideStations.length} stations are indexed; water levels are fetched on demand from NOAA CO-OPS.` }),
        notes: ['The station index is bundled; observed and predicted water levels are operational requests, not a static archive.'],
      }),
      dataset('storm-boundaries', {
        sources: [source('U.S. Census state boundary polygons', 'https://www.census.gov/geographies/mapping-files/time-series/geo/carto-boundary-file.html', artifactByPath.get('data/us-states.geojson')?.source_date || metadata.generated_at_utc.slice(0, 10))],
        availability: availability({ records: boundaries.features.length, detail: `${boundaries.features.length} state and territory boundary features are bundled for spatial classification.` }),
        notes: ['Boundaries support inferred-landfall and spatial-search geometry; they are not storm observations.'],
      }),
      dataset('glossary', {
        sources: [source('HurricaneMap glossary', 'https://github.com/SysAdminDoc/HurricaneMap', artifactByPath.get('data/glossary.json')?.source_date || metadata.generated_at_utc.slice(0, 10))],
        availability: availability({ records: glossary.length, detail: `${glossary.length} application glossary entries are bundled.` }),
        notes: ['Definitions are application-maintained explanatory text.'],
      }),
    ],
  };
  return coverage;
}

export async function writeCoverage({ root: base = root } = {}) {
  const coverage = await buildCoverage({ root: base });
  await writeFile(path.join(base, 'data/coverage.json'), `${JSON.stringify(coverage, null, 2)}\n`, 'utf8');
  return coverage;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const coverage = await writeCoverage();
  console.log(`coverage generated (${coverage.datasets.length} datasets, ${coverage.catalog.storm_count} storms, ${coverage.datasets.find(dataset => dataset.id === 'radar-archive').availability.frames} radar frames)`);
}
