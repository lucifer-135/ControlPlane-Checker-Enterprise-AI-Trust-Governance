/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { chatModelChoices, upstreamProviderFor } from './modelCatalog';

// A slice of what GET /v1/models returns with only a Gemini key configured: the
// provider's own list ("models/…") followed by the gateway's configured fallbacks.
const GEMINI_LISTING = [
  'models/gemini-2.5-flash',
  'models/gemini-2.5-pro',
  'models/gemini-2.5-flash-preview-tts',
  'models/gemma-4-31b-it',
  'models/gemini-flash-latest',
  'models/gemini-flash-lite-latest',
  'models/gemini-pro-latest',
  'models/gemini-2.5-flash-image',
  'models/gemini-3.1-pro-preview',
  'models/gemini-3.5-flash',
  'models/gemini-3.6-flash',
  'models/gemini-3.8-flash',
  'models/lyria-3.5',
  'models/gemini-embedding-001',
  'models/aqa',
  'models/veo-3.1-generate-preview',
  'models/gemini-2.5-flash-native-audio-latest',
  'models/gemini-3.8-live',
  'gemini-flash-lite-latest',
  'gemini-3.6-flash',
  'gemini-flash-latest',
];

describe('upstreamProviderFor', () => {
  it('routes model names the way the gateway does', () => {
    expect(upstreamProviderFor('gemini-3.6-flash')).toBe('gemini');
    expect(upstreamProviderFor('models/gemma-4-31b-it')).toBe('gemini');
    expect(upstreamProviderFor('claude-sonnet-4')).toBe('anthropic');
    expect(upstreamProviderFor('qwen2.5:7b')).toBe('ollama');
    expect(upstreamProviderFor('gpt-4o')).toBe('openai');
    expect(upstreamProviderFor('some-unknown-model')).toBe('openai');
  });
});

describe('chatModelChoices', () => {
  const choices = chatModelChoices(GEMINI_LISTING);
  const ids = choices.map((c) => c.id);

  it('drops models that cannot serve chat completions', () => {
    for (const hidden of ['tts', 'image', 'lyria', 'embedding', 'aqa', 'veo', 'audio', 'live']) {
      expect(ids.some((id) => id.includes(hidden))).toBe(false);
    }
  });

  it('merges "models/" duplicates and keeps ids that must stay prefixed', () => {
    expect(ids.filter((id) => id === 'gemini-flash-lite-latest')).toHaveLength(1);
    expect(ids.some((id) => id.startsWith('models/gemini'))).toBe(false);
    // "gemma-4-31b-it" alone would route to OpenAI, so the prefix is kept
    const gemma = choices.find((c) => c.label === 'gemma-4-31b-it');
    expect(gemma?.id).toBe('models/gemma-4-31b-it');
    expect(gemma?.provider).toBe('gemini');
  });

  it('lists aliases first, then stable models newest first, then previews', () => {
    expect(ids).toEqual([
      'gemini-flash-latest',
      'gemini-flash-lite-latest',
      'gemini-pro-latest',
      'gemini-3.8-flash',
      'gemini-3.6-flash',
      'gemini-3.5-flash',
      'gemini-2.5-pro',
      'gemini-2.5-flash',
      'models/gemma-4-31b-it',
      'gemini-3.1-pro-preview',
    ]);
    expect(choices.map((c) => c.group)).toEqual([
      'alias',
      'alias',
      'alias',
      'stable',
      'stable',
      'stable',
      'stable',
      'stable',
      'stable',
      'preview',
    ]);
  });

  it('returns nothing for an empty listing', () => {
    expect(chatModelChoices([])).toEqual([]);
  });
});
