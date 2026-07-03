/**
 * mizara + LangGraph integration example
 *
 * Shows the authorization gate pattern: an agent decides to call a tool,
 * mizara.authorize() evaluates it against the active policy BEFORE the
 * tool executes, and the graph routes to execution or rejection based
 * on the decision.
 *
 * Graph structure:
 *
 *   START → agent → authorize → [ALLOW]  → tools → agent → END
 *                             → [DENY]   → blocked        → END
 *                             → [REDACT] → blocked        → END
 *
 * No LLM API key required — the agent node is simulated for the demo.
 * To use a real LLM, replace the agentNode function with an LLM call.
 */

import { Annotation, END, MessagesAnnotation, START, StateGraph } from '@langchain/langgraph';
import { AIMessage, HumanMessage, ToolMessage } from '@langchain/core/messages';
import { createMizaraClient } from '@mizara/sdk';
import type { AuthorizeResult } from '@mizara/sdk';
import path from 'node:path';

// Load Mizara with the policy for this agent
const mizara = createMizaraClient({
  policyPath: path.join(__dirname, 'policy.json'),
});

// ── State definition ────────────────────────────────────────────────────────
// Extends MessagesAnnotation with the Mizara authorization result so routing
// functions can inspect the decision without passing it through messages.

const AgentState = Annotation.Root({
  ...MessagesAnnotation.spec,
  authorizationResult: Annotation<AuthorizeResult | null>({
    reducer: (_, incoming) => incoming,
    default: () => null,
  }),
});

type State = typeof AgentState.State;

// ── Nodes ───────────────────────────────────────────────────────────────────

/**
 * Agent node: decides what to do next.
 *
 * In production, replace this with a real LLM call:
 *   const response = await llm.bindTools(tools).invoke(state.messages);
 *   return { messages: [response] };
 *
 * This demo simulates the LLM decision based on the amount in the
 * initial HumanMessage so the example runs without any API key.
 */
function agentNode(state: State): Partial<State> {
  const lastMessage = state.messages[state.messages.length - 1];

  // If we just received a tool result or blocked message, we're done
  if (lastMessage instanceof ToolMessage) {
    return {
      messages: [
        new AIMessage({
          content: `Refund processed successfully. ${lastMessage.content}`,
        }),
      ],
    };
  }

  if (lastMessage instanceof AIMessage && !lastMessage.tool_calls?.length) {
    return {}; // Final response already in messages, route to END
  }

  // Simulate the LLM deciding to call execute_refund.
  // The amount comes from the initial human message for the demo.
  const humanMsg = state.messages.find((m) => m instanceof HumanMessage);
  const match = humanMsg?.content.toString().match(/\$(\d+(?:\.\d+)?)/);
  const amount = match ? parseFloat(match[1]) : 25;

  return {
    messages: [
      new AIMessage({
        content: '',
        tool_calls: [
          {
            id: `call_${Date.now()}`,
            name: 'execute_refund',
            args: { amount, order_id: 'order_99210', currency: 'USD' },
            type: 'tool_call',
          },
        ],
      }),
    ],
  };
}

/**
 * Authorization node: the structural enforcement gate.
 *
 * mizara.authorize() evaluates the pending tool call against the active
 * policy before anything executes. The result determines routing —
 * the tool cannot run without passing through this node.
 */
async function authorizationNode(state: State): Promise<Partial<State>> {
  const lastMessage = state.messages[state.messages.length - 1];
  if (!(lastMessage instanceof AIMessage) || !lastMessage.tool_calls?.length) {
    return {};
  }

  const toolCall = lastMessage.tool_calls[0];

  const result = await mizara.authorize({
    actor: {
      id: 'agent_support_v4',
      type: 'autonomous_agent',
      framework: 'langgraph',
    },
    action: {
      name: toolCall.name,
      risk_profile: 'high_irreversible',
    },
    resource: {
      type: 'monetary_transaction',
      id: toolCall.args.order_id as string,
      attributes: toolCall.args as Record<string, unknown>,
    },
    context: { client_id: 'demo_customer' },
  });

  return { authorizationResult: result };
}

/**
 * Tool execution node — only reached when authorization returned ALLOW.
 * Replace the simulation here with your real tool call (Stripe, internal API, etc.)
 */
async function toolsNode(state: State): Promise<Partial<State>> {
  const lastMessage = state.messages[state.messages.length - 1];
  if (!(lastMessage instanceof AIMessage) || !lastMessage.tool_calls?.length) {
    return {};
  }

  const toolCall = lastMessage.tool_calls[0];
  const auth = state.authorizationResult!;

  // Simulate calling the actual refund endpoint
  const simulatedResult = {
    success: true,
    refund_id: `ref_${Date.now()}`,
    amount: toolCall.args.amount,
    mizara_receipt: auth.cryptographic_receipt.id,
  };

  return {
    messages: [
      new ToolMessage({
        tool_call_id: toolCall.id,
        content: JSON.stringify(simulatedResult),
        name: toolCall.name,
      }),
    ],
    authorizationResult: null,
  };
}

/**
 * Blocked node — reached when authorization returned DENY, REDACT, or RE_ROUTE.
 * Surfaces the policy message and the signed receipt for audit.
 */
function blockedNode(state: State): Partial<State> {
  const auth = state.authorizationResult!;
  const lastMessage = state.messages[state.messages.length - 1];
  const toolCall = lastMessage instanceof AIMessage ? lastMessage.tool_calls?.[0] : null;

  return {
    messages: [
      new AIMessage({
        content: [
          `[mizara] Action blocked — status: ${auth.status}`,
          `Tool: ${toolCall?.name ?? 'unknown'}`,
          `Rule: ${auth.evaluation_metadata.triggered_rule_id ?? 'none'}`,
          `Reason: ${auth.enforcement.user_facing_error ?? ''}`,
          `Receipt: ${auth.cryptographic_receipt.id}`,
        ]
          .filter(Boolean)
          .join('\n'),
      }),
    ],
    authorizationResult: null,
  };
}

// ── Routing functions ────────────────────────────────────────────────────────

function routeAfterAgent(state: State): 'authorize' | typeof END {
  const lastMessage = state.messages[state.messages.length - 1];
  if (lastMessage instanceof AIMessage && (lastMessage.tool_calls?.length ?? 0) > 0) {
    return 'authorize';
  }
  return END;
}

function routeAfterAuthorization(state: State): 'tools' | 'blocked' {
  return state.authorizationResult?.status === 'ALLOW' ? 'tools' : 'blocked';
}

// ── Graph compilation ────────────────────────────────────────────────────────

export const graph = new StateGraph(AgentState)
  .addNode('agent', agentNode)
  .addNode('authorize', authorizationNode)
  .addNode('tools', toolsNode)
  .addNode('blocked', blockedNode)
  .addEdge(START, 'agent')
  .addConditionalEdges('agent', routeAfterAgent)
  .addConditionalEdges('authorize', routeAfterAuthorization)
  .addEdge('tools', 'agent')
  .addEdge('blocked', END)
  .compile();
