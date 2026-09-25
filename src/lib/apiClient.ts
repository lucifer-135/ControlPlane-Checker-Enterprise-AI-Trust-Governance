/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Browser API client.
 *
 * Attaches the operator's API key (kept in sessionStorage, so it is cleared
 * when the tab closes) as a Bearer token, and announces 401 responses so the
 * app can prompt for a key.
 */

const API_KEY_STORAGE_KEY = 'cp_api_key';

/** Dispatched on `window` whenever the server answers 401. */
export const AUTH_REQUIRED_EVENT = 'cp:auth-required';

export function getStoredApiKey(): string | null {
  try {
    return sessionStorage.getItem(API_KEY_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredApiKey(key: string | null): void {
  try {
    if (key) {
      sessionStorage.setItem(API_KEY_STORAGE_KEY, key);
    } else {
      sessionStorage.removeItem(API_KEY_STORAGE_KEY);
    }
  } catch {
    // Storage unavailable (private mode); the key lasts only for this page
  }
}

export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const key = getStoredApiKey();
  if (key && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${key}`);
  }
  const resp = await fetch(input, { ...init, headers });
  if (resp.status === 401) {
    window.dispatchEvent(new CustomEvent(AUTH_REQUIRED_EVENT));
  }
  return resp;
}

/** Extracts a human-readable error from a failed response. */
export async function readErrorMessage(resp: Response): Promise<string> {
  try {
    const data = await resp.json();
    const err = data?.error;
    if (typeof err === 'string') return err;
    if (err && typeof err.message === 'string') return err.message;
  } catch {
    // Non-JSON body
  }
  return `HTTP ${resp.status}`;
}
