# Load test

A year of activity was generated for five facilities and the calls behind the
busy screens and reports were timed against it. This found two bugs and three
slow reports, which are fixed. Run it again after changes to reports or
queries.

## Data

`apps/api/scripts/load/seed-load.sql` fills a throwaway database with:

| | Rows |
|---|---:|
| Prescriptions (FAC-1 at 300 a day, FAC-2 to FAC-5 at 100 a day) | 255,500 |
| Prescription items | 511,000 |
| Dispense orders (first fills and refills) | 491,868 |
| Dispense lines | 747,368 |
| Safety alerts | 153,587 |
| Refill schedules | 168,422 |
| Controlled-drug register entries | 93,294 |
| SMS notifications | 311,520 |
| Outbox messages | 747,368 |
| Audit log | 766,500 |
| Patient access log | 1,022,000 |

The database is about 2.2 GB. Generating it takes about 1.5 minutes.

## How to run

Never point these at a real database. The generator adds rows, and the API must run with
development sign-in.

```bash
createdb pharmtrack_load
export LOAD_DATABASE_URL=postgresql://pharmtrack:pharmtrack@localhost:5432/pharmtrack_load
DATABASE_URL=$LOAD_DATABASE_URL npx prisma migrate deploy --schema apps/api/prisma/schema.prisma
DATABASE_URL=$LOAD_DATABASE_URL npm run seed -w apps/api
psql "$LOAD_DATABASE_URL" -v ON_ERROR_STOP=1 -f apps/api/scripts/load/seed-load.sql

npm run build -w apps/api
(cd apps/api && DATABASE_URL=$LOAD_DATABASE_URL AUTH_MODE=dev-headers JOBS_ENABLED=false RATE_LIMIT_PER_MINUTE=0 node dist/main.js) &
node apps/api/scripts/load/time-endpoints.mjs http://localhost:3000/api/v1 5
```

## Results

Median of 5 calls with a warm cache, for FAC-1 (the busy facility). The test
ran on a 4-core machine with PostgreSQL on the same host.

| Call | Before | After |
|---|---:|---:|
| Generate the monthly pharmacy return | **failed (500)** | 439 ms |
| Report: consumption, 30 days | 2,403 ms | 102 ms |
| Report: antimicrobial use, 30 days | 2,339 ms | 147 ms |
| Report: prescribing indicators, 30 days | 1,174 ms | 644 ms |
| Refill adherence (one item) | 55 ms | 5 ms |
| Patient medication history | 74 ms | 34 ms |
| Report: adherence, 90 days | 640 ms | 626 ms |
| Report: controlled drugs, 30 days | 375 ms | 387 ms |
| Report: stock-outs, 30 days | 252 ms | 285 ms |
| Dispensing queues, formulary, allergies, ADR queue | 3 to 4 ms | 3 to 4 ms |
| Refills due / overdue (first 500) | 39 ms | 45 ms |
| Order detail, refill detail | 18 to 24 ms | 6 to 30 ms |

## What it found and what changed

- **The monthly return failed for a busy facility.** It looked up ADRs by
  listing every dispense line the facility had ever made as query parameters.
  Past 32,767 lines, about four months at FAC-1, PostgreSQL refuses the query.
  It now starts from the ADRs reported in the month.
- **A second medicine's refill failed.** A prescription with two medicines on
  refill, such as metformin and amlodipine, had both first refills numbered
  "fill 1". A database rule allowed only one fill 1 per prescription, so the
  second refill returned an error. The same happened when a cancelled refill
  was requested again. The rule was removed, because the fill number counts
  fills of one item. A test covers both cases.
- **Consumption and antimicrobial use** loaded every line in the period with
  its drug and ATC code. They now sum in the database (about 20 times faster).
- **Prescribing indicators** load only the fields they use.
- **Indexes** were added for the date-range reports (dispense date,
  prescription date, alert date, register date) and for per-item fill history.
  This is migration `20261123201000_report_indexes`.

## Many users at once

`apps/api/scripts/load/concurrent.mjs` simulates pharmacy staff using the
app together. Each user waits 0.5 to 2 seconds between clicks. The mix of
calls is:

| Share | What |
|---:|---|
| 30% | Dispensing queue |
| 10% | Refill summary |
| 12% | Refill list page |
| 10% | Refill detail |
| 12% | Order detail |
| 10% | Medication history |
| 8% | Patient allergies |
| 4% | Consumption report |
| 2% | Adherence report |
| 2% | Controlled-drug report |

```bash
node apps/api/scripts/load/concurrent.mjs http://localhost:3000/api/v1 50 45   # 50 users, 45 seconds
```

These are the results at FAC-1 for one API process with PostgreSQL on the same 4-core machine:

| Users | Requests/s | p50 | p95 | p99 | Errors |
|---:|---:|---:|---:|---:|---:|
| 25 | 19 | 13 ms | 238 ms | 695 ms | 0 |
| 50, before | 36 | 26 ms | 503 ms | 1,088 ms | 0 |
| 50, after | 38 | 11 ms | 214 ms | 552 ms | 0 |
| 50, no reports | 39 | 8 ms | 65 ms | 298 ms | 0 |

The API runs in one Node.js thread, so a report that takes a second of work
holds up everyone's clicks meanwhile. With the reports left out, 50 users
get a p95 of 65 ms. The changes:

- **The adherence report** had a hidden 5,000-item cap. Above it, a busy
  facility's figures covered an arbitrary subset of its patients. It now
  counts every medicine whose course overlaps the period: 52,994 at FAC-1
  for 90 days.
  - Fill dates come from one query, and the PDC sum adds up date ranges
    instead of marking each day. A test checks the result against the
    day-by-day count.
  - The table pages 200 rows, lowest coverage first. The summary and the CSV
    cover every item.
  - Results are kept for 5 minutes per facility and period, so paging and
    other users don't redo the work. The screen says the figures can be up to
    5 minutes old. The first load takes about 2 seconds at FAC-1.
- **The controlled-drug register** sums its totals in the database and pages
  its entries 200 at a time. The CSV holds up to 50,000 entries. The report
  went from 387 ms to 107 ms, and from 1.8 MB to 113 KB.

## Still to watch

- ~~The adherence and controlled-drug reports return 1 to 2 MB.~~ Fixed: they
  page (see above).
- ~~The refill queues show the first 500.~~ Fixed. The Refills screen pages
  100 at a time and shows the total for each status. It can also find one
  patient's refills. The overview's due and overdue counts come from
  `GET /refills/summary`, so they are exact, not capped at 500. At FAC-1 that
  is 6,794 overdue, or 68 pages.
- At more than about 50 staff on one facility's reports at the same time, run
  two API processes behind the proxy (`JOBS_ENABLED=false` on all but one). The
  rate limit and the adherence cache are per process.
- PostgreSQL's JIT compiler adds about 0.2 s to the adherence query and helps
  nothing here. Consider `jit = off` on the database server.
