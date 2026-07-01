#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { validatePolicy } from './validate';

const [, , command, filePath] = process.argv;

if (command !== 'validate' || !filePath) {
  console.error('Usage: mizara validate <policy.json>');
  process.exit(1);
}

try {
  const raw = readFileSync(filePath, 'utf-8');
  const policy = JSON.parse(raw) as { policy_id: string; rules: unknown[] };
  const errors = validatePolicy(policy);

  if (errors.length > 0) {
    console.error(`Policy validation failed for ${filePath}:`);
    errors.forEach((e) => console.error(`  - ${e}`));
    process.exit(1);
  }

  console.log(`Policy ${policy.policy_id} is valid (${policy.rules.length} rules).`);
} catch (err) {
  console.error(`Failed to validate policy: ${(err as Error).message}`);
  process.exit(1);
}
