import type { AuthorizationStatus, AuthorizeInput, Policy, PolicyRule } from '../types';
import { evaluateCondition } from './evaluator';

export interface RuleMatch {
  rule: PolicyRule;
  status: AuthorizationStatus;
}

const SEVERITY: Record<AuthorizationStatus, number> = {
  DENY: 3,
  RE_ROUTE: 2,
  REDACT: 1,
  ALLOW: 0,
};

// Evaluates every rule matching the action ("any" or an exact name match)
// and returns the most restrictive outcome. Ties keep the earlier rule.
export function resolveRule(input: AuthorizeInput, policy: Policy): RuleMatch | null {
  let best: RuleMatch | null = null;

  for (const rule of policy.rules) {
    const matchesAction = rule.target_action === 'any' || rule.target_action === input.action.name;
    if (!matchesAction) continue;

    const conditionMet = evaluateCondition(rule.condition, input);
    const status = conditionMet ? rule.effect : rule.fallback_effect;

    if (!best || SEVERITY[status] > SEVERITY[best.status]) {
      best = { rule, status };
    }
  }

  return best;
}
