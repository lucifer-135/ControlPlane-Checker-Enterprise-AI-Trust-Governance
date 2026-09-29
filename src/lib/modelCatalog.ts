/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Model routing and the chat-model catalog. Shared by the gateway (which provider a
 * model name is sent to) and the Gateway Playground (which models to offer).
 */

export type UpstreamProviderId = 'gemini' | 'openai' | 'anthropic' | 'ollama';

/** The upstream provider the gateway routes a model name to. */
export function upstreamProviderFor(model: string): UpstreamProviderId {
  const m = model.toLowerCase();
  if (m.includes('qwen') || m.includes('ollama')) return 'ollama';
  if (m.includes('gemini') || m.includes('models/')) return 'gemini';
  if (m.includes('claude') || m.includes('anthropic')) return 'anthropic';
  // gpt-* models and anything unknown
  return 'openai';
}

export const PROVIDER_LABELS: Record<UpstreamProviderId, string> = {
  gemini: 'Gemini',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  ollama: 'Ollama',
};

/** Speech, image, video, music, embedding and realtime-audio models: no chat completions. */
const NON_CHAT_MODEL =
  /tts|image|imagen|embed|veo|lyria|aqa|audio|live|robotics|computer-use|deep-research|antigravity|transcribe|translate|nano-banana|whisper|dall-e|moderation|realtime|babbage|davinci/i;

export type ModelGroup = 'alias' | 'stable' | 'preview';

export const MODEL_GROUP_LABELS: Record<ModelGroup, string> = {
  alias: 'Latest aliases',
  stable: 'Stable',
  preview: 'Preview',
};

export interface ModelChoice {
  /** Sent as `model`. */
  id: string;
  /** Shown to the user, without the provider's "models/" prefix. */
  label: string;
  provider: UpstreamProviderId;
  group: ModelGroup;
}

const GROUP_ORDER: ModelGroup[] = ['alias', 'stable', 'preview'];
const PROVIDER_ORDER: UpstreamProviderId[] = ['gemini', 'openai', 'anthropic', 'ollama'];

function groupOf(label: string): ModelGroup {
  if (/-latest$/i.test(label)) return 'alias';
  if (/preview|-exp/i.test(label)) return 'preview';
  return 'stable';
}

/** "gemini-3.6-flash" → "gemini-"; a name without a version is its own family. */
const familyOf = (label: string) => label.replace(/\d.*$/, '');

/**
 * Turns the ids from GET /v1/models into chat-model choices: drops models that can't
 * serve chat completions, merges "models/x" duplicates of "x", and sorts the rest by
 * group (latest aliases, stable, preview), then newest version first within a family.
 */
export function chatModelChoices(ids: string[]): ModelChoice[] {
  const byId = new Map<string, ModelChoice>();
  for (const raw of ids) {
    const label = raw.replace(/^models\//, '');
    if (NON_CHAT_MODEL.test(label)) continue;
    const provider = upstreamProviderFor(raw);
    // Keep the prefix when the bare name would route elsewhere ("gemma-…")
    const id = upstreamProviderFor(label) === provider ? label : raw;
    if (!byId.has(id)) byId.set(id, { id, label, provider, group: groupOf(label) });
  }
  return [...byId.values()].sort(
    (a, b) =>
      GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group) ||
      PROVIDER_ORDER.indexOf(a.provider) - PROVIDER_ORDER.indexOf(b.provider) ||
      familyOf(a.label).localeCompare(familyOf(b.label)) ||
      b.label.localeCompare(a.label, undefined, { numeric: true }),
  );
}
