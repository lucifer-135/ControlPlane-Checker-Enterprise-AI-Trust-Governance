/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { PerformanceLaneResult, SpanHighlight, UseCaseId } from '../../types';
import { computeNgramOverlap } from '../utils/ngramOverlap';
import { detectContradictions } from '../utils/contradictionDetector';
import { verifyEntitiesAgainstContext } from '../utils/entityExtractor';

// ──────────────────────────────────────────────────────────────────────
// Certainty Language Analysis
// ──────────────────────────────────────────────────────────────────────

/** Phrases that signal high assertive confidence in the AI response. */
const HIGH_CERTAINTY_PHRASES = [
  'with 100% legal certainty',
  'never qualify under any',
  'always unconditionally',
  'strictly mandates',
  'without a doubt',
  'absolute zero',
  'certifies with',
  'certify with',
  'proven to be',
  'guarantees',
  'guaranteed',
  'guarantee',
  'definitely',
  'certainly',
  'absolutely',
  'unequivocally',
  'indisputably',
  'unconditionally',
  'categorically',
  'without exception',
  'no exceptions',
  '100%',
];

/** Phrases that signal hedging / low confidence (appropriate epistemic humility). */
const HEDGING_PHRASES = [
  'could potentially',
  'according to documentation',
  'according to the',
  'based on the provided',
  'it is suggested',
  'might be',
  'likely',
  'appears that',
  'may require',
  'typically',
  'generally',
  'in most cases',
  'it seems',
  'possibly',
  'subject to',
  'depending on',
  'please verify',
  'please confirm',
  'i recommend checking',
];

/**
 * Computes a certainty score based on the density of high-confidence vs.
 * hedging phrases. Uses phrase density (count / sentence count) instead
 * of additive accumulation to normalize for response length.
 */
function computeCertaintyScore(text: string): {
  score: number;
  matchedPhrases: string[];
} {
  const lower = text.toLowerCase();
  const sentenceCount = Math.max(1, (text.match(/[.!?]+/g) || []).length);

  let highCertaintyHits = 0;
  let hedgingHits = 0;
  const matchedPhrases: string[] = [];

  for (const phrase of HIGH_CERTAINTY_PHRASES) {
    if (lower.includes(phrase.toLowerCase())) {
      highCertaintyHits++;
      matchedPhrases.push(phrase);
    }
  }

  for (const phrase of HEDGING_PHRASES) {
    if (lower.includes(phrase.toLowerCase())) {
      hedgingHits++;
    }
  }

  // Density-based score: normalize by sentence count
  const certaintyDensity = highCertaintyHits / sentenceCount;
  const hedgingDensity = hedgingHits / sentenceCount;

  // Base score: 0.5 (neutral), boosted by certainty, reduced by hedging
  let score = 0.5 + certaintyDensity * 0.3 - hedgingDensity * 0.2;
  score = Math.max(0.05, Math.min(1.0, score));

  return { score, matchedPhrases };
}

// ──────────────────────────────────────────────────────────────────────
// Number Grounding Verification
// ──────────────────────────────────────────────────────────────────────

/**
 * Extracts numeric values from text and checks which ones are not grounded
 * in the context. Allows ±5% tolerance for rounding differences.
 */
function findUngroundedNumbers(
  response: string,
  contextText: string,
): { text: string; reason: string }[] {
  const responseNumbers = response.match(/\$?\b\d+(?:,\d+)*(?:\.\d+)?%?\b/g) || [];
  const ungrounded: { text: string; reason: string }[] = [];

  for (const num of responseNumbers) {
    const cleanNum = num.replace(/[$,]/g, '');
    const numValue = parseFloat(cleanNum);

    // Skip trivially small numbers (e.g., "2 hours", "1 day")
    if (cleanNum.length <= 1) continue;
    if (isNaN(numValue)) continue;

    // Direct text match (exact or cleaned)
    if (contextText.includes(num) || contextText.includes(cleanNum)) continue;

    // Tolerance check: find numbers in context and see if any is within ±5%
    const contextNumbers = contextText.match(/\$?\b\d+(?:,\d+)*(?:\.\d+)?%?\b/g) || [];
    let foundClose = false;
    for (const cn of contextNumbers) {
      const cnValue = parseFloat(cn.replace(/[$,]/g, ''));
      if (!isNaN(cnValue) && cnValue > 0) {
        const ratio = Math.abs(numValue - cnValue) / cnValue;
        if (ratio <= 0.05) {
          foundClose = true;
          break;
        }
      }
    }

    if (!foundClose) {
      ungrounded.push({
        text: num,
        reason: `Factual entity/number "${num}" not present in retrieved governance context`,
      });
    }
  }

  return ungrounded;
}

// ──────────────────────────────────────────────────────────────────────
// Main Performance Lane Evaluator
// ──────────────────────────────────────────────────────────────────────

export function evaluatePerformanceLane(
  prompt: string,
  retrievedContext: string | null,
  response: string,
  _useCase: UseCaseId,
  hallucinationCutoff: number = 0.4,
): PerformanceLaneResult {
  const triggeringSpans: SpanHighlight[] = [];

  // ── 1. Certainty Score ──
  const { score: certaintyScore, matchedPhrases } = computeCertaintyScore(response);
  for (const phrase of matchedPhrases) {
    triggeringSpans.push({
      text: phrase,
      type: 'hallucination',
      reason: `High asserted certainty claim: "${phrase}"`,
    });
  }

  // ── 2. Groundedness Score ──
  let groundednessScore = 1.0;

  if (retrievedContext && retrievedContext.trim().length > 0) {
    const combinedContext = `${prompt} ${retrievedContext}`;

    // 2a. Weighted n-gram overlap (replaces Jaccard)
    const ngramResult = computeNgramOverlap(response, combinedContext);

    // 2b. Contradiction detection (replaces hardcoded string checks)
    const contradictions = detectContradictions(response, retrievedContext);
    for (const c of contradictions.contradictions) {
      triggeringSpans.push({
        text: c.responseTerm,
        type: 'hallucination',
        reason: c.reason,
      });
    }

    // 2c. Entity grounding verification (replaces hardcoded entity checks)
    const entityVerification = verifyEntitiesAgainstContext(response, combinedContext);
    for (const ue of entityVerification.ungrounded) {
      triggeringSpans.push({
        text: ue.text,
        type: 'hallucination',
        reason: `Ungrounded ${ue.type.toLowerCase().replace('_', ' ')} "${ue.text}" not found in retrieved context`,
      });
    }

    // 2d. Number grounding verification (kept and strengthened)
    const ungroundedNumbers = findUngroundedNumbers(response, combinedContext);
    for (const un of ungroundedNumbers) {
      triggeringSpans.push({
        text: un.text,
        type: 'hallucination',
        reason: un.reason,
      });
    }

    // ── Compute composite groundedness ──
    // Weights: n-gram overlap (0.30), contradiction penalty (0.40),
    //          entity grounding (0.15), number grounding (0.15)
    const numberPenalty = Math.min(0.5, ungroundedNumbers.length * 0.15);
    const entityPenalty = Math.min(0.4, entityVerification.ungrounded.length * 0.15);

    groundednessScore =
      ngramResult.overlapScore * 0.3 +
      (1.0 - contradictions.severity) * 0.4 +
      entityVerification.groundedRatio * 0.15 +
      Math.max(0, 1.0 - numberPenalty) * 0.15;

    // Hard penalty: if multiple contradictions found, severely cap groundedness
    if (contradictions.contradictions.length >= 2) {
      groundednessScore = Math.min(groundednessScore, 0.12);
    } else if (contradictions.hasContradiction) {
      groundednessScore = Math.min(groundednessScore, 0.25);
    }

    // Hard penalty: many ungrounded entities or numbers
    if (entityVerification.ungrounded.length >= 3 || ungroundedNumbers.length >= 3) {
      groundednessScore = Math.min(groundednessScore, 0.2);
    } else if (entityVerification.ungrounded.length >= 1) {
      groundednessScore = Math.min(groundednessScore, groundednessScore * 0.7);
    }

    groundednessScore = Math.max(0.0, Math.min(1.0, groundednessScore));
  } else {
    // No context provided: relies on certainty calibration
    groundednessScore = certaintyScore > 0.8 ? 0.4 : 0.75;
  }

  // ── 3. Certainty-vs-Support Mismatch ──
  // High certainty + low groundedness = "confidently wrong" signature
  const certaintySupportMismatch = Math.max(
    0.0,
    Math.min(1.0, certaintyScore * (1.0 - groundednessScore)),
  );

  const isConfidentlyWrong = certaintyScore >= 0.7 && groundednessScore <= 0.35;
  const isAmbiguous = groundednessScore >= 0.35 && groundednessScore <= 0.65;
  const needsJudgeCall = isAmbiguous || (isConfidentlyWrong && groundednessScore > 0.2);

  // ── 4. Risk Score ──
  let riskScore = 1.0 - groundednessScore;
  if (isConfidentlyWrong) {
    riskScore = Math.min(1.0, riskScore + 0.3);
  }

  // ── 5. Explanation ──
  let explanation =
    'Response is firmly grounded in retrieved governance context with appropriate certainty bounds.';
  if (isConfidentlyWrong) {
    explanation = `Critical Confidently Wrong signature: AI asserts high certainty (${(certaintyScore * 100).toFixed(0)}%) despite near-zero context support (${(groundednessScore * 100).toFixed(0)}%).`;
  } else if (groundednessScore < hallucinationCutoff) {
    explanation = `Low groundedness score (${(groundednessScore * 100).toFixed(0)}%): Response introduces unverified claims not present in retrieved context.`;
  } else if (isAmbiguous) {
    explanation = `Ambiguous grounding (${(groundednessScore * 100).toFixed(0)}%): Partial overlap detected; candidate for LLM Judge tiebreaker.`;
  }

  return {
    lane: 'performance',
    groundedness_score: Number(groundednessScore.toFixed(3)),
    certainty_score: Number(certaintyScore.toFixed(3)),
    certainty_support_mismatch: Number(certaintySupportMismatch.toFixed(3)),
    is_confidently_wrong: isConfidentlyWrong,
    is_ambiguous: isAmbiguous,
    needs_judge_call: needsJudgeCall,
    risk_score: Number(riskScore.toFixed(3)),
    triggering_spans: triggeringSpans,
    explanation,
  };
}
