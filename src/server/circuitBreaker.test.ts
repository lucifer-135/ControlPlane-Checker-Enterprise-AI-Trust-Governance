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
