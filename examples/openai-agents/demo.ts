import { run } from '@openai/agents';
import { agent } from './agent';

if (!process.env.OPENAI_API_KEY) {
  console.error('Error: OPENAI_API_KEY environment variable is required.');
  console.error('  export OPENAI_API_KEY=sk-...');
  process.exit(1);
}

const scenarios = [
  {
    name: 'Scenario A  -  Approve $1,200 payment (under the limit)',
    message: 'Please approve a $1,200 payment for invoice INV-4471.',
  },
  {
    name: 'Scenario B  -  Approve $25,000 payment (over the limit)',
    message: 'Please approve a $25,000 payment for invoice INV-4472.',
  },
];

async function main() {
  console.log('Mizara + OpenAI Agents SDK (TypeScript)  -  Authorization Gate Demo\n');

  for (const s of scenarios) {
    console.log(`─── ${s.name}`);
    console.log(`Input: "${s.message}"\n`);
    const result = await run(agent, s.message);
    console.log(result.finalOutput);
    console.log();
  }
}

main().catch(console.error);
