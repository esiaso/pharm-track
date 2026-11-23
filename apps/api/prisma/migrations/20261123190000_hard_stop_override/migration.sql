-- Consultant override of hard-stop safety alerts (off unless a facility turns it on).
ALTER TABLE "FacilityProfile" ADD COLUMN "allowHardStopOverride" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SafetyAlert" ADD COLUMN "overrideAuthorisedBy" TEXT;
