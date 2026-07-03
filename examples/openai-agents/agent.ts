import path from 'node:path';
import { Agent, tool } from '@openai/agents';
import { createMizaraClient } from '@mizara/sdk';

const mizara = createMizaraClient({
  policyPath: path.join(__dirname, 'policy.json'),
});

const mizaraAuthorize = tool({
  name: 'mizara_authorize',
  description:
    'Evaluate whether an agent action should proceed under the active policy. ' +
    'Call this before executing any consequential action such as a refund, ' +
    'data write, or infrastructure change. Returns ALLOW, DENY, REDACT, or RE_ROUTE ' +
    'with a signed receipt.',
  parameters: {
    type: 'object' as const,
    properties: {
      actor_id:      { type: 'string', description: 'Unique ID of the agent making the request' },
      action_name:   { type: 'string', description: 'Name of the action (e.g. execute_refund)' },
      resource_type: { type: 'string', description: 'Type of resource being acted on' },
      resource_id:   { type: 'string', description: 'Unique ID of the specific resource' },
      amount:        { type: 'number', description: 'Monetary amount if applicable' },
    },
    required: ['actor_id', 'action_name', 'resource_type', 'resource_id'],
  },
  execute: async (params: {
    actor_id: string;
    action_name: string;
    resource_type: string;
    resource_id: string;
    amount?: number;
  }) => {
    const result = await mizara.authorize({
      actor: { id: params.actor_id, type: 'autonomous_agent', framework: 'openai-agents' },
      action: { name: params.action_name, risk_profile: 'high_irreversible' },
      resource: {
        type: params.resource_type,
        id: params.resource_id,
        attributes: params.amount !== undefined ? { amount: params.amount } : {},
      },
      context: { client_id: 'demo_customer' },
    });

    return JSON.stringify({
      status: result.status,
      rule: result.evaluation_metadata.triggered_rule_id,
      receipt: result.cryptographic_receipt.id,
      blocked: result.enforcement.action_halted,
      reason: result.enforcement.user_facing_error,
    });
  },
});

const executeRefund = tool({
  name: 'execute_refund',
  description:
    'Execute a refund for a customer order. Only call this after ' +
    'mizara_authorize has returned ALLOW for execute_refund.',
  parameters: {
    type: 'object' as const,
    properties: {
      order_id: { type: 'string', description: 'The order to refund' },
      amount:   { type: 'number', description: 'The refund amount' },
      currency: { type: 'string', description: 'Currency code (default USD)' },
    },
    required: ['order_id', 'amount'],
  },
  execute: async (params: { order_id: string; amount: number; currency?: string }) => {
    return JSON.stringify({
      success: true,
      refund_id: `ref_${Date.now()}`,
      amount: params.amount,
      currency: params.currency ?? 'USD',
    });
  },
});

export const agent = new Agent({
  name: 'support-agent',
  instructions:
    'You are a customer support agent. ' +
    'Before executing any refund, you MUST call mizara_authorize first. ' +
    'If it returns DENY, explain the policy limit to the customer and do not proceed. ' +
    'If it returns ALLOW, proceed with execute_refund.',
  tools: [mizaraAuthorize, executeRefund],
});
