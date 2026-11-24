-- fillSequence counts fills of one item, not of the prescription: a prescription
-- with two medicines on refill has two "fill 1" orders, and a cancelled refill is
-- requested again with the same number. The unique constraint made the second
-- refill fail.
DROP INDEX "DispenseOrder_prescriptionId_fillSequence_key";
CREATE INDEX "DispenseOrder_prescriptionId_idx" ON "DispenseOrder"("prescriptionId");
CREATE INDEX "DispenseOrder_refillScheduleId_idx" ON "DispenseOrder"("refillScheduleId");
