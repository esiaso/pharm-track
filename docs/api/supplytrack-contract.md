# PharmTrack → SupplyTrack contract (v1)

Status: **proposed by PharmTrack**, to be confirmed with the SupplyTrack team.
Items are identified by **PPB HPT code**. Base: `{SUPPLYTRACK}/api/v1`.
Every write carries `Idempotency-Key`; SupplyTrack must return the original
result for a repeated key.

| # | Call | Purpose |
|---|---|---|
| 1 | `GET /stores/{storeId}/items/{hptCode}/batches` | Batches available in the pharmacy store |
| 2 | `POST /reservations` | Reserve specific batches for a dispense |
| 3 | `POST /reservations/{id}/commit` | Deduct reserved stock (dispensed) |
| 4 | `POST /reservations/{id}/release` | Cancel a reservation |
| 5 | `POST /stock/returns` | Put returned medicine back into a batch |

### 1. Batches

```json
→ 200
{ "batches": [ { "batchNumber": "B123", "expiryDate": "2027-08-31", "quantityAvailable": 340 } ] }
```

`quantityAvailable` must exclude stock already reserved. PharmTrack does FEFO
allocation and skips batches that expire before the course would end.

### 2. Reserve

```json
POST /reservations
{ "storeId": "STORE-OPD", "hptCode": "…", "reference": "dispense-order:<uuid>",
  "lines": [ { "batchNumber": "B123", "expiryDate": "2027-08-31", "quantity": 50 },
             { "batchNumber": "B200", "expiryDate": "2028-01-31", "quantity": 10 } ] }
→ 201 { "reservationId": "R-…", "expiresAt": "…" }
→ 409 if any line can no longer be covered
```

Reservations should expire on their own (suggested 30 minutes) if neither
committed nor released.

### 3–4. Commit / release

Empty body. `2xx` on success, including repeats of the same `Idempotency-Key`.
Commit is sent from PharmTrack's outbox, so it can arrive after a short delay and
more than once.

### 5. Returns

```json
POST /stock/returns
{ "storeId": "STORE-OPD", "hptCode": "…", "batchNumber": "B123", "quantity": 7,
  "reason": "Course stopped by doctor", "reference": "dispense-line:<uuid>" }
```

### Events PharmTrack may consume later (phase 2)

`stock.low`, `stock.out`, `batch.recalled` (HPT + batch) so the dispensing screen
can warn and recalled batches can be traced to patients through dispense lines.
