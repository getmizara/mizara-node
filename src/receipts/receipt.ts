import { createHash, createHmac, randomBytes } from 'node:crypto';
import type { AuthorizationStatus, AuthorizeInput, CryptographicReceipt } from '../types';

// Local HMAC signing. Set MIZARA_LOCAL_SIGNING_SECRET, or receipts are
// signed with a well-known default key and are not tamper-evident.
const envSecret = process.env.MIZARA_LOCAL_SIGNING_SECRET;
if (!envSecret) {
  process.stderr.write(
    '[mizara] MIZARA_LOCAL_SIGNING_SECRET is not set. Receipts are being signed with ' +
      'a well-known default key and are not tamper-evident. Set MIZARA_LOCAL_SIGNING_SECRET ' +
      'before relying on receipts for audit.\n',
  );
}
const LOCAL_SIGNING_SECRET = envSecret ?? 'mizara-local-dev-secret';

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
