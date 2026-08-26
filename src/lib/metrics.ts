/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  ConfusionMatrix,
  EvaluationResult,
  PolicyProfile,
  SyntheticInteraction,
  UseCaseId,
} from '../types';
import { evaluateInteraction } from './decisionEngine';

export function isGroundTruthViolating(item: SyntheticInteraction): boolean {
  // Any ground truth label other than 'clean' is a true violation
  return item.ground_truth_labels.some((l) => l !== 'clean');
}

export interface ConfusionMatrixBreakdown {
  TP: SyntheticInteraction[];
  FP: SyntheticInteraction[];
  TN: SyntheticInteraction[];
  FN: SyntheticInteraction[];
}

export function getConfusionMatrixItems(
  interactions: SyntheticInteraction[],
  evaluations: Record<string, EvaluationResult>,
  targetUseCase?: UseCaseId,
): ConfusionMatrixBreakdown {
  const tp: SyntheticInteraction[] = [];
  const fp: SyntheticInteraction[] = [];
  const tn: SyntheticInteraction[] = [];
  const fn: SyntheticInteraction[] = [];

  const filtered = targetUseCase
    ? interactions.filter((i) => i.use_case === targetUseCase)
    : interactions;

  for (const item of filtered) {
    const evalRes = evaluations[item.id];
    if (!evalRes) continue;

    const isTrueViolation = isGroundTruthViolating(item);
    const isBlocked = evalRes.verdict === 'BLOCK_ESCALATE';

    if (isTrueViolation && isBlocked) {
      tp.push(item);
    } else if (!isTrueViolation && isBlocked) {
      fp.push(item);
    } else if (!isTrueViolation && !isBlocked) {
      tn.push(item);
    } else if (isTrueViolation && !isBlocked) {
      fn.push(item);
    }
  }

  return { TP: tp, FP: fp, TN: tn, FN: fn };
}

export function computeConfusionMatrix(
  interactions: SyntheticInteraction[],
  evaluations: Record<string, EvaluationResult>,
  targetUseCase?: UseCaseId,
): ConfusionMatrix {
  const items = getConfusionMatrixItems(interactions, evaluations, targetUseCase);
  const tp = items.TP.length;
  const fp = items.FP.length;
  const tn = items.TN.length;
  const fn = items.FN.length;

  const total = tp + fp + tn + fn || 1;
  const precision = tp + fp > 0 ? tp / (tp + fp) : 1;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 1;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  const accuracy = (tp + tn) / total;
  const fpRate = fp + tn > 0 ? fp / (fp + tn) : 0;
  const fnRate = tp + fn > 0 ? fn / (tp + fn) : 0;

  return {
    true_positives: tp,
    false_positives: fp,
    true_negatives: tn,
    false_negatives: fn,
    precision: Number((precision * 100).toFixed(1)),
    recall: Number((recall * 100).toFixed(1)),
    f1_score: Number((f1 * 100).toFixed(1)),
    accuracy: Number((accuracy * 100).toFixed(1)),
    fp_rate: Number((fpRate * 100).toFixed(1)),
    fn_rate: Number((fnRate * 100).toFixed(1)),
    total_evaluated: (targetUseCase
      ? interactions.filter((i) => i.use_case === targetUseCase)
      : interactions
    ).length,
  };
}

export interface TradeoffPoint {
  threshold: number;
  fp_rate: number;
  fn_rate: number;
  precision: number;
  recall: number;
  f1_score: number;
  block_count: number;
}

export function generateTradeoffCurve(
  interactions: SyntheticInteraction[],
  baseProfiles: Record<UseCaseId, PolicyProfile>,
  selectedUseCase?: UseCaseId,
): TradeoffPoint[] {
  const points: TradeoffPoint[] = [];

  // Sweep threshold from 0.10 to 0.90 in steps of 0.05
  for (let t = 0.1; t <= 0.9; t += 0.05) {
    const thresholdVal = Number(t.toFixed(2));

    // Create cloned profiles with modified block_escalate threshold
    const testProfiles: Record<UseCaseId, PolicyProfile> = {
      support_bot: {
        ...baseProfiles.support_bot,
        thresholds: { ...baseProfiles.support_bot.thresholds, block_escalate: thresholdVal },
      },
      internal_copilot: {
        ...baseProfiles.internal_copilot,
        thresholds: { ...baseProfiles.internal_copilot.thresholds, block_escalate: thresholdVal },
      },
      decision_support: {
        ...baseProfiles.decision_support,
        thresholds: { ...baseProfiles.decision_support.thresholds, block_escalate: thresholdVal },
      },
    };

    let tp = 0;
    let fp = 0;
    let tn = 0;
    let fn = 0;
    let blockCount = 0;

    const filtered = selectedUseCase
      ? interactions.filter((i) => i.use_case === selectedUseCase)
      : interactions;

    for (const item of filtered) {
      const res = evaluateInteraction(item, testProfiles[item.use_case]);
      const isTrueViolation = isGroundTruthViolating(item);
      const isBlocked = res.verdict === 'BLOCK_ESCALATE';

      if (isBlocked) blockCount++;

      if (isTrueViolation && isBlocked) {
        tp++;
      } else if (!isTrueViolation && isBlocked) {
        fp++;
      } else if (!isTrueViolation && !isBlocked) {
        tn++;
      } else if (isTrueViolation && !isBlocked) {
        fn++;
      }
    }

    const precision = tp + fp > 0 ? tp / (tp + fp) : 1;
    const recall = tp + fn > 0 ? tp / (tp + fn) : 1;
    const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
    const fpRate = fp + tn > 0 ? (fp / (fp + tn)) * 100 : 0;
    const fnRate = tp + fn > 0 ? (fn / (tp + fn)) * 100 : 0;

    points.push({
      threshold: thresholdVal,
      fp_rate: Number(fpRate.toFixed(1)),
      fn_rate: Number(fnRate.toFixed(1)),
      precision: Number((precision * 100).toFixed(1)),
      recall: Number((recall * 100).toFixed(1)),
      f1_score: Number((f1 * 100).toFixed(1)),
      block_count: blockCount,
    });
  }

  return points;
}
