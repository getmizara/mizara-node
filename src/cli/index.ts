#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { validatePolicy } from './validate';
import { runSafetyTest } from './safety-test';
import type { Policy } from '../types';

const [, , command, filePath, ...rest] = process.argv;

const USAGE = 'Usage: mizara validate <policy.json>\n       mizara test <policy.json> [--json]';

function loadPolicy(path: string): Policy {
  const raw = readFileSync(path, 'utf-8');
  return JSON.parse(raw) as Policy;
}

function runValidate(path: string): void {
  try {
    const policy = loadPolicy(path);
    const errors = validatePolicy(policy);

    if (errors.length > 0) {
      console.error(`Policy validation failed for ${path}:`);
      errors.forEach((e) => console.error(`  - ${e}`));
      process.exit(1);
    }

    console.log(`Policy ${policy.policy_id} is valid (${policy.rules.length} rules).`);
  } catch (err) {
    console.error(`Failed to validate policy: ${(err as Error).message}`);
    process.exit(1);
  }
}

const VERDICT_MARKER: Record<string, string> = {
  PROTECTED: 'PASS',
  'DEFAULT-DENIED': 'WARN',
  FAIL: 'FAIL',
};

function runTest(path: string, jsonOutput: boolean): void {
  let policy: Policy;
  try {
    policy = loadPolicy(path);
  } catch (err) {
    console.error(`Failed to load policy: ${(err as Error).message}`);
    process.exit(1);
  }

  const results = runSafetyTest(policy);

  if (jsonOutput) {
    console.log(
      JSON.stringify(
        results.map((r) => ({
          id: r.scenario.id,
          category: r.scenario.category,
          description: r.scenario.description,
          status: r.status,
          verdict: r.verdict,
          triggered_rule_id: r.triggeredRuleId,
        })),
        null,
        2,
      ),
    );
  } else {
    console.log(`Mizara Safety Test - ${policy.policy_id} (${policy.rules.length} rules)\n`);
    for (const r of results) {
      const marker = VERDICT_MARKER[r.verdict].padEnd(5);
      console.log(`  ${marker}  ${r.scenario.id.padEnd(30)}  ${r.verdict.padEnd(15)}  ${r.scenario.description}`);
    }

    const protectedCount = results.filter((r) => r.verdict === 'PROTECTED').length;
    const warned = results.filter((r) => r.verdict === 'DEFAULT-DENIED').length;
    const failed = results.filter((r) => r.verdict === 'FAIL').length;
    console.log(
      `\n${protectedCount} protected, ${warned} default-denied (no explicit rule), ` +
        `${failed} unprotected - of ${results.length} common risk scenarios`,
    );
  }

  process.exit(results.some((r) => r.verdict === 'FAIL') ? 1 : 0);
}

if (command === 'validate' && filePath) {
  runValidate(filePath);
} else if (command === 'test' && filePath) {
  runTest(filePath, rest.includes('--json'));
} else {
  console.error(USAGE);
  process.exit(1);
}
