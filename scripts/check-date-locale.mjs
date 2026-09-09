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

// Intl.NumberFormat carries exactly the same gap as DateTimeFormat: ICU has no
// `ht`, so a raw app locale resolves to the runtime default and a Creole reader
// on a German browser reads German digit grouping. A number formatter is not a
// date, so it is listed separately and judged on its locale argument alone.
const ALWAYS_A_DATE = [
  'toLocaleDateString',
  'toLocaleTimeString',
  'DateTimeFormat',
  // Same shape, same gap. Both were introduced while this list named neither,
  // so the exact bug this gate exists to catch was reachable through them.
  'RelativeTimeFormat',
  'DurationFormat',
];
const ALWAYS_A_NUMBER = ['NumberFormat'];
// ListFormat joins names for a reader ("years and state"), so it takes the
// app's locale like every other Intl surface here.
const ALWAYS_A_LIST = ['ListFormat'];
const AMBIGUOUS = ['toLocaleString'];
const WATCHED = new Set([...ALWAYS_A_DATE, ...ALWAYS_A_NUMBER, ...ALWAYS_A_LIST, ...AMBIGUOUS]);

// Which Intl constructors this gate has an opinion about. Listing the two that
// slipped past would fix the spelling and leave the class open: the next one
// arrives the same way, silently. So the rule is inverted. Every Intl member
// src/ names must be either watched above or declared here as taking no locale,
// and anything else fails until somebody decides which it is.
const LOCALE_FREE_INTL = new Set(['getCanonicalLocales', 'supportedValuesOf', 'Locale']);
const INTL_MEMBER = /\bIntl\.([A-Za-z_$][\w$]*)/g;
const DATE_FIELD = /\b(year|month|day|weekday|hour|minute|second|timeZone|dateStyle|timeStyle|era|hour12)\s*:/;
const BAD_FIRST_ARGUMENT = /^(undefined|getLocale\(\))$/;

export function findDateLocaleFaults(file, source) {
  const blanked = blankCommentsAndRegexes(source);
  const faults = [];
  // The same bug one indirection away, which is how two of these hid: a local
  // bound to getLocale() (or to documentElement.lang, which is the app locale
  // spelled through the DOM) and then handed to a formatter reads as an
  // innocent variable name at the call site.
  const suspect = String.raw`getLocale\(\)|document\.documentElement\??\.lang|undefined`;
  const indirect = new Set([
    // const locale = getLocale()
    ...[...blanked.matchAll(new RegExp(String.raw`(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:${suspect})`, 'g'))]
      .map(match => match[1]),
    // function f(value, locale = undefined) {}
    ...[...blanked.matchAll(new RegExp(String.raw`([A-Za-z_$][\w$]*)\s*=\s*(?:${suspect})\s*[,)]`, 'g'))]
      .map(match => match[1]),
    // { locale: getLocale() } and { locale: undefined }
    ...[...blanked.matchAll(new RegExp(String.raw`([A-Za-z_$][\w$]*)\s*:\s*(?:${suspect})\s*[,}]`, 'g'))]
      .map(match => match[1]),
  ]);
  for (const method of [...ALWAYS_A_DATE, ...ALWAYS_A_NUMBER, ...AMBIGUOUS]) {
    // A computed access spells the same call, and a gate that reads only the
    // dotted form is one rename away from measuring nothing.
    const pattern = new RegExp(`(?:\\.|\\bIntl\\.)${method}\\s*\\(|\\[\\s*['"\`]${method}['"\`]\\s*\\]\\s*\\(`, 'g');
    for (const match of blanked.matchAll(pattern)) {
      const open = blanked.indexOf('(', match.index + match[0].length - 1);
      if (open === -1) continue;
      const { args } = callArguments(blanked, open);
      const options = args.slice(1).join(',');
      // A bare `count.toLocaleString()` is a number with no locale at all,
      // which is the browser's, and that is the same defect. Only a call whose
      // locale is explicitly a fixed tag ('en-US') is left alone.
      const formatsForAReader = ALWAYS_A_DATE.includes(method)
        || ALWAYS_A_NUMBER.includes(method)
        || DATE_FIELD.test(options)
        || method === 'toLocaleString';
      if (!formatsForAReader) continue;
      const first = (args[0] ?? '').trim();
      const tail = first.split('.').pop().trim();
      if (first === '' || BAD_FIRST_ARGUMENT.test(first) || indirect.has(first) || indirect.has(tail)) {
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
  // Every Intl member src/ reaches for has to be one this gate judges.
  const unwatched = new Map();
  let scanned = 0;
  for (const name of files) {
    const file = `src/${name.replace(/\\/g, '/')}`;
    const source = await readFile(path.join(sourceDir, name), 'utf8');
    scanned += 1;
    faults.push(...findDateLocaleFaults(file, source));
    for (const match of blankCommentsAndRegexes(source).matchAll(INTL_MEMBER)) {
      const member = match[1];
      if (WATCHED.has(member) || LOCALE_FREE_INTL.has(member)) continue;
      if (!unwatched.has(member)) unwatched.set(member, file);
    }
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

  if (faults.length || unresolved.length || unwatched.size) {
    for (const fault of faults) {
      console.error(
        `date locale: ${fault.file}:${fault.line} formats for a reader with ${fault.method}(${fault.argument}), `
        + 'which is the browser\'s locale rather than the reader\'s; pass getDateLocale()',
      );
    }
    for (const problem of unresolved) console.error(`date locale: ${problem}`);
    for (const [member, where] of unwatched) {
      console.error(
        `date locale: ${where} uses Intl.${member}, which this gate does not judge. `
        + 'Add it to the watched list if it takes a locale, or to LOCALE_FREE_INTL if it does not.',
      );
    }
    process.exit(1);
  }

  console.log(
    `date locale ok (${scanned} modules scanned, ${WATCHED.size} Intl surfaces watched, `
    + `${locales.size} locales resolve through getDateLocale)`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
