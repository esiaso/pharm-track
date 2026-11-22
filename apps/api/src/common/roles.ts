export enum Role {
  PRESCRIBER = 'PRESCRIBER',
  PHARMACIST = 'PHARMACIST',
  PHARMACY_TECHNICIAN = 'PHARMACY_TECHNICIAN',
  STORE_KEEPER = 'STORE_KEEPER',
  ADMINISTRATOR = 'ADMINISTRATOR',
  /** Service-to-service calls from CliniTrack / SupplyTrack. */
  SYSTEM = 'SYSTEM',
}

export interface Actor {
  id: string;
  roles: Role[];
  facilityId?: string;
}
