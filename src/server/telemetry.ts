/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Telemetry Exporter — Prometheus-Compatible Governance Metrics
 *
 * Exposes real-time operational and trust metrics at GET /api/metrics:
 * - Request counts by verdict tier (ALLOW, BADGE, SOFT_CORRECT, BLOCK_ESCALATE)
 * - PII breach detections by entity type (SSN, CREDIT_CARD, etc.)
 * - Hallucination / ungrounded claim counters
 * - Latency histograms and running averages
 */

interface MetricsState {
  totalRequests: number;
  verdicts: Record<string, number>;
  piiDetections: Record<string, number>;
  hallucinations: number;
  circuitBreakerTrips: number;
  totalLatencyMs: number;
  requestsWithMultiLaneOverlap: number;
}

const metrics: MetricsState = {
  totalRequests: 0,
  verdicts: {
    ALLOW: 0,
    BADGE: 0,
    SOFT_CORRECT: 0,
    BLOCK_ESCALATE: 0,
  },
  piiDetections: {},
  hallucinations: 0,
  circuitBreakerTrips: 0,
  totalLatencyMs: 0,
  requestsWithMultiLaneOverlap: 0,
};

export function recordEvaluationTelemetry(
  verdict: string,
  policy: string,
  piiEntities: string[] = [],
  isHallucinated: boolean = false,
  hasMultiLaneOverlap: boolean = false,
  latencyMs: number = 0,
): void {
  metrics.totalRequests += 1;
  metrics.verdicts[verdict] = (metrics.verdicts[verdict] || 0) + 1;
  metrics.totalLatencyMs += latencyMs;

  if (isHallucinated) {
    metrics.hallucinations += 1;
  }

  if (hasMultiLaneOverlap) {
    metrics.requestsWithMultiLaneOverlap += 1;
  }

  for (const entity of piiEntities) {
    metrics.piiDetections[entity] = (metrics.piiDetections[entity] || 0) + 1;
  }
}

export function recordCircuitBreakerTrip(): void {
  metrics.circuitBreakerTrips += 1;
}

/**
 * Formats metrics into Prometheus text format for scraping.
 */
export function getPrometheusMetricsText(): string {
  const lines: string[] = [];

  lines.push('# HELP controlplane_requests_total Total number of governance-evaluated requests');
  lines.push('# TYPE controlplane_requests_total counter');
  lines.push(`controlplane_requests_total ${metrics.totalRequests}`);

  lines.push(
    '# HELP controlplane_verdicts_total Number of requests categorized by governance verdict tier',
  );
  lines.push('# TYPE controlplane_verdicts_total counter');
  for (const [verdict, count] of Object.entries(metrics.verdicts)) {
    lines.push(`controlplane_verdicts_total{tier="${verdict}"} ${count}`);
  }

  lines.push(
    '# HELP controlplane_pii_detections_total Number of PII entity exposures blocked/redacted',
  );
  lines.push('# TYPE controlplane_pii_detections_total counter');
  for (const [entity, count] of Object.entries(metrics.piiDetections)) {
    lines.push(`controlplane_pii_detections_total{entity_type="${entity}"} ${count}`);
  }

  lines.push(
    '# HELP controlplane_hallucinations_total Number of hallucinated or ungrounded claims detected',
  );
  lines.push('# TYPE controlplane_hallucinations_total counter');
  lines.push(`controlplane_hallucinations_total ${metrics.hallucinations}`);

  lines.push(
    '# HELP controlplane_multi_lane_overlaps_total Number of interactions with compounding risk across >= 2 lanes',
  );
  lines.push('# TYPE controlplane_multi_lane_overlaps_total counter');
  lines.push(`controlplane_multi_lane_overlaps_total ${metrics.requestsWithMultiLaneOverlap}`);

  lines.push(
    '# HELP controlplane_circuit_breaker_trips_total Number of times upstream provider circuit breaker tripped',
  );
  lines.push('# TYPE controlplane_circuit_breaker_trips_total counter');
  lines.push(`controlplane_circuit_breaker_trips_total ${metrics.circuitBreakerTrips}`);

  const avgLatency =
    metrics.totalRequests > 0 ? (metrics.totalLatencyMs / metrics.totalRequests).toFixed(2) : '0';
  lines.push(
    '# HELP controlplane_average_latency_ms Average evaluation pipeline overhead in milliseconds',
  );
  lines.push('# TYPE controlplane_average_latency_ms gauge');
  lines.push(`controlplane_average_latency_ms ${avgLatency}`);

  return lines.join('\n') + '\n';
}
