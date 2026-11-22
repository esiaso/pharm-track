# Build PharmTrack: the pharmacy management module of the SynergyOne suite

> This is the build prompt agreed with the product owner. It is the source brief
> for everything in this repository. Changes to scope should be made here first.

You are building **PharmTrack**, the pharmacy management system in the SynergyOne suite. It works alongside **CliniTrack** (clinical records, prescribing UI, billing, and SHA/DHA reporting) and **SupplyTrack** (inventory, stock and procurement). PharmTrack is the single source of truth for drug data and medication safety.

## 1. System responsibilities
- **PharmTrack owns** the drug master/formulary, drug coding, safety rules (contraindications, interactions, allergies, adverse effects), the dispensing workflow and pharmacist verification.
- **CliniTrack owns** the prescription pad UI (embedded or launched from the patient encounter), all billing and invoicing, and submission of claims and reports to SHA/DHA.
- **SupplyTrack owns** stock levels, batches/lots, expiry, stores and procurement. Dispensing in PharmTrack reserves and deducts stock through SupplyTrack.

## 2. Drug formulary and management
- Drug master with generic name, brand names, strength, dosage form, route, pack size, unit of issue, controlled-drug schedule, and formulary status (active, restricted, non-formulary, discontinued).
- Every drug carries a **WHO ATC code** (full 5-level hierarchy) and a **PPB HPT code** (Kenya Pharmacy and Poisons Board Health Products and Technologies). These are required, validated and used as the main identifiers in all integrations.
- Search and lookup by name, ATC code, HPT code or therapeutic class.
- Facility-level formularies, restricted-drug approval rules, and generic substitution groups.
- Price list per drug that is synced to CliniTrack for billing.
- Audit trail and versioning on every formulary change.

## 3. Prescribing (prescription pad in CliniTrack)
- PharmTrack exposes formulary search and safety-check APIs. CliniTrack renders the pad.
- The prescription captures patient, encounter, prescriber, drug (ATC + HPT), dose, frequency, route, duration, quantity, refills and instructions.
- Real-time safety checks before signing: allergies, drug-drug interactions, drug-disease contraindications, duplicate therapy, dose limits (age, weight, renal/hepatic), pregnancy and lactation.
- Alerts are graded by severity (info, warning, hard stop). Overrides need a reason and are logged.
- Signed prescriptions are sent to the PharmTrack dispensing queue.

## 4. Dispensing (PharmTrack linked to SupplyTrack)
- Dispensing queue by facility or pharmacy store, with priority and status (pending, in verification, partially dispensed, dispensed, cancelled, returned).
- Pharmacist verification re-runs the safety checks.
- Batch/lot selection is FEFO and comes from SupplyTrack. Stock is reserved and then deducted when dispensed. Returns are restocked.
- Partial dispensing, substitution (with an audit note), labelling and patient counselling notes.
- Controlled-drug register with dual sign-off.
- Each dispense event is sent to CliniTrack as a billable item.

## 5. Billing (in CliniTrack)
- PharmTrack sends dispensed lines (drug, ATC/HPT, quantity, batch, unit price) to CliniTrack.
- CliniTrack handles pricing rules, cash/insurance/SHA schemes, invoicing and payment. PharmTrack only stores the billing reference and status.

## 6. Patient medication safety records
- Allergies (agent, reaction, severity, verified status) shared with CliniTrack.
- Contraindication rules linked to ATC classes and to diagnosis codes (ICD-10/ICD-11).
- Adverse drug reaction (ADR) reporting: capture, causality assessment, outcome, and export in the PPB pharmacovigilance format.
- Medication history and adherence per patient.

## 7. Reporting and SHA/DHA integration
- Through CliniTrack, provide prescribing and dispensing data coded with ATC/HPT for SHA claims and DHA reporting.
- Reports for consumption, stock-outs (with SupplyTrack), ADRs, controlled drugs, formulary compliance, prescriber patterns and antimicrobial use by ATC class.

## 8. Technical requirements
- Versioned REST APIs and events (for example `prescription.signed`, `dispense.completed`, `stock.reserved`) between the three systems. Use idempotent messaging and retries.
- FHIR R4 resources where suitable: Medication, MedicationRequest, MedicationDispense, AllergyIntolerance, AdverseEvent.
- Role-based access for prescriber, pharmacist, pharmacy technician, store keeper and administrator. Use SynergyOne SSO.
- Full audit logs. Compliance with the Kenya Data Protection Act.
- Bulk import and update of ATC and HPT reference code sets.

## Deliverables
Data model, API contracts for each integration, workflow diagrams for prescribing, dispensing and billing, and a phased implementation plan.
