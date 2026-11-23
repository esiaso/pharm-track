import { HttpException, HttpStatus } from '@nestjs/common';
import type { SafetyAlert } from '../domain/types';

/** 422 returned when safety checks block a prescription or dispense. */
export class SafetyBlockedException extends HttpException {
  constructor(body: { blocking: SafetyAlert[]; unacknowledged: SafetyAlert[]; overridable?: string[] }) {
    super(
      {
        statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
        error: 'SAFETY_CHECK_FAILED',
        message: 'Safety checks must be resolved before continuing.',
        blocking: body.blocking,
        unacknowledged: body.unacknowledged,
        /** Blocking hard stops a consultant may override at this facility. */
        overridable: body.overridable ?? [],
      },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}
