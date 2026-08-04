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
- Port `8080` is exposed.
- The bundled `serve.py` adds the primary-document security headers, including `form-action 'none'` and `frame-ancestors 'self'`, to `/` and `/index.html`.
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
