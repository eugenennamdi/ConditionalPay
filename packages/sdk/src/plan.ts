import type {
  STRK20_INVOKE_ACTION,
  STRK20_TRANSFER_ACTION,
  STRK20_WITHDRAW_ACTION,
} from 'starknet';
import {
  buildClaimActions,
  buildCreateActions,
  buildRefundActions,
} from './actions.js';
import { validateContractAddress } from './encoding.js';
import {
  computeClaimHash,
  computePaymentId,
  computeRefundHash,
} from './hashing.js';
import {
  BigIntish,
  BuildClaimActionParams,
  BuildRefundActionParams,
  CreateParams,
} from './types.js';

/**
 * Configuration for an individual payment inside a multi-CREATE batch.
 */
export interface PaymentPlanConfig {
  amount: BigIntish; // e.g. 100000000000000000n (0.1 STRK)
  claim_after?: BigIntish; // Defaults to 0
  expires_at: BigIntish; // Timestamp in seconds
  approver?: string; // Defaults to '0x0'
  claim_preimage: BigIntish; // Bearer secret
  refund_preimage: BigIntish; // Bearer secret
  nonce: BigIntish; // Client nonce
}

/**
 * Output of TX1 preparation.
 */
export interface PreparedTx1Batch {
  actions: [
    STRK20_WITHDRAW_ACTION,
    STRK20_INVOKE_ACTION,
    STRK20_WITHDRAW_ACTION,
    STRK20_INVOKE_ACTION,
  ];
  paymentIdA: string;
  paymentIdB: string;
  hashlockA: string;
  refundHashA: string;
  hashlockB: string;
  refundHashB: string;
  createParamsA: CreateParams;
  createParamsB: CreateParams;
}

/**
 * Prepares the 4-action batch for TX1 (Multi-CREATE creating Payment A and Payment B).
 *
 * Sequence:
 *   1. [withdraw] Fund Payment A amount from pool to ConditionalPay
 *   2. [invoke]   ConditionalPay.privacy_invoke(Create(Payment A))
 *   3. [withdraw] Fund Payment B amount from pool to ConditionalPay
 *   4. [invoke]   ConditionalPay.privacy_invoke(Create(Payment B))
 *
 * @param params Object containing deployed ConditionalPay address, token, and configs for Payments A and B.
 * @returns Complete 4-action tuple, calculated payment IDs, and hashes.
 */
export function prepareTx1MultiCreateBatch(params: {
  conditionalPay: string;
  token: string;
  paymentA: PaymentPlanConfig;
  paymentB: PaymentPlanConfig;
}): PreparedTx1Batch {
  validateContractAddress(params.conditionalPay, 'conditionalPay');
  validateContractAddress(params.token, 'token');

  // 1. Payment A params & ID computation
  const hashlockA = computeClaimHash(params.paymentA.claim_preimage);
  const refundHashA = computeRefundHash(params.paymentA.refund_preimage);
  const createParamsA: CreateParams = {
    token: params.token,
    amount: params.paymentA.amount,
    hashlock: hashlockA,
    refund_hash: refundHashA,
    claim_after: params.paymentA.claim_after ?? 0n,
    expires_at: params.paymentA.expires_at,
    approver: params.paymentA.approver ?? '0x0',
    nonce: params.paymentA.nonce,
  };
  const paymentIdA = computePaymentId(createParamsA);

  // 2. Payment B params & ID computation
  const hashlockB = computeClaimHash(params.paymentB.claim_preimage);
  const refundHashB = computeRefundHash(params.paymentB.refund_preimage);
  const createParamsB: CreateParams = {
    token: params.token,
    amount: params.paymentB.amount,
    hashlock: hashlockB,
    refund_hash: refundHashB,
    claim_after: params.paymentB.claim_after ?? 0n,
    expires_at: params.paymentB.expires_at,
    approver: params.paymentB.approver ?? '0x0',
    nonce: params.paymentB.nonce,
  };
  const paymentIdB = computePaymentId(createParamsB);

  // 3. Compose interleaved action sequence
  const actionsA = buildCreateActions(params.conditionalPay, createParamsA);
  const actionsB = buildCreateActions(params.conditionalPay, createParamsB);

  const actions: [
    STRK20_WITHDRAW_ACTION,
    STRK20_INVOKE_ACTION,
    STRK20_WITHDRAW_ACTION,
    STRK20_INVOKE_ACTION,
  ] = [actionsA[0], actionsA[1], actionsB[0], actionsB[1]];

  return {
    actions,
    paymentIdA,
    paymentIdB,
    hashlockA,
    refundHashA,
    hashlockB,
    refundHashB,
    createParamsA,
    createParamsB,
  };
}

/**
 * Prepares the 2-action batch for TX2 (CLAIM Payment A).
 * Sourcing rule: `params.token` must be authoritatively read from the on-chain Payment record.
 */
export function prepareTx2Claim(
  conditionalPay: string,
  params: BuildClaimActionParams,
): [STRK20_TRANSFER_ACTION, STRK20_INVOKE_ACTION] {
  return buildClaimActions(conditionalPay, params);
}

/**
 * Prepares the 2-action batch for TX3 (REFUND Payment B).
 * Sourcing rule: `params.token` must be authoritatively read from the on-chain Payment record.
 */
export function prepareTx3Refund(
  conditionalPay: string,
  params: BuildRefundActionParams,
): [STRK20_TRANSFER_ACTION, STRK20_INVOKE_ACTION] {
  return buildRefundActions(conditionalPay, params);
}

/**
 * Sequential Balance Progression across the 3-transaction validation flow.
 */
export interface SequentialBalanceProgression {
  startingBalance: bigint;
  feePerTx: bigint;
  principalA: bigint;
  principalB: bigint;
  afterTx1: bigint;
  afterTx2: bigint;
  afterTx3: bigint;
  theoreticalMinimumStart: bigint;
  conservativePlanStart: bigint;
}

/**
 * Models the sequential shielded balance progression across TX1, TX2, and TX3.
 *
 * Sequence:
 *   1. Initial starting balance: S
 *   2. After TX1 (Multi-CREATE): S - (fee + principalA + principalB)
 *   3. After TX2 (CLAIM A):      (S - fee - principalA - principalB) - fee + principalA
 *                                = S - (2 * fee) - principalB
 *   4. After TX3 (REFUND B):     (S - 2 * fee - principalB) - fee + principalB
 *                                = S - (3 * fee)
 *
 * Theoretical Sequential Minimum:
 *   Before TX3, shielded balance must be >= fee.
 *   (S - 2 * fee - principalB) >= fee
 *   S >= (3 * fee) + principalB
 *   With fee = 6.0 STRK, principalB = 0.1 STRK -> S >= 18.1 STRK.
 */
export function calculateSequentialBalanceModel(
  startingBalance: BigIntish,
  feePerTx: BigIntish,
  principalA: BigIntish,
  principalB: BigIntish,
  safetyBuffer: BigIntish = 0n,
): SequentialBalanceProgression {
  const S = BigInt(startingBalance);
  const F = BigInt(feePerTx);
  const A = BigInt(principalA);
  const B = BigInt(principalB);
  const buffer = BigInt(safetyBuffer);

  const afterTx1 = S - (F + A + B);
  const afterTx2 = afterTx1 - F + A;
  const afterTx3 = afterTx2 - F + B;

  const theoreticalMinimumStart = F * 3n + B;
  const conservativePlanStart = F * 3n + A + B + buffer;

  return {
    startingBalance: S,
    feePerTx: F,
    principalA: A,
    principalB: B,
    afterTx1,
    afterTx2,
    afterTx3,
    theoreticalMinimumStart,
    conservativePlanStart,
  };
}

/**
 * Calculates the dynamic gross shielded STRK balance required to execute the full 3-transaction flow.
 *
 * Formula:
 *   Tx 1 requires: feeAmount + principalA + principalB
 *   Tx 2 requires: feeAmount (principal is funded from contract)
 *   Tx 3 requires: feeAmount (principal is funded from contract)
 *   Total = (feeAmount * 3) + principalA + principalB + safetyBuffer
 *
 * @param feeAmount Current dynamic protocol fee read from pool (in wei base units).
 * @param principalA Principal amount for Payment A (in wei base units).
 * @param principalB Principal amount for Payment B (in wei base units).
 * @param safetyBuffer Optional safety buffer amount (in wei base units).
 * @returns Total required shielded balance in wei base units as bigint.
 */
export function calculateRequiredShieldedBalance(
  feeAmount: BigIntish,
  principalA: BigIntish,
  principalB: BigIntish,
  safetyBuffer: BigIntish = 0n,
): bigint {
  const fee = BigInt(feeAmount);
  const a = BigInt(principalA);
  const b = BigInt(principalB);
  const buffer = BigInt(safetyBuffer);

  return fee * 3n + a + b + buffer;
}
