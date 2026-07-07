#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createMizaraClient } from '../sdk';
import type { Actor, Action, Resource, AuthorizeContext } from '../types';

function getPolicyPath(): string {
  const args = process.argv.slice(2);
  const idx = args.indexOf('--policy');
  if (idx !== -1 && args[idx + 1]) return args[idx + 1];
  if (process.env.MIZARA_POLICY_PATH) return process.env.MIZARA_POLICY_PATH;
  throw new Error(
    'Policy path required. Pass --policy <path.json> or set MIZARA_POLICY_PATH.',
  );
}

const mizara = createMizaraClient({ policyPath: getPolicyPath() });

const server = new McpServer({
  name: 'mizara',
  version: '0.1.1',
});

server.tool(
  'mizara_authorize',
  'Evaluate whether an agent action should proceed under the active policy. ' +
    'Call this before executing any consequential action (refunds, data writes, ' +
    'infra changes). Returns ALLOW, DENY, REDACT, or RE_ROUTE with a signed receipt.',
  {
    actor_id: z.string().describe('Unique ID of the agent or service making the request'),
    actor_type: z.string().default('autonomous_agent').describe('Type of actor (e.g. autonomous_agent)'),
    actor_framework: z.string().optional().describe('Agent framework in use (e.g. langgraph, openai-agents)'),
    action_name: z.string().describe('Name of the action being requested (e.g. execute_refund, transmit_data)'),
    action_risk_profile: z.string().optional().describe('Risk level of the action (e.g. high_irreversible)'),
    resource_type: z.string().describe('Type of resource being acted on (e.g. monetary_transaction, health_record)'),
    resource_id: z.string().describe('Unique ID of the specific resource'),
    resource_attributes: z
      .record(z.unknown())
      .optional()
      .describe('Resource attributes relevant to policy (e.g. {"amount": 75, "currency": "USD"})'),
    context: z
      .record(z.unknown())
      .optional()
      .describe('Runtime context for policy evaluation (e.g. {"client_id": "acme", "target_jurisdiction": "EU"})'),
  },
  async (args) => {
    const { actor_id, actor_type, actor_framework, action_name, action_risk_profile, resource_type, resource_id, resource_attributes, context } = args as {
      actor_id: string;
      actor_type: string;
      actor_framework?: string;
      action_name: string;
      action_risk_profile?: string;
      resource_type: string;
      resource_id: string;
      resource_attributes?: Record<string, unknown>;
      context?: Record<string, unknown>;
    };

    const actor: Actor = {
      id: actor_id,
      type: actor_type,
      ...(actor_framework ? { framework: actor_framework } : {}),
    };

    const action: Action = {
      name: action_name,
      ...(action_risk_profile ? { risk_profile: action_risk_profile } : {}),
    };

    const resource: Resource = {
      type: resource_type,
      id: resource_id,
      ...(resource_attributes ? { attributes: resource_attributes } : {}),
    };

    const result = await mizara.authorize({
      actor,
      action,
      resource,
      context: context as AuthorizeContext | undefined,
    });

    const headline =
      result.status === 'ALLOW'
        ? `ALLOW  -  action may proceed`
        : result.status === 'DENY'
          ? `DENY  -  ${result.enforcement.user_facing_error ?? 'blocked by policy'}`
          : result.status === 'REDACT'
            ? `REDACT  -  data must be masked before proceeding`
            : `RE_ROUTE  -  action requires alternative handling`;

    return {
      content: [
        {
          type: 'text',
          text: [
            `[mizara] ${headline}`,
            `rule: ${result.evaluation_metadata.triggered_rule_id ?? 'none'}`,
            `receipt: ${result.cryptographic_receipt.id}`,
            `time: ${result.evaluation_metadata.execution_time_ms}ms`,
            '',
            JSON.stringify(result, null, 2),
          ].join('\n'),
        },
      ],
    };
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err: Error) => {
  process.stderr.write(`[mizara-mcp] startup error: ${err.message}\n`);
  process.exit(1);
});
