import { createHash, createHmac, randomBytes } from 'node:crypto';
import type { AuthorizationStatus, AuthorizeInput, CryptographicReceipt } from '../types';

// V1 signs receipts with a local HMAC secret as a stand-in. Phase 3 replaces
// this with KMS-backed asymmetric signing once the hosted runtime exists —
// the receipt shape (id, hash, signature) does not change.
const LOCAL_SIGNING_SECRET = process.env.MIZARA_LOCAL_SIGNING_SECRET ?? 'mizara-local-dev-secret';

export function createReceipt(params: {
  input: AuthorizeInput;
  status: AuthorizationStatus;
  triggeredRuleId: string | null;
}): CryptographicReceipt {
  const payload = JSON.stringify({
    actor: params.input.actor,
    action: params.input.action,
    resource: params.input.resource,
    context: params.input.context ?? {},
    status: params.status,
    triggered_rule_id: params.triggeredRuleId,
  });

  const hash = createHash('sha256').update(payload).digest('hex');
  const signature = createHmac('sha256', LOCAL_SIGNING_SECRET).update(hash).digest('hex');
  const id = `rcpt_${randomBytes(8).toString('hex')}`;

  return {
    id,
    hash,
    signature: `sig_local_${signature.slice(0, 32)}`,
  };
}
