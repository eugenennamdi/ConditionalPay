import type { BlockIdentifier, ProviderInterface } from 'starknet';
import {
  validateContractAddress,
  validateFelt,
  validateU128,
  validateU64,
} from './encoding.js';
import { normalizeFelt } from './hashing.js';
import {
  BigIntish,
  CreateParams,
  Payment,
  PaymentState,
} from './types.js';

/**
 * Minimal interface for Starknet contract view call execution.
 * Compatible with `starknet.RpcProvider`, `starknet.ProviderInterface`, and mocked test clients.
 */
export interface CallContractProvider {
  callContract(
    call: { contractAddress: string; entrypoint: string; calldata?: string[] },
    blockIdentifier?: BlockIdentifier,
  ): Promise<string[]>;
}

/**
 * Strict decoder for Cairo core::bool values (0 = false, 1 = true).
 * Strictly throws RangeError if any other numeric value is encountered.
 */
export function decodeCairoBool(raw: string, fieldName = 'bool'): boolean {
  let val: bigint;
  try {
    val = BigInt(raw);
  } catch {
    throw new TypeError(`Invalid boolean encoding for ${fieldName}: ${raw}`);
  }

  if (val === 0n) {
    return false;
  }
  if (val === 1n) {
    return true;
  }
  throw new RangeError(
    `Invalid boolean value for ${fieldName}: expected 0 or 1, received ${raw}`,
  );
}

/**
 * Reads the canonical on-chain payment record from ConditionalPay.
 *
 * @param provider Starknet provider / reader client.
 * @param conditionalPay Contract address of ConditionalPay.
 * @param paymentId Deterministic 32-byte felt252 payment ID.
 * @param blockIdentifier Optional block tag/hash/number for historical read.
 * @returns Normalized `Payment` record.
 */
export async function getPayment(
  provider: CallContractProvider | ProviderInterface,
  conditionalPay: string,
  paymentId: BigIntish,
  blockIdentifier?: BlockIdentifier,
): Promise<Payment> {
  validateContractAddress(conditionalPay, 'conditionalPay');
  validateFelt(paymentId, 'paymentId');

  const raw = await provider.callContract(
    {
      contractAddress: normalizeFelt(conditionalPay),
      entrypoint: 'get_payment',
      calldata: [normalizeFelt(paymentId)],
    },
    blockIdentifier,
  );

  if (!raw || raw.length !== 9) {
    throw new Error(
      `Invalid get_payment response: expected exactly 9 felts, received ${raw ? raw.length : 0}`,
    );
  }

  const token = normalizeFelt(raw[0]);
  validateContractAddress(token, 'token');

  const amount = validateU128(raw[1], 'amount');
  const hashlock = normalizeFelt(raw[2]);
  const refund_hash = normalizeFelt(raw[3]);
  const claim_after = validateU64(raw[4], 'claim_after');
  const expires_at = validateU64(raw[5], 'expires_at');
  const approver = normalizeFelt(raw[6]);
  validateContractAddress(approver, 'approver');

  const approved = decodeCairoBool(raw[7], 'approved');

  const rawState = BigInt(raw[8]);
  let state: PaymentState;
  switch (rawState) {
    case 0n:
      state = PaymentState.UNINITIALIZED;
      break;
    case 1n:
      state = PaymentState.ACTIVE;
      break;
    case 2n:
      state = PaymentState.CLAIMED;
      break;
    case 3n:
      state = PaymentState.REFUNDED;
      break;
    default:
      throw new RangeError(
        `Unknown or invalid PaymentState discriminant from contract: ${raw[8]}`,
      );
  }

  return {
    token,
    amount,
    hashlock,
    refund_hash,
    claim_after,
    expires_at,
    approver,
    approved,
    state,
  };
}

/**
 * Reads the total locked liability for a specific ERC-20 token in ConditionalPay.
 *
 * @param provider Starknet provider / reader client.
 * @param conditionalPay Contract address of ConditionalPay.
 * @param token ERC-20 token contract address.
 * @param blockIdentifier Optional block identifier.
 * @returns Total locked u128 balance as bigint.
 */
export async function getLockedByToken(
  provider: CallContractProvider | ProviderInterface,
  conditionalPay: string,
  token: string,
  blockIdentifier?: BlockIdentifier,
): Promise<bigint> {
  validateContractAddress(conditionalPay, 'conditionalPay');
  validateContractAddress(token, 'token');

  const raw = await provider.callContract(
    {
      contractAddress: normalizeFelt(conditionalPay),
      entrypoint: 'get_locked_by_token',
      calldata: [normalizeFelt(token)],
    },
    blockIdentifier,
  );

  if (!raw || raw.length !== 1) {
    throw new Error(
      `Invalid get_locked_by_token response: expected exactly 1 felt, received ${raw ? raw.length : 0}`,
    );
  }

  return validateU128(raw[0], 'locked_amount');
}

/**
 * Reads the immutable STRK20 privacy pool contract address configured on ConditionalPay.
 *
 * @param provider Starknet provider / reader client.
 * @param conditionalPay Contract address of ConditionalPay.
 * @param blockIdentifier Optional block identifier.
 * @returns Normalized STRK20 pool contract address.
 */
export async function getStrk20Pool(
  provider: CallContractProvider | ProviderInterface,
  conditionalPay: string,
  blockIdentifier?: BlockIdentifier,
): Promise<string> {
  validateContractAddress(conditionalPay, 'conditionalPay');

  const raw = await provider.callContract(
    {
      contractAddress: normalizeFelt(conditionalPay),
      entrypoint: 'get_strk20_pool',
      calldata: [],
    },
    blockIdentifier,
  );

  if (!raw || raw.length !== 1) {
    throw new Error(
      `Invalid get_strk20_pool response: expected exactly 1 felt, received ${raw ? raw.length : 0}`,
    );
  }

  const pool = normalizeFelt(raw[0]);
  validateContractAddress(pool, 'strk20_pool');
  return pool;
}

/**
 * Computes a payment ID on-chain via ConditionalPay.compute_payment_id(params).
 * Intended for cross-checking local `computePaymentId` against the contract implementation.
 *
 * @param provider Starknet provider / reader client.
 * @param conditionalPay Contract address of ConditionalPay.
 * @param params Payment creation parameters.
 * @param blockIdentifier Optional block identifier.
 * @returns Calculated felt252 payment ID.
 */
export async function computePaymentIdOnchain(
  provider: CallContractProvider | ProviderInterface,
  conditionalPay: string,
  params: CreateParams,
  blockIdentifier?: BlockIdentifier,
): Promise<string> {
  validateContractAddress(conditionalPay, 'conditionalPay');
  validateContractAddress(params.token, 'token');
  validateU128(params.amount, 'amount');
  validateFelt(params.hashlock, 'hashlock');
  validateFelt(params.refund_hash, 'refund_hash');
  validateU64(params.claim_after, 'claim_after');
  validateU64(params.expires_at, 'expires_at');
  validateContractAddress(params.approver, 'approver');
  validateFelt(params.nonce, 'nonce');

  const calldata = [
    normalizeFelt(params.token),
    normalizeFelt(params.amount),
    normalizeFelt(params.hashlock),
    normalizeFelt(params.refund_hash),
    normalizeFelt(params.claim_after),
    normalizeFelt(params.expires_at),
    normalizeFelt(params.approver),
    normalizeFelt(params.nonce),
  ];

  const raw = await provider.callContract(
    {
      contractAddress: normalizeFelt(conditionalPay),
      entrypoint: 'compute_payment_id',
      calldata,
    },
    blockIdentifier,
  );

  if (!raw || raw.length !== 1) {
    throw new Error(
      `Invalid compute_payment_id response: expected exactly 1 felt, received ${raw ? raw.length : 0}`,
    );
  }

  return normalizeFelt(raw[0]);
}

/**
 * Checks whether a payment record is initialized (state !== UNINITIALIZED).
 */
export function isPaymentInitialized(payment: Payment): boolean {
  return payment.state !== PaymentState.UNINITIALIZED;
}

/**
 * Checks whether a payment is currently in the ACTIVE state.
 */
export function isPaymentActive(payment: Payment): boolean {
  return payment.state === PaymentState.ACTIVE;
}

/**
 * Checks whether a payment has an approval gate configured (approver !== 0x0).
 * Indicates that the payment configuration requires third-party sign-off.
 */
export function isApprovalGated(payment: Payment): boolean {
  return BigInt(payment.approver) !== 0n;
}

/**
 * Checks whether third-party approval is currently still required before claiming.
 * True if an approver is configured and the payment has not yet been approved.
 */
export function requiresApproval(payment: Payment): boolean {
  return isApprovalGated(payment) && !payment.approved;
}
