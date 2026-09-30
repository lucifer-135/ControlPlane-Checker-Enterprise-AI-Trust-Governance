/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pre-demo reset. Run with the server stopped:
 *
 *   npm run demo:reset                       # fresh database, audit secret, readiness checks
 *   npm run demo:reset -- --restore-policies # also restore policies/ to the last commit
 *
 * 1. Refuses to run while the server is up (SQLite files are open).
 * 2. Generates AUDIT_HMAC_SECRET in .env if missing (the value is never printed).
 * 3. Archives the database (and any pending demo:tamper undo) to data/archive/<timestamp>/.
 * 4. Reports policy files that differ from the last commit (restores them on request).
 * 5. Checks that Ollama is running with the local judge model.
 */

import 'dotenv/config';
import crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { undoFileFor } from '../src/server/db/demoTamper';

const root = process.cwd();
const port = process.env.PORT || '3000';
const restorePolicies = process.argv.includes('--restore-policies');
const ok = (msg: string) => console.log(`  ✓ ${msg}`);
const warn = (msg: string) => console.log(`  ! ${msg}`);

async function isReachable(url: string): Promise<boolean> {
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(1500) });
    return resp.ok;
  } catch {
    return false;
  }
}

function ensureAuditSecret(): void {
  const envPath = path.join(root, '.env');
  const env = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  const current = /^AUDIT_HMAC_SECRET=["']?([^"'\r\n]*)["']?\s*$/m.exec(env)?.[1] ?? '';
  if (current.length >= 16) {
    ok('AUDIT_HMAC_SECRET is set in .env');
    return;
  }
  const line = `AUDIT_HMAC_SECRET="${crypto.randomBytes(32).toString('hex')}"`;
  const updated = /^AUDIT_HMAC_SECRET=.*$/m.test(env)
    ? env.replace(/^AUDIT_HMAC_SECRET=.*$/m, line)
    : `${env}${env.endsWith('\n') || env === '' ? '' : '\n'}\n# Signs the tamper-evident audit chain\n${line}\n`;
  fs.writeFileSync(envPath, updated);
  ok('Generated AUDIT_HMAC_SECRET in .env (value not shown)');
}

function archiveDatabase(): void {
  const dbPath = process.env.CONTROLPLANE_DB_PATH || path.join(root, 'data', 'controlplane.db');
  // A pending demo:tamper undo belongs to this database and goes with it
  const files = [dbPath, `${dbPath}-wal`, `${dbPath}-shm`, undoFileFor(dbPath)].filter((f) =>
    fs.existsSync(f),
  );
  if (files.length === 0) {
    ok('No database yet: the server will create a fresh one');
    return;
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const archiveDir = path.join(path.dirname(dbPath), 'archive', stamp);
  fs.mkdirSync(archiveDir, { recursive: true });
  for (const file of files) fs.renameSync(file, path.join(archiveDir, path.basename(file)));
  ok(
    `Archived the database to ${path.relative(root, archiveDir)} (a fresh one is created on start)`,
  );
}

function checkPolicies(): void {
  let changed: string[] = [];
  try {
    changed = execFileSync('git', ['status', '--porcelain', '--', 'policies'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .split('\n')
      .filter(Boolean)
      .map((l) => l.slice(3));
  } catch {
    warn('Could not run git; skipped the policy check');
    return;
  }
  if (changed.length === 0) {
    ok('Policy files match the last commit');
  } else if (restorePolicies) {
    execFileSync('git', ['checkout', '--', 'policies'], { stdio: 'inherit' });
    ok(`Restored ${changed.join(', ')} to the last commit`);
  } else {
    warn(
      `Policy files differ from the last commit: ${changed.join(', ')}. ` +
        'Commit the settings you want to demo, or rerun with --restore-policies.',
    );
  }
}

async function checkOllama(): Promise<void> {
  const base = (process.env.OLLAMA_BASE_URL || 'http://localhost:11434').replace(/\/+$/, '');
  const model = process.env.LOCAL_JUDGE_MODEL || 'qwen2.5:7b';
  try {
    const resp = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(1500) });
    const models: string[] = ((await resp.json()) as any).models?.map((m: any) => m.name) ?? [];
    if (models.includes(model)) ok(`Ollama is running with ${model}`);
    else warn(`Ollama is running but ${model} is not installed: run "ollama pull ${model}"`);
  } catch {
    warn(`Ollama is not reachable at ${base}: start it with "ollama serve" (local Qwen judge)`);
  }
}

async function main(): Promise<void> {
  console.log('ControlPlane Checker: pre-demo reset\n');
  if (await isReachable(`http://localhost:${port}/api/health`)) {
    console.error(`  ✗ The server is running on port ${port}. Stop it first, then rerun.`);
    process.exit(1);
  }
  ensureAuditSecret();
  archiveDatabase();
  checkPolicies();
  await checkOllama();
  console.log('\nStart the server with "npm run dev" and open http://localhost:' + port);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
