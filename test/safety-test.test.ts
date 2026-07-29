import { describe, expect, it } from 'vitest';
import { SCENARIOS, runSafetyTest } from '../src/cli/safety-test';
import type { Policy } from '../src/types';

describe('safety test', () => {
  it('has unique scenario ids', () => {
    const ids = SCENARIOS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('reports uncovered actions as default-denied with no triggered rule', () => {
    const policy: Policy = { policy_id: 'pol_empty', client_id: 'test', rules: [] };
    const results = runSafetyTest(policy);

    expect(results).toHaveLength(SCENARIOS.length);
    for (const result of results) {
      expect(result.status).toBe('DENY');
      expect(result.verdict).toBe('DEFAULT-DENIED');
      expect(result.triggeredRuleId).toBeNull();
    }
  });

  it('reports an explicit matching rule as protected', () => {
    const policy: Policy = {
      policy_id: 'pol_protected',
      client_id: 'test',
      rules: [
        {
          id: 'rule_block_prod_terminate',
          target_action: 'terminate_compute_instance',
          condition: "resource.attributes.environment == 'production'",
          effect: 'DENY',
          fallback_effect: 'ALLOW',
        },
      ],
    };
    const results = runSafetyTest(policy);
    const protectedResult = results.find((r) => r.scenario.id === 'production_infra_change')!;

    expect(protectedResult.status).toBe('DENY');
    expect(protectedResult.verdict).toBe('PROTECTED');
    expect(protectedResult.triggeredRuleId).toBe('rule_block_prod_terminate');
  });

  it('reports a rule that falls through to allow as fail', () => {
    const policy: Policy = {
      policy_id: 'pol_gap',
      client_id: 'test',
      rules: [
        {
          id: 'rule_high_instance_count_only',
          target_action: 'provision_compute_cluster',
          condition: 'resource.attributes.instance_count > 999999',
          effect: 'DENY',
          fallback_effect: 'ALLOW',
        },
      ],
    };
    const results = runSafetyTest(policy);
    const gap = results.find((r) => r.scenario.id === 'large_scale_provisioning')!;

    expect(gap.status).toBe('ALLOW');
    expect(gap.verdict).toBe('FAIL');
  });
});
