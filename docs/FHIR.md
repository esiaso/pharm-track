# FHIR R4 facade

PharmTrack exposes its medication records as FHIR R4 (4.0.1) resources so that
CliniTrack, a health information exchange or another SynergyOne module can read
them in a standard shape. The facade is **read-only**: writes still go through
the PharmTrack API, and PharmTrack's own tables stay the source of truth.

Base URL: `{PHARMTRACK}/api/v1/fhir/R4` (override the advertised base with
`FHIR_BASE_URL` when it sits behind a gateway). Responses are
`application/fhir+json`. Errors are `OperationOutcome` resources.

## Access

- Bearer token from SynergyOne SSO (or the dev headers locally). Roles:
  `SYSTEM`, `PHARMACIST`, `PRESCRIBER`, `PHARMACY_TECHNICIAN`.
- Send `x-purpose-of-use` (for example `TREATMENT`, `PAYMENT`, `OPERATIONS`).
  It is stored in the access log with each read.
- Searches on patient data **must name a patient** (or an id). A search that
  could return every patient's records is refused with `400`.
- Every response that contains patient data writes a row per patient to the
  access log before it is returned. If that write fails, the request fails.

## Resources

| Resource | Source | Interactions | Search parameters |
|---|---|---|---|
| `Medication` | Drug master | read, search | `_id`, `code` (HPT or ATC, `system\|code` allowed), `status` |
| `MedicationRequest` | Prescription item (one per drug line) | read, search | `patient` (required unless `_id`), `_id`, `status`, `encounter` |
| `MedicationDispense` | Dispense line (one per fill per item) | read, search | `patient` (required unless `_id` or `prescription`), `_id`, `prescription` |
| `AllergyIntolerance` | Allergy | read, search | `patient` (required unless `_id`), `_id`, `clinical-status` |
| `AdverseEvent` | Adverse drug reaction | read, search | `subject` or `patient` (required unless `_id`), `_id` |

All searches take `_count` (default 50, at most 200) and `_offset`. The bundle
has `total` and a `next` link while more results remain.
`GET /metadata` returns the CapabilityStatement.

## Mapping notes

- **Codes.** Medications carry two codings: PPB HPT (`FHIR_HPT_SYSTEM`, default
  `urn:synergyone:codesystem:ppb-hpt`) and WHO ATC (`http://www.whocc.no/atc`).
  PPB has not published a FHIR system URI for HPT codes; set the setting when
  Kenya's registry does.
- **Patients, encounters, practitioners** live in CliniTrack and SSO, so
  references carry an `identifier` (systems set by `FHIR_PATIENT_SYSTEM`,
  `FHIR_ENCOUNTER_SYSTEM`, `FHIR_PRACTITIONER_SYSTEM`). Patient references are
  `Patient/<id>`, or absolute when `FHIR_CLINITRACK_BASE` is set.
- **MedicationRequest.status** is `cancelled` or `completed` from the
  prescription, and `completed` once the first fill and all refills have been
  dispensed; otherwise `active`. `groupIdentifier` is CliniTrack's prescription
  id. `dispenseRequest.numberOfRepeatsAllowed` is the refills authorised.
- **MedicationDispense** has a contained `Medication` with the batch number and
  expiry. `type` is `FF` (first fill) or `RF` (refill). Generic substitutions
  set `substitution.wasSubstituted` with the reason. Returns appear as a note.
- **AllergyIntolerance**: drug-class allergies are coded with the ATC prefix.
  Entered-in-error records have no `clinicalStatus` (invariant ait-2).
  Severity maps to `criticality` (`high` for severe or life-threatening).
- **AdverseEvent**: seriousness `serious` / `non-serious`, outcome from the
  FHIR outcome codes, WHO-UMC causality in `suspectEntity.causality`, the PPB
  reference as `identifier`.
- Extensions use `urn:synergyone:fhir:StructureDefinition/*` (brand name,
  source system, ADR action taken, PPB report status). Publish real
  StructureDefinitions if a national implementation guide needs them.

## To confirm

1. Which Kenyan FHIR implementation guide applies (the Digital Health Agency's
   or a national HIE profile) and its code system URIs, including PPB HPT.
2. Whether consumers need `_include`, `_lastUpdated`, `Patient/$everything`,
   or write interactions. None are offered yet.
3. Profile validation against the official FHIR validator in CI (needs the
   R4 package, which is not bundled).
