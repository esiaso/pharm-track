# Clinical content

PharmTrack's safety checks are only as good as the content behind them. This
page covers what content PharmTrack needs, where it comes from, the file
formats, and how changes are reviewed. PharmTrack ships **no clinical rules**
of its own: the sample rules created by `npm run seed` are format examples for
development, not guidance.

## What is needed and who provides it

| Content | Source | Who loads it | Where |
|---|---|---|---|
| WHO ATC codes and DDDs | WHO Collaborating Centre for Drug Statistics Methodology (ATC/DDD Index). Check the licence terms for the electronic file. | Administrator | Clinical content → Code sets |
| PPB HPT codes | Pharmacy and Poisons Board HPT code list (format still to confirm, see ARCHITECTURE.md assumptions) | Administrator | Clinical content → Code sets |
| Drug–drug interactions | The facility's Medicines and Therapeutics Committee (MTC), or a licensed interaction knowledge base exported to CSV | Pharmacist, then a second pharmacist approves | Clinical content → Safety rules |
| Drug–disease contraindications (ICD-10 / ICD-11) | As above | As above | As above |
| Dose limits (age, weight, renal, hepatic) | As above, or national guidelines | As above | As above |
| Facility formularies | Each facility's MTC | Pharmacist | Clinical content → Formulary files |
| Drug master (products stocked) | Pharmacy, coded with HPT and ATC | Pharmacist | Clinical content → Formulary files |

## How every import works

1. **Check first.** Every upload is validated and shows what it would change
   (new, changed, unchanged, retired or removed, and every problem by line
   number) before anything is written. The API takes `dryRun: true`; the
   screens always check before they offer to apply.
2. **Same rules everywhere.** The web screens, the API (`/api/v1/content/...`)
   and the command line use the same code.
3. **Recorded.** Each import is kept in the import history and the audit log
   with who ran it.

Files can be comma, semicolon or tab separated, UTF-8 (with or without BOM).
Column names are not case sensitive and common aliases are accepted. Each
screen has a **Download template** link with the exact columns.

## Code lists (WHO ATC, PPB HPT)

- **Partial update** adds and changes codes only.
- **Full release** also marks every loaded code that is missing from the file
  as *retired in* that release. A full release is refused if any row has a
  problem (otherwise valid codes with a typo would be retired), and needs an
  explicit "load anyway" when it would retire more than a quarter of the loaded
  codes (usually the wrong file).
- Retired codes stay on existing drugs, but such drugs are listed under
  **Drugs that need re-coding**, and new or edited drugs cannot use a retired
  code. Drugs whose HPT product PPB lists as WITHDRAWN, CANCELLED, SUSPENDED or
  DEREGISTERED are listed there too.
- The WHO export lists a substance once per DDD (one row per route or form).
  PharmTrack keeps every DDD (`AtcDdd`) and stores the oral one (or the first)
  on the code for reports.

| Column | Aliases | Notes |
|---|---|---|
| `atc_code` | ATC code, code | Required. Parents must be in the file or already loaded. |
| `atc_level_name` | name | Required |
| `ddd`, `u`, `adm_r`, `note` | DDD unit, route | Level-5 codes only. `1,5` and `1.5` both work. |

| Column | Aliases | Notes |
|---|---|---|
| `hpt_code` | code, product_code | Required, must match `HPT_CODE_PATTERN` |
| `description` | product_name, name | Required |
| `category`, `ppb_status` | status, registration_status | Optional |

## Safety rule sets

A rule set is one file of one kind of rule from one **source** (for example
"Facility MTC" version 2026.1).

1. A pharmacist loads it. Every row must be valid, every ATC code or class must
   be in the loaded (not retired) ATC list, and dose limits for one product must
   name a drug in the drug master. It is saved as a **draft**: drafts are never
   used by the safety check.
2. A **different** pharmacist opens it, sees how it differs from the active
   version from the same source (rules added, removed, changed and which
   fields), and activates or rejects it. The pharmacist who loaded a set cannot
   activate it.
3. Activating retires the previous active set from the same source in the same
   transaction, so there is never a moment with both or neither.
4. An active set can be retired with a reason; its rules stop being checked at
   once.

Rules entered before rule sets existed (the sample seed) are shown as "also
active" and are not part of any set.

| Kind | Columns |
|---|---|
| Interactions | `atc_a`, `atc_b`, `severity` (MINOR, MODERATE, MAJOR, CONTRAINDICATED), `description`, `management`, `ref` |
| Contraindications | `atc`, `diagnosis_system` (ICD10 default, or ICD11), `diagnosis_code` (code or prefix), `severity` (INFO, WARNING, HARD_STOP), `rationale`, `ref` |
| Dose limits | `hpt_code` **or** `atc`, `route`, `min_age_months`, `max_age_months`, `min_weight_kg`, `max_weight_kg`, `crcl_below`, `hepatic_impairment` (yes/no), `dose_unit`, `per_kg` (yes/no), `max_single_dose`, `max_daily_dose`, `severity` (default WARNING), `note`, `ref` |

How severities become alerts is described under *Safety policy* in
[ARCHITECTURE.md](ARCHITECTURE.md). Download an active set as CSV to edit it
and load the next version.

## Facility formulary and drug master

- **Facility formulary**: `hpt_code`, `status` (ACTIVE, RESTRICTED,
  NON_FORMULARY, DISCONTINUED), `approval_required_by` (required for
  RESTRICTED), `restriction_note`. A full load removes the facility's entries
  that are not in the file (those drugs fall back to their suite-wide status).
  Download one facility's formulary and load it into another to copy it.
- **Drug master**: one row per product, matched on `hpt_code`. New products are
  created; existing ones are updated only in the columns that differ, and blank
  optional columns keep the current value. Each change goes through the normal
  path: a new version with the reason given, the audit log, and a
  `drug.upserted` event to CliniTrack's prescription pad.

## Command line

For large files or scheduled loads, on a machine with database access:

```bash
npm run content:import -w apps/api -- atc ./ATC_DDD_2026.csv --release WHO-ATC-2026 --mode FULL --user ops.jane --dry-run
npm run content:import -w apps/api -- hpt ./hpt.csv --release PPB-HPT-2026-11 --mode FULL --user ops.jane
npm run content:import -w apps/api -- interactions ./ddi.csv --source "Facility MTC" --name "MTC interactions" --version 2026.1 --user pharm.otieno
npm run content:import -w apps/api -- facility-formulary ./fac1.csv --facility FAC-1 --mode FULL --user pharm.otieno
npm run content:import -w apps/api -- drugs ./master.csv --reason "Annual review" --user pharm.otieno
```

It prints the same summary as the screens and exits with code 1 if any row has
a problem. Rule sets loaded this way are still drafts that a pharmacist
activates in the web app.
