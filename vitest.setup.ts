/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Isolate every test run from the developer's on-disk database and environment.
process.env.CONTROLPLANE_DB_PATH = ':memory:';
delete process.env.CONTROLPLANE_AUTH_MODE;
delete process.env.CONTROLPLANE_BOOTSTRAP_ADMIN_KEY;
