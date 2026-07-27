import {
  createHash,
  createPrivateKey,
  createPublicKey,
  randomBytes,
  sign as cryptoSign,
  verify as cryptoVerify,
  type KeyObject,
} from 'node:crypto';
import type { AuthorizationStatus, AuthorizeInput, CryptographicReceipt } from '../types';

// Fixed ASN.1 prefix for a PKCS8-wrapped raw 32-byte Ed25519 private key
// (RFC 8410 - this structure never varies, only the trailing 32 bytes do),
// used to import a raw seed without pulling in an extra dependency.
const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const SPKI_ED25519_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

function loadOrGenerateKeyPair(): { privateKey: KeyObject; publicKeyBase64: string } {
  const envKey = process.env.MIZARA_SIGNING_PRIVATE_KEY;
  if (!envKey) {
    process.stderr.write(
      '[mizara] MIZARA_SIGNING_PRIVATE_KEY is not set. Receipts are being signed with ' +
        'a key generated fresh for this process and are not verifiable after it exits. ' +
        'Set MIZARA_SIGNING_PRIVATE_KEY (base64, 32-byte Ed25519 seed) before relying on ' +
        'receipts for audit.\n',
    );
  }
  const seed = envKey ? Buffer.from(envKey, 'base64') : randomBytes(32);
  const privateKey = createPrivateKey({
    key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]),
    format: 'der',
    type: 'pkcs8',
  });
  const publicKeyDer = createPublicKey(privateKey).export({ format: 'der', type: 'spki' });
  const publicKeyBase64 = publicKeyDer.subarray(publicKeyDer.length - 32).toString('base64');
  return { privateKey, publicKeyBase64 };
}

let keyPair: { privateKey: KeyObject; publicKeyBase64: string } | null = null;
function getKeyPair() {
  if (!keyPair) keyPair = loadOrGenerateKeyPair();
  return keyPair;
}

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
  const { privateKey, publicKeyBase64 } = getKeyPair();
  const signature = cryptoSign(null, Buffer.from(hash), privateKey);
  const id = `rcpt_${randomBytes(8).toString('hex')}`;

  return {
    id,
    hash,
    signature: signature.toString('base64'),
    algorithm: 'ed25519',
    public_key: publicKeyBase64,
  };
}

// The current signing key's public half, so a host process (the hosted
// API) can expose it for offline verification without duplicating the
// key-loading logic above.
export function getPublicKey(): string {
  return getKeyPair().publicKeyBase64;
}

// Verifies a receipt's signature against a public key, entirely offline -
// no call back to Mizara required.
export function verifyReceipt(receipt: CryptographicReceipt, publicKeyBase64: string): boolean {
  if (receipt.algorithm !== 'ed25519' || !receipt.public_key) return false;
  const publicKeyDer = Buffer.concat([SPKI_ED25519_PREFIX, Buffer.from(publicKeyBase64, 'base64')]);
  const publicKey = createPublicKey({ key: publicKeyDer, format: 'der', type: 'spki' });
  return cryptoVerify(null, Buffer.from(receipt.hash), publicKey, Buffer.from(receipt.signature, 'base64'));
}
