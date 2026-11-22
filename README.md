# PharmTrack

Pharmacy management for the **SynergyOne** suite: drug formulary coded with
**WHO ATC** and **PPB HPT** codes, medication safety (allergies, interactions,
contraindications, dose limits, pregnancy/lactation, ADRs), dispensing linked to
**SupplyTrack**, billing through **CliniTrack**, and refill tracking with patient
SMS reminders.

- Brief: [docs/PROMPT.md](docs/PROMPT.md)
- Architecture, workflows, phased plan: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Integration contracts: [CliniTrack](docs/api/clinitrack-contract.md) · [SupplyTrack](docs/api/supplytrack-contract.md) · [OpenAPI](docs/api/openapi.json)

## Stack

NestJS 11 API (`apps/api`) · Next.js 15 web app (`apps/web`) · PostgreSQL via Prisma.

## Getting started

```bash
npm install                                   # installs both workspaces, generates Prisma client
cp apps/api/.env.example apps/api/.env        # set DATABASE_URL
npm run prisma:migrate -w apps/api            # create the schema
npm run seed -w apps/api                      # sample ATC codes, placeholder HPT codes, sample drugs and rules
npm run stubs -w apps/api                     # local SupplyTrack (:5000) and CliniTrack (:4000) stand-ins
npm run dev:api                               # http://localhost:3000, Swagger at /docs
npm run dev:web                               # http://localhost:3001
```

## Web app

The pharmacy web app (`apps/web`) has:

- **Dispensing**: the queue per store, and an order screen to verify (safety checks with override reasons), dispense (quantities, generic substitutes, controlled-drug witness, labels, counselling), print labels, send the collection SMS, record returns and cancel.
- **Refills**: due, overdue and upcoming refills for the facility, start a refill, see fills and SMS sent.
- **Patients**: allergies (record, confirm), medication history, adverse drug reactions with PPB report download.
- **Formulary**: search by name, ATC or HPT code, edit with a reason (versioned), facility status, prices, version history.

The user, role, facility and store are picked from the chip at the top right until SynergyOne SSO is connected.

Local requests authenticate with headers until SynergyOne SSO is wired in:
`x-user-id: u1`, `x-user-roles: PHARMACIST` (or PRESCRIBER, PHARMACY_TECHNICIAN,
STORE_KEEPER, ADMINISTRATOR, SYSTEM).

## Tests

```bash
npm test -w apps/api                          # unit tests (e2e is skipped unless E2E_DATABASE_URL is set)
E2E_DATABASE_URL=postgresql://… npm run test:e2e -w apps/api   # end-to-end flow on a throwaway database
npm run openapi -w apps/api                   # regenerate docs/api/openapi.json
```

The end-to-end suite truncates every table in `E2E_DATABASE_URL` (after applying
migrations there with `prisma migrate deploy`), so use a throwaway database.
