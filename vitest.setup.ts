/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach } from 'vitest';

// Isolate every test run from the developer's on-disk database and environment.
process.env.CONTROLPLANE_DB_PATH = ':memory:';
delete process.env.CONTROLPLANE_AUTH_MODE;
delete process.env.CONTROLPLANE_BOOTSTRAP_ADMIN_KEY;

// All test files share one process. Many replace global fetch with a mock; a mock
// left behind would be picked up as the "real" fetch by suites that call a live test
// server over HTTP, and fail them depending on file order. Restore the real fetch
// before each file and after every test.
const testGlobals = globalThis as typeof globalThis & { __realFetch?: typeof fetch };
testGlobals.__realFetch ??= globalThis.fetch;
globalThis.fetch = testGlobals.__realFetch;
afterEach(() => {
  globalThis.fetch = testGlobals.__realFetch!;
});
