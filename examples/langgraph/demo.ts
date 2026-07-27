/**
 * Mizara + LangGraph demo
 *
 * Runs two scenarios to show the authorization gate in action:
 *   Scenario A: delete in staging    → ALLOW  → tool executes
 *   Scenario B: delete in production → DENY   → blocked, signed receipt issued
 *
 * Run: npm run demo
 */

import { HumanMessage } from '@langchain/core/messages';
import { graph } from './agent';

const scenarios = [
  {
    name: 'Scenario A  -  Delete in staging (allowed environment)',
    expected: 'ALLOW',
    message: 'Please delete the temporary cache instance res_9c21 in staging, it is no longer needed.',
  },
  {
    name: 'Scenario B  -  Delete in production (requires approval)',
    expected: 'DENY',
    message: 'Please delete the primary database instance res_9c21 in production, we are decommissioning the old service.',
  },
];

async function run() {
  console.log('Mizara + LangGraph  -  Authorization Gate Demo\n');

  for (const scenario of scenarios) {
    console.log(`─── ${scenario.name} ───────────────────────────────`);
    console.log(`Input: "${scenario.message}"`);
    console.log('');

    const result = await graph.invoke({
      messages: [new HumanMessage(scenario.message)],
    });

    const finalMessage = result.messages[result.messages.length - 1];
    console.log('Final agent response:');
    console.log(finalMessage.content);
    console.log('');
  }
}

run().catch(console.error);
