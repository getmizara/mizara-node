<p align="center">
  <img src="assets/logo-banner.svg" width="340" alt="mizara">
</p>

<h1 align="center">Mizara SDK for Node.js</h1>

<p align="center">
  <a href="https://github.com/getmizara/mizara-node/actions/workflows/ci.yml"><img src="https://github.com/getmizara/mizara-node/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://www.npmjs.com/package/@mizara/sdk"><img src="https://img.shields.io/npm/v/%40mizara%2Fsdk?color=cb3837" alt="npm"></a>
  <a href="LICENSE.md"><img src="https://img.shields.io/badge/license-Apache%202.0-blue" alt="License"></a>
</p>

Authorization layer for AI agents. Call `authorize()` before any consequential action. Sub-2ms evaluation, policy-as-data, cryptographic receipt on every decision.

Also available for Python: [`pip install mizara`](https://github.com/getmizara/mizara-python)

## Install

```bash
npm install @mizara/sdk
```

## Quickstart

### Local policy file

```ts
import { createMizaraClient } from '@mizara/sdk';

const mizara = createMizaraClient({ policyPath: './policy.json' });

const result = await mizara.authorize({
  actor:    { id: 'agent_support_v4', type: 'autonomous_agent' },
  action:   { name: 'execute_refund' },
  resource: { type: 'monetary_transaction', id: 'tx_99210',
               attributes: { amount: 75, currency: 'USD' } },
});

if (result.status === 'DENY') {
  throw new Error(result.enforcement.user_facing_error);
}
// result.status                   -> 'ALLOW' | 'DENY' | 'REDACT' | 'RE_ROUTE'
// result.cryptographic_receipt.id -> 'rcpt_8f3c...'
```

### Hosted API

Sign up at [mizara.ai/signup](https://mizara.ai/signup) to skip the local file:

```ts
import { createMizaraClient } from '@mizara/sdk';

const mizara = createMizaraClient({
  apiKey:   process.env.MIZARA_API_KEY!,
  clientId: 'acme_corp',
});

const result = await mizara.authorize({
  actor:    { id: 'agent_1', type: 'autonomous_agent' },
  action:   { name: 'execute_refund' },
  resource: { type: 'monetary_transaction', id: 'tx_1',
               attributes: { amount: 75 } },
});
```

Hosted mode evaluates locally against a policy snapshot that's refreshed in the background (every 10s by default). A Mizara outage doesn't fail every `authorize()` call, it keeps using the last policy successfully fetched. Receipts are generated locally and flushed to the hosted API asynchronously. For zero-loss delivery across a process crash, pass `receiptLogPath`:

```ts
const mizara = createMizaraClient({
  apiKey:   process.env.MIZARA_API_KEY!,
  clientId: 'acme_corp',
  receiptLogPath: './mizara-receipts.log',
  onSyncError: (err) => console.error('[mizara] policy sync failing:', err.message),
});
```

Call `mizara.close()` before your process exits to stop the background sync and flush timers (a no-op in local mode, safe to always call).

### Waiting on a RE_ROUTE decision

A `RE_ROUTE` result means the action is held pending human approval. In hosted mode, `waitForApproval` polls until it's approved, denied, or the timeout elapses:

```ts
const result = await mizara.authorize({ /* ... */ });

if (result.status === 'RE_ROUTE') {
  const outcome = await mizara.waitForApproval!(result.cryptographic_receipt.id);
  // outcome: 'APPROVED' | 'DENIED' | 'TIMEOUT'
}
```

Only present in hosted mode; local mode has no server to hold pending approval state. Defaults to polling every 3s for up to 25 minutes.

### Verifying receipts

Every receipt is signed with Ed25519, an asymmetric algorithm. Verification only needs the public key, not a call back to Mizara or the signing secret:

```ts
import { verifyReceipt, getPublicKey } from '@mizara/sdk';

const publicKey = getPublicKey(); // or fetch from GET /api/v1/public-key in hosted mode
const isValid = verifyReceipt(result.cryptographic_receipt, publicKey);
```

Set `MIZARA_SIGNING_PRIVATE_KEY` (a base64-encoded 32-byte Ed25519 seed) so the same key persists across restarts. Without it, a fresh key is generated per process and receipts stop being verifiable once it exits.

## Policy format

Plain JSON. No Rego, no Cedar syntax.

```json
{
  "policy_id": "pol_refund_v1",
  "client_id": "acme_corp",
  "rules": [
    {
      "id": "rule_max_refund",
      "target_action": "execute_refund",
      "condition": "resource.attributes.amount <= 50.00",
      "effect": "ALLOW",
      "fallback_effect": "DENY",
      "remediation_message": "Refund exceeds the $50 unapproved threshold."
    }
  ]
}
```

Condition expressions support comparisons, boolean logic, arithmetic, and `.contains()`:

```text
resource.attributes.amount <= 50.00
context.jurisdiction == 'EU' && context.data_classification.contains('PII')
context.session_total + resource.attributes.amount <= 500
```

## Integrations

| Framework | Example |
| --- | --- |
| LangGraph | [`examples/langgraph/`](examples/langgraph/) |
| OpenAI Agents SDK | [`examples/openai-agents/`](examples/openai-agents/) |
| Hosted API | [`examples/hosted-api/`](examples/hosted-api/) |
| MCP (Claude Desktop, Claude Code) | see below |

## MCP server

`@mizara/sdk` ships an MCP server that exposes `authorize()` as a tool - `mizara_authorize` - to any MCP-compatible agent.

```bash
npm install -g @mizara/sdk
```

Add to your MCP client config (e.g. Claude Desktop's `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "mizara": {
      "command": "mizara-mcp",
      "args": ["--policy", "/absolute/path/to/your/policy.json"]
    }
  }
}
```

Restart the client. The agent now has `mizara_authorize` in its tool list and gets a signed receipt back with every call.

## Design choices

**Fail closed.** No matching rule returns `DENY`, not `ALLOW`.

**Most restrictive wins.** When more than one rule matches an action, the most restrictive triggered outcome wins - `DENY` > `RE_ROUTE` > `REDACT` > `ALLOW` - regardless of rule order.

**Resilient by default, with one honest exception.** Hosted mode evaluates locally against a synced policy, so a Mizara outage doesn't stop your agent. A rule that uses `context.session_total` is the one case that can't get this guarantee: cumulative tracking is inherently centralized state, so if the session store is unreachable, that specific request fails closed rather than silently trusting a stale total.

**Policy as data.** Rules live in a JSON file that non-engineers can edit without a deploy.

**No Cedar or Rego.** Conditions are plain boolean expressions. The engine compiles them safely without `eval()`.

**Receipt on every call.** Even `ALLOW` decisions are signed and stored. The audit trail is part of the product, not an afterthought.

## License

Apache-2.0
