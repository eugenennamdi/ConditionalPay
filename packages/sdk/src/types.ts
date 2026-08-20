/**
 * ConditionalPay TypeScript SDK Types
 * Strictly mirrors the frozen Cairo types from cairo/src/lib.cairo (commit 2b5f7a0)
 * and imports canonical STRK20 Privacy Wallet API action specifications.
 */

import type {
  STRK20_CALLDATA_ITEM,
  STRK20_CALLDATA_PLACEHOLDER,
  STRK20_DEPOSIT_ACTION,
  STRK20_INVOKE_ACTION,
  STRK20_TRANSFER_ACTION,
  STRK20_WITHDRAW_ACTION,
} from 'starknet';
import type { STRK20_ACTION } from '@starknet-io/types-js';

// Re-export canonical STRK20 types directly from installed packages
export type {
  STRK20_ACTION,
  STRK20_CALLDATA_ITEM,
  STRK20_CALLDATA_PLACEHOLDER,
  STRK20_DEPOSIT_ACTION,
  STRK20_INVOKE_ACTION,
  STRK20_TRANSFER_ACTION,
  STRK20_WITHDRAW_ACTION,
};

/**
 * Narrowed union of STRK20 Privacy Wallet API actions produced by ConditionalPay builders.
 * (Withdrawal for funding CREATE, OPEN Transfer and Contract Invoke for CLAIM/REFUND).
 */
export type ConditionalPayStrk20Action =
  | STRK20_WITHDRAW_ACTION
  | STRK20_TRANSFER_ACTION
  | STRK20_INVOKE_ACTION;

/**
 * Backward compatibility alias for ConditionalPayStrk20Action.
 */
export type Strk20Action = ConditionalPayStrk20Action;
export type Strk20WithdrawAction = STRK20_WITHDRAW_ACTION;
export type Strk20TransferAction = STRK20_TRANSFER_ACTION;
export type Strk20InvokeAction = STRK20_INVOKE_ACTION;
export type Strk20DepositAction = STRK20_DEPOSIT_ACTION;

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
 * Canonical STRK20 Wallet API placeholder for the first open note created in a transaction.
 * Substituted by the wallet with the actual allocated note ID during action assembly.
 */
export const OPEN_NOTE_ID_0 = '${openNoteIds[0]}' as const;
export type OpenNotePlaceholder = typeof OPEN_NOTE_ID_0;

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
 * Parameters for claiming an active conditional payment with a concrete note ID.
 * Note: No claimant address is included. Possessor of valid claim_preimage can claim.
 */
export interface ClaimParams {
  payment_id: BigIntish; // felt252 payment ID
  claim_preimage: BigIntish; // felt252 bearer secret
  note_id: BigIntish; // felt252 destination open note ID
}

/**
 * Parameters for refunding an expired conditional payment with a concrete note ID.
 * Note: No refunder address is included. Possessor of valid refund_preimage can refund after expiry.
 */
export interface RefundParams {
  payment_id: BigIntish; // felt252 payment ID
  refund_preimage: BigIntish; // felt252 bearer secret
  note_id: BigIntish; // felt252 destination open note ID
}

/**
 * Parameters for building STRK20 CLAIM actions via the Wallet API.
 *
 * TOKEN SOURCE RULE:
 * The `token` parameter must be the canonical ERC-20 token address read from the on-chain
 * Payment record for this `payment_id`, NOT an arbitrary UI selection.
 *
 * RECIPIENT SEMANTICS:
 * The `recipient` parameter is exclusively a Wallet API settlement-routing input specifying
 * the account for which the wallet allocates the destination open note in the privacy pool.
 * It is NEVER included in ConditionalPay CLAIM calldata, and ConditionalPay stores NO claimant address.
 */
export interface BuildClaimActionParams {
  payment_id: BigIntish; // felt252 payment ID
  claim_preimage: BigIntish; // felt252 bearer secret
  token: string; // ERC-20 token address from on-chain Payment record
  recipient: string; // Wallet API open-note recipient (routing only, not passed to contract)
}

/**
 * Parameters for building STRK20 REFUND actions via the Wallet API.
 *
 * TOKEN SOURCE RULE:
 * The `token` parameter must be the canonical ERC-20 token address read from the on-chain
 * Payment record for this `payment_id`, NOT an arbitrary UI selection.
 *
 * RECIPIENT SEMANTICS:
 * The `recipient` parameter is exclusively a Wallet API settlement-routing input specifying
 * the account for which the wallet allocates the destination open note in the privacy pool.
 * It is NEVER included in ConditionalPay REFUND calldata, and ConditionalPay stores NO refunder address.
 */
export interface BuildRefundActionParams {
  payment_id: BigIntish; // felt252 payment ID
  refund_preimage: BigIntish; // felt252 bearer secret
  token: string; // ERC-20 token address from on-chain Payment record
  recipient: string; // Wallet API open-note recipient (routing only, not passed to contract)
}

/**
 * Parameters for building standard Starknet approve(payment_id) call.
 */
export interface BuildApproveCallParams {
  conditionalPay: string; // ContractAddress of ConditionalPay contract
  paymentId: BigIntish; // felt252 payment ID
}

/**
 * Standard Starknet Contract Call representation (matches Starknet.js Call interface).
 */
export interface StandardCall {
  contractAddress: string;
  entrypoint: string;
  calldata: string[];
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
