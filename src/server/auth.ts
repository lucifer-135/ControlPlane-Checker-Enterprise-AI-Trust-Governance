/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Authentication, RBAC & Multi-Tenancy Middleware
 *
 * Enforces API key verification with SHA-256 hash lookup and injects a
 * principal (role + tenant) into the request. Route handlers use
 * `requireRole()` for authorization and `tenantFilterFor()` /
 * `tenantStampFor()` to scope reads and writes to the caller's tenant.
 *
 * In `dev` auth mode (never in production), a request with no Authorization
 * header runs as a local-dev admin principal that can see every tenant.
 */

import type { Request, Response, NextFunction } from 'express';
import {
  getApiKeyBySecret,
  API_KEY_ROLES,
  type ApiKeyRole,
  type StoredApiKey,
  type TenantFilter,
  type TenantStamp,
} from './db/database.js';
import { checkRateLimit } from './inputGuard.js';
import { getAuthMode, type AuthMode } from './config.js';

export interface Principal {
  kind: 'api_key' | 'local_dev';
  role: ApiKeyRole;
  orgId: string;
  workspaceId: string;
  keyHash?: string;
}

export interface AuthenticatedRequest extends Request {
  principal?: Principal;
  apiKeyInfo?: StoredApiKey;
  orgId?: string;
  workspaceId?: string;
  resolvedPolicy?: string;
}

export const LOCAL_DEV_ORG_ID = 'local-dev';

const LOCAL_DEV_PRINCIPAL: Principal = {
  kind: 'local_dev',
  role: 'admin',
  orgId: LOCAL_DEV_ORG_ID,
  workspaceId: 'default',
};

export function roleAtLeast(role: ApiKeyRole, minimum: ApiKeyRole): boolean {
  return API_KEY_ROLES.indexOf(role) >= API_KEY_ROLES.indexOf(minimum);
}

/**
 * Authenticates the request. A presented Bearer token is always validated;
 * a missing one is only tolerated in `dev` auth mode.
 */
export function authenticate(options: { mode?: AuthMode } = {}) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    const mode = options.mode ?? getAuthMode();
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      if (mode === 'dev') {
        req.principal = LOCAL_DEV_PRINCIPAL;
        return next();
      }
      res.status(401).json({
        error: {
          message: 'Missing or invalid Authorization header. Expected Bearer token.',
          type: 'authentication_error',
        },
      });
      return;
    }

    const token = authHeader.substring(7).trim();
    const keyInfo = getApiKeyBySecret(token);

    if (!keyInfo) {
      res.status(401).json({
        error: {
          message: 'Invalid or inactive API key provided.',
          type: 'invalid_api_key',
        },
      });
      return;
    }

    // Rate limiting per API key
    if (!checkRateLimit(keyInfo.key_hash, keyInfo.rate_limit_rpm)) {
      res.status(429).json({
        error: {
          message: `Rate limit of ${keyInfo.rate_limit_rpm} requests per minute exceeded for this API key.`,
          type: 'rate_limit_error',
        },
      });
      return;
    }

    req.principal = {
      kind: 'api_key',
      role: keyInfo.role,
      orgId: keyInfo.org_id,
      workspaceId: keyInfo.workspace_id || 'default',
      keyHash: keyInfo.key_hash,
    };
    req.apiKeyInfo = keyInfo;
    req.orgId = keyInfo.org_id;
    req.workspaceId = keyInfo.workspace_id || 'default';
    req.resolvedPolicy = keyInfo.policy_profile;

    next();
  };
}

/** Rejects requests whose principal is below the given role. Mount after authenticate(). */
export function requireRole(minimum: ApiKeyRole) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    const principal = req.principal;
    if (!principal) {
      res.status(401).json({
        error: { message: 'Authentication required.', type: 'authentication_error' },
      });
      return;
    }
    if (!roleAtLeast(principal.role, minimum)) {
      res.status(403).json({
        error: {
          message: `This operation requires the '${minimum}' role; the presented key has '${principal.role}'.`,
          type: 'permission_error',
        },
      });
      return;
    }
    next();
  };
}

/**
 * Read scope for a principal: the local-dev principal sees every tenant, admins
 * see their whole org, and everyone else sees only their own workspace.
 */
export function tenantFilterFor(principal: Principal | undefined): TenantFilter | undefined {
  if (!principal || principal.kind === 'local_dev') return undefined;
  if (principal.role === 'admin') return { orgId: principal.orgId };
  return { orgId: principal.orgId, workspaceId: principal.workspaceId };
}

/** Tenant stamp for records written on behalf of a principal. */
export function tenantStampFor(principal: Principal | undefined): TenantStamp {
  if (!principal) return { orgId: 'anonymous', workspaceId: 'default' };
  return { orgId: principal.orgId, workspaceId: principal.workspaceId };
}

/** True when a record stamped with this tenant is visible under the filter. */
export function tenantMatches(
  filter: TenantFilter | undefined,
  orgId: string,
  workspaceId: string,
): boolean {
  if (!filter) return true;
  if (filter.orgId !== orgId) return false;
  return !filter.workspaceId || filter.workspaceId === workspaceId;
}
