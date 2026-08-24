import {
  buildCreateActions,
  computeClaimHash,
  computePaymentId,
  computeRefundHash,
  generateSecureNonce,
  generateSecurePreimage,
  getPayment,
  normalizeFelt,
  parseConditionalPayEvents,
  type Payment,
  type PaymentCreatedEvent,
  PaymentState,
} from '@conditionalpay/sdk';
import { walletV6, type ProviderInterface } from 'starknet';
import type { WalletWithStarknetFeatures } from '@starknet-io/get-starknet-wallet-standard/features';
import type { ClaimChoice, CreateFormData, PlannedCreate, RefundPreset } from './createTypes';

export const CONDITIONAL_PAY_MAINNET =
  '0x0166e31803cfab50383d5b636b86a5646233881fad3a2fb89354da63f6cdb483' as const;
export const STRK_MAINNET =
  '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d' as const;
export const STRK20_POOL_MAINNET =
  '0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a' as const;

export const U128_MAX = (1n << 128n) - 1n;
export const U64_MAX = (1n << 64n) - 1n;
export const STRK_DECIMALS = 18;

/**
 * Pure predicate defining when the permanent-loss navigation guard must be active.
 *
 * Invariant: Must NOT activate in EDITING or REVIEWING (where no onchain transaction exists).
 * Must activate from AWAITING_WALLET through post-write states while backupSaved is false.
 */
export function shouldActivateNavigationGuard(
  step: string,
  backupSaved: boolean,
  hasPlannedCreate: boolean,
): boolean {
  if (backupSaved) return false;
  if (!hasPlannedCreate) return false;

  return (
    step === 'AWAITING_WALLET' ||
    step === 'SUBMITTED' ||
    step === 'PENDING' ||
    step === 'STATUS_UNKNOWN' ||
    step === 'ACCEPTED' ||
    step === 'VERIFYING' ||
    step === 'VERIFIED' ||
    step === 'DEGRADED_VERIFICATION'
  );
}

export interface StarknetReceiptStatus {
  execution_status?: string;
  finality_status?: string;
  status?: string;
}

/**
 * Evaluates whether a Starknet transaction receipt represents an accepted onchain transaction.
 *
 * Invariants:
 * 1. Must NOT be REVERTED in execution_status or legacy status.
 * 2. Must prove finality: finality_status must be 'ACCEPTED_ON_L2' or 'ACCEPTED_ON_L1'.
 * 3. If execution_status is present, it must be 'SUCCEEDED'.
 */
export function isReceiptAccepted(receipt: StarknetReceiptStatus | null | undefined): boolean {
  if (!receipt) return false;

  // Revert check
  if (receipt.execution_status === 'REVERTED' || receipt.status === 'REVERTED') {
    return false;
  }

  // Finality check: Must be explicitly ACCEPTED_ON_L2 or ACCEPTED_ON_L1
  const isFinal =
    receipt.finality_status === 'ACCEPTED_ON_L2' ||
    receipt.finality_status === 'ACCEPTED_ON_L1';

  if (!isFinal) {
    return false;
  }

  // If execution_status is provided, require SUCCEEDED
  if (receipt.execution_status && receipt.execution_status !== 'SUCCEEDED') {
    return false;
  }

  return true;
}

/**
 * Evaluates whether a Starknet transaction receipt represents a definitive onchain revert.
 */
export function isReceiptReverted(receipt: StarknetReceiptStatus | null | undefined): boolean {
  if (!receipt) return false;
  return receipt.execution_status === 'REVERTED' || receipt.status === 'REVERTED';
}

/**
 * Parses a human-readable STRK amount string into a 18-decimal bigint.
 * Rejects JS Number inputs, floats, scientific notation, commas, negative values, 0, >18 decimals, and u128 overflow.
 */
export function parseStrkAmount(amountStr: string): bigint {
  if (typeof amountStr !== 'string') {
    throw new TypeError('Amount must be a string to prevent precision loss.');
  }

  const trimmed = amountStr.trim();
  if (!trimmed) {
    throw new Error('Amount is required.');
  }

  if (trimmed.includes('e') || trimmed.includes('E')) {
    throw new Error('Scientific notation is not supported. Enter a standard decimal amount.');
  }

  if (trimmed.startsWith('-')) {
    throw new Error('Amount must be positive.');
  }

  if (trimmed.includes(',')) {
    throw new Error('Invalid format: commas are not supported.');
  }

  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(trimmed)) {
    if (/\.\d{19,}$/.test(trimmed)) {
      throw new Error('Maximum 18 decimal places supported.');
    }
    throw new Error('Invalid amount format. Enter a valid number like 0.1 or 10.');
  }

  const [wholeStr, fractionalStr = ''] = trimmed.split('.');
  const whole = BigInt(wholeStr);
  const fractionalPadded = fractionalStr.padEnd(STRK_DECIMALS, '0');
  const fractional = BigInt(fractionalPadded);

  const totalWei = whole * 10n ** BigInt(STRK_DECIMALS) + fractional;
  if (totalWei === 0n) {
    throw new Error('Amount must be greater than zero.');
  }

  if (totalWei > U128_MAX) {
    throw new Error('Amount exceeds maximum integer capacity (u128 overflow).');
  }

  return totalWei;
}

/**
 * Formats a 18-decimal bigint back to a human-readable string without trailing zeroes.
 */
export function formatStrkAmount(wei: bigint): string {
  if (typeof wei !== 'bigint') {
    throw new TypeError('wei must be a bigint');
  }
  const divisor = 10n ** BigInt(STRK_DECIMALS);
  const whole = wei / divisor;
  const rem = wei % divisor;
  if (rem === 0n) {
    return whole.toString();
  }
  const remStr = rem.toString().padStart(STRK_DECIMALS, '0').replace(/0+$/, '');
  return `${whole}.${remStr}`;
}

/**
 * Formats Unix seconds timestamp into a clean human readable string.
 */
export function formatTimestamp(seconds: number): string {
  const date = new Date(seconds * 1000);
  const day = date.getDate();
  const month = date.toLocaleString('en-US', { month: 'short' });
  const year = date.getFullYear();
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${day} ${month} ${year} · ${hours}:${minutes}`;
}

/**
 * Pure calculation helper for claim and refund timestamps.
 */
export function calculateTimestamps(
  claimChoice: ClaimChoice,
  customClaimDate: string,
  refundPreset: RefundPreset,
  customRefundDate: string,
  chainNowSeconds?: number,
): {
  claim_after: bigint;
  expires_at: bigint;
  claimDateFormatted: string;
  refundDateFormatted: string;
} {
  const nowSec = chainNowSeconds !== undefined ? chainNowSeconds : Math.floor(Date.now() / 1000);

  let claim_after = 0n;
  let claimDateFormatted = 'Immediately';

  if (claimChoice === 'custom') {
    if (!customClaimDate) {
      throw new Error('Custom claim date & time is required.');
    }
    const parsedClaimTime = Math.floor(new Date(customClaimDate).getTime() / 1000);
    if (isNaN(parsedClaimTime) || parsedClaimTime <= 0) {
      throw new Error('Invalid claim date format.');
    }
    if (parsedClaimTime <= nowSec) {
      throw new Error('Claim date must be in the future.');
    }
    if (BigInt(parsedClaimTime) > U64_MAX) {
      throw new Error('Claim timestamp exceeds u64 maximum.');
    }
    claim_after = BigInt(parsedClaimTime);
    claimDateFormatted = formatTimestamp(parsedClaimTime);
  }

  const baseTime = claim_after === 0n ? nowSec : Number(claim_after);
  let expires_at = 0n;

  if (refundPreset === '1h') {
    expires_at = BigInt(baseTime + 3600);
  } else if (refundPreset === '24h') {
    expires_at = BigInt(baseTime + 86400);
  } else if (refundPreset === '7d') {
    expires_at = BigInt(baseTime + 604800);
  } else if (refundPreset === 'custom') {
    if (!customRefundDate) {
      throw new Error('Refund date & time is required.');
    }
    const parsedRefundTime = Math.floor(new Date(customRefundDate).getTime() / 1000);
    if (isNaN(parsedRefundTime) || parsedRefundTime <= 0) {
      throw new Error('Invalid refund date format.');
    }
    if (parsedRefundTime <= baseTime) {
      throw new Error('Refund date must be after claim availability time.');
    }
    if (parsedRefundTime <= nowSec) {
      throw new Error('Refund date must be in the future.');
    }
    if (BigInt(parsedRefundTime) > U64_MAX) {
      throw new Error('Refund timestamp exceeds u64 maximum.');
    }
    expires_at = BigInt(parsedRefundTime);
  }

  const refundDateFormatted = formatTimestamp(Number(expires_at));

  return {
    claim_after,
    expires_at,
    claimDateFormatted,
    refundDateFormatted,
  };
}

/**
 * Normalizes wallet and RPC errors into concise, safe human-readable messages.
 * Never leaks raw stack traces, secrets, or internal memory structures.
 *
 * Precedence Order:
 * 1. Verified structured user-refusal code (Starknet standard code 113 USER_REFUSED_OP, EIP-1193 code 4001)
 * 2. Specific readiness / fee conditions (must precede textual matching so fee errors are never swallowed)
 * 3. Explicit textual USER cancellation signals (strictly requiring explicit attribution to user)
 * 4. Specific known wallet/privacy conditions (codes 118, 119, 162 from @starknet-io/starknet-types)
 * 5. Safe generic fallback
 */
export function normalizeWalletError(err: unknown): string {
  if (!err) return 'Unable to create payment. Review Ready Wallet and try again.';

  let code: number | string | undefined;
  let message = '';
  let name = '';

  if (typeof err === 'object' && err !== null) {
    const record = err as Record<string, unknown>;
    if (typeof record.code === 'number' || typeof record.code === 'string') {
      code = record.code;
    }
    if (typeof record.message === 'string') {
      message = record.message;
    }
    if (typeof record.name === 'string') {
      name = record.name;
    }
  } else if (typeof err === 'string') {
    message = err;
  }

  const combined = `${name} ${code ?? ''} ${message} ${String(err)}`.toLowerCase();

  // 1. Verified structured user-refusal code (Starknet standard 113 USER_REFUSED_OP, EIP-1193 4001)
  if (
    code === 113 ||
    code === '113' ||
    code === 4001 ||
    code === '4001' ||
    code === 'USER_REFUSED_OP'
  ) {
    return 'Transaction cancelled in Ready Wallet.';
  }

  // 2. Specific readiness / fee conditions (Precedes fuzzy textual matching)
  if (
    combined.includes('insufficient funds to pay fee') ||
    combined.includes('insufficient_fee') ||
    combined.includes('insufficient fee') ||
    combined.includes('insufficient balance for fee') ||
    combined.includes('cannot pay fee') ||
    combined.includes('fee exceeds balance') ||
    combined.includes('not enough funds for fee')
  ) {
    return 'Insufficient balance to pay the Ready Wallet transaction fee.';
  }

  // 3. Explicit textual USER cancellation signals (strictly requiring explicit attribution to user)
  if (
    combined.includes('user_refused_op') ||
    combined.includes('user refused') ||
    combined.includes('user_refusal') ||
    combined.includes('user rejected') ||
    combined.includes('user reject') ||
    combined.includes('user cancelled') ||
    combined.includes('user canceled') ||
    combined.includes('user abort') ||
    combined.includes('user denied') ||
    combined.includes('user declined') ||
    combined.includes('rejected by user') ||
    combined.includes('cancelled by user') ||
    combined.includes('canceled by user') ||
    combined.includes('closed by user') ||
    combined.includes('popup closed by user')
  ) {
    return 'Transaction cancelled in Ready Wallet.';
  }

  // 4. Specific known wallet/privacy conditions (codes 118, 119, 162 from @starknet-io/starknet-types)
  if (
    code === 118 ||
    code === '118' ||
    combined.includes('not_registered') ||
    combined.includes('privacy_not_registered')
  ) {
    return 'STRK20 privacy is not initialized for this account. Initialize privacy in Ready Wallet, then try again.';
  }

  if (
    combined.includes('note_not_mature') ||
    combined.includes('unconfirmed_notes') ||
    combined.includes('10 block confirmations')
  ) {
    return 'Shielded balance is not ready yet. Requires 10 block confirmations.';
  }

  if (
    code === 119 ||
    code === '119' ||
    combined.includes('insufficient_private_balance') ||
    combined.includes('insufficient shielded balance') ||
    combined.includes('insufficient private balance')
  ) {
    return 'Insufficient shielded STRK balance in privacy pool.';
  }

  if (
    code === 162 ||
    code === '162' ||
    combined.includes('api_version_not_supported') ||
    combined.includes('unsupported_spec') ||
    combined.includes('api_not_supported')
  ) {
    return 'STRK20 Privacy Wallet API is not supported by the connected wallet.';
  }

  // 5. Safe generic fallback
  return 'Unable to create payment. Review Ready Wallet and try again.';
}

/**
 * Generates the deterministic planned payment and in-memory bearer credentials.
 * Credentials are held in volatile component memory and never persisted or logged.
 */
export function planCreatePayment(
  formData: CreateFormData,
  currentChainTime?: number,
): PlannedCreate {
  const amount = parseStrkAmount(formData.amount);
  const timestamps = calculateTimestamps(
    formData.claimChoice,
    formData.customClaimDate,
    formData.refundPreset,
    formData.customRefundDate,
    currentChainTime,
  );

  const claimPreimage = generateSecurePreimage();
  const refundPreimage = generateSecurePreimage();
  const nonce = generateSecureNonce();

  const hashlock = computeClaimHash(claimPreimage);
  const refund_hash = computeRefundHash(refundPreimage);
  const approver = '0x0';

  const paymentId = computePaymentId({
    token: STRK_MAINNET,
    amount,
    hashlock,
    refund_hash,
    claim_after: timestamps.claim_after,
    expires_at: timestamps.expires_at,
    approver,
    nonce,
  });

  return {
    token: STRK_MAINNET,
    amount,
    amountFormatted: formatStrkAmount(amount),
    claim_after: timestamps.claim_after,
    expires_at: timestamps.expires_at,
    approver,
    nonce,
    claimPreimage,
    refundPreimage,
    hashlock,
    refund_hash,
    paymentId,
    refundDateFormatted: timestamps.refundDateFormatted,
    claimDateFormatted: timestamps.claimDateFormatted,
  };
}

/**
 * Submits the canonical 2-action CREATE batch to the connected Ready Wallet.
 *
 * Sequence:
 *   1. [withdraw] 0.1 STRK from STRK20 pool -> ConditionalPay
 *   2. [invoke]   ConditionalPay.CREATE(...)
 */
export async function submitCreatePayment(
  wallet: WalletWithStarknetFeatures,
  planned: PlannedCreate,
): Promise<string> {
  const actions = buildCreateActions(CONDITIONAL_PAY_MAINNET, {
    token: planned.token,
    amount: planned.amount,
    hashlock: planned.hashlock,
    refund_hash: planned.refund_hash,
    claim_after: planned.claim_after,
    expires_at: planned.expires_at,
    approver: planned.approver,
    nonce: planned.nonce,
  });

  const result = await walletV6.strk20InvokeTransaction(wallet, actions);
  if (!result || typeof result.transaction_hash !== 'string') {
    throw new Error('Wallet did not return a valid transaction hash.');
  }
  return result.transaction_hash;
}

/**
 * Performs post-write authentication of receipt events and reads on-chain payment record.
 */
export async function verifyPaymentCreated(
  provider: ProviderInterface,
  planned: PlannedCreate,
  txHash: string,
): Promise<{
  eventAuthenticated: boolean;
  onchainStateActive: boolean;
  payment: Payment | null;
}> {
  const receipt = await provider.getTransactionReceipt(txHash);
  const events = (receipt as { events?: unknown[] }).events || [];
  const parsedEvents = parseConditionalPayEvents(events as never, CONDITIONAL_PAY_MAINNET);

  const createdEvent = parsedEvents.find(
    (e): e is PaymentCreatedEvent =>
      e.type === 'PaymentCreated' &&
      normalizeFelt(e.payment_id) === normalizeFelt(planned.paymentId) &&
      normalizeFelt(e.token) === normalizeFelt(planned.token) &&
      BigInt(e.amount) === planned.amount &&
      normalizeFelt(e.hashlock) === normalizeFelt(planned.hashlock) &&
      normalizeFelt(e.refund_hash) === normalizeFelt(planned.refund_hash) &&
      BigInt(e.claim_after) === planned.claim_after &&
      BigInt(e.expires_at) === planned.expires_at &&
      normalizeFelt(e.approver) === normalizeFelt(planned.approver) &&
      normalizeFelt(e.nonce) === normalizeFelt(planned.nonce),
  );

  const onchainPayment = await getPayment(provider, CONDITIONAL_PAY_MAINNET, planned.paymentId);

  const onchainStateActive =
    onchainPayment.state === PaymentState.ACTIVE &&
    normalizeFelt(onchainPayment.token) === normalizeFelt(planned.token) &&
    BigInt(onchainPayment.amount) === planned.amount &&
    normalizeFelt(onchainPayment.hashlock) === normalizeFelt(planned.hashlock) &&
    normalizeFelt(onchainPayment.refund_hash) === normalizeFelt(planned.refund_hash) &&
    BigInt(onchainPayment.claim_after) === planned.claim_after &&
    BigInt(onchainPayment.expires_at) === planned.expires_at &&
    normalizeFelt(onchainPayment.approver) === normalizeFelt(planned.approver) &&
    onchainPayment.approved === false;

  return {
    eventAuthenticated: Boolean(createdEvent),
    onchainStateActive,
    payment: onchainPayment,
  };
}
