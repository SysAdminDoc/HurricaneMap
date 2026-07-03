// Season summary card. Surfaces when the year filter narrows to a small
// window (1-3 years). Shows total named storms touching the US, landfall
// count by Saffir tier, total ACE, strongest landfall, deadliest, costliest.
import { getLandfalls, getStorm, getImpactsFor, ensureStormsLoaded, categoryLabel, getEnsoForYear } from './data.js';
import { computeACE } from './metrics.js';
import { getSetting } from './settings.js';
import { inflateUSD, formatMillionsUSD } from './inflation.js';
import { escapeHtml, formatStormName } from './html-utils.js';
import { t } from './i18n.js';
import {
  formatFatalityCount,
  getDamageMillions,
  getFatalityCount,
} from './impact-utils.js';

const HOST_ID = 'season-summary';
const MAX_YEARS = 3;
let dismissedRange = null;

function ensureHost() {
  let host = document.getElementById(HOST_ID);
  if (host) return host;
  host = document.createElement('aside');
  host.id = HOST_ID;
  host.className = 'season-summary glass';
  host.setAttribute('role', 'complementary');
  host.setAttribute('aria-label', 'Season summary');
  host.hidden = true;
  // Mount adjacent to the legend at the bottom-left of the map.
  const main = document.querySelector('main') || document.body;
  main.appendChild(host);
  return host;
}
let refreshSeq = 0;

export async function refreshSeasonSummary({ yearMin, yearMax }) {
  // Timeline clicks fire this on every filter change; overlapping calls
  // interleave across the storms.json await and write stale ACE/analog blocks
  // into the newer card. Only the latest call may finish the async pass.
  const seq = ++refreshSeq;
  const host = ensureHost();
  const span = yearMax - yearMin + 1;
  const rangeKey = `${yearMin}-${yearMax}`;
  if (span < 1 || span > MAX_YEARS) {
    host.hidden = true;
    host.innerHTML = '';
    return;
  }
  if (dismissedRange === rangeKey) {
    host.hidden = true;
    return;
  }
  const landfalls = getLandfalls().filter(lf => lf.year >= yearMin && lf.year <= yearMax);
  if (!landfalls.length) {
    host.hidden = false;
    host.innerHTML = `
      <header>
        <h3>${yearMin === yearMax ? `${yearMin} season` : `${yearMin}–${yearMax}`}</h3>
        <button class="season-close" type="button" aria-label="Hide season summary">×</button>
      </header>
      <p class="season-empty">No US landfalls in this range.</p>`;
    host.querySelector('.season-close').addEventListener('click', () => {
      dismissedRange = rangeKey;
      host.hidden = true;
    });
    return;
  }
  // Gather unique storms.
  const storms = new Map();
  for (const lf of landfalls) {
    if (!storms.has(lf.storm_id)) storms.set(lf.storm_id, { id: lf.storm_id, name: lf.name, year: lf.year, peakCat: lf.category });
    else if (lf.category > storms.get(lf.storm_id).peakCat) storms.get(lf.storm_id).peakCat = lf.category;
  }
  const stormList = Array.from(storms.values());

  // Landfall count by Saffir tier.
  const tierCounts = { ts: 0, c1: 0, c2: 0, c3: 0, c4: 0, c5: 0 };
  let strongest = null;
  for (const lf of landfalls) {
    const c = lf.category;
    if (c <= 0) tierCounts.ts++;
    else if (c === 1) tierCounts.c1++;
    else if (c === 2) tierCounts.c2++;
    else if (c === 3) tierCounts.c3++;
    else if (c === 4) tierCounts.c4++;
    else if (c >= 5) tierCounts.c5++;
    if (!strongest || c > strongest.category) strongest = lf;
  }

  // Render the synchronous part immediately, then back-fill ACE + impacts.
  host.hidden = false;
  const titleSpan = yearMin === yearMax ? `${yearMin} season` : `${yearMin}–${yearMax} seasons`;
  const tierBlocks = [
    { label: 'TS', count: tierCounts.ts, color: 'var(--cat-ts)' },
    { label: 'C1', count: tierCounts.c1, color: 'var(--cat-1)' },
    { label: 'C2', count: tierCounts.c2, color: 'var(--cat-2)' },
    { label: 'C3', count: tierCounts.c3, color: 'var(--cat-3)' },
    { label: 'C4', count: tierCounts.c4, color: 'var(--cat-4)' },
    { label: 'C5', count: tierCounts.c5, color: 'var(--cat-5)' },
  ];
  const tierHTML = tierBlocks.map(t => `
    <div class="ss-tier ${t.count ? 'has' : 'empty'}" title="${t.label}: ${t.count} landfall${t.count === 1 ? '' : 's'}">
      <span class="ss-tier-dot" style="background:${t.color}"></span>
      <span class="ss-tier-label">${t.label}</span>
      <span class="ss-tier-count">${t.count}</span>
    </div>`).join('');
  const strongestName = strongest ? formatStormName(strongest.name) : 'Unnamed';

  let ensoBadge = '';
  if (yearMin === yearMax) {
    const enso = getEnsoForYear(yearMin);
    if (enso) {
      const cls = enso.phase === 'El Nino' ? 'enso-nino' : enso.phase === 'La Nina' ? 'enso-nina' : 'enso-neutral';
      ensoBadge = `<span class="enso-badge ${cls}" title="ONI ${enso.oni >= 0 ? '+' : ''}${enso.oni.toFixed(1)}">${escapeHtml(enso.phase)}</span>`;
    }
  }

  host.innerHTML = `
    <header>
      <h3>${titleSpan}${ensoBadge}</h3>
      <button class="season-close" type="button" aria-label="Hide season summary">×</button>
    </header>
    <div class="ss-stats">
      <div class="ss-stat">
        <span class="ss-stat-num">${stormList.length}</span>
        <span class="ss-stat-lbl">named storm${stormList.length === 1 ? '' : 's'}</span>
      </div>
      <div class="ss-stat">
        <span class="ss-stat-num">${landfalls.length}</span>
        <span class="ss-stat-lbl">landfall${landfalls.length === 1 ? '' : 's'}</span>
      </div>
      <div class="ss-stat" data-role="ace">
        <span class="ss-stat-num">…</span>
        <span class="ss-stat-lbl">${t('stats.totalACE')}</span>
      </div>
    </div>
    <div class="ss-tiers" role="list">${tierHTML}</div>
    <dl class="ss-superlatives">
      <div>
        <dt>${t('stats.strongest')}</dt>
        <dd>${escapeHtml(strongestName)} ${strongest.year} <span class="ss-meta">${categoryLabel(strongest.category)} · ${escapeHtml(strongest.state)}</span></dd>
      </div>
      <div data-role="deadliest">
        <dt>${t('stats.deadliest')}</dt>
        <dd class="ss-loading">resolving…</dd>
      </div>
      <div data-role="costliest">
        <dt>${t('stats.costliest')}</dt>
        <dd class="ss-loading">resolving…</dd>
      </div>
    </dl>
  `;
  host.querySelector('.season-close').addEventListener('click', () => {
    dismissedRange = rangeKey;
    host.hidden = true;
  });

  // Async pass: ACE + impacts lookup once storms are loaded.
  await ensureStormsLoaded();
  if (seq !== refreshSeq) return;
  let totalACE = 0;
  let deadliest = null;
  let costliest = null;
  for (const s of stormList) {
    const storm = getStorm(s.id);
    if (storm && storm.track) {
      try {
        const ace = computeACE(storm.track);
        if (Number.isFinite(ace?.value)) totalACE += ace.value;
      } catch (e) { /* ignore single-storm ACE failures */ }
    }
    const impacts = getImpactsFor(s.id);
    if (impacts) {
      const d = getFatalityCount(impacts);
      const dmg = getDamageMillions(impacts);
      let dmgAdj = dmg;
      // For costliest comparison, prefer real (CPI-adjusted) USD when the
      // setting is on so a 1900 hurricane can be ranked fairly against 2017.
      if (dmg != null && getSetting('damageMode') === 'real') {
        const r = inflateUSD(dmg, s.year);
        if (r) dmgAdj = r.real;
      }
      if (Number.isFinite(d) && d > 0 && (!deadliest || d > deadliest.value)) {
        deadliest = { storm: s, value: d };
      }
      if (Number.isFinite(dmg) && dmg > 0 && Number.isFinite(dmgAdj) && (!costliest || dmgAdj > costliest.value)) {
        costliest = { storm: s, value: dmgAdj };
      }
    }
  }
  const aceCell = host.querySelector('[data-role="ace"] .ss-stat-num');
  if (aceCell) aceCell.textContent = totalACE > 0 ? totalACE.toFixed(1) : '—';

  const dHost = host.querySelector('[data-role="deadliest"] dd');
  if (dHost) {
    if (deadliest) {
      const n = formatStormName(deadliest.storm.name);
      dHost.classList.remove('ss-loading');
      dHost.innerHTML = `${escapeHtml(n)} ${deadliest.storm.year} <span class="ss-meta">${formatFatalityCount(deadliest.value)} dead</span>`;
    } else {
      dHost.classList.remove('ss-loading');
      dHost.innerHTML = '<span class="ss-meta">no impact records</span>';
    }
  }
  const cHost = host.querySelector('[data-role="costliest"] dd');
  if (cHost) {
    if (costliest) {
      const n = formatStormName(costliest.storm.name);
      const mode = getSetting('damageMode');
      cHost.classList.remove('ss-loading');
      const adjLabel = mode === 'real' ? `${formatMillionsUSD(costliest.value)} <span class="ss-meta">(2024 USD)</span>` : `${formatMillionsUSD(costliest.value)} <span class="ss-meta">${costliest.storm.year} USD</span>`;
      cHost.innerHTML = `${escapeHtml(n)} ${costliest.storm.year} <span class="ss-meta">— ${adjLabel}</span>`;
    } else {
      cHost.classList.remove('ss-loading');
      cHost.innerHTML = '<span class="ss-meta">no impact records</span>';
    }
  }

  if (yearMin === yearMax) {
    renderSeasonAnalogs(host, yearMin, stormList.length, landfalls.length, totalACE);
  }
}

function renderSeasonAnalogs(host, targetYear, stormCount, lfCount, ace) {
  const allLf = getLandfalls();
  const years = new Map();
  for (const lf of allLf) {
    if (!years.has(lf.year)) years.set(lf.year, { storms: new Set(), landfalls: 0, ace: 0 });
    const y = years.get(lf.year);
    y.storms.add(lf.storm_id);
    y.landfalls++;
  }
  const seenForAce = new Set();
  for (const lf of allLf) {
    if (seenForAce.has(lf.storm_id)) continue;
    seenForAce.add(lf.storm_id);
    const storm = getStorm(lf.storm_id);
    if (!storm?.track) continue;
    const bucket = years.get(lf.year);
    if (!bucket) continue;
    try {
      const a = computeACE(storm.track);
      if (Number.isFinite(a?.value)) bucket.ace += a.value;
    } catch { /* skip */ }
  }
  const target = { stormCount, lfCount, ace };
  const maxStorms = Math.max(...[...years.values()].map(v => v.storms.size), 1);
  const maxLf = Math.max(...[...years.values()].map(v => v.landfalls), 1);
  const maxAce = Math.max(...[...years.values()].map(v => v.ace), ace, 1);

  const scored = [];
  for (const [yr, v] of years) {
    if (yr === targetYear) continue;
    const ds = (v.storms.size - target.stormCount) / maxStorms;
    const dl = (v.landfalls - target.lfCount) / maxLf;
    const da = (v.ace - target.ace) / maxAce;
    const dist = Math.sqrt(ds * ds + dl * dl + da * da);
    scored.push({ year: yr, storms: v.storms.size, landfalls: v.landfalls, dist });
  }
  scored.sort((a, b) => a.dist - b.dist);
  const top = scored.slice(0, 3);
  if (!top.length) return;

  const rows = top.map(s => {
    const pct = Math.max(0, Math.round((1 - s.dist) * 100));
    return `<li>${s.year} <span class="ss-meta">${s.storms} storms · ${s.landfalls} landfalls · ${pct}% similar</span></li>`;
  }).join('');

  // Replace, never stack — a stale refresh may have appended one already.
  host.querySelector('.ss-analogs')?.remove();
  const el = document.createElement('div');
  el.className = 'ss-analogs';
  el.innerHTML = `<h4>Similar seasons</h4><ul>${rows}</ul>`;
  host.appendChild(el);
}
