/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Contradiction Detector
 *
 * Detects when an AI response directly contradicts the retrieved context
 * using antonym pair matching and negation scope analysis — without relying
 * on hardcoded dataset-specific strings.
 */

/**
 * Semantic antonym pairs: if context contains one side and response
 * contains the other, that's a potential contradiction.
 */
const ANTONYM_PAIRS: [string, string][] = [
  ['refundable', 'non-refundable'],
  ['refundable', 'nonrefundable'],
  ['refund', 'non-refundable'],
  ['encrypted', 'unencrypted'],
  ['encrypted', 'plaintext'],
  ['tls', 'unencrypted'],
  ['https', 'http'],
  ['secure', 'insecure'],
  ['approved', 'denied'],
  ['approved', 'rejected'],
  ['eligible', 'ineligible'],
  ['eligible', 'disqualified'],
  ['qualify', 'disqualify'],
  ['qualifies', 'disqualifies'],
  ['covered', 'excluded'],
  ['included', 'excluded'],
  ['permitted', 'prohibited'],
  ['allowed', 'forbidden'],
  ['allowed', 'banned'],
  ['compliant', 'non-compliant'],
  ['stable', 'beta'],
  ['stable', 'experimental'],
  ['production', 'beta'],
  ['production', 'canary'],
  ['production', 'experimental'],
  ['free', 'paid'],
  ['unlimited', 'limited'],
  ['guaranteed', 'conditional'],
  ['immediate', 'delayed'],
  ['automated', 'manual'],
  ['real-time', 'batch'],
  ['minutes', 'hours'],
  ['hours', 'days'],
  ['confirmed', 'unverified'],
  ['verified', 'unverified'],
  ['required', 'optional'],
  ['mandatory', 'optional'],
];

/**
 * Negation prefixes and words that flip the meaning of surrounding tokens.
 */
const NEGATION_MARKERS = [
  'not',
  'no',
  'never',
  'neither',
  'nor',
  'none',
  'nothing',
  'nowhere',
  'without',
  'non',
  'cannot',
  "can't",
  "won't",
  "doesn't",
  "don't",
  "isn't",
  "aren't",
  "wasn't",
  "weren't",
  "wouldn't",
  "shouldn't",
  "couldn't",
  "hasn't",
  "haven't",
];

export interface ContradictionResult {
  /** Whether a contradiction was detected. */
  hasContradiction: boolean;
  /** Detected contradiction pairs with explanations. */
  contradictions: ContradictionMatch[];
  /** Overall contradiction severity in [0, 1]. */
  severity: number;
}

export interface ContradictionMatch {
  /** The term/phrase from the context. */
  contextTerm: string;
  /** The contradicting term/phrase from the response. */
  responseTerm: string;
  /** Human-readable explanation. */
  reason: string;
}

/**
 * Tokenizes and lowercases text for analysis.
 */
function tokenizeLower(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9'\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1);
}

/**
 * Checks if a term appears within a negation scope in the given text.
 * A negation scope is defined as a negation marker within N tokens
 * before the target term.
 */
function isNegated(tokens: string[], termIndex: number, windowSize: number = 4): boolean {
  const start = Math.max(0, termIndex - windowSize);
  for (let i = start; i < termIndex; i++) {
    if (NEGATION_MARKERS.includes(tokens[i])) {
      return true;
    }
  }
  return false;
}

/**
 * Detects contradictions between a response and its retrieved context.
 *
 * Strategy:
 * 1. Antonym pair matching: if context contains term A and response contains
 *    term B (an antonym), flag as contradiction.
 * 2. Negation scope analysis: if context says "X is required" and response
 *    says "X is not required", detect the negation flip.
 * 3. Numeric contradictions: if context specifies a number and the response
 *    states a significantly different number in the same semantic context.
 *
 * @param responseText   The AI model's response.
 * @param contextText    The retrieved context.
 * @returns Contradiction analysis result.
 */
/**
 * Checks if a term exists as a standalone word/phrase in text (not as a substring
 * of its antonym). For example, "refund" in "non-refundable" should NOT count
 * as a standalone match for "refund".
 */
function containsStandalone(text: string, term: string, antonym?: string): boolean {
  // If the term only appears inside the antonym, it's not a standalone match
  if (antonym && text.includes(antonym)) {
    // Remove the antonym occurrences and check if the term still exists
    const withoutAntonym = text.replace(new RegExp(escapeRegex(antonym), 'g'), '___REMOVED___');
    return withoutAntonym.includes(term);
  }
  return text.includes(term);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Phrase-level contradiction pairs: these match on the full lowercased text
 * and catch higher-level semantic oppositions.
 */
const PHRASE_CONTRADICTIONS: {
  contextPhrase: RegExp;
  responsePhrase: RegExp;
  reason: string;
}[] = [
  {
    contextPhrase: /non[- ]?refundable/i,
    responsePhrase: /(?:full|100%|unconditional|guaranteed)\s+(?:cash\s+)?refund/i,
    reason: 'Context states non-refundable but response promises a full/unconditional refund.',
  },
  {
    contextPhrase: /(?:monday|weekday|business\s+(?:day|hour)|9\s*(?:am|a\.m)|5\s*(?:pm|p\.m))/i,
    responsePhrase: /(?:24\/7|24\s*hours|around the clock|always available|unlimited access)/i,
    reason: 'Context specifies limited availability but response claims 24/7 or unlimited access.',
  },
  {
    contextPhrase: /(?:premium|upgrade|additional\s+(?:cost|fee|charge))/i,
    responsePhrase:
      /(?:no\s+additional\s+cost|at\s+no\s+(?:extra\s+)?cost|free\s+of\s+charge|completely\s+free)/i,
    reason: 'Context requires premium/upgrade but response claims no additional cost.',
  },
  {
    contextPhrase: /(?:vp\s+approval|manager\s+approval|written\s+(?:notice|consent|approval))/i,
    responsePhrase:
      /(?:no\s+(?:approval|review)|without\s+(?:any\s+)?(?:review|approval)|automatically|instant)/i,
    reason: 'Context requires approval/review but response bypasses approval process.',
  },
];

export function detectContradictions(
  responseText: string,
  contextText: string,
): ContradictionResult {
  const contextLower = contextText.toLowerCase();
  const responseLower = responseText.toLowerCase();
  const contextTokens = tokenizeLower(contextText);
  const responseTokens = tokenizeLower(responseText);
  const contradictions: ContradictionMatch[] = [];

  // --- 1a. Phrase-level contradiction matching (highest priority) ---
  for (const pc of PHRASE_CONTRADICTIONS) {
    if (pc.contextPhrase.test(contextLower) && pc.responsePhrase.test(responseLower)) {
      const contextMatch = contextLower.match(pc.contextPhrase);
      const responseMatch = responseLower.match(pc.responsePhrase);
      contradictions.push({
        contextTerm: contextMatch?.[0] || 'context phrase',
        responseTerm: responseMatch?.[0] || 'response phrase',
        reason: pc.reason,
      });
    }
  }

  // --- 1b. Antonym pair matching (word-boundary aware) ---
  for (const [termA, termB] of ANTONYM_PAIRS) {
    // Check: context has A (standalone), response has B (standalone)
    if (
      containsStandalone(contextLower, termA, termB) &&
      containsStandalone(responseLower, termB, termA)
    ) {
      if (!containsStandalone(contextLower, termB)) {
        contradictions.push({
          contextTerm: termA,
          responseTerm: termB,
          reason: `Context states "${termA}" but response claims "${termB}" — direct semantic contradiction.`,
        });
      }
    }
    // Check reverse: context has B (standalone), response has A (standalone)
    if (
      containsStandalone(contextLower, termB, termA) &&
      containsStandalone(responseLower, termA, termB)
    ) {
      if (!containsStandalone(contextLower, termA, termB)) {
        contradictions.push({
          contextTerm: termB,
          responseTerm: termA,
          reason: `Context states "${termB}" but response claims "${termA}" — direct semantic contradiction.`,
        });
      }
    }
  }

  // --- 2. Negation scope analysis ---
  // Find key claims in context and check if response negates them
  const contextKeyTerms = contextTokens.filter(
    (t) => t.length > 3 && !NEGATION_MARKERS.includes(t),
  );
  const contextKeyTermSet = new Set(contextKeyTerms);

  for (let i = 0; i < responseTokens.length; i++) {
    const token = responseTokens[i];
    if (contextKeyTermSet.has(token) && token.length > 4) {
      const negatedInResponse = isNegated(responseTokens, i);
      // Find if this term is negated in context
      const contextIndex = contextTokens.indexOf(token);
      const negatedInContext = contextIndex >= 0 && isNegated(contextTokens, contextIndex);

      // Contradiction: negated in one but not the other
      if (negatedInResponse !== negatedInContext && token.length > 5) {
        const alreadyFound = contradictions.some(
          (c) => c.contextTerm === token || c.responseTerm === token,
        );
        if (!alreadyFound) {
          contradictions.push({
            contextTerm: negatedInContext ? `not ${token}` : token,
            responseTerm: negatedInResponse ? `not ${token}` : token,
            reason: `Negation mismatch: context ${negatedInContext ? 'negates' : 'affirms'} "${token}" but response ${negatedInResponse ? 'negates' : 'affirms'} it.`,
          });
        }
      }
    }
  }

  // --- 3. Numeric context contradictions ---
  // Extract numbers with surrounding context from both texts
  const contextNumberPattern = /(\w+[\s]*)?(\$?\b\d+(?:,\d+)*(?:\.\d+)?%?\b)([\s]*\w+)?/g;
  const responseNumberPattern = /(\w+[\s]*)?(\$?\b\d+(?:,\d+)*(?:\.\d+)?%?\b)([\s]*\w+)?/g;

  const contextNumbers: Array<{ value: number; context: string }> = [];
  const responseNumbers: Array<{ value: number; context: string }> = [];

  let match: RegExpExecArray | null;
  while ((match = contextNumberPattern.exec(contextText)) !== null) {
    const numStr = match[2].replace(/[$,]/g, '').replace(/%$/, '');
    const num = parseFloat(numStr);
    if (!isNaN(num) && num > 0) {
      const surrounding = (match[1] || '').trim() + ' ' + (match[3] || '').trim();
      contextNumbers.push({
        value: num,
        context: surrounding.trim().toLowerCase(),
      });
    }
  }

  while ((match = responseNumberPattern.exec(responseText)) !== null) {
    const numStr = match[2].replace(/[$,]/g, '').replace(/%$/, '');
    const num = parseFloat(numStr);
    if (!isNaN(num) && num > 0) {
      const surrounding = (match[1] || '').trim() + ' ' + (match[3] || '').trim();
      responseNumbers.push({
        value: num,
        context: surrounding.trim().toLowerCase(),
      });
    }
  }

  // Look for numbers in similar contexts with very different values
  for (const rn of responseNumbers) {
    for (const cn of contextNumbers) {
      // Check if they share context words
      const rnWords = rn.context.split(/\s+/).filter((w) => w.length > 2);
      const cnWords = new Set(cn.context.split(/\s+/).filter((w) => w.length > 2));
      const sharedWords = rnWords.filter((w) => cnWords.has(w));

      if (sharedWords.length > 0) {
        // Same semantic context — check if numbers differ significantly
        const ratio = Math.max(rn.value, cn.value) / Math.min(rn.value, cn.value);
        if (ratio > 3 && Math.abs(rn.value - cn.value) > 5) {
          contradictions.push({
            contextTerm: `${cn.value} (context: "${cn.context}")`,
            responseTerm: `${rn.value} (response: "${rn.context}")`,
            reason: `Numeric contradiction in similar context: context states ${cn.value} but response claims ${rn.value} (${ratio.toFixed(1)}x difference).`,
          });
        }
      }
    }
  }

  // De-duplicate contradictions by key
  const seen = new Set<string>();
  const unique = contradictions.filter((c) => {
    const key = `${c.contextTerm}:${c.responseTerm}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Compute severity based on number and type of contradictions
  const severity = Math.min(1.0, unique.length * 0.3);

  return {
    hasContradiction: unique.length > 0,
    contradictions: unique,
    severity: Number(severity.toFixed(2)),
  };
}
