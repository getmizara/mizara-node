import path from 'node:path';
import { createMizaraClient } from '../src';
import { scenarios } from './scenarios';

async function main() {
  const mizara = createMizaraClient({
    policyPath: path.join(__dirname, 'policies', 'demo-policy.json'),
  });

  console.log('Mizara  -  Local Authorization Demo\n');

  let allPassed = true;

  for (const scenario of scenarios) {
    const result = await mizara.authorize(scenario.input);
    const pass = result.status === scenario.expected;
    allPassed = allPassed && pass;

    console.log(`${pass ? '✓' : '✗'} ${scenario.name}`);
    console.log(`  status:   ${result.status} (expected ${scenario.expected})`);
    console.log(`  rule:     ${result.evaluation_metadata.triggered_rule_id ?? 'none'}`);
    console.log(`  time:     ${result.evaluation_metadata.execution_time_ms}ms`);
    console.log(`  receipt:  ${result.cryptographic_receipt.id}`);
    if (result.enforcement.user_facing_error) {
      console.log(`  message:  ${result.enforcement.user_facing_error}`);
    }
    console.log('');
  }

  if (!allPassed) {
    process.exitCode = 1;
  }
}

main();
