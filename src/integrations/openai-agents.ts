// OpenAI Agents SDK integration. Requires the peer dependency @openai/agents.
//
// Wraps a Mizara client as an inputGuardrail, so a policy decision runs
// before the tool executes and can block it - unlike exposing authorize()
// as a separate callable tool, the model can't skip this by just not
// calling it.
import {
  defineToolInputGuardrail,
  ToolGuardrailFunctionOutputFactory,
  type ToolInputGuardrailDefinition,
} from '@openai/agents-core';
import type { MizaraClient } from '../sdk';

export interface MizaraGuardrailOptions {
  actorId?: string;
  resourceType?: string;
}

// ALLOW lets the call through. DENY, REDACT, and RE_ROUTE all reject the
// call with the policy's remediation message - REDACT and RE_ROUTE don't
// have a meaningful input-stage behavior of their own here (REDACT applies
// to output that doesn't exist yet at this point, and RE_ROUTE's approval
// wait isn't wired in), so all three currently mean "don't run this."
// Same design note as the Python mizara.openai_agents module.
export function mizaraGuardrail(
  client: MizaraClient,
  options: MizaraGuardrailOptions = {},
): ToolInputGuardrailDefinition {
  const actorId = options.actorId ?? 'openai_agent';

  return defineToolInputGuardrail({
    name: 'mizara_authorize',
    run: async (data) => {
      let args: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(data.toolCall.arguments || '{}');
        if (parsed && typeof parsed === 'object') args = parsed;
      } catch {
        // malformed arguments are still evaluated - an empty attributes
        // object simply means no rule condition on those fields can match
      }

      const result = await client.authorize({
        actor: { id: actorId, type: 'autonomous_agent', framework: 'openai-agents' },
        action: { name: data.toolCall.name },
        resource: {
          type: options.resourceType ?? data.toolCall.name,
          id: data.toolCall.callId,
          attributes: args,
        },
      });

      const info = {
        status: result.status,
        ruleId: result.evaluation_metadata.triggered_rule_id,
        receiptId: result.cryptographic_receipt.id,
      };

      if (result.status === 'ALLOW') {
        return ToolGuardrailFunctionOutputFactory.allow(info);
      }

      const message = result.enforcement.user_facing_error ?? `Blocked by Mizara policy (${result.status}).`;
      return ToolGuardrailFunctionOutputFactory.rejectContent(message, info);
    },
  });
}
