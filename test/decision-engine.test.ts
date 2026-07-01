import { describe, expect, it } from 'vitest';
import { createMizaraClient } from '../src';
import type { Policy } from '../src/types';

const testPolicy: Policy = {
  policy_id: 'pol_test_v1',
  client_id: 'test_client',
  rules: [
    {
      id: 'rule_max_payout_limit',
      target_action: 'execute_payout',
      condition: 'resource.attributes.amount <= 50.00',
      effect: 'ALLOW',
      fallback_effect: 'DENY',
      remediation_message: 'Transaction value exceeds maximum unapproved client threshold of $50.00.',
    },
  ],
};

describe('decision engine', () => {
  it('denies a payout of $75 against a $50 policy max', async () => {
    const mizara = createMizaraClient({ policy: testPolicy });

    const result = await mizara.authorize({
      actor: { id: 'agent_1', type: 'autonomous_agent' },
      action: { name: 'execute_payout' },
      resource: { type: 'monetary_transaction', id: 'tx_1', attributes: { amount: 75, currency: 'USD' } },
    });

    expect(result.status).toBe('DENY');
    expect(result.evaluation_metadata.triggered_rule_id).toBe('rule_max_payout_limit');
    expect(result.enforcement.action_halted).toBe(true);
    expect(result.enforcement.user_facing_error).toMatch(/exceeds maximum/);
  });

  it('allows a payout of $25 against a $50 policy max', async () => {
    const mizara = createMizaraClient({ policy: testPolicy });

    const result = await mizara.authorize({
      actor: { id: 'agent_1', type: 'autonomous_agent' },
      action: { name: 'execute_payout' },
      resource: { type: 'monetary_transaction', id: 'tx_2', attributes: { amount: 25, currency: 'USD' } },
    });

    expect(result.status).toBe('ALLOW');
    expect(result.enforcement.action_halted).toBe(false);
    expect(result.enforcement.user_facing_error).toBeNull();
  });

  it('fails closed (DENY) when no rule matches the action', async () => {
    const mizara = createMizaraClient({ policy: testPolicy });

    const result = await mizara.authorize({
      actor: { id: 'agent_1', type: 'autonomous_agent' },
      action: { name: 'delete_database' },
      resource: { type: 'monetary_transaction', id: 'tx_3', attributes: {} },
    });

    expect(result.status).toBe('DENY');
    expect(result.evaluation_metadata.triggered_rule_id).toBeNull();
  });

  it('generates a unique cryptographic receipt per decision', async () => {
    const mizara = createMizaraClient({ policy: testPolicy });

    const result1 = await mizara.authorize({
      actor: { id: 'agent_1', type: 'autonomous_agent' },
      action: { name: 'execute_payout' },
      resource: { type: 'monetary_transaction', id: 'tx_4', attributes: { amount: 10 } },
    });
    const result2 = await mizara.authorize({
      actor: { id: 'agent_1', type: 'autonomous_agent' },
      action: { name: 'execute_payout' },
      resource: { type: 'monetary_transaction', id: 'tx_5', attributes: { amount: 10 } },
    });

    expect(result1.cryptographic_receipt.id).not.toBe(result2.cryptographic_receipt.id);
    expect(result1.cryptographic_receipt.hash).toBeTruthy();
    expect(result1.cryptographic_receipt.signature).toMatch(/^sig_local_/);
  });
});
