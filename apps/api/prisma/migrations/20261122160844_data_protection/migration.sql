-- AlterTable
ALTER TABLE "PatientContactPreference" ADD COLUMN     "erasedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "PatientAccessLog" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorRole" TEXT NOT NULL,
    "facilityId" TEXT,
    "action" TEXT NOT NULL,
    "purpose" TEXT,
    "path" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PatientAccessLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetentionRun" (
    "id" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "trigger" TEXT NOT NULL,
    "actorId" TEXT,
    "results" JSONB NOT NULL,

    CONSTRAINT "RetentionRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PatientAccessLog_patientId_at_idx" ON "PatientAccessLog"("patientId", "at");

-- CreateIndex
CREATE INDEX "PatientAccessLog_actorId_at_idx" ON "PatientAccessLog"("actorId", "at");

-- CreateIndex
CREATE INDEX "PatientAccessLog_at_idx" ON "PatientAccessLog"("at");
