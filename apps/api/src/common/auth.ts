import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

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

const ROLES_KEY = 'roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

/**
 * Resolves the caller. SynergyOne SSO token validation plugs in here.
 *
 * AUTH_MODE=dev-headers (the default outside production) trusts x-user-id,
 * x-user-roles and x-facility-id headers so the API can be exercised locally.
 * main.ts refuses to start with that mode in production.
 */
export function resolveActor(headers: Record<string, string | string[] | undefined>): Actor | null {
  const mode = process.env.AUTH_MODE ?? 'dev-headers';
  if (mode !== 'dev-headers') {
    // TODO(SSO): verify the SynergyOne SSO bearer token and map its claims to Actor.
    return null;
  }
  const id = headers['x-user-id'];
  if (typeof id !== 'string' || !id) return null;
  const roles = String(headers['x-user-roles'] ?? '')
    .split(',')
    .map((r) => r.trim().toUpperCase())
    .filter((r): r is Role => (Object.values(Role) as string[]).includes(r));
  const facility = headers['x-facility-id'];
  return { id, roles, facilityId: typeof facility === 'string' ? facility : undefined };
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    if (req.path === '/health' || req.url?.startsWith('/docs')) return true;
    const actor = resolveActor(req.headers);
    if (!actor) throw new UnauthorizedException('Missing or invalid credentials.');
    req.actor = actor;
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!required || required.length === 0) return true;
    if (actor.roles.includes(Role.ADMINISTRATOR) || required.some((r) => actor.roles.includes(r))) return true;
    throw new ForbiddenException(`Requires one of: ${required.join(', ')}`);
  }
}

export const CurrentActor = createParamDecorator((_: unknown, ctx: ExecutionContext): Actor => {
  return ctx.switchToHttp().getRequest().actor;
});

/** Reads the Idempotency-Key header sent by the calling system. */
export const IdempotencyKey = createParamDecorator((_: unknown, ctx: ExecutionContext): string | undefined => {
  const v = ctx.switchToHttp().getRequest().headers['idempotency-key'];
  return typeof v === 'string' && v ? v : undefined;
});

export function primaryRole(actor: Actor): string {
  return actor.roles[0] ?? 'UNKNOWN';
}
