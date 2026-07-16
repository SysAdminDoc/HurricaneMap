"""Pull deaths + damage figures for HurricaneMap's named storms from Wikipedia
infoboxes via the MediaWiki API. Output: data/impacts.json.

Strategy:
  - For every named storm in storms.json (skipping 'UNNAMED' / TS-only / pre-1900
    storms with no Wikipedia coverage), guess the canonical article title and
    fetch the page's wikitext via the MediaWiki API.
  - Parse the {{Infobox hurricane}} template's `Fatalities` and `Damages` fields.
  - Best-effort string extraction; cross-reference is up to the user via the
    existing 'Wikipedia' quicklink.

Output format:
  data/impacts.json = {
    "<storm_id>": {
      "deaths": "1,392 total",
      "damages": "$125 billion (2005 USD)",
      "deaths_total": 1392,
      "damage_usd_nominal": 125000000000,
      "damage_millions_usd": 125000,
      "impact_schema_version": 1,
      "impact_provenance": { ... },
      "wiki_title": "Hurricane Katrina",
      "wiki_url": "https://en.wikipedia.org/wiki/Hurricane_Katrina"
    }, ...
  }

Run anytime to refresh:  python scripts/scrape_impacts.py
"""

from __future__ import annotations

import argparse
import html
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
STORMS = DATA / "storms.json"
OUT = DATA / "impacts.json"

WIKI_API = "https://en.wikipedia.org/w/api.php"
USER_AGENT = "HurricaneMap-ImpactsScraper/0.1 (https://github.com/SysAdminDoc/HurricaneMap)"
IMPACT_SCHEMA_VERSION = 1
SCRAPER_NAME = "scripts/scrape_impacts.py"
DERIVED_IMPACT_FIELDS = {
    "deaths_total", "deaths_min", "deaths_max", "deaths_qualifier",
    "damage_usd_nominal", "damage_millions_usd", "damage_source_units",
    "damage_qualifier", "damage_usd_min", "damage_usd_max",
    "impact_schema_version", "impact_provenance",
}


def http_get(url: str, timeout: int = 30) -> str | None:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read().decode("utf-8", errors="replace")
    except Exception:
        return None


def title_case(name: str) -> str:
    return name[0].upper() + name[1:].lower() if name else name


def candidate_titles(name: str, year: int) -> list[str]:
    """Generate likely Wikipedia article titles for a storm, in priority order."""
    if not name or name == "UNNAMED":
        return []
    n = title_case(name)
    return [
        f"Hurricane {n} ({year})",
        f"Tropical Storm {n} ({year})",
        f"Hurricane {n}",
        f"Tropical Storm {n}",
        f"Hurricane {n} ({year} Atlantic)",
    ]


def search_title(name: str, year: int) -> str | None:
    """Use MediaWiki's search to confirm an article exists."""
    for t in candidate_titles(name, year):
        params = urllib.parse.urlencode({
            "action": "query", "titles": t, "format": "json", "prop": "info",
        })
        url = f"{WIKI_API}?{params}"
        body = http_get(url)
        if not body:
            continue
        try:
            data = json.loads(body)
            pages = data.get("query", {}).get("pages", {})
            for pid, page in pages.items():
                if pid != "-1" and "missing" not in page:
                    return page["title"]
        except json.JSONDecodeError:
            continue
    return None


def fetch_wikitext(title: str) -> str | None:
    params = urllib.parse.urlencode({
        "action": "parse", "page": title, "prop": "wikitext",
        "format": "json", "redirects": "1",
    })
    body = http_get(f"{WIKI_API}?{params}")
    if not body:
        return None
    try:
        data = json.loads(body)
        return data.get("parse", {}).get("wikitext", {}).get("*")
    except json.JSONDecodeError:
        return None


def extract_field(wikitext: str, field_names: list[str]) -> str | None:
    """Pull a value from an Infobox-style wikitext template by field name."""
    if not wikitext:
        return None
    for fname in field_names:
        # Match `| Fatalities = X` or `|Fatalities=X` allowing nested templates,
        # links, and references. We grab everything up to the next field marker.
        m = re.search(
            r"\|\s*" + re.escape(fname) + r"\s*=\s*(.*?)(?:\n\s*\||\n\s*\}\})",
            wikitext, re.DOTALL | re.IGNORECASE,
        )
        if m:
            val = m.group(1).strip()
            # Strip [[wiki|links]] → keep the display text.
            val = re.sub(r"\[\[(?:[^\]|]+\|)?([^\]]+)\]\]", r"\1", val)
            # Strip <ref>...</ref> footnotes.
            val = re.sub(r"<ref[^>]*>.*?</ref>", "", val, flags=re.DOTALL)
            val = re.sub(r"<ref[^/]*/>", "", val)
            # Strip remaining HTML tags.
            val = re.sub(r"<[^>]+>", "", val)
            # Collapse template formatters like {{nowrap|...}} → just the inner.
            val = re.sub(r"\{\{(?:nowrap|small|sortname|formatnum:|US\$|USD\|)([^}]+)\}\}", r"\1", val, flags=re.IGNORECASE)
            # Generic template strip: replace remaining {{...}} with empty.
            val = re.sub(r"\{\{[^}]*\}\}", "", val)
            val = re.sub(r"\s+", " ", val).strip()
            if val and val.lower() not in ("none", "—", "-", "n/a", ""):
                return val[:200]
    return None


def clean_source_text(value: str | None) -> str:
    if value is None:
        return ""
    value = html.unescape(str(value))
    if "â" in value or "Ã" in value:
        try:
            value = value.encode("cp1252").decode("utf-8")
        except UnicodeError:
            pass
    # A legacy decode path replaced the en dash in numeric ranges with U+FFFD.
    # The surrounding digits make this repair unambiguous (`200�250`).
    value = re.sub(r"(?<=\d)\ufffd(?=\d)", "–", value)
    value = value.replace("\xa0", " ").replace("&nbsp;", " ")
    value = re.sub(r"\[[^\]]+\]", "", value)
    value = re.sub(r"\s+", " ", value).strip()
    return value


def parse_numbers(value: str) -> list[float]:
    out = []
    for match in re.findall(r"\d[\d,]*(?:\.\d+)?", value):
        try:
            out.append(float(match.replace(",", "")))
        except ValueError:
            continue
    return out


def parse_deaths(raw: str | None) -> dict:
    text = clean_source_text(raw)
    if not text:
        return {}
    lowered = text.lower()
    if any(token in lowered for token in ("none reported", "no fatalities", "no deaths")) or lowered in {"none", "0"}:
        return {
            "deaths_total": 0,
            "deaths_min": 0,
            "deaths_max": 0,
            "deaths_qualifier": "zero",
        }

    numbers = [int(round(float(n.replace(",", "")))) for n in re.findall(r"\d[\d,]*(?:\.\d+)?", text)]
    if not numbers:
        return {}

    has_range = bool(re.search(r"\d[\d,]*(?:\.\d+)?\s*(?:-|–|—|to)\s*\d", text, re.IGNORECASE))
    has_minimum = any(token in text for token in ("+", "≥")) or "at least" in lowered
    has_direct_indirect = "direct" in lowered and "indirect" in lowered and len(numbers) >= 2

    if has_direct_indirect:
        total = sum(numbers[:2])
        return {
            "deaths_total": total,
            "deaths_min": total,
            "deaths_max": total,
            "deaths_qualifier": "direct_indirect_sum",
        }
    if has_range and len(numbers) >= 2:
        low, high = sorted(numbers[:2])
        return {
            "deaths_total": high,
            "deaths_min": low,
            "deaths_max": high,
            "deaths_qualifier": "range_high",
        }

    total = numbers[0]
    return {
        "deaths_total": total,
        "deaths_min": total,
        "deaths_max": None if has_minimum else total,
        "deaths_qualifier": "minimum" if has_minimum else "exact",
    }


def parse_damage(raw: str | None, suffix: str | None = None, prefix: str | None = None) -> dict:
    text = clean_source_text(raw)
    if not text:
        return {}
    lowered = text.lower()
    if lowered in {"none", "unknown", "n/a", "-", "—"}:
        return {}
    numbers = parse_numbers(text)
    if not numbers:
        return {}
    context = clean_source_text(" ".join(part for part in (prefix, raw, suffix) if part)).lower()
    has_explicit_unit = any(token in context for token in ("trillion", "billion", "million", "thousand"))
    has_plus_expression = bool(re.search(r"\d[\d,]*(?:\.\d+)?\s*\+\s*\d", text))
    has_range = bool(re.search(r"\d[\d,]*(?:\.\d+)?\s*(?:-|–|—|to)\s*\$?\s*\d", text, re.IGNORECASE))
    range_values = sorted(numbers[:2]) if has_range and len(numbers) >= 2 else None
    value = range_values[1] if range_values else (sum(numbers) if has_plus_expression and not has_explicit_unit else numbers[0])

    qualifier = "range_high" if range_values else ("computed_sum" if has_plus_expression and not has_explicit_unit else "exact")
    if not range_values and (any(token in context for token in ("≥", "at least", "over ")) or ("+" in context and not has_plus_expression)):
        qualifier = "minimum"
    elif not range_values and any(token in context for token in ("about", "approx", "approximately", "~")):
        qualifier = "approximate"

    unit = "usd"
    multiplier = 1.0
    if "trillion" in context:
        unit = "usd_trillions"
        multiplier = 1_000_000_000_000.0
    elif "billion" in context:
        unit = "usd_billions"
        multiplier = 1_000_000_000.0
    elif "million" in context:
        unit = "usd_millions"
        multiplier = 1_000_000.0
    elif "thousand" in context:
        unit = "usd_thousands"
        multiplier = 1_000.0
    elif value < 10_000:
        # Legacy scraper rows often lost MediaWiki damage suffix fields. Small
        # bare numbers in this file historically meant millions USD.
        unit = "legacy_assumed_usd_millions"
        multiplier = 1_000_000.0

    usd = int(round(value * multiplier))
    parsed = {
        "damage_usd_nominal": usd,
        "damage_millions_usd": round(usd / 1_000_000, 6),
        "damage_source_units": unit,
        "damage_qualifier": qualifier,
    }
    if range_values:
        parsed["damage_usd_min"] = int(round(range_values[0] * multiplier))
        parsed["damage_usd_max"] = int(round(range_values[1] * multiplier))
    return parsed


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def normalize_impact_record(record: dict, *, parsed_at_utc: str | None = None) -> dict:
    # Rebuild derived fields from the raw strings while preserving the stable
    # raw -> derived -> provenance ordering used by the checked-in dataset.
    out = {key: value for key, value in record.items() if key not in DERIVED_IMPACT_FIELDS}
    raw_deaths = out.get("deaths")
    raw_damage = out.get("damages")
    if raw_deaths:
        out["deaths"] = clean_source_text(raw_deaths)
    if raw_damage:
        out["damages"] = clean_source_text(raw_damage)
    for key in ("damage_prefix", "damage_suffix"):
        if out.get(key):
            out[key] = clean_source_text(out[key])

    out.update(parse_deaths(out.get("deaths")))
    out.update(parse_damage(
        out.get("damages"),
        suffix=out.get("damage_suffix"),
        prefix=out.get("damage_prefix"),
    ))
    out["impact_schema_version"] = IMPACT_SCHEMA_VERSION
    out["impact_provenance"] = {
        "source": "Wikipedia infobox",
        "scraper": SCRAPER_NAME,
        "parsed_at_utc": parsed_at_utc or utc_now(),
    }
    return out


def existing_parsed_at(record: dict, fallback: str) -> str:
    provenance = record.get("impact_provenance")
    if isinstance(provenance, dict):
        parsed_at = provenance.get("parsed_at_utc")
        if isinstance(parsed_at, str) and parsed_at:
            return parsed_at
    return fallback


def normalize_impact_records(records: dict, fallback_stamp: str) -> dict:
    return {
        key: normalize_impact_record(
            records[key],
            parsed_at_utc=existing_parsed_at(records[key], fallback_stamp),
        )
        for key in sorted(records)
    }


def extract_impacts(wikitext: str) -> dict | None:
    if not wikitext:
        return None
    deaths = extract_field(wikitext, ["Fatalities", "Deaths", "Casualties"])
    damage = extract_field(wikitext, ["Damages", "Damage", "Damages (USD)"])
    damage_prefix = extract_field(wikitext, ["Damage-prefix", "Damages-prefix", "Damage prefix"])
    damage_suffix = extract_field(wikitext, ["Damage-suffix", "Damages-suffix", "Damage suffix"])
    if not deaths and not damage:
        return None
    out = {}
    if deaths: out["deaths"] = deaths
    if damage: out["damages"] = damage
    if damage_prefix: out["damage_prefix"] = damage_prefix
    if damage_suffix: out["damage_suffix"] = damage_suffix
    return out


def scrape_one(storm) -> tuple[str, dict | None]:
    name = storm.get("name", "")
    year = storm.get("year", 0)
    sid = storm["id"]
    if not name or name == "UNNAMED" or year < 1900:
        return sid, None
    title = search_title(name, year)
    if not title:
        return sid, None
    wikitext = fetch_wikitext(title)
    impacts = extract_impacts(wikitext)
    if not impacts:
        return sid, None
    impacts["wiki_title"] = title
    impacts["wiki_url"] = f"https://en.wikipedia.org/wiki/{urllib.parse.quote(title.replace(' ', '_'))}"
    return sid, normalize_impact_record(impacts)


def main():
    parser = argparse.ArgumentParser(description="Scrape and normalize Wikipedia storm impact data.")
    parser.add_argument(
        "--normalize-existing",
        action="store_true",
        help="Rewrite the existing impacts.json with normalized numeric fields without network requests.",
    )
    args = parser.parse_args()

    storms = json.loads(STORMS.read_text(encoding="utf-8"))
    eligible = [s for s in storms if s.get("name") and s["name"] != "UNNAMED" and s["year"] >= 1900]

    out = {}
    if OUT.exists():
        try:
            out = json.loads(OUT.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            out = {}

    if args.normalize_existing:
        stamp = utc_now()
        out_sorted = normalize_impact_records(out, stamp)
        OUT.write_text(json.dumps(out_sorted, indent=2, ensure_ascii=False), encoding="utf-8", newline="\n")
        print(f"Normalized {len(out_sorted)} existing impact rows.", file=sys.stderr)
        print(f"Wrote {OUT} ({OUT.stat().st_size / 1024:.1f} KB)", file=sys.stderr)
        return

    print(f"Scraping {len(eligible)} candidate storms...", file=sys.stderr)

    started = time.time()
    with ThreadPoolExecutor(max_workers=4) as ex:
        futures = [ex.submit(scrape_one, s) for s in eligible if s["id"] not in out]
        for i, fut in enumerate(as_completed(futures)):
            try:
                sid, impacts = fut.result()
            except Exception:
                continue
            if impacts:
                out[sid] = impacts
            if (i + 1) % 25 == 0:
                rate = (i + 1) / max(time.time() - started, 0.01)
                print(f"  [{i+1}/{len(futures)}] hits={len(out)} ({rate:.1f}/s)", file=sys.stderr)

    # Sort and write.
    stamp = utc_now()
    out_sorted = normalize_impact_records(out, stamp)
    OUT.write_text(json.dumps(out_sorted, indent=2, ensure_ascii=False), encoding="utf-8", newline="\n")
    print(f"Done. Found impacts for {len(out_sorted)} storms.", file=sys.stderr)
    print(f"Wrote {OUT} ({OUT.stat().st_size / 1024:.1f} KB)", file=sys.stderr)


if __name__ == "__main__":
    main()
