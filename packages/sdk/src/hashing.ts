import { hash, num } from 'starknet';
import { BigIntish, CreateParams } from './types.js';

/**
 * Domain separation constants matching the frozen Cairo implementation:
 * - domains::CONDITIONALPAY_CLAIM_V1 = 'CONDITIONALPAY_CLAIM_V1'
 * - domains::CONDITIONALPAY_REFUND_V1 = 'CONDITIONALPAY_REFUND_V1'
 * - domains::CONDITIONALPAY_PAYMENT_V1 = 'CONDITIONALPAY_PAYMENT_V1'
 */
export const DOMAINS = {
  CONDITIONALPAY_CLAIM_V1: '0x434f4e444954494f4e414c5041595f434c41494d5f5631',
  CONDITIONALPAY_REFUND_V1: '0x434f4e444954494f4e414c5041595f524546554e445f5631',
  CONDITIONALPAY_PAYMENT_V1: '0x434f4e444954494f4e414c5041595f5041594d454e545f5631',
} as const;

/**
 * Normalizes a BigIntish (hex string, decimal string, or bigint) to a standard lowercase 0x hex string.
 * Unsafe JavaScript `number` is strictly rejected to prevent precision loss beyond Number.MAX_SAFE_INTEGER.
 */
export function normalizeFelt(value: BigIntish): string {
  if (typeof value === 'number') {
    throw new TypeError(
      `Unsafe JavaScript number '${value}' rejected. Use bigint or string to prevent silent precision loss.`,
    );
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') {
      throw new TypeError(`Cannot normalize empty string as felt`);
    }
  }

  try {
    const bi = num.toBigInt(value);
    if (bi < 0n) {
      throw new RangeError(`Felt value cannot be negative: ${value}`);
    }
    return num.toHex(bi).toLowerCase();
  } catch (err: unknown) {
    if (err instanceof RangeError || err instanceof TypeError) {
      throw err;
    }
    if (err instanceof Error) {
      throw new Error(`Failed to normalize felt '${value}': ${err.message}`);
    }
    throw new Error(`Failed to normalize felt '${value}'`);
  }
}

/**
 * Computes the domain-separated Poseidon claim hashlock from a bearer preimage.
 *
 * Formula:
 *   Poseidon([ 'CONDITIONALPAY_CLAIM_V1', claim_preimage ])
 *
 * @param claimPreimage The secret preimage (bigint or string) used to authorize claiming.
 * @returns The hex-encoded felt252 hashlock.
 */
export function computeClaimHash(claimPreimage: BigIntish): string {
  const normalizedPreimage = normalizeFelt(claimPreimage);
  const result = hash.computePoseidonHashOnElements([
    DOMAINS.CONDITIONALPAY_CLAIM_V1,
    normalizedPreimage,
  ]);
  return normalizeFelt(result);
}

/**
 * Computes the domain-separated Poseidon refund hash from a bearer preimage.
 *
 * Formula:
 *   Poseidon([ 'CONDITIONALPAY_REFUND_V1', refund_preimage ])
 *
 * @param refundPreimage The secret preimage (bigint or string) used to authorize refunding after expiry.
 * @returns The hex-encoded felt252 refund_hash.
 */
export function computeRefundHash(refundPreimage: BigIntish): string {
  const normalizedPreimage = normalizeFelt(refundPreimage);
  const result = hash.computePoseidonHashOnElements([
    DOMAINS.CONDITIONALPAY_REFUND_V1,
    normalizedPreimage,
  ]);
  return normalizeFelt(result);
}

/**
 * Computes the unique, deterministic 9-element Poseidon payment ID.
 *
 * Formula:
 *   Poseidon([
 *     'CONDITIONALPAY_PAYMENT_V1',
 *     token,
 *     amount,
 *     hashlock,
 *     refund_hash,
 *     claim_after,
 *     expires_at,
 *     approver,
 *     nonce
 *   ])
 *
 * Note: Creator/claimant identities and pool addresses are deliberately excluded
 * to preserve contract privacy boundaries.
 *
 * @param params The typed payment creation parameters.
 * @returns The hex-encoded felt252 payment ID.
 */
export function computePaymentId(params: CreateParams): string {
  const elements = [
    DOMAINS.CONDITIONALPAY_PAYMENT_V1,
    normalizeFelt(params.token),
    normalizeFelt(params.amount),
    normalizeFelt(params.hashlock),
    normalizeFelt(params.refund_hash),
    normalizeFelt(params.claim_after),
    normalizeFelt(params.expires_at),
    normalizeFelt(params.approver),
    normalizeFelt(params.nonce),
  ];

  const result = hash.computePoseidonHashOnElements(elements);
  return normalizeFelt(result);
}
