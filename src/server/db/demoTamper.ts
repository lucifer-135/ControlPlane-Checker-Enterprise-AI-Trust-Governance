/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Demo tool (`npm run demo:tamper`): plays an insider with direct access to the
 * database file, so the Review Decision Audit Trail's chain can be shown catching
 * them. It bypasses the application, drops the append-only triggers (they do not
 * stop anyone who can open the file), reverses or deletes one review decision, and
 * puts the triggers back so the database looks untouched. What it changed is kept
 * in an undo file next to the database, so the demo can be rehearsed. Never used
 * by the server itself.
 */

import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { POST_MIGRATION_SQL } from './schema.js';

/** reverse: a confirmed block becomes an approval (and the other way round). */
export type TamperMode = 'reverse' | 'delete';

export interface TamperReport {
  mode: TamperMode;
  /** Position of the decision in the chain (the trail, oldest first), from 1. */
  position: number;
  total: number;
  decisionId: string;
  interactionId: string;
  reviewer: string;
  reviewedAt: string;
  actionBefore: string;
  /** The action after the edit; null when the decision was deleted. */
  actionAfter: string | null;
  verdictBefore: string | null;
  verdictAfter: string | null;
}

/** Which decision to tamper with; by default the latest confirmed block. */
export interface TamperTarget {
  /** Position in the chain, from 1. */
  position?: number;
  /** The latest decision on this interaction, e.g. "int-sb-011". */
  interactionId?: string;
}

interface DecisionRow {
  _rowid: number;
  id: string;
  interaction_id: string;
  reviewer: string;
  reviewed_at: string;
  action: string;
  new_verdict: string | null;
  hmac: string | null;
  [column: string]: unknown;
}

interface UndoEntry {
  mode: TamperMode;
  row: DecisionRow;
  report: TamperReport;
}

export const UNDO_FILE_NAME = '.demo-tamper-undo.json';

export const undoFileFor = (dbPath: string): string =>
  path.join(path.dirname(dbPath), UNDO_FILE_NAME);

function openDatabaseFile(dbPath: string): Database.Database {
  if (dbPath === ':memory:' || !fs.existsSync(dbPath)) {
    throw new Error(`No database file at ${dbPath}: start the server once so it is created.`);
  }
  const db = new Database(dbPath);
  // The running server may be writing at the same moment
  db.pragma('busy_timeout = 5000');
  return db;
}

/** Drops the append-only triggers for one change, then puts them back. */
function withAppendOnlyTriggersLifted(db: Database.Database, change: () => void): void {
  db.transaction(() => {
    db.exec(
      'DROP TRIGGER IF EXISTS trg_review_decisions_no_update; DROP TRIGGER IF EXISTS trg_review_decisions_no_delete;',
    );
    change();
    db.exec(POST_MIGRATION_SQL);
  })();
}

/** What an insider turns a decision into: a confirmed block becomes an approval. */
function reversal(row: DecisionRow): { action: string; new_verdict: string } {
  return row.action === 'CONFIRM_BLOCK'
    ? { action: 'OVERRIDE_ALLOW', new_verdict: 'ALLOW' }
    : { action: 'CONFIRM_BLOCK', new_verdict: 'BLOCK_ESCALATE' };
}

/**
 * The decision an insider would want to change: the latest confirmed block,
 * preferably with decisions after it (they then show as no longer trusted). A
 * deleted decision is never the newest one: a later insert could take its row
 * number, and the undo could not put it back.
 */
function pickTarget(rows: DecisionRow[], mode: TamperMode, target: TamperTarget): number {
  const last = rows.length - 1;
  const { position, interactionId } = target;
  if (interactionId !== undefined) {
    let index = -1;
    for (let i = last; i >= 0 && index < 0; i--) {
      if (rows[i].interaction_id === interactionId) index = i;
    }
    if (index < 0) {
      throw new Error(
        `No decision on interaction ${interactionId} in the Review Decision Audit Trail.`,
      );
    }
    if (mode === 'delete' && index === last) {
      throw new Error(
        `The decision on ${interactionId} is the newest one, which cannot be deleted and restored; reverse it instead.`,
      );
    }
    return index;
  }
  if (position !== undefined) {
    const maxPosition = mode === 'delete' ? last : rows.length;
    if (!Number.isInteger(position) || position < 1 || position > maxPosition) {
      throw new Error(
        mode === 'delete'
          ? `--record must be between 1 and ${maxPosition} (the newest decision cannot be deleted and restored)`
          : `--record must be between 1 and ${maxPosition}`,
      );
    }
    return position - 1;
  }
  const latestBlock = (from: number) => {
    for (let i = from; i >= 0; i--) if (rows[i].action === 'CONFIRM_BLOCK') return i;
    return -1;
  };
  const beforeNewest = latestBlock(last - 1);
  if (beforeNewest >= 0) return beforeNewest;
  if (mode === 'reverse' && rows[last].action === 'CONFIRM_BLOCK') return last;
  return mode === 'reverse' ? Math.max(0, last - 1) : last - 1;
}

/** Reverses or deletes one review decision behind the application's back. */
export function tamperReviewDecision(
  dbPath: string,
  mode: TamperMode = 'reverse',
  target: TamperTarget = {},
): TamperReport {
  const undoFile = undoFileFor(dbPath);
  if (fs.existsSync(undoFile)) {
    throw new Error(
      'A tampered decision is still waiting to be restored: run it with --undo first.',
    );
  }
  const db = openDatabaseFile(dbPath);
  try {
    const rows = db
      .prepare('SELECT rowid AS _rowid, * FROM review_decisions ORDER BY rowid')
      .all() as DecisionRow[];
    if (rows.length < (mode === 'delete' ? 2 : 1)) {
      throw new Error(
        mode === 'delete'
          ? 'Deleting needs at least two decisions in the Review Decision Audit Trail: review more items in the Review Queue first.'
          : 'The Review Decision Audit Trail has no decisions yet: review an item in the Review Queue first (e.g. Confirm Block).',
      );
    }
    const index = pickTarget(rows, mode, target);
    const row = rows[index];
    const after = mode === 'delete' ? null : reversal(row);
    const report: TamperReport = {
      mode,
      position: index + 1,
      total: rows.length,
      decisionId: row.id,
      interactionId: row.interaction_id,
      reviewer: row.reviewer,
      reviewedAt: row.reviewed_at,
      actionBefore: row.action,
      actionAfter: after?.action ?? null,
      verdictBefore: row.new_verdict,
      verdictAfter: after?.new_verdict ?? null,
    };

    // Keep the original before touching it
    fs.writeFileSync(undoFile, JSON.stringify({ mode, row, report } satisfies UndoEntry, null, 2));
    try {
      withAppendOnlyTriggersLifted(db, () => {
        if (after) {
          db.prepare('UPDATE review_decisions SET action = ?, new_verdict = ? WHERE rowid = ?').run(
            after.action,
            after.new_verdict,
            row._rowid,
          );
        } else {
          db.prepare('DELETE FROM review_decisions WHERE rowid = ?').run(row._rowid);
        }
      });
    } catch (err) {
      fs.rmSync(undoFile, { force: true });
      throw err;
    }
    return report;
  } finally {
    db.close();
  }
}

/** Puts back what tamperReviewDecision changed, so the chain verifies again. */
export function undoTamper(dbPath: string): TamperReport {
  const undoFile = undoFileFor(dbPath);
  if (!fs.existsSync(undoFile)) {
    throw new Error('Nothing to undo: no tampered decision is waiting to be restored.');
  }
  const { mode, row, report } = JSON.parse(fs.readFileSync(undoFile, 'utf-8')) as UndoEntry;
  const stale = `The tampered decision is no longer in this database (was it reset?). Delete ${undoFile} to start over.`;

  const db = openDatabaseFile(dbPath);
  try {
    withAppendOnlyTriggersLifted(db, () => {
      if (mode === 'delete') {
        // Only put it back where it came from: the decision after it still links to it
        const successor = db
          .prepare('SELECT 1 FROM review_decisions WHERE prev_hmac = ?')
          .get(row.hmac);
        if (!successor) throw new Error(stale);
        const known = new Set(
          (db.prepare('PRAGMA table_info(review_decisions)').all() as { name: string }[]).map(
            (c) => c.name,
          ),
        );
        const { _rowid, ...columns } = row;
        const names = Object.keys(columns).filter((name) => known.has(name));
        db.prepare(
          `INSERT INTO review_decisions (rowid, ${names.join(', ')}) VALUES (${['?', ...names.map(() => '?')].join(', ')})`,
        ).run(_rowid, ...names.map((name) => columns[name]));
      } else {
        const restored = db
          .prepare('UPDATE review_decisions SET action = ?, new_verdict = ? WHERE id = ?')
          .run(row.action, row.new_verdict, row.id).changes;
        if (restored !== 1) throw new Error(stale);
      }
    });
  } finally {
    db.close();
  }
  fs.rmSync(undoFile);
  return report;
}
