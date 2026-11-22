'use client';

import { User, UserManager, WebStorageStateStore } from 'oidc-client-ts';

/**
 * SynergyOne SSO sign-in (OpenID Connect, authorization code + PKCE).
 * Enabled when NEXT_PUBLIC_SSO_AUTHORITY and NEXT_PUBLIC_SSO_CLIENT_ID are set;
 * otherwise the app uses the development sign-in picker.
 */
export const SSO = {
  authority: process.env.NEXT_PUBLIC_SSO_AUTHORITY ?? '',
  clientId: process.env.NEXT_PUBLIC_SSO_CLIENT_ID ?? '',
  scope: process.env.NEXT_PUBLIC_SSO_SCOPE ?? 'openid profile',
  rolesClaim: process.env.NEXT_PUBLIC_SSO_ROLES_CLAIM ?? 'roles',
  roleMap: JSON.parse(process.env.NEXT_PUBLIC_SSO_ROLE_MAP || '{}') as Record<string, string>,
  facilityClaim: process.env.NEXT_PUBLIC_SSO_FACILITY_CLAIM ?? 'facility_id',
};
export const ssoEnabled = () => !!SSO.authority && !!SSO.clientId;

let manager: UserManager | undefined;
export function userManager(): UserManager {
  if (!manager) {
    manager = new UserManager({
      authority: SSO.authority,
      client_id: SSO.clientId,
      redirect_uri: `${window.location.origin}/auth/callback`,
      post_logout_redirect_uri: window.location.origin,
      response_type: 'code',
      scope: SSO.scope,
      automaticSilentRenew: true,
      userStore: new WebStorageStateStore({ store: window.sessionStorage }),
    });
  }
  return manager;
}

const PHARMTRACK_ROLES = ['PHARMACIST', 'PHARMACY_TECHNICIAN', 'PRESCRIBER', 'STORE_KEEPER', 'ADMINISTRATOR'];

/** Reads user id, roles and facility from the access token (the API checks the same claims). */
export function identityFrom(user: User): { userId: string; roles: string[]; facilityId?: string } {
  const claims = decode(user.access_token) ?? {};
  const raw = path(claims, SSO.rolesClaim);
  const external = Array.isArray(raw) ? raw.map(String) : typeof raw === 'string' ? raw.split(/[ ,]+/) : [];
  const roles = [...new Set(external.map((r) => SSO.roleMap[r] ?? r.toUpperCase()))].filter((r) => PHARMTRACK_ROLES.includes(r));
  const facility = path(claims, SSO.facilityClaim);
  const name = (claims.preferred_username ?? user.profile.preferred_username ?? user.profile.sub) as string;
  return { userId: name, roles, facilityId: typeof facility === 'string' ? facility : undefined };
}

function decode(jwt: string): Record<string, unknown> | null {
  try {
    const part = jwt.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(decodeURIComponent(escape(atob(part))));
  } catch {
    return null;
  }
}

function path(obj: unknown, p: string): unknown {
  return p.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj);
}
