-- CreateEnum
CREATE TYPE "ImportMode" AS ENUM ('FULL', 'PARTIAL');

-- CreateEnum
CREATE TYPE "RuleKind" AS ENUM ('INTERACTION', 'CONTRAINDICATION', 'DOSE_LIMIT');

-- CreateEnum
CREATE TYPE "RuleStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CodeSystem" ADD VALUE 'DRUG_MASTER';
ALTER TYPE "CodeSystem" ADD VALUE 'FACILITY_FORMULARY';

-- AlterTable
ALTER TABLE "AtcCode" ADD COLUMN     "retiredInRelease" TEXT;

-- AlterTable
ALTER TABLE "CodeSetImport" ADD COLUMN     "mode" "ImportMode" NOT NULL DEFAULT 'PARTIAL',
ADD COLUMN     "rowsRetired" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "rowsUnchanged" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Contraindication" ADD COLUMN     "externalRef" TEXT,
ADD COLUMN     "ruleSetId" TEXT,
ADD COLUMN     "status" "RuleStatus" NOT NULL DEFAULT 'ACTIVE';

-- AlterTable
ALTER TABLE "DoseLimitRule" ADD COLUMN     "externalRef" TEXT,
ADD COLUMN     "ruleSetId" TEXT,
ADD COLUMN     "status" "RuleStatus" NOT NULL DEFAULT 'ACTIVE';

-- AlterTable
ALTER TABLE "DrugInteraction" ADD COLUMN     "externalRef" TEXT,
ADD COLUMN     "ruleSetId" TEXT,
ADD COLUMN     "status" "RuleStatus" NOT NULL DEFAULT 'ACTIVE';

-- AlterTable
ALTER TABLE "HptCode" ADD COLUMN     "retiredInRelease" TEXT;

-- CreateTable
CREATE TABLE "AtcDdd" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "ddd" DECIMAL(65,30) NOT NULL,
    "unit" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "release" TEXT NOT NULL,

    CONSTRAINT "AtcDdd_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RuleSet" (
    "id" TEXT NOT NULL,
    "kind" "RuleKind" NOT NULL,
    "name" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "status" "RuleStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "rowsTotal" INTEGER NOT NULL,
    "rowsFailed" INTEGER NOT NULL,
    "errors" JSONB,
    "importedBy" TEXT NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "retiredBy" TEXT,
    "retiredAt" TIMESTAMP(3),

    CONSTRAINT "RuleSet_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AtcDdd_code_route_unit_note_key" ON "AtcDdd"("code", "route", "unit", "note");

-- CreateIndex
CREATE INDEX "RuleSet_kind_source_status_idx" ON "RuleSet"("kind", "source", "status");

-- CreateIndex
CREATE INDEX "Contraindication_ruleSetId_idx" ON "Contraindication"("ruleSetId");

-- CreateIndex
CREATE INDEX "DoseLimitRule_ruleSetId_idx" ON "DoseLimitRule"("ruleSetId");

-- CreateIndex
CREATE INDEX "DrugInteraction_ruleSetId_idx" ON "DrugInteraction"("ruleSetId");

-- AddForeignKey
ALTER TABLE "AtcDdd" ADD CONSTRAINT "AtcDdd_code_fkey" FOREIGN KEY ("code") REFERENCES "AtcCode"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrugInteraction" ADD CONSTRAINT "DrugInteraction_ruleSetId_fkey" FOREIGN KEY ("ruleSetId") REFERENCES "RuleSet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contraindication" ADD CONSTRAINT "Contraindication_ruleSetId_fkey" FOREIGN KEY ("ruleSetId") REFERENCES "RuleSet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoseLimitRule" ADD CONSTRAINT "DoseLimitRule_ruleSetId_fkey" FOREIGN KEY ("ruleSetId") REFERENCES "RuleSet"("id") ON DELETE SET NULL ON UPDATE CASCADE;
