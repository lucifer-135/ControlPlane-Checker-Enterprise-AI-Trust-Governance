/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Authentication & Multi-Tenancy Middleware
 *
 * Enforces API key verification with SHA-256 hash lookup and
 * tenant context injection (Org, Workspace, Policy Profile, Rate Limit).
 */

import type { Request, Response, NextFunction } from 'express';
import { getApiKeyBySecret, type StoredApiKey } from './db/database.js';
import { checkRateLimit } from './inputGuard.js';

export interface AuthenticatedRequest extends Request {
  apiKeyInfo?: StoredApiKey;
  orgId?: string;
  workspaceId?: string;
  resolvedPolicy?: string;
}

export function apiKeyAuth(options: { required?: boolean } = { required: true }) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      if (!options.required) {
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

    req.apiKeyInfo = keyInfo;
    req.orgId = keyInfo.org_id;
    req.workspaceId = keyInfo.workspace_id;
    req.resolvedPolicy = keyInfo.policy_profile;

    next();
  };
}
