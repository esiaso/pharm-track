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

## Still to watch

- The adherence and controlled-drug reports return 1 to 2 MB for a busy
  facility at their default periods. They are fast enough, but a longer period
  or a whole hospital group would want paging.
- The refill queues show the first 500. A facility with more than 500 overdue
  refills needs paging or a narrower filter.
- These timings are for one user. The API was not tested under many users at
  once, and the rate limit is per API process.
