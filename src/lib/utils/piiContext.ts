/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Contextual PII Confidence Boosting
 *
 * For each candidate PII entity, scans a ±5 token window around the match
 * for indicator words that raise or lower confidence. A 16-digit number
 * near "cardholder" or "billing" is almost certainly a credit card; the
 * same number in a hardware serial-number context is likely benign.
 */

/** Indicator words that boost PII confidence when found near a candidate entity. */
const PII_INDICATOR_WORDS: Record<string, string[]> = {
  CREDIT_CARD: [
    'card',
    'cardholder',
    'credit',
    'debit',
    'visa',
    'mastercard',
    'amex',
    'billing',
    'payment',
    'charged',
    'transaction',
    'cvv',
    'expir',
  ],
  SSN: [
    'social',
    'security',
    'ssn',
    'taxpayer',
    'tin',
    'identification',
    'identity',
    'government',
    'federal',
  ],
  PHONE: ['phone', 'call', 'mobile', 'cell', 'contact', 'dial', 'reach', 'text', 'sms'],
  EMAIL: ['email', 'mail', 'contact', 'reach', 'send', 'inbox', 'address'],
  ACCOUNT_NO: [
    'account',
    'routing',
    'checking',
    'savings',
    'bank',
    'wire',
    'transfer',
    'aba',
    'iban',
    'swift',
  ],
  NAME: [
    'salary',
    'compensation',
    'address',
    'home',
    'ssn',
    'dob',
    'birth',
    'employee',
    'patient',
    'customer',
    'client',
    'cardholder',
  ],
  ADDRESS: [
    'home',
    'residential',
    'address',
    'lives',
    'located',
    'residence',
    'deliver',
    'shipping',
    'mailing',
  ],
};

/** Words that suppress PII confidence (technical / non-personal contexts). */
const SUPPRESSION_WORDS = [
  'serial',
  'version',
  'build',
  'release',
  'model',
  'sku',
  'part',
  'firmware',
  'specification',
  'config',
  'hash',
  'checksum',
  'hex',
  'timestamp',
  'epoch',
  'coordinate',
  'latitude',
  'longitude',
];

/**
 * Tokenizes text around a match position and checks for contextual indicators.
 *
 * @param fullText     The complete text being scanned.
 * @param matchStart   Character offset where the PII candidate starts.
 * @param matchEnd     Character offset where the PII candidate ends.
 * @param entityType   The candidate entity type (CREDIT_CARD, SSN, etc.).
 * @param windowSize   Number of tokens on each side to inspect (default: 5).
 * @returns A confidence adjustment in [-0.4, +0.4]:
 *   - Positive = contextual indicators found → boost confidence
 *   - Negative = suppression words found → reduce confidence
 *   - Zero = neutral context
 */
export function computeContextualBoost(
  fullText: string,
  matchStart: number,
  matchEnd: number,
  entityType: string,
  windowSize: number = 5,
): number {
  // Extract surrounding text (±200 chars is generous for a 5-token window)
  const windowStart = Math.max(0, matchStart - 200);
  const windowEnd = Math.min(fullText.length, matchEnd + 200);
  const surroundingText = fullText.substring(windowStart, windowEnd).toLowerCase();

  // Tokenize the window
  const tokens = surroundingText
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1);

  // Find the approximate token position of the match
  const beforeMatch = fullText
    .substring(windowStart, matchStart)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1);

  const matchTokenIndex = beforeMatch.length;
  const windowTokens = tokens.slice(
    Math.max(0, matchTokenIndex - windowSize),
    matchTokenIndex + windowSize,
  );

  const windowText = windowTokens.join(' ');

  // Check indicator words
  const indicators = PII_INDICATOR_WORDS[entityType] || [];
  let boostScore = 0;
  let indicatorHits = 0;

  for (const indicator of indicators) {
    if (windowText.includes(indicator)) {
      indicatorHits++;
    }
  }

  // Check suppression words
  let suppressionHits = 0;
  for (const suppressor of SUPPRESSION_WORDS) {
    if (windowText.includes(suppressor)) {
      suppressionHits++;
    }
  }

  // Compute net adjustment
  if (indicatorHits > 0) {
    boostScore = Math.min(0.4, indicatorHits * 0.15);
  }
  if (suppressionHits > 0) {
    boostScore -= Math.min(0.4, suppressionHits * 0.2);
  }

  return Number(boostScore.toFixed(2));
}

/**
 * Checks whether a proper name appears in a sensitive personal data context.
 * Returns true if the surrounding text contains PII indicator words for names.
 */
export function isNameInSensitiveContext(
  fullText: string,
  nameStart: number,
  nameEnd: number,
): boolean {
  return computeContextualBoost(fullText, nameStart, nameEnd, 'NAME') > 0;
}
