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
}

export interface CryptographicReceipt {
  id: string;
  hash: string;
  signature: string;
}

export interface EvaluationMetadata {
  triggered_rule_id: string | null;
  policy_bundle_version: string;
  execution_time_ms: number;
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
