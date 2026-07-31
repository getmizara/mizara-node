import { describe, expect, it } from 'vitest';
import { Agent, RunContext } from '@openai/agents-core';
import { mizaraGuardrail } from '../src/integrations/openai-agents';
import { createMizaraClient } from '../src/sdk';
import type { Policy } from '../src/types';

const POLICY: Policy = {
  policy_id: 'pol_openai_guardrail_test',
  client_id: 'test',
  rules: [
    {
      id: 'rule_block_prod_terminate',
      target_action: 'terminate_compute_instance',
      condition: "resource.attributes.environment == 'production'",
      effect: 'DENY',
      fallback_effect: 'ALLOW',
      remediation_message: 'Terminating a production instance requires approval.',
    },
  ],
};

function guardrailData(toolName: string, args: Record<string, unknown>) {
  return {
    context: new RunContext(),
    agent: new Agent({ name: 'test-agent', instructions: 'test' }),
    toolCall: {
      type: 'function_call' as const,
      callId: 'call_1',
      name: toolName,
      arguments: JSON.stringify(args),
    },
  };
}

describe('mizaraGuardrail', () => {
  it('allows a call with no matching rule', async () => {
    const client = createMizaraClient({ policy: POLICY });
    const guardrail = mizaraGuardrail(client);

    const output = await guardrail.run(guardrailData('terminate_compute_instance', { environment: 'staging' }));

    expect(output.behavior.type).toBe('allow');
    expect(output.outputInfo.status).toBe('ALLOW');
  });

  it('blocks a call the policy denies', async () => {
    const client = createMizaraClient({ policy: POLICY });
    const guardrail = mizaraGuardrail(client);

    const output = await guardrail.run(guardrailData('terminate_compute_instance', { environment: 'production' }));

    expect(output.behavior.type).toBe('rejectContent');
    if (output.behavior.type === 'rejectContent') {
      expect(output.behavior.message).toContain('approval');
    }
    expect(output.outputInfo.status).toBe('DENY');
    expect(output.outputInfo.ruleId).toBe('rule_block_prod_terminate');
    expect(output.outputInfo.receiptId).toBeTruthy();
  });

  it('defaults an uncovered action to deny', async () => {
    const client = createMizaraClient({ policy: POLICY });
    const guardrail = mizaraGuardrail(client);

    const output = await guardrail.run(guardrailData('send_marketing_broadcast', { recipient_count: 50000 }));

    expect(output.behavior.type).toBe('rejectContent');
    expect(output.outputInfo.status).toBe('DENY');
    expect(output.outputInfo.ruleId).toBeNull();
  });
});
