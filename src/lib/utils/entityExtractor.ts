/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Entity Extractor
 *
 * Regex-based extraction of named entities, regulation references,
 * article citations, and US street addresses from text.
 * Used to verify whether entities in a response are grounded in context.
 */

export interface ExtractedEntity {
  /** The type of entity. */
  type: 'PROPER_NAME' | 'REGULATION' | 'CITATION' | 'ADDRESS' | 'ORGANIZATION' | 'DATE_SPECIFIC';
  /** The matched text. */
  text: string;
  /** Start offset in the source string. */
  start: number;
  /** End offset in the source string. */
  end: number;
}

/**
 * Common English words that start with capitals (e.g., at sentence starts)
 * and should not be treated as proper names.
 */
const COMMON_CAPITALIZED = new Set([
  'the',
  'a',
  'an',
  'this',
  'that',
  'these',
  'those',
  'it',
  'its',
  'i',
  'we',
  'you',
  'he',
  'she',
  'they',
  'my',
  'your',
  'our',
  'his',
  'her',
  'their',
  'if',
  'but',
  'and',
  'or',
  'so',
  'yet',
  'for',
  'nor',
  'as',
  'at',
  'by',
  'in',
  'of',
  'on',
  'to',
  'up',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'has',
  'have',
  'had',
  'do',
  'does',
  'did',
  'will',
  'would',
  'shall',
  'should',
  'can',
  'could',
  'may',
  'might',
  'must',
  'not',
  'no',
  'yes',
  'all',
  'each',
  'every',
  'some',
  'any',
  'here',
  'there',
  'when',
  'where',
  'how',
  'why',
  'what',
  'which',
  'who',
  'whom',
  'whose',
  'than',
  'then',
  'now',
  'just',
  'also',
  'very',
  'too',
  'still',
  'however',
  'therefore',
  'thus',
  'hence',
  'sure',
  'please',
  'thank',
  'thanks',
  'hello',
  'hi',
  'dear',
  'note',
  'important',
  'warning',
  'based',
  'according',
  'after',
  'before',
  'during',
  'since',
  'until',
  'while',
  'although',
  'because',
  'since',
  'unless',
  'once',
  'with',
  'without',
  'under',
  'over',
  'between',
  'through',
  'from',
  'into',
  'out',
  'about',
  'off',
  // Common non-name sentence starters
  'many',
  'most',
  'such',
  'other',
  'another',
  'both',
  'few',
  'more',
  'several',
  'various',
  'certain',
  'either',
  'neither',
]);

/**
 * Common title words and location keywords to filter from name detection.
 */
const TITLE_LOCATION_WORDS = new Set([
  'mr',
  'mrs',
  'ms',
  'dr',
  'prof',
  'sir',
  'madam',
  'street',
  'avenue',
  'road',
  'drive',
  'lane',
  'boulevard',
  'way',
  'court',
  'place',
  'circle',
  'north',
  'south',
  'east',
  'west',
  'new',
  'old',
  'san',
  'los',
  'las',
  'el',
  'la',
  'del',
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
]);

/**
 * Extracts proper name candidates (2+ capitalized words not at sentence start).
 */
function extractProperNames(text: string): ExtractedEntity[] {
  const entities: ExtractedEntity[] = [];
  // Match sequences of 2+ capitalized words
  const nameRegex = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g;
  let match: RegExpExecArray | null;

  while ((match = nameRegex.exec(text)) !== null) {
    const candidate = match[1];
    const words = candidate.split(/\s+/);

    // Filter out if all words are common capitalized words or title/location words
    const isCommon = words.every(
      (w) => COMMON_CAPITALIZED.has(w.toLowerCase()) || TITLE_LOCATION_WORDS.has(w.toLowerCase()),
    );
    if (isCommon) continue;

    // Filter: check if this is at the very start of a sentence
    const charBefore = match.index > 0 ? text[match.index - 1] : '';
    const twoCharsBefore = match.index > 1 ? text.substring(match.index - 2, match.index) : '';
    const isAtSentenceStart = match.index === 0 || /[.!?]\s$/.test(twoCharsBefore);

    // If at sentence start and only 2 words, skip (too ambiguous)
    if (isAtSentenceStart && words.length <= 2) continue;

    entities.push({
      type: 'PROPER_NAME',
      text: candidate,
      start: match.index,
      end: match.index + candidate.length,
    });
  }

  return entities;
}

/**
 * Extracts regulation references (e.g., "Regulation 99.4", "Article 12",
 * "Section 4(b)", "Rule 4511").
 */
function extractRegulations(text: string): ExtractedEntity[] {
  const entities: ExtractedEntity[] = [];
  const regexes = [
    /\b(?:Regulation|Rule|Directive|Standard|Statute)\s+(?:\d+(?:\.\d+)?(?:\([a-z]\))?)/g,
    /\b(?:Article|Section|Clause|Paragraph|Part)\s+\d+(?:\.\d+)?(?:\([a-z0-9]+\))?/g,
    /\b(?:HIPAA|GDPR|ECOA|GLBA|FINRA|CCPA|DPDPA?|PCI[\s-]DSS)\b/g,
  ];

  for (const regex of regexes) {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      entities.push({
        type: 'REGULATION',
        text: match[0],
        start: match.index,
        end: match.index + match[0].length,
      });
    }
  }

  return entities;
}

/**
 * Extracts US street addresses.
 * Pattern: number + street name + street type + optional city, state, zip
 */
function extractAddresses(text: string): ExtractedEntity[] {
  const entities: ExtractedEntity[] = [];
  const addressRegex =
    /\b\d+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(?:Lane|Street|St|Avenue|Ave|Boulevard|Blvd|Drive|Dr|Road|Rd|Way|Court|Ct|Place|Pl|Circle|Cir|Terrace|Ter|Pike|Highway|Hwy)(?:\.)?(?:,?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)?(?:,?\s+[A-Z]{2}\s+\d{5}(?:-\d{4})?)?/g;

  let match: RegExpExecArray | null;
  while ((match = addressRegex.exec(text)) !== null) {
    entities.push({
      type: 'ADDRESS',
      text: match[0],
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  return entities;
}

/**
 * Extracts all entity types from a given text.
 */
export function extractEntities(text: string): ExtractedEntity[] {
  return [...extractProperNames(text), ...extractRegulations(text), ...extractAddresses(text)];
}

/**
 * Checks how many entities from a response are grounded (present) in the context.
 *
 * @param responseText  The AI model's response.
 * @param contextText   The retrieved context (+ prompt).
 * @returns Object with grounded/ungrounded entity lists and a ratio.
 */
export function verifyEntitiesAgainstContext(
  responseText: string,
  contextText: string,
): {
  grounded: ExtractedEntity[];
  ungrounded: ExtractedEntity[];
  groundedRatio: number;
} {
  const responseEntities = extractEntities(responseText);
  const contextLower = contextText.toLowerCase();

  const grounded: ExtractedEntity[] = [];
  const ungrounded: ExtractedEntity[] = [];

  for (const entity of responseEntities) {
    const entityLower = entity.text.toLowerCase();
    if (contextLower.includes(entityLower)) {
      grounded.push(entity);
    } else {
      // For multi-word entities, check if individual key words exist
      const words = entityLower.split(/\s+/).filter((w) => w.length > 2);
      const wordMatchCount = words.filter((w) => contextLower.includes(w)).length;
      if (words.length > 0 && wordMatchCount / words.length > 0.6) {
        grounded.push(entity); // Partial match — likely a paraphrase
      } else {
        ungrounded.push(entity);
      }
    }
  }

  const total = grounded.length + ungrounded.length;
  const groundedRatio = total > 0 ? grounded.length / total : 1.0;

  return {
    grounded,
    ungrounded,
    groundedRatio: Number(groundedRatio.toFixed(3)),
  };
}
