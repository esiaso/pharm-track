-- CreateEnum
CREATE TYPE "CodeSystem" AS ENUM ('WHO_ATC', 'PPB_HPT');

-- CreateEnum
CREATE TYPE "FormularyStatus" AS ENUM ('ACTIVE', 'RESTRICTED', 'NON_FORMULARY', 'DISCONTINUED');

-- CreateEnum
CREATE TYPE "ControlledSchedule" AS ENUM ('NONE', 'SCHEDULE_1', 'SCHEDULE_2', 'SCHEDULE_3', 'SCHEDULE_4', 'SCHEDULE_5');

-- CreateEnum
CREATE TYPE "ReproductiveRisk" AS ENUM ('UNKNOWN', 'SAFE', 'CAUTION', 'AVOID', 'CONTRAINDICATED');

-- CreateEnum
CREATE TYPE "InteractionSeverity" AS ENUM ('MINOR', 'MODERATE', 'MAJOR', 'CONTRAINDICATED');

-- CreateEnum
CREATE TYPE "DiagnosisSystem" AS ENUM ('ICD10', 'ICD11');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('INFO', 'WARNING', 'HARD_STOP');

-- CreateEnum
CREATE TYPE "AllergyAgentType" AS ENUM ('DRUG', 'DRUG_CLASS', 'NON_DRUG');

-- CreateEnum
CREATE TYPE "AllergySeverity" AS ENUM ('MILD', 'MODERATE', 'SEVERE', 'LIFE_THREATENING');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('UNCONFIRMED', 'CONFIRMED', 'REFUTED');

-- CreateEnum
CREATE TYPE "RecordStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ENTERED_IN_ERROR');

-- CreateEnum
CREATE TYPE "SourceSystem" AS ENUM ('PHARMTRACK', 'CLINITRACK');

-- CreateEnum
CREATE TYPE "AdrSeriousness" AS ENUM ('NON_SERIOUS', 'SERIOUS_HOSPITALISATION', 'SERIOUS_LIFE_THREATENING', 'SERIOUS_DISABILITY', 'SERIOUS_CONGENITAL_ANOMALY', 'SERIOUS_DEATH');

-- CreateEnum
CREATE TYPE "AdrCausality" AS ENUM ('UNASSESSED', 'CERTAIN', 'PROBABLE', 'POSSIBLE', 'UNLIKELY', 'CONDITIONAL', 'UNASSESSABLE');

-- CreateEnum
CREATE TYPE "AdrOutcome" AS ENUM ('UNKNOWN', 'RECOVERED', 'RECOVERING', 'NOT_RECOVERED', 'RECOVERED_WITH_SEQUELAE', 'FATAL');

-- CreateEnum
CREATE TYPE "PpbReportStatus" AS ENUM ('NOT_SUBMITTED', 'EXPORTED', 'SUBMITTED', 'ACKNOWLEDGED');

-- CreateEnum
CREATE TYPE "PrescriptionStatus" AS ENUM ('SIGNED', 'CANCELLED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "SafetyStage" AS ENUM ('PRESCRIBING', 'VERIFICATION');

-- CreateEnum
CREATE TYPE "SafetyAlertType" AS ENUM ('ALLERGY', 'INTERACTION', 'CONTRAINDICATION', 'DUPLICATE_THERAPY', 'DOSE_LIMIT', 'PREGNANCY', 'LACTATION', 'FORMULARY', 'EARLY_REFILL');

-- CreateEnum
CREATE TYPE "DispenseKind" AS ENUM ('INITIAL', 'REFILL');

-- CreateEnum
CREATE TYPE "DispensePriority" AS ENUM ('STAT', 'URGENT', 'ROUTINE');

-- CreateEnum
CREATE TYPE "DispenseStatus" AS ENUM ('PENDING', 'IN_VERIFICATION', 'VERIFIED', 'PARTIALLY_DISPENSED', 'DISPENSED', 'CANCELLED', 'RETURNED');

-- CreateEnum
CREATE TYPE "BillingStatus" AS ENUM ('PENDING', 'SENT', 'BILLED', 'REVERSED', 'FAILED');

-- CreateEnum
CREATE TYPE "RefillStatus" AS ENUM ('UPCOMING', 'DUE', 'OVERDUE', 'COMPLETED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('SMS');

-- CreateEnum
CREATE TYPE "NotificationPurpose" AS ENUM ('REFILL_REMINDER', 'REFILL_DUE', 'REFILL_OVERDUE', 'READY_FOR_COLLECTION');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'FAILED', 'SKIPPED_NO_CONSENT');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'DELIVERED', 'DEAD');

-- CreateTable
CREATE TABLE "AtcCode" (
    "code" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "parentCode" TEXT,
    "ddd" DECIMAL(65,30),
    "dddUnit" TEXT,
    "dddRoute" TEXT,
    "release" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AtcCode_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "HptCode" (
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT,
    "ppbStatus" TEXT,
    "release" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HptCode_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "CodeSetImport" (
    "id" TEXT NOT NULL,
    "codeSystem" "CodeSystem" NOT NULL,
    "release" TEXT NOT NULL,
    "rowsTotal" INTEGER NOT NULL,
    "rowsCreated" INTEGER NOT NULL,
    "rowsUpdated" INTEGER NOT NULL,
    "rowsFailed" INTEGER NOT NULL,
    "importedBy" TEXT NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "errors" JSONB,

    CONSTRAINT "CodeSetImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Drug" (
    "id" TEXT NOT NULL,
    "hptCode" TEXT NOT NULL,
    "atcCode" TEXT NOT NULL,
    "genericName" TEXT NOT NULL,
    "brandNames" TEXT[],
    "strength" TEXT NOT NULL,
    "strengthValue" DECIMAL(65,30),
    "strengthUnit" TEXT,
    "dosageForm" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "packSize" INTEGER NOT NULL,
    "unitOfIssue" TEXT NOT NULL,
    "controlledSchedule" "ControlledSchedule" NOT NULL DEFAULT 'NONE',
    "formularyStatus" "FormularyStatus" NOT NULL DEFAULT 'ACTIVE',
    "pregnancyRisk" "ReproductiveRisk" NOT NULL DEFAULT 'UNKNOWN',
    "lactationRisk" "ReproductiveRisk" NOT NULL DEFAULT 'UNKNOWN',
    "substitutionGroupId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Drug_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DrugVersion" (
    "id" TEXT NOT NULL,
    "drugId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "changedBy" TEXT NOT NULL,
    "reason" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DrugVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubstitutionGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "SubstitutionGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacilityFormulary" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "drugId" TEXT NOT NULL,
    "status" "FormularyStatus" NOT NULL,
    "approvalRequiredBy" TEXT,
    "restrictionNote" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FacilityFormulary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DrugPrice" (
    "id" TEXT NOT NULL,
    "drugId" TEXT NOT NULL,
    "priceListCode" TEXT NOT NULL,
    "unitPrice" DECIMAL(65,30) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'KES',
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "syncedToClinitrackAt" TIMESTAMP(3),

    CONSTRAINT "DrugPrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DrugInteraction" (
    "id" TEXT NOT NULL,
    "atcPrefixA" TEXT NOT NULL,
    "atcPrefixB" TEXT NOT NULL,
    "severity" "InteractionSeverity" NOT NULL,
    "description" TEXT NOT NULL,
    "management" TEXT,
    "source" TEXT,

    CONSTRAINT "DrugInteraction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contraindication" (
    "id" TEXT NOT NULL,
    "atcPrefix" TEXT NOT NULL,
    "diagnosisSystem" "DiagnosisSystem" NOT NULL,
    "diagnosisPrefix" TEXT NOT NULL,
    "severity" "AlertSeverity" NOT NULL,
    "rationale" TEXT NOT NULL,

    CONSTRAINT "Contraindication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DoseLimitRule" (
    "id" TEXT NOT NULL,
    "drugId" TEXT,
    "atcPrefix" TEXT,
    "route" TEXT,
    "minAgeMonths" INTEGER,
    "maxAgeMonths" INTEGER,
    "minWeightKg" DECIMAL(65,30),
    "maxWeightKg" DECIMAL(65,30),
    "crClBelow" DECIMAL(65,30),
    "hepaticImpairment" BOOLEAN,
    "doseUnit" TEXT NOT NULL,
    "perKg" BOOLEAN NOT NULL DEFAULT false,
    "maxSingleDose" DECIMAL(65,30),
    "maxDailyDose" DECIMAL(65,30),
    "severity" "AlertSeverity" NOT NULL DEFAULT 'WARNING',
    "note" TEXT,

    CONSTRAINT "DoseLimitRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Allergy" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "agentType" "AllergyAgentType" NOT NULL,
    "drugId" TEXT,
    "atcPrefix" TEXT,
    "agentText" TEXT NOT NULL,
    "reaction" TEXT,
    "severity" "AllergySeverity" NOT NULL,
    "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'UNCONFIRMED',
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "source" "SourceSystem" NOT NULL DEFAULT 'PHARMTRACK',
    "externalId" TEXT,
    "recordedBy" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Allergy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdverseDrugReaction" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "encounterId" TEXT,
    "drugId" TEXT NOT NULL,
    "dispenseLineId" TEXT,
    "onsetDate" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "seriousness" "AdrSeriousness" NOT NULL,
    "causality" "AdrCausality" NOT NULL DEFAULT 'UNASSESSED',
    "actionTaken" TEXT,
    "outcome" "AdrOutcome" NOT NULL DEFAULT 'UNKNOWN',
    "reportedBy" TEXT NOT NULL,
    "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ppbReportStatus" "PpbReportStatus" NOT NULL DEFAULT 'NOT_SUBMITTED',
    "ppbReference" TEXT,

    CONSTRAINT "AdverseDrugReaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Prescription" (
    "id" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "encounterId" TEXT NOT NULL,
    "prescriberId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "status" "PrescriptionStatus" NOT NULL DEFAULT 'SIGNED',
    "signedAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clinicalContext" JSONB,

    CONSTRAINT "Prescription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrescriptionItem" (
    "id" TEXT NOT NULL,
    "prescriptionId" TEXT NOT NULL,
    "drugId" TEXT NOT NULL,
    "atcCode" TEXT NOT NULL,
    "hptCode" TEXT NOT NULL,
    "dose" DECIMAL(65,30) NOT NULL,
    "doseUnit" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "frequencyPerDay" DECIMAL(65,30) NOT NULL,
    "route" TEXT NOT NULL,
    "durationDays" INTEGER NOT NULL,
    "quantity" DECIMAL(65,30) NOT NULL,
    "refillsAuthorised" INTEGER NOT NULL DEFAULT 0,
    "instructions" TEXT,
    "quantityDispensed" DECIMAL(65,30) NOT NULL DEFAULT 0,

    CONSTRAINT "PrescriptionItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SafetyAlert" (
    "id" TEXT NOT NULL,
    "prescriptionItemId" TEXT NOT NULL,
    "stage" "SafetyStage" NOT NULL,
    "alertKey" TEXT NOT NULL,
    "type" "SafetyAlertType" NOT NULL,
    "severity" "AlertSeverity" NOT NULL,
    "message" TEXT NOT NULL,
    "overriddenBy" TEXT,
    "overrideReason" TEXT,
    "raisedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SafetyAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DispenseOrder" (
    "id" TEXT NOT NULL,
    "prescriptionId" TEXT NOT NULL,
    "kind" "DispenseKind" NOT NULL DEFAULT 'INITIAL',
    "fillSequence" INTEGER NOT NULL DEFAULT 0,
    "facilityId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "refillScheduleId" TEXT,
    "priority" "DispensePriority" NOT NULL DEFAULT 'ROUTINE',
    "status" "DispenseStatus" NOT NULL DEFAULT 'PENDING',
    "verifiedBy" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DispenseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DispenseLine" (
    "id" TEXT NOT NULL,
    "dispenseOrderId" TEXT NOT NULL,
    "prescriptionItemId" TEXT NOT NULL,
    "drugId" TEXT NOT NULL,
    "substitutedFromDrugId" TEXT,
    "substitutionNote" TEXT,
    "atcCode" TEXT NOT NULL,
    "hptCode" TEXT NOT NULL,
    "quantity" DECIMAL(65,30) NOT NULL,
    "quantityReturned" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "batchNumber" TEXT NOT NULL,
    "expiryDate" TIMESTAMP(3) NOT NULL,
    "supplyReservationId" TEXT NOT NULL,
    "unitPrice" DECIMAL(65,30) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'KES',
    "labelText" TEXT,
    "counsellingNotes" TEXT,
    "dispensedBy" TEXT NOT NULL,
    "dispensedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "billingRef" TEXT,
    "billingStatus" "BillingStatus" NOT NULL DEFAULT 'PENDING',

    CONSTRAINT "DispenseLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ControlledDrugRegisterEntry" (
    "id" TEXT NOT NULL,
    "dispenseLineId" TEXT NOT NULL,
    "drugId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "quantity" DECIMAL(65,30) NOT NULL,
    "dispensedBy" TEXT NOT NULL,
    "witnessedBy" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ControlledDrugRegisterEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefillSchedule" (
    "id" TEXT NOT NULL,
    "prescriptionItemId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "refillsAuthorised" INTEGER NOT NULL,
    "refillsUsed" INTEGER NOT NULL DEFAULT 0,
    "lastDispensedAt" TIMESTAMP(3),
    "nextDueDate" TIMESTAMP(3),
    "earliestRefillDate" TIMESTAMP(3),
    "graceDays" INTEGER NOT NULL DEFAULT 3,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" "RefillStatus" NOT NULL DEFAULT 'UPCOMING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RefillSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientContactPreference" (
    "patientId" TEXT NOT NULL,
    "firstName" TEXT,
    "phoneE164" TEXT,
    "smsOptIn" BOOLEAN NOT NULL DEFAULT false,
    "language" TEXT NOT NULL DEFAULT 'en',
    "consentRecordedAt" TIMESTAMP(3),
    "source" "SourceSystem" NOT NULL DEFAULT 'CLINITRACK',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PatientContactPreference_pkey" PRIMARY KEY ("patientId")
);

-- CreateTable
CREATE TABLE "FacilityProfile" (
    "facilityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FacilityProfile_pkey" PRIMARY KEY ("facilityId")
);

-- CreateTable
CREATE TABLE "SmsTemplate" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT,
    "purpose" "NotificationPurpose" NOT NULL,
    "language" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SmsTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "refillScheduleId" TEXT,
    "dispenseOrderId" TEXT,
    "channel" "NotificationChannel" NOT NULL DEFAULT 'SMS',
    "purpose" "NotificationPurpose" NOT NULL,
    "toAddress" TEXT,
    "body" TEXT NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'QUEUED',
    "dedupeKey" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "scheduledFor" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboxEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),

    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InboxMessage" (
    "idempotencyKey" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resultRef" TEXT,

    CONSTRAINT "InboxMessage_pkey" PRIMARY KEY ("idempotencyKey")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorRole" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AtcCode_parentCode_idx" ON "AtcCode"("parentCode");

-- CreateIndex
CREATE UNIQUE INDEX "Drug_hptCode_key" ON "Drug"("hptCode");

-- CreateIndex
CREATE INDEX "Drug_atcCode_idx" ON "Drug"("atcCode");

-- CreateIndex
CREATE INDEX "Drug_genericName_idx" ON "Drug"("genericName");

-- CreateIndex
CREATE UNIQUE INDEX "DrugVersion_drugId_version_key" ON "DrugVersion"("drugId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "FacilityFormulary_facilityId_drugId_key" ON "FacilityFormulary"("facilityId", "drugId");

-- CreateIndex
CREATE INDEX "DrugPrice_drugId_priceListCode_effectiveFrom_idx" ON "DrugPrice"("drugId", "priceListCode", "effectiveFrom");

-- CreateIndex
CREATE INDEX "DrugInteraction_atcPrefixA_idx" ON "DrugInteraction"("atcPrefixA");

-- CreateIndex
CREATE INDEX "DrugInteraction_atcPrefixB_idx" ON "DrugInteraction"("atcPrefixB");

-- CreateIndex
CREATE INDEX "Contraindication_atcPrefix_idx" ON "Contraindication"("atcPrefix");

-- CreateIndex
CREATE UNIQUE INDEX "Allergy_externalId_key" ON "Allergy"("externalId");

-- CreateIndex
CREATE INDEX "Allergy_patientId_idx" ON "Allergy"("patientId");

-- CreateIndex
CREATE INDEX "AdverseDrugReaction_patientId_idx" ON "AdverseDrugReaction"("patientId");

-- CreateIndex
CREATE INDEX "AdverseDrugReaction_drugId_idx" ON "AdverseDrugReaction"("drugId");

-- CreateIndex
CREATE UNIQUE INDEX "Prescription_externalId_key" ON "Prescription"("externalId");

-- CreateIndex
CREATE INDEX "Prescription_patientId_idx" ON "Prescription"("patientId");

-- CreateIndex
CREATE INDEX "Prescription_facilityId_status_idx" ON "Prescription"("facilityId", "status");

-- CreateIndex
CREATE INDEX "SafetyAlert_prescriptionItemId_idx" ON "SafetyAlert"("prescriptionItemId");

-- CreateIndex
CREATE INDEX "DispenseOrder_storeId_status_priority_idx" ON "DispenseOrder"("storeId", "status", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "DispenseOrder_prescriptionId_fillSequence_key" ON "DispenseOrder"("prescriptionId", "fillSequence");

-- CreateIndex
CREATE INDEX "DispenseLine_dispenseOrderId_idx" ON "DispenseLine"("dispenseOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "ControlledDrugRegisterEntry_dispenseLineId_key" ON "ControlledDrugRegisterEntry"("dispenseLineId");

-- CreateIndex
CREATE UNIQUE INDEX "RefillSchedule_prescriptionItemId_key" ON "RefillSchedule"("prescriptionItemId");

-- CreateIndex
CREATE INDEX "RefillSchedule_facilityId_status_nextDueDate_idx" ON "RefillSchedule"("facilityId", "status", "nextDueDate");

-- CreateIndex
CREATE INDEX "RefillSchedule_patientId_idx" ON "RefillSchedule"("patientId");

-- CreateIndex
CREATE UNIQUE INDEX "SmsTemplate_facilityId_purpose_language_key" ON "SmsTemplate"("facilityId", "purpose", "language");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_dedupeKey_key" ON "Notification"("dedupeKey");

-- CreateIndex
CREATE INDEX "Notification_status_scheduledFor_idx" ON "Notification"("status", "scheduledFor");

-- CreateIndex
CREATE INDEX "Notification_patientId_idx" ON "Notification"("patientId");

-- CreateIndex
CREATE UNIQUE INDEX "OutboxEvent_idempotencyKey_key" ON "OutboxEvent"("idempotencyKey");

-- CreateIndex
CREATE INDEX "OutboxEvent_status_nextAttemptAt_idx" ON "OutboxEvent"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_idx" ON "AuditLog"("actorId");

-- AddForeignKey
ALTER TABLE "AtcCode" ADD CONSTRAINT "AtcCode_parentCode_fkey" FOREIGN KEY ("parentCode") REFERENCES "AtcCode"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Drug" ADD CONSTRAINT "Drug_hptCode_fkey" FOREIGN KEY ("hptCode") REFERENCES "HptCode"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Drug" ADD CONSTRAINT "Drug_atcCode_fkey" FOREIGN KEY ("atcCode") REFERENCES "AtcCode"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Drug" ADD CONSTRAINT "Drug_substitutionGroupId_fkey" FOREIGN KEY ("substitutionGroupId") REFERENCES "SubstitutionGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrugVersion" ADD CONSTRAINT "DrugVersion_drugId_fkey" FOREIGN KEY ("drugId") REFERENCES "Drug"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacilityFormulary" ADD CONSTRAINT "FacilityFormulary_drugId_fkey" FOREIGN KEY ("drugId") REFERENCES "Drug"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrugPrice" ADD CONSTRAINT "DrugPrice_drugId_fkey" FOREIGN KEY ("drugId") REFERENCES "Drug"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoseLimitRule" ADD CONSTRAINT "DoseLimitRule_drugId_fkey" FOREIGN KEY ("drugId") REFERENCES "Drug"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Allergy" ADD CONSTRAINT "Allergy_drugId_fkey" FOREIGN KEY ("drugId") REFERENCES "Drug"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdverseDrugReaction" ADD CONSTRAINT "AdverseDrugReaction_drugId_fkey" FOREIGN KEY ("drugId") REFERENCES "Drug"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrescriptionItem" ADD CONSTRAINT "PrescriptionItem_prescriptionId_fkey" FOREIGN KEY ("prescriptionId") REFERENCES "Prescription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrescriptionItem" ADD CONSTRAINT "PrescriptionItem_drugId_fkey" FOREIGN KEY ("drugId") REFERENCES "Drug"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafetyAlert" ADD CONSTRAINT "SafetyAlert_prescriptionItemId_fkey" FOREIGN KEY ("prescriptionItemId") REFERENCES "PrescriptionItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispenseOrder" ADD CONSTRAINT "DispenseOrder_prescriptionId_fkey" FOREIGN KEY ("prescriptionId") REFERENCES "Prescription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispenseOrder" ADD CONSTRAINT "DispenseOrder_refillScheduleId_fkey" FOREIGN KEY ("refillScheduleId") REFERENCES "RefillSchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispenseLine" ADD CONSTRAINT "DispenseLine_dispenseOrderId_fkey" FOREIGN KEY ("dispenseOrderId") REFERENCES "DispenseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispenseLine" ADD CONSTRAINT "DispenseLine_prescriptionItemId_fkey" FOREIGN KEY ("prescriptionItemId") REFERENCES "PrescriptionItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispenseLine" ADD CONSTRAINT "DispenseLine_drugId_fkey" FOREIGN KEY ("drugId") REFERENCES "Drug"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispenseLine" ADD CONSTRAINT "DispenseLine_substitutedFromDrugId_fkey" FOREIGN KEY ("substitutedFromDrugId") REFERENCES "Drug"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlledDrugRegisterEntry" ADD CONSTRAINT "ControlledDrugRegisterEntry_dispenseLineId_fkey" FOREIGN KEY ("dispenseLineId") REFERENCES "DispenseLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlledDrugRegisterEntry" ADD CONSTRAINT "ControlledDrugRegisterEntry_drugId_fkey" FOREIGN KEY ("drugId") REFERENCES "Drug"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefillSchedule" ADD CONSTRAINT "RefillSchedule_prescriptionItemId_fkey" FOREIGN KEY ("prescriptionItemId") REFERENCES "PrescriptionItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_refillScheduleId_fkey" FOREIGN KEY ("refillScheduleId") REFERENCES "RefillSchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;
