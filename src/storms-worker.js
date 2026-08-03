import { fetchWithTimeout, REQUEST_TIMEOUT_MS } from './network.js';

self.addEventListener('message', async () => {
  try {
    let storms;
    if (typeof DecompressionStream !== 'undefined') {
      try { storms = await fetchGzipped(); } catch { storms = await fetchRaw(); }
    } else {
      storms = await fetchRaw();
    }
    self.postMessage({ ok: true, storms });
  } catch (error) {
    self.postMessage({ ok: false, error: error.message });
  }
});

// Relative fetches resolve against this worker's own URL (/src/), so the
// data directory one level up must be addressed explicitly.
async function fetchGzipped() {
  const response = await fetchWithTimeout(
    new URL('../data/storms.json.gz', self.location.href),
    {},
    REQUEST_TIMEOUT_MS.data,
  );
  if (!response.ok) throw new Error(`storms.json.gz returned ${response.status}`);
  const ds = new DecompressionStream('gzip');
  const decompressed = response.body.pipeThrough(ds);
  const reader = decompressed.getReader();
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const text = new TextDecoder().decode(concat(chunks));
  return JSON.parse(text);
}

async function fetchRaw() {
  const response = await fetchWithTimeout(
    new URL('../data/storms.json', self.location.href),
    {},
    REQUEST_TIMEOUT_MS.data,
  );
  if (!response.ok) throw new Error(`storms.json returned ${response.status}`);
  return response.json();
}

function concat(arrays) {
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) { result.set(a, offset); offset += a.length; }
  return result;
}
