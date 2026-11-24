# Deploying PharmTrack

PharmTrack runs as two containers built from this repository, plus PostgreSQL 16:

| Image | Built from | Listens on | Notes |
|---|---|---|---|
| `pharmtrack-api` | `apps/api/Dockerfile` | 3000 | NestJS API. Runs scheduled jobs unless `JOBS_ENABLED=false`. Applies migrations on start when `RUN_MIGRATIONS=true`. |
| `pharmtrack-web` | `apps/web/Dockerfile` | 3001 | Next.js app for pharmacy staff. Proxies `/api/*` to the API. |

Build both images from the repository root:

```bash
docker build -f apps/api/Dockerfile -t pharmtrack-api .
docker build -f apps/web/Dockerfile -t pharmtrack-web \
  --build-arg PHARMTRACK_API_URL=http://api:3000 \
  --build-arg NEXT_PUBLIC_SSO_AUTHORITY=https://sso.example/realms/synergyone \
  --build-arg NEXT_PUBLIC_SSO_CLIENT_ID=pharmtrack-web .
```

The web app's API address and `NEXT_PUBLIC_*` SSO settings are fixed when the
image is built, so build one web image per environment.

## Single machine (pilot)

`docker-compose.yml` runs PostgreSQL, the API, one jobs worker and the web app:

```bash
cp apps/api/.env.example .env      # fill in the production settings below
docker compose up -d --build
docker compose ps                  # all four should be healthy
```

The API applies migrations when it starts. The worker is the only service
that runs scheduled jobs.

## Several servers

- **Migrations.** Run `prisma migrate deploy` once per release, as a release
  step or in a single replica (`RUN_MIGRATIONS=true`). Don't run it in every replica.
- **Jobs.** Set `JOBS_ENABLED=false` on the replicas that serve requests, and
  run exactly one replica with `JOBS_ENABLED=true`. The jobs are: outbox
  delivery to CliniTrack and SupplyTrack (every 10 s), SMS sending (every
  minute), refill reminders (07:00), and retention (01:30, when enabled). If
  they run in two places, SMS and integration messages can go out twice.
- **Health checks.** `GET /health` (liveness) and `GET /health/ready`
  (readiness: database reachable and migrated, 503 otherwise). Neither needs a token.
- **Shutdown.** On `SIGTERM` the API finishes in-flight requests and closes
  its database connections.
- **Behind a proxy.** Set `TRUST_PROXY=true` (or a hop count) so client
  addresses and `https` links are right, and set `FHIR_BASE_URL` to the public
  FHIR address.
- **HTTP hardening.** The API sends `nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: no-referrer` and `Cache-Control: no-store` on every API
  response (patient data is never cached), and HSTS in production behind a
  proxy. JSON bodies are limited to 1 MB, except content imports under
  `/api/v1/content/` (25 MB). Each caller is limited to `RATE_LIMIT_PER_MINUTE`
  requests (default 600), counted by their sign-in token, or by address when
  there is none; over the limit gets `429` with `Retry-After`. The limit is per
  API process, so also rate-limit at the proxy. The API docs at `/docs` are off
  in production unless `API_DOCS=true`.
  The web app sends a Content-Security-Policy that only allows its own origin
  (plus the SSO server, from `NEXT_PUBLIC_SSO_AUTHORITY` at build time), and
  refuses to be framed.

## Production settings

The API checks its settings at start-up. With `NODE_ENV=production`, any
error stops it, and the log lists every problem at once.

| Setting | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Use TLS (`?sslmode=require`) when the database is on another host. |
| `AUTH_MODE=oidc`, `SSO_ISSUER`, `SSO_AUDIENCE` | yes | `dev-headers` is refused in production. |
| `CLINITRACK_BASE_URL`, `CLINITRACK_TOKEN` | yes | `https` expected; localhost is refused. |
| `SUPPLYTRACK_BASE_URL`, `SUPPLYTRACK_TOKEN` | yes | As above. |
| `SMS_PROVIDER=africastalking`, `AFRICASTALKING_USERNAME`, `SMS_API_KEY`, `SMS_SENDER_ID`, `SMS_WEBHOOK_SECRET` | for SMS | See **SMS through Africa's Talking** below. `http` with `SMS_API_URL` posts to a generic gateway instead. `log` only writes messages to the log (a warning in production). |
| `JOBS_ENABLED` | no | `false` on request-serving replicas when you run a separate worker. |
| `RUN_MIGRATIONS` | no | `true` in the one place that applies migrations. |
| `TRUST_PROXY` | behind a proxy | `true` or the number of proxy hops. |
| `FHIR_BASE_URL` | recommended | Public base for FHIR links. |
| `RETENTION_ENABLED=true` | yes, for the 7-year policy | See [DATA-PROTECTION.md](DATA-PROTECTION.md). |
| `LABEL_PRINTERS` | for Zebra printing | See below. |
| `RATE_LIMIT_PER_MINUTE` | no | Requests per minute per caller, default 600; `0` turns it off. |
| `API_DOCS` | no | `true` serves `/docs` in production (off by default). |

Everything else has sensible defaults; see `apps/api/.env.example`.

## SMS through Africa's Talking

1. In the Africa's Talking dashboard, create an API key and request a sender
   id (alphanumeric, approved by the networks). Until it is approved, leave
   `SMS_SENDER_ID` empty and messages come from the shared short code.
2. Set `SMS_PROVIDER=africastalking`, `AFRICASTALKING_USERNAME` (your app's
   username; `sandbox` sends to the simulator), `SMS_API_KEY` and
   `SMS_SENDER_ID`.
3. Pick a random `SMS_WEBHOOK_SECRET` of 16 or more characters and set the SMS
   delivery-report callback in the dashboard to
   `https://<public API address>/api/v1/notifications/sms/africastalking/delivery-reports?token=<secret>`.
   Reports without the right token are refused.

Messages show as Sent when Africa's Talking accepts them, then Delivered or
Failed when the report arrives. A refusal that cannot change on retry (invalid
number, number blacklisted, wrong API key) fails at once; others are retried
up to 5 times with back-off. Set each facility's name, phone and wording on
the **Settings** screen first, so messages don't say "the pharmacy".

## Zebra label printers

Dispensing labels are produced as ZPL. They can be printed in two ways:

1. **Network printers.** List each store's printer in `LABEL_PRINTERS`, for
   example `{"STORE-OPD":"10.0.5.20:9100","STORE-IPD":"zebra-ipd.local"}`.
   The port defaults to 9100. The API sends the job over raw TCP, so the API
   (or the worker, if it's the only replica that can reach the facility LAN)
   must be able to reach the printer. The dispense screen then shows **Print on Zebra**.
2. **USB printers or no network route.** **Download ZPL file** on the dispense
   screen, then send the file to the printer, for example with Zebra Setup
   Utilities or `lp -d <zebra-queue> -o raw labels.zpl`.

Label size defaults to 76 x 51 mm (3 x 2 in) at 203 dpi. Change it with
`LABEL_WIDTH_MM` (50 to 120), `LABEL_HEIGHT_MM` (45 to 200) and `LABEL_DPI`
(203, 300 or 600). Each label has:

- the facility name and phone, from the facility profile (set on the
  **Settings** screen by an administrator);
- the patient name (if typed on the screen) or the patient id;
- the medicine, strength, form and quantity;
- the directions and any counselling notes;
- "Keep out of reach of children", plus "CONTROLLED DRUG" when it applies;
- the batch and expiry;
- the dispensing date and pharmacist;
- the prescription reference.

Text is sent as UTF-8, so Swahili and accented names print correctly.

## Before go-live

- Back up the database daily, and keep backups for no longer than the
  retention policy needs. Test a restore.
- Encrypt the database volume and backups at rest.
- Register the facility (and the hosting and SMS processors) with the ODPC.
  See [DATA-PROTECTION.md](DATA-PROTECTION.md).
- Load the official code lists and rule sets. See [CLINICAL-CONTENT.md](CLINICAL-CONTENT.md).
- Set each facility's name, phone and SMS wording on the **Settings** screen.
- Print a test label on each store's printer and check it against the label size.
