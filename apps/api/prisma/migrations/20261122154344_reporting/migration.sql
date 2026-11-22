-- CreateEnum
CREATE TYPE "ReportKind" AS ENUM ('PHARMACY_RETURN', 'STOCK_OUT');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'SUPERSEDED');

-- CreateTable
CREATE TABLE "StockOutEpisode" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "hptCode" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "StockOutEpisode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportRun" (
    "id" TEXT NOT NULL,
    "kind" "ReportKind" NOT NULL,
    "facilityId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "periodFrom" TIMESTAMP(3) NOT NULL,
    "periodTo" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'DRAFT',
    "data" JSONB NOT NULL,
    "summary" JSONB NOT NULL,
    "checks" JSONB NOT NULL,
    "generatedBy" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedBy" TEXT,
    "submittedAt" TIMESTAMP(3),
    "externalRef" TEXT,
    "amendsId" TEXT,

    CONSTRAINT "ReportRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StockOutEpisode_storeId_hptCode_idx" ON "StockOutEpisode"("storeId", "hptCode");

-- CreateIndex
CREATE INDEX "StockOutEpisode_startedAt_idx" ON "StockOutEpisode"("startedAt");

-- CreateIndex
CREATE INDEX "ReportRun_kind_facilityId_period_idx" ON "ReportRun"("kind", "facilityId", "period");
