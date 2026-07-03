# @mizara/sdk

Authorization layer for AI agents. Evaluates whether an agent action should
proceed — before it executes — against a policy you define. Returns a signed
decision receipt for every call.

```bash
npm install @mizara/sdk
```

```ts
import { createMizaraClient } from '@mizara/sdk';

const mizara = createMizaraClient({ policyPath: './policy.json' });

const result = await mizara.authorize({
  actor:    { id: 'agent_support_v4', type: 'autonomous_agent', framework: 'langgraph' },
  action:   { name: 'execute_refund', risk_profile: 'high_irreversible' },
  resource: { type: 'monetary_transaction', id: 'tx_99210', attributes: { amount: 75, currency: 'USD' } },
  context:  { client_id: 'acme_corp', target_jurisdiction: 'EU' },
});

// result.status  -> 'ALLOW' | 'DENY' | 'REDACT' | 'RE_ROUTE'
// result.cryptographic_receipt -> { id, hash, signature }
```

Policies are plain JSON — no Rego, no Cedar syntax:

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

## How it works

Every `authorize()` call evaluates the request against your policy rules and
returns a deterministic decision with a cryptographically signed receipt:

```txt
actor + action + resource + context
            │
            ▼
    policy evaluation (stateless, <2ms)
            │
     ┌──────┴──────┐
  ALLOW          DENY / REDACT / RE_ROUTE
     │                    │
 execute          halt + signed receipt
```

The receipt is a SHA-256 hash of the full decision payload, signed with HMAC.
Every decision is auditable and verifiable after the fact.

## Design decisions

**Fail closed.** No matching rule → `DENY`. An auth layer that defaults to
allowing unmatched actions isn't one a compliance team can trust.

**Policy as data, not code.** Rules live in a JSON file. Non-engineers can
change thresholds without a deploy.

**No Cedar/Rego syntax required.** Conditions are plain boolean expressions:
`resource.attributes.amount <= 50.00`, `context.jurisdiction == 'EU'`,
`context.data_classification.contains('PII')`.

**Receipts on every decision.** Even `ALLOW` decisions generate a signed
receipt. The audit trail is the product, not an afterthought.

## Try it locally

```bash
git clone https://github.com/getmizara/mizara-core
cd mizara-core
npm install
npm run demo:simulate
```

## Hosted API

```bash
POST https://mizara-services.vercel.app/api/v1/authorize
Authorization: Bearer <api_key>
Content-Type: application/json
```

## License

Apache-2.0
