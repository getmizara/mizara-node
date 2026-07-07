# Mizara SDK

[![PyPI](https://img.shields.io/pypi/v/mizara?color=3776ab&label=pip)](https://pypi.org/project/mizara/)
[![npm](https://img.shields.io/npm/v/%40mizara%2Fsdk?color=cb3837&label=npm)](https://www.npmjs.com/package/@mizara/sdk)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue)](LICENSE.md)

Authorization layer for AI agents. Call `authorize()` before any consequential action. Sub-2ms evaluation, policy-as-data, cryptographic receipt on every decision.

```bash
pip install mizara          # Python
npm install @mizara/sdk     # TypeScript / Node.js
```

## Quickstart

**Python**

```python
from mizara import create_mizara_client

# Local policy file
mizara = create_mizara_client(policy_path="./policy.json")

# Or hosted API — get a key at mizara.ai/signup
mizara = create_mizara_client(
    api_key=os.environ["MIZARA_API_KEY"],
    client_id="acme_corp",
)

result = mizara.authorize(
    actor={"id": "agent_support_v4", "type": "autonomous_agent"},
    action={"name": "execute_refund"},
    resource={"type": "monetary_transaction", "id": "tx_99210",
              "attributes": {"amount": 75, "currency": "USD"}},
)

if result.status == "DENY":
    raise Exception(result.enforcement.user_facing_error)
# result.status                   -> 'ALLOW' | 'DENY' | 'REDACT' | 'RE_ROUTE'
# result.cryptographic_receipt.id -> 'rcpt_8f3c...'
```

**TypeScript**

```ts
import { createMizaraClient } from '@mizara/sdk';

const mizara = createMizaraClient({ policyPath: './policy.json' });
// or: createMizaraClient({ apiKey: process.env.MIZARA_API_KEY, clientId: 'acme_corp' })

const result = await mizara.authorize({
  actor:    { id: 'agent_support_v4', type: 'autonomous_agent' },
  action:   { name: 'execute_refund' },
  resource: { type: 'monetary_transaction', id: 'tx_99210',
               attributes: { amount: 75, currency: 'USD' } },
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

Condition expressions:

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

Every decision produces a SHA-256 hash of the full payload, signed with HMAC. The receipt is verifiable — a compliance team can prove what the agent was allowed to do, under which rule, and when.

## Integrations

| Framework | Python | TypeScript |
|---|---|---|
| LangGraph | [examples/langgraph](https://github.com/getmizara/mizara-core-python/tree/main/examples/langgraph) | [examples/langgraph](examples/langgraph/) |
| OpenAI Agents SDK | [examples/openai-agents](https://github.com/getmizara/mizara-core-python/tree/main/examples/openai-agents) | [examples/openai-agents](examples/openai-agents/) |
| Hosted API | [examples/hosted-api](https://github.com/getmizara/mizara-core-python/tree/main/examples/hosted-api) | [examples/hosted-api](examples/hosted-api/) |

## Repos

| | Python | TypeScript |
|---|---|---|
| Source | [getmizara/mizara-core-python](https://github.com/getmizara/mizara-core-python) | [getmizara/mizara-core](https://github.com/getmizara/mizara-core) |
| Package | `pip install mizara` | `npm install @mizara/sdk` |

## Design choices

**Fail closed.** No matching rule returns `DENY`, not `ALLOW`.

**Policy as data.** Rules live in a JSON file that non-engineers can edit without a deploy.

**No Cedar or Rego.** Conditions are plain boolean expressions. The engine compiles them safely without `eval()`.

**Receipt on every call.** Even `ALLOW` decisions are signed and stored. The audit trail is part of the product, not an afterthought.

## License

Apache-2.0
