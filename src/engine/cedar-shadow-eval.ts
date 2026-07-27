// /nodejs: the package's bare "." export is ESM-only.
import * as cedar from '@cedar-policy/cedar-wasm/nodejs';
import type { AuthorizationStatus, AuthorizeInput, Policy, PolicyRule } from '../types';
import { compileConditionToCedar } from './cedar-compiler';

export interface CedarCompilation {
  cedarPolicyText: string;
  compiledRuleIds: string[];
  skippedRules: { ruleId: string; reason: string }[];
}

// Cedar is binary (permit/forbid); a rule's ALLOW branch compiles to
// permit, any other status to forbid, since forbid always overrides
// permit - matching Mizara's max-severity resolution. Both branches
// share one condition, so an uncompilable condition skips the rule.
function compileRule(rule: PolicyRule): { cedarPolicies: string[] } | { skippedReason: string } {
  const scope = rule.target_action === 'any' ? 'action' : `action == Mizara::Action::${JSON.stringify(rule.target_action)}`;
  const condition = compileConditionToCedar(rule.condition);
  if (condition === null) return { skippedReason: 'condition not expressible in Cedar' };

  const effectKeyword = rule.effect === 'ALLOW' ? 'permit' : 'forbid';
  const fallbackKeyword = rule.fallback_effect === 'ALLOW' ? 'permit' : 'forbid';

  return {
    cedarPolicies: [
      `${effectKeyword}(principal, ${scope}, resource) when { ${condition} };`,
      `${fallbackKeyword}(principal, ${scope}, resource) when { !(${condition}) };`,
    ],
  };
}

export function compilePolicyToCedar(policy: Policy): CedarCompilation {
  const compiledRuleIds: string[] = [];
  const skippedRules: { ruleId: string; reason: string }[] = [];
  const policies: string[] = [];

  for (const rule of policy.rules) {
    const result = compileRule(rule);
    if ('skippedReason' in result) {
      skippedRules.push({ ruleId: rule.id, reason: result.skippedReason });
    } else {
      compiledRuleIds.push(rule.id);
      policies.push(...result.cedarPolicies);
    }
  }

  return { cedarPolicyText: policies.join('\n'), compiledRuleIds, skippedRules };
}

// Entity attributes must be supplied via the `entities` list, keyed by
// the same {type, id} the request references - extra keys placed
// directly on principal/resource in the request itself are ignored.
function entityAttrs(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') return {};
  const attrs = { ...(value as Record<string, unknown>) };
  delete attrs.id;
  return attrs;
}

function buildCedarRequest(input: AuthorizeInput) {
  const principalUid = { type: 'Mizara::Actor', id: input.actor.id };
  const resourceUid = { type: 'Mizara::Resource', id: input.resource.id };

  return {
    request: {
      principal: principalUid,
      action: { type: 'Mizara::Action', id: input.action.name },
      resource: resourceUid,
      context: input.context ?? {},
    },
    entities: [
      { uid: principalUid, attrs: entityAttrs(input.actor), parents: [] },
      { uid: resourceUid, attrs: entityAttrs(input.resource), parents: [] },
    ],
  };
}

export interface ShadowComparisonResult {
  ran: boolean;
  agreed?: boolean;
  cedarDecision?: 'allow' | 'deny';
  mizaraAllowed?: boolean;
  cedarErrors?: string[];
  skippedRules?: { ruleId: string; reason: string }[];
}

// Runs the compiled Cedar policy set against input already evaluated by
// the real (jsep) engine, for comparison only - never used to decide.
export function runShadowComparison(
  policy: Policy,
  input: AuthorizeInput,
  mizaraStatus: AuthorizationStatus,
): ShadowComparisonResult {
  const compilation = compilePolicyToCedar(policy);
  if (compilation.compiledRuleIds.length === 0) {
    return { ran: false, skippedRules: compilation.skippedRules };
  }

  try {
    const { request, entities } = buildCedarRequest(input);
    const answer = cedar.isAuthorized({
      ...request,
      policies: { staticPolicies: compilation.cedarPolicyText },
      entities,
      // AuthorizeContext's values are plain JSON at runtime; Cedar's
      // Context type is just narrower than `unknown`.
    } as unknown as cedar.AuthorizationCall);

    if (answer.type === 'failure') {
      return { ran: true, cedarErrors: answer.errors.map((e) => e.message), skippedRules: compilation.skippedRules };
    }

    const cedarDecision = answer.response.decision;
    const mizaraAllowed = mizaraStatus === 'ALLOW';
    const errors = answer.response.diagnostics.errors.map((e) => e.error.message);

    return {
      ran: true,
      agreed: (cedarDecision === 'allow') === mizaraAllowed,
      cedarDecision,
      mizaraAllowed,
      cedarErrors: errors.length > 0 ? errors : undefined,
      skippedRules: compilation.skippedRules,
    };
  } catch (err) {
    return { ran: true, cedarErrors: [err instanceof Error ? err.message : String(err)], skippedRules: compilation.skippedRules };
  }
}
