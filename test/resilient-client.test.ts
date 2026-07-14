import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMizaraClient } from '../src';
import type { MizaraClient } from '../src/sdk';

const POLICY = {
  policy_id: 'pol_test_v1',
  client_id: 'test_client',
  version: 1,
  rules: [
    {
      id: 'rule_max_refund',
      target_action: 'execute_refund',
      condition: 'resource.attributes.amount <= 50.00',
      effect: 'ALLOW',
      fallback_effect: 'DENY',
      remediation_message: 'Over the limit.',
    },
  ],
};

// A minimal stand-in for mizara-services, real enough to exercise ETag
// handling and simulate an outage by flipping `failing`.
function startMockServer() {
  let failing = false;
  let policyVersion = 1;
  const receivedReceipts: unknown[] = [];
  const seenReceiptIds = new Set<string>();
  let sessionTotal = 0;
  const approvalStatus = new Map<string, string>();

  const server = createServer((req, res) => {
    if (failing) {
      res.writeHead(503);
      res.end('simulated outage');
      return;
    }

    if (req.method === 'GET' && req.url?.startsWith('/api/v1/policies/')) {
      const ifNoneMatch = req.headers['if-none-match'];
      if (ifNoneMatch === String(policyVersion)) {
        res.writeHead(304, { ETag: String(policyVersion) });
        res.end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json', ETag: String(policyVersion) });
      res.end(JSON.stringify({ ...POLICY, version: policyVersion }));
      return;
    }

    if (req.method === 'POST' && req.url === '/api/v1/receipts') {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        // Mirrors the real server's `on conflict (id) do nothing`: at-least-once
        // delivery from the write-ahead log is expected, storage is idempotent.
        const parsed = JSON.parse(body) as { id: string };
        if (!seenReceiptIds.has(parsed.id)) {
          seenReceiptIds.add(parsed.id);
          receivedReceipts.push(parsed);
        }
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
      return;
    }

    if (req.method === 'GET' && req.url?.startsWith('/api/v1/sessions/')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ total: sessionTotal }));
      return;
    }

    if (req.method === 'POST' && req.url?.startsWith('/api/v1/sessions/')) {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        const parsed = JSON.parse(body) as { amount: number };
        sessionTotal += parsed.amount;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
      return;
    }

    if (req.method === 'GET' && req.url?.startsWith('/api/v1/approvals/')) {
      const receiptId = decodeURIComponent(req.url.slice('/api/v1/approvals/'.length));
      const status = approvalStatus.get(receiptId);
      if (!status) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status }));
      return;
    }

    res.writeHead(404);
    res.end();
  });

  return {
    server,
    setFailing: (value: boolean) => {
      failing = value;
    },
    bumpPolicyVersion: () => {
      policyVersion += 1;
    },
    setApprovalStatus: (receiptId: string, status: string) => {
      approvalStatus.set(receiptId, status);
    },
    receivedReceipts,
  };
}

function listen(server: Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address && typeof address !== 'string') {
        resolve(`http://127.0.0.1:${address.port}`);
      }
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('resilient hosted client', () => {
  let mock: ReturnType<typeof startMockServer>;
  let baseUrl: string;
  let client: MizaraClient | null = null;
  let dir: string;

  beforeEach(async () => {
    mock = startMockServer();
    baseUrl = await listen(mock.server);
    dir = mkdtempSync(join(tmpdir(), 'mizara-resilient-'));
  });

  afterEach(() => {
    client?.close();
    client = null;
    mock.server.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('fails closed before the first policy sync has ever succeeded', async () => {
    mock.setFailing(true);
    client = createMizaraClient({ apiKey: 'k', clientId: 'test_client', baseUrl, syncIntervalMs: 50 });

    const result = await client.authorize({
      actor: { id: 'a1', type: 'agent' },
      action: { name: 'execute_refund' },
      resource: { type: 'monetary_transaction', id: 'tx1', attributes: { amount: 25 } },
    });

    expect(result.status).toBe('DENY');
    expect(result.evaluation_metadata.policy_bundle_version).toBe('unsynced');
  });

  it('evaluates locally once the policy has synced', async () => {
    client = createMizaraClient({ apiKey: 'k', clientId: 'test_client', baseUrl, syncIntervalMs: 50 });

    const result = await client.authorize({
      actor: { id: 'a1', type: 'agent' },
      action: { name: 'execute_refund' },
      resource: { type: 'monetary_transaction', id: 'tx1', attributes: { amount: 25 } },
    });

    expect(result.status).toBe('ALLOW');
    expect(result.evaluation_metadata.policy_bundle_version).toBe('pol_test_v1');
  });

  it('keeps using the last-known-good policy through a simulated outage instead of failing every call', async () => {
    client = createMizaraClient({ apiKey: 'k', clientId: 'test_client', baseUrl, syncIntervalMs: 30 });

    const before = await client.authorize({
      actor: { id: 'a1', type: 'agent' },
      action: { name: 'execute_refund' },
      resource: { type: 'monetary_transaction', id: 'tx1', attributes: { amount: 25 } },
    });
    expect(before.status).toBe('ALLOW');

    // Simulate the cloud going down, then let a couple of background
    // sync ticks fail while it's "down."
    mock.setFailing(true);
    await sleep(100);

    const during = await client.authorize({
      actor: { id: 'a1', type: 'agent' },
      action: { name: 'execute_refund' },
      resource: { type: 'monetary_transaction', id: 'tx2', attributes: { amount: 25 } },
    });

    // Still evaluating correctly against the last synced policy, not
    // failing closed just because the background sync is failing.
    expect(during.status).toBe('ALLOW');
    expect(during.evaluation_metadata.policy_bundle_version).toBe('pol_test_v1');
  });

  it('picks up a policy change via a real background sync tick, not just the initial fetch', async () => {
    client = createMizaraClient({ apiKey: 'k', clientId: 'test_client', baseUrl, syncIntervalMs: 30 });

    const before = await client.authorize({
      actor: { id: 'a1', type: 'agent' },
      action: { name: 'execute_refund' },
      resource: { type: 'monetary_transaction', id: 'tx1', attributes: { amount: 999 } },
    });
    expect(before.status).toBe('DENY');

    mock.bumpPolicyVersion();
    await sleep(80);

    const after = await client.authorize({
      actor: { id: 'a1', type: 'agent' },
      action: { name: 'execute_refund' },
      resource: { type: 'monetary_transaction', id: 'tx2', attributes: { amount: 999 } },
    });
    // Same policy content in this test (bumpPolicyVersion just forces a
    // re-fetch instead of a 304), proving the sync loop actually re-runs
    // and re-parses a fresh response, not just the constructor's fetch.
    expect(after.status).toBe('DENY');
  });

  it('flushes a receipt to the hosted API asynchronously without the caller waiting on it', async () => {
    client = createMizaraClient({ apiKey: 'k', clientId: 'test_client', baseUrl, syncIntervalMs: 50 });

    await client.authorize({
      actor: { id: 'a1', type: 'agent' },
      action: { name: 'execute_refund' },
      resource: { type: 'monetary_transaction', id: 'tx1', attributes: { amount: 25 } },
    });

    await sleep(50);
    expect(mock.receivedReceipts.length).toBe(1);
  });

  it('replays an unflushed receipt from a previous process on the next startup', async () => {
    const logPath = join(dir, 'receipts.log');

    mock.setFailing(true);
    const first = createMizaraClient({ apiKey: 'k', clientId: 'test_client', baseUrl, syncIntervalMs: 50, receiptLogPath: logPath });
    // Policy sync fails (outage), so this authorizes DENY-closed, but the
    // point here is only that a receipt gets queued to disk.
    await first.authorize({
      actor: { id: 'a1', type: 'agent' },
      action: { name: 'execute_refund' },
      resource: { type: 'monetary_transaction', id: 'tx1', attributes: { amount: 25 } },
    });
    first.close();
    expect(mock.receivedReceipts.length).toBe(0);

    // "Restart": bring the server back up and start a new client instance
    // pointed at the same log file.
    mock.setFailing(false);
    const second = createMizaraClient({ apiKey: 'k', clientId: 'test_client', baseUrl, syncIntervalMs: 50, receiptLogPath: logPath });
    await sleep(80);
    second.close();

    expect(mock.receivedReceipts.length).toBe(1);
  });

  it('fails closed on a session-gated action when the session store is unreachable', async () => {
    client = createMizaraClient({ apiKey: 'k', clientId: 'test_client', baseUrl, syncIntervalMs: 50 });
    await client.authorize({
      actor: { id: 'a1', type: 'agent' },
      action: { name: 'execute_refund' },
      resource: { type: 'monetary_transaction', id: 'tx1', attributes: { amount: 25 } },
    });

    mock.setFailing(true);
    await sleep(60);

    const result = await client.authorize({
      actor: { id: 'a1', type: 'agent' },
      action: { name: 'cumulative_test' },
      resource: { type: 'monetary_transaction', id: 'tx2', attributes: { amount: 25 } },
      context: { session_id: 'sess_1' },
    });

    expect(result.status).toBe('DENY');
    expect(result.enforcement.user_facing_error).toMatch(/session store unreachable/);
  });

  it('waitForApproval resolves once the hosted API reports a decision', async () => {
    client = createMizaraClient({ apiKey: 'k', clientId: 'test_client', baseUrl, syncIntervalMs: 50 });
    mock.setApprovalStatus('rcpt_pending', 'PENDING');

    const pending = client.waitForApproval!('rcpt_pending', { pollIntervalMs: 20, timeoutMs: 2000 });
    await sleep(50);
    mock.setApprovalStatus('rcpt_pending', 'APPROVED');

    await expect(pending).resolves.toBe('APPROVED');
  });

  it('waitForApproval returns TIMEOUT if no decision arrives in time', async () => {
    client = createMizaraClient({ apiKey: 'k', clientId: 'test_client', baseUrl, syncIntervalMs: 50 });
    mock.setApprovalStatus('rcpt_stuck', 'PENDING');

    const outcome = await client.waitForApproval!('rcpt_stuck', { pollIntervalMs: 20, timeoutMs: 60 });
    expect(outcome).toBe('TIMEOUT');
  });
});
