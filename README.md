# @mizara/sdk

[![npm](https://img.shields.io/npm/v/%40mizara%2Fsdk?color=cb3837)](https://www.npmjs.com/package/@mizara/sdk)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue)](LICENSE.md)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6)](https://www.typescriptlang.org/)

Authorization layer for AI agents. Call `authorize()` before any consequential action. Sub-2ms evaluation, policy-as-data, cryptographic receipt on every decision.

## Install

```bash
npm install @mizara/sdk
```

```bash
pip install mizara          # Python SDK
```

## Quickstart — local

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

## Quickstart — hosted API

Sign up at [mizara.ai/signup](https://mizara.ai/signup), get an API key, skip the local policy file:

```ts
const mizara = createMizaraClient({
  apiKey:   process.env.MIZARA_API_KEY,
  clientId: 'acme_corp',
});

const result = await mizara.authorize({ ... });
```

```python
# Python
from mizara import create_mizara_client

mizara = create_mizara_client(
    api_key=os.environ["MIZARA_API_KEY"],
    client_id="acme_corp",
)
result = mizara.authorize(...)
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

```
resource.attributes.amount <= 50.00
context.jurisdiction == 'EU' && context.data_classification.contains('PII')
context.session_total + resource.attributes.amount <= 500
```

## How it works

```
actor + action + resource + context
              |
              v
   policy evaluation  (~1-2ms, stateless)
              |
       -------+-------
      |               |
   ALLOW         DENY / REDACT / RE_ROUTE
      |               |
   execute       halt + signed receipt
```

Every decision produces a SHA-256 hash of the full payload, signed with HMAC. The receipt is verifiable: a compliance team can prove what the agent was allowed to do, under which rule, and when.

## Integrations

| Framework | Example |
|---|---|
| LangGraph (TypeScript) | [`examples/langgraph/`](examples/langgraph/) |
| LangGraph (Python) | [`examples/langgraph/`](https://github.com/getmizara/mizara-core-python/tree/main/examples/langgraph) |
| OpenAI Agents SDK (TypeScript) | [`examples/openai-agents/`](examples/openai-agents/) |
| OpenAI Agents SDK (Python) | [`examples/openai-agents/`](https://github.com/getmizara/mizara-core-python/tree/main/examples/openai-agents) |
| Hosted API | [`examples/hosted-api/`](examples/hosted-api/) |

## Design choices

**Fail closed.** No matching rule returns `DENY`, not `ALLOW`. An auth layer that defaults open is not one a compliance team can trust.

**Policy as data.** Rules live in a JSON file that non-engineers can edit without a deploy.

**No Cedar or Rego.** Conditions are plain boolean expressions against the input fields. The engine compiles them safely without `eval()`.

**Receipt on every call.** Even `ALLOW` decisions are signed and stored. The audit trail is part of the product, not an afterthought.

## License

Apache-2.0
