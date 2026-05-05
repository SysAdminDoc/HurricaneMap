# Cloudflare CDN Worker

HurricaneMap can be served through a small Cloudflare Worker that proxies the GitHub Pages origin and applies product-specific cache policy.

## What The Worker Does

- HTML: short edge TTL with stale-while-revalidate so deployments appear quickly.
- App shell JS/CSS/manifest: one-day edge TTL and short browser TTL.
- Generated data JSON/GeoJSON/TXT: six-hour edge TTL so HURDAT2 refresh PRs propagate without purging everything.
- Images and radar PNGs: one-year immutable cache policy; radar frames are cache-first on demand, not transformed, because the raster bounds matter.
- Branding images: Cloudflare image hints request `format=auto`, `quality=85`, and `fit=scale-down`.
- Brotli/gzip: Cloudflare negotiates compression at the edge; the Worker preserves `Vary: Accept-Encoding` and adds CDN-specific cache headers.

## Deploy

```bash
npm run test:cdn-worker
npx wrangler deploy --env production
```

For a custom domain, bind the Worker route in Cloudflare to the desired hostname and keep `ORIGIN_BASE_URL` set to the GitHub Pages origin:

```toml
[env.production.vars]
ORIGIN_BASE_URL = "https://sysadmindoc.github.io/HurricaneMap"
```

## Measure

Before routing traffic, compare the origin and Worker URL from a few regions or CI runners:

```bash
curl -L -o /dev/null -s -w "origin %{time_starttransfer}s %{size_download} bytes\n" https://sysadmindoc.github.io/HurricaneMap/
curl -L -o /dev/null -s -w "worker %{time_starttransfer}s %{size_download} bytes\n" https://<worker-host>/
curl -I https://<worker-host>/src/main.js
curl -I https://<worker-host>/data/storms.json
```

Expected signals:

- `Cloudflare-CDN-Cache-Control` is present.
- `X-HurricaneMap-CDN` reports `MISS` on first request and `HIT` on repeat requests in the same edge location.
- `Server-Timing` includes the `hm-cdn` marker.
- `Vary` includes `Accept-Encoding`.
