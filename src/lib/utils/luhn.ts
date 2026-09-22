/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Luhn Algorithm — Validates credit card numbers, IMEI codes, and other
 * check-digit-protected identifiers.
 *
 * The algorithm works by doubling every second digit from the right,
 * subtracting 9 from results > 9, summing all digits, and checking
 * if the total is divisible by 10.
 */

/**
 * Validates a numeric string using the Luhn checksum algorithm.
 * @param input - A string of digits (spaces and dashes are stripped).
 * @returns true if the input passes the Luhn check.
 */
export function isValidLuhn(input: string): boolean {
  // Strip spaces, dashes, and non-digit characters
  const digits = input.replace(/[\s-]/g, '');

  // Must be all digits and have a reasonable length
  if (!/^\d+$/.test(digits) || digits.length < 8) {
    return false;
  }

  let sum = 0;
  let shouldDouble = false;

  // Process from right to left
  for (let i = digits.length - 1; i >= 0; i--) {
    let digit = parseInt(digits[i], 10);

    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }

    sum += digit;
    shouldDouble = !shouldDouble;
  }

  return sum % 10 === 0;
}

/**
 * Validates a US Social Security Number beyond regex format matching.
 * Rejects known-invalid area numbers per SSA rules:
 * - Area 000, 666, and 900–999 are never assigned.
 * - Group 00 is never assigned.
 * - Serial 0000 is never assigned.
 */
export function isValidSSNStructure(ssn: string): boolean {
  const cleaned = ssn.replace(/[\s-]/g, '');
  if (!/^\d{9}$/.test(cleaned)) return false;

  const area = parseInt(cleaned.substring(0, 3), 10);
  const group = parseInt(cleaned.substring(3, 5), 10);
  const serial = parseInt(cleaned.substring(5, 9), 10);

  if (area === 0 || area === 666 || area >= 900) return false;
  if (group === 0) return false;
  if (serial === 0) return false;

  return true;
}

/**
 * Quick check: does a string of 13-19 digits look like a plausible
 * credit card number? (Length + Luhn)
 */
export function isCreditCardCandidate(input: string): boolean {
  const digits = input.replace(/[\s-]/g, '');
  if (digits.length < 13 || digits.length > 19) return false;
  return isValidLuhn(digits);
}

/**
 * Validates a credit card candidate and returns validity and card brand.
 */
export function validateCreditCard(input: string): {
  isValid: boolean;
  brand?: string;
} {
  const digits = input.replace(/[\s-]/g, '');
  if (!isCreditCardCandidate(digits)) {
    return { isValid: false };
  }

  let brand: string | undefined;
  if (/^4/.test(digits)) brand = 'Visa';
  else if (/^5[1-5]/.test(digits)) brand = 'MasterCard';
  else if (/^3[47]/.test(digits)) brand = 'Amex';
  else if (/^6(?:011|5)/.test(digits)) brand = 'Discover';

  return { isValid: true, brand };
}
