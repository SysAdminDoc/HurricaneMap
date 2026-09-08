import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { findSection } from './release-notes.mjs';
import { archiveName, resolveGnuTar } from './package-distribution.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Both heading shapes are in CHANGELOG.md and both have to be found.
{
  const colon = '## v1.9.3: Metric parity and maintainability (2026-08-08)\nbody one\n';
  const dash = '## v1.9.1 - Advisory replay expansion (2026-08-02)\nbody two\n';
  assert.equal(findSection(colon, '1.9.3').body, 'body one');
  assert.equal(findSection(dash, '1.9.1').body, 'body two');
  assert.equal(findSection(colon, '1.9.3').title, 'v1.9.3: Metric parity and maintainability (2026-08-08)');
}

// A version is not a prefix of a later one. Without the boundary, 1.9.1 takes
// the 1.9.10 section, which is the wrong release entirely.
{
  const both = '## v1.9.10 - Later (2027-01-01)\nlater body\n\n## v1.9.1 - Earlier (2026-08-02)\nearlier body\n';
  assert.equal(findSection(both, '1.9.1').body, 'earlier body');
  assert.equal(findSection(both, '1.9.10').body, 'later body');
  assert.equal(findSection(both, '2.0.0'), null);
}

// A section ends at the next heading, not at the end of the file.
{
  const two = '## v1.6.0 - One (2026-07-16)\nfirst\n\n## v1.5.0 - Two (2026-07-09)\nsecond\n';
  assert.equal(findSection(two, '1.6.0').body, 'first');
}

// Every tagged version has notes to publish, which is the whole reason this
// exists: v1.8.0 and v1.9.0 shipped with no section of their own.
{
  const changelog = await readFile(path.join(root, 'CHANGELOG.md'), 'utf8');
  const released = ['1.5.0', '1.6.0', '1.7.0', '1.8.0', '1.9.0', '1.9.1', '1.9.2', '1.9.3'];
  for (const version of released) {
    const section = findSection(changelog, version);
    assert.ok(section, `CHANGELOG.md has no section for v${version}`);
    assert.ok(section.body.length > 40, `the v${version} section is too thin to publish as release notes`);
  }
}

// The archive name carries the version, which is what the README links and what
// check:release-truth compares against package.json.
{
  const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  assert.equal(archiveName(version, 'core'), `hurricanemap-${version}-core.tar.gz`);
  assert.equal(archiveName(version, 'full'), `hurricanemap-${version}-full.tar.gz`);
}

// bsdtar is refused however it is spelled. It cannot sort entries, so it cannot
// produce the archive whose hash gets published.
{
  assert.equal(resolveGnuTar(['definitely-not-a-tar-command']), null);
  const found = resolveGnuTar();
  if (found) assert.match(found.version, /GNU tar/);
}

console.log('release packaging ok (notes extraction, version boundary, archive naming, tar flavour)');
