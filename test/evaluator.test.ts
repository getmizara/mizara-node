import { describe, expect, it } from 'vitest';
import { evaluateCondition } from '../src/engine/evaluator';
import type { AuthorizeInput } from '../src/types';

const baseInput: AuthorizeInput = {
  actor: { id: 'a1', type: 'autonomous_agent' },
  action: { name: 'execute_payout' },
  resource: { type: 'monetary_transaction', id: 'tx_1', attributes: { amount: 75 } },
  context: { target_jurisdiction: 'EU', data_classification: ['PII', 'PCI'] },
};

describe('evaluateCondition', () => {
  it('evaluates numeric comparisons', () => {
    expect(evaluateCondition('resource.attributes.amount <= 50.00', baseInput)).toBe(false);
    expect(evaluateCondition('resource.attributes.amount > 50.00', baseInput)).toBe(true);
  });

  it('evaluates string equality', () => {
    expect(evaluateCondition("context.target_jurisdiction == 'EU'", baseInput)).toBe(true);
    expect(evaluateCondition("context.target_jurisdiction == 'US'", baseInput)).toBe(false);
  });

  it('evaluates array.contains() calls', () => {
    expect(evaluateCondition("context.data_classification.contains('PII')", baseInput)).toBe(true);
    expect(evaluateCondition("context.data_classification.contains('PHI')", baseInput)).toBe(false);
  });

  it('evaluates compound logical expressions', () => {
    expect(
      evaluateCondition(
        "context.target_jurisdiction == 'EU' && context.data_classification.contains('PII')",
        baseInput,
      ),
    ).toBe(true);
  });

  it('evaluates addition', () => {
    expect(evaluateCondition('resource.attributes.amount + 5 > 79', baseInput)).toBe(true);
    expect(evaluateCondition('resource.attributes.amount + 5 > 81', baseInput)).toBe(false);
  });

  it('evaluates subtraction', () => {
    expect(evaluateCondition('resource.attributes.amount - 25 == 50', baseInput)).toBe(true);
  });

  it('evaluates compound arithmetic with comparison', () => {
    // Cumulative session pattern: caller passes projected total in context
    // 300 + 75 = 375 <= 500 → true (under limit, allow)
    expect(evaluateCondition('context.session_total + resource.attributes.amount <= 500', {
      ...baseInput,
      context: { session_total: 300, target_jurisdiction: 'EU', data_classification: ['PII', 'PCI'] },
    })).toBe(true);

    // 350 + 75 = 425 > 400 → false (over limit, deny)
    expect(evaluateCondition('context.session_total + resource.attributes.amount <= 400', {
      ...baseInput,
      context: { session_total: 350, target_jurisdiction: 'EU', data_classification: ['PII', 'PCI'] },
    })).toBe(false);
  });

  it('throws on unsupported expressions instead of silently failing', () => {
    expect(() => evaluateCondition('resource.attributes.amount ** 2', baseInput)).toThrow();
  });
});
