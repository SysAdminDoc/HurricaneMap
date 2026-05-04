// Season summary card. Surfaces when the year filter narrows to a small
// window (1-3 years). Shows total named storms touching the US, landfall
// count by Saffir tier, total ACE, strongest landfall, deadliest, costliest.
import { getLandfalls, getStorm, getImpactsFor, ensureStormsLoaded, categoryLabel } from './data.js';
import { computeACE } from './metrics.js';
import { getPaletteColor } from './settings.js';

const HOST_ID = 'season-summary';
const MAX_YEARS = 3;

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

// "1,601 total" / "14+" / "1 indirect" / "500000" / "—" → number or null.
function parseDeaths(s) {
  if (!s) return null;
  const m = String(s).replace(/[,\s]/g, '').match(/^(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}
// Damage strings are millions-USD per repo convention but inconsistent.
// Treat the leading number as millions; "1110" → $1.11B, "3.75" → $3.75M.
function parseDamageMillions(s) {
  if (!s) return null;
  const m = String(s).replace(/[,\s]/g, '').match(/^(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : null;
}
function fmtUSD(millions) {
  if (millions == null) return '—';
  if (millions >= 1000) return `$${(millions / 1000).toFixed(1)}B`;
  if (millions >= 1) return `$${millions.toFixed(1)}M`;
  return `$${(millions * 1000).toFixed(0)}K`;
}
function fmtDeaths(n) {
  if (n == null) return '—';
  if (n >= 10000) return `${(n / 1000).toFixed(0)}k`;
  if (n >= 1000) return n.toLocaleString();
  return String(n);
}

export async function refreshSeasonSummary({ yearMin, yearMax }) {
  const host = ensureHost();
  const span = yearMax - yearMin + 1;
  if (span < 1 || span > MAX_YEARS) {
    host.hidden = true;
    host.innerHTML = '';
    return;
  }
  const landfalls = getLandfalls().filter(lf => lf.year >= yearMin && lf.year <= yearMax);
  if (!landfalls.length) {
    host.hidden = false;
    host.innerHTML = `
      <header><h3>${yearMin === yearMax ? `${yearMin} season` : `${yearMin}–${yearMax}`}</h3></header>
      <p class="season-empty">No US landfalls in this range.</p>`;
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
  const strongestName = strongest && strongest.name !== 'UNNAMED' ? titleCase(strongest.name) : 'Unnamed';

  host.innerHTML = `
    <header>
      <h3>${titleSpan}</h3>
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
        <span class="ss-stat-lbl">total ACE</span>
      </div>
    </div>
    <div class="ss-tiers" role="list">${tierHTML}</div>
    <dl class="ss-superlatives">
      <div>
        <dt>Strongest landfall</dt>
        <dd>${strongestName} ${strongest.year} <span class="ss-meta">${categoryLabel(strongest.category)} · ${strongest.state}</span></dd>
      </div>
      <div data-role="deadliest">
        <dt>Deadliest</dt>
        <dd class="ss-loading">resolving…</dd>
      </div>
      <div data-role="costliest">
        <dt>Costliest</dt>
        <dd class="ss-loading">resolving…</dd>
      </div>
    </dl>
  `;
  host.querySelector('.season-close').addEventListener('click', () => {
    host.hidden = true;
    host.dataset.dismissed = 'true';
  });

  // Async pass: ACE + impacts lookup once storms are loaded.
  await ensureStormsLoaded();
  let totalACE = 0;
  let resolved = 0;
  let deadliest = null;
  let costliest = null;
  for (const s of stormList) {
    const storm = getStorm(s.id);
    if (storm && storm.track) {
      try {
        const ace = computeACE(storm.track);
        if (Number.isFinite(ace)) { totalACE += ace; resolved++; }
      } catch (e) { /* ignore single-storm ACE failures */ }
    }
    const impacts = getImpactsFor(s.id);
    if (impacts) {
      const d = parseDeaths(impacts.deaths);
      const dmg = parseDamageMillions(impacts.damages);
      if (d != null && (!deadliest || d > deadliest.value)) deadliest = { storm: s, value: d, raw: impacts.deaths };
      if (dmg != null && (!costliest || dmg > costliest.value)) costliest = { storm: s, value: dmg, raw: impacts.damages };
    }
  }
  const aceCell = host.querySelector('[data-role="ace"] .ss-stat-num');
  if (aceCell) aceCell.textContent = totalACE > 0 ? totalACE.toFixed(1) : '—';

  const dHost = host.querySelector('[data-role="deadliest"] dd');
  if (dHost) {
    if (deadliest) {
      const n = deadliest.storm.name === 'UNNAMED' ? 'Unnamed' : titleCase(deadliest.storm.name);
      dHost.classList.remove('ss-loading');
      dHost.innerHTML = `${n} ${deadliest.storm.year} <span class="ss-meta">${fmtDeaths(deadliest.value)} dead</span>`;
    } else {
      dHost.classList.remove('ss-loading');
      dHost.innerHTML = '<span class="ss-meta">no impact records</span>';
    }
  }
  const cHost = host.querySelector('[data-role="costliest"] dd');
  if (cHost) {
    if (costliest) {
      const n = costliest.storm.name === 'UNNAMED' ? 'Unnamed' : titleCase(costliest.storm.name);
      cHost.classList.remove('ss-loading');
      cHost.innerHTML = `${n} ${costliest.storm.year} <span class="ss-meta">${fmtUSD(costliest.value)} damage</span>`;
    } else {
      cHost.classList.remove('ss-loading');
      cHost.innerHTML = '<span class="ss-meta">no impact records</span>';
    }
  }
}

function titleCase(s) {
  return String(s).toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}
