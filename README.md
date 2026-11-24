# PharmTrack

Pharmacy management for the **SynergyOne** suite: drug formulary coded with
**WHO ATC** and **PPB HPT** codes, medication safety (allergies, interactions,
contraindications, dose limits, pregnancy/lactation, ADRs), dispensing linked to
**SupplyTrack**, billing through **CliniTrack**, and refill tracking with patient
SMS reminders.

- Brief: [docs/PROMPT.md](docs/PROMPT.md)
- Architecture, workflows, phased plan: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Integration contracts: [CliniTrack](docs/api/clinitrack-contract.md) · [SupplyTrack](docs/api/supplytrack-contract.md) · [OpenAPI](docs/api/openapi.json)
- FHIR R4 facade: [docs/FHIR.md](docs/FHIR.md) · Data protection review: [docs/DATA-PROTECTION.md](docs/DATA-PROTECTION.md)
- Deployment (Docker, settings, Zebra printers): [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)
- Load test (a year of data, timings, how to rerun): [docs/LOAD-TEST.md](docs/LOAD-TEST.md)

## Stack

NestJS 11 API (`apps/api`) · Next.js 15 web app (`apps/web`) · PostgreSQL via Prisma.

## Getting started

```bash
npm install                                   # installs both workspaces, generates Prisma client
cp apps/api/.env.example apps/api/.env        # set DATABASE_URL
npm run prisma:migrate -w apps/api            # create the schema
npm run seed -w apps/api                      # sample ATC codes, placeholder HPT codes, sample drugs and rules
npm run stubs -w apps/api                     # local SupplyTrack (:5000), CliniTrack (:4000) and SSO (:4400) stand-ins
npm run dev:api                               # http://localhost:3000, Swagger at /docs
npm run dev:web                               # http://localhost:3001
```

Or run everything in Docker (PostgreSQL, API, jobs worker, web app):
`NODE_ENV=development docker compose up -d --build`. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)
for production settings.

## Web app

The pharmacy web app (`apps/web`) has:

- **Dispensing**: the queue per store, and an order screen to verify (safety checks with override reasons), dispense (quantities, generic substitutes, controlled-drug witness, labels, counselling), print labels (in the browser, or ZPL to a Zebra printer on the network or as a file), send the collection SMS, record returns and cancel.
- **Refills**: due, overdue and upcoming refills for the facility, start a refill, see fills and SMS sent.
- **Patients**: allergies (record, confirm), medication history, adverse drug reactions with PPB report download.
- **Formulary**: search by name, ATC or HPT code, edit with a reason (versioned), facility status, prices, version history.

- **Clinical content** (pharmacists; code lists by administrators): load WHO ATC/DDD and PPB HPT releases, safety rule sets (a second pharmacist approves), facility formularies and the drug master from CSV, each checked before it is applied. See [docs/CLINICAL-CONTENT.md](docs/CLINICAL-CONTENT.md), which also covers the `npm run content:import` command line.
- **Reports** (pharmacists): monthly returns for SHA/DHA (through CliniTrack) and stock-out reports for SupplyTrack, each checked, submitted and amended by version; stock-out days per item; WHO prescribing indicators by prescriber; refill adherence (days covered, late refills) by patient; the controlled-drug register with dispenser, witness and totals per drug; the ADR queue for PPB with due dates and batch export. Tables download as CSV.
- **Data protection** (administrators): the patient access log (who read whose data, when and why), a patient's full data export, removing SMS contact details on request, and the retention job. See [docs/DATA-PROTECTION.md](docs/DATA-PROTECTION.md).
- **Integrations** (pharmacists): messages waiting, failed or dead for CliniTrack and SupplyTrack (administrators can retry), batch recalls with the patients who received each batch, and stock alerts.

### Signing in

Without SSO settings the web app runs in dev mode: the user, role, facility and
store are picked from the chip at the top right and sent as `x-user-id` /
`x-user-roles` headers (API `AUTH_MODE=dev-headers`).

To sign in through SynergyOne SSO (or the local stand-in on :4400):

```bash
# API (apps/api/.env)
AUTH_MODE=oidc
SSO_ISSUER=http://localhost:4400
SSO_AUDIENCE=pharmtrack

# Web (apps/web/.env.local, read at build time)
NEXT_PUBLIC_SSO_AUTHORITY=http://localhost:4400
NEXT_PUBLIC_SSO_CLIENT_ID=pharmtrack-web
```

The local stand-in shows a form to pick a user, role and facility. For a
service account token (role `SYSTEM`):
`curl -d grant_type=client_credentials -d client_id=supplytrack localhost:4400/token`.
See `apps/api/.env.example` and `apps/web/.env.example` for the claim and role mapping settings.

## Tests

```bash
npm test -w apps/api                          # unit tests (e2e is skipped unless E2E_DATABASE_URL is set)
E2E_DATABASE_URL=postgresql://… npm run test:e2e -w apps/api   # end-to-end flow on a throwaway database
npm run openapi -w apps/api                   # regenerate docs/api/openapi.json
```

The end-to-end suite truncates every table in `E2E_DATABASE_URL` (after applying
migrations there with `prisma migrate deploy`), so use a throwaway database.

Browser tests (Playwright, in `e2e/`) drive the web app: every screen, the
dispensing flow from a CliniTrack prescription to Zebra labels, settings, roles,
search, dark mode and the phone layout. They start the stubs, the built API and
the built web app on ports 4000, 5000, 3000 and 3001, and reset the database too:

```bash
npm run build -w apps/api && npm run build -w apps/web
npx playwright install chromium               # once
E2E_DATABASE_URL=postgresql://… npm run test:browser
```
