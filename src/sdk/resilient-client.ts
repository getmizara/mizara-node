import { resolveRule } from '../engine/decision-engine';
import { createReceipt } from '../receipts/receipt';
import type { AuthorizeInput, AuthorizeResult, Policy } from '../types';
import { ReceiptLog } from './receipt-log';
import type { ApprovalOutcome, MizaraClient, WaitForApprovalOptions } from './index';

const DEFAULT_APPROVAL_POLL_MS = 3_000;
const DEFAULT_APPROVAL_TIMEOUT_MS = 25 * 60 * 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface ResilientClientOptions {
  apiKey: string;
  clientId: string;
  baseUrl: string;
  syncIntervalMs?: number;
  onSyncError?: (err: Error) => void;
  receiptLogPath?: string;
}

const DEFAULT_SYNC_INTERVAL_MS = 10_000;
const SYNC_FAILURE_WARNING_THRESHOLD = 3;

// Hosted mode, resilient by default: policy is fetched once and then
// refreshed in the background on an interval, so evaluation happens
// locally, in-process, the same as local mode. A Mizara outage degrades
// to "keep using the last policy successfully fetched," not "every
// authorize() call fails." Receipts are generated locally and flushed
// to the hosted API asynchronously, backed by a disk write-ahead log so
// a process crash between the decision and the flush doesn't lose one.
export function createResilientHostedClient(options: ResilientClientOptions): MizaraClient {
  const syncIntervalMs = options.syncIntervalMs ?? DEFAULT_SYNC_INTERVAL_MS;
  const receiptLog = options.receiptLogPath ? new ReceiptLog(options.receiptLogPath) : null;

  let policy: Policy | null = null;
  let policyVersion: string | null = null;
  let consecutiveSyncFailures = 0;

  async function syncPolicy(): Promise<void> {
    try {
      const headers: Record<string, string> = { Authorization: `Bearer ${options.apiKey}` };
      if (policyVersion) headers['If-None-Match'] = policyVersion;

      const res = await fetch(`${options.baseUrl}/api/v1/policies/${options.clientId}`, { headers });

      if (res.status === 304) {
        consecutiveSyncFailures = 0;
        return;
      }
      if (!res.ok) throw new Error(`policy sync failed with status ${res.status}`);

      const body = (await res.json()) as { policy_id: string; client_id: string; rules: Policy['rules']; version: number };
      policy = { policy_id: body.policy_id, client_id: body.client_id, rules: body.rules };
      policyVersion = String(body.version);
      consecutiveSyncFailures = 0;
    } catch (err) {
      consecutiveSyncFailures += 1;
      if (consecutiveSyncFailures === SYNC_FAILURE_WARNING_THRESHOLD) {
        options.onSyncError?.(err instanceof Error ? err : new Error(String(err)));
      }
    }
  }

  async function flushReceipt(receiptId: string, payload: Record<string, unknown>): Promise<void> {
    try {
      const res = await fetch(`${options.baseUrl}/api/v1/receipts`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${options.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) receiptLog?.appendAck(receiptId);
    } catch {
      // Stays unacked in the log; retried on the next sweep or the next process start.
    }
  }

  async function fetchSessionTotal(sessionId: string): Promise<number | null> {
    try {
      const res = await fetch(`${options.baseUrl}/api/v1/sessions/${encodeURIComponent(sessionId)}`, {
        headers: { Authorization: `Bearer ${options.apiKey}` },
      });
      if (!res.ok) throw new Error(`session lookup failed with status ${res.status}`);
      const body = (await res.json()) as { total: number };
      return body.total;
    } catch {
      return null;
    }
  }

  function incrementSessionTotal(sessionId: string, amount: number): void {
    fetch(`${options.baseUrl}/api/v1/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${options.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount }),
    }).catch(() => {});
  }

  function retrySweep(): void {
    if (!receiptLog) return;
    for (const queued of receiptLog.loadUnacked()) {
      void flushReceipt(queued.receiptId, queued.payload);
    }
  }

  // Replay anything a previous, crashed process never finished flushing.
  retrySweep();

  const initialSync = syncPolicy();
  const syncTimer = setInterval(() => void syncPolicy(), syncIntervalMs);
  const retryTimer = receiptLog ? setInterval(retrySweep, syncIntervalMs) : null;
  if (typeof syncTimer.unref === 'function') syncTimer.unref();
  if (retryTimer && typeof retryTimer.unref === 'function') retryTimer.unref();

  // Every decision gets queued and flushed the same way, including a
  // fail-closed DENY - those are often the ones worth auditing most
  // (e.g. "why did this get denied at 3am" -> "policy hadn't synced
  // yet"), so they can't be the one case that's silently unrecorded.
  // The input is included alongside the result, matching what the
  // synchronous hosted endpoint stores, since a receipt with no record
  // of what was being decided can't support a human approval review.
  function queueAndFlush(policyBundleVersion: string, input: AuthorizeInput, result: AuthorizeResult): void {
    const receiptPayload = {
      id: result.cryptographic_receipt.id,
      policy_id: policyBundleVersion,
      status: result.status,
      triggered_rule_id: result.evaluation_metadata.triggered_rule_id,
      hash: result.cryptographic_receipt.hash,
      signature: result.cryptographic_receipt.signature,
      payload: { input, result },
    };

    receiptLog?.appendPending({ receiptId: result.cryptographic_receipt.id, payload: receiptPayload });
    void flushReceipt(result.cryptographic_receipt.id, receiptPayload);
  }

  function denyClosed(input: AuthorizeInput, message: string, policyBundleVersion: string): AuthorizeResult {
    const receipt = createReceipt({ input, status: 'DENY', triggeredRuleId: null });
    const result: AuthorizeResult = {
      status: 'DENY',
      evaluation_metadata: { triggered_rule_id: null, policy_bundle_version: policyBundleVersion, execution_time_ms: 0 },
      enforcement: { action_halted: true, user_facing_error: message },
      cryptographic_receipt: receipt,
    };
    queueAndFlush(policyBundleVersion, input, result);
    return result;
  }

  return {
    async authorize(input: AuthorizeInput): Promise<AuthorizeResult> {
      await initialSync;

      const enriched: AuthorizeInput = { ...input, context: { client_id: options.clientId, ...input.context } };

      if (!policy) {
        return denyClosed(enriched, 'Mizara policy has not been loaded yet.', 'unsynced');
      }

      const sessionId = typeof enriched.context?.session_id === 'string' ? enriched.context.session_id : null;
      let sessionTotal: number | null = null;

      if (sessionId) {
        sessionTotal = await fetchSessionTotal(sessionId);
        if (sessionTotal === null) {
          // Fail closed: a session-gated rule cannot be safely evaluated
          // without the centralized session store it depends on.
          return denyClosed(
            enriched,
            'Session-gated policy could not be evaluated: session store unreachable.',
            policy.policy_id,
          );
        }
      }

      const evaluatedInput: AuthorizeInput = sessionId
        ? { ...enriched, context: { ...enriched.context, session_total: sessionTotal } }
        : enriched;

      const startedAt = performance.now();
      const match = resolveRule(evaluatedInput, policy);
      const status = match?.status ?? 'DENY';
      const executionTimeMs = performance.now() - startedAt;
      const receipt = createReceipt({ input: evaluatedInput, status, triggeredRuleId: match?.rule.id ?? null });

      const result: AuthorizeResult = {
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

      if (sessionId && status === 'ALLOW') {
        const amount = evaluatedInput.resource?.attributes?.amount;
        if (typeof amount === 'number') incrementSessionTotal(sessionId, amount);
      }

      queueAndFlush(policy.policy_id, evaluatedInput, result);

      return result;
    },

    // Polls the hosted API for a RE_ROUTE decision's approval outcome.
    // Meaningful only in hosted mode: local mode has no server to hold
    // pending state, so a RE_ROUTE there is just a decision, not an
    // approval workflow with someone on the other end of it.
    async waitForApproval(receiptId: string, waitOptions?: WaitForApprovalOptions): Promise<ApprovalOutcome> {
      const pollIntervalMs = waitOptions?.pollIntervalMs ?? DEFAULT_APPROVAL_POLL_MS;
      const timeoutMs = waitOptions?.timeoutMs ?? DEFAULT_APPROVAL_TIMEOUT_MS;
      const deadline = Date.now() + timeoutMs;

      while (Date.now() < deadline) {
        try {
          const res = await fetch(`${options.baseUrl}/api/v1/approvals/${encodeURIComponent(receiptId)}`, {
            headers: { Authorization: `Bearer ${options.apiKey}` },
          });
          if (res.ok) {
            const body = (await res.json()) as { status: string };
            if (body.status === 'APPROVED' || body.status === 'DENIED') return body.status;
          }
        } catch {
          // Transient network failure: keep polling until the deadline.
        }
        await sleep(pollIntervalMs);
      }

      return 'TIMEOUT';
    },

    close(): void {
      clearInterval(syncTimer);
      if (retryTimer) clearInterval(retryTimer);
      receiptLog?.compact();
    },
  };
}
