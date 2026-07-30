import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => readFile(path.join(root, relative));
const text = async relative => (await read(relative)).toString('utf8');
const errors = [];

const [packageJson, lockfile, notices, requirements, readme] = await Promise.all([
  text('package.json').then(JSON.parse),
  text('package-lock.json').then(JSON.parse),
  text('THIRD_PARTY_NOTICES.txt'),
  text('requirements-notebooks.txt'),
  text('README.md'),
]);

const expectedDirectLicenses = {
  '@axe-core/playwright': 'MPL-2.0',
  '@playwright/test': 'Apache-2.0',
  playwright: 'Apache-2.0',
  esbuild: 'MIT',
  ajv: 'MIT',
};
const redistributableLicenses = new Set(['MIT', 'BSD-3-Clause', 'Apache-2.0', 'MPL-2.0']);
for (const [dependency, expectedLicense] of Object.entries(expectedDirectLicenses)) {
  const locked = lockfile.packages?.[`node_modules/${dependency}`];
  if (!locked) errors.push(`${dependency} is missing from package-lock.json`);
  else if (locked.license !== expectedLicense) {
    errors.push(`${dependency} license is ${locked.license || 'missing'}, expected ${expectedLicense}`);
  }
  if (!notices.includes(`- ${dependency} ${locked?.version}: ${expectedLicense}`)) {
    errors.push(`${dependency} ${locked?.version || 'unknown'} ${expectedLicense} is missing from THIRD_PARTY_NOTICES.txt`);
  }
}
for (const [location, record] of Object.entries(lockfile.packages || {})) {
  if (!location) continue;
  if (!record.license) errors.push(`${location} has no SPDX license in package-lock.json`);
  else if (!redistributableLicenses.has(record.license)) {
    errors.push(`${location} uses unreviewed license ${record.license}`);
  }
}

const fontContracts = [
  {
    path: 'fonts/inter-latin.woff2',
    sha256: '3100e775e8616cd2611beecfa23a4263d7037586789b43f035236a2e6fbd4c62',
    notice: 'Inter 4.001 (fonts/inter-latin.woff2)',
  },
  {
    path: 'fonts/jetbrains-mono-latin.woff2',
    sha256: '83c005d49d8a6a50474c73a5a36ac0468076e9c4a29da7bdb14995d80560a5be',
    notice: 'JetBrains Mono 2.211 (fonts/jetbrains-mono-latin.woff2)',
  },
];
for (const font of fontContracts) {
  const digest = createHash('sha256').update(await read(font.path)).digest('hex');
  if (digest !== font.sha256) errors.push(`${font.path} hash changed; review its source and license notice`);
  if (!notices.includes(font.notice) || !notices.includes(`SHA-256: ${font.sha256}`)) {
    errors.push(`${font.path} does not have a matching vendored-font notice`);
  }
}
if ((notices.match(/License: SIL Open Font License 1\.1/g) || []).length !== fontContracts.length) {
  errors.push('each vendored font must declare SIL Open Font License 1.1');
}
if (packageJson.engines?.node !== '>=20') errors.push('package.json must declare engines.node >=20');
if (lockfile.packages?.['']?.engines?.node !== '>=20') errors.push('package-lock.json must preserve engines.node >=20');
for (const requirement of ['numpy==2.5.1', 'pandas==3.0.5', 'matplotlib==3.11.1', 'pillow==12.3.0', 'notebook==7.6.1']) {
  if (!requirements.split(/\r?\n/).includes(requirement)) errors.push(`missing pinned notebook dependency ${requirement}`);
}
if (!readme.includes('python -m pip install -r requirements-notebooks.txt')) {
  errors.push('README does not provide the one-command notebook environment install');
}

if (errors.length) {
  errors.forEach(error => console.error(`license audit: ${error}`));
  process.exit(1);
}
console.log(`license audit ok (${Object.keys(lockfile.packages).length - 1} npm packages, ${fontContracts.length} vendored fonts, pinned notebook environment)`);
