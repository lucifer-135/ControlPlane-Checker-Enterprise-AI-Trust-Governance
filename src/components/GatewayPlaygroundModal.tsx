/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Gateway Playground: sends OpenAI-compatible requests through the governance
 * gateway (POST /v1/chat/completions) and shows exactly what the calling app
 * receives. Requests either reach the real model or carry a scripted model answer
 * that the gateway governs without calling a model (repeatable demos).
 *
 * Every request is governed, audited and appended to the Live Stream, which is
 * where its full three-lane analysis and the LLM judge are available.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUpRight,
  Check,
  Copy,
  Loader2,
  PenLine,
  Radio,
  Send,
  ShieldAlert,
  ShieldCheck,
  X,
} from 'lucide-react';
import type { UseCaseId, VerdictTier } from '../types';
import { apiFetch, getStoredApiKey } from '../lib/apiClient';
import { scanInput } from '../lib/inputGuard';
import { DEMO_API_KEY } from '../lib/demoKey';
import { BASELINE_METRICS } from '../data/baselines';
import { chatModelChoices, type ModelChoice } from '../lib/modelCatalog';
import {
  GATEWAY_SCENARIOS,
  SCENARIO_GROUP_LABELS,
  buildScenarioRequest,
  collectStreamText,
  scenarioMessages,
  type GatewayRequestSpec,
  type GatewayScenario,
  type ScenarioGroup,
} from '../lib/gatewayScenarios';
import { GlassDropdown } from './GlassDropdown';
import { ModelPicker } from './ModelPicker';
import { VerdictBadge } from './VerdictBadge';
import { renderRedactions } from './UserVisibleResponse';

interface GatewayPlaygroundModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Opens the Live Stream focused on the interaction the gateway recorded. */
  onViewInLiveStream: (interactionId?: string) => void;
  /** Called after each request, so the dashboard picks up the new live event at once. */
  onRequestSent?: () => void;
}

type Mode = 'live' | 'scripted';

interface RequestForm {
  policy: UseCaseId;
  stream: boolean;
  system: string;
  context: string;
  user: string;
  workload: string;
}

interface ScriptedForm {
  response: string;
  totalTokens: number;
  latencyMs: number;
}

interface PlaygroundResult {
  status: number;
  ms: number;
  headers: Record<string, string>;
  content: string;
  raw: string;
  streamed: boolean;
  /** A stream's verdict, read from the recorded event once the stream ended. */
  recordedVerdict?: VerdictTier;
}

const PREFERRED_MODEL = 'gemini-flash-lite-latest';
const DELIVERY_NOTE_SEPARATOR = '\n\n---\n';

const POLICY_OPTIONS = [
  {
    value: 'support_bot' as UseCaseId,
    label: 'Customer Support Bot',
    description: 'Customer-facing; PII redaction, pre-response blocking.',
    badge: 'External',
    badgeColor: 'bg-[#EFF6FF] text-[#175CD3] border-[#B2DDFF]',
  },
  {
    value: 'internal_copilot' as UseCaseId,
    label: 'Internal Copilot',
    description: 'Employee assistant; delivers escalations for post-delivery review.',
    badge: 'Internal',
    badgeColor: 'bg-[#F4F3FF] text-[#6941C6] border-[#D9D6FE]',
  },
  {
    value: 'decision_support' as UseCaseId,
    label: 'Decision Support',
    description: 'Regulated loans and claims; fail-closed, pre-response blocking.',
    badge: 'High-Risk',
    badgeColor: 'bg-[#FEF3F2] text-[#B42318] border-[#FECDCA]',
  },
];

const GROUP_STYLES: Record<ScenarioGroup, { idle: string; active: string; dot: string }> = {
  attack: {
    idle: 'text-[#B42318] border-[#FECDCA] hover:border-[#FDA29B]',
    active: 'bg-[#FEF3F2] text-[#B42318] border-[#F04438] shadow-xs',
    dot: 'bg-[#F04438]',
  },
  live: {
    idle: 'text-[#067647] border-[#ABEFC6] hover:border-[#75E0A7]',
    active: 'bg-[#ECFDF3] text-[#067647] border-[#12B76A] shadow-xs',
    dot: 'bg-[#12B76A]',
  },
  scripted: {
    idle: 'text-[#4F46E5] border-[#D9D6FE] hover:border-[#BDB4FE]',
    active: 'bg-[#EEF0FE] text-[#4F46E5] border-[#4F46E5] shadow-xs',
    dot: 'bg-[#4F46E5]',
  },
};

const FRIENDLY_HEADERS: Record<string, string> = {
  'x-controlplane-verdict': 'Verdict',
  'x-controlplane-risk-score': 'Risk score',
  'x-controlplane-session-risk': 'Session risk',
  'x-controlplane-policy': 'Policy',
  'x-controlplane-policy-version': 'Policy version',
  'x-controlplane-latency-ms': 'Gateway + model time (ms)',
  'x-controlplane-tenant': 'Tenant',
  'x-controlplane-interaction-id': 'Interaction ID',
  'x-controlplane-response-source': 'Response source',
  'x-controlplane-intercepted': 'Stream inspected',
};

const inputClass =
  'w-full glass-input rounded-xl px-3 py-2.5 text-xs leading-relaxed text-[#101828] placeholder:text-[#98A2B3]';

function workloadOptions(policy: UseCaseId) {
  return [
    {
      value: '',
      label: 'Untagged',
      description: 'Shared gateway baseline (warms up before the cost lane scores)',
    },
    ...Object.values(BASELINE_METRICS)
      .filter((b) => b.use_case === policy)
      .map((b) => ({
        value: b.query_type,
        label: b.query_type.replace(/_/g, ' '),
        description: `Baseline ≈ ${b.mean_tokens.toLocaleString()} ± ${b.stddev_tokens.toLocaleString()} tokens, ${b.mean_latency_ms.toLocaleString()} ms`,
      })),
  ];
}

function formFromScenario(s: GatewayScenario): RequestForm {
  return {
    policy: s.policy,
    stream: s.stream,
    system: s.system ?? '',
    context: s.context ?? '',
    user: s.user,
    workload: s.workload ?? '',
  };
}

function codeSnippets(spec: GatewayRequestSpec, model: string, baseUrl: string) {
  const messages = scenarioMessages(spec);
  const headers: Record<string, string> = {
    'X-Policy-Profile': spec.policy,
    ...(spec.workload ? { 'X-ControlPlane-Workload': spec.workload } : {}),
    ...(spec.context ? { 'X-ControlPlane-Context': '<base64 of the retrieved documents>' } : {}),
  };
  const gatewayOptions = spec.scripted
    ? {
        controlplane: {
          scripted_response: spec.scripted.response,
          ...(spec.scripted.totalTokens ? { total_tokens: spec.scripted.totalTokens } : {}),
          ...(spec.scripted.latencyMs ? { latency_ms: spec.scripted.latencyMs } : {}),
        },
      }
    : null;
  const indent = (json: string) => json.replace(/\n/g, '\n    ');

  const python = [
    'from openai import OpenAI',
    '',
    `client = OpenAI(base_url="${baseUrl}",   # the only change: this URL…`,
    '                api_key="<your ControlPlane key>")  # …and this key',
    '',
    'response = client.chat.completions.create(',
    `    model="${model}",`,
    `    messages=${indent(JSON.stringify(messages, null, 4))},`,
    ...(spec.stream ? ['    stream=True,'] : []),
    `    extra_headers=${indent(JSON.stringify(headers, null, 4))},`,
    ...(gatewayOptions
      ? [`    extra_body=${indent(JSON.stringify(gatewayOptions, null, 4))},`]
      : []),
    ')',
  ].join('\n');

  const body = JSON.stringify({ model, stream: spec.stream, messages, ...(gatewayOptions ?? {}) });
  const curl = [
    `curl ${baseUrl}/chat/completions \\`,
    '  -H "Authorization: Bearer <your ControlPlane key>" \\',
    '  -H "Content-Type: application/json" \\',
    ...Object.entries(headers).map(([k, v]) => `  -H "${k}: ${v}" \\`),
    `  -d '${body.replace(/'/g, "'\\''")}'`,
  ].join('\n');

  return { python, curl };
}

/**
 * A stream's verdict is decided when the stream ends, after its headers were sent,
 * so it is read back from the event the gateway recorded.
 */
async function fetchRecordedVerdict(
  interactionId: string | undefined,
  headers: Record<string, string>,
): Promise<VerdictTier | null> {
  if (!interactionId) return null;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const resp = await apiFetch('/api/gateway/events?limit=100', { headers });
      if (resp.ok) {
        const { events } = await resp.json();
        const event = (events ?? []).find(
          (e: { interaction?: { id?: string } }) => e.interaction?.id === interactionId,
        );
        if (event?.evaluation?.verdict) return event.evaluation.verdict;
      }
    } catch {
      // Retried below
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return null;
}

/** Splits the delivered text into the answer and the delivery note the gateway appended. */
function splitDeliveryNote(content: string): { body: string; note: string | null } {
  const at = content.lastIndexOf(DELIVERY_NOTE_SEPARATOR);
  if (at < 0) return { body: content, note: null };
  return {
    body: content.slice(0, at),
    note: content
      .slice(at + DELIVERY_NOTE_SEPARATOR.length)
      .replace(/\*/g, '')
      .trim(),
  };
}

const Section: React.FC<{
  title: string;
  hint?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, hint, right, children }) => (
  <section className="rounded-2xl border border-slate-200/80 bg-white/70 p-4 space-y-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
    <div className="flex items-start justify-between gap-3">
      <div>
        <h4 className="text-xs font-semibold text-[#101828] tracking-tight">{title}</h4>
        {hint && <p className="text-[11px] text-[#667085] mt-0.5 leading-relaxed">{hint}</p>}
      </div>
      {right}
    </div>
    {children}
  </section>
);

const FieldLabel: React.FC<{ label: string; hint?: string; right?: React.ReactNode }> = ({
  label,
  hint,
  right,
}) => (
  <div className="flex items-end justify-between gap-2 mb-1.5">
    <span className="text-xs font-medium text-[#344054]">
      {label}
      {hint && <span className="ml-1.5 font-normal text-[11px] text-[#98A2B3]">{hint}</span>}
    </span>
    {right}
  </div>
);

export const GatewayPlaygroundModal: React.FC<GatewayPlaygroundModalProps> = ({
  isOpen,
  onClose,
  onViewInLiveStream,
  onRequestSent,
}) => {
  const initial = GATEWAY_SCENARIOS.find((s) => s.id === 'clean') ?? GATEWAY_SCENARIOS[0];
  const [scenarioId, setScenarioId] = useState<string | null>(initial.id);
  const [mode, setMode] = useState<Mode>(initial.scripted ? 'scripted' : 'live');
  const [form, setForm] = useState<RequestForm>(() => formFromScenario(initial));
  const [scripted, setScripted] = useState<ScriptedForm>({
    response: '',
    totalTokens: 0,
    latencyMs: 0,
  });
  const [model, setModel] = useState(PREFERRED_MODEL);
  const [modelChoices, setModelChoices] = useState<ModelChoice[]>([]);
  const [authMode, setAuthMode] = useState<'dev' | 'required' | null>(null);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<PlaygroundResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [codeTab, setCodeTab] = useState<'python' | 'curl'>('python');
  const [copied, setCopied] = useState(false);
  const responseRef = useRef<HTMLDivElement>(null);

  // The key the playground's requests carry: the operator's key if one is stored,
  // otherwise the published development key (accepted only in dev auth mode)
  const playgroundKey = getStoredApiKey() ?? (authMode === 'dev' ? DEMO_API_KEY : null);
  const authHeaders = useMemo<Record<string, string>>(
    () => (playgroundKey ? { Authorization: `Bearer ${playgroundKey}` } : {}),
    [playgroundKey],
  );

  useEffect(() => {
    if (!isOpen) return;
    fetch('/api/health')
      .then((r) => r.json())
      .then((d) => setAuthMode(d?.authMode === 'required' ? 'required' : 'dev'))
      .catch(() => setAuthMode('dev'));
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || authMode === null) return;
    apiFetch('/v1/models', { headers: authHeaders })
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((d) => {
        const choices = chatModelChoices((d.data ?? []).map((m: { id: string }) => m.id));
        setModelChoices(choices);
        if (choices.length > 0 && !choices.some((c) => c.id === PREFERRED_MODEL)) {
          setModel(choices[0].id);
        }
      })
      .catch(() => setModelChoices([]));
  }, [isOpen, authMode, authHeaders]);

  const spec: GatewayRequestSpec = {
    policy: form.policy,
    stream: form.stream,
    system: form.system.trim() || undefined,
    context: form.context.trim() || undefined,
    user: form.user,
    workload: form.workload || undefined,
    scripted:
      mode === 'scripted'
        ? {
            response: scripted.response,
            totalTokens: scripted.totalTokens || undefined,
            latencyMs: scripted.latencyMs || undefined,
          }
        : undefined,
  };

  const guard = useMemo(() => scanInput(form.user), [form.user]);
  const baseUrl = `${window.location.origin}/v1`;
  const snippets = useMemo(
    () => codeSnippets(spec, model, baseUrl),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(spec), model, baseUrl],
  );
  const selectedScenario = GATEWAY_SCENARIOS.find((s) => s.id === scenarioId) ?? null;
  const canSend =
    !sending &&
    form.user.trim().length > 0 &&
    (mode === 'live' ? model.trim().length > 0 : scripted.response.trim().length > 0);

  const send = async () => {
    if (!canSend) return;
    setSending(true);
    setResult(null);
    setError(null);
    // Single-column layout (below Tailwind's lg): the response sits under the form
    if (!window.matchMedia('(min-width: 64rem)').matches) {
      responseRef.current?.scrollIntoView({ block: 'start' });
    }
    const { body, headers } = buildScenarioRequest(
      spec,
      model,
      `playground-${Math.random().toString(36).slice(2, 10)}`,
    );
    const start = performance.now();
    try {
      const resp = await apiFetch('/v1/chat/completions', {
        method: 'POST',
        headers: { ...headers, ...authHeaders },
        body: JSON.stringify(body),
      });
      const governance = Object.fromEntries(
        [...resp.headers.entries()].filter(([k]) => k.startsWith('x-controlplane')),
      );
      const isStream = (resp.headers.get('content-type') || '').includes('text/event-stream');

      if (isStream && resp.body) {
        // Shown as it streams, exactly as the app receives it
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let raw = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          raw += decoder.decode(value, { stream: true });
          setResult({
            status: resp.status,
            ms: Math.round(performance.now() - start),
            headers: governance,
            content: collectStreamText(raw),
            raw,
            streamed: true,
          });
        }
        const recorded = await fetchRecordedVerdict(
          governance['x-controlplane-interaction-id'],
          authHeaders,
        );
        if (recorded) setResult((r) => (r ? { ...r, recordedVerdict: recorded } : r));
      } else {
        const text = await resp.text();
        let content = text;
        try {
          const data = JSON.parse(text);
          content = data.choices?.[0]?.message?.content ?? data.error?.message ?? text;
        } catch {
          // Non-JSON body: shown as is
        }
        setResult({
          status: resp.status,
          ms: Math.round(performance.now() - start),
          headers: governance,
          content,
          raw: text,
          streamed: false,
        });
      }
      onRequestSent?.();
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setSending(false);
    }
  };

  // Ctrl/Cmd+Enter sends; Escape closes (unless an open dropdown handled it)
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) onClose();
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!isOpen) return null;

  const loadScenario = (s: GatewayScenario) => {
    setScenarioId(s.id);
    setForm(formFromScenario(s));
    setMode(s.scripted ? 'scripted' : 'live');
    if (s.scripted) {
      setScripted({
        response: s.scripted.response,
        totalTokens: s.scripted.totalTokens ?? 0,
        latencyMs: s.scripted.latencyMs ?? 0,
      });
    }
    setResult(null);
    setError(null);
  };

  const edit = (patch: Partial<RequestForm>) => {
    setForm((f) => ({ ...f, ...patch }));
    setScenarioId(null);
  };

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(snippets[codeTab]);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable
    }
  };

  const verdict = (result?.headers['x-controlplane-verdict'] ?? result?.recordedVerdict) as
    VerdictTier | undefined;
  const interactionId = result?.headers['x-controlplane-interaction-id'];
  const source = result?.headers['x-controlplane-response-source'];
  const delivered = result ? splitDeliveryNote(result.content) : null;
  const failed = !!result && result.status >= 400;

  return (
    <div
      className="fixed inset-0 z-50 glass-scrim flex items-center justify-center p-3 sm:p-6 animate-in fade-in duration-200"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="gateway-playground-title"
        className="glass-dialog rounded-3xl w-full max-w-6xl max-h-[92vh] flex flex-col overflow-hidden shadow-2xl"
      >
        {/* Header */}
        <div className="shrink-0 bg-slate-100/70 px-4 sm:px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-4 backdrop-blur-md">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-9 w-9 shrink-0 rounded-xl bg-linear-to-br from-[#4F46E5] to-[#7A5AF8] flex items-center justify-center text-white shadow-md">
              <Radio className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <h3
                id="gateway-playground-title"
                className="font-headline text-base font-semibold text-[#101828] tracking-tight"
              >
                Gateway Playground
              </h3>
              <p className="text-xs text-[#667085] truncate">
                Send OpenAI-compatible requests through the governance gateway. Each one is
                governed, audited and appended to the Live Stream.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <code className="hidden md:inline-flex items-center gap-1.5 text-[11px] font-mono text-[#4F46E5] bg-white/80 border border-slate-200 rounded-lg px-2 py-1">
              <span className="font-semibold">POST</span> /v1/chat/completions
            </code>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl text-[#667085] hover:text-[#101828] hover:bg-white/70 transition-colors cursor-pointer"
              aria-label="Close gateway playground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Below the header: one scroll area on narrow screens; on wide screens the
            presets stay put and each column scrolls on its own */}
        <div className="flex-1 min-h-0 overflow-y-auto lg:overflow-hidden lg:flex lg:flex-col">
          {/* Scenario presets */}
          <div className="shrink-0 px-4 sm:px-6 py-3 border-b border-slate-200 bg-white/40 space-y-2 sm:space-y-1.5">
            {(['attack', 'live', 'scripted'] as ScenarioGroup[]).map((group) => (
              <div key={group} className="flex flex-col sm:flex-row sm:items-start gap-1.5">
                <span className="sm:w-32 shrink-0 sm:pt-1 flex items-center gap-1.5 text-[11px] font-semibold text-[#475467]">
                  <span className={`h-1.5 w-1.5 rounded-full ${GROUP_STYLES[group].dot}`} />
                  {SCENARIO_GROUP_LABELS[group]}
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {GATEWAY_SCENARIOS.filter((s) => s.group === group).map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => loadScenario(s)}
                      title={s.narration}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-all cursor-pointer ${
                        scenarioId === s.id
                          ? GROUP_STYLES[group].active
                          : `bg-white/80 hover:bg-white ${GROUP_STYLES[group].idle}`
                      }`}
                    >
                      {s.title}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Body */}
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:flex-1 lg:min-h-0">
            {/* ── Request ── */}
            <div className="lg:overflow-y-auto lg:border-r border-slate-200 flex flex-col">
              <div className="p-4 sm:p-5 space-y-4 flex-1">
                <Section
                  title="Request"
                  hint={
                    mode === 'live'
                      ? 'The gateway calls the real model.'
                      : 'You write the model’s answer; the gateway governs it without calling a model. Recorded as a scripted response.'
                  }
                  right={
                    <div className="inline-flex p-0.5 rounded-xl glass-inset shrink-0">
                      {(
                        [
                          { id: 'live', label: 'Live model', Icon: Radio },
                          { id: 'scripted', label: 'Scripted', Icon: PenLine },
                        ] as const
                      ).map(({ id, label, Icon }) => (
                        <button
                          key={id}
                          type="button"
                          onClick={() => {
                            setMode(id);
                            setScenarioId(null);
                          }}
                          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all cursor-pointer ${
                            mode === id
                              ? 'bg-white text-[#101828] shadow-xs'
                              : 'text-[#667085] hover:text-[#101828]'
                          }`}
                        >
                          <Icon className="h-3 w-3" />
                          {label}
                        </button>
                      ))}
                    </div>
                  }
                >
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <GlassDropdown<UseCaseId>
                      id="playground-policy"
                      label="Policy"
                      value={form.policy}
                      onChange={(policy) =>
                        edit({ policy, workload: workloadOptions(policy)[1]?.value ?? '' })
                      }
                      options={POLICY_OPTIONS}
                      fullWidth
                      size="sm"
                    />
                    <GlassDropdown<string>
                      id="playground-workload"
                      label="Workload (cost baseline)"
                      value={form.workload}
                      onChange={(workload) => edit({ workload })}
                      options={workloadOptions(form.policy)}
                      fullWidth
                      size="sm"
                    />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto] gap-3 items-end">
                    {mode === 'live' ? (
                      <ModelPicker
                        id="playground-model"
                        label="Model"
                        value={model}
                        onChange={setModel}
                        choices={modelChoices}
                        defaultModel={PREFERRED_MODEL}
                      />
                    ) : (
                      <p className="text-[11px] text-[#667085] leading-relaxed">
                        No model is called; the Live Stream labels this request as scripted.
                      </p>
                    )}
                    <button
                      type="button"
                      role="switch"
                      aria-checked={form.stream}
                      onClick={() => edit({ stream: !form.stream })}
                      className="flex items-center gap-2 text-xs text-[#344054] cursor-pointer select-none h-8"
                    >
                      <span
                        className={`relative inline-flex h-5 w-9 rounded-full transition-colors ${
                          form.stream ? 'bg-[#4F46E5]' : 'bg-slate-300'
                        }`}
                      >
                        <span
                          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
                            form.stream ? 'translate-x-4' : 'translate-x-0.5'
                          }`}
                        />
                      </span>
                      Stream
                    </button>
                  </div>
                </Section>

                <Section
                  title="Messages"
                  hint="What the app sends, like any RAG app: its instructions and the retrieved documents in the system message, then the user's question. Answers are checked against the documents."
                >
                  <label className="block">
                    <FieldLabel label="Instructions" hint="system message · optional" />
                    <textarea
                      rows={3}
                      value={form.system}
                      onChange={(e) => edit({ system: e.target.value })}
                      placeholder="How the model should answer"
                      className={`${inputClass} font-mono resize-y`}
                    />
                  </label>
                  <label className="block">
                    <FieldLabel
                      label="Retrieved documents"
                      hint="to the model and as evidence (X-ControlPlane-Context)"
                    />
                    <textarea
                      rows={6}
                      value={form.context}
                      onChange={(e) => edit({ context: e.target.value })}
                      placeholder="[DOC-ID] Title: text, one document per paragraph"
                      className={`${inputClass} font-mono resize-y`}
                    />
                  </label>
                  <div>
                    <FieldLabel
                      label="User message"
                      right={
                        guard.pass ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[#067647] bg-[#ECFDF3] border border-[#ABEFC6] rounded-md px-1.5 py-0.5">
                            <ShieldCheck className="h-3 w-3" />
                            Input guard: pass · {guard.riskScore.toFixed(2)}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[#B42318] bg-[#FEF3F2] border border-[#FECDCA] rounded-md px-1.5 py-0.5">
                            <ShieldAlert className="h-3 w-3" />
                            Will be blocked · {guard.riskScore.toFixed(2)}
                          </span>
                        )
                      }
                    />
                    <textarea
                      rows={2}
                      value={form.user}
                      onChange={(e) => edit({ user: e.target.value })}
                      placeholder="The end user's message"
                      className={`${inputClass} resize-y ${
                        guard.pass ? '' : 'border-[#FECDCA] bg-[#FFFBFA]/60'
                      }`}
                    />
                    {!guard.pass && (
                      <div className="mt-2 rounded-xl border border-[#FECDCA] bg-[#FFFBFA] px-3 py-2 text-[11px] text-[#B42318] space-y-1.5">
                        <div>
                          <span className="font-semibold">Pre-flight intercept:</span>{' '}
                          {guard.reason}. The gateway answers HTTP 400 and the model is never
                          called.
                        </div>
                        {guard.details && guard.details.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {guard.details.map((d, i) => (
                              <span
                                key={i}
                                className="px-1.5 py-0.5 rounded-md bg-white border border-[#FECDCA] font-mono text-[10px]"
                              >
                                {d.name || d.category} ({d.severity.toFixed(2)})
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </Section>

                {mode === 'scripted' && (
                  <Section
                    title="Scripted model answer"
                    hint="Governed exactly like a real answer. Tokens and latency feed the cost lane."
                  >
                    <textarea
                      rows={4}
                      value={scripted.response}
                      onChange={(e) => {
                        setScripted((s) => ({ ...s, response: e.target.value }));
                        setScenarioId(null);
                      }}
                      placeholder="The answer the model would have given"
                      className={`${inputClass} font-mono resize-y`}
                    />
                    <div className="grid grid-cols-2 gap-3">
                      <label className="block">
                        <FieldLabel label="Total tokens" />
                        <input
                          type="number"
                          min={0}
                          value={scripted.totalTokens || ''}
                          placeholder="estimated"
                          onChange={(e) =>
                            setScripted((s) => ({
                              ...s,
                              totalTokens: Math.max(0, parseInt(e.target.value, 10) || 0),
                            }))
                          }
                          className={`${inputClass} font-mono tnum`}
                        />
                      </label>
                      <label className="block">
                        <FieldLabel label="Latency (ms)" />
                        <input
                          type="number"
                          min={0}
                          value={scripted.latencyMs || ''}
                          placeholder="measured"
                          onChange={(e) =>
                            setScripted((s) => ({
                              ...s,
                              latencyMs: Math.max(0, parseInt(e.target.value, 10) || 0),
                            }))
                          }
                          className={`${inputClass} font-mono tnum`}
                        />
                      </label>
                    </div>
                  </Section>
                )}
              </div>

              {/* Send bar */}
              <div className="sticky bottom-0 px-4 sm:px-5 py-3 border-t border-slate-200 bg-white/85 backdrop-blur-md flex items-center justify-between gap-3">
                <span className="text-[11px] text-[#667085] leading-snug">
                  {selectedScenario ? (
                    <>
                      Expected:{' '}
                      <span className="font-medium text-[#344054]">
                        {selectedScenario.expected}
                      </span>
                    </>
                  ) : (
                    'Recorded in the audit trail and the Live Stream.'
                  )}
                </span>
                <button
                  type="button"
                  onClick={send}
                  disabled={!canSend}
                  title="Send (Ctrl+Enter)"
                  className="glass-btn-primary text-white px-4 py-2 rounded-xl text-xs font-medium flex items-center gap-2 shrink-0 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {sending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Send className="h-3.5 w-3.5" />
                  )}
                  Send through gateway
                </button>
              </div>
            </div>

            {/* ── Response ── */}
            <div
              ref={responseRef}
              className="lg:overflow-y-auto p-4 sm:p-5 space-y-4 bg-slate-50/40 scroll-mt-2"
            >
              <Section
                title="What the app receives"
                right={
                  result && (
                    <div className="flex items-center gap-1.5 flex-wrap justify-end">
                      <span
                        className={`px-2 py-0.5 rounded-lg border text-[11px] font-semibold font-mono ${
                          failed
                            ? 'text-[#B42318] bg-[#FEF3F2] border-[#FECDCA]'
                            : 'text-[#067647] bg-[#ECFDF3] border-[#ABEFC6]'
                        }`}
                      >
                        HTTP {result.status}
                      </span>
                      {verdict && (
                        <span
                          title={
                            result.recordedVerdict ? 'Decided when the stream ended' : undefined
                          }
                        >
                          <VerdictBadge verdict={verdict} size="sm" />
                        </span>
                      )}
                      <span className="text-[11px] font-mono text-[#667085]">{result.ms} ms</span>
                    </div>
                  )
                }
              >
                {!result && !error && !sending && (
                  <div className="rounded-xl border border-dashed border-slate-300 bg-white/60 px-4 py-8 text-center space-y-1.5">
                    <p className="text-xs text-[#475467]">
                      Pick a scenario or write your own request, then send it.
                    </p>
                    {selectedScenario && (
                      <p className="text-[11px] text-[#667085]">{selectedScenario.narration}</p>
                    )}
                  </div>
                )}
                {sending && !result && (
                  <div className="rounded-xl border border-slate-200 bg-white/70 px-4 py-8 text-xs text-[#667085] flex items-center justify-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" /> Waiting for the gateway…
                  </div>
                )}
                {error && (
                  <div className="rounded-xl border border-[#FECDCA] bg-[#FEF3F2] px-3 py-2.5 text-xs text-[#B42318]">
                    Request failed: {error}
                  </div>
                )}
                {result && delivered && (
                  <>
                    <div className="flex flex-wrap gap-1.5">
                      {source && (
                        <span
                          className={`text-[10px] font-semibold px-2 py-0.5 rounded-md border ${
                            source === 'scripted'
                              ? 'text-[#4F46E5] bg-[#EEF0FE] border-[#D9D6FE]'
                              : 'text-[#067647] bg-[#ECFDF3] border-[#ABEFC6]'
                          }`}
                        >
                          {source === 'scripted' ? 'Scripted answer' : 'Model answer'}
                        </span>
                      )}
                      {result.streamed && (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md border border-slate-200 text-[#475467] bg-white">
                          Streamed
                        </span>
                      )}
                    </div>
                    <div
                      className={`rounded-xl border px-3.5 py-3 text-xs leading-relaxed whitespace-pre-wrap min-h-[72px] ${
                        failed
                          ? 'border-[#FECDCA] bg-[#FFFBFA] text-[#B42318] font-mono'
                          : 'border-slate-200 bg-white text-[#101828]'
                      }`}
                    >
                      {delivered.body ? (
                        renderRedactions(delivered.body)
                      ) : (
                        <span className="italic text-[#98A2B3]">(empty)</span>
                      )}
                      {delivered.note && (
                        <div className="mt-2.5 pt-2 border-t border-slate-200 text-[11px] text-[#B54708] font-sans">
                          {delivered.note}
                        </div>
                      )}
                    </div>
                    {interactionId && (
                      <button
                        type="button"
                        onClick={() => onViewInLiveStream(interactionId)}
                        className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium text-[#4F46E5] bg-[#EEF0FE] border border-[#D9D6FE] hover:bg-[#E0E4FD] transition-colors cursor-pointer"
                      >
                        View the full analysis and LLM judge on the Live Stream
                        <ArrowUpRight className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {Object.keys(result.headers).length > 0 && (
                      <div className="rounded-xl border border-slate-200 bg-white/70 divide-y divide-slate-100">
                        {Object.entries(result.headers).map(([k, v]) => (
                          <div
                            key={k}
                            className="flex items-center justify-between gap-3 px-3 py-1.5 text-[11px]"
                            title={k}
                          >
                            <span className="text-[#667085]">{FRIENDLY_HEADERS[k] ?? k}</span>
                            <span className="font-mono font-medium text-[#101828] truncate">
                              {v}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                    <details className="rounded-xl border border-slate-200 bg-white/70">
                      <summary className="px-3 py-2 text-[11px] font-medium text-[#475467] cursor-pointer select-none">
                        Raw response body
                      </summary>
                      <pre className="px-3 pb-3 text-[10px] font-mono text-[#344054] overflow-auto max-h-56 whitespace-pre-wrap break-all">
                        {result.raw}
                      </pre>
                    </details>
                  </>
                )}
              </Section>

              <details className="group rounded-2xl border border-slate-200/80 bg-[#0F172A] overflow-hidden">
                <summary className="flex items-center justify-between px-4 py-2.5 text-[11px] font-medium text-slate-200 cursor-pointer select-none">
                  <span>Same request from your app (OpenAI SDK / curl)</span>
                  <span className="text-slate-400 group-open:hidden">Show</span>
                  <span className="text-slate-400 hidden group-open:inline">Hide</span>
                </summary>
                <div className="flex items-center justify-between px-3 py-1.5 border-y border-slate-700">
                  <div className="flex gap-1">
                    {(['python', 'curl'] as const).map((tab) => (
                      <button
                        key={tab}
                        type="button"
                        onClick={() => setCodeTab(tab)}
                        className={`px-2 py-0.5 rounded-md text-[10px] font-mono cursor-pointer ${
                          codeTab === tab ? 'bg-slate-700 text-white' : 'text-slate-400'
                        }`}
                      >
                        {tab === 'python' ? 'Python' : 'curl'}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={copyCode}
                    className="text-slate-300 hover:text-white text-[10px] flex items-center gap-1 cursor-pointer"
                  >
                    {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <pre className="p-3 text-[10px] leading-relaxed text-slate-200 font-mono overflow-auto max-h-64">
                  {snippets[codeTab]}
                </pre>
              </details>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
