const DEFAULT_ORIGIN = 'https://sysadmindoc.github.io/HurricaneMap';

// GitHub Pages does not emit a response CSP. Keep this header in lockstep with
// index.html's meta policy, adding the directives that only response headers
// can enforce for the primary document.
export const MAIN_CONTENT_SECURITY_POLICY = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://*.basemaps.cartocdn.com https://*.tile.openstreetmap.org https://tiles.arcgis.com https://cdn.star.nesdis.noaa.gov https://mesonet.agron.iastate.edu https://pae-paha.pacioos.hawaii.edu; connect-src 'self' https://api.weather.gov https://api.tidesandcurrents.noaa.gov https://mapservices.weather.noaa.gov https://pae-paha.pacioos.hawaii.edu https://*.basemaps.cartocdn.com https://*.tile.openstreetmap.org https://tiles.arcgis.com https://services9.arcgis.com https://services.arcgis.com https://geocode.arcgis.com https://cdn.star.nesdis.noaa.gov https://mesonet.agron.iastate.edu https://www.nhc.noaa.gov https://www.fema.gov https://corsproxy.io; font-src 'self'; worker-src 'self' blob:; frame-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'self';";

const POLICIES = {
  html: {
    browser: 'public, max-age=0, must-revalidate',
    edge: 'public, s-maxage=300, stale-while-revalidate=86400',
    edgeTtl: 300,
  },
  shell: {
    browser: 'public, max-age=300, stale-while-revalidate=86400',
    edge: 'public, s-maxage=86400, stale-while-revalidate=604800',
    edgeTtl: 86400,
  },
  data: {
    browser: 'public, max-age=300, stale-while-revalidate=86400',
    edge: 'public, s-maxage=21600, stale-while-revalidate=604800',
    edgeTtl: 21600,
  },
  immutable: {
    browser: 'public, max-age=31536000, immutable',
    edge: 'public, s-maxage=31536000, stale-while-revalidate=604800',
    edgeTtl: 31536000,
  },
};

const NHC_PROXY_ALLOWLIST = {
  '/nhc/CurrentStorms.json': 'https://www.nhc.noaa.gov/CurrentStorms.json',
  '/nhc/outlook/atl.kmz': 'https://www.nhc.noaa.gov/xgtwo/gtwo_atl.kmz',
  '/nhc/outlook/pac.kmz': 'https://www.nhc.noaa.gov/xgtwo/gtwo_pac.kmz',
  '/nhc/outlook/cpac.kmz': 'https://www.nhc.noaa.gov/xgtwo/gtwo_cpac.kmz',
  '/nhc/marine/atlantic.kml': 'https://www.nhc.noaa.gov/gis/marine/warnings/GMWW_00to24_Atlantic.kml',
  '/nhc/marine/pacific.kml': 'https://www.nhc.noaa.gov/gis/marine/warnings/GMWW_00to24_Pacific.kml',
};

const NHC_POLICY = {
  browser: 'public, max-age=60, stale-while-revalidate=300',
  edge: 'public, s-maxage=120, stale-while-revalidate=600',
  edgeTtl: 120,
};

export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405 });
    }

    const requestUrl = new URL(request.url);

    const nhcTarget = nhcProxyTargetFor(requestUrl.pathname);
    if (nhcTarget) {
      return handleNhcProxy(nhcTarget, request, ctx);
    }

    const originUrl = originUrlFor(requestUrl, env);
    const policy = cachePolicyFor(requestUrl.pathname);
    const isHead = request.method === 'HEAD';
    const cacheKey = getCacheKey(originUrl.href, request);
    const cache = caches.default;

    const cached = await cache.match(cacheKey);
    if (cached) {
      const cachedWithHeaders = applyResponseHeaders(cached, policy, requestUrl.pathname);
      return toRequestMethod(tagCacheStatus(cachedWithHeaders, 'HIT'), request.method);
    }

    const originRequest = new Request(originUrl.href, request);
    const response = await fetch(originRequest, {
      cf: cloudflareFetchOptions(requestUrl.pathname, policy),
    });

    const finalResponse = applyResponseHeaders(response, policy, requestUrl.pathname);
    if (!isHead && finalResponse.ok && policy.edgeTtl > 0) {
      ctx.waitUntil(cache.put(cacheKey, finalResponse.clone()));
    }
    return toRequestMethod(tagCacheStatus(finalResponse, 'MISS'), request.method);
  },
};

async function handleNhcProxy(targetUrl, request, ctx) {
  const cache = caches.default;
  const isHead = request.method === 'HEAD';
  const cacheKey = getCacheKey(targetUrl, request);

  const cached = await cache.match(cacheKey);
  if (cached) return toRequestMethod(addCorsHeaders(tagCacheStatus(cached, 'HIT')), request.method);

  const response = await fetch(targetUrl, {
    headers: { 'User-Agent': 'HurricaneMap/1.0 (https://github.com/SysAdminDoc/HurricaneMap)' },
    cf: { cacheEverything: true, cacheTtl: NHC_POLICY.edgeTtl },
  });

  const finalResponse = applyResponseHeaders(response, NHC_POLICY);
  if (!isHead && finalResponse.ok) {
    ctx.waitUntil(cache.put(cacheKey, finalResponse.clone()));
  }
  return toRequestMethod(addCorsHeaders(tagCacheStatus(finalResponse, 'MISS')), request.method);
}

export function nhcProxyTargetFor(pathname) {
  return NHC_PROXY_ALLOWLIST[normalizePath(pathname)] || null;
}

function addCorsHeaders(response) {
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'GET, HEAD');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function classifyAsset(pathname) {
  const path = normalizePath(pathname);
  if (path === '/' || path.endsWith('/index.html') || !/\.[a-z0-9]+$/i.test(path)) return 'html';
  // Radar frames are timestamp-addressed — genuinely immutable.
  if (/^\/data\/radar\/.+\.png$/i.test(path)) return 'immutable';
  // storms.json.gz refreshes with every HURDAT2 revision like its siblings;
  // the .gz suffix must not fall through to the shell TTL.
  if (/^\/data\/.+\.(json|geojson|txt)(\.gz)?$/i.test(path)) return 'data';
  // Branding/screenshot images live at stable, un-fingerprinted paths — a
  // year-long immutable would pin stale logos in returning browsers forever.
  if (/\.(png|jpg|jpeg|webp|avif|svg|ico)$/i.test(path)) return 'shell';
  if (/\.(woff2|ttf|otf)$/i.test(path)) return 'immutable';
  if (/\.(js|css|webmanifest)$/i.test(path)) return 'shell';
  return 'shell';
}

export function cachePolicyFor(pathname) {
  return POLICIES[classifyAsset(pathname)] || POLICIES.shell;
}

export function originUrlFor(requestUrl, env = {}) {
  const origin = new URL(env.ORIGIN_BASE_URL || DEFAULT_ORIGIN);
  const basePath = origin.pathname.replace(/\/$/, '');
  const requestPath = normalizePath(requestUrl.pathname);
  origin.pathname = `${basePath}${requestPath === '/' ? '/index.html' : requestPath}`;
  origin.search = requestUrl.search;
  return origin;
}

export function applyResponseHeaders(response, policy, pathname = null) {
  const headers = new Headers(response.headers);
  const browserPolicy = response.ok ? policy.browser : 'no-store';
  const edgePolicy = response.ok ? policy.edge : 'no-store';
  headers.set('Cache-Control', browserPolicy);
  headers.set('CDN-Cache-Control', edgePolicy);
  headers.set('Cloudflare-CDN-Cache-Control', edgePolicy);
  headers.set('Vary', appendVary(headers.get('Vary'), 'Accept-Encoding'));
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('Permissions-Policy', 'geolocation=(self), microphone=(), camera=()');
  const normalizedPath = pathname ? normalizePath(pathname) : null;
  const contentType = headers.get('Content-Type') || '';
  const isPrimaryDocument = normalizedPath === '/'
    || normalizedPath?.endsWith('/')
    || normalizedPath?.endsWith('/index.html')
    || (!normalizedPath && /^text\/html\b/i.test(contentType));
  if (isPrimaryDocument) headers.set('Content-Security-Policy', MAIN_CONTENT_SECURITY_POLICY);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function getCacheKey(url, request) {
  // Cache API keys must be GET requests. HEAD reuses a matching GET entry but
  // never writes its bodyless origin response into the cache.
  return new Request(url, { method: 'GET', headers: request.headers });
}

function toRequestMethod(response, method) {
  if (method !== 'HEAD') return response;
  return new Response(null, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

export function cloudflareFetchOptions(pathname, policy) {
  const options = {
    cacheEverything: true,
    cacheTtl: policy.edgeTtl,
    cacheTtlByStatus: {
      '200-299': policy.edgeTtl,
      '404': 60,
      '500-599': 0,
    },
  };
  if (/\.(png|jpg|jpeg|webp)$/i.test(pathname) && !/^\/data\/radar\//i.test(pathname)) {
    options.image = {
      fit: 'scale-down',
      quality: 85,
      format: 'auto',
    };
  }
  return options;
}

function tagCacheStatus(response, status) {
  const headers = new Headers(response.headers);
  headers.set('Server-Timing', appendServerTiming(headers.get('Server-Timing'), `hm-cdn;desc="${status}"`));
  headers.set('X-HurricaneMap-CDN', status);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function normalizePath(pathname) {
  const path = pathname || '/';
  return path.startsWith('/') ? path : `/${path}`;
}

function appendVary(current, value) {
  if (!current) return value;
  const parts = current.split(',').map(part => part.trim().toLowerCase());
  return parts.includes(value.toLowerCase()) ? current : `${current}, ${value}`;
}

function appendServerTiming(current, value) {
  return current ? `${current}, ${value}` : value;
}
