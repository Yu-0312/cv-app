# Career Ops Combined Job Pool

- Generated: 2026-05-19T04:53:31.894Z
- Main input jobs: 93093
- Upstream input jobs: 2079
- Duplicate jobs removed: 5359
- Output jobs: 89813
- Active output jobs: 89534
- Expired output jobs: 279

## Pool Mix

- Main only: 87760
- Upstream only: 1902
- Main + upstream overlap: 151

## App Tracker Sample

- Sample limit: 1000
- Imported jobs in first slice: 1000
- App-eligible jobs in first slice: 1000
- Main only in first slice: 637
- Upstream only in first slice: 212
- Main + upstream overlap in first slice: 151

## Merge Policy

- Duplicate keys: jobKey, normalized-url, company-title-location
- Duplicate preference: main pool first; fill missing fields from upstream; keep longer thin descriptions
- Ordering: active high-quality jobs first with weighted main/upstream interleave for app tracker comparison
