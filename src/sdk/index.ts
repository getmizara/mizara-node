import { readFileSync } from 'node:fs';
import { resolveRule } from '../engine/decision-engine';
import { createReceipt } from '../receipts/receipt';
import type { AuthorizeInput, AuthorizeResult, Policy } from '../types';

const HOSTED_URL = 'https://mizara-services.vercel.app';

export interface MizaraClientOptions {
  // Local mode: provide a policy file path or a pre-loaded Policy object
  policy?: Policy;
  policyPath?: string;
  // Hosted mode: provide an API key from mizara.ai/signup
  apiKey?: string;
  clientId?: string;
  baseUrl?: string;
}

export interface MizaraClient {
  authorize(input: AuthorizeInput): Promise<AuthorizeResult>;
}

export function createMizaraClient(options: MizaraClientOptions): MizaraClient {
  if (options.apiKey) {
    if (!options.clientId) {
      throw new Error('createMizaraClient with apiKey requires clientId');
    }
    return createHostedClient(options.apiKey, options.clientId, options.baseUrl);
  }

  const policy = options.policy ?? loadPolicyFromFile(options.policyPath);
  return createLocalClient(policy);
}

function createLocalClient(policy: Policy): MizaraClient {
  return {
    async authorize(input: AuthorizeInput): Promise<AuthorizeResult> {
      const startedAt = performance.now();
      const match = resolveRule(input, policy);
      const status = match?.status ?? 'DENY';
      const executionTimeMs = performance.now() - startedAt;
      const receipt = createReceipt({ input, status, triggeredRuleId: match?.rule.id ?? null });

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

function createHostedClient(apiKey: string, clientId: string, baseUrl?: string): MizaraClient {
  const endpoint = `${baseUrl ?? HOSTED_URL}/api/v1/authorize`;

  return {
    async authorize(input: AuthorizeInput): Promise<AuthorizeResult> {
      // Auto-populate context.client_id so callers don't need to set it manually
      const enriched: AuthorizeInput = {
        ...input,
        context: { client_id: clientId, ...input.context },
      };

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(enriched),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(`Mizara API error ${response.status}: ${err.error ?? response.statusText}`);
      }

      return response.json() as Promise<AuthorizeResult>;
    },
  };
}

function loadPolicyFromFile(path?: string): Policy {
  if (!path) {
    throw new Error('createMizaraClient requires apiKey, policy, or policyPath');
  }
  const raw = readFileSync(path, 'utf-8');
  return JSON.parse(raw) as Policy;
}
