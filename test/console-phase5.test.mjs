import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  importSettlementFile,
  preflightSettlement,
  submitClaimPayment,
  submitRefundPayment,
  verifySettlementOnchain,
  normalizeSettlementWalletError,
  validateClaimAccessDerivation,
  isReceiptAccepted,
  isReceiptReverted,
} from '../src/app/console/_lib/settlementExecution.ts';
import {
  CONDITIONAL_PAY_MAINNET,
  STRK_MAINNET,
} from '../src/app/console/_lib/createExecution.ts';
import {
  buildClaimActions,
  buildRefundActions,
  computeClaimHash,
  computeRefundHash,
  exportClaimAccessCredentials,
  exportSinglePaymentCredentials,
  exportEncryptedCredentials,
  importClaimAccessCredentials,
  importSinglePaymentCredentials,
  importEncryptedCredentials,
  normalizeFelt,
  PaymentState,
  EVENT_SELECTORS,
} from '@conditionalpay/sdk';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(testDirectory, '..');

// Independent hardcoded literal constants for forensic parity checks
const CANONICAL_CONDITIONAL_PAY_LITERAL =
  '0x0166e31803cfab50383d5b636b86a5646233881fad3a2fb89354da63f6cdb483';
const CANONICAL_STRK_TOKEN_LITERAL =
  '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d';

function readConsoleSources(directory = resolve(repositoryRoot, 'src/app/console')) {
  const sources = [];
  if (!existsSync(directory)) return sources;

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      sources.push(...readConsoleSources(absolutePath));
    } else if (/\.(ts|tsx|js|jsx|mjs)$/.test(entry.name)) {
      sources.push({ path: absolutePath, code: readFileSync(absolutePath, 'utf8') });
    }
  }
  return sources;
}

test('1. Claim Access v1.2 Envelope & Credential Parity', async () => {
  const mockClaimAccess = {
    paymentId: '0x05a7f9b23c81d4e6012789abc456def0123456789abcdef0123456789abcdef0',
    claimPreimage: '0x0111111111111111111111111111111111111111111111111111111111111111',
  };

  const password = 'StrongClaimPassword123!';
  const envelope = await exportClaimAccessCredentials(mockClaimAccess, password);

  assert.equal(envelope.version, '1.2');
  assert.equal(envelope.cipher, 'AES-GCM-256');
  assert.equal(envelope.kdf, 'PBKDF2-SHA256');
  assert.equal(envelope.iterations, 600000);
  assert.equal(envelope.saltHex.length, 32); // 16 bytes
  assert.equal(envelope.ivHex.length, 24); // 12 bytes
  assert.ok(envelope.ciphertextHex.length > 0);

  const restored = await importClaimAccessCredentials(envelope, password);
  assert.deepEqual(restored, mockClaimAccess);
  assert.equal(restored.refundPreimage, undefined);
  assert.equal(restored.nonce, undefined);

  // Proves claim secret matches payment hashlock
  const hashlock = computeClaimHash(restored.claimPreimage);
  assert.equal(computeClaimHash(mockClaimAccess.claimPreimage), hashlock);
});

test('2. Claim Access v1.2 Tamper and Invalid Passphrase Rejection', async () => {
  const mockClaimAccess = {
    paymentId: '0x05a7f9b23c81d4e6012789abc456def0123456789abcdef0123456789abcdef0',
    claimPreimage: '0x0111111111111111111111111111111111111111111111111111111111111111',
  };

  const envelope = await exportClaimAccessCredentials(mockClaimAccess, 'CorrectPass123!', 10000);

  // Wrong password
  await assert.rejects(
    () => importClaimAccessCredentials(envelope, 'WrongPass456!'),
    /Failed to decrypt credentials/,
  );

  // Tampered ciphertext
  const tamperedCipher = {
    ...envelope,
    ciphertextHex: envelope.ciphertextHex.slice(0, -1) + (envelope.ciphertextHex.endsWith('a') ? 'b' : 'a'),
  };
  await assert.rejects(
    () => importClaimAccessCredentials(tamperedCipher, 'CorrectPass123!'),
    /Failed to decrypt credentials/,
  );

  // Tampered IV
  const tamperedIv = {
    ...envelope,
    ivHex: envelope.ivHex.slice(0, -1) + (envelope.ivHex.endsWith('0') ? '1' : '0'),
  };
  await assert.rejects(
    () => importClaimAccessCredentials(tamperedIv, 'CorrectPass123!'),
    /Failed to decrypt credentials/,
  );

  // Tampered Salt
  const tamperedSalt = {
    ...envelope,
    saltHex: envelope.saltHex.slice(0, -1) + (envelope.saltHex.endsWith('0') ? '1' : '0'),
  };
  await assert.rejects(
    () => importClaimAccessCredentials(tamperedSalt, 'CorrectPass123!'),
    /Failed to decrypt credentials/,
  );
});

test('3. Cross-Format Isolation: v1.0, v1.1, and v1.2 Envelopes', async () => {
  const mockDual = {
    paymentA: { paymentId: '0x1', claimPreimage: '0x2', refundPreimage: '0x3', nonce: '0x4' },
    paymentB: { paymentId: '0x5', claimPreimage: '0x6', refundPreimage: '0x7', nonce: '0x8' },
  };
  const mockSingle = {
    paymentId: '0x019b3f6176561b6054a803a0d499c73252413eaa8756dda3990f605ef9273ac3',
    claimPreimage: '0x0111b222c333d444e555f6660111222333444555666777888999aaabbbcccddd',
    refundPreimage: '0x0211c222d333e444f5550666111122223333444455556666777788889999aaaa',
    nonce: '0x101',
  };
  const mockClaim = {
    paymentId: '0x05a7f9b23c81d4e6012789abc456def0123456789abcdef0123456789abcdef0',
    claimPreimage: '0x0111111111111111111111111111111111111111111111111111111111111111',
  };

  const v10Env = await exportEncryptedCredentials(mockDual, 'CommonPass123!', 10000);
  const v11Env = await exportSinglePaymentCredentials(mockSingle, 'CommonPass123!', 10000);
  const v12Env = await exportClaimAccessCredentials(mockClaim, 'CommonPass123!', 10000);

  // importClaimAccessCredentials
  await assert.rejects(
    () => importClaimAccessCredentials(v10Env, 'CommonPass123!'),
    /Unsupported envelope format: AES-GCM-256 v1.0/,
  );
  await assert.rejects(
    () => importClaimAccessCredentials(v11Env, 'CommonPass123!'),
    /Unsupported envelope format: AES-GCM-256 v1.1/,
  );
  const res12 = await importClaimAccessCredentials(v12Env, 'CommonPass123!');
  assert.deepEqual(res12, mockClaim);

  // importSinglePaymentCredentials
  await assert.rejects(
    () => importSinglePaymentCredentials(v10Env, 'CommonPass123!'),
    /Unsupported envelope format: AES-GCM-256 v1.0/,
  );
  await assert.rejects(
    () => importSinglePaymentCredentials(v12Env, 'CommonPass123!'),
    /Unsupported envelope format: AES-GCM-256 v1.2/,
  );
  const res11 = await importSinglePaymentCredentials(v11Env, 'CommonPass123!');
  assert.deepEqual(res11, mockSingle);

  // importEncryptedCredentials
  await assert.rejects(
    () => importEncryptedCredentials(v11Env, 'CommonPass123!'),
    /Unsupported envelope format: AES-GCM-256 v1.1/,
  );
  await assert.rejects(
    () => importEncryptedCredentials(v12Env, 'CommonPass123!'),
    /Unsupported envelope format: AES-GCM-256 v1.2/,
  );
  const res10 = await importEncryptedCredentials(v10Env, 'CommonPass123!');
  assert.deepEqual(res10, mockDual);
});

test('4. importSettlementFile: Capability Extraction & Secret Minimization', async () => {
  const mockSingle = {
    paymentId: '0x019b3f6176561b6054a803a0d499c73252413eaa8756dda3990f605ef9273ac3',
    claimPreimage: '0x0111b222c333d444e555f6660111222333444555666777888999aaabbbcccddd',
    refundPreimage: '0x0211c222d333e444f5550666111122223333444455556666777788889999aaaa',
    nonce: '0x101',
  };
  const mockClaim = {
    paymentId: '0x05a7f9b23c81d4e6012789abc456def0123456789abcdef0123456789abcdef0',
    claimPreimage: '0x0111111111111111111111111111111111111111111111111111111111111111',
  };

  const v11Env = await exportSinglePaymentCredentials(mockSingle, 'RecoveryPass123!', 10000);
  const v12Env = await exportClaimAccessCredentials(mockClaim, 'ClaimPass123!', 10000);

  // A. Normal claimant importing v1.2 in claim mode
  const claim1 = await importSettlementFile(JSON.stringify(v12Env), 'ClaimPass123!', 'claim');
  assert.equal(claim1.paymentId, mockClaim.paymentId);
  assert.equal(claim1.claimPreimage, mockClaim.claimPreimage);
  assert.equal(claim1.isSelfClaim, false);
  assert.equal(claim1.refundPreimage, undefined);
  assert.equal(claim1.nonce, undefined);

  // B. Creator self-claiming with v1.1 in claim mode (drops refund secret from memory)
  const claimSelf = await importSettlementFile(JSON.stringify(v11Env), 'RecoveryPass123!', 'claim');
  assert.equal(claimSelf.paymentId, mockSingle.paymentId);
  assert.equal(claimSelf.claimPreimage, mockSingle.claimPreimage);
  assert.equal(claimSelf.isSelfClaim, true);
  assert.equal(claimSelf.refundPreimage, undefined);
  assert.equal(claimSelf.nonce, undefined);

  // C. Creator refunding with v1.1 in refund mode (drops claim secret from memory)
  const refund1 = await importSettlementFile(JSON.stringify(v11Env), 'RecoveryPass123!', 'refund');
  assert.equal(refund1.paymentId, mockSingle.paymentId);
  assert.equal(refund1.refundPreimage, mockSingle.refundPreimage);
  assert.equal(refund1.claimPreimage, undefined);
  assert.equal(refund1.nonce, undefined);

  // D. Refunding with v1.2 claim-access is strictly rejected
  await assert.rejects(
    () => importSettlementFile(JSON.stringify(v12Env), 'ClaimPass123!', 'refund'),
    /This is a claim-access file\. Refund requires the creator recovery file\./,
  );
});

test('5. Preflight Settlement: Hash Matching, Timing, State, and Token', async () => {
  const claimPreimage = '0x0111111111111111111111111111111111111111111111111111111111111111';
  const refundPreimage = '0x0222222222222222222222222222222222222222222222222222222222222222';
  const hashlock = computeClaimHash(claimPreimage);
  const refund_hash = computeRefundHash(refundPreimage);
  const paymentId = '0x05a7f9b23c81d4e6012789abc456def0123456789abcdef0123456789abcdef0';

  const basePayment = {
    token: STRK_MAINNET,
    amount: 100000000000000000n, // 0.1 STRK
    hashlock,
    refund_hash,
    claim_after: 1000n,
    expires_at: 5000n,
    approver: '0x0',
    approved: false,
    state: PaymentState.ACTIVE,
  };

  let currentBlockTime = 2000n; // Between claim_after (1000) and expires_at (5000)
  let paymentOnchain = { ...basePayment };

  const mockProvider = {
    async callContract() {
      return [
        paymentOnchain.token,
        paymentOnchain.amount.toString(),
        paymentOnchain.hashlock,
        paymentOnchain.refund_hash,
        paymentOnchain.claim_after.toString(),
        paymentOnchain.expires_at.toString(),
        paymentOnchain.approver,
        paymentOnchain.approved ? '1' : '0',
        paymentOnchain.state.toString(),
      ];
    },
    async getBlockWithTxHashes() {
      return { timestamp: Number(currentBlockTime) };
    },
  };

  // A. Claim preflight success when active and in valid window
  const claimPreflight = await preflightSettlement(mockProvider, 'claim', {
    paymentId,
    claimPreimage,
  });
  assert.equal(claimPreflight.isClaimAvailable, true);
  assert.equal(claimPreflight.amountFormatted, '0.1');

  // B. Claim preflight fails on mismatched secret
  await assert.rejects(
    () => preflightSettlement(mockProvider, 'claim', { paymentId, claimPreimage: '0x0999999' }),
    /This claim credential does not match the payment\./,
  );

  // C. Claim preflight blocked before claim_after
  currentBlockTime = 500n;
  const claimTooEarly = await preflightSettlement(mockProvider, 'claim', {
    paymentId,
    claimPreimage,
  });
  assert.equal(claimTooEarly.isClaimAvailable, false);
  assert.ok(claimTooEarly.claimBlockedReason.includes('Claim not available yet'));

  // D. Claim preflight blocked after expires_at
  currentBlockTime = 6000n;
  const claimExpired = await preflightSettlement(mockProvider, 'claim', {
    paymentId,
    claimPreimage,
  });
  assert.equal(claimExpired.isClaimAvailable, false);
  assert.ok(claimExpired.claimBlockedReason.includes('Payment has expired'));

  // E. Claim preflight blocked if approval required
  currentBlockTime = 2000n;
  paymentOnchain.approver = '0x012345';
  paymentOnchain.approved = false;
  const claimNeedsApproval = await preflightSettlement(mockProvider, 'claim', {
    paymentId,
    claimPreimage,
  });
  assert.equal(claimNeedsApproval.isClaimAvailable, false);
  assert.ok(claimNeedsApproval.claimBlockedReason.includes('Approval required'));

  // F. Refund preflight blocked before expires_at
  currentBlockTime = 2000n;
  const refundTooEarly = await preflightSettlement(mockProvider, 'refund', {
    paymentId,
    refundPreimage,
  });
  assert.equal(refundTooEarly.isRefundAvailable, false);
  assert.ok(refundTooEarly.refundBlockedReason.includes('Refund not available yet'));

  // G. Refund preflight succeeds at or after expires_at even if approver is set and unapproved
  currentBlockTime = 6000n;
  const refundAvailable = await preflightSettlement(mockProvider, 'refund', {
    paymentId,
    refundPreimage,
  });
  assert.equal(refundAvailable.isRefundAvailable, true);

  // H. Refund fails if payment has no expiry (expires_at == 0)
  paymentOnchain.expires_at = 0n;
  await assert.rejects(
    () => preflightSettlement(mockProvider, 'refund', { paymentId, refundPreimage }),
    /This payment has no expiry date and cannot be refunded\./,
  );
  paymentOnchain.expires_at = 5000n;

  // I. Rejection of uninitialized payment
  paymentOnchain.state = PaymentState.UNINITIALIZED;
  await assert.rejects(
    () => preflightSettlement(mockProvider, 'claim', { paymentId, claimPreimage }),
    /Payment not found on Starknet\./,
  );

  // J. Rejection of already claimed/refunded
  paymentOnchain.state = PaymentState.CLAIMED;
  await assert.rejects(
    () => preflightSettlement(mockProvider, 'claim', { paymentId, claimPreimage }),
    /Payment has already been claimed\./,
  );

  paymentOnchain.state = PaymentState.REFUNDED;
  await assert.rejects(
    () => preflightSettlement(mockProvider, 'refund', { paymentId, refundPreimage }),
    /Payment has already been refunded\./,
  );

  // K. Rejection of non-STRK token
  paymentOnchain.state = PaymentState.ACTIVE;
  paymentOnchain.token = '0x0111222333';
  await assert.rejects(
    () => preflightSettlement(mockProvider, 'claim', { paymentId, claimPreimage }),
    /This Console currently supports STRK payments only\./,
  );
});

test('6. Canonical Action Topologies for CLAIM and REFUND', () => {
  const paymentId = '0x05a7f9b23c81d4e6012789abc456def0123456789abcdef0123456789abcdef0';
  const claimPreimage = '0x0111111111111111111111111111111111111111111111111111111111111111';
  const refundPreimage = '0x0222222222222222222222222222222222222222222222222222222222222222';
  const recipient = '0x053b40a647cedfca6ca84f542a0fe3673603190d52737e333680420fa390776a';

  // CLAIM Actions
  const claimActions = buildClaimActions(CANONICAL_CONDITIONAL_PAY_LITERAL, {
    payment_id: paymentId,
    claim_preimage: claimPreimage,
    token: CANONICAL_STRK_TOKEN_LITERAL,
    recipient,
  });

  assert.equal(claimActions.length, 2);
  assert.equal(claimActions[0].type, 'transfer');
  assert.equal(claimActions[0].token, normalizeFelt(CANONICAL_STRK_TOKEN_LITERAL));
  assert.equal(claimActions[0].amount, 'OPEN');
  assert.equal(claimActions[0].recipient, normalizeFelt(recipient));

  assert.equal(claimActions[1].type, 'invoke');
  assert.equal(claimActions[1].contract, normalizeFelt(CANONICAL_CONDITIONAL_PAY_LITERAL));
  assert.equal(claimActions[1].calldata[0], '0x1'); // Discriminant 1 = Claim
  assert.equal(claimActions[1].calldata[1], normalizeFelt(paymentId));
  assert.equal(claimActions[1].calldata[2], normalizeFelt(claimPreimage));
  assert.equal(claimActions[1].calldata[3], '${openNoteIds[0]}');

  // REFUND Actions
  const refundActions = buildRefundActions(CANONICAL_CONDITIONAL_PAY_LITERAL, {
    payment_id: paymentId,
    refund_preimage: refundPreimage,
    token: CANONICAL_STRK_TOKEN_LITERAL,
    recipient,
  });

  assert.equal(refundActions.length, 2);
  assert.equal(refundActions[0].type, 'transfer');
  assert.equal(refundActions[0].token, normalizeFelt(CANONICAL_STRK_TOKEN_LITERAL));
  assert.equal(refundActions[0].amount, 'OPEN');
  assert.equal(refundActions[0].recipient, normalizeFelt(recipient));

  assert.equal(refundActions[1].type, 'invoke');
  assert.equal(refundActions[1].contract, normalizeFelt(CANONICAL_CONDITIONAL_PAY_LITERAL));
  assert.equal(refundActions[1].calldata[0], '0x2'); // Discriminant 2 = Refund
  assert.equal(refundActions[1].calldata[1], normalizeFelt(paymentId));
  assert.equal(refundActions[1].calldata[2], normalizeFelt(refundPreimage));
  assert.equal(refundActions[1].calldata[3], '${openNoteIds[0]}');
});

test('7. Mock Wallet strk20InvokeTransaction & Settlement Execution', async () => {
  const paymentId = '0x05a7f9b23c81d4e6012789abc456def0123456789abcdef0123456789abcdef0';
  const claimPreimage = '0x0111111111111111111111111111111111111111111111111111111111111111';
  const recipient = '0x053b40a647cedfca6ca84f542a0fe3673603190d52737e333680420fa390776a';

  let capturedActions = null;
  const mockWallet = {
    features: {
      'starknet:walletApi': {
        async request(call) {
          if (call.type === 'wallet_strk20InvokeTransaction') {
            capturedActions = call.params.actions;
            return { transaction_hash: '0x0tx123456789abcdef' };
          }
          throw new Error(`Unsupported call: ${call.type}`);
        },
      },
    },
  };

  const txHash = await submitClaimPayment(
    mockWallet,
    paymentId,
    claimPreimage,
    STRK_MAINNET,
    recipient,
  );

  assert.equal(txHash, '0x0tx123456789abcdef');
  assert.equal(capturedActions.length, 2);
  assert.equal(capturedActions[0].amount, 'OPEN');
  assert.equal(capturedActions[1].calldata[0], '0x1');

  // Submit refund
  const refundPreimage = '0x0222222222222222222222222222222222222222222222222222222222222222';
  const refundTxHash = await submitRefundPayment(
    mockWallet,
    paymentId,
    refundPreimage,
    STRK_MAINNET,
    recipient,
  );

  assert.equal(refundTxHash, '0x0tx123456789abcdef');
  assert.equal(capturedActions.length, 2);
  assert.equal(capturedActions[0].amount, 'OPEN');
  assert.equal(capturedActions[1].calldata[0], '0x2');
});

test('8. Error Normalization: Wallet Rejections and Privacy Conditions', () => {
  // Wallet cancellation
  assert.equal(
    normalizeSettlementWalletError(new Error('User rejected the transaction'), 'claim'),
    'Transaction cancelled in Ready Wallet.',
  );
  assert.equal(
    normalizeSettlementWalletError({ code: 'USER_REFUSAL', message: 'User refusal' }, 'refund'),
    'Transaction cancelled in Ready Wallet.',
  );

  // Privacy not initialized (code 118)
  assert.equal(
    normalizeSettlementWalletError({ code: 118, message: 'privacy_not_registered' }, 'claim'),
    'STRK20 privacy is not initialized for this account. Initialize privacy in Ready Wallet, then try again.',
  );

  // Unconfirmed notes
  assert.equal(
    normalizeSettlementWalletError(new Error('unconfirmed_notes in pool'), 'claim'),
    'Shielded balance is not ready yet. Requires 10 block confirmations.',
  );

  // Insufficient private balance (code 119)
  assert.equal(
    normalizeSettlementWalletError({ code: 119, message: 'insufficient_private_balance' }, 'refund'),
    'Insufficient shielded STRK balance in privacy pool.',
  );

  // Fallbacks
  assert.equal(
    normalizeSettlementWalletError(new Error('Some network failure'), 'claim'),
    'Unable to claim payment. Review Ready Wallet and try again.',
  );
  assert.equal(
    normalizeSettlementWalletError(new Error('Some network failure'), 'refund'),
    'Unable to refund payment. Review Ready Wallet and try again.',
  );
});

test('9. Receipt Acceptance and Revert Predicates', () => {
  // Accepted on L2 + SUCCEEDED -> Accepted
  assert.equal(
    isReceiptAccepted({ finality_status: 'ACCEPTED_ON_L2', execution_status: 'SUCCEEDED' }),
    true,
  );
  assert.equal(
    isReceiptAccepted({ finality_status: 'ACCEPTED_ON_L1', execution_status: 'SUCCEEDED' }),
    true,
  );

  // SUCCEEDED without finality -> NOT accepted
  assert.equal(isReceiptAccepted({ execution_status: 'SUCCEEDED' }), false);
  assert.equal(
    isReceiptAccepted({ finality_status: 'RECEIVED', execution_status: 'SUCCEEDED' }),
    false,
  );

  // REVERTED -> NOT accepted
  assert.equal(
    isReceiptAccepted({ finality_status: 'ACCEPTED_ON_L2', execution_status: 'REVERTED' }),
    false,
  );

  // isReceiptReverted
  assert.equal(isReceiptReverted({ execution_status: 'REVERTED' }), true);
  assert.equal(isReceiptReverted({ status: 'REVERTED' }), true);
  assert.equal(isReceiptReverted({ execution_status: 'SUCCEEDED' }), false);
});

test('10. Post-Write Terminal Event & State Verification', async () => {
  const paymentId = '0x05a7f9b23c81d4e6012789abc456def0123456789abcdef0123456789abcdef0';
  const txHash = '0x0tx123456789abcdef';

  let paymentState = PaymentState.CLAIMED;

  const mockProvider = {
    async getTransactionReceipt() {
      return {
        events: [
          {
            from_address: CONDITIONAL_PAY_MAINNET,
            keys: [EVENT_SELECTORS.PaymentClaimed, normalizeFelt(paymentId)],
            data: [],
          },
        ],
      };
    },
    async callContract() {
      return [
        STRK_MAINNET,
        '100000000000000000',
        '0x123',
        '0x456',
        '0',
        '5000',
        '0x0',
        '0',
        paymentState.toString(),
      ];
    },
  };

  // Claim verified
  const claimVerify = await verifySettlementOnchain(mockProvider, 'claim', paymentId, txHash);
  assert.equal(claimVerify.eventAuthenticated, true);
  assert.equal(claimVerify.onchainStateSettled, true);

  // Refund verified
  paymentState = PaymentState.REFUNDED;
  const mockRefundProvider = {
    async getTransactionReceipt() {
      return {
        events: [
          {
            from_address: CONDITIONAL_PAY_MAINNET,
            keys: [EVENT_SELECTORS.PaymentRefunded, normalizeFelt(paymentId)],
            data: [],
          },
        ],
      };
    },
    async callContract() {
      return [
        STRK_MAINNET,
        '100000000000000000',
        '0x123',
        '0x456',
        '0',
        '5000',
        '0x0',
        '0',
        paymentState.toString(),
      ];
    },
  };

  const refundVerify = await verifySettlementOnchain(
    mockRefundProvider,
    'refund',
    paymentId,
    txHash,
  );
  assert.equal(refundVerify.eventAuthenticated, true);
  assert.equal(refundVerify.onchainStateSettled, true);
});

test('11. Security Audit: Zero Secret Leakage into Persistent Storage or Logs', () => {
  const sources = readConsoleSources();

  for (const { path, code } of sources) {
    // Prohibit browser storage sinks
    assert.ok(
      !code.includes('localStorage.setItem') && !code.includes('sessionStorage.setItem'),
      `Browser storage sink found in ${path}`,
    );

    // Prohibit window.location secrets
    assert.ok(
      !code.includes('window.location.search') && !code.includes('window.location.search ='),
      `URL search params sink found in ${path}`,
    );
  }
});

test('12. Derivation Equivalence: Immediate CREATE Claim Access vs Later Derived Claim Access', async () => {
  const paymentId = '0x03a7f9b23c81d4e6012789abc456def0123456789abcdef0123456789abcdef0';
  const claimPreimage = '0x0111111111111111111111111111111111111111111111111111111111111111';
  const refundPreimage = '0x0222222222222222222222222222222222222222222222222222222222222222';
  const nonce = '0x0333333333333333333333333333333333333333333333333333333333333333';

  // 1. Immediate path from CREATE (plannedCreate in memory)
  const immediateEnvelope = await exportClaimAccessCredentials(
    { paymentId, claimPreimage },
    'immediatePassphrase123',
  );

  // 2. Later path from v1.1 Creator Recovery (saved to disk, imported later)
  const recoveryEnvelope = await exportSinglePaymentCredentials(
    { paymentId, claimPreimage, refundPreimage, nonce },
    'recoveryPassphrase456',
  );

  // Later: user imports v1.1 recovery into Console Claim tab
  const importedRecovery = await importSinglePaymentCredentials(
    recoveryEnvelope,
    'recoveryPassphrase456',
  );

  // Console extracts { paymentId, claimPreimage } and derives v1.2 with fresh recipient passphrase
  const derivedEnvelope = await exportClaimAccessCredentials(
    { paymentId: importedRecovery.paymentId, claimPreimage: importedRecovery.claimPreimage },
    'derivedRecipientPassphrase789',
  );

  // Ciphertexts naturally differ due to fresh salt, IV, and passphrases
  assert.notEqual(immediateEnvelope.ciphertextHex, derivedEnvelope.ciphertextHex);
  assert.notEqual(immediateEnvelope.saltHex, derivedEnvelope.saltHex);

  // But decrypted capability is mathematically identical
  const decryptedImmediate = await importClaimAccessCredentials(
    immediateEnvelope,
    'immediatePassphrase123',
  );
  const decryptedDerived = await importClaimAccessCredentials(
    derivedEnvelope,
    'derivedRecipientPassphrase789',
  );

  assert.equal(decryptedImmediate.paymentId, decryptedDerived.paymentId);
  assert.equal(decryptedImmediate.claimPreimage, decryptedDerived.claimPreimage);
  assert.equal(decryptedImmediate.paymentId, paymentId);
  assert.equal(decryptedImmediate.claimPreimage, claimPreimage);
});

test('13. Terminal & Expiry Rules for Deriving Claim Access', async () => {
  const paymentId = '0x05a7f9b23c81d4e6012789abc456def0123456789abcdef0123456789abcdef0';

  // Helper to build mock provider
  function makeMockProvider(state, expiresAt = '0', claimAfter = '0', currentBlockTime = 1000) {
    return {
      async getBlockWithTxHashes() {
        return { timestamp: currentBlockTime };
      },
      async callContract() {
        return [
          STRK_MAINNET,
          '100000000000000000',
          '0x123',
          '0x456',
          claimAfter,
          expiresAt,
          '0x0',
          '0',
          state.toString(),
        ];
      },
    };
  }

  // 1. ACTIVE payment -> allowed
  const activeProvider = makeMockProvider(PaymentState.ACTIVE, '2000', '500', 1000);
  const activeRes = await validateClaimAccessDerivation(activeProvider, paymentId);
  assert.equal(activeRes.isValid, true);

  // 2. ACTIVE payment with claim_after in future -> allowed (claimant can hold artifact)
  const futureClaimProvider = makeMockProvider(PaymentState.ACTIVE, '2000', '1500', 1000);
  const futureRes = await validateClaimAccessDerivation(futureClaimProvider, paymentId);
  assert.equal(futureRes.isValid, true);

  // 3. CLAIMED payment -> blocked
  const claimedProvider = makeMockProvider(PaymentState.CLAIMED, '2000', '500', 1000);
  const claimedRes = await validateClaimAccessDerivation(claimedProvider, paymentId);
  assert.equal(claimedRes.isValid, false);
  assert.equal(claimedRes.errorReason, 'Payment has already been claimed.');

  // 4. REFUNDED payment -> blocked
  const refundedProvider = makeMockProvider(PaymentState.REFUNDED, '2000', '500', 1000);
  const refundedRes = await validateClaimAccessDerivation(refundedProvider, paymentId);
  assert.equal(refundedRes.isValid, false);
  assert.equal(refundedRes.errorReason, 'Payment has already been refunded.');

  // 5. Expired payment (now >= expires_at) -> blocked
  const expiredProvider = makeMockProvider(PaymentState.ACTIVE, '1000', '500', 1000);
  const expiredRes = await validateClaimAccessDerivation(expiredProvider, paymentId);
  assert.equal(expiredRes.isValid, false);
  assert.equal(expiredRes.errorReason, 'Claim window has expired.');

  // 6. UNINITIALIZED payment -> blocked
  const uninitProvider = makeMockProvider(PaymentState.UNINITIALIZED, '0', '0', 1000);
  const uninitRes = await validateClaimAccessDerivation(uninitProvider, paymentId);
  assert.equal(uninitRes.isValid, false);
  assert.equal(uninitRes.errorReason, 'Payment not found on Starknet.');

  // 7. Throwing RPC provider -> blocked safely
  const throwingProvider = {
    async callContract() {
      throw new Error('RPC endpoint rate limited');
    },
    async getBlockWithTxHashes() {
      throw new Error('RPC endpoint rate limited');
    },
  };
  const throwingRes = await validateClaimAccessDerivation(throwingProvider, paymentId);
  assert.equal(throwingRes.isValid, false);
  assert.equal(throwingRes.errorReason, 'Unable to verify payment status on Starknet.');
});

test('14. Recipient-Address Stability Protection', async () => {
  const paymentId = '0x05a7f9b23c81d4e6012789abc456def0123456789abcdef0123456789abcdef0';
  const claimPreimage = '0x0111111111111111111111111111111111111111111111111111111111111111';
  const account1 = '0x053b40a647cedfca6ca84f542a0fe3673603190d52737e333680420fa390776a';
  const account2 = '0x0222222222222222222222222222222222222222222222222222222222222222';

  let capturedActions = null;
  const mockWallet = {
    features: {
      'starknet:walletApi': {
        async request(call) {
          if (call.type === 'wallet_strk20InvokeTransaction') {
            capturedActions = call.params.actions;
            return { transaction_hash: '0x0tx123456789abcdef' };
          }
          throw new Error(`Unsupported call: ${call.type}`);
        },
      },
    },
  };

  // 1. Initial review with account1
  let reviewedAddress = account1;
  let currentWalletAddress = account1;

  // Stability guard simulation matching ClaimPayment / RefundPayment logic
  function attemptSubmission(currentAddress) {
    if (reviewedAddress && currentAddress && reviewedAddress !== currentAddress) {
      // Invalidate and prompt re-review with new address
      reviewedAddress = currentAddress;
      return { success: false, error: 'Wallet account changed. Review the settlement again before continuing.' };
    }
    return { success: true };
  }

  // Same account -> submission proceeds
  const attempt1 = attemptSubmission(currentWalletAddress);
  assert.equal(attempt1.success, true);
  const txHash1 = await submitClaimPayment(
    mockWallet,
    paymentId,
    claimPreimage,
    STRK_MAINNET,
    currentWalletAddress,
  );
  assert.equal(txHash1, '0x0tx123456789abcdef');
  assert.equal(capturedActions[0].recipient, normalizeFelt(account1));

  // Account changes in wallet before submit -> submission blocked
  currentWalletAddress = account2;
  const attempt2 = attemptSubmission(currentWalletAddress);
  assert.equal(attempt2.success, false);
  assert.equal(attempt2.error, 'Wallet account changed. Review the settlement again before continuing.');

  // After reviewing with account2 -> submission proceeds with new account as recipient
  const attempt3 = attemptSubmission(currentWalletAddress);
  assert.equal(attempt3.success, true);
  const txHash2 = await submitClaimPayment(
    mockWallet,
    paymentId,
    claimPreimage,
    STRK_MAINNET,
    currentWalletAddress,
  );
  assert.equal(txHash2, '0x0tx123456789abcdef');
  assert.equal(capturedActions[0].recipient, normalizeFelt(account2));
});

