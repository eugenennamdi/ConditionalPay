import {
  buildClaimActions,
  buildRefundActions,
  type ClaimAccessEncryptedEnvelope,
  computeClaimHash,
  computeRefundHash,
  getPayment,
  importClaimAccessCredentials,
  importSinglePaymentCredentials,
  normalizeFelt,
  parseConditionalPayEvents,
  type Payment,
  type PaymentClaimedEvent,
  type PaymentRefundedEvent,
  PaymentState,
  type SinglePaymentEncryptedEnvelope,
} from '@conditionalpay/sdk';
import { walletV6, type ProviderInterface } from 'starknet';
import type { WalletWithStarknetFeatures } from '@starknet-io/get-starknet-wallet-standard/features';
import type {
  ImportedClaimCredential,
  ImportedRefundCredential,
  SettlementMode,
  SettlementPreflight,
} from './settlementTypes';

export const CONDITIONAL_PAY_MAINNET =
  '0x0166e31803cfab50383d5b636b86a5646233881fad3a2fb89354da63f6cdb483' as const;
export const STRK_MAINNET =
  '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d' as const;

export interface StarknetReceiptStatus {
  execution_status?: string;
  finality_status?: string;
  status?: string;
}

export function isReceiptAccepted(receipt: StarknetReceiptStatus | null | undefined): boolean {
  if (!receipt) return false;
  if (receipt.execution_status === 'REVERTED' || receipt.status === 'REVERTED') {
    return false;
  }
  const isFinal =
    receipt.finality_status === 'ACCEPTED_ON_L2' ||
    receipt.finality_status === 'ACCEPTED_ON_L1';

  if (!isFinal) {
    return false;
  }
  if (receipt.execution_status && receipt.execution_status !== 'SUCCEEDED') {
    return false;
  }
  return true;
}

export function isReceiptReverted(receipt: StarknetReceiptStatus | null | undefined): boolean {
  if (!receipt) return false;
  return receipt.execution_status === 'REVERTED' || receipt.status === 'REVERTED';
}

/**
 * Normalizes Ready Wallet and RPC errors for settlement (Claim & Refund) actions.
 */
export function normalizeSettlementWalletError(err: unknown, mode: SettlementMode): string {
  if (!err) {
    return mode === 'claim'
      ? 'Unable to claim payment. Review Ready Wallet and try again.'
      : 'Unable to refund payment. Review Ready Wallet and try again.';
  }

  const rawMessage = err instanceof Error ? err.message : String(err);
  const code =
    typeof err === 'object' && err !== null && 'code' in err
      ? (err as { code?: unknown }).code
      : undefined;

  const combined = `${rawMessage} ${String(code ?? '')}`.toLowerCase();

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

  return mode === 'claim'
    ? 'Unable to claim payment. Review Ready Wallet and try again.'
    : 'Unable to refund payment. Review Ready Wallet and try again.';
}

/**
 * Imports an encrypted JSON artifact and decrypts the relevant capability for Claim or Refund.
 * Immediately minimizes secret exposure by discarding unneeded preimages from the returned object.
 */
export async function importSettlementFile(
  fileText: string,
  passphrase: string,
  mode: SettlementMode,
): Promise<ImportedClaimCredential | ImportedRefundCredential> {
  if (!passphrase || passphrase.length < 8) {
    throw new Error('Passphrase must be at least 8 characters long.');
  }

  let envelope: Record<string, unknown>;
  try {
    envelope = JSON.parse(fileText);
  } catch {
    throw new Error('Invalid JSON file format.');
  }

  if (!envelope || typeof envelope !== 'object') {
    throw new Error('Invalid credential envelope.');
  }

  const version = envelope.version;

  if (version === '1.0') {
    throw new Error('Unsupported recovery file version 1.0.');
  }

  if (mode === 'claim') {
    if (version === '1.2') {
      const claimCreds = await importClaimAccessCredentials(
        envelope as unknown as ClaimAccessEncryptedEnvelope,
        passphrase,
      );
      return {
        paymentId: claimCreds.paymentId,
        claimPreimage: claimCreds.claimPreimage,
        isSelfClaim: false,
      };
    }

    if (version === '1.1') {
      const recoveryCreds = await importSinglePaymentCredentials(
        envelope as unknown as SinglePaymentEncryptedEnvelope,
        passphrase,
      );
      // Immediately minimize memory footprint: extract only paymentId and claimPreimage
      return {
        paymentId: recoveryCreds.paymentId,
        claimPreimage: recoveryCreds.claimPreimage,
        isSelfClaim: true,
      };
    }

    throw new Error('Unsupported envelope format for Claim. Expected claim-access (v1.2) or creator recovery (v1.1).');
  }

  // mode === 'refund'
  if (version === '1.2') {
    throw new Error('This is a claim-access file. Refund requires the creator recovery file.');
  }

  if (version === '1.1') {
    const recoveryCreds = await importSinglePaymentCredentials(
      envelope as unknown as SinglePaymentEncryptedEnvelope,
      passphrase,
    );
    // Immediately minimize memory footprint: extract only paymentId and refundPreimage
    return {
      paymentId: recoveryCreds.paymentId,
      refundPreimage: recoveryCreds.refundPreimage,
    };
  }

  throw new Error('Unsupported envelope format for Refund. Expected creator recovery file (v1.1).');
}

/**
 * Validates onchain state, hashes, timing constraints, and token compatibility.
 */
export async function preflightSettlement(
  provider: ProviderInterface,
  mode: SettlementMode,
  creds: ImportedClaimCredential | ImportedRefundCredential,
): Promise<SettlementPreflight> {
  const payment = await getPayment(provider, CONDITIONAL_PAY_MAINNET, creds.paymentId);

  if (payment.state === PaymentState.UNINITIALIZED) {
    throw new Error('Payment not found on Starknet.');
  }

  if (normalizeFelt(payment.token) !== normalizeFelt(STRK_MAINNET)) {
    throw new Error('This Console currently supports STRK payments only.');
  }

  const latestBlock = await provider.getBlockWithTxHashes('latest');
  const now = BigInt(latestBlock.timestamp);

  const amountFormatted = (Number(payment.amount) / 1e18).toString();
  const claimDateFormatted =
    payment.claim_after === 0n
      ? 'Immediately'
      : new Date(Number(payment.claim_after) * 1000).toLocaleString('en-GB', {
          day: 'numeric',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
        });

  const refundDateFormatted =
    payment.expires_at === 0n
      ? 'No expiry'
      : new Date(Number(payment.expires_at) * 1000).toLocaleString('en-GB', {
          day: 'numeric',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
        });

  const requiresApproval =
    payment.approver !== '0x0' &&
    payment.approver !== '0x0000000000000000000000000000000000000000000000000000000000000000' &&
    !payment.approved;

  if (mode === 'claim') {
    const claimCreds = creds as ImportedClaimCredential;
    const computedHash = computeClaimHash(claimCreds.claimPreimage);

    if (normalizeFelt(computedHash) !== normalizeFelt(payment.hashlock)) {
      throw new Error('This claim credential does not match the payment.');
    }

    if (payment.state === PaymentState.CLAIMED) {
      throw new Error('Payment has already been claimed.');
    }

    if (payment.state === PaymentState.REFUNDED) {
      throw new Error('Payment has already been refunded.');
    }

    let isClaimAvailable = true;
    let claimBlockedReason: string | undefined;

    if (now < payment.claim_after) {
      isClaimAvailable = false;
      claimBlockedReason = `Claim not available yet. Available after ${claimDateFormatted}.`;
    } else if (payment.expires_at !== 0n && now >= payment.expires_at) {
      isClaimAvailable = false;
      claimBlockedReason = 'Payment has expired. Claim is no longer available.';
    } else if (requiresApproval) {
      isClaimAvailable = false;
      claimBlockedReason = 'Approval required. This payment must be approved before it can be claimed.';
    }

    return {
      paymentId: creds.paymentId,
      payment,
      amountFormatted,
      token: STRK_MAINNET,
      claimDateFormatted,
      refundDateFormatted,
      isClaimAvailable,
      isRefundAvailable: false,
      claimBlockedReason,
      requiresApproval,
    };
  }

  // mode === 'refund'
  const refundCreds = creds as ImportedRefundCredential;
  const computedHash = computeRefundHash(refundCreds.refundPreimage);

  if (normalizeFelt(computedHash) !== normalizeFelt(payment.refund_hash)) {
    throw new Error('This refund credential does not match the payment.');
  }

  if (payment.state === PaymentState.CLAIMED) {
    throw new Error('Payment has already been claimed.');
  }

  if (payment.state === PaymentState.REFUNDED) {
    throw new Error('Payment has already been refunded.');
  }

  if (payment.expires_at === 0n) {
    throw new Error('This payment has no expiry date and cannot be refunded.');
  }

  let isRefundAvailable = true;
  let refundBlockedReason: string | undefined;

  if (now < payment.expires_at) {
    isRefundAvailable = false;
    refundBlockedReason = `Refund not available yet. Available after ${refundDateFormatted}.`;
  }

  return {
    paymentId: creds.paymentId,
    payment,
    amountFormatted,
    token: STRK_MAINNET,
    claimDateFormatted,
    refundDateFormatted,
    isClaimAvailable: false,
    isRefundAvailable,
    refundBlockedReason,
    requiresApproval: false,
  };
}

/**
 * Submits the canonical 2-action CLAIM batch to the connected Ready Wallet.
 *
 * Sequence:
 *   1. [transfer] token = STRK, amount = OPEN, recipient = connected Ready Wallet
 *   2. [invoke]   ConditionalPay.privacy_invoke(Claim { payment_id, claim_preimage, note_id: "${openNoteIds[0]}" })
 */
export async function submitClaimPayment(
  wallet: WalletWithStarknetFeatures,
  paymentId: string,
  claimPreimage: string,
  token: string,
  recipient: string,
): Promise<string> {
  const actions = buildClaimActions(CONDITIONAL_PAY_MAINNET, {
    payment_id: paymentId,
    claim_preimage: claimPreimage,
    token,
    recipient,
  });

  const result = await walletV6.strk20InvokeTransaction(wallet, actions);
  if (!result || typeof result.transaction_hash !== 'string') {
    throw new Error('Wallet did not return a valid transaction hash.');
  }
  return result.transaction_hash;
}

/**
 * Submits the canonical 2-action REFUND batch to the connected Ready Wallet.
 *
 * Sequence:
 *   1. [transfer] token = STRK, amount = OPEN, recipient = connected Ready Wallet
 *   2. [invoke]   ConditionalPay.privacy_invoke(Refund { payment_id, refund_preimage, note_id: "${openNoteIds[0]}" })
 */
export async function submitRefundPayment(
  wallet: WalletWithStarknetFeatures,
  paymentId: string,
  refundPreimage: string,
  token: string,
  recipient: string,
): Promise<string> {
  const actions = buildRefundActions(CONDITIONAL_PAY_MAINNET, {
    payment_id: paymentId,
    refund_preimage: refundPreimage,
    token,
    recipient,
  });

  const result = await walletV6.strk20InvokeTransaction(wallet, actions);
  if (!result || typeof result.transaction_hash !== 'string') {
    throw new Error('Wallet did not return a valid transaction hash.');
  }
  return result.transaction_hash;
}

/**
 * Performs post-write verification of terminal events (PaymentClaimed or PaymentRefunded)
 * and verifies terminal onchain payment state (CLAIMED or REFUNDED).
 */
export async function verifySettlementOnchain(
  provider: ProviderInterface,
  mode: SettlementMode,
  paymentId: string,
  txHash: string,
): Promise<{
  eventAuthenticated: boolean;
  onchainStateSettled: boolean;
  payment: Payment | null;
}> {
  const receipt = await provider.getTransactionReceipt(txHash);
  const events = (receipt as { events?: unknown[] }).events || [];
  const parsedEvents = parseConditionalPayEvents(events as never, CONDITIONAL_PAY_MAINNET);

  let eventAuthenticated = false;

  if (mode === 'claim') {
    const claimedEvent = parsedEvents.find(
      (e): e is PaymentClaimedEvent =>
        e.type === 'PaymentClaimed' &&
        normalizeFelt(e.payment_id) === normalizeFelt(paymentId),
    );
    eventAuthenticated = Boolean(claimedEvent);
  } else {
    const refundedEvent = parsedEvents.find(
      (e): e is PaymentRefundedEvent =>
        e.type === 'PaymentRefunded' &&
        normalizeFelt(e.payment_id) === normalizeFelt(paymentId),
    );
    eventAuthenticated = Boolean(refundedEvent);
  }

  const onchainPayment = await getPayment(provider, CONDITIONAL_PAY_MAINNET, paymentId);

  const onchainStateSettled =
    mode === 'claim'
      ? onchainPayment.state === PaymentState.CLAIMED
      : onchainPayment.state === PaymentState.REFUNDED;

  return {
    eventAuthenticated,
    onchainStateSettled,
    payment: onchainPayment,
  };
}

/**
 * Validates onchain payment state before allowing durable Claim Access derivation.
 * Conservative: requires active payment and unexpired claim window.
 * Blocks derivation if RPC is unavailable or payment is terminal/invalid.
 */
export async function validateClaimAccessDerivation(
  provider: ProviderInterface,
  paymentId: string,
): Promise<{ isValid: boolean; errorReason?: string }> {
  try {
    const payment = await getPayment(provider, CONDITIONAL_PAY_MAINNET, paymentId);

    if (payment.state === PaymentState.UNINITIALIZED) {
      return { isValid: false, errorReason: 'Payment not found on Starknet.' };
    }

    if (payment.state === PaymentState.CLAIMED) {
      return { isValid: false, errorReason: 'Payment has already been claimed.' };
    }

    if (payment.state === PaymentState.REFUNDED) {
      return { isValid: false, errorReason: 'Payment has already been refunded.' };
    }

    let chainTime = 0n;
    try {
      const block = await provider.getBlockWithTxHashes('latest');
      chainTime = BigInt(block.timestamp);
    } catch {
      return {
        isValid: false,
        errorReason: 'Unable to verify payment status on Starknet.',
      };
    }

    if (payment.expires_at !== 0n && chainTime !== 0n && chainTime >= payment.expires_at) {
      return { isValid: false, errorReason: 'Claim window has expired.' };
    }

    return { isValid: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : '';
    if (msg.includes('Payment not found') || msg.includes('Payment has already')) {
      return { isValid: false, errorReason: msg };
    }
    return {
      isValid: false,
      errorReason: 'Unable to verify payment status on Starknet.',
    };
  }
}
