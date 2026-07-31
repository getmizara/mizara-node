import { run } from '@openai/agents';
import { agent } from './agent';

if (!process.env.OPENAI_API_KEY) {
  console.error('Error: OPENAI_API_KEY environment variable is required.');
  console.error('  export OPENAI_API_KEY=sk-...');
  process.exit(1);
}

const scenarios = [
  {
    name: 'Scenario A  -  Broadcast to 200 internal recipients (under the threshold)',
    message: 'Send a broadcast to our 200 internal team members announcing the new release.',
  },
  {
    name: 'Scenario B  -  Broadcast to 50,000 external customers (over the threshold)',
    message: 'Send a broadcast to all 50,000 external customers announcing the new release.',
  },
];

async function main() {
  console.log('Mizara + OpenAI Agents SDK (TypeScript)  -  Enforced Guardrail Demo\n');

  for (const s of scenarios) {
    console.log(`─── ${s.name}`);
    console.log(`Input: "${s.message}"\n`);
    const result = await run(agent, s.message);
    console.log(result.finalOutput);
    console.log();
  }
}

main().catch(console.error);
