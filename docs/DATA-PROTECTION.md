# Data protection review (Kenya)

A review of how PharmTrack handles personal data against the **Data Protection
Act, 2019** (DPA) and its 2021 regulations, with what the software now does and
what is still open. It is an engineering review, not legal advice. The facility's
data protection officer (DPO) or counsel should confirm the open items. The
Health Act 2017 (confidentiality) and the Digital Health Act 2023 also apply to
health data and are worth checking alongside.

## What PharmTrack holds

| Data | Why | Where from |
|---|---|---|
| Patient id, encounter id (CliniTrack ids) | Link prescriptions, fills and safety records to a patient | CliniTrack |
| Prescriptions, dispensing, batches, labels, counselling notes | Dispensing and medication safety | CliniTrack and pharmacy staff |
| Allergies, adverse drug reactions | Safety checks, PPB pharmacovigilance | CliniTrack and pharmacy staff |
| Clinical context sent with a prescription (age, weight, pregnancy, renal function, diagnoses) | Safety checks | CliniTrack |
| Controlled drug register | Legal record | Pharmacy staff |
| First name, mobile number, SMS consent, language | Refill and collection SMS | CliniTrack (mirrored) |
| SMS messages sent | Delivery tracking | PharmTrack |
| Access log, audit log | Accountability | PharmTrack |

PharmTrack holds **no names (beyond the SMS first name), national ids,
addresses or dates of birth**. Demographics stay in CliniTrack (data
minimisation, DPA s.25(c)).

Health data is **sensitive personal data** (s.2, s.44). Processing it is allowed
here because it is done by or under the responsibility of health care providers
for care, under a duty of confidentiality (s.46), and to meet legal obligations
(pharmacy registers, pharmacovigilance).

## Review against the Act

| Requirement | Status in PharmTrack |
|---|---|
| **Lawful basis and purpose** (s.25, s.30, s.46) | Data is used for dispensing, safety, billing through CliniTrack, legal registers and reporting. Reports to SHA/DHA and SupplyTrack carry codes and counts, not patient ids. |
| **Consent for SMS** (s.30, s.32) | SMS goes only to patients who opted in (mirrored from CliniTrack). **New:** consent is checked again when each message is sent, withdrawing consent stops messages already waiting, and the original consent time is kept while consent continues. |
| **Data minimisation** (s.25(c)) | Only the SMS first name is kept. **New:** FHIR searches on patient data must name a patient, so the facade cannot be used to copy every patient's records. |
| **Accountability: who saw what** (s.25, s.41) | **New:** a patient access log. Every API or FHIR response that returns a patient's data writes who, when, what, from which facility and for what stated purpose (`x-purpose-of-use`). If the log cannot be written, the data is not returned. Administrators search it on the Data protection screen. Changes were already in the audit log. |
| **Right of access** (s.26(b)) | **New:** a full JSON export of everything PharmTrack holds for a patient, including who has read their data. |
| **Rectification** (s.40) | Allergies and ADRs can be corrected or marked entered in error; every change is audited. Prescriptions are corrected in CliniTrack. |
| **Erasure** (s.40) | **New:** SMS contact details can be erased on request (phone number and first name removed, SMS stopped, phone numbers removed from past messages). Clinical records are kept: they are needed for care and legal registers, which s.40 allows. |
| **Retention** (s.39) | **New:** a nightly retention job, off until `RETENTION_ENABLED=true`, with a preview and a manual run. Policy: patient records and logs are kept for **7 years**. A patient's records (prescriptions, dispensing, controlled-drug entries, allergies, ADRs, refills, SMS, contact details) are removed together once the patient has had no activity in PharmTrack for 7 years, so nothing is removed while a patient is still in care. The access log and audit log keep 7 years. Short-lived copies go sooner: SMS text and number 90 days; delivered integration payloads and stored retry replies 90 days; contact details 30 days after opt-out. |
| **Security by design** (s.41) | SSO with roles, every write audited, idempotent integrations, dev-header sign-in refused in production. Encryption at rest and backups belong to the hosting setup (see open items). |
| **Breach notification** (s.43: Data Commissioner within 72 hours) | The access and audit logs give the evidence needed. A breach procedure for the suite is still needed. |
| **Data protection impact assessment** (s.31) | Done once for the whole SynergyOne suite (CliniTrack, PharmTrack, SupplyTrack), not per module. This review is PharmTrack's input to it. |
| **Registration with the ODPC** (s.18, Registration Regulations 2021) | The facility (data controller) and any hosting or SMS provider (processors) need to be registered. Health care is one of the sectors that must register. |
| **Transfers outside Kenya** (s.48 to s.50, General Regulations 2021) | Check where the database, backups and the SMS gateway are hosted. Confirm whether the regulations require this data to be processed and stored in Kenya. |

## Open items for the DPO or counsel

Decided: patient records and logs are kept for 7 years, and the DPIA is done
for SynergyOne as a whole.

1. **Controlled drug register**: check that the Narcotic Drugs and Psychotropic
   Substances Act does not require a register entry to outlive the patient's
   7-year period. Today it is removed with the patient's other records.
2. **Backups** keep removed records until they expire; set backup retention to
   match.
3. **SMS wording**: the built-in refill messages name the medicine, which on a
   shared phone reveals health information. Administrators can now switch each
   facility to wording without the medicine name on the **Settings** screen
   (one button for all messages). Decide whether that should be the default
   for the whole suite.
4. **Processor agreements** with the SMS gateway and the hosting provider, and
   where each stores data.
5. **Erasure across the suite**: CliniTrack is the source of contact details.
   An erasure must also be done there, or CliniTrack will send the details
   again on its next update.
6. **Encryption at rest and backup retention**: set on the database and backup
   storage. Backups keep data the retention job has removed until they expire.
7. **Queue screens** (dispensing queue, refill lists) are not logged per
   patient; detail screens, patient records and FHIR are. Decide whether
   list views must be logged too.
8. **Breach procedure** for SynergyOne as a whole, alongside the suite DPIA.

## Settings

| Setting | Default | Meaning |
|---|---|---|
| `RETENTION_ENABLED` | `false` | Run the retention job nightly at 01:30 Nairobi time |
| `RETENTION_SMS_CONTENT_DAYS` | 90 (min 7) | Remove SMS text and number after this |
| `RETENTION_INTEGRATION_PAYLOAD_DAYS` | 90 (min 30) | Clear delivered CliniTrack/SupplyTrack payloads and stored retry replies |
| `RETENTION_CONTACT_AFTER_OPT_OUT_DAYS` | 30 | Remove phone and first name this long after opt-out |
| `RETENTION_ACCESS_LOG_DAYS` | 2555 (7 years, min 365) | Delete access log rows older than this |
| `RETENTION_AUDIT_LOG_DAYS` | 2555 (7 years, min 365) | Delete audit log rows older than this |
| `RETENTION_PATIENT_RECORDS_DAYS` | 2555 (7 years, min 365) | Remove all of a patient's records once they have had no activity for this long (at most 500 patients per run) |

## API

All under `/api/v1/privacy`, administrators only:

- `GET /access-log?patientId=&actorId=&from=&to=&limit=`
- `GET /patients/:patientId/export`
- `POST /patients/:patientId/erase-contact` with `{ "reason": "…" }`
- `GET /retention` (policy, records due now, last run) and `POST /retention/run`
