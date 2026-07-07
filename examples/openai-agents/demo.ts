import { run } from '@openai/agents';
import { agent } from './agent';

if (!process.env.OPENAI_API_KEY) {
  console.error('Error: OPENAI_API_KEY environment variable is required.');
  console.error('  export OPENAI_API_KEY=sk-...');
  process.exit(1);
}

const scenarios = [
  {
    name: 'Scenario A  -  Refund $25 (under threshold)',
    message: 'Please refund $25 for order ORD-9921, customer received wrong item.',
  },
  {
    name: 'Scenario B  -  Refund $75 (over threshold)',
    message: 'Please refund $75 for order ORD-9922, customer wants full refund.',
  },
];

console.log('Mizara + OpenAI Agents SDK (TypeScript)  -  Authorization Gate Demo\n');

for (const s of scenarios) {
  console.log(`─── ${s.name}`);
  console.log(`Input: "${s.message}"\n`);
  const result = await run(agent, s.message);
  console.log(result.finalOutput);
  console.log();
}
