// Mizara + OpenAI Agents SDK integration example (TypeScript)
//
// Shows the enforced pattern: mizaraGuardrail() runs as an inputGuardrail
// on the tool itself, so the policy decision happens before the tool can
// execute - the model can't bypass this by simply not calling an authorize
// tool first, unlike wiring authorize() in as a separate callable tool.
import path from 'node:path';
import { Agent, tool } from '@openai/agents';
import { createMizaraClient } from '@mizara/sdk';
import { mizaraGuardrail } from '@mizara/sdk/integrations/openai-agents';

const mizara = createMizaraClient({
  policyPath: path.join(__dirname, 'policy.json'),
});

const sendCustomerBroadcast = tool({
  name: 'send_customer_broadcast',
  description: 'Sends a broadcast message to customers.',
  parameters: {
    type: 'object' as const,
    properties: {
      message: { type: 'string', description: 'The broadcast content' },
      recipient_count: { type: 'number', description: 'How many recipients this will reach' },
      external: { type: 'boolean', description: 'Whether recipients are outside the company (customers) vs internal' },
    },
    required: ['message', 'recipient_count', 'external'],
    additionalProperties: false,
  },
  inputGuardrails: [mizaraGuardrail(mizara, { actorId: 'comms_agent_v1' })],
  execute: async (params) => {
    const { message, recipient_count } = params as {
      message: string;
      recipient_count: number;
      external: boolean;
    };
    return JSON.stringify({
      success: true,
      sent_to: recipient_count,
      message_preview: message.slice(0, 80),
    });
  },
});

export const agent = new Agent({
  name: 'comms-agent',
  instructions:
    'You are a customer communications agent. Send broadcasts as requested ' +
    'using send_customer_broadcast. If a send is rejected, explain why to the user ' +
    'in plain terms and do not retry it yourself.',
  tools: [sendCustomerBroadcast],
});
