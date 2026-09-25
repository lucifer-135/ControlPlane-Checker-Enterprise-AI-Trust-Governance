/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Circuit Breaker — Resilience Pattern for Upstream LLM Providers
 *
 * States:
 * - CLOSED (normal): requests flow through
 * - OPEN (tripped): requests are rejected immediately
 * - HALF_OPEN (probing): limited requests allowed to test recovery
 *
 * Transitions:
 *   CLOSED → OPEN: when consecutive failures reach the threshold
 *   OPEN → HALF_OPEN: after recovery timeout elapses
 *   HALF_OPEN → CLOSED: on success
 *   HALF_OPEN → OPEN: on failure
 */

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerConfig {
  /** Number of consecutive failures before opening the circuit. */
  failureThreshold: number;
  /** Time in ms before transitioning from OPEN to HALF_OPEN. */
  recoveryTimeoutMs: number;
  /** Max attempts allowed in HALF_OPEN state before deciding. */
  halfOpenMaxAttempts: number;
  /** Invoked exactly once per transition into OPEN (CLOSED → OPEN or HALF_OPEN → OPEN). */
  onTrip?: () => void;
}

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private consecutiveFailures = 0;
  private lastFailureTime = 0;
  private halfOpenAttempts = 0;
  private config: CircuitBreakerConfig;

  constructor(config: Partial<CircuitBreakerConfig> = {}) {
    this.config = {
      failureThreshold: config.failureThreshold ?? 5,
      recoveryTimeoutMs: config.recoveryTimeoutMs ?? 30000,
      halfOpenMaxAttempts: config.halfOpenMaxAttempts ?? 2,
      onTrip: config.onTrip,
    };
  }

  private trip(): void {
    const wasOpen = this.state === 'OPEN';
    this.state = 'OPEN';
    if (!wasOpen) {
      try {
        this.config.onTrip?.();
      } catch {
        // Metric/observer failures must never affect breaker state
      }
    }
  }

  /** Check if a request should be allowed through. */
  canRequest(): boolean {
    if (this.state === 'CLOSED') return true;

    if (this.state === 'OPEN') {
      // Check if recovery timeout has elapsed
      if (Date.now() - this.lastFailureTime >= this.config.recoveryTimeoutMs) {
        this.state = 'HALF_OPEN';
        // This request is the first probe
        this.halfOpenAttempts = 1;
        return true;
      }
      return false;
    }

    // HALF_OPEN: allow limited probe requests
    if (this.halfOpenAttempts < this.config.halfOpenMaxAttempts) {
      this.halfOpenAttempts++;
      return true;
    }
    return false;
  }

  /** Record a successful request. */
  recordSuccess(): void {
    if (this.state === 'HALF_OPEN') {
      this.state = 'CLOSED';
      this.consecutiveFailures = 0;
      this.halfOpenAttempts = 0;
    }
    if (this.state === 'CLOSED') {
      this.consecutiveFailures = 0;
    }
  }

  /** Record a failed request. */
  recordFailure(): void {
    this.consecutiveFailures++;
    this.lastFailureTime = Date.now();

    if (this.state === 'HALF_OPEN') {
      // Failed during probe — re-open
      this.trip();
      return;
    }

    if (this.state === 'CLOSED' && this.consecutiveFailures >= this.config.failureThreshold) {
      this.trip();
    }
  }

  /** True while in HALF_OPEN, i.e. the caller holds a bounded recovery probe. */
  isProbing(): boolean {
    return this.state === 'HALF_OPEN';
  }

  /** Get the current circuit state. */
  getState(): CircuitState {
    // Check for auto-transition from OPEN to HALF_OPEN
    if (
      this.state === 'OPEN' &&
      Date.now() - this.lastFailureTime >= this.config.recoveryTimeoutMs
    ) {
      this.state = 'HALF_OPEN';
      this.halfOpenAttempts = 0;
    }
    return this.state;
  }

  /** Get circuit breaker stats. */
  getStats(): {
    state: CircuitState;
    consecutiveFailures: number;
    lastFailureTime: number;
    config: CircuitBreakerConfig;
  } {
    return {
      state: this.getState(),
      consecutiveFailures: this.consecutiveFailures,
      lastFailureTime: this.lastFailureTime,
      config: this.config,
    };
  }

  /** Force reset the circuit breaker to CLOSED. */
  reset(): void {
    this.state = 'CLOSED';
    this.consecutiveFailures = 0;
    this.halfOpenAttempts = 0;
    this.lastFailureTime = 0;
  }
}
