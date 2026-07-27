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
    expect(result1.cryptographic_receipt.signature).toBeTruthy();
  });
});

describe('multi-rule composition (most restrictive wins)', () => {
  // The exact example policy from the V1 MVP spec: a payout-limit rule
  // targeting execute_payout, and a regional data-isolation rule
  // targeting "any". Both can match the same execute_payout request.
  const multiRulePolicy: Policy = {
    policy_id: 'pol_payout_v1',
    client_id: 'acme_corp',
    rules: [
      {
        id: 'rule_max_payout_limit',
        target_action: 'execute_payout',
        condition: 'resource.attributes.amount <= 50.00',
        effect: 'ALLOW',
        fallback_effect: 'DENY',
        remediation_message: 'Transaction value exceeds maximum unapproved client threshold of $50.00.',
      },
      {
        id: 'rule_regional_data_isolation',
        target_action: 'any',
        condition: "context.target_jurisdiction == 'EU' && context.data_classification.contains('PII')",
        effect: 'ALLOW',
        fallback_effect: 'REDACT',
        remediation_message: 'Sensitive European personal profiles must be dynamically masked before transport.',
      },
    ],
  };

  it('combines both matching rules instead of only firing the first one', async () => {
    const mizara = createMizaraClient({ policy: multiRulePolicy });

    // Within the $50 limit (rule 1 alone would ALLOW), but NOT in the EU
    // with PII data, so rule 2's fallback (REDACT) also applies. The more
    // restrictive outcome must win.
    const result = await mizara.authorize({
      actor: { id: 'agent_1', type: 'autonomous_agent' },
      action: { name: 'execute_payout' },
      resource: { type: 'monetary_transaction', id: 'tx_1', attributes: { amount: 25, currency: 'USD' } },
      context: { target_jurisdiction: 'US', data_classification: ['PII'] },
    });

    expect(result.status).toBe('REDACT');
    expect(result.evaluation_metadata.triggered_rule_id).toBe('rule_regional_data_isolation');
  });

  it('lets a DENY from one rule override an ALLOW from another, regardless of array order', async () => {
    const mizara = createMizaraClient({ policy: multiRulePolicy });

    // Over the $50 limit -> rule 1 DENYs. Also EU + PII -> rule 2 ALLOWs
    // (condition true). DENY must still win even though rule 2's outcome
    // is less restrictive.
    const result = await mizara.authorize({
      actor: { id: 'agent_1', type: 'autonomous_agent' },
      action: { name: 'execute_payout' },
      resource: { type: 'monetary_transaction', id: 'tx_2', attributes: { amount: 75, currency: 'USD' } },
      context: { target_jurisdiction: 'EU', data_classification: ['PII'] },
    });

    expect(result.status).toBe('DENY');
    expect(result.evaluation_metadata.triggered_rule_id).toBe('rule_max_payout_limit');
  });

  it('is deterministic when two matching rules tie on severity: earlier rule wins', async () => {
    const tiePolicy: Policy = {
      policy_id: 'pol_tie_v1',
      client_id: 'test_client',
      rules: [
        {
          id: 'rule_a_deny',
          target_action: 'any',
          condition: 'resource.attributes.amount > 1000000',
          effect: 'ALLOW',
          fallback_effect: 'DENY',
        },
        {
          id: 'rule_b_deny',
          target_action: 'any',
          condition: 'resource.attributes.amount > 1000000',
          effect: 'ALLOW',
          fallback_effect: 'DENY',
        },
      ],
    };
    const mizara = createMizaraClient({ policy: tiePolicy });

    const result = await mizara.authorize({
      actor: { id: 'agent_1', type: 'autonomous_agent' },
      action: { name: 'anything' },
      resource: { type: 'monetary_transaction', id: 'tx_3', attributes: { amount: 10 } },
    });

    expect(result.status).toBe('DENY');
    expect(result.evaluation_metadata.triggered_rule_id).toBe('rule_a_deny');
  });
});
