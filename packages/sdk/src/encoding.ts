import { constants, num } from 'starknet';
import { normalizeFelt } from './hashing.js';
import {
  ActionDiscriminant,
  BigIntish,
  ClaimParams,
  ConditionalPayAction,
  CreateParams,
  OPEN_NOTE_ID_0,
  RefundParams,
} from './types.js';

export const U128_MAX = 0xffffffffffffffffffffffffffffffffn; // 2^128 - 1
export const U64_MAX = 0xffffffffffffffffn; // 2^64 - 1
export const STARKNET_PRIME = BigInt(constants.PRIME); // 2^251 + 17*2^192 + 1
export const CONTRACT_ADDRESS_MAX = (1n << 251n) - 1n; // 2^251 - 1 = 0x7ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffn

/**
 * Validates that an address is BigIntish and fits within the Cairo ContractAddress range [0, 2^251 - 1].
 */
export function validateContractAddress(value: BigIntish, name: string): bigint {
  if (typeof value === 'number') {
    throw new TypeError(
      `Unsafe JavaScript number for '${name}': '${value}'. Use string or bigint to avoid precision loss.`,
    );
  }

  let bi: bigint;
  try {
    bi = num.toBigInt(value);
  } catch (err: unknown) {
    if (err instanceof Error) {
      throw new TypeError(`Invalid address format for '${name}': ${err.message}`);
    }
    throw new TypeError(`Invalid address format for '${name}'`);
  }

  if (bi < 0n || bi > CONTRACT_ADDRESS_MAX) {
    throw new RangeError(
      `${name} out of ContractAddress range [0, 0x7ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff]: ${value}`,
    );
  }
  return bi;
}

/**
 * Validates that a numeric value is BigIntish (not JavaScript number) and fits within the felt252 field [0, PRIME).
 */
export function validateFelt(value: BigIntish, name: string): bigint {
  if (typeof value === 'number') {
    throw new TypeError(
      `Unsafe JavaScript number for '${name}': '${value}'. Use bigint or string to avoid precision loss.`,
    );
  }

  let bi: bigint;
  try {
    bi = num.toBigInt(value);
  } catch (err: unknown) {
    if (err instanceof Error) {
      throw new TypeError(`Invalid felt format for '${name}': ${err.message}`);
    }
    throw new TypeError(`Invalid felt format for '${name}'`);
  }

  if (bi < 0n || bi >= STARKNET_PRIME) {
    throw new RangeError(
      `${name} out of felt252 range [0, 0x800000000000011000000000000000000000000000000000000000000000001): ${value}`,
    );
  }
  return bi;
}

/**
 * Validates that a numeric value is BigIntish (not JavaScript number) and fits within u128 [0, 2^128 - 1].
 */
export function validateU128(value: BigIntish, name: string): bigint {
  if (typeof value === 'number') {
    throw new TypeError(
      `Unsafe JavaScript number for '${name}': '${value}'. Use bigint or string to avoid precision loss.`,
    );
  }

  let bi: bigint;
  try {
    bi = num.toBigInt(value);
  } catch (err: unknown) {
    if (err instanceof Error) {
      throw new TypeError(`Invalid integer format for '${name}': ${err.message}`);
    }
    throw new TypeError(`Invalid integer format for '${name}'`);
  }

  if (bi < 0n || bi > U128_MAX) {
    throw new RangeError(`${name} out of u128 range [0, 2^128 - 1]: ${value}`);
  }
  return bi;
}

/**
 * Validates that a numeric value is BigIntish (not JavaScript number) and fits within u64 [0, 2^64 - 1].
 */
export function validateU64(value: BigIntish, name: string): bigint {
  if (typeof value === 'number') {
    throw new TypeError(
      `Unsafe JavaScript number for '${name}': '${value}'. Use bigint or string to avoid precision loss.`,
    );
  }

  let bi: bigint;
  try {
    bi = num.toBigInt(value);
  } catch (err: unknown) {
    if (err instanceof Error) {
      throw new TypeError(`Invalid integer format for '${name}': ${err.message}`);
    }
    throw new TypeError(`Invalid integer format for '${name}'`);
  }

  if (bi < 0n || bi > U64_MAX) {
    throw new RangeError(`${name} out of u64 range [0, 2^64 - 1]: ${value}`);
  }
  return bi;
}

/**
 * Encodes CreateParams into calldata matching Cairo Serde representation:
 * [
 *   0, // Create discriminant
 *   token,
 *   amount,
 *   hashlock,
 *   refund_hash,
 *   claim_after,
 *   expires_at,
 *   approver,
 *   nonce
 * ]
 */
export function encodeCreateCalldata(params: CreateParams): string[] {
  validateContractAddress(params.token, 'token');
  validateU128(params.amount, 'amount');
  validateFelt(params.hashlock, 'hashlock');
  validateFelt(params.refund_hash, 'refund_hash');
  validateU64(params.claim_after, 'claim_after');
  validateU64(params.expires_at, 'expires_at');
  validateContractAddress(params.approver, 'approver');
  validateFelt(params.nonce, 'nonce');

  return [
    normalizeFelt(ActionDiscriminant.Create),
    normalizeFelt(params.token),
    normalizeFelt(params.amount),
    normalizeFelt(params.hashlock),
    normalizeFelt(params.refund_hash),
    normalizeFelt(params.claim_after),
    normalizeFelt(params.expires_at),
    normalizeFelt(params.approver),
    normalizeFelt(params.nonce),
  ];
}

/**
 * Encodes ClaimParams into calldata with concrete note_id matching Cairo Serde representation:
 * [
 *   1, // Claim discriminant
 *   payment_id,
 *   claim_preimage,
 *   note_id
 * ]
 */
export function encodeClaimCalldata(params: ClaimParams): string[] {
  validateFelt(params.payment_id, 'payment_id');
  validateFelt(params.claim_preimage, 'claim_preimage');
  validateFelt(params.note_id, 'note_id');

  return [
    normalizeFelt(ActionDiscriminant.Claim),
    normalizeFelt(params.payment_id),
    normalizeFelt(params.claim_preimage),
    normalizeFelt(params.note_id),
  ];
}

/**
 * Encodes RefundParams into calldata with concrete note_id matching Cairo Serde representation:
 * [
 *   2, // Refund discriminant
 *   payment_id,
 *   refund_preimage,
 *   note_id
 * ]
 */
export function encodeRefundCalldata(params: RefundParams): string[] {
  validateFelt(params.payment_id, 'payment_id');
  validateFelt(params.refund_preimage, 'refund_preimage');
  validateFelt(params.note_id, 'note_id');

  return [
    normalizeFelt(ActionDiscriminant.Refund),
    normalizeFelt(params.payment_id),
    normalizeFelt(params.refund_preimage),
    normalizeFelt(params.note_id),
  ];
}

/**
 * Encodes Claim calldata targeting the Wallet API open-note placeholder `${openNoteIds[0]}`.
 * Strictly binds the placeholder only to the note_id argument.
 */
export function encodeClaimWithPlaceholderCalldata(params: {
  payment_id: BigIntish;
  claim_preimage: BigIntish;
}): string[] {
  validateFelt(params.payment_id, 'payment_id');
  validateFelt(params.claim_preimage, 'claim_preimage');

  return [
    normalizeFelt(ActionDiscriminant.Claim),
    normalizeFelt(params.payment_id),
    normalizeFelt(params.claim_preimage),
    OPEN_NOTE_ID_0,
  ];
}

/**
 * Encodes Refund calldata targeting the Wallet API open-note placeholder `${openNoteIds[0]}`.
 * Strictly binds the placeholder only to the note_id argument.
 */
export function encodeRefundWithPlaceholderCalldata(params: {
  payment_id: BigIntish;
  refund_preimage: BigIntish;
}): string[] {
  validateFelt(params.payment_id, 'payment_id');
  validateFelt(params.refund_preimage, 'refund_preimage');

  return [
    normalizeFelt(ActionDiscriminant.Refund),
    normalizeFelt(params.payment_id),
    normalizeFelt(params.refund_preimage),
    OPEN_NOTE_ID_0,
  ];
}

/**
 * Encodes a ConditionalPayAction into its corresponding positional calldata array.
 */
export function encodeActionCalldata(action: ConditionalPayAction): string[] {
  switch (action.type) {
    case 'Create':
      return encodeCreateCalldata(action.params);
    case 'Claim':
      return encodeClaimCalldata(action.params);
    case 'Refund':
      return encodeRefundCalldata(action.params);
    default: {
      const exhaustiveCheck: never = action;
      throw new Error(`Unsupported action type: ${(exhaustiveCheck as { type: string }).type}`);
    }
  }
}
