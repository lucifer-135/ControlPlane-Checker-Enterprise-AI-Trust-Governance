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
    .replace(/[.!?;\n[\]]+(?=\s|$)|[\n[\]]+/g, ` ${SENTENCE_BOUNDARY} `)
    .replace(/[^a-z0-9'\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1);
}

/** Token inserted at sentence and chunk boundaries so negation scopes cannot cross them. */
const SENTENCE_BOUNDARY = 'zzsentenceboundaryzz';

/**
 * Checks if a term appears within a negation scope in the given text.
 * A negation scope is defined as a negation marker within N tokens
 * before the target term, in the same sentence.
 */
function isNegated(tokens: string[], termIndex: number, windowSize: number = 4): boolean {
  const start = Math.max(0, termIndex - windowSize);
  for (let i = termIndex - 1; i >= start; i--) {
    if (tokens[i] === SENTENCE_BOUNDARY) return false;
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
  /** The pair does not apply when the context itself contains this (e.g. it already excludes cases). */
  contextException?: RegExp;
  /** The pair does not apply when the response itself contains this (e.g. it states the condition). */
  responseException?: RegExp;
  reason: string;
}[] = [
  {
    // "wrist fractures never qualify for compensation" against a policy that pays benefits
    contextPhrase:
      /\b(?:pays?|payable|eligible|covered|coverage|qualif(?:y|ies|ied)|entitled|reimburs\w*|compensat\w*)\b/i,
    responsePhrase:
      /\b(?:never|under\s+no\s+circumstances|in\s+no\s+case|not\s+under\s+any)\b[^.]{0,40}?\b(?:qualif\w*|eligible|covered|compensat\w*|paid|pay(?:s|able)?|reimburs\w*|approved|entitled)\b/i,
    contextException:
      /\b(?:never|excluded|exclusions?|ineligible|not\s+(?:covered|eligible|payable|reimbursable)|does\s+not\s+(?:pay|cover|qualify))\b/i,
    reason:
      'Context describes an entitlement but response makes an absolute denial the context does not support.',
  },
  {
    contextPhrase: /non[- ]?refundable/i,
    responsePhrase: /(?:full|100%|unconditional|guaranteed)\s+(?:cash\s+)?refund/i,
    // "a full refund if you cancel within 14 days" restates the policy's condition
    responseException: /\bwithin\s+(?:the\s+first\s+)?\d+\s+(?:business\s+)?days?\b/i,
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

const MONEY_STOPWORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'that',
  'this',
  'from',
  'per',
  'are',
  'was',
  'will',
  'would',
  'can',
  'you',
  'your',
  'our',
  'its',
  'has',
  'have',
  'been',
  'into',
  'each',
  'any',
  'all',
]);

/**
 * Currency amounts with the words that describe them (the four words before the amount),
 * e.g. "$25.00" → ["flat", "late", "fee"].
 */
function findMoneyAmounts(text: string): { text: string; value: number; keywords: string[] }[] {
  const amounts: { text: string; value: number; keywords: string[] }[] = [];
  for (const m of text.matchAll(/[$£€]\s?\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?(?![\d,])/g)) {
    const value = parseFloat(m[0].replace(/[$£€,\s]/g, ''));
    if (isNaN(value)) continue;
    const before = text.slice(Math.max(0, m.index! - 60), m.index!).toLowerCase();
    const keywords = (before.match(/[a-z][a-z-]+/g) || [])
      .slice(-4)
      .filter((w) => w.length > 2 && !MONEY_STOPWORDS.has(w));
    amounts.push({ text: m[0], value, keywords });
  }
  return amounts;
}

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
    if (
      pc.contextPhrase.test(contextLower) &&
      pc.responsePhrase.test(responseLower) &&
      !pc.contextException?.test(contextLower) &&
      !pc.responseException?.test(responseLower)
    ) {
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
    (t) => t.length > 3 && t !== SENTENCE_BOUNDARY && !NEGATION_MARKERS.includes(t),
  );
  const contextKeyTermSet = new Set(contextKeyTerms);

  // Polarity of every occurrence of each context term. Long contexts mention the
  // same term many times, so a term only counts as consistently negated (or
  // affirmed) if every occurrence agrees; mixed usage cannot be contradicted.
  const contextPolarity = new Map<string, { negated: boolean; affirmed: boolean }>();
  for (let i = 0; i < contextTokens.length; i++) {
    const token = contextTokens[i];
    if (!contextKeyTermSet.has(token)) continue;
    const polarity = contextPolarity.get(token) || { negated: false, affirmed: false };
    if (isNegated(contextTokens, i)) polarity.negated = true;
    else polarity.affirmed = true;
    contextPolarity.set(token, polarity);
  }

  for (let i = 0; i < responseTokens.length; i++) {
    const token = responseTokens[i];
    if (contextKeyTermSet.has(token) && token.length > 4) {
      const negatedInResponse = isNegated(responseTokens, i);
      const polarity = contextPolarity.get(token)!;
      const negatedInContext = polarity.negated && !polarity.affirmed;
      const affirmedInContext = polarity.affirmed && !polarity.negated;
      const mismatch = negatedInResponse ? affirmedInContext : negatedInContext;

      // Contradiction: negated in one but not the other
      if (mismatch && token.length > 5) {
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

  const contextNumbers: Array<{ value: number; raw: string; context: string }> = [];
  const responseNumbers: Array<{ value: number; raw: string; context: string }> = [];

  // Identifiers (account and routing numbers, parts of SSNs or phone numbers) are
  // not quantities, so they are never compared by magnitude
  const isIdentifier = (text: string, start: number, raw: string) =>
    /^\d{7,}$/.test(raw) ||
    /\d-$/.test(text.slice(Math.max(0, start - 2), start)) ||
    /^-\d/.test(text.slice(start + raw.length, start + raw.length + 2));

  let match: RegExpExecArray | null;
  while ((match = contextNumberPattern.exec(contextText)) !== null) {
    const raw = match[2];
    if (isIdentifier(contextText, match.index + (match[1] || '').length, raw)) continue;
    const num = parseFloat(raw.replace(/[$,]/g, '').replace(/%$/, ''));
    if (!isNaN(num) && num > 0) {
      const surrounding = (match[1] || '').trim() + ' ' + (match[3] || '').trim();
      contextNumbers.push({ value: num, raw, context: surrounding.trim().toLowerCase() });
    }
  }

  while ((match = responseNumberPattern.exec(responseText)) !== null) {
    const raw = match[2];
    if (isIdentifier(responseText, match.index + (match[1] || '').length, raw)) continue;
    const num = parseFloat(raw.replace(/[$,]/g, '').replace(/%$/, ''));
    if (!isNaN(num) && num > 0) {
      const surrounding = (match[1] || '').trim() + ' ' + (match[3] || '').trim();
      responseNumbers.push({ value: num, raw, context: surrounding.trim().toLowerCase() });
    }
  }

  // Look for numbers in similar contexts with very different values.
  // A response number is supported when the context states the same value in a
  // similar context (long contexts hold many "Section N" / "N days" figures, and
  // only the one the response actually cites matters). Otherwise at most one
  // contradiction is reported per response number: the closest-context conflict.
  const sharedWordCount = (a: string, b: string) => {
    const bWords = new Set(b.split(/\s+/).filter((w) => w.length > 2));
    return a.split(/\s+/).filter((w) => w.length > 2 && bWords.has(w)).length;
  };
  const sameValue = (a: number, b: number) => Math.abs(a - b) <= Math.max(1e-9, Math.abs(b) * 1e-6);

  for (const rn of responseNumbers) {
    const similar = contextNumbers
      .map((cn) => ({ cn, shared: sharedWordCount(rn.context, cn.context) }))
      .filter((c) => c.shared > 0);
    if (similar.some((c) => sameValue(c.cn.value, rn.value))) continue;

    let best: {
      cn: { value: number; raw: string; context: string };
      shared: number;
      ratio: number;
    } | null = null;
    for (const { cn, shared } of similar) {
      // Same semantic context — check if numbers differ significantly
      const ratio = Math.max(rn.value, cn.value) / Math.min(rn.value, cn.value);
      if (ratio > 3 && Math.abs(rn.value - cn.value) > 5 && (!best || shared > best.shared)) {
        best = { cn, shared, ratio };
      }
    }
    if (best) {
      contradictions.push({
        contextTerm: best.cn.raw,
        responseTerm: rn.raw,
        reason: `Numeric contradiction in similar context: context states ${best.cn.raw} ("${best.cn.context}") but response claims ${rn.raw} ("${rn.context}"), a ${best.ratio.toFixed(1)}x difference.`,
      });
    }
  }

  // --- 4. Monetary amount contradictions ---
  // A fee or price quoted for the same thing as the context but with a different
  // value is wrong however small the gap ("late fee of $24.00" vs "$25.00").
  const contextAmounts = findMoneyAmounts(contextText);
  for (const ra of findMoneyAmounts(responseText)) {
    if (contextAmounts.some((ca) => ca.value === ra.value)) continue;
    const conflict = contextAmounts.find((ca) => ca.keywords.some((k) => ra.keywords.includes(k)));
    if (conflict) {
      contradictions.push({
        contextTerm: conflict.text,
        responseTerm: ra.text,
        reason: `Monetary contradiction: context states ${conflict.text} for "${conflict.keywords.join(' ')}" but response states ${ra.text}.`,
      });
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
