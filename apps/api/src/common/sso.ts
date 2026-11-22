import { createRemoteJWKSet, JWTPayload, jwtVerify } from 'jose';
import { Actor, Role } from './roles';

/**
 * SynergyOne SSO, assumed to be a standard OpenID Connect provider (for example
 * Keycloak). The API accepts its access tokens as `Authorization: Bearer …`.
 *
 *   AUTH_MODE=oidc
 *   SSO_ISSUER=https://sso.synergyone.example/realms/synergy
 *   SSO_AUDIENCE=pharmtrack                       (expected `aud`)
 *   SSO_JWKS_URL=…                                (optional; discovered from the issuer if unset)
 *   SSO_ROLES_CLAIM=realm_access.roles            (dotted path; default "roles")
 *   SSO_ROLE_MAP={"pharm-pharmacist":"PHARMACIST"} (optional; external → PharmTrack role names)
 *   SSO_FACILITY_CLAIM=facility_id                (optional)
 *
 * Service accounts (CliniTrack, SupplyTrack) use client-credentials tokens that
 * carry the SYSTEM role.
 */
export interface SsoConfig {
  issuer: string;
  audience?: string;
  jwksUrl?: string;
  rolesClaim: string;
  roleMap: Record<string, string>;
  facilityClaim: string;
}

export function ssoConfigFromEnv(env = process.env): SsoConfig {
  if (!env.SSO_ISSUER) throw new Error('AUTH_MODE=oidc needs SSO_ISSUER.');
  return {
    issuer: env.SSO_ISSUER,
    audience: env.SSO_AUDIENCE || undefined,
    jwksUrl: env.SSO_JWKS_URL || undefined,
    rolesClaim: env.SSO_ROLES_CLAIM || 'roles',
    roleMap: env.SSO_ROLE_MAP ? (JSON.parse(env.SSO_ROLE_MAP) as Record<string, string>) : {},
    facilityClaim: env.SSO_FACILITY_CLAIM || 'facility_id',
  };
}

export class SsoVerifier {
  private jwks?: ReturnType<typeof createRemoteJWKSet>;

  constructor(private readonly config: SsoConfig) {}

  /** Verifies the token's signature, issuer, audience and expiry; returns the actor or null. */
  async verify(token: string): Promise<Actor | null> {
    try {
      const { payload } = await jwtVerify(token, await this.keys(), {
        issuer: this.config.issuer,
        audience: this.config.audience,
        clockTolerance: 30,
      });
      return this.toActor(payload);
    } catch {
      return null;
    }
  }

  toActor(payload: JWTPayload): Actor | null {
    if (!payload.sub) return null;
    const raw = readPath(payload, this.config.rolesClaim);
    const external = Array.isArray(raw) ? raw.map(String) : typeof raw === 'string' ? raw.split(/[ ,]+/) : [];
    const known = Object.values(Role) as string[];
    const roles = [...new Set(external.map((r) => this.config.roleMap[r] ?? r.toUpperCase()).filter((r) => known.includes(r)))] as Role[];
    const facility = readPath(payload, this.config.facilityClaim);
    const name = (payload as Record<string, unknown>).preferred_username;
    return { id: typeof name === 'string' ? name : payload.sub, roles, facilityId: typeof facility === 'string' ? facility : undefined };
  }

  private async keys() {
    if (!this.jwks) {
      let url = this.config.jwksUrl;
      if (!url) {
        const res = await fetch(`${this.config.issuer.replace(/\/$/, '')}/.well-known/openid-configuration`);
        if (!res.ok) throw new Error(`OIDC discovery failed: ${res.status}`);
        url = ((await res.json()) as { jwks_uri: string }).jwks_uri;
      }
      this.jwks = createRemoteJWKSet(new URL(url));
    }
    return this.jwks;
  }
}

function readPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj);
}
