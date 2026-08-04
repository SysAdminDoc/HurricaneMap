import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const dockerfile = await readFile(new URL('../Dockerfile', import.meta.url), 'utf8');
const dockerignore = await readFile(new URL('../.dockerignore', import.meta.url), 'utf8');

assert.match(dockerfile, /^FROM python:3\.12-alpine/m, 'Dockerfile should use the lightweight Python 3.12 Alpine runtime');
assert.match(dockerfile, /WORKDIR \/app/, 'Dockerfile should serve from /app');
assert.match(dockerfile, /EXPOSE 8080/, 'Dockerfile should expose port 8080');
assert.match(dockerfile, /USER hurricanemap/, 'Dockerfile should run as a non-root user');
assert.match(dockerfile, /COPY --chown=hurricanemap:hurricanemap \. \/app/, 'Dockerfile should assign ownership while copying');
assert.doesNotMatch(dockerfile, /chown -R/, 'Dockerfile should not duplicate the data layer with a recursive chown');
assert.match(dockerfile, /python", "serve\.py"/, 'Dockerfile should use the CSP-aware Python server');
assert.match(dockerfile, /serve\.py/, 'Dockerfile should ship the security-header server');
assert.match(dockerfile, /HEALTHCHECK/, 'Dockerfile should include a healthcheck');
assert.match(dockerfile, /data\/metadata\.json/, 'healthcheck should verify a real app data asset');

for (const required of [
  'node_modules',
  '.git',
  '.tmp-bundle',
  '.tmp-pw',
  'test-results',
]) {
  assert.match(dockerignore, new RegExp(`(^|\\n)${required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\n|$)`), `.dockerignore should exclude ${required}`);
}
assert.doesNotMatch(dockerignore, /(^|\n)example\.png(\n|$)/, '.dockerignore must include the manifest screenshot');

console.log('docker packaging ok');
