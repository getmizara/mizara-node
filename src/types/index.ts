export type AuthorizationStatus = 'ALLOW' | 'DENY' | 'REDACT' | 'RE_ROUTE';

export interface Actor {
  id: string;
  type: string;
  framework?: string;
}

export interface Action {
  name: string;
  risk_profile?: string;
}

export interface Resource {
  type: string;
  id: string;
  attributes?: Record<string, unknown>;
}

export interface AuthorizeContext {
  client_id?: string;
  data_classification?: string[];
  target_jurisdiction?: string;
  underlying_llm?: string;
  [key: string]: unknown;
}

export interface AuthorizeInput {
  actor: Actor;
  action: Action;
  resource: Resource;
  context?: AuthorizeContext;
}

export interface PolicyRule {
  id: string;
  target_action: string;
  condition: string;
  effect: AuthorizationStatus;
  fallback_effect: AuthorizationStatus;
  remediation_message?: string;
}

export interface Policy {
  policy_id: string;
  client_id: string;
  rules: PolicyRule[];
  // Numeric version of this rule set. Undefined for policies loaded from
  // a bare local JSON file with no version history behind them.
  version?: number;
}

export interface CryptographicReceipt {
  id: string;
  hash: string;
  signature: string;
  // Present on Ed25519-signed receipts; absent on legacy HMAC ones, which
  // remain valid historical records but aren't independently verifiable
  // without the shared secret that produced them.
  algorithm?: string;
  public_key?: string;
}

export interface EvaluationMetadata {
  triggered_rule_id: string | null;
  policy_bundle_version: string;
  execution_time_ms: number;
  // The exact rule-set version active at decision time, so a receipt can
  // be checked against the policy as it existed then, not as it exists
  // now. Null when the policy has no version (e.g. local bare JSON file).
  policy_version: number | null;
}

export interface Enforcement {
  action_halted: boolean;
  user_facing_error: string | null;
}

export interface AuthorizeResult {
  status: AuthorizationStatus;
  evaluation_metadata: EvaluationMetadata;
  enforcement: Enforcement;
  cryptographic_receipt: CryptographicReceipt;
}
