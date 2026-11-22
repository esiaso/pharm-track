import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AdverseDrugReaction, Allergy, Drug } from '@prisma/client';
import { Actor } from '../common/auth';
import { AuditService } from '../common/audit.service';
import { atcLevel, normaliseAtc, normaliseHpt } from '../domain/codes';
import { OutboxService } from '../integrations/outbox.service';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { AssessAdrDto, CreateAdrDto, CreateAllergyDto, MarkAdrSubmittedDto, MarkAdrAcknowledgedDto, UpdateAllergyDto } from './records.dto';

@Injectable()
export class RecordsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  // ── Allergies ─────────────────────────────────────────────────────────────

  listAllergies(patientId: string, includeInactive = false) {
    return this.prisma.allergy.findMany({
      where: { patientId, ...(includeInactive ? {} : { status: 'ACTIVE' }) },
      orderBy: { recordedAt: 'desc' },
    });
  }

  /**
   * Records an allergy. Records from CliniTrack (externalId set, SYSTEM caller)
   * are upserted and not echoed back; records made in PharmTrack are shared to CliniTrack.
   */
  async recordAllergy(dto: CreateAllergyDto, actor: Actor) {
    let drugId: string | undefined;
    if (dto.agentType === 'DRUG') {
      if (!dto.hptCode) throw new BadRequestException('A drug allergy needs the drug HPT code.');
      drugId = (await this.drugByHpt(dto.hptCode)).id;
    }
    const atcPrefix = dto.atcPrefix ? normaliseAtc(dto.atcPrefix) : undefined;
    if (atcPrefix && atcLevel(atcPrefix) === null) throw new BadRequestException(`Invalid ATC prefix ${dto.atcPrefix}.`);
    if (dto.agentType === 'DRUG_CLASS' && !atcPrefix) throw new BadRequestException('A drug-class allergy needs an ATC prefix.');
    const fromClinitrack = !!dto.externalId;

    const data = {
      patientId: dto.patientId,
      agentType: dto.agentType,
      drugId,
      atcPrefix,
      agentText: dto.agentText,
      reaction: dto.reaction,
      severity: dto.severity,
      verificationStatus: dto.verificationStatus ?? 'UNCONFIRMED',
      source: fromClinitrack ? ('CLINITRACK' as const) : ('PHARMTRACK' as const),
      externalId: dto.externalId,
      recordedBy: actor.id,
    };
    return this.prisma.$transaction(async (tx) => {
      const allergy = dto.externalId
        ? await tx.allergy.upsert({ where: { externalId: dto.externalId }, create: data, update: data })
        : await tx.allergy.create({ data });
      await this.audit.log(tx, actor, 'allergy.record', 'Allergy', allergy.id, undefined, allergy);
      if (!fromClinitrack) await this.shareAllergy(tx, allergy);
      return allergy;
    });
  }

  async updateAllergy(id: string, dto: UpdateAllergyDto, actor: Actor) {
    const before = await this.prisma.allergy.findUnique({ where: { id } });
    if (!before) throw new NotFoundException(`Allergy ${id} not found.`);
    return this.prisma.$transaction(async (tx) => {
      const allergy = await tx.allergy.update({ where: { id }, data: dto });
      await this.audit.log(tx, actor, 'allergy.update', 'Allergy', id, before, allergy);
      if (allergy.source === 'PHARMTRACK') await this.shareAllergy(tx, allergy);
      return allergy;
    });
  }

  private async shareAllergy(tx: Tx, a: Allergy) {
    const drug = a.drugId ? await tx.drug.findUnique({ where: { id: a.drugId } }) : null;
    await this.outbox.enqueue(tx, 'CLINITRACK', 'allergy.recorded', `allergy.recorded:${a.id}:${a.updatedAt.toISOString()}`, {
      allergyId: a.id,
      patientId: a.patientId,
      agentType: a.agentType,
      agentText: a.agentText,
      hptCode: drug?.hptCode ?? null,
      atcCode: drug?.atcCode ?? a.atcPrefix ?? null,
      reaction: a.reaction,
      severity: a.severity,
      verificationStatus: a.verificationStatus,
      status: a.status,
    });
  }

  // ── Adverse drug reactions ────────────────────────────────────────────────

  listAdrs(filter: { patientId?: string; ppbReportStatus?: string }) {
    return this.prisma.adverseDrugReaction.findMany({
      where: { patientId: filter.patientId, ppbReportStatus: filter.ppbReportStatus as any },
      include: { drug: true },
      orderBy: { reportedAt: 'desc' },
      take: 200,
    });
  }

  async reportAdr(dto: CreateAdrDto, actor: Actor) {
    const drug = await this.drugByHpt(dto.hptCode);
    return this.prisma.$transaction(async (tx) => {
      const adr = await tx.adverseDrugReaction.create({
        data: {
          patientId: dto.patientId,
          encounterId: dto.encounterId,
          drugId: drug.id,
          dispenseLineId: dto.dispenseLineId,
          onsetDate: new Date(dto.onsetDate),
          description: dto.description,
          seriousness: dto.seriousness,
          actionTaken: dto.actionTaken,
          outcome: dto.outcome,
          reportedBy: actor.id,
        },
      });
      await this.audit.log(tx, actor, 'adr.report', 'AdverseDrugReaction', adr.id, undefined, adr);
      await this.outbox.enqueue(tx, 'CLINITRACK', 'adr.reported', `adr.reported:${adr.id}`, {
        adrId: adr.id,
        patientId: adr.patientId,
        encounterId: adr.encounterId,
        hptCode: drug.hptCode,
        atcCode: drug.atcCode,
        seriousness: adr.seriousness,
        onsetDate: adr.onsetDate.toISOString(),
      });
      return adr;
    });
  }

  async assessAdr(id: string, dto: AssessAdrDto, actor: Actor) {
    const before = await this.getAdr(id);
    return this.prisma.$transaction(async (tx) => {
      const adr = await tx.adverseDrugReaction.update({ where: { id }, data: dto });
      await this.audit.log(tx, actor, 'adr.assess', 'AdverseDrugReaction', id, before, adr);
      return adr;
    });
  }

  /**
   * PPB pharmacovigilance export. Field names follow the PPB "Suspected Adverse
   * Drug Reaction" reporting form. ASSUMPTION: the exact PPB e-reporting schema
   * (or ICH E2B R3) must be confirmed before live submission; this mapping is
   * kept in one place so it can be adjusted.
   */
  async exportAdrForPpb(id: string, actor: Actor) {
    const adr = await this.getAdr(id);
    const report = toPpbReport(adr, adr.drug);
    if (adr.ppbReportStatus === 'NOT_SUBMITTED') {
      await this.prisma.adverseDrugReaction.update({ where: { id }, data: { ppbReportStatus: 'EXPORTED' } });
      await this.audit.log(this.prisma, actor, 'adr.export', 'AdverseDrugReaction', id);
    }
    return report;
  }

  async markAdrSubmitted(id: string, dto: MarkAdrSubmittedDto, actor: Actor) {
    await this.getAdr(id);
    const adr = await this.prisma.adverseDrugReaction.update({
      where: { id },
      data: { ppbReportStatus: 'SUBMITTED', ppbReference: dto.ppbReference },
    });
    await this.audit.log(this.prisma, actor, 'adr.submitted', 'AdverseDrugReaction', id, undefined, { ppbReference: dto.ppbReference });
    return adr;
  }

  async markAdrAcknowledged(id: string, dto: MarkAdrAcknowledgedDto, actor: Actor) {
    const before = await this.getAdr(id);
    if (before.ppbReportStatus !== 'SUBMITTED') throw new ConflictException('Only a report marked as submitted to PPB can be acknowledged.');
    const ppbReference = dto.ppbAcknowledgement ? `${before.ppbReference ?? ''}${before.ppbReference ? ' / ' : ''}${dto.ppbAcknowledgement}` : before.ppbReference;
    const adr = await this.prisma.adverseDrugReaction.update({ where: { id }, data: { ppbReportStatus: 'ACKNOWLEDGED', ppbReference } });
    await this.audit.log(this.prisma, actor, 'adr.acknowledged', 'AdverseDrugReaction', id, { ppbReportStatus: 'SUBMITTED' }, { ppbReportStatus: 'ACKNOWLEDGED', ppbAcknowledgement: dto.ppbAcknowledgement });
    return adr;
  }

  private async getAdr(id: string) {
    const adr = await this.prisma.adverseDrugReaction.findUnique({ where: { id }, include: { drug: true } });
    if (!adr) throw new NotFoundException(`ADR ${id} not found.`);
    return adr;
  }

  private async drugByHpt(hptCode: string) {
    const drug = await this.prisma.drug.findUnique({ where: { hptCode: normaliseHpt(hptCode) } });
    if (!drug) throw new BadRequestException(`Unknown HPT code ${hptCode}.`);
    return drug;
  }
}

export function toPpbReport(adr: AdverseDrugReaction, drug: Drug) {
  return {
    reportType: 'SUSPECTED_ADVERSE_DRUG_REACTION',
    reportReference: adr.id,
    patient: { identifier: adr.patientId },
    suspectedDrug: {
      genericName: drug.genericName,
      brandNames: drug.brandNames,
      strength: drug.strength,
      dosageForm: drug.dosageForm,
      route: drug.route,
      whoAtcCode: drug.atcCode,
      ppbHptCode: drug.hptCode,
    },
    reaction: {
      onsetDate: adr.onsetDate.toISOString().slice(0, 10),
      description: adr.description,
      seriousness: adr.seriousness,
      actionTaken: adr.actionTaken,
      outcome: adr.outcome,
      causality: adr.causality,
      causalityMethod: 'WHO-UMC',
    },
    reporter: { userId: adr.reportedBy, reportedAt: adr.reportedAt.toISOString() },
  };
}
