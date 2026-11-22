import { HttpException, HttpStatus } from '@nestjs/common';
import type { SafetyAlert } from '../domain/types';

/** 422 returned when safety checks block a prescription or dispense. */
export class SafetyBlockedException extends HttpException {
  constructor(body: { blocking: SafetyAlert[]; unacknowledged: SafetyAlert[] }) {
    super(
      {
        statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
        error: 'SAFETY_CHECK_FAILED',
        message: 'Safety checks must be resolved before continuing.',
        ...body,
      },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}
