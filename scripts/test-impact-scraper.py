from scrape_impacts import (
    clean_source_text,
    normalize_impact_record,
    normalize_impact_records,
    parse_damage,
)


range_damage = parse_damage("$200–250 million (2018 USD)")
assert range_damage == {
    "damage_usd_nominal": 250_000_000,
    "damage_millions_usd": 250.0,
    "damage_source_units": "usd_millions",
    "damage_qualifier": "range_high",
    "damage_usd_min": 200_000_000,
    "damage_usd_max": 250_000_000,
}
assert clean_source_text("$200\ufffd250 million") == "$200–250 million"

with_suffix = normalize_impact_record(
    {"damages": "125", "damage_suffix": "million"},
    parsed_at_utc="2020-01-02T03:04:05Z",
)
assert with_suffix["damage_suffix"] == "million"
assert with_suffix["damage_usd_nominal"] == 125_000_000
assert normalize_impact_record(with_suffix)["damage_usd_nominal"] == 125_000_000

records = normalize_impact_records({
    "old": {
        "damages": "$1 million",
        "impact_provenance": {"parsed_at_utc": "2020-01-02T03:04:05Z"},
    },
    "new": {"damages": "$2 million"},
}, "2030-05-06T07:08:09Z")
assert records["old"]["impact_provenance"]["parsed_at_utc"] == "2020-01-02T03:04:05Z"
assert records["new"]["impact_provenance"]["parsed_at_utc"] == "2030-05-06T07:08:09Z"

print("impact scraper normalization ok")
