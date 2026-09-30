/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Audit-trail tamper demo. Acts as an insider with direct access to the database
 * file and rewrites a reviewer's decision in the Review Decision Audit Trail; then
 * "Verify chain" in the Review Queue shows exactly where the chain broke:
 *
 *   npm run demo:tamper                              # reverses the latest confirmed block into an approval
 *   npm run demo:tamper -- --interaction int-sb-011  # the latest decision on that interaction
 *   npm run demo:tamper -- --record 2                # decision #2 of the trail (oldest first)
 *   npm run demo:tamper -- --delete                  # deletes the decision instead
 *   npm run demo:tamper -- --undo                    # puts the original back; the chain verifies again
 *
 * npm run demo:reset also starts over with a fresh database.
 */

import 'dotenv/config';
import * as path from 'path';
import { resolveDbPath } from '../src/server/db/database';
import { tamperReviewDecision, undoTamper, type TamperReport } from '../src/server/db/demoTamper';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

const dbPath = resolveDbPath();
const relativePath = path.relative(process.cwd(), dbPath);
const shownPath =
  relativePath && !relativePath.startsWith('..') && !path.isAbsolute(relativePath)
    ? relativePath
    : dbPath;

function describe(report: TamperReport): string {
  const when = new Date(report.reviewedAt).toLocaleString();
  return (
    `decision #${report.position} of ${report.total} ` +
    `(interaction ${report.interactionId}, reviewed by ${report.reviewer}, ${when})`
  );
}

try {
  if (process.argv.includes('--undo')) {
    const report = undoTamper(dbPath);
    console.log(`Restored ${describe(report)}.`);
    console.log('Click "Verify chain" in the Review Queue: the chain verifies again.');
  } else {
    const recordArg = arg('record');
    const report = tamperReviewDecision(
      dbPath,
      process.argv.includes('--delete') ? 'delete' : 'reverse',
      {
        position: recordArg !== undefined ? Number(recordArg) : undefined,
        interactionId: arg('interaction'),
      },
    );
    console.log(`Acting as an insider with direct access to ${shownPath}:\n`);
    if (report.mode === 'delete') {
      console.log(`  Deleted ${describe(report)}: ${report.actionBefore}.`);
    } else {
      console.log(`  Rewrote ${describe(report)}:`);
      console.log(`  action   ${report.actionBefore}  →  ${report.actionAfter}`);
      console.log(`  verdict  ${report.verdictBefore}  →  ${report.verdictAfter}`);
    }
    console.log(
      '\n  The append-only triggers were dropped for the change and put back afterwards,',
    );
    console.log('  so the database itself looks untouched.\n');
    console.log(
      `Now click "Verify chain" in the Review Queue: the chain breaks at decision #${report.position}.`,
    );
    console.log('Undo with: npm run demo:tamper -- --undo');
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
