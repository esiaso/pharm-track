// Shapes returned by the PharmTrack API (only the fields the web app uses).
export type Severity = 'INFO' | 'WARNING' | 'HARD_STOP';

export interface Drug {
  id: string;
  hptCode: string;
  atcCode: string;
  genericName: string;
  brandNames: string[];
  strength: string;
  strengthValue: string | null;
  strengthUnit: string | null;
  dosageForm: string;
  route: string;
  packSize: number;
  unitOfIssue: string;
  controlledSchedule: string;
  formularyStatus: string;
  pregnancyRisk: string;
  lactationRisk: string;
  substitutionGroupId: string | null;
  version: number;
  facilityStatus?: string | null;
}

export interface Alert {
  key: string;
  itemRef: string;
  type: string;
  severity: Severity;
  message: string;
}

export interface StoredAlert {
  id: string;
  stage: 'PRESCRIBING' | 'VERIFICATION';
  alertKey: string;
  type: string;
  severity: Severity;
  message: string;
  overriddenBy: string | null;
  overrideReason: string | null;
  overrideAuthorisedBy?: string | null;
  raisedAt: string;
}

export interface PrescriptionItem {
  id: string;
  drugId: string;
  drug: Drug;
  atcCode: string;
  hptCode: string;
  dose: string;
  doseUnit: string;
  frequency: string;
  route: string;
  durationDays: number;
  quantity: string;
  refillsAuthorised: number;
  instructions: string | null;
  safetyAlerts: StoredAlert[];
}

export interface DispenseLine {
  id: string;
  prescriptionItemId: string;
  drugId: string;
  hptCode: string;
  atcCode: string;
  quantity: string;
  quantityReturned: string;
  batchNumber: string;
  expiryDate: string;
  unitPrice: string;
  currency: string;
  labelText: string | null;
  counsellingNotes: string | null;
  substitutionNote: string | null;
  dispensedBy: string;
  dispensedAt: string;
  billingRef: string | null;
  billingStatus: string;
  controlledEntry: { witnessedBy: string; dispensedBy: string } | null;
}

export interface DispenseOrder {
  id: string;
  prescriptionId: string;
  kind: 'INITIAL' | 'REFILL';
  fillSequence: number;
  facilityId: string;
  storeId: string;
  priority: 'STAT' | 'URGENT' | 'ROUTINE';
  status: string;
  verifiedBy: string | null;
  verifiedAt: string | null;
  cancelReason: string | null;
  createdAt: string;
  refillSchedule: RefillSchedule | null;
  prescription: {
    id: string;
    externalId: string;
    patientId: string;
    encounterId: string;
    prescriberId: string;
    facilityId: string;
    status: string;
    signedAt: string;
    clinicalContext: Record<string, unknown> | null;
    items: PrescriptionItem[];
  };
  lines: DispenseLine[];
}

export interface QueueOrder {
  id: string;
  kind: 'INITIAL' | 'REFILL';
  fillSequence: number;
  priority: string;
  status: string;
  createdAt: string;
  prescription: { patientId: string; externalId: string; prescriberId: string };
}

export interface RefillSchedule {
  id: string;
  prescriptionItemId: string;
  patientId: string;
  facilityId: string;
  refillsAuthorised: number;
  refillsUsed: number;
  lastDispensedAt: string | null;
  nextDueDate: string | null;
  earliestRefillDate: string | null;
  graceDays: number;
  expiresAt: string;
  status: string;
  prescriptionItem?: PrescriptionItem & { prescription?: { externalId: string; storeId: string } };
}

export interface Notification {
  id: string;
  purpose: string;
  status: string;
  body: string;
  toAddress: string | null;
  createdAt: string;
  sentAt: string | null;
  lastError: string | null;
}

export interface Allergy {
  id: string;
  agentType: string;
  agentText: string;
  atcPrefix: string | null;
  reaction: string | null;
  severity: string;
  verificationStatus: string;
  status: string;
  source: string;
  recordedAt: string;
}

export interface RefillSummary {
  facilityId: string | null;
  counts: Record<'UPCOMING' | 'DUE' | 'OVERDUE' | 'COMPLETED' | 'CANCELLED' | 'EXPIRED', number>;
  /** Upcoming, due and overdue together. */
  open: number;
}
