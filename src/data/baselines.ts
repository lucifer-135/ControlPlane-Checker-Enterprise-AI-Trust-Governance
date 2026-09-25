/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { UseCaseId } from "../types";

export interface QueryBaseline {
  use_case: UseCaseId;
  query_type: string;
  mean_tokens: number;
  stddev_tokens: number;
  mean_latency_ms: number;
  stddev_latency_ms: number;
  sample_size: number;
}

export const BASELINE_METRICS: Record<string, QueryBaseline> = {
  // Support Bot baselines (Fast, concise)
  "support_bot:refund_policy": {
    use_case: "support_bot",
    query_type: "refund_policy",
    mean_tokens: 165,
    stddev_tokens: 35,
    mean_latency_ms: 320,
    stddev_latency_ms: 60,
    sample_size: 4500,
  },
  "support_bot:account_access": {
    use_case: "support_bot",
    query_type: "account_access",
    mean_tokens: 140,
    stddev_tokens: 28,
    mean_latency_ms: 280,
    stddev_latency_ms: 50,
    sample_size: 3800,
  },
  "support_bot:product_troubleshoot": {
    use_case: "support_bot",
    query_type: "product_troubleshoot",
    mean_tokens: 220,
    stddev_tokens: 45,
    mean_latency_ms: 410,
    stddev_latency_ms: 80,
    sample_size: 6200,
  },
  "support_bot:billing_inquiry": {
    use_case: "support_bot",
    query_type: "billing_inquiry",
    mean_tokens: 180,
    stddev_tokens: 32,
    mean_latency_ms: 350,
    stddev_latency_ms: 65,
    sample_size: 5100,
  },

  // Internal Copilot baselines (Medium depth, code/docs)
  "internal_copilot:api_docs": {
    use_case: "internal_copilot",
    query_type: "api_docs",
    mean_tokens: 420,
    stddev_tokens: 95,
    mean_latency_ms: 850,
    stddev_latency_ms: 180,
    sample_size: 3100,
  },
  "internal_copilot:architecture_query": {
    use_case: "internal_copilot",
    query_type: "architecture_query",
    mean_tokens: 580,
    stddev_tokens: 120,
    mean_latency_ms: 1100,
    stddev_latency_ms: 240,
    sample_size: 2200,
  },
  "internal_copilot:hr_policy": {
    use_case: "internal_copilot",
    query_type: "hr_policy",
    mean_tokens: 310,
    stddev_tokens: 65,
    mean_latency_ms: 620,
    stddev_latency_ms: 110,
    sample_size: 4000,
  },
  "internal_copilot:code_refactor": {
    use_case: "internal_copilot",
    query_type: "code_refactor",
    mean_tokens: 650,
    stddev_tokens: 140,
    mean_latency_ms: 1350,
    stddev_latency_ms: 300,
    sample_size: 1900,
  },

  // Decision Support baselines (Regulated, high analytical complexity)
  "decision_support:loan_underwriting": {
    use_case: "decision_support",
    query_type: "loan_underwriting",
    mean_tokens: 480,
    stddev_tokens: 80,
    mean_latency_ms: 950,
    stddev_latency_ms: 160,
    sample_size: 2900,
  },
  "decision_support:claims_triage": {
    use_case: "decision_support",
    query_type: "claims_triage",
    mean_tokens: 520,
    stddev_tokens: 90,
    mean_latency_ms: 1050,
    stddev_latency_ms: 210,
    sample_size: 3400,
  },
  "decision_support:medical_prior_auth": {
    use_case: "decision_support",
    query_type: "medical_prior_auth",
    mean_tokens: 610,
    stddev_tokens: 110,
    mean_latency_ms: 1200,
    stddev_latency_ms: 250,
    sample_size: 1800,
  },
  "decision_support:compliance_audit": {
    use_case: "decision_support",
    query_type: "compliance_audit",
    mean_tokens: 540,
    stddev_tokens: 95,
    mean_latency_ms: 1150,
    stddev_latency_ms: 220,
    sample_size: 2500,
  },

  // Long-context RAG workloads (system prompt + history + ~15 retrieved chunks).
  // Their token and latency profile is an order of magnitude above short chats,
  // so they are baselined separately rather than scored against chat baselines.
  "support_bot:rag_account_dispute": {
    use_case: "support_bot",
    query_type: "rag_account_dispute",
    mean_tokens: 2300,
    stddev_tokens: 450,
    mean_latency_ms: 2700,
    stddev_latency_ms: 600,
    sample_size: 1800,
  },
  "internal_copilot:rag_runbook_search": {
    use_case: "internal_copilot",
    query_type: "rag_runbook_search",
    mean_tokens: 1800,
    stddev_tokens: 420,
    mean_latency_ms: 2500,
    stddev_latency_ms: 600,
    sample_size: 2400,
  },
  "decision_support:rag_claim_file_review": {
    use_case: "decision_support",
    query_type: "rag_claim_file_review",
    mean_tokens: 2000,
    stddev_tokens: 400,
    mean_latency_ms: 4200,
    stddev_latency_ms: 900,
    sample_size: 950,
  },
  "decision_support:rag_credit_memo": {
    use_case: "decision_support",
    query_type: "rag_credit_memo",
    mean_tokens: 1900,
    stddev_tokens: 380,
    mean_latency_ms: 3800,
    stddev_latency_ms: 850,
    sample_size: 1100,
  },
};

export function getBaseline(
  useCase: UseCaseId,
  queryType: string,
): QueryBaseline {
  const key = `${useCase}:${queryType}`;
  if (BASELINE_METRICS[key]) {
    return BASELINE_METRICS[key];
  }
  // Default fallback baseline by use case. sample_size 0 marks these as
  // placeholders, so the cost lane does not Z-score against them.
  if (useCase === "support_bot") {
    return {
      use_case: "support_bot",
      query_type: queryType,
      mean_tokens: 170,
      stddev_tokens: 35,
      mean_latency_ms: 350,
      stddev_latency_ms: 70,
      sample_size: 0,
    };
  } else if (useCase === "internal_copilot") {
    return {
      use_case: "internal_copilot",
      query_type: queryType,
      mean_tokens: 450,
      stddev_tokens: 100,
      mean_latency_ms: 850,
      stddev_latency_ms: 180,
      sample_size: 0,
    };
  } else {
    return {
      use_case: "decision_support",
      query_type: queryType,
      mean_tokens: 550,
      stddev_tokens: 95,
      mean_latency_ms: 1100,
      stddev_latency_ms: 220,
      sample_size: 0,
    };
  }
}
