# Mizara SDK for Node.js

[![npm](https://img.shields.io/npm/v/%40mizara%2Fsdk?color=cb3837)](https://www.npmjs.com/package/@mizara/sdk)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue)](LICENSE.md)

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

**Policy as data.** Rules live in a JSON file that non-engineers can edit without a deploy.

**No Cedar or Rego.** Conditions are plain boolean expressions. The engine compiles them safely without `eval()`.

**Receipt on every call.** Even `ALLOW` decisions are signed and stored. The audit trail is part of the product, not an afterthought.

## License

Apache-2.0
