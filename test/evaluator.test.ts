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

  it('throws on unsupported expressions instead of silently failing', () => {
    expect(() => evaluateCondition('resource.attributes.amount ** 2', baseInput)).toThrow();
  });
});
