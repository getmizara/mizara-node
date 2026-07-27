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
    'Call this before executing any consequential action such as a payment, ' +
    'data write, or infrastructure change. Returns ALLOW, DENY, REDACT, or RE_ROUTE ' +
    'with a signed receipt.',
  parameters: {
    type: 'object' as const,
    properties: {
      actor_id:      { type: 'string', description: 'Unique ID of the agent making the request' },
      action_name:   { type: 'string', description: 'Name of the action (e.g. approve_payment)' },
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

const approvePayment = tool({
  name: 'approve_payment',
  description:
    'Approve an invoice payment. Only call this after ' +
    'mizara_authorize has returned ALLOW for approve_payment.',
  parameters: {
    type: 'object' as const,
    properties: {
      invoice_id: { type: 'string', description: 'The invoice to pay' },
      amount:     { type: 'number', description: 'The payment amount' },
      currency:   { type: 'string', description: 'Currency code (default USD)' },
    },
    required: ['invoice_id', 'amount'],
  },
  execute: async (params: { invoice_id: string; amount: number; currency?: string }) => {
    return JSON.stringify({
      success: true,
      payment_id: `pay_${Date.now()}`,
      amount: params.amount,
      currency: params.currency ?? 'USD',
    });
  },
});

export const agent = new Agent({
  name: 'finance-agent',
  instructions:
    'You are a finance operations agent. ' +
    'Before approving any payment, you MUST call mizara_authorize first. ' +
    'If it returns DENY, explain the policy limit and do not proceed. ' +
    'If it returns ALLOW, proceed with approve_payment.',
  tools: [mizaraAuthorize, approvePayment],
});
