import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { STAC_FILE_EXTENSION, STAC_VERSION } from './generate-stac-catalog.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INDEX_PATH = 'index.html';
const CATALOG_PATH = 'data/stac/catalog.json';
const COLLECTION_PATHS = new Map([
  ['hurdat2', 'data/stac/collections/hurdat2.json'],
  ['radar', 'data/stac/collections/radar.json'],
]);

export async function validateStac({ root = ROOT, profile = 'full' } = {}) {
  if (!['core', 'full'].includes(profile)) throw new Error(`unknown STAC profile: ${profile}`);
  currentProfile = profile;
  await validateDiscoveryLink(root);
  const catalog = await readJson(root, CATALOG_PATH);
  validateCatalog(catalog);
  const childLinks = linksFor(catalog, 'child');
  if (childLinks.length !== COLLECTION_PATHS.size) throw new Error('catalog must expose exactly two STAC collections');

  const collections = new Map();
  for (const [id, expectedPath] of COLLECTION_PATHS) {
    const link = childLinks.find(candidate => resolveHref(CATALOG_PATH, candidate.href).relative === expectedPath);
    if (!link) throw new Error(`catalog is missing ${id} collection link`);
    const collection = await readJson(root, expectedPath);
    await validateCollection(collection, id, expectedPath, root);
    collections.set(id, collection);
  }

  const hurdat2Collection = collections.get('hurdat2');
  const hurdat2ItemLinks = linksFor(hurdat2Collection, 'item');
  if (hurdat2ItemLinks.length !== 1) throw new Error('HURDAT2 collection must expose exactly one aggregate item');
  const hurdat2ItemPath = resolveHref('data/stac/collections/hurdat2.json', hurdat2ItemLinks[0].href).relative;
  if (hurdat2ItemPath !== 'data/stac/items/hurdat2.json') throw new Error('HURDAT2 collection item path is not canonical');
  const hurdat2Item = await readJson(root, hurdat2ItemPath);
  await validateItem(hurdat2Item, 'hurdat2', hurdat2ItemPath, root);

  const radarCollection = collections.get('radar');
  const radarItemLinks = linksFor(radarCollection, 'item');
  const radarItems = [];
  for (const link of radarItemLinks) {
    const itemPath = resolveHref('data/stac/collections/radar.json', link.href).relative;
    const item = await readJson(root, itemPath);
    await validateItem(item, 'radar', itemPath, root);
    radarItems.push({ path: itemPath, item });
  }
  const radarManifest = await readJson(root, 'data/radar/manifest.json');
  const releaseManifest = await readJson(root, 'data/release-manifest.json');
  const manifestFrames = flattenRadarManifest(radarManifest);
  const radarAssetCount = radarItems.reduce((count, { item }) => count + Object.keys(item.assets || {}).length, 0);
  if (profile === 'full') {
    if (!manifestFrames.length) throw new Error('full STAC validation requires a populated radar manifest');
    if (radarItems.length !== manifestFrames.length) {
      throw new Error(`radar STAC item count ${radarItems.length} does not match manifest frame count ${manifestFrames.length}`);
    }
    const expected = new Set(manifestFrames.map(frame => `${frame.stormId}|${frame.stamp}`));
    const actual = new Set(radarItems.map(({ item }) => `${item.properties?.['hurricanemap:storm_id']}|${isoToStamp(item.properties?.datetime)}`));
    if (!setsEqual(expected, actual)) throw new Error('radar STAC items do not match radar manifest frames');
    const expectedAssets = new Set(releaseManifest.artifacts
      .filter(artifact => artifact.path.startsWith('data/radar/') && artifact.path.endsWith('.png'))
      .map(artifact => artifact.path));
    const actualAssets = new Set(radarItems.flatMap(({ path: itemPath, item }) => Object.values(item.assets || {})
      .filter(asset => asset['hurricanemap:distribution']?.includes('full'))
      .map(asset => resolveHref(itemPath, asset.href).relative)));
    if (!setsEqual(expectedAssets, actualAssets)) throw new Error('STAC radar assets do not match the release manifest PNG set');
  } else {
    if (Object.keys(radarManifest).length !== 0) throw new Error('core STAC validation requires the staged radar manifest to be empty');
    if (radarItems.length !== radarCollection['hurricanemap:frame_count']) {
      throw new Error('core STAC radar item count does not match the catalog frame count');
    }
  }

  const itemDirectory = 'data/stac/items/radar';
  const files = (await readdir(path.join(root, itemDirectory), { withFileTypes: true }))
    .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
    .map(entry => `${itemDirectory}/${entry.name}`)
    .sort();
  const linked = radarItems.map(({ path: itemPath }) => itemPath).sort();
  if (JSON.stringify(files) !== JSON.stringify(linked)) throw new Error('radar STAC item directory contains stale or missing item files');

  const radarAsset = radarCollection.assets?.manifest;
  if (!radarAsset || radarAsset['hurricanemap:distribution']?.includes('core')) {
    throw new Error('radar collection manifest asset must be full-distribution only');
  }

  return {
    collections: collections.size,
    radarItems: radarItems.length,
    radarAssets: radarAssetCount,
    profile,
  };
}

function validateCatalog(catalog) {
  if (catalog.stac_version !== STAC_VERSION || catalog.type !== 'Catalog' || catalog.id !== 'hurricanemap') {
    throw new Error('STAC catalog identity is invalid');
  }
  if (!Array.isArray(catalog.links) || !linksFor(catalog, 'self').length) throw new Error('STAC catalog must have links and a self link');
  if (!Array.isArray(catalog['hurricanemap:distribution']) || catalog['hurricanemap:distribution'].length !== 2) {
    throw new Error('STAC catalog distribution metadata is invalid');
  }
}

async function validateDiscoveryLink(root) {
  let html;
  try {
    html = await readFile(path.join(root, INDEX_PATH), 'utf8');
  } catch (error) {
    throw new Error(`unable to read STAC discovery entry point ${INDEX_PATH}: ${error.message}`);
  }
  const link = (html.match(/<link\b[^>]*>/gi) || []).find(tag => {
    const rel = htmlAttribute(tag, 'rel').split(/\s+/).filter(Boolean).map(value => value.toLowerCase());
    return rel.includes('alternate') && htmlAttribute(tag, 'type').toLowerCase() === 'application/json';
  });
  if (!link) throw new Error('index.html is missing its application/json STAC alternate link');
  const href = htmlAttribute(link, 'href');
  const target = resolveHref(INDEX_PATH, href, root);
  if (target.relative !== CATALOG_PATH) {
    throw new Error(`index.html STAC alternate link must resolve to ${CATALOG_PATH}: ${href}`);
  }
  await readJson(root, target.relative);
}

function htmlAttribute(tag, name) {
  return tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'i'))?.[1] || '';
}

async function validateCollection(collection, expectedId, collectionPath, root) {
  if (collection.stac_version !== STAC_VERSION || collection.type !== 'Collection' || collection.id !== expectedId) {
    throw new Error(`invalid STAC collection identity: ${expectedId}`);
  }
  if (!collection.license || !collection.extent?.spatial?.bbox?.length || !collection.extent?.temporal?.interval?.length) {
    throw new Error(`STAC collection ${expectedId} is missing license or extent`);
  }
  if (!Array.isArray(collection.links) || !linksFor(collection, 'self').length || !linksFor(collection, 'root').length) {
    throw new Error(`STAC collection ${expectedId} is missing navigation links`);
  }
  validateBbox(collection.extent.spatial.bbox[0], `collection ${expectedId}`);
  for (const interval of collection.extent.temporal.interval) {
    if (!Array.isArray(interval) || interval.length !== 2 || !isIsoDate(interval[0]) || !isIsoDate(interval[1])) {
      throw new Error(`STAC collection ${expectedId} has an invalid temporal extent`);
    }
  }
  validateLinks(collection, collectionPath, root);
  for (const [key, asset] of Object.entries(collection.assets || {})) await validateAsset(asset, `${collectionPath} asset ${key}`, collectionPath, root);
}

async function validateItem(item, collectionId, itemPath, root) {
  if (item.stac_version !== STAC_VERSION || item.type !== 'Feature' || item.collection !== collectionId || !item.id) {
    throw new Error(`invalid STAC item identity: ${itemPath}`);
  }
  if (!Array.isArray(item.links) || !linksFor(item, 'self').length || !linksFor(item, 'collection').length) {
    throw new Error(`STAC item ${itemPath} is missing navigation links`);
  }
  validateBbox(item.bbox, `item ${itemPath}`);
  if (item.geometry !== null && (!item.geometry || typeof item.geometry !== 'object')) throw new Error(`item ${itemPath} has invalid geometry`);
  const properties = item.properties || {};
  if (properties.datetime === null) {
    if (!isIsoDate(properties.start_datetime) || !isIsoDate(properties.end_datetime)) throw new Error(`item ${itemPath} has no valid temporal interval`);
  } else if (!isIsoDate(properties.datetime)) {
    throw new Error(`item ${itemPath} has no valid datetime`);
  }
  if (!Array.isArray(properties['hurricanemap:distribution']) || !properties['hurricanemap:distribution'].length) {
    throw new Error(`item ${itemPath} is missing distribution metadata`);
  }
  if (collectionId === 'radar') {
    if (!/^radar-[A-Z]{2}\d{6}-\d{12}$/.test(item.id) || !properties['hurricanemap:storm_id'] || !properties['hurricanemap:region']) {
      throw new Error(`radar item ${itemPath} is missing storm identity`);
    }
    if (!item.assets?.image) throw new Error(`radar item ${itemPath} is missing its image asset`);
  }
  validateLinks(item, itemPath, root);
  for (const [key, asset] of Object.entries(item.assets || {})) await validateAsset(asset, `${itemPath} asset ${key}`, itemPath, root);
}

function validateLinks(document, documentPath, root) {
  for (const link of document.links || []) {
    if (!link.rel || !link.href) throw new Error(`STAC ${documentPath} contains an incomplete link`);
    resolveHref(documentPath, link.href, root);
  }
}

async function validateAsset(asset, label, fromPath, root) {
  if (!asset || typeof asset !== 'object' || !asset.href || !asset.type || !Array.isArray(asset.roles)) {
    throw new Error(`${label} is missing required asset fields`);
  }
  if (!/^https:\/\//.test(asset['hurricanemap:source_url'] || '') || !/^\d{4}-\d{2}-\d{2}$/.test(asset['hurricanemap:source_date'] || '')) {
    throw new Error(`${label} is missing HTTPS source provenance`);
  }
  if (!asset['hurricanemap:license'] || !Array.isArray(asset['hurricanemap:distribution']) || !asset['hurricanemap:distribution'].length) {
    throw new Error(`${label} is missing license or distribution metadata`);
  }
  if (!Number.isInteger(asset['file:size']) || !/^sha256:[a-f0-9]{64}$/.test(asset['file:checksum'] || '')) {
    throw new Error(`${label} is missing file size or SHA-256 metadata`);
  }
  const target = resolveHref(fromPath, asset.href, root);
  if (!asset['hurricanemap:distribution'].includes(currentProfile)) return;
  let bytes;
  try {
    bytes = await readFile(target.absolute);
  } catch {
    throw new Error(`${label} points to a missing required file: ${target.relative}`);
  }
  if (bytes.length !== asset['file:size']) throw new Error(`${label} has a stale byte count`);
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== asset['file:checksum'].slice('sha256:'.length)) throw new Error(`${label} has a stale SHA-256`);
}

function linksFor(document, rel) {
  return (document.links || []).filter(link => link.rel === rel);
}

function resolveHref(fromPath, href, root = ROOT) {
  if (typeof href !== 'string' || !href || href.startsWith('/') || /^[a-z][a-z\d+.-]*:/i.test(href) || href.includes('?') || href.includes('#')) {
    throw new Error(`STAC href must be a local relative path: ${href}`);
  }
  const rootAbsolute = path.resolve(root);
  const absolute = path.resolve(rootAbsolute, path.dirname(fromPath), href);
  const relative = path.relative(rootAbsolute, absolute).replaceAll('\\', '/');
  if (relative.startsWith('../') || relative === '..' || path.isAbsolute(relative)) throw new Error(`STAC href escapes repository root: ${href}`);
  return { absolute, relative };
}

async function readJson(root, relative) {
  try {
    return JSON.parse(await readFile(path.join(root, relative), 'utf8'));
  } catch (error) {
    throw new Error(`unable to read STAC fixture ${relative}: ${error.message}`);
  }
}

function validateBbox(bbox, label) {
  if (!Array.isArray(bbox) || bbox.length !== 4 || bbox.some(value => typeof value !== 'number' || !Number.isFinite(value))) {
    throw new Error(`${label} has an invalid WGS 84 bbox`);
  }
  if (bbox[0] > bbox[2] || bbox[1] > bbox[3] || bbox[0] < -180 || bbox[2] > 180 || bbox[1] < -90 || bbox[3] > 90) {
    throw new Error(`${label} bbox is outside WGS 84 bounds`);
  }
}

function isIsoDate(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) && /Z$/.test(value);
}

function isoToStamp(value) {
  if (!isIsoDate(value)) throw new Error(`invalid radar item datetime: ${value}`);
  const date = new Date(value);
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')}${String(date.getUTCHours()).padStart(2, '0')}${String(date.getUTCMinutes()).padStart(2, '0')}`;
}

function flattenRadarManifest(manifest) {
  return Object.entries(manifest)
    .flatMap(([stormId, storm]) => Object.keys(storm.frames || {}).map(stamp => ({ stormId, stamp })))
    .sort((a, b) => `${a.stormId}|${a.stamp}`.localeCompare(`${b.stormId}|${b.stamp}`));
}

function setsEqual(left, right) {
  return left.size === right.size && [...left].every(value => right.has(value));
}

let currentProfile = 'full';
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const profileFlag = process.argv.indexOf('--profile');
  currentProfile = profileFlag >= 0 ? process.argv[profileFlag + 1] : 'full';
  const result = await validateStac({ profile: currentProfile });
  console.log(`STAC ok (${result.collections} collections, ${result.radarItems} radar items, ${result.profile})`);
}
