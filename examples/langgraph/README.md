# Mizara + LangGraph

Shows how to add `mizara.authorize()` as a node in a LangGraph agent so
authorization runs **before tool execution**  -  structurally, not as advisory
application code that can be forgotten or bypassed.

## The pattern

```
START → agent → authorize → [ALLOW]  → tools → agent → END
                           → [DENY]   → blocked        → END
                           → [REDACT] → blocked        → END
```

The `authorize` node sits between the agent and tool execution. The tool
**cannot run** without passing through it. The authorization result is stored
in graph state and determines routing  -  not application logic.

## Run it

```bash
npm install
npm run demo
```

No LLM API key required. The demo simulates the agent decision so it runs
immediately with just the policy file.

**Expected output:**

```
─── Scenario A  -  Delete in staging (allowed environment) ─────
Input: "Please delete the temporary cache instance res_9c21 in staging..."

Final agent response:
Resource deleted successfully. {"success":true,"deletion_id":"del_...","resource_id":"res_9c21",...}

─── Scenario B  -  Delete in production (requires approval) ──────
Input: "Please delete the primary database instance res_9c21 in production..."

Final agent response:
[mizara] Action blocked  -  status: DENY
Tool: delete_cloud_resource
Rule: rule_block_prod_delete
Reason: Deleting a resource in production requires human approval. Escalate before proceeding.
Receipt: rcpt_...
```

## Using a real LLM

Replace the `agentNode` function in `agent.ts` with an actual LLM call:

```ts
import { ChatOpenAI } from '@langchain/openai';

const llm = new ChatOpenAI({ model: 'gpt-4o' }).bindTools(tools);

function agentNode(state: State) {
  const response = await llm.invoke(state.messages);
  return { messages: [response] };
}
```

The rest of the graph  -  including the authorization node  -  stays identical.

## Connecting to the Mizara hosted API

Swap the local policy file for a hosted policy by changing how the client
is created:

```ts
// Local policy (current example)
const mizara = createMizaraClient({ policyPath: './policy.json' });

// Hosted API (non-engineers can change thresholds without a deploy)
// const mizara = createMizaraClient({ apiKey: process.env.MIZARA_API_KEY });
```

## Why this matters

A check the agent is "supposed to call" is exactly as skippable as a system
prompt the agent is "supposed to follow." When the authorization gate is a
dedicated graph node, it is part of the execution path  -  not optional
application code.
