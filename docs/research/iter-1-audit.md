# Iter 1: Self-Audit (Phase 5)

> Adversarial review of harvest + scored output. Single-session mode: the auditor is the same agent, known degradation, but the seven-dimension checklist still surfaces drift.

## 1. Source traceability
- ✅ Harvest items derive from prior turn's published Tier-1/2/3/4 list + repo gap analysis.
- ⚠ External-source enumeration (Tropycal, IBTrACS visualizers, Zoom Earth, awesome-meteorology) is referenced but not URL-cited in this iteration. Defer formal source bibliography to iter-2 delta scan.
- ✅ Each scored item maps back to a numbered harvest item.

## 2. Tier placement reasoning
- ACE / RI / Closest-approach / Permalinks / Export all placed in NOW. Justification: lowest-effort, highest-impact, no new dependencies, charter-aligned.
- Onboarding / PWA / unit-toggle deferred to NEXT. Justification: each is multi-day work that would crowd this iteration.
- Billion-Dollar-Disasters / cone / spaghetti deferred to LATER. Justification: external-data integration with non-trivial pipeline.
- ✅ No items placed in NOW that would consume >1 day each.

## 3. Category coverage
- Reviewed in scored.md "Six-dimension category coverage check" table.
- Gap: no testing track. Acceptable per charter (delivery product, not library). If audience expectation shifts, add Playwright smoke tests in a future LATER item.
- Gap: no security track. Acceptable for static client-only site with no auth/PII.

## 4. Internal consistency
- ✅ Implementation order in scored.md matches NOW list.
- ✅ Estimated effort sums to a realistic single-iteration scope.
- ⚠ N4 (permalinks) listed at Effort 2 but interacts with N3 (city selector, must persist), N5 (export menu, no URL impact). Cross-feature integration accounted for in implementation order step 4 (URL state added LAST).

## 5. Adversarial review
- **Could ACE confuse non-experts?** Yes. Mitigation: tooltip explanation on the stat tile.
- **Could RI flag false-positive on data-thin pre-1944 storms?** Possible, older storms have 12h+ obs gaps. Mitigation: only flag when 24h delta has actual obs at both endpoints (no interpolation).
- **Could closest-approach be misleading on extratropical or multi-pass storms?** Edge case. Mitigation: use minimum over entire track, label includes the date so users see context.
- **Could permalinks expose state we don't want to share?** No, only filter values + storm ID + state name. All public.
- **Could KML/GeoJSON export break for storms with null wind/pres?** Yes if not handled. Mitigation: filter nulls in export builder; document in code comments.
- **Could the export menu conflict with the existing action-row?** Layout-wise no, separate row. UX-wise no, clearly labeled separate menu.

## 6. Charter alignment
- ✅ All NOW items stay client-side.
- ✅ All NOW items add zero new dependencies.
- ✅ All NOW items respect dark theme + Catppuccin Mocha tonal palette.
- ✅ All NOW items are research-friendly (export especially).

## 7. File-on-disk
- ✅ `docs/research/iter-1-state-of-repo.md` exists.
- ✅ `docs/research/iter-1-harvest.md` exists.
- ✅ `docs/research/iter-1-scored.md` exists.
- ✅ `docs/research/iter-1-audit.md` (this file) exists.

## Audit verdict

**PASS with documented degradations.** Single-session audit by same model family is weaker signal than cross-family debate. Iter-2+ should engage `codex-direct.sh` if available. Implementation can proceed.
