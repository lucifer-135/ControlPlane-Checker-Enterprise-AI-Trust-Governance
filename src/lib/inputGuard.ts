/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Input Guard — Pre-flight Request Validator
 *
 * Runs fast checks (<5ms) on incoming prompts before forwarding to upstream:
 * - Prompt injection scanning (known attack patterns)
 * - PII detection on input (prevent sending PII to the LLM)
 * - Rate limiting (sliding window counter)
 */

import { validateCreditCard } from './utils/luhn.js';

// ──────────────────────────────────────────────────────────────────────
// Prompt Injection Patterns
// ──────────────────────────────────────────────────────────────────────

export const INJECTION_PATTERNS: {
  pattern: RegExp;
  category: string;
  name: string;
  severity: number;
}[] = [
  {
    pattern:
      /ignore\s+(?:all\s+)?(?:previous|prior|above|earlier)\s+(?:instructions?|prompts?|rules?|guidelines?)/i,
    category: 'instruction_override',
    name: 'Instruction Override',
    severity: 0.9,
  },
  {
    pattern:
      /you\s+are\s+now\s+(?:a|an|the)?\s*(?:new|different|unrestricted|evil|jailbroken|DAN)/i,
    category: 'role_hijack',
    name: 'Role Hijack / DAN Jailbreak',
    severity: 0.95,
  },
  {
    pattern: /system\s*:\s*(?:override|ignore|forget|disregard|bypass)/i,
    category: 'system_prompt_injection',
    name: 'System Prompt Injection',
    severity: 0.95,
  },
  {
    pattern:
      /(?:forget|disregard|override)\s+(?:all\s+)?(?:your|the|any)\s+(?:instructions?|rules?|guidelines?|constraints?|safety)/i,
    category: 'instruction_override',
    name: 'Safety Constraint Disregard',
    severity: 0.9,
  },
  {
    pattern:
      /(?:pretend|act\s+as\s+if|imagine|from\s+now\s+on,\s+act\s+as)\s+(?:you\s+are|you're|an?\s+unfiltered|that\s+you)/i,
    category: 'role_hijack',
    name: 'Unfiltered Persona Simulation',
    severity: 0.85,
  },
  {
    pattern: /(?:DAN|do\s+anything\s+now|developer\s+mode|jailbreak|unrestricted\s+mode)/i,
    category: 'known_jailbreak',
    name: 'Known Jailbreak Signature',
    severity: 0.95,
  },
  {
    pattern:
      /(?:reveal|show|display|output|print)\s+(?:your|the)\s+(?:system|initial|original|hidden)\s+(?:prompt|instructions?|message)/i,
    category: 'prompt_extraction',
    name: 'System Prompt Extraction',
    severity: 0.85,
  },
  {
    pattern: /\[(?:INST|SYS|SYSTEM)\]\s*(?:override|ignore|new\s+instructions?)/i,
    category: 'format_injection',
    name: 'Delimiter Format Injection',
    severity: 0.9,
  },
  {
    pattern: /(?:base64|rot13|hex)\s*(?:decode|encoded?)\s*:/i,
    category: 'encoding_attack',
    name: 'Obfuscated Encoding Attack',
    severity: 0.7,
  },
  {
    pattern: /(?:repeat\s+after\s+me|say\s+exactly|output\s+the\s+following)\s*:/i,
    category: 'output_manipulation',
    name: 'Echo / Output Manipulation',
    severity: 0.6,
  },
];

// SSN Pattern (US SSN with invalid area code check)
export const SSN_INPUT_REGEX = /\b(?!000|666|9\d{2})\d{3}[- ](?!00)\d{2}[- ](?!0000)\d{4}\b/;

// Candidate numeric cards (13-19 digits with optional spaces or dashes)
export const CARD_CANDIDATE_REGEX = /\b(?:\d[ -]*?){13,19}\b/g;

// ──────────────────────────────────────────────────────────────────────
// Rate Limiting (In-Memory Sliding Window)
// ──────────────────────────────────────────────────────────────────────

const rateLimitWindows: Map<string, number[]> = new Map();
export const DEFAULT_RATE_LIMIT_RPM = 100;

export function checkRateLimit(apiKey: string, limitRpm: number = DEFAULT_RATE_LIMIT_RPM): boolean {
  const now = Date.now();
  const windowMs = 60_000; // 1 minute window

  if (!rateLimitWindows.has(apiKey)) {
    rateLimitWindows.set(apiKey, []);
  }

  const timestamps = rateLimitWindows.get(apiKey)!;
  const inWindow = timestamps.filter((t) => now - t < windowMs);
  rateLimitWindows.set(apiKey, inWindow);

  if (inWindow.length >= limitRpm) {
    return false; // Rate limit exceeded
  }

  inWindow.push(now);
  return true;
}

export function getRateLimitStatus(
  apiKey: string,
  limitRpm: number = DEFAULT_RATE_LIMIT_RPM,
): { current: number; limit: number; remaining: number; percentage: number } {
  const now = Date.now();
  const windowMs = 60_000;
  const timestamps = rateLimitWindows.get(apiKey) || [];
  const inWindow = timestamps.filter((t) => now - t < windowMs);
  const current = inWindow.length;
  const remaining = Math.max(0, limitRpm - current);
  const percentage = Math.min(100, Math.round((current / limitRpm) * 100));

  return { current, limit: limitRpm, remaining, percentage };
}

export function recordSimulatedRequest(apiKey: string, count: number = 1): void {
  const now = Date.now();
  if (!rateLimitWindows.has(apiKey)) {
    rateLimitWindows.set(apiKey, []);
  }
  const timestamps = rateLimitWindows.get(apiKey)!;
  for (let i = 0; i < count; i++) {
    timestamps.push(now);
  }
}

export function resetRateLimits(): void {
  rateLimitWindows.clear();
}

// ──────────────────────────────────────────────────────────────────────
// Main Input Guard
// ──────────────────────────────────────────────────────────────────────

export interface InputGuardResult {
  pass: boolean;
  reason?: string;
  riskScore: number;
  detections: string[];
  details?: Array<{ category: string; name?: string; severity: number; matched?: string }>;
}

/**
 * Scans an input prompt for prompt injection attempts, embedded PII,
 * and other pre-flight concerns.
 *
 * @param input      The user's input message.
 * @param apiKey     API key for rate limiting (optional).
 * @returns Guard result with pass/fail and detections.
 */
export function scanInput(input: string, apiKey?: string): InputGuardResult {
  const detections: string[] = [];
  const details: Array<{
    category: string;
    name?: string;
    severity: number;
    matched?: string;
  }> = [];
  let maxSeverity = 0;

  // ── 1. Prompt injection scan ──
  for (const { pattern, category, name, severity } of INJECTION_PATTERNS) {
    const match = pattern.exec(input);
    if (match) {
      detections.push(`injection:${category}`);
      details.push({
        category: `injection:${category}`,
        name,
        severity,
        matched: match[0].substring(0, 80),
      });
      maxSeverity = Math.max(maxSeverity, severity);
    }
  }

  // ── 2. Input PII scan ──
  // Check SSN
  if (SSN_INPUT_REGEX.test(input)) {
    const ssnMatch = input.match(SSN_INPUT_REGEX);
    detections.push('SSN');
    details.push({
      category: 'input_pii:SSN',
      name: 'Social Security Number (SSN)',
      severity: 0.85,
      matched: ssnMatch ? ssnMatch[0] : undefined,
    });
    maxSeverity = Math.max(maxSeverity, 0.85);
  }

  // Check Credit Card with Luhn validation
  const cardMatches = input.match(CARD_CANDIDATE_REGEX);
  if (cardMatches) {
    for (const match of cardMatches) {
      const clean = match.replace(/[\s-]/g, '');
      if (clean.length >= 13 && clean.length <= 19 && /^\d+$/.test(clean)) {
        if (validateCreditCard(clean).isValid) {
          detections.push('CREDIT_CARD');
          details.push({
            category: 'input_pii:CREDIT_CARD',
            name: 'Valid Credit Card Number (Luhn verified)',
            severity: 0.85,
            matched: `•••• •••• •••• ${clean.slice(-4)}`,
          });
          maxSeverity = Math.max(maxSeverity, 0.85);
          break;
        }
      }
    }
  }

  // ── 3. Rate limit check ──
  if (apiKey && !checkRateLimit(apiKey)) {
    return {
      pass: false,
      reason: 'Rate limit exceeded. Please try again shortly.',
      riskScore: 1.0,
      detections: ['rate_limit'],
      details: [{ category: 'rate_limit', name: 'Rate Limit Exceeded', severity: 1.0 }],
    };
  }

  // ── Decision ──
  const blocked = maxSeverity >= 0.7;

  let reason: string | undefined;
  if (blocked) {
    if (detections.some((d) => d.includes('injection'))) {
      const detail = details.find((d) => d.category.includes('injection'));
      reason = `Prompt injection attempt detected: ${detail?.name || detections[0]}`;
    } else if (detections.includes('SSN') || detections.includes('CREDIT_CARD')) {
      reason = `Prohibited PII detected in user input (${detections.join(', ')})`;
    } else {
      reason = 'Input blocked by security policy';
    }
  }

  return {
    pass: !blocked,
    reason,
    riskScore: maxSeverity,
    detections,
    details,
  };
}
