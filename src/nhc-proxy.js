// The /nhc/* routes are served only by cloudflare/worker.js, which relays NHC
// products a browser cannot fetch for itself: neither
// www.nhc.noaa.gov/CurrentStorms.json nor /xgtwo/*.kmz sends an
// Access-Control-Allow-Origin header, and the free relay this code used to fall
// back to now answers 401 to everyone. On GitHub Pages, on serve.py and in the
// Docker image those routes simply 404.
//
// The paths were also root-absolute, so a worker mounted under a project path
// was missed as well: the browser asked https://host/nhc/... when the route was
// at https://host/HurricaneMap/nhc/....

// Takes the canonical worker route ('/nhc/CurrentStorms.json') and resolves it
// against the document base. Outside a browser there is no base to resolve
// against, so the route is returned as the worker itself serves it.
export function nhcProxyUrl(route) {
  const path = String(route);
  const base = typeof document !== 'undefined' && document.baseURI ? document.baseURI : null;
  if (!base) return path;
  return new URL(path.replace(/^\/+/, ''), base).href;
}

// The relay passes NHC's status through verbatim, so a 404 can mean either
// "no worker here" or "the worker asked NHC and NHC said no". Treating both as
// a missing route would kill active-storm tracking for the rest of the page
// load on a real worker deployment the first time an upstream file moved.
// Every response the worker serves is tagged, so the tag tells them apart.
export const PROXY_RESPONSE_TAG = 'X-HurricaneMap-CDN';

export function isMissingProxyRoute(response) {
  if (!response || response.status !== 404) return false;
  const tag = typeof response.headers?.get === 'function' ? response.headers.get(PROXY_RESPONSE_TAG) : null;
  return !tag;
}

// Whether this deployment has the relay, answered once per page load. The
// active-storm poll is the first thing to touch a /nhc/ route, so it reports
// what it found and every other feed reads that instead of 404ing again on its
// own. Without this, a worker-less load spent four requests discovering the
// same fact and logged four console errors doing it.
let settle = null;
let availability = new Promise(resolve => { settle = resolve; });

export function nhcProxyAvailable() {
  return availability;
}

export function reportNhcProxyAvailability(available) {
  settle(Boolean(available));
}

// Test seam: the discovery is a page-load-scoped fact, and a suite that drives
// several deployments in one process needs to forget the previous answer.
export function resetNhcProxyAvailability() {
  // Settle the outgoing promise first: anything already awaiting it would
  // otherwise wait on a promise nobody can resolve any more.
  settle(true);
  availability = new Promise(resolve => { settle = resolve; });
}
