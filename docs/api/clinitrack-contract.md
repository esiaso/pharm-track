# PharmTrack ↔ CliniTrack contract (v1)

Status: **proposed by PharmTrack**, to be confirmed with the CliniTrack team.
All drugs are identified by **PPB HPT code**, with the **WHO ATC code** alongside.
Service calls use a SynergyOne service account with role `SYSTEM` (an SSO
bearer token, e.g. from the client credentials grant). Any write may carry
`Idempotency-Key`; a retry with the same key and body returns the original
response with header `idempotent-replay: true`, a different body gets `422`.

## A. CliniTrack calls PharmTrack

Base: `{PHARMTRACK}/api/v1`. Full schemas in [openapi.json](openapi.json).

| Purpose | Call |
|---|---|
| Prescription pad drug search | `GET /formulary/drugs?q=&facilityId=` (name, brand, ATC class prefix or HPT code; returns `facilityStatus`, `approvalRequiredBy`) |
| Drug details | `GET /formulary/drugs/by-hpt/{hptCode}` |
| Real-time safety check | `POST /safety/check` |
| Submit a signed prescription | `POST /prescriptions` (201 created, 200 re-delivery, 422 safety blocked) |
| Cancel a prescription | `POST /prescriptions/{id or externalId}/cancel` |
| Medication history | `GET /patients/{patientId}/medication-history` |
| Allergies (read / write) | `GET /patients/{patientId}/allergies`, `POST /allergies` with `externalId` (upsert) |
| SMS contact and consent | `PUT /patients/{patientId}/contact-preferences` |
| Patient asks for a refill | `GET /refills?patientId=`, `POST /refills/{id}/request` |
| Billing outcome | `POST /dispensing/billing-status` |
| Report extracts | `GET /reports/consumption`, `/reports/antimicrobial-use`, `/reports/refills` |

### Safety check

```json
POST /safety/check
{
  "patientId": "PAT-1",
  "facilityId": "FAC-1",
  "context": { "ageMonths": 480, "weightKg": 70, "pregnant": false, "crClMlMin": 85,
               "diagnoses": [{ "system": "ICD10", "code": "E11.9" }] },
  "items": [{ "ref": "L1", "hptCode": "…", "dose": 500, "doseUnit": "mg", "frequencyPerDay": 2, "route": "ORAL" }]
}
→ 200
{
  "alerts": [{ "key": "INTERACTION:L1:L2:…", "itemRef": "L1", "type": "INTERACTION",
               "severity": "WARNING", "message": "…" }],
  "canSign": true,
  "requiresOverride": ["INTERACTION:L1:L2:…"]
}
```

The pad shows alerts, collects a reason for each key in `requiresOverride`, and
blocks signing while `canSign` is false.

### Signed prescription

```json
POST /prescriptions
{
  "externalId": "CT-RX-000123",          // CliniTrack id, idempotency key
  "patientId": "PAT-1", "encounterId": "ENC-9", "prescriberId": "DR-4",
  "facilityId": "FAC-1", "storeId": "STORE-OPD",
  "signedAt": "2026-11-22T09:00:00Z", "priority": "ROUTINE",
  "refillValidityDays": 180,
  "context": { … as above … },
  "items": [{
    "ref": "L1", "hptCode": "…", "atcCode": "A10BA02",
    "dose": 500, "doseUnit": "mg", "frequency": "BD", "frequencyPerDay": 2,
    "route": "ORAL", "durationDays": 30, "quantity": 60, "refills": 2,
    "instructions": "Take with food"
  }],
  "overrides": [{ "key": "INTERACTION:L1:L2:…", "reason": "Benefit outweighs risk" }]
}
```

PharmTrack re-runs the checks. If `atcCode` does not match the formulary for the
HPT code the request is rejected (400), so both systems agree on coding.

## B. PharmTrack sends events to CliniTrack

One endpoint: `POST {CLINITRACK}/integrations/pharmtrack/events`, header
`Idempotency-Key`. CliniTrack must treat a repeated key as success.

```json
{ "type": "dispense.completed", "version": 1, "occurredAt": "…", "idempotencyKey": "…", "payload": { … } }
```

Response `2xx` with optional `{ "reference": "INV-LINE-…" }`. `5xx`, 408 and 429
are retried with backoff; other `4xx` are not.

| Event | When | Payload (main fields) |
|---|---|---|
| `drug.upserted` | Drug created or changed | hptCode, atcCode, genericName, brandNames, strength, dosageForm, route, unitOfIssue, formularyStatus, controlledSchedule, version |
| `price.updated` | New price on a list | hptCode, atcCode, priceListCode, unitPrice, currency, effectiveFrom |
| `prescription.accepted` | Prescription queued | prescriptionId, externalId, status |
| **`dispense.completed`** | **Each dispense (initial or refill)** | see below |
| `dispense.returned` | Patient return | dispenseLineId, billingRef, hptCode, atcCode, quantity, unitPrice, reason |
| `allergy.recorded` | Allergy recorded/changed in PharmTrack | allergyId, patientId, agentType, agentText, hptCode, atcCode, severity, verificationStatus, status |
| `adr.reported` | ADR captured | adrId, patientId, encounterId, hptCode, atcCode, seriousness, onsetDate |

The exact shape of the envelope and each payload is a JSON Schema in
[`events/`](events) (`envelope.schema.json`, `dispense.completed.schema.json`, …).
PharmTrack's tests check every event it sends against these schemas.

### `dispense.completed` (billing)

```json
{
  "dispenseEventId": "uuid",
  "dispenseOrderId": "uuid", "prescriptionId": "uuid", "prescriptionExternalId": "CT-RX-000123",
  "patientId": "PAT-1", "encounterId": "ENC-9", "facilityId": "FAC-1", "storeId": "STORE-OPD",
  "fillType": "REFILL", "fillSequence": 1,
  "priceListCode": "SHA",
  "dispensedAt": "…", "dispensedBy": "user-id",
  "lines": [{
    "dispenseLineId": "uuid",
    "hptCode": "…", "atcCode": "A10BA02", "genericName": "Metformin", "strength": "500 mg",
    "unitOfIssue": "TABLET", "quantity": 60,
    "batchNumber": "B123", "expiryDate": "2027-08-31",
    "unitPrice": 10, "currency": "KES",
    "substitutedFromHptCode": null
  }]
}
```

CliniTrack applies pricing rules and schemes (cash, insurance, SHA), invoices and
claims. `fillType`/`fillSequence` let it apply refill rules (e.g. SHA chronic-care
refills). It returns a `reference` or later calls `POST /dispensing/billing-status`.

## C. SHA / DHA reporting

PharmTrack does not submit to SHA or DHA. CliniTrack does, using the ATC and HPT
codes on every billable line, and can pull coded extracts from `/reports/*`.

Once a month a pharmacist generates the **pharmacy return** for a facility,
reviews its checks (billing failures, retired codes, antimicrobials without a
DDD) and submits it. PharmTrack then sends one `report.submitted` event from the
outbox (schema: [`events/report.submitted.schema.json`](events/report.submitted.schema.json)),
idempotency key `report:<reportId>`. It carries the period, version, a summary,
consumption by ATC/HPT code with DDDs, antimicrobial use, refills and ADR counts.
A corrected return is a new version with `amendsReportId` set to the version it
replaces; CliniTrack should forward the latest version to SHA/DHA and may reply
with a `reference`, which PharmTrack stores and shows.

## D. FHIR and data protection

CliniTrack can read PharmTrack's medication records as FHIR R4 at
`/api/v1/fhir/R4` (see [FHIR.md](../FHIR.md)). Every read of patient data, through
FHIR or the REST API, is recorded in PharmTrack's access log; send
`x-purpose-of-use` (e.g. `TREATMENT`) so the log says why.

When a patient withdraws SMS consent, CliniTrack sends the updated contact
preferences as before; PharmTrack now also cancels SMS already waiting to go
out. When a patient asks for their contact details to be erased, erase them in
CliniTrack first: PharmTrack's copy is a mirror and is overwritten by the next
update from CliniTrack.
