import { ArgumentsHost, BadRequestException, Catch, Controller, ExceptionFilter, Get, HttpException, Param, Query, Req, Res, UseFilters } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Role, Roles } from '../common/auth';
import { PatientData } from '../common/patient-access';
import { capabilityStatement, FHIR_RESOURCES, FhirResourceType, operationOutcome, SEARCH_PARAMS, searchBundle } from '../domain/fhir';
import { DEFAULT_COUNT, FhirService, MAX_COUNT } from './fhir.service';

const FHIR_JSON = 'application/fhir+json; charset=utf-8';
const ISSUE: Record<number, string> = { 400: 'invalid', 401: 'login', 403: 'forbidden', 404: 'not-found', 409: 'conflict', 422: 'processing' };
const GENERAL_PARAMS = new Set(['_count', '_offset', '_format']);

/** FHIR errors are OperationOutcome resources, not the API's usual JSON errors. */
@Catch()
export class FhirExceptionFilter implements ExceptionFilter {
  catch(e: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const status = e instanceof HttpException ? e.getStatus() : 500;
    const body = e instanceof HttpException ? e.getResponse() : null;
    const message =
      status >= 500
        ? 'Internal error.'
        : typeof body === 'object' && body && 'message' in body
          ? ([] as string[]).concat((body as { message: string | string[] }).message).join('; ')
          : (e as Error).message;
    res.status(status).type(FHIR_JSON).send(JSON.stringify(operationOutcome(ISSUE[status] ?? 'exception', message, status >= 500 ? 'fatal' : 'error')));
  }
}

export function fhirBase(req: Request): string {
  return (process.env.FHIR_BASE_URL || `${req.protocol}://${req.get('host')}/api/v1/fhir/R4`).replace(/\/+$/, '');
}

function resourceType(type: string): FhirResourceType {
  if (!(FHIR_RESOURCES as readonly string[]).includes(type)) {
    throw new HttpException(`Resource type ${type} is not supported. Supported: ${FHIR_RESOURCES.join(', ')}.`, 404);
  }
  return type as FhirResourceType;
}

function send(res: Response, resource: unknown) {
  res.type(FHIR_JSON);
  return resource;
}

/**
 * Read-only FHIR R4 facade over PharmTrack data. Searches on patient data
 * need a patient; every response that carries patient data is recorded in
 * the access log.
 */
@ApiTags('fhir')
@Controller('fhir/R4')
@UseFilters(FhirExceptionFilter)
@Roles(Role.SYSTEM, Role.PHARMACIST, Role.PRESCRIBER, Role.PHARMACY_TECHNICIAN)
export class FhirController {
  constructor(private readonly fhir: FhirService) {}

  @Get('metadata')
  metadata(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return send(res, capabilityStatement(fhirBase(req), process.env.npm_package_version ?? '0.1.0'));
  }

  @Get(':type')
  @PatientData('fhir.search')
  async search(@Param('type') type: string, @Query() q: Record<string, string>, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const t = resourceType(type);
    const known = new Set(SEARCH_PARAMS[t].map((p) => p.name));
    if (t === 'AdverseEvent') known.add('patient');
    for (const [k, v] of Object.entries(q)) {
      if (typeof v !== 'string') throw new BadRequestException(`Search parameter ${k} may only be given once.`);
      if (!known.has(k) && !GENERAL_PARAMS.has(k)) throw new BadRequestException(`Search parameter ${k} is not supported for ${t}.`);
    }
    if (q._format && !/json/.test(q._format)) throw new BadRequestException('Only JSON is supported.');
    const count = Math.min(MAX_COUNT, Math.max(0, Number.parseInt(q._count ?? `${DEFAULT_COUNT}`, 10) || 0));
    const offset = Math.max(0, Number.parseInt(q._offset ?? '0', 10) || 0);
    const page = await this.fhir.search(t, q, count, offset);
    const base = fhirBase(req);
    const params = (o: number) => {
      const p = new URLSearchParams({ ...q, _count: String(count), _offset: String(o) });
      return `${base}/${t}?${p.toString()}`;
    };
    const next = offset + count < page.total && count > 0 ? params(offset + count) : undefined;
    return send(res, searchBundle(base, params(offset), page.resources, page.total, next));
  }

  @Get(':type/:id')
  @PatientData('fhir.read')
  async read(@Param('type') type: string, @Param('id') id: string, @Res({ passthrough: true }) res: Response) {
    return send(res, await this.fhir.read(resourceType(type), id));
  }
}
