/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CircuitBreaker } from './circuitBreaker.js';

describe('CircuitBreaker', () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    breaker = new CircuitBreaker({
      failureThreshold: 3,
      recoveryTimeoutMs: 100, // short timeout for testing
      halfOpenMaxAttempts: 2,
    });
  });

  it('starts in CLOSED state and allows requests', () => {
    expect(breaker.getState()).toBe('CLOSED');
    expect(breaker.canRequest()).toBe(true);
  });

  it('stays CLOSED when successes are recorded', () => {
    breaker.recordSuccess();
    breaker.recordSuccess();
    expect(breaker.getState()).toBe('CLOSED');
    expect(breaker.canRequest()).toBe(true);
  });

  it('trips to OPEN state after reaching failure threshold', () => {
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.getState()).toBe('CLOSED'); // 2 failures < 3

    breaker.recordFailure(); // 3rd failure trips the breaker
    expect(breaker.getState()).toBe('OPEN');
    expect(breaker.canRequest()).toBe(false);
  });

  it('transitions from OPEN to HALF_OPEN after recovery timeout', async () => {
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.getState()).toBe('OPEN');

    // Wait for recovery timeout
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(breaker.canRequest()).toBe(true);
    expect(breaker.getState()).toBe('HALF_OPEN');
  });

  it('re-opens if a failure occurs during HALF_OPEN', async () => {
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();

    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(breaker.canRequest()).toBe(true); // Transitions to HALF_OPEN

    breaker.recordFailure(); // Fails during probe
    expect(breaker.getState()).toBe('OPEN');
    expect(breaker.canRequest()).toBe(false);
  });

  it('recovers to CLOSED after consecutive successes in HALF_OPEN', async () => {
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();

    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(breaker.canRequest()).toBe(true);

    breaker.recordSuccess();
    breaker.recordSuccess(); // Reaches halfOpenMaxAttempts (2)
    expect(breaker.getState()).toBe('CLOSED');
    expect(breaker.canRequest()).toBe(true);
  });
});

describe('CircuitBreaker onTrip', () => {
  it('fires exactly once per transition into OPEN', async () => {
    let trips = 0;
    const breaker = new CircuitBreaker({
      failureThreshold: 2,
      recoveryTimeoutMs: 50,
      halfOpenMaxAttempts: 1,
      onTrip: () => trips++,
    });

    breaker.recordFailure();
    expect(trips).toBe(0);
    breaker.recordFailure(); // CLOSED -> OPEN
    breaker.recordFailure(); // already OPEN: no new trip
    breaker.recordFailure();
    expect(trips).toBe(1);

    await new Promise((resolve) => setTimeout(resolve, 70));
    expect(breaker.canRequest()).toBe(true); // HALF_OPEN probe
    expect(breaker.isProbing()).toBe(true);
    breaker.recordFailure(); // HALF_OPEN -> OPEN
    expect(trips).toBe(2);
  });

  it('counts the transitioning request as the first half-open probe', async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 1,
      recoveryTimeoutMs: 20,
      halfOpenMaxAttempts: 1,
    });
    breaker.recordFailure();
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(breaker.canRequest()).toBe(true); // the single allowed probe
    expect(breaker.canRequest()).toBe(false);
  });
});
