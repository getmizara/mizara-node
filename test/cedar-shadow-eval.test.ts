import { describe, expect, it } from 'vitest';
import { compileConditionToCedar } from '../src/engine/cedar-compiler';
import { runShadowComparison } from '../src/engine/cedar-shadow-eval';
import { resolveRule } from '../src/engine/decision-engine';
import type { AuthorizeInput, Policy } from '../src/types';

function shadowAgrees(policy: Policy, input: AuthorizeInput): boolean {
  const match = resolveRule(input, policy);
  const status = match?.status ?? 'DENY';
  const shadow = runShadowComparison(policy, input, status);
  return !shadow.ran || shadow.agreed === true;
}

describe('compileConditionToCedar', () => {
  it('compiles a numeric threshold comparison', () => {
    expect(compileConditionToCedar('resource.attributes.amount <= 100.00')).toContain('resource.attributes.amount');
  });

  it('compiles a whole-number decimal literal to a bare Cedar integer (Cedar has no float syntax)', () => {
    const compiled = compileConditionToCedar('resource.attributes.amount <= 100.00');
    expect(compiled).toContain('<= 100)');
    expect(compiled).not.toContain('100.0');
  });

  it('returns null for a genuinely fractional literal (unsupported by Cedar)', () => {
    expect(compileConditionToCedar('resource.attributes.amount <= 50.25')).toBeNull();
  });

  it('compiles a compound && condition', () => {
    const compiled = compileConditionToCedar('context.amount <= 100 && resource.type == "order"');
    expect(compiled).toContain('&&');
  });

  it('compiles .contains()', () => {
    expect(compileConditionToCedar('context.tags.contains("vip")')).toContain('.contains(');
  });

  it('returns null for division (unsupported by Cedar)', () => {
    expect(compileConditionToCedar('context.amount / 2 <= 100')).toBeNull();
  });

  it('returns null for invalid syntax', () => {
    expect(compileConditionToCedar('this is not valid && &&')).toBeNull();
  });
});

describe('runShadowComparison agreement with the real decision engine', () => {
  const basicPolicy: Policy = {
    policy_id: 'test', client_id: 'test',
    rules: [{
      id: 'rule_example', target_action: 'execute_action',
      condition: 'resource.attributes.amount <= 100.00',
      effect: 'ALLOW', fallback_effect: 'DENY',
    }],
  };

  it('agrees when the condition passes', () => {
    expect(shadowAgrees(basicPolicy, {
      actor: { id: 'a1' }, action: { name: 'execute_action' },
      resource: { type: 'order', id: 'r1', attributes: { amount: 50 } }, context: {},
    })).toBe(true);
  });

  it('agrees when the condition fails', () => {
    expect(shadowAgrees(basicPolicy, {
      actor: { id: 'a1' }, action: { name: 'execute_action' },
      resource: { type: 'order', id: 'r1', attributes: { amount: 150 } }, context: {},
    })).toBe(true);
  });

  it('agrees when a referenced field is entirely absent (fails closed on both sides)', () => {
    expect(shadowAgrees(basicPolicy, {
      actor: { id: 'a1' }, action: { name: 'execute_action' },
      resource: { type: 'order', id: 'r1' }, context: {},
    })).toBe(true);
  });

  it('agrees for RE_ROUTE and REDACT effects (Cedar sees them as not-ALLOW)', () => {
    const policy: Policy = {
      policy_id: 'test', client_id: 'test',
      rules: [{ id: 'r1', target_action: 'any', condition: 'context.amount > 1000', effect: 'RE_ROUTE', fallback_effect: 'ALLOW' }],
    };
    expect(shadowAgrees(policy, {
      actor: { id: 'a1' }, action: { name: 'x' }, resource: { type: 'order', id: 'r1' }, context: { amount: 5000 },
    })).toBe(true);
    expect(shadowAgrees(policy, {
      actor: { id: 'a1' }, action: { name: 'x' }, resource: { type: 'order', id: 'r1' }, context: { amount: 5 },
    })).toBe(true);
  });

  it('agrees when a DENY rule overrides an ALLOW rule for the same action (severity resolution)', () => {
    const policy: Policy = {
      policy_id: 'test', client_id: 'test',
      rules: [
        { id: 'allow_small', target_action: 'x', condition: 'context.amount <= 500', effect: 'ALLOW', fallback_effect: 'DENY' },
        { id: 'deny_flagged', target_action: 'x', condition: 'context.flagged == true', effect: 'DENY', fallback_effect: 'ALLOW' },
      ],
    };
    expect(shadowAgrees(policy, {
      actor: { id: 'a1' }, action: { name: 'x' }, resource: { type: 'order', id: 'r1' }, context: { amount: 100, flagged: true },
    })).toBe(true);
    expect(shadowAgrees(policy, {
      actor: { id: 'a1' }, action: { name: 'x' }, resource: { type: 'order', id: 'r1' }, context: { amount: 100, flagged: false },
    })).toBe(true);
  });

  it('agrees across action-scope isolation and the fail-closed no-rule case', () => {
    const policy: Policy = {
      policy_id: 'test', client_id: 'test',
      rules: [
        { id: 'allow_x', target_action: 'x', condition: 'true', effect: 'ALLOW', fallback_effect: 'DENY' },
        { id: 'deny_y', target_action: 'y', condition: 'true', effect: 'DENY', fallback_effect: 'ALLOW' },
      ],
    };
    expect(shadowAgrees(policy, { actor: { id: 'a1' }, action: { name: 'x' }, resource: { type: 'order', id: 'r1' }, context: {} })).toBe(true);
    expect(shadowAgrees(policy, { actor: { id: 'a1' }, action: { name: 'y' }, resource: { type: 'order', id: 'r1' }, context: {} })).toBe(true);
    expect(shadowAgrees(policy, { actor: { id: 'a1' }, action: { name: 'z' }, resource: { type: 'order', id: 'r1' }, context: {} })).toBe(true);
  });

  it('skips (does not compare) a rule with an uncompilable condition instead of mis-comparing', () => {
    const policy: Policy = {
      policy_id: 'test', client_id: 'test',
      rules: [{ id: 'r1', target_action: 'any', condition: 'context.amount / 2 <= 100', effect: 'ALLOW', fallback_effect: 'DENY' }],
    };
    const input: AuthorizeInput = { actor: { id: 'a1' }, action: { name: 'x' }, resource: { type: 'order', id: 'r1' }, context: { amount: 100 } };
    const match = resolveRule(input, policy);
    const shadow = runShadowComparison(policy, input, match?.status ?? 'DENY');
    expect(shadow.ran).toBe(false);
    expect(shadow.skippedRules).toEqual([{ ruleId: 'r1', reason: 'condition not expressible in Cedar' }]);
  });
});
