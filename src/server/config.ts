/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Runtime Security Configuration
 *
 * Auth modes:
 * - `required`: every API route (except /api/health) needs a valid Bearer API key.
 *   Always enforced when NODE_ENV=production.
 * - `dev`: requests without an Authorization header run as a local-dev admin
 *   principal that can see every tenant. Requests that DO present a Bearer token
 *   are still authenticated and tenant-scoped. Only available outside production.
 */

export type AuthMode = 'required' | 'dev';

export const DEMO_API_KEY = 'cp_live_default_admin_key_2026';

export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

export function getAuthMode(): AuthMode {
  if (isProduction()) return 'required';
  const configured = (process.env.CONTROLPLANE_AUTH_MODE || '').trim().toLowerCase();
  return configured === 'required' ? 'required' : 'dev';
}

/**
 * The hard-coded demo admin key is only seeded (and only accepted) in local-dev mode.
 * Outside dev, an operator must provide CONTROLPLANE_BOOTSTRAP_ADMIN_KEY.
 */
export function isDemoKeyAllowed(): boolean {
  return getAuthMode() === 'dev';
}

export function getBootstrapAdminKey(): string | null {
  const key = (process.env.CONTROLPLANE_BOOTSTRAP_ADMIN_KEY || '').trim();
  return key.length >= 24 ? key : null;
}
