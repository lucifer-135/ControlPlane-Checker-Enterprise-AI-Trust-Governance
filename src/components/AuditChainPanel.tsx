/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Audit trail integrity: re-verifies the signed, linked review decisions (the Review
 * Decision Audit Trail) and draws the latest ones as a chain, so a rewritten or
 * deleted decision shows exactly where the chain breaks (see `npm run demo:tamper`).
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  Check,
  Link2,
  Loader2,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Unlink,
  X,
} from 'lucide-react';
import { apiFetch, readErrorMessage } from '../lib/apiClient';
import type { ChainBreakKind } from '../server/db/auditChain';
import type { DecisionBlockSummary } from '../server/db/decisionChain';

export interface AuditChainStatus {
  valid: boolean;
  totalVerified: number;
  brokenAtIndex?: number;
  brokenRecordId?: string;
  reason?: string;
  kind?: ChainBreakKind;
  totalRecords: number;
  headRecordCount: number | null;
  blocks: DecisionBlockSummary[];
  signingSecretConfigured: boolean;
  timestamp: string;
}

type ChainStatus = AuditChainStatus;

interface AuditChainPanelProps {
  /** Changes whenever the trail changes (e.g. the decisions list), to re-verify it. */
  refreshKey?: unknown;
  /** Receives every verification result (e.g. to flag the broken row in the trail). */
  onVerified?: (status: AuditChainStatus) => void;
  /** Called when someone clicks Verify chain (e.g. to reload the trail from the database). */
  onManualVerify?: () => void;
}

const ACTION_LABELS: Record<string, { label: string; className: string }> = {
  CONFIRM_BLOCK: { label: 'Confirmed block', className: 'text-[#B42318]' },
  OVERRIDE_ALLOW: { label: 'Overrode to allow', className: 'text-[#067647]' },
  EDIT_ALLOW: { label: 'Edited & allowed', className: 'text-[#3F3BAF]' },
};

const VERDICT_SHORT: Record<string, string> = {
  ALLOW: 'Allow',
  BADGE: 'Badge',
  SOFT_CORRECT: 'Soft-correct',
  BLOCK_ESCALATE: 'Block',
};

/** Headline and plain-language explanation of a verification result. */
function describeResult(status: ChainStatus): { headline: string; detail: string } {
  if (status.valid) {
    return status.totalRecords === 0
      ? {
          headline: 'No decisions yet',
          detail:
            'Every decision recorded in the Review Queue is signed and added to the chain as it is made.',
        }
      : {
          headline: 'Chain intact',
          detail: `All ${status.totalRecords} decisions in the audit trail match their signatures and link to the decision before them.`,
        };
  }
  const n = (status.brokenAtIndex ?? 0) + 1;
  const missing = Math.max(0, (status.headRecordCount ?? 0) - status.totalRecords);
  switch (status.kind) {
    case 'signature':
      return {
        headline: `Tamper detected at decision #${n}`,
        detail: `Decision #${n} was changed after it was signed: its contents (for example the action, the verdict or the reviewer) no longer match its signature.`,
      };
    case 'link':
      return {
        headline: `Chain broken before decision #${n}`,
        detail: `A decision just before #${n} was deleted, or decisions were reordered: #${n} no longer links to the decision before it.`,
      };
    case 'genesis':
      return {
        headline: 'Chain broken at its start',
        detail:
          'The oldest decisions were deleted: the chain no longer starts at its first decision.',
      };
    case 'truncated':
      return {
        headline: 'Decisions missing from the end',
        detail: `${missing || 'Some'} decision${missing === 1 ? ' was' : 's were'} deleted from the end of the trail: the signed chain head expects ${status.headRecordCount}, but ${status.totalRecords} remain.`,
      };
    case 'head_invalid':
      return {
        headline: 'Chain head altered',
        detail: 'The signed end-of-chain record was changed, so no decision can be trusted.',
      };
    case 'head_missing':
      return {
        headline: 'Chain head removed',
        detail: 'The signed end-of-chain record was deleted, so no decision can be trusted.',
      };
    default:
      return { headline: 'Tamper detected', detail: status.reason ?? '' };
  }
}

/** A red marker for decisions that are gone (deleted from the middle, start or end). */
const MissingMarker: React.FC<{ label: string }> = ({ label }) => (
  <div className="w-24 shrink-0 self-stretch rounded-xl border-2 border-dashed border-[#F04438] bg-[#FEF3F2]/70 flex flex-col items-center justify-center gap-1 text-[10px] font-semibold text-[#B42318] px-2 text-center">
    <Unlink className="h-3.5 w-3.5" />
    {label}
  </div>
);

const Connector: React.FC<{ state: 'ok' | 'broken' | 'unknown' }> = ({ state }) => (
  <div
    className={`w-4 shrink-0 self-center h-0.5 ${
      state === 'ok' ? 'bg-[#12B76A]' : state === 'broken' ? 'bg-[#F04438]' : 'bg-slate-300'
    }`}
  />
);

const Block: React.FC<{ block: DecisionBlockSummary }> = ({ block }) => {
  const action = block.action ? ACTION_LABELS[block.action] : null;
  const styles = {
    verified: 'border-[#ABEFC6] bg-[#ECFDF3]/60',
    broken: 'border-[#F04438] bg-[#FEF3F2] ring-4 ring-[#F04438]/20',
    unchecked: 'border-dashed border-slate-300 bg-slate-50/80 opacity-70',
  }[block.state];
  const verdict = (v: string | null) => (v ? (VERDICT_SHORT[v] ?? v) : '—');
  return (
    <div
      className={`w-36 shrink-0 rounded-xl border p-2.5 space-y-1 text-[10px] leading-tight ${styles}`}
      title={`Decision #${block.index + 1} · ${block.id}${block.reviewer ? `\nReviewer: ${block.reviewer}` : ''}\nSignature ${block.hmac}… · links to ${block.prev ?? 'the start'}…`}
    >
      <div className="flex items-center justify-between">
        <span className="font-mono font-semibold text-[#101828] text-[11px] tnum">
          #{block.index + 1}
        </span>
        {block.state === 'verified' && <Check className="h-3.5 w-3.5 text-[#12B76A]" />}
        {block.state === 'broken' && <X className="h-3.5 w-3.5 text-[#D92D20]" />}
        {block.state === 'unchecked' && (
          <span className="text-[9px] font-semibold text-[#98A2B3]">not trusted</span>
        )}
      </div>
      <div className={`font-semibold truncate ${action?.className ?? 'text-[#98A2B3]'}`}>
        {action ? action.label : block.action === null ? 'Other tenant' : block.action}
      </div>
      <div className="font-mono text-[#475467] truncate" title={block.interaction_id ?? undefined}>
        {block.interaction_id ?? '—'}
      </div>
      {block.action !== null && (
        <div className="flex items-center gap-1 text-[#667085] truncate">
          {verdict(block.original_verdict)}
          <ArrowRight className="h-2.5 w-2.5 shrink-0" />
          {verdict(block.new_verdict)}
        </div>
      )}
      <div className="font-mono text-[#98A2B3] truncate">sig {block.hmac}</div>
    </div>
  );
};

export const AuditChainPanel: React.FC<AuditChainPanelProps> = ({
  refreshKey,
  onVerified,
  onManualVerify,
}) => {
  // Latest callback without re-creating verify (it would re-trigger the effect below)
  const onVerifiedRef = useRef(onVerified);
  onVerifiedRef.current = onVerified;
  const [status, setStatus] = useState<ChainStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const verify = useCallback(async () => {
    setChecking(true);
    setError(null);
    try {
      const resp = await apiFetch('/api/review-decisions/verify');
      if (resp.status === 403) {
        setError('Verifying the chain needs an admin key.');
        setStatus(null);
      } else if (!resp.ok) {
        setError(await readErrorMessage(resp));
        setStatus(null);
      } else {
        const result: ChainStatus = await resp.json();
        setStatus(result);
        onVerifiedRef.current?.(result);
      }
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setChecking(false);
    }
  }, []);

  // Verify on opening, and again shortly after the trail changes (a decision was
  // appended and saved)
  useEffect(() => {
    const timer = setTimeout(verify, 400);
    return () => clearTimeout(timer);
  }, [verify, refreshKey]);

  const result = status ? describeResult(status) : null;
  const blocks = status?.blocks ?? [];
  const first = blocks[0];
  const last = blocks[blocks.length - 1];
  const missingAtEnd = status?.kind === 'truncated';
  const headBroken = status?.kind === 'head_invalid' || status?.kind === 'head_missing';

  return (
    <div className="glass-panel rounded-2xl p-6 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 border-b border-slate-200 pb-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <h3 className="font-headline text-lg text-[#101828] font-semibold tracking-tight flex items-center">
              <Link2 className="h-5 w-5 text-[#4F46E5] mr-2.5" />
              Audit Trail Integrity
            </h3>
            <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold bg-[#EEF0FE] text-[#4F46E5] border border-[#D9D6FE]">
              HMAC-SHA256
            </span>
          </div>
          <p className="text-xs text-[#667085] leading-relaxed max-w-2xl">
            Every decision appended to the Review Decision Audit Trail is signed and linked to the
            one before it, so editing, deleting or reordering any decision breaks the chain at that
            point.
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {status && (
            <span className="text-[11px] text-[#98A2B3] font-mono tnum">
              checked {new Date(status.timestamp).toLocaleTimeString()}
            </span>
          )}
          <button
            type="button"
            onClick={() => {
              onManualVerify?.();
              verify();
            }}
            disabled={checking}
            className="glass-btn-primary text-white px-3.5 py-2 rounded-xl text-xs font-medium flex items-center gap-2 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {checking ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Verify chain
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-[#FEDF89] bg-[#FFFAEB] px-4 py-3 text-xs text-[#B54708]">
          {error}
        </div>
      )}

      {status && result && (
        <div
          role="status"
          aria-live="polite"
          className={`rounded-xl border px-4 py-3 flex items-start gap-3 ${
            status.valid ? 'border-[#ABEFC6] bg-[#ECFDF3]' : 'border-[#FECDCA] bg-[#FEF3F2]'
          }`}
        >
          {status.valid ? (
            <ShieldCheck className="h-5 w-5 text-[#12B76A] shrink-0 mt-0.5" />
          ) : (
            <ShieldAlert className="h-5 w-5 text-[#D92D20] shrink-0 mt-0.5" />
          )}
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`text-sm font-semibold ${status.valid ? 'text-[#067647]' : 'text-[#B42318]'}`}
              >
                {result.headline}
              </span>
              {status.valid && status.totalRecords > 0 && (
                <span className="text-xs text-[#067647] font-mono tnum">
                  · {status.totalRecords} decisions verified
                </span>
              )}
              <span
                className={`text-[10px] font-semibold px-2 py-0.5 rounded-md border ${
                  status.signingSecretConfigured
                    ? 'bg-white text-[#067647] border-[#ABEFC6]'
                    : 'bg-[#FFFAEB] text-[#B54708] border-[#FEDF89]'
                }`}
              >
                {status.signingSecretConfigured
                  ? 'Signed with a private key'
                  : 'Signed with the public dev key: set AUDIT_HMAC_SECRET'}
              </span>
            </div>
            <p className={`text-xs ${status.valid ? 'text-[#067647]' : 'text-[#B42318]'}`}>
              {result.detail}
            </p>
            {!status.valid && status.reason && (
              <details className="text-[11px] text-[#912018]">
                <summary className="cursor-pointer select-none font-medium">
                  Technical detail
                </summary>
                <p className="mt-1 font-mono break-all">{status.reason}</p>
              </details>
            )}
          </div>
        </div>
      )}

      {blocks.length > 0 && first && last && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#667085]">
            <span>
              Decisions <span className="font-mono tnum">#{first.index + 1}</span>–
              <span className="font-mono tnum">#{last.index + 1}</span> of{' '}
              <span className="font-mono tnum">{status?.totalRecords}</span>, oldest on the left
            </span>
            <span className="flex items-center gap-3">
              <span className="flex items-center gap-1">
                <Check className="h-3 w-3 text-[#12B76A]" /> verified
              </span>
              <span className="flex items-center gap-1">
                <X className="h-3 w-3 text-[#D92D20]" /> broken
              </span>
              <span>not trusted: after the break</span>
            </span>
          </div>
          <div className="flex items-stretch overflow-x-auto pb-2 scrollbar-thin">
            {status?.kind === 'genesis' && first.index === 0 && (
              <>
                <MissingMarker label="Earlier decisions deleted" />
                <Connector state="broken" />
              </>
            )}
            {blocks.map((block, i) => (
              <React.Fragment key={block.id}>
                {i > 0 &&
                  (block.state === 'broken' && status?.kind === 'link' ? (
                    <>
                      <Connector state="broken" />
                      <MissingMarker label="Decision missing" />
                      <Connector state="broken" />
                    </>
                  ) : (
                    <Connector
                      state={
                        block.state === 'verified'
                          ? 'ok'
                          : block.state === 'broken'
                            ? 'broken'
                            : 'unknown'
                      }
                    />
                  ))}
                <Block block={block} />
              </React.Fragment>
            ))}
            {missingAtEnd && (
              <>
                <Connector state="broken" />
                <MissingMarker
                  label={`${Math.max(1, (status?.headRecordCount ?? 0) - (status?.totalRecords ?? 0))} deleted at the end`}
                />
              </>
            )}
            {headBroken && (
              <>
                <Connector state="broken" />
                <MissingMarker
                  label={
                    status?.kind === 'head_invalid' ? 'Chain head altered' : 'Chain head removed'
                  }
                />
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
