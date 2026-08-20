/**
 * ConditionalPay TypeScript SDK Types
 * Strictly mirrors the frozen Cairo types from cairo/src/lib.cairo (commit 2b5f7a0).
 */

/**
 * Deterministic integer input type.
 * JavaScript `number` is deliberately omitted to prevent silent precision loss beyond Number.MAX_SAFE_INTEGER.
 */
export type BigIntish = bigint | string;

/**
 * Lifecycle states of a conditional payment.
 * UNINITIALIZED: 0, ACTIVE: 1, CLAIMED: 2, REFUNDED: 3
 */
export const PaymentState = {
  UNINITIALIZED: 0,
  ACTIVE: 1,
  CLAIMED: 2,
  REFUNDED: 3,
} as const;

export type PaymentState = (typeof PaymentState)[keyof typeof PaymentState];

/**
 * Action discriminants for ConditionalPay privacy_invoke dispatch.
 * Create: 0n, Claim: 1n, Refund: 2n
 */
export const ActionDiscriminant = {
  Create: 0n,
  Claim: 1n,
  Refund: 2n,
} as const;

export type ActionDiscriminant = (typeof ActionDiscriminant)[keyof typeof ActionDiscriminant];

/**
 * Parameters for creating a new conditional payment.
 * Note: No creator address is included (preserves contract privacy boundary).
 * JavaScript `number` is prohibited for all numeric inputs to prevent precision loss.
 */
export interface CreateParams {
  token: string; // ContractAddress (hex string)
  amount: BigIntish; // u128 token amount
  hashlock: string; // felt252 claim hashlock
  refund_hash: string; // felt252 refund hash
  claim_after: BigIntish; // u64 timestamp
  expires_at: BigIntish; // u64 timestamp (0 = no expiry)
  approver: string; // ContractAddress (0x0 if no approver)
  nonce: BigIntish; // felt252 client nonce for uniqueness
}

/**
 * Parameters for claiming an active conditional payment.
 * Note: No claimant address is included. Possessor of valid claim_preimage can claim.
 */
export interface ClaimParams {
  payment_id: string; // felt252 payment ID
  claim_preimage: BigIntish; // felt252 bearer secret
  note_id: BigIntish; // felt252 destination open note ID
}

/**
 * Parameters for refunding an expired conditional payment.
 * Note: No refunder address is included. Possessor of valid refund_preimage can refund after expiry.
 */
export interface RefundParams {
  payment_id: string; // felt252 payment ID
  refund_preimage: BigIntish; // felt252 bearer secret
  note_id: BigIntish; // felt252 destination open note ID
}

/**
 * Stored payment record on Starknet.
 */
export interface Payment {
  token: string;
  amount: bigint;
  hashlock: string;
  refund_hash: string;
  claim_after: bigint;
  expires_at: bigint;
  approver: string;
  approved: boolean;
  state: PaymentState;
}

/**
 * OpenNoteDeposit matches the STRK20 pool's expected positional Serde structure.
 */
export interface OpenNoteDeposit {
  note_id: string;
  token: string;
  amount: bigint;
}

/**
 * Discriminated union of actions supported by privacy_invoke.
 */
export type ConditionalPayAction =
  | { type: 'Create'; params: CreateParams }
  | { type: 'Claim'; params: ClaimParams }
  | { type: 'Refund'; params: RefundParams };
