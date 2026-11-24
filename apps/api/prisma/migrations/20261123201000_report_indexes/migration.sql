-- Indexes for the date-range reports and per-item fill history, found with a year of load-test data.
-- CreateIndex
CREATE INDEX "ControlledDrugRegisterEntry_recordedAt_idx" ON "ControlledDrugRegisterEntry"("recordedAt");

-- CreateIndex
CREATE INDEX "DispenseLine_dispensedAt_idx" ON "DispenseLine"("dispensedAt");

-- CreateIndex
CREATE INDEX "DispenseLine_prescriptionItemId_idx" ON "DispenseLine"("prescriptionItemId");

-- CreateIndex
CREATE INDEX "Notification_refillScheduleId_idx" ON "Notification"("refillScheduleId");

-- CreateIndex
CREATE INDEX "Prescription_signedAt_idx" ON "Prescription"("signedAt");

-- CreateIndex
CREATE INDEX "SafetyAlert_raisedAt_idx" ON "SafetyAlert"("raisedAt");

