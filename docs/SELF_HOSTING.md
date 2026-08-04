# Self-Hosting HurricaneMap

HurricaneMap is a static app. The Docker image packages the repository with a small CSP-aware Python HTTP server for institutional or intranet deployments.

## Build

```bash
docker build -t hurricanemap:local .
```

## Run

```bash
docker run --rm -p 8080:8080 hurricanemap:local
```

Open `http://127.0.0.1:8080/`.

## Notes

- The container runs as a non-root `hurricanemap` user.
- The Docker base is pinned to `python:3.12-alpine@sha256:6d43704baacd1bfbe7c295d7f13079d5d8104ed33568873133f8fc69980419df`; update it only as an intentional, reviewed image refresh.
- Port `8080` is exposed.
- The bundled `serve.py` applies `Cache-Control: no-cache`, `X-Content-Type-Options: nosniff`, and `Referrer-Policy: strict-origin-when-cross-origin` to every response. It adds the primary-document CSP, including `form-action 'none'` and `frame-ancestors 'self'`, to `/` and `/index.html`. Plain `python -m http.server` does not provide these deployment headers and is not equivalent.
- The healthcheck requests `/data/metadata.json`, which verifies both the web server and the generated data bundle.
- The image includes the committed `data/` directory, including historical radar frames. This makes self-hosting useful in offline or poor-connectivity environments, but it also means the image can be large.
- `.dockerignore` excludes local development artifacts, node modules, temporary Playwright outputs, git metadata, and untracked screenshots.

### Reverse proxies and other static servers

If the files are served by a CDN, object store, or web server other than the bundled `serve.py` or the Cloudflare Worker, add a response header to the primary document and preserve the full directive set from `index.html`'s meta policy:

```text
Content-Security-Policy: ...; form-action 'none'; frame-ancestors 'self';
```

The `frame-ancestors` directive cannot be enforced from a `<meta>` tag. Do not rely on the meta tag alone for deployments that are not behind the Worker; configure the response header at the edge or origin and verify it with `curl -I https://your-host.example/`.

## Refresh Data Before Building

```bash
node scripts/refresh-hurdat2.mjs --apply
python scripts/preprocess_hurdat2.py
npm test
docker build -t hurricanemap:local .
```
