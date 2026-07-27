import jsep from 'jsep';

const VALID_EFFECTS = ['ALLOW', 'DENY', 'REDACT', 'RE_ROUTE'];

export function validatePolicy(policy: unknown): string[] {
  const errors: string[] = [];

  if (typeof policy !== 'object' || policy === null) {
    return ['policy must be a JSON object'];
  }

  const p = policy as Record<string, unknown>;

  if (typeof p.policy_id !== 'string') errors.push('policy_id must be a string');
  if (typeof p.client_id !== 'string') errors.push('client_id must be a string');

  if (!Array.isArray(p.rules)) {
    errors.push('rules must be an array');
    return errors;
  }

  p.rules.forEach((rule: unknown, index: number) => {
    const r = rule as Record<string, unknown>;
    const prefix = `rules[${index}]`;

    if (typeof r.id !== 'string') errors.push(`${prefix}.id must be a string`);
    if (typeof r.target_action !== 'string') errors.push(`${prefix}.target_action must be a string`);

    if (typeof r.condition !== 'string') {
      errors.push(`${prefix}.condition must be a string`);
    } else {
      try {
        jsep(r.condition);
      } catch (err) {
        errors.push(`${prefix}.condition is not valid: ${(err as Error).message}`);
      }
    }

    if (!VALID_EFFECTS.includes(r.effect as string)) {
      errors.push(`${prefix}.effect must be one of: ${VALID_EFFECTS.join(', ')}`);
    }
    if (!VALID_EFFECTS.includes(r.fallback_effect as string)) {
      errors.push(`${prefix}.fallback_effect must be one of: ${VALID_EFFECTS.join(', ')}`);
    }
  });

  return errors;
}
