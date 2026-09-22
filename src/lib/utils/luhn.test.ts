/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { isValidLuhn, isValidSSNStructure, isCreditCardCandidate } from './luhn';

describe('Luhn Algorithm', () => {
  describe('isValidLuhn', () => {
    it('validates known valid credit card numbers', () => {
      // Visa test number
      expect(isValidLuhn('4111111111111111')).toBe(true);
      // Mastercard test number
      expect(isValidLuhn('5500000000000004')).toBe(true);
      // Amex test number
      expect(isValidLuhn('378282246310005')).toBe(true);
    });

    it('rejects invalid credit card numbers', () => {
      expect(isValidLuhn('4111111111111112')).toBe(false);
      expect(isValidLuhn('1234567890123456')).toBe(false);
      expect(isValidLuhn('0000000000000000')).toBe(true); // Valid Luhn but not a real CC
    });

    it('handles formatted input with spaces and dashes', () => {
      expect(isValidLuhn('4111 1111 1111 1111')).toBe(true);
      expect(isValidLuhn('4111-1111-1111-1111')).toBe(true);
    });

    it('rejects too-short inputs', () => {
      expect(isValidLuhn('1234')).toBe(false);
      expect(isValidLuhn('12345')).toBe(false);
    });

    it('rejects non-numeric input', () => {
      expect(isValidLuhn('abcdefghijklmnop')).toBe(false);
    });
  });

  describe('isValidSSNStructure', () => {
    it('validates well-formed SSNs', () => {
      expect(isValidSSNStructure('078-05-1120')).toBe(true);
      expect(isValidSSNStructure('219-09-9999')).toBe(true);
    });

    it('rejects area code 000', () => {
      expect(isValidSSNStructure('000-12-3456')).toBe(false);
    });

    it('rejects area code 666', () => {
      expect(isValidSSNStructure('666-12-3456')).toBe(false);
    });

    it('rejects area codes 900-999', () => {
      expect(isValidSSNStructure('900-12-3456')).toBe(false);
      expect(isValidSSNStructure('999-12-3456')).toBe(false);
    });

    it('rejects group 00', () => {
      expect(isValidSSNStructure('123-00-3456')).toBe(false);
    });

    it('rejects serial 0000', () => {
      expect(isValidSSNStructure('123-45-0000')).toBe(false);
    });
  });

  describe('isCreditCardCandidate', () => {
    it('accepts valid Visa test card', () => {
      expect(isCreditCardCandidate('4111111111111111')).toBe(true);
    });

    it('rejects Luhn-invalid 16-digit number', () => {
      expect(isCreditCardCandidate('1234567890123456')).toBe(false);
    });

    it('rejects too-short numbers', () => {
      expect(isCreditCardCandidate('123456789')).toBe(false);
    });

    it('rejects too-long numbers', () => {
      expect(isCreditCardCandidate('12345678901234567890')).toBe(false);
    });
  });
});
