# Using the Mizara Hosted API

The fastest way to start — no local policy file needed. Sign up at mizara.ai/signup,
get your API key, and call the hosted endpoint directly.

## 1. Get an API key

```
https://mizara.ai/signup
```

Paste your email, get a key instantly. Looks like: `mizara_live_...`

## 2. Try it with curl

```bash
curl -X POST https://mizara-services.vercel.app/api/v1/authorize \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "actor":    { "id": "agent_1", "type": "autonomous_agent" },
    "action":   { "name": "execute_refund" },
    "resource": { "type": "monetary_transaction", "id": "tx_1",
                  "attributes": { "amount": 75 } },
    "context":  { "client_id": "demo_customer" }
  }'
```

The response includes `status` (ALLOW/DENY/REDACT/RE_ROUTE) and a signed receipt.

## 3. TypeScript

```typescript
// npm install @mizara/sdk
import { createMizaraClient } from '@mizara/sdk';

const mizara = createMizaraClient({
  apiKey: process.env.MIZARA_API_KEY,
  clientId: 'acme_corp',         // your client_id from signup
});

const result = await mizara.authorize({
  actor:    { id: 'agent_support', type: 'autonomous_agent' },
  action:   { name: 'execute_refund', risk_profile: 'high_irreversible' },
  resource: { type: 'monetary_transaction', id: 'tx_99210',
               attributes: { amount: 75, currency: 'USD' } },
});

if (result.status === 'DENY') {
  throw new Error(result.enforcement.user_facing_error ?? 'Blocked by policy');
}
// proceed with action
```

## 4. Python

```python
# pip install mizara
from mizara import create_mizara_client
import os

mizara = create_mizara_client(
    api_key=os.environ["MIZARA_API_KEY"],
    client_id="acme_corp",
)

result = mizara.authorize(
    actor={"id": "agent_support", "type": "autonomous_agent"},
    action={"name": "execute_refund", "risk_profile": "high_irreversible"},
    resource={"type": "monetary_transaction", "id": "tx_99210",
              "attributes": {"amount": 75, "currency": "USD"}},
)

if result.status == "DENY":
    raise Exception(result.enforcement.user_facing_error or "Blocked by policy")
```

## 5. Manage your policy

The default starter policy allows actions up to $100. Change it anytime:

```bash
curl -X PUT https://mizara-services.vercel.app/api/v1/policies/YOUR_CLIENT_ID \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "policy_id": "pol_YOUR_CLIENT_ID_v1",
    "rules": [
      {
        "id": "rule_max_refund",
        "target_action": "execute_refund",
        "condition": "resource.attributes.amount <= 50.00",
        "effect": "ALLOW",
        "fallback_effect": "DENY",
        "remediation_message": "Exceeds the $50 unapproved threshold."
      }
    ]
  }'
```

## 6. Verify a receipt

```bash
curl https://mizara-services.vercel.app/api/v1/receipts/RECEIPT_ID \
  -H "Authorization: Bearer YOUR_API_KEY"
```

Returns the full decision payload with cryptographic hash and signature.
Verifiable: if the hash doesn't match a recalculation, the record was tampered with.
