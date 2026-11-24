import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type SearchResults = {
  patients: { patientId: string }[];
  prescriptions: { externalId: string; patientId: string; orderId: string | null; status: string }[];
  drugs: { id: string; genericName: string; strength: string; dosageForm: string; hptCode: string }[];
};

const EMPTY: SearchResults = { patients: [], prescriptions: [], drugs: [] };
const MAX_DRUGS = 6;

/**
 * The search box. Patients and prescriptions match only on the exact number
 * (so the box cannot be used to list patients); medicines match on part of the
 * name or the start of the HPT code.
 */
@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  async search(q: string, facilityId?: string): Promise<SearchResults> {
    const term = q.trim().slice(0, 80);
    if (term.length < 2) return EMPTY;
    const exact = [...new Set([term, term.toUpperCase()])];
    const atFacility = facilityId ? { facilityId } : {};

    const [patient, prescriptions, drugs] = await Promise.all([
      this.prisma.prescription.findFirst({ where: { patientId: { in: exact }, ...atFacility }, select: { patientId: true } }),
      this.prisma.prescription.findMany({
        where: { externalId: { in: exact }, ...atFacility },
        select: {
          externalId: true,
          patientId: true,
          status: true,
          dispenseOrders: { select: { id: true }, orderBy: { createdAt: 'desc' }, take: 1 },
        },
        take: 2,
      }),
      this.prisma.drug.findMany({
        where: {
          OR: [
            { genericName: { contains: term, mode: 'insensitive' } },
            { hptCode: { startsWith: term.toUpperCase() } },
            { brandNames: { has: term } },
          ],
        },
        select: { id: true, genericName: true, strength: true, dosageForm: true, hptCode: true },
        orderBy: [{ genericName: 'asc' }, { strength: 'asc' }],
        take: MAX_DRUGS,
      }),
    ]);

    return {
      patients: patient ? [{ patientId: patient.patientId }] : [],
      prescriptions: prescriptions.map((p) => ({
        externalId: p.externalId,
        patientId: p.patientId,
        status: p.status,
        orderId: p.dispenseOrders[0]?.id ?? null,
      })),
      drugs,
    };
  }
}
