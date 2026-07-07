/**
 * Mizara + LangGraph demo
 *
 * Runs two scenarios to show the authorization gate in action:
 *   Scenario A: $25 refund → ALLOW  → tool executes
 *   Scenario B: $75 refund → DENY   → blocked, signed receipt issued
 *
 * Run: npm run demo
 */

import { HumanMessage } from '@langchain/core/messages';
import { graph } from './agent';

const scenarios = [
  {
    name: 'Scenario A  -  Refund $25 (under threshold)',
    expected: 'ALLOW',
    message: 'Please refund $25 for order 99210, the customer received the wrong item.',
  },
  {
    name: 'Scenario B  -  Refund $75 (over threshold)',
    expected: 'DENY',
    message: 'Please refund $75 for order 99210, the customer is requesting a full refund.',
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
