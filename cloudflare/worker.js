const DEFAULT_ORIGIN = 'https://sysadmindoc.github.io/HurricaneMap';

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

    const nhcTarget = NHC_PROXY_ALLOWLIST[requestUrl.pathname];
    if (nhcTarget) {
      return handleNhcProxy(nhcTarget, request, ctx);
    }

    const originUrl = originUrlFor(requestUrl, env);
    const policy = cachePolicyFor(requestUrl.pathname);
    const cacheKey = new Request(originUrl.href, request);
    const cache = caches.default;

    const cached = await cache.match(cacheKey);
    if (cached) return tagCacheStatus(cached, 'HIT');

    const originRequest = new Request(originUrl.href, request);
    const response = await fetch(originRequest, {
      cf: cloudflareFetchOptions(requestUrl.pathname, policy),
    });

    const finalResponse = applyResponseHeaders(response, policy);
    if (finalResponse.ok && policy.edgeTtl > 0) {
      ctx.waitUntil(cache.put(cacheKey, finalResponse.clone()));
    }
    return tagCacheStatus(finalResponse, 'MISS');
  },
};

async function handleNhcProxy(targetUrl, request, ctx) {
  const cache = caches.default;
  const cacheKey = new Request(targetUrl, request);

  const cached = await cache.match(cacheKey);
  if (cached) return addCorsHeaders(tagCacheStatus(cached, 'HIT'));

  const response = await fetch(targetUrl, {
    headers: { 'User-Agent': 'HurricaneMap/1.0 (https://github.com/SysAdminDoc/HurricaneMap)' },
    cf: { cacheEverything: true, cacheTtl: NHC_POLICY.edgeTtl },
  });

  const finalResponse = applyResponseHeaders(response, NHC_POLICY);
  if (finalResponse.ok) {
    ctx.waitUntil(cache.put(cacheKey, finalResponse.clone()));
  }
  return addCorsHeaders(tagCacheStatus(finalResponse, 'MISS'));
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

export function applyResponseHeaders(response, policy) {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', policy.browser);
  headers.set('CDN-Cache-Control', policy.edge);
  headers.set('Cloudflare-CDN-Cache-Control', policy.edge);
  headers.set('Vary', appendVary(headers.get('Vary'), 'Accept-Encoding'));
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
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
