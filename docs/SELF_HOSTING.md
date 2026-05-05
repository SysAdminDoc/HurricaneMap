# Self-Hosting HurricaneMap

HurricaneMap is a static app. The Docker image packages the repository with Python's built-in HTTP server for institutional or intranet deployments.

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
- The healthcheck requests `/data/metadata.json`, which verifies both the web server and the generated data bundle.
- The image includes the committed `data/` directory, including historical radar frames. This makes self-hosting useful in offline or poor-connectivity environments, but it also means the image can be large.
- `.dockerignore` excludes local development artifacts, node modules, temporary Playwright outputs, git metadata, and untracked screenshots.

## Refresh Data Before Building

```bash
node scripts/refresh-hurdat2.mjs --apply
python scripts/preprocess_hurdat2.py
npm test
docker build -t hurricanemap:local .
```
