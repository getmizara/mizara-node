import { readFileSync } from 'node:fs';
import { resolveRule } from '../engine/decision-engine';
import { createReceipt } from '../receipts/receipt';
import type { AuthorizeInput, AuthorizeResult, Policy } from '../types';

export interface MizaraClientOptions {
  policy?: Policy;
  policyPath?: string;
}

export interface MizaraClient {
  authorize(input: AuthorizeInput): Promise<AuthorizeResult>;
}

export function createMizaraClient(options: MizaraClientOptions): MizaraClient {
  const policy = options.policy ?? loadPolicyFromFile(options.policyPath);

  return {
    async authorize(input: AuthorizeInput): Promise<AuthorizeResult> {
      const startedAt = performance.now();

      const match = resolveRule(input, policy);
      // Fail closed: if no rule matches the action, the action is denied.
      const status = match?.status ?? 'DENY';
      const executionTimeMs = performance.now() - startedAt;

      const receipt = createReceipt({
        input,
        status,
        triggeredRuleId: match?.rule.id ?? null,
      });

      return {
        status,
        evaluation_metadata: {
          triggered_rule_id: match?.rule.id ?? null,
          policy_bundle_version: policy.policy_id,
          execution_time_ms: Number(executionTimeMs.toFixed(3)),
        },
        enforcement: {
          action_halted: status === 'DENY',
          user_facing_error: status === 'DENY' ? (match?.rule.remediation_message ?? null) : null,
        },
        cryptographic_receipt: receipt,
      };
    },
  };
}

function loadPolicyFromFile(path?: string): Policy {
  if (!path) {
    throw new Error('createMizaraClient requires either `policy` or `policyPath`');
  }
  const raw = readFileSync(path, 'utf-8');
  return JSON.parse(raw) as Policy;
}
