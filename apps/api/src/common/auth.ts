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
import { SsoVerifier, ssoConfigFromEnv } from './sso';

export { Role } from './roles';
export type { Actor } from './roles';
import { Actor, Role } from './roles';

const ROLES_KEY = 'roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

let verifier: SsoVerifier | undefined;

/** For tests: replace the SSO verifier. */
export function setSsoVerifier(v: SsoVerifier | undefined) {
  verifier = v;
}

/**
 * Resolves the caller.
 *
 * AUTH_MODE=oidc (production): verifies the SynergyOne SSO bearer token.
 * AUTH_MODE=dev-headers (the default outside production) trusts x-user-id,
 * x-user-roles and x-facility-id headers so the API can be exercised locally.
 * main.ts refuses to start with dev-headers in production.
 */
export async function resolveActor(headers: Record<string, string | string[] | undefined>): Promise<Actor | null> {
  const mode = process.env.AUTH_MODE ?? 'dev-headers';
  if (mode === 'oidc') {
    const auth = headers['authorization'];
    if (typeof auth !== 'string' || !auth.startsWith('Bearer ')) return null;
    verifier ??= new SsoVerifier(ssoConfigFromEnv());
    const actor = await verifier.verify(auth.slice(7).trim());
    // A user may work across facilities; the token's facility wins, else the header picks one.
    const facility = headers['x-facility-id'];
    if (actor && !actor.facilityId && typeof facility === 'string') actor.facilityId = facility;
    return actor;
  }
  if (mode !== 'dev-headers') return null;
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

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    if (req.path === '/health' || req.path === '/health/ready' || req.url?.startsWith('/docs')) return true;
    const actor = await resolveActor(req.headers);
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
