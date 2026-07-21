import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createReceipt, verifyReceipt } from '../src/receipts/receipt';
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

  it('signs the receipt with ed25519 and includes the public key', () => {
    const r1 = createReceipt({ input, status: 'DENY', triggeredRuleId: 'rule_x' });
    expect(r1.algorithm).toBe('ed25519');
    expect(r1.public_key).toBeTruthy();
    expect(r1.signature).toBeTruthy();
  });

  it('verifies independently with the public key', () => {
    const r1 = createReceipt({ input, status: 'DENY', triggeredRuleId: 'rule_x' });
    expect(verifyReceipt(r1, r1.public_key!)).toBe(true);
  });

  it('fails verification if the receipt was tampered with', () => {
    const r1 = createReceipt({ input, status: 'DENY', triggeredRuleId: 'rule_x' });
    const tampered = { ...r1, hash: 'a'.repeat(64) };
    expect(verifyReceipt(tampered, r1.public_key!)).toBe(false);
  });

  it('fails verification against an unrelated public key', () => {
    const r1 = createReceipt({ input, status: 'DENY', triggeredRuleId: 'rule_x' });
    const unrelatedKeyPair = generateKeyPairSync('ed25519');
    const unrelatedPublicKeyRaw = unrelatedKeyPair.publicKey
      .export({ format: 'der', type: 'spki' })
      .subarray(-32)
      .toString('base64');
    expect(verifyReceipt(r1, unrelatedPublicKeyRaw)).toBe(false);
  });
});
