/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Weighted N-gram Overlap Scorer
 *
 * Replaces naive Jaccard overlap with a multi-scale n-gram scorer that
 * gives higher weight to longer matching phrases and rarer tokens.
 * This handles paraphrasing and synonyms better than raw Jaccard because
 * multi-word phrase matches carry disproportionate semantic weight.
 */

/**
 * Common English stopwords to down-weight in overlap scoring.
 * These contribute little semantic signal.
 */
const STOPWORDS = new Set([
  'the',
  'a',
  'an',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'have',
  'has',
  'had',
  'do',
  'does',
  'did',
  'will',
  'would',
  'shall',
  'should',
  'may',
  'might',
  'must',
  'can',
  'could',
  'to',
  'of',
  'in',
  'for',
  'on',
  'with',
  'at',
  'by',
  'from',
  'as',
  'into',
  'through',
  'during',
  'before',
  'after',
  'above',
  'below',
  'between',
  'out',
  'off',
  'over',
  'under',
  'again',
  'further',
  'then',
  'once',
  'here',
  'there',
  'when',
  'where',
  'why',
  'how',
  'all',
  'each',
  'every',
  'both',
  'few',
  'more',
  'most',
  'other',
  'some',
  'such',
  'no',
  'nor',
  'not',
  'only',
  'own',
  'same',
  'so',
  'than',
  'too',
  'very',
  'just',
  'and',
  'but',
  'or',
  'if',
  'while',
  'that',
  'this',
  'these',
  'those',
  'it',
  'its',
  'he',
  'she',
  'they',
  'them',
  'his',
  'her',
  'their',
  'we',
  'you',
  'your',
  'our',
  'my',
  'me',
  'him',
  'us',
  'who',
  'whom',
  'which',
  'what',
  'about',
]);

/**
 * Tokenizes text into lowercased words, stripping punctuation.
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1);
}

/**
 * Generates n-grams of a given size from a token array.
 */
function generateNgrams(tokens: string[], n: number): string[] {
  const ngrams: string[] = [];
  for (let i = 0; i <= tokens.length - n; i++) {
    ngrams.push(tokens.slice(i, i + n).join(' '));
  }
  return ngrams;
}

/**
 * Computes the frequency of each item in an array.
 */
function computeFrequency(items: string[]): Map<string, number> {
  const freq = new Map<string, number>();
  for (const item of items) {
    freq.set(item, (freq.get(item) || 0) + 1);
  }
  return freq;
}

export interface NgramOverlapResult {
  /** Combined weighted overlap score in [0, 1]. Higher = more grounded. */
  overlapScore: number;
  /** Unigram overlap ratio. */
  unigramOverlap: number;
  /** Bigram overlap ratio. */
  bigramOverlap: number;
  /** Trigram overlap ratio. */
  trigramOverlap: number;
  /** Tokens in response that are rare (not stopwords) and not found in context. */
  ungroundedTokens: string[];
}

/**
 * Computes a weighted n-gram overlap score between a response and a context.
 *
 * Weights:
 *   - Unigrams (non-stopword): 0.30
 *   - Bigrams: 0.40
 *   - Trigrams: 0.30
 *
 * The idea: if a 3-word phrase from the response appears verbatim in the context,
 * that's strong evidence the response is grounded. Single-word matches of common
 * words are weaker evidence.
 *
 * @param responseText  The AI model's response.
 * @param contextText   The retrieved context + user prompt combined.
 * @returns Detailed overlap result with per-gram scores.
 */
export function computeNgramOverlap(responseText: string, contextText: string): NgramOverlapResult {
  const responseTokens = tokenize(responseText);
  const contextTokens = tokenize(contextText);

  if (responseTokens.length === 0 || contextTokens.length === 0) {
    return {
      overlapScore: 0,
      unigramOverlap: 0,
      bigramOverlap: 0,
      trigramOverlap: 0,
      ungroundedTokens: responseTokens,
    };
  }

  const contextTokenSet = new Set(contextTokens);

  // --- Unigram overlap (excluding stopwords) ---
  const contentResponseTokens = responseTokens.filter((t) => !STOPWORDS.has(t));
  const contentContextTokens = new Set(contextTokens.filter((t) => !STOPWORDS.has(t)));

  let unigramMatches = 0;
  const ungroundedTokens: string[] = [];
  for (const token of contentResponseTokens) {
    if (contentContextTokens.has(token)) {
      unigramMatches++;
    } else {
      ungroundedTokens.push(token);
    }
  }
  const unigramOverlap =
    contentResponseTokens.length > 0 ? unigramMatches / contentResponseTokens.length : 0;

  // --- Bigram overlap ---
  const responseBigrams = generateNgrams(responseTokens, 2);
  const contextBigramSet = new Set(generateNgrams(contextTokens, 2));
  const bigramMatches = responseBigrams.filter((bg) => contextBigramSet.has(bg)).length;
  const bigramOverlap = responseBigrams.length > 0 ? bigramMatches / responseBigrams.length : 0;

  // --- Trigram overlap ---
  const responseTrigrams = generateNgrams(responseTokens, 3);
  const contextTrigramSet = new Set(generateNgrams(contextTokens, 3));
  const trigramMatches = responseTrigrams.filter((tg) => contextTrigramSet.has(tg)).length;
  const trigramOverlap = responseTrigrams.length > 0 ? trigramMatches / responseTrigrams.length : 0;

  // --- Weighted combination ---
  const overlapScore = Math.min(
    1.0,
    unigramOverlap * 0.3 + bigramOverlap * 0.4 + trigramOverlap * 0.3,
  );

  // De-duplicate ungrounded tokens
  const uniqueUngrounded = [...new Set(ungroundedTokens)];

  return {
    overlapScore: Number(overlapScore.toFixed(4)),
    unigramOverlap: Number(unigramOverlap.toFixed(4)),
    bigramOverlap: Number(bigramOverlap.toFixed(4)),
    trigramOverlap: Number(trigramOverlap.toFixed(4)),
    ungroundedTokens: uniqueUngrounded,
  };
}
