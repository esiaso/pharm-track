import { BadGatewayException, BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Socket } from 'node:net';
import { Actor } from '../common/auth';
import { AuditService } from '../common/audit.service';
import { LabelSize, labelSizeFromEnv, printersFromEnv, zplLabel } from '../domain/labels';
import { PrismaService } from '../prisma/prisma.service';
import { LabelRequestDto } from './dispensing.dto';

/**
 * Zebra (ZPL) dispensing labels: downloaded as a .zpl file, or sent straight to
 * the store's network printer (raw TCP, port 9100) when LABEL_PRINTERS lists it.
 */
@Injectable()
export class LabelsService {
  private readonly size: LabelSize = labelSizeFromEnv();
  private readonly printers = printersFromEnv();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Stores with a network label printer configured. */
  configuredStores(): string[] {
    return Object.keys(this.printers).sort();
  }

  async zpl(orderId: string, req: LabelRequestDto): Promise<{ zpl: string; labels: number; storeId: string; patientId: string }> {
    const order = await this.prisma.dispenseOrder.findUnique({
      where: { id: orderId },
      include: {
        prescription: { select: { patientId: true, externalId: true } },
        lines: { include: { drug: true, prescriptionItem: true, controlledEntry: { select: { id: true } } }, orderBy: { dispensedAt: 'asc' } },
      },
    });
    if (!order) throw new NotFoundException(`Dispense order ${orderId} not found.`);
    const lines = req.lineIds?.length ? order.lines.filter((l) => req.lineIds!.includes(l.id)) : order.lines;
    if (!lines.length) throw new BadRequestException('Nothing has been dispensed on this order yet, so there are no labels to print.');
    const facility = await this.prisma.facilityProfile.findUnique({ where: { facilityId: order.facilityId } });
    const patient = req.patientName?.trim() || order.prescription.patientId;
    const zpl = lines
      .map((l) => {
        const net = Number(l.quantity) - Number(l.quantityReturned);
        return zplLabel(
          {
            facilityName: facility?.name ?? order.facilityId,
            facilityPhone: facility?.phone,
            patient,
            medicine: `${l.drug.genericName} ${l.drug.strength} ${l.drug.dosageForm.toLowerCase()}`,
            quantity: `${net} ${l.drug.unitOfIssue.toLowerCase()}${net === 1 ? '' : 's'}`,
            directions: directions(l.labelText, l.drug.genericName, l.drug.strength),
            counselling: l.counsellingNotes,
            batchNumber: l.batchNumber,
            expiryDate: l.expiryDate,
            dispensedAt: l.dispensedAt,
            dispensedBy: l.dispensedBy,
            reference: order.prescription.externalId,
            controlled: !!l.controlledEntry,
          },
          this.size,
          req.copies ?? 1,
        );
      })
      .join('\n');
    return { zpl, labels: lines.length, storeId: order.storeId, patientId: order.prescription.patientId };
  }

  async print(orderId: string, req: LabelRequestDto, actor: Actor) {
    const { zpl, labels, storeId, patientId } = await this.zpl(orderId, req);
    const printer = this.printers[storeId];
    if (!printer) throw new BadRequestException(`No label printer is set up for store ${storeId}. Download the ZPL file instead, or add the store to LABEL_PRINTERS.`);
    try {
      await sendRaw(printer.host, printer.port, zpl);
    } catch (e) {
      throw new BadGatewayException(`The label printer for ${storeId} did not accept the job: ${(e as Error).message}`);
    }
    await this.audit.log(this.prisma, actor, 'labels.print', 'DispenseOrder', orderId, undefined, { storeId, labels, copies: req.copies ?? 1 });
    return { printed: labels, copies: req.copies ?? 1, storeId, patientId };
  }
}

/**
 * The stored label text starts with "<name> <strength> <form>." (see the
 * dispense screen). The ZPL label prints the medicine on its own line, so that
 * prefix is dropped from the directions.
 */
export function directions(labelText: string | null, genericName: string, strength: string): string {
  const text = (labelText ?? '').trim();
  const prefix = new RegExp(`^${escapeRe(genericName)}\\s+${escapeRe(strength)}[^.]*\\.\\s*`, 'i');
  return text.replace(prefix, '') || text;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Sends bytes to a printer's raw port (JetDirect, 9100) and waits for the socket to close cleanly. */
export function sendRaw(host: string, port: number, data: string, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new Socket();
    const fail = (e: Error) => {
      socket.destroy();
      reject(e);
    };
    socket.setTimeout(timeoutMs, () => fail(new Error(`no answer from ${host}:${port} within ${timeoutMs / 1000} s`)));
    socket.once('error', fail);
    socket.connect(port, host, () => {
      socket.end(Buffer.from(data, 'utf8'), () => resolve());
    });
  });
}
