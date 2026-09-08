// Every date a reader sees has to be formatted in the language they chose.
//
// `toLocaleString(undefined, ...)` and `new Intl.DateTimeFormat(undefined, ...)`
// mean "the browser's locale", which is not the app's: a Spanish reader on an
// English browser got "Aug 24, 2005" inside an otherwise Spanish panel. Passing
// `getLocale()` looks like the fix and is not, because ICU carries no data for
// `ht` and silently resolves it back to the runtime default. `getDateLocale()`
// maps `ht` onto `fr-HT`, which ICU does carry, and falls back to English by
// name rather than to whatever the browser happens to be.
//
// `toLocaleString` is also how numbers get their thousands separators, and a
// number has no business being routed through a date locale. The two are told
// apart by the options object: anything naming a date or time field is a date.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { blankCommentsAndRegexes } from './js-source.mjs';
import { callArguments } from './check-playwright-timeouts.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = path.join(root, 'src');

const ALWAYS_A_DATE = ['toLocaleDateString', 'toLocaleTimeString', 'DateTimeFormat'];
const AMBIGUOUS = ['toLocaleString'];
const DATE_FIELD = /\b(year|month|day|weekday|hour|minute|second|timeZone|dateStyle|timeStyle|era|hour12)\s*:/;
const BAD_FIRST_ARGUMENT = /^(undefined|getLocale\(\))$/;

export function findDateLocaleFaults(file, source) {
  const blanked = blankCommentsAndRegexes(source);
  const faults = [];
  // The same bug one indirection away, which is how two of these hid: a local
  // bound to getLocale() (or to documentElement.lang, which is the app locale
  // spelled through the DOM) and then handed to a formatter reads as an
  // innocent variable name at the call site.
  const indirect = new Set(
    [...blanked.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:getLocale\(\)|document\.documentElement\??\.lang)/g)]
      .map(match => match[1]),
  );
  for (const method of [...ALWAYS_A_DATE, ...AMBIGUOUS]) {
    // A computed access spells the same call, and a gate that reads only the
    // dotted form is one rename away from measuring nothing.
    const pattern = new RegExp(`(?:\\.|\\bIntl\\.)${method}\\s*\\(|\\[\\s*['"\`]${method}['"\`]\\s*\\]\\s*\\(`, 'g');
    for (const match of blanked.matchAll(pattern)) {
      const open = blanked.indexOf('(', match.index + match[0].length - 1);
      if (open === -1) continue;
      const { args } = callArguments(blanked, open);
      const options = args.slice(1).join(',');
      const looksLikeADate = ALWAYS_A_DATE.includes(method) || DATE_FIELD.test(options);
      if (!looksLikeADate) continue;
      const first = (args[0] ?? '').trim();
      if (first === '' || BAD_FIRST_ARGUMENT.test(first) || indirect.has(first)) {
        const line = source.slice(0, match.index).split(/\r?\n/).length;
        faults.push({
          file,
          line,
          method,
          argument: first === '' ? '(no locale)' : first,
        });
      }
    }
  }
  return faults;
}

async function main() {
  const files = (await readdir(sourceDir, { recursive: true }))
    .filter(name => name.endsWith('.js'))
    .sort();
  const faults = [];
  let scanned = 0;
  for (const name of files) {
    const file = `src/${name.replace(/\\/g, '/')}`;
    const source = await readFile(path.join(sourceDir, name), 'utf8');
    scanned += 1;
    faults.push(...findDateLocaleFaults(file, source));
  }

  // The mapping itself has to resolve, or this gate is enforcing a helper that
  // quietly does the very thing it forbids.
  const i18n = await readFile(path.join(sourceDir, 'i18n.js'), 'utf8');
  const declared = [...i18n.matchAll(/\[LOCALE_(\w+)\]:\s*\(\)\s*=>/g)].map(match => match[1].toLowerCase());
  const locales = new Set(['en', ...declared]);
  const unresolved = [];
  for (const locale of locales) {
    const mapped = /\[LOCALE_HT\]:\s*'([^']+)'/.exec(i18n);
    const candidate = locale === 'ht' && mapped ? mapped[1] : locale;
    if (!Intl.DateTimeFormat.supportedLocalesOf([candidate]).length) {
      unresolved.push(`${locale} maps to ${candidate}, which this runtime's ICU cannot resolve`);
    }
  }

  if (faults.length || unresolved.length) {
    for (const fault of faults) {
      console.error(
        `date locale: ${fault.file}:${fault.line} formats a date with ${fault.method}(${fault.argument}), `
        + 'which is the browser\'s locale rather than the reader\'s; pass getDateLocale()',
      );
    }
    for (const problem of unresolved) console.error(`date locale: ${problem}`);
    process.exit(1);
  }

  console.log(`date locale ok (${scanned} modules scanned, ${locales.size} locales resolve through getDateLocale)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
