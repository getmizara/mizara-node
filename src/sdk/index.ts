import { readFileSync } from 'node:fs';
import { resolveRule } from '../engine/decision-engine';
import { createReceipt } from '../receipts/receipt';
import type { AuthorizeInput, AuthorizeResult, Policy } from '../types';
import { createResilientHostedClient } from './resilient-client';
import { runShadowComparison, type ShadowComparisonResult } from '../engine/cedar-shadow-eval';

const HOSTED_URL = 'https://mizara-services.vercel.app';

export interface MizaraClientOptions {
  // Local mode: provide a policy file path or a pre-loaded Policy object
  policy?: Policy;
  policyPath?: string;
  // Hosted mode: provide an API key from mizara.ai/signup
  apiKey?: string;
  clientId?: string;
  baseUrl?: string;
  // Hosted mode only: background policy sync interval (default 10000ms)
  syncIntervalMs?: number;
  // Hosted mode only: called after 3 consecutive failed policy syncs
  onSyncError?: (err: Error) => void;
  // Hosted mode only: path to a local file backing the receipt delivery
  // queue, so a process crash between a decision and its async flush to
  // the hosted API doesn't lose the receipt. Omit to run in-memory only.
  receiptLogPath?: string;
  // Local mode only, opt-in: after each decision, also evaluates the
  // policy through Cedar and reports whether it agreed. Never used to
  // make the actual decision. Omit for zero added cost.
  onCedarShadowComparison?: (result: ShadowComparisonResult, input: AuthorizeInput) => void | Promise<void>;
}

export type ApprovalOutcome = 'APPROVED' | 'DENIED' | 'TIMEOUT';

export interface WaitForApprovalOptions {
  // How often to poll the hosted API, in ms. Default 3000.
  pollIntervalMs?: number;
  // How long to poll before giving up and returning 'TIMEOUT', in ms.
  // Default 25 minutes, just under the server's 30-minute approval window.
  timeoutMs?: number;
}

export interface MizaraClient {
  authorize(input: AuthorizeInput): Promise<AuthorizeResult>;
  // Blocks until a RE_ROUTE decision's receipt is approved or denied, or
  // the timeout elapses. Only present in hosted mode; local-mode clients
  // have no server to poll.
  waitForApproval?(receiptId: string, options?: WaitForApprovalOptions): Promise<ApprovalOutcome>;
  // Stops any background sync/flush timers. Safe to call on any client;
  // a no-op in local mode. Call before process exit so nothing keeps a
  // short-lived process (a script, a test run) alive.
  close(): void;
}

export function createMizaraClient(options: MizaraClientOptions): MizaraClient {
  if (options.apiKey) {
    if (!options.clientId) {
      throw new Error('createMizaraClient with apiKey requires clientId');
    }
    return createResilientHostedClient({
      apiKey: options.apiKey,
      clientId: options.clientId,
      baseUrl: options.baseUrl ?? HOSTED_URL,
      syncIntervalMs: options.syncIntervalMs,
      onSyncError: options.onSyncError,
      receiptLogPath: options.receiptLogPath,
    });
  }

  const policy = options.policy ?? loadPolicyFromFile(options.policyPath);
  return createLocalClient(policy, options.onCedarShadowComparison);
}

function createLocalClient(
  policy: Policy,
  onCedarShadowComparison?: (result: ShadowComparisonResult, input: AuthorizeInput) => void | Promise<void>,
): MizaraClient {
  return {
    async authorize(input: AuthorizeInput): Promise<AuthorizeResult> {
      const startedAt = performance.now();
      const match = resolveRule(input, policy);
      const status = match?.status ?? 'DENY';
      const executionTimeMs = performance.now() - startedAt;
      const receipt = createReceipt({ input, status, triggeredRuleId: match?.rule.id ?? null });

      if (onCedarShadowComparison) {
        try {
          const shadowResult = runShadowComparison(policy, input, status);
          Promise.resolve(onCedarShadowComparison(shadowResult, input)).catch(() => {});
        } catch {
          // Shadow comparison is instrumentation, not the decision path -
          // a bug in it must never affect the real authorize() result.
        }
      }

      return {
        status,
        evaluation_metadata: {
          triggered_rule_id: match?.rule.id ?? null,
          policy_bundle_version: policy.policy_id,
          policy_version: policy.version ?? null,
          execution_time_ms: Number(executionTimeMs.toFixed(3)),
        },
        enforcement: {
          action_halted: status === 'DENY',
          user_facing_error: status === 'DENY' ? (match?.rule.remediation_message ?? null) : null,
        },
        cryptographic_receipt: receipt,
      };
    },
    close(): void {
      // No background work to stop in local mode.
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
