import { describe, expect, it } from 'vitest';
import { createReceipt } from '../src/receipts/receipt';
import type { AuthorizeInput } from '../src/types';

const input: AuthorizeInput = {
  actor: { id: 'a1', type: 'autonomous_agent' },
  action: { name: 'execute_payout' },
  resource: { type: 'monetary_transaction', id: 'tx_1', attributes: { amount: 75 } },
};

describe('createReceipt', () => {
  it('produces a deterministic hash for identical decisions', () => {
    const r1 = createReceipt({ input, status: 'DENY', triggeredRuleId: 'rule_x' });
    const r2 = createReceipt({ input, status: 'DENY', triggeredRuleId: 'rule_x' });

    expect(r1.hash).toBe(r2.hash);
    expect(r1.id).not.toBe(r2.id);
  });

  it('produces a different hash when the decision differs', () => {
    const r1 = createReceipt({ input, status: 'DENY', triggeredRuleId: 'rule_x' });
    const r2 = createReceipt({ input, status: 'ALLOW', triggeredRuleId: 'rule_x' });

    expect(r1.hash).not.toBe(r2.hash);
  });

  it('signs the receipt', () => {
    const r1 = createReceipt({ input, status: 'DENY', triggeredRuleId: 'rule_x' });
    expect(r1.signature).toMatch(/^sig_local_[a-f0-9]{32}$/);
  });
});
