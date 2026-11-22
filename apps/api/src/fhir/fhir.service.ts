import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  FhirConfig,
  FhirResource,
  FhirResourceType,
  fhirConfigFromEnv,
  parsePatientParam,
  parseToken,
  ATC_SYSTEM,
  toAdverseEvent,
  toAllergyIntolerance,
  toMedication,
  toMedicationDispense,
  toMedicationRequest,
} from '../domain/fhir';
import { PrismaService } from '../prisma/prisma.service';

export const DEFAULT_COUNT = 50;
export const MAX_COUNT = 200;

export type SearchParams = Record<string, string | undefined>;
export type Page = { resources: FhirResource[]; total: number };

/**
 * Read-only FHIR R4 views. Searches on patient data need a patient (or an id),
 * so the facade cannot be used to pull every patient's records at once.
 */
@Injectable()
export class FhirService {
  readonly cfg: FhirConfig = fhirConfigFromEnv();

  constructor(private readonly prisma: PrismaService) {}

  async read(type: FhirResourceType, id: string): Promise<FhirResource> {
    const page = await this.search(type, { _id: id }, 1, 0);
    if (!page.resources.length) throw new NotFoundException(`${type}/${id} is not known.`);
    return page.resources[0];
  }

  search(type: FhirResourceType, q: SearchParams, count: number, offset: number): Promise<Page> {
    switch (type) {
      case 'Medication':
        return this.medications(q, count, offset);
      case 'MedicationRequest':
        return this.requests(q, count, offset);
      case 'MedicationDispense':
        return this.dispenses(q, count, offset);
      case 'AllergyIntolerance':
        return this.allergies(q, count, offset);
      case 'AdverseEvent':
        return this.adverseEvents(q, count, offset);
    }
  }

  private requirePatient(q: SearchParams, param: string, alternatives: string[]): string | undefined {
    const p = q[param];
    if (!p && !alternatives.some((a) => q[a])) {
      throw new BadRequestException(`Search needs ${param}${alternatives.length ? ` or ${alternatives.join(' or ')}` : ''}. Searching across all patients is not allowed.`);
    }
    return p ? parsePatientParam(p) : undefined;
  }

  private async medications(q: SearchParams, take: number, skip: number): Promise<Page> {
    const and: Prisma.DrugWhereInput[] = [];
    if (q._id) and.push({ id: q._id });
    if (q.code) {
      const { system, code } = parseToken(q.code);
      if (system === ATC_SYSTEM) and.push({ atcCode: code });
      else if (system === this.cfg.hptSystem) and.push({ hptCode: code });
      else if (system) and.push({ id: '__none__' });
      else and.push({ OR: [{ hptCode: code }, { atcCode: code }] });
    }
    if (q.status === 'inactive') and.push({ formularyStatus: 'DISCONTINUED' });
    else if (q.status === 'active') and.push({ formularyStatus: { not: 'DISCONTINUED' } });
    const where: Prisma.DrugWhereInput = { AND: and };
    const [rows, total] = await Promise.all([
      this.prisma.drug.findMany({ where, orderBy: { genericName: 'asc' }, take, skip }),
      this.prisma.drug.count({ where }),
    ]);
    return { resources: rows.map((d) => toMedication(this.cfg, d)), total };
  }

  private async requests(q: SearchParams, take: number, skip: number): Promise<Page> {
    const patientId = this.requirePatient(q, 'patient', ['_id']);
    const where: Prisma.PrescriptionItemWhereInput = {
      ...(q._id ? { id: q._id } : {}),
      prescription: {
        ...(patientId ? { patientId } : {}),
        ...(q.encounter ? { encounterId: parseToken(q.encounter).code.replace(/^Encounter\//, '') } : {}),
      },
    };
    const rows = await this.prisma.prescriptionItem.findMany({
      where,
      include: { prescription: true, drug: true },
      orderBy: [{ prescription: { signedAt: 'desc' } }, { id: 'asc' }],
    });
    let resources = rows.map((i) => toMedicationRequest(this.cfg, i.prescription, i));
    // Status is derived (quantities, refills), so it is filtered after mapping.
    if (q.status) {
      const wanted = q.status.split(',');
      resources = resources.filter((r) => wanted.includes(r.status as string));
    }
    return { resources: resources.slice(skip, skip + take), total: resources.length };
  }

  private async dispenses(q: SearchParams, take: number, skip: number): Promise<Page> {
    const patientId = this.requirePatient(q, 'patient', ['_id', 'prescription']);
    const where: Prisma.DispenseLineWhereInput = {
      ...(q._id ? { id: q._id } : {}),
      ...(q.prescription ? { prescriptionItemId: q.prescription.replace(/^MedicationRequest\//, '') } : {}),
      ...(patientId ? { dispenseOrder: { prescription: { patientId } } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.dispenseLine.findMany({
        where,
        include: { drug: true, prescriptionItem: true, dispenseOrder: { include: { prescription: true } } },
        orderBy: [{ dispensedAt: 'desc' }, { id: 'asc' }],
        take,
        skip,
      }),
      this.prisma.dispenseLine.count({ where }),
    ]);
    return {
      resources: rows.map((l) => toMedicationDispense(this.cfg, l.dispenseOrder.prescription, l.dispenseOrder, l, l.prescriptionItem)),
      total,
    };
  }

  private async allergies(q: SearchParams, take: number, skip: number): Promise<Page> {
    const patientId = this.requirePatient(q, 'patient', ['_id']);
    const cs = q['clinical-status'];
    const where: Prisma.AllergyWhereInput = {
      ...(q._id ? { id: q._id } : {}),
      ...(patientId ? { patientId } : {}),
      ...(cs ? { status: { in: cs.split(',').map((s) => (s === 'inactive' ? 'INACTIVE' : 'ACTIVE')) } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.allergy.findMany({ where, include: { drug: true }, orderBy: [{ recordedAt: 'desc' }, { id: 'asc' }], take, skip }),
      this.prisma.allergy.count({ where }),
    ]);
    return { resources: rows.map((a) => toAllergyIntolerance(this.cfg, a)), total };
  }

  private async adverseEvents(q: SearchParams, take: number, skip: number): Promise<Page> {
    const patientId = this.requirePatient(q, 'subject', ['_id', 'patient']) ?? (q.patient ? parsePatientParam(q.patient) : undefined);
    const where: Prisma.AdverseDrugReactionWhereInput = {
      ...(q._id ? { id: q._id } : {}),
      ...(patientId ? { patientId } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.adverseDrugReaction.findMany({ where, include: { drug: true }, orderBy: [{ reportedAt: 'desc' }, { id: 'asc' }], take, skip }),
      this.prisma.adverseDrugReaction.count({ where }),
    ]);
    return { resources: rows.map((r) => toAdverseEvent(this.cfg, r)), total };
  }
}
