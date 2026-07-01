import type { AuthorizationStatus, AuthorizeInput } from '../src/types';

export interface DemoScenario {
  name: string;
  expected: AuthorizationStatus;
  input: AuthorizeInput;
}

export const scenarios: DemoScenario[] = [
  {
    name: 'Scenario A — Refund $25.00',
    expected: 'ALLOW',
    input: {
      actor: { id: 'agent_support_eu_v4', type: 'autonomous_agent', framework: 'langgraph' },
      action: { name: 'execute_refund', risk_profile: 'medium' },
      resource: {
        type: 'monetary_transaction',
        id: 'tx_1001',
        attributes: { amount: 25.0, currency: 'USD' },
      },
      context: { client_id: 'demo_customer' },
    },
  },
  {
    name: 'Scenario B — Refund $75.00',
    expected: 'DENY',
    input: {
      actor: { id: 'agent_support_eu_v4', type: 'autonomous_agent', framework: 'langgraph' },
      action: { name: 'execute_refund', risk_profile: 'high_irreversible' },
      resource: {
        type: 'monetary_transaction',
        id: 'tx_1002',
        attributes: { amount: 75.0, currency: 'USD' },
      },
      context: { client_id: 'demo_customer' },
    },
  },
  {
    name: 'Scenario C — Transmit raw health metrics to unauthorized endpoint',
    expected: 'REDACT',
    input: {
      actor: { id: 'agent_support_eu_v4', type: 'autonomous_agent', framework: 'langgraph' },
      action: { name: 'transmit_data', risk_profile: 'high_irreversible' },
      resource: { type: 'health_record', id: 'rec_5001', attributes: { authorized_endpoint: false } },
      context: {
        client_id: 'demo_customer',
        data_classification: ['PII', 'PHI'],
        target_jurisdiction: 'EU',
      },
    },
  },
];
