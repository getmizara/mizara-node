import type { AuthorizationStatus, AuthorizeInput, Policy, PolicyRule } from '../types';
import { evaluateCondition } from './evaluator';

export interface RuleMatch {
  rule: PolicyRule;
  status: AuthorizationStatus;
}

// Resolves to the first rule (in array order) whose target_action matches
// ("any" or an exact action.name match). Only one rule is evaluated per
// action name; its condition decides between `effect` and `fallback_effect`.
export function resolveRule(input: AuthorizeInput, policy: Policy): RuleMatch | null {
  for (const rule of policy.rules) {
    const matchesAction = rule.target_action === 'any' || rule.target_action === input.action.name;
    if (!matchesAction) continue;

    const conditionMet = evaluateCondition(rule.condition, input);
    return {
      rule,
      status: conditionMet ? rule.effect : rule.fallback_effect,
    };
  }
  return null;
}
