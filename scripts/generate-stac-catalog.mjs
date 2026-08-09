import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const STAC_VERSION = '1.1.0';
export const STAC_SCHEMA_URLS = Object.freeze({
  catalog: 'https://schemas.stacspec.org/v1.1.0/catalog-spec/json-schema/catalog.json',
  collection: 'https://schemas.stacspec.org/v1.1.0/collection-spec/json-schema/collection.json',
  item: 'https://schemas.stacspec.org/v1.1.0/item-spec/json-schema/item.json',
});
export const STAC_FILE_EXTENSION = 'https://stac-extensions.github.io/file/v2.1.0/schema.json';
export const DISTRIBUTIONS = ['core', 'full'];
export const RADAR_REGIONS = {
  uscomp: { bounds: [[24, -126], [50, -66]], product: 'n0r' },
  hicomp: { bounds: [[15.44, -162.4], [24.44, -152.4]], product: 'n0q' },
  prcomp: { bounds: [[13.1, -71.07], [23.1, -61.07]], product: 'n0q' },
};

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG_PATH = 'data/stac/catalog.json';
const HURDAT2_COLLECTION_PATH = 'data/stac/collections/hurdat2.json';
const RADAR_COLLECTION_PATH = 'data/stac/collections/radar.json';
const HURDAT2_ITEM_PATH = 'data/stac/items/hurdat2.json';

export async function buildStacFiles({ root = ROOT } = {}) {
  const dataRoot = path.join(root, 'data');
  const releaseManifest = JSON.parse(await readFile(path.join(dataRoot, 'release-manifest.json'), 'utf8'));
  const releaseByPath = new Map(releaseManifest.artifacts.map(artifact => [artifact.path, artifact]));
  const radarManifest = JSON.parse(await readFile(path.join(dataRoot, 'radar/manifest.json'), 'utf8'));
  const storms = JSON.parse(await readFile(path.join(dataRoot, 'storms.json'), 'utf8'));
  const landfalls = JSON.parse(await readFile(path.join(dataRoot, 'landfalls.json'), 'utf8'));
  const files = new Map();
  const sourceCommit = releaseManifest.source_commit;
  const generatedAt = releaseManifest.generated_at_utc;

  const add = (relative, value) => {
    files.set(relative, `${JSON.stringify(value, null, 2)}\n`);
  };

  const asset = (target, from, options = {}) => {
    const record = releaseByPath.get(target);
    if (!record) throw new Error(`release manifest is missing STAC asset ${target}`);
    const distribution = options.distribution || DISTRIBUTIONS;
    return {
      href: relativeHref(from, target),
      title: options.title || path.posix.basename(target),
      type: options.type || mimeType(target),
      roles: options.roles || ['data'],
      'file:size': record.bytes,
      'file:checksum': `sha256:${record.sha256}`,
      'hurricanemap:source_url': record.source_url,
      'hurricanemap:source_date': record.source_date,
      'hurricanemap:license': options.license || 'public-domain',
      'hurricanemap:distribution': distribution,
    };
  };

  const trackPoints = storms.flatMap(storm => storm.track || []);
  const trackExtent = extentFromPoints(trackPoints.map(point => [point.lon, point.lat]));
  const trackTimes = trackPoints.map(point => point.t).sort();
  const radarFrames = [];
  for (const [stormId, storm] of Object.entries(radarManifest).sort(([a], [b]) => a.localeCompare(b))) {
    const region = RADAR_REGIONS[storm.region];
    if (!region) throw new Error(`unknown radar region for ${stormId}: ${storm.region}`);
    for (const [stamp, frame] of Object.entries(storm.frames || {}).sort(([a], [b]) => a.localeCompare(b))) {
      if (!/^\d{12}$/.test(stamp)) throw new Error(`invalid radar frame timestamp for ${stormId}: ${stamp}`);
      const itemPath = `data/stac/items/radar/${stormId}-${stamp}.json`;
      const imagePath = `data/radar/${frame}`;
      const imageRecord = releaseByPath.get(imagePath);
      if (!imageRecord) throw new Error(`release manifest is missing radar frame ${imagePath}`);
      const bbox = boundsToBbox(region.bounds);
      const name = String(storm.name || stormId);
      const datetime = stampToIso(stamp);
      const imageAssets = {
        image: {
          ...asset(imagePath, itemPath, {
            type: 'image/png',
            title: `${name} ${datetime} ${region.product} radar composite`,
            distribution: ['full'],
          }),
          roles: ['data', 'thumbnail'],
        },
      };
      const transparentPath = imagePath.replace(/\.png$/, '_TRANSPARENT.png');
      if (releaseByPath.has(transparentPath)) {
        imageAssets.transparent = asset(transparentPath, itemPath, {
          type: 'image/png',
          title: `${name} ${datetime} transparent radar composite`,
          distribution: ['full'],
        });
      }
      const item = {
        stac_version: STAC_VERSION,
        stac_extensions: [STAC_FILE_EXTENSION],
        type: 'Feature',
        id: `radar-${stormId}-${stamp}`,
        collection: 'radar',
        geometry: polygonForBbox(bbox),
        bbox,
        properties: {
          datetime,
          'hurricanemap:storm_id': stormId,
          'hurricanemap:storm_name': name,
          'hurricanemap:year': Number(storm.year),
          'hurricanemap:region': storm.region,
          'hurricanemap:product': region.product,
          'hurricanemap:is_landfall_frame': Object.values(storm.landfalls || {}).includes(stamp),
          'hurricanemap:source_url': imageRecord.source_url,
          'hurricanemap:source_date': imageRecord.source_date,
          'hurricanemap:distribution': DISTRIBUTIONS,
        },
        links: [
          { rel: 'self', href: relativeHref(itemPath, itemPath), type: 'application/geo+json' },
          { rel: 'parent', href: relativeHref(itemPath, RADAR_COLLECTION_PATH), type: 'application/json' },
          { rel: 'collection', href: relativeHref(itemPath, RADAR_COLLECTION_PATH), type: 'application/json' },
          { rel: 'root', href: relativeHref(itemPath, CATALOG_PATH), type: 'application/json' },
        ],
        assets: imageAssets,
      };
      add(itemPath, item);
      radarFrames.push({ stormId, name, year: Number(storm.year), region: storm.region, stamp, datetime, itemPath });
    }
  }

  const hurdat2Item = {
    stac_version: STAC_VERSION,
    stac_extensions: [STAC_FILE_EXTENSION],
    type: 'Feature',
    id: 'hurdat2-data',
    collection: 'hurdat2',
    geometry: polygonForBbox(trackExtent.bbox),
    bbox: trackExtent.bbox,
    properties: {
      datetime: null,
      start_datetime: trackTimes.at(0),
      end_datetime: trackTimes.at(-1),
      'hurricanemap:storm_count': storms.length,
      'hurricanemap:landfall_event_count': landfalls.length,
      'hurricanemap:source_url': 'https://www.nhc.noaa.gov/data/hurdat/',
      'hurricanemap:source_date': latestSourceDate(releaseManifest, [
        'data/hurdat2-atlantic.txt',
        'data/hurdat2-nepac.txt',
      ]),
      'hurricanemap:distribution': DISTRIBUTIONS,
    },
    links: [
      { rel: 'self', href: relativeHref(HURDAT2_ITEM_PATH, HURDAT2_ITEM_PATH), type: 'application/geo+json' },
      { rel: 'parent', href: relativeHref(HURDAT2_ITEM_PATH, HURDAT2_COLLECTION_PATH), type: 'application/json' },
      { rel: 'collection', href: relativeHref(HURDAT2_ITEM_PATH, HURDAT2_COLLECTION_PATH), type: 'application/json' },
      { rel: 'root', href: relativeHref(HURDAT2_ITEM_PATH, CATALOG_PATH), type: 'application/json' },
    ],
    assets: {
      storms: asset('data/storms.json.gz', HURDAT2_ITEM_PATH, { type: 'application/gzip', title: 'HURDAT2 storm tracks' }),
      landfalls: asset('data/landfalls.json', HURDAT2_ITEM_PATH, { type: 'application/json', title: 'US landfall event index' }),
      boundaries: asset('data/us-states.geojson', HURDAT2_ITEM_PATH, { type: 'application/geo+json', title: 'US state boundaries' }),
      sources: asset('data/hurdat2-sources.json', HURDAT2_ITEM_PATH, { type: 'application/json', title: 'HURDAT2 source lock' }),
    },
  };
  add(HURDAT2_ITEM_PATH, hurdat2Item);

  const radarBbox = extentFromPoints(Object.values(RADAR_REGIONS).flatMap(region => {
    const bbox = boundsToBbox(region.bounds);
    return [[bbox[0], bbox[1]], [bbox[2], bbox[3]]];
  })).bbox;
  const radarTimes = radarFrames.map(frame => frame.datetime).sort();
  const hurdat2Collection = {
    stac_version: STAC_VERSION,
    stac_extensions: [STAC_FILE_EXTENSION],
    type: 'Collection',
    id: 'hurdat2',
    title: 'HURDAT2 storm tracks and US landfalls',
    description: 'Static HURDAT2-derived storm tracks, landfall events, and attribution boundaries used by HurricaneMap.',
    license: 'public-domain',
    extent: {
      spatial: { bbox: [trackExtent.bbox] },
      temporal: { interval: [[trackTimes.at(0), trackTimes.at(-1)]] },
    },
    summaries: {
      'hurricanemap:distribution': DISTRIBUTIONS,
      'hurricanemap:storm_count': [storms.length],
      'hurricanemap:landfall_event_count': [landfalls.length],
    },
    'hurricanemap:source_url': 'https://www.nhc.noaa.gov/data/hurdat/',
    'hurricanemap:source_date': latestSourceDate(releaseManifest, [
      'data/hurdat2-atlantic.txt',
      'data/hurdat2-nepac.txt',
    ]),
    'hurricanemap:distribution': DISTRIBUTIONS,
    links: collectionLinks(HURDAT2_COLLECTION_PATH, CATALOG_PATH, [
      { rel: 'item', href: relativeHref(HURDAT2_COLLECTION_PATH, HURDAT2_ITEM_PATH), type: 'application/geo+json' },
    ]),
  };
  const radarCollection = {
    stac_version: STAC_VERSION,
    stac_extensions: [STAC_FILE_EXTENSION],
    type: 'Collection',
    id: 'radar',
    title: 'Archived NEXRAD composite frames',
    description: 'Static IEM NEXRAD composite frames aligned to HurricaneMap storm histories.',
    license: 'public-domain',
    extent: {
      spatial: { bbox: [radarBbox] },
      temporal: { interval: [[radarTimes.at(0), radarTimes.at(-1)]] },
    },
    summaries: {
      'hurricanemap:distribution': DISTRIBUTIONS,
      'hurricanemap:regions': Object.keys(RADAR_REGIONS).sort(),
      'hurricanemap:frame_count': [radarFrames.length],
    },
    'hurricanemap:frame_count': radarFrames.length,
    'hurricanemap:source_url': 'https://mesonet.agron.iastate.edu/docs/nexrad_mosaic/',
    'hurricanemap:source_date': radarFrames.map(frame => {
      const record = releaseByPath.get(`data/radar/${radarManifest[frame.stormId].frames[frame.stamp]}`);
      return record.source_date;
    }).sort().at(-1),
    'hurricanemap:distribution': DISTRIBUTIONS,
    links: collectionLinks(RADAR_COLLECTION_PATH, CATALOG_PATH, [
      ...radarFrames.map(frame => ({
        rel: 'item',
        href: relativeHref(RADAR_COLLECTION_PATH, frame.itemPath),
        type: 'application/geo+json',
      })),
    ]),
    assets: {
      manifest: asset('data/radar/manifest.json', RADAR_COLLECTION_PATH, {
        title: 'Storm-to-frame lookup manifest',
        distribution: ['full'],
      }),
    },
  };
  add(HURDAT2_COLLECTION_PATH, hurdat2Collection);
  add(RADAR_COLLECTION_PATH, radarCollection);

  add(CATALOG_PATH, {
    stac_version: STAC_VERSION,
    stac_extensions: [STAC_FILE_EXTENSION],
    type: 'Catalog',
    id: 'hurricanemap',
    title: 'HurricaneMap static data catalog',
    description: 'A serverless STAC catalog for the HURDAT2 and archived radar assets distributed with HurricaneMap.',
    license: 'various',
    'hurricanemap:project_license': 'MIT',
    'hurricanemap:source_commit': sourceCommit,
    'hurricanemap:generated_at_utc': generatedAt,
    'hurricanemap:distribution': DISTRIBUTIONS,
    links: [
      { rel: 'self', href: relativeHref(CATALOG_PATH, CATALOG_PATH), type: 'application/json' },
      { rel: 'child', href: relativeHref(CATALOG_PATH, HURDAT2_COLLECTION_PATH), type: 'application/json' },
      { rel: 'child', href: relativeHref(CATALOG_PATH, RADAR_COLLECTION_PATH), type: 'application/json' },
      { rel: 'describedby', href: relativeHref(CATALOG_PATH, 'data/release-manifest.json'), type: 'application/json', title: 'Release checksum manifest' },
    ],
  });

  return files;
}

export async function writeStacCatalog({ root = ROOT } = {}) {
  const files = await buildStacFiles({ root });
  const stacRoot = path.join(root, 'data', 'stac');
  await rm(stacRoot, { recursive: true, force: true });
  for (const [relative, contents] of files) {
    const destination = path.join(root, relative);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, contents, 'utf8');
  }
  return files;
}

function collectionLinks(collectionPath, catalogPath, itemLinks) {
  return [
    { rel: 'self', href: relativeHref(collectionPath, collectionPath), type: 'application/json' },
    { rel: 'parent', href: relativeHref(collectionPath, catalogPath), type: 'application/json' },
    { rel: 'root', href: relativeHref(collectionPath, catalogPath), type: 'application/json' },
    ...itemLinks,
  ];
}

function relativeHref(from, target) {
  return path.posix.relative(path.posix.dirname(from), target) || path.posix.basename(target);
}

function mimeType(relative) {
  if (relative.endsWith('.geojson')) return 'application/geo+json';
  if (relative.endsWith('.gz')) return 'application/gzip';
  if (relative.endsWith('.txt')) return 'text/plain';
  if (relative.endsWith('.png')) return 'image/png';
  return 'application/json';
}

function stampToIso(stamp) {
  const year = Number(stamp.slice(0, 4));
  const month = Number(stamp.slice(4, 6));
  const day = Number(stamp.slice(6, 8));
  const hour = Number(stamp.slice(8, 10));
  const minute = Number(stamp.slice(10, 12));
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute));
  if (Number.isNaN(date.getTime()) || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error(`invalid radar timestamp: ${stamp}`);
  }
  return date.toISOString();
}

function boundsToBbox(bounds) {
  const [[minLat, minLon], [maxLat, maxLon]] = bounds;
  return [minLon, minLat, maxLon, maxLat];
}

function polygonForBbox([minLon, minLat, maxLon, maxLat]) {
  return {
    type: 'Polygon',
    coordinates: [[
      [minLon, minLat],
      [minLon, maxLat],
      [maxLon, maxLat],
      [maxLon, minLat],
      [minLon, minLat],
    ]],
  };
}

function extentFromPoints(points) {
  if (!points.length) throw new Error('cannot build a spatial extent without points');
  const longitudes = points.map(point => point[0]);
  const latitudes = points.map(point => point[1]);
  return {
    bbox: [Math.min(...longitudes), Math.min(...latitudes), Math.max(...longitudes), Math.max(...latitudes)],
  };
}

function latestSourceDate(manifest, paths) {
  return paths.map(relative => manifest.artifacts.find(artifact => artifact.path === relative)?.source_date)
    .filter(Boolean)
    .sort()
    .at(-1);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  if (!process.argv.includes('--write')) throw new Error('Pass --write to generate the static STAC catalog');
  const files = await writeStacCatalog();
  const digest = createHash('sha256').update([...files.values()].join('')).digest('hex').slice(0, 12);
  console.log(`STAC catalog generated (${files.size} files, ${digest})`);
}
