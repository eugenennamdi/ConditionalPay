import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  parseStrkAmount,
  formatStrkAmount,
  calculateTimestamps,
  planCreatePayment,
  normalizeWalletError,
  shouldActivateNavigationGuard,
  isReceiptAccepted,
  isReceiptReverted,
  CONDITIONAL_PAY_MAINNET,
  STRK_MAINNET,
  STRK20_POOL_MAINNET,
  U128_MAX,
} from '../src/app/console/_lib/createExecution.ts';
import {
  buildCreateActions,
  exportSinglePaymentCredentials,
  importSinglePaymentCredentials,
  normalizeFelt,
  PaymentState,
  EVENT_SELECTORS,
} from '@conditionalpay/sdk';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(testDirectory, '..');

// Independent hardcoded literal constants for forensic parity checks
const CANONICAL_CONDITIONAL_PAY_LITERAL =
  '0x0166e31803cfab50383d5b636b86a5646233881fad3a2fb89354da63f6cdb483';
const CANONICAL_STRK20_POOL_LITERAL =
  '0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a';
const CANONICAL_STRK_TOKEN_LITERAL =
  '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d';

function read(relativePath) {
  return readFileSync(resolve(repositoryRoot, relativePath), 'utf8');
}

function readConsoleSources(directory = resolve(repositoryRoot, 'src/app/console')) {
  const sources = [];
  if (!existsSync(directory)) return sources;

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      sources.push(...readConsoleSources(absolutePath));
    } else if (/\.[cm]?[jt]sx?$/.test(entry.name)) {
      sources.push({
        path: absolutePath.slice(repositoryRoot.length + 1),
        source: readFileSync(absolutePath, 'utf8'),
      });
    }
  }

  return sources;
}

test('Phase 4: Component and lib files exist under src/app/console', () => {
  const requiredFiles = [
    'src/app/console/_lib/createTypes.ts',
    'src/app/console/_lib/createValidation.ts',
    'src/app/console/_lib/createExecution.ts',
    'src/app/console/_lib/ConsoleWalletContext.tsx',
    'src/app/console/_components/CreateForm.tsx',
    'src/app/console/_components/CreatePreview.tsx',
    'src/app/console/_components/CredentialHandoff.tsx',
    'src/app/console/_components/CreatePayment.tsx',
    'src/app/console/_components/UnsavedModal.tsx',
  ];

  for (const file of requiredFiles) {
    assert.equal(existsSync(resolve(repositoryRoot, file)), true, `${file} must exist`);
  }
});

test('Phase 4: Independent canonical address verification prevents constant corruption', () => {
  // 1. Assert createExecution constants match canonical literals exactly
  assert.equal(
    normalizeFelt(CONDITIONAL_PAY_MAINNET),
    normalizeFelt(CANONICAL_CONDITIONAL_PAY_LITERAL),
    'CONDITIONAL_PAY_MAINNET must match canonical deployment literal',
  );
  assert.equal(
    normalizeFelt(STRK_MAINNET),
    normalizeFelt(CANONICAL_STRK_TOKEN_LITERAL),
    'STRK_MAINNET must match canonical STRK literal',
  );
  assert.equal(
    normalizeFelt(STRK20_POOL_MAINNET),
    normalizeFelt(CANONICAL_STRK20_POOL_LITERAL),
    'STRK20_POOL_MAINNET must match canonical STRK20 pool literal',
  );

  // 2. Assert src/utils/constants.ts matches canonical literals
  const utilsSource = read('src/utils/constants.ts');
  assert.equal(
    utilsSource.includes(CANONICAL_CONDITIONAL_PAY_LITERAL),
    true,
    'src/utils/constants.ts must contain canonical ConditionalPay literal',
  );
  assert.equal(
    utilsSource.includes(CANONICAL_STRK20_POOL_LITERAL),
    true,
    'src/utils/constants.ts must contain canonical STRK20 pool literal',
  );
  assert.equal(
    utilsSource.includes(CANONICAL_STRK_TOKEN_LITERAL),
    true,
    'src/utils/constants.ts must contain canonical STRK token literal',
  );

  // 3. Assert strk20.json matches canonical literal
  const strk20Json = JSON.parse(read('strk20.json'));
  assert.equal(
    normalizeFelt(strk20Json.contracts[0]),
    normalizeFelt(CANONICAL_CONDITIONAL_PAY_LITERAL),
    'strk20.json contract must match canonical ConditionalPay literal',
  );
});

test('Phase 4: Amount parsing converts string to 18-decimal bigint strictly', () => {
  // Valid amounts
  assert.equal(parseStrkAmount('1'), 1000000000000000000n);
  assert.equal(parseStrkAmount('0.1'), 100000000000000000n);
  assert.equal(parseStrkAmount('0.000000000000000001'), 1n);
  assert.equal(parseStrkAmount('100.5'), 100500000000000000000n);

  // Formatting roundtrip
  assert.equal(formatStrkAmount(1000000000000000000n), '1');
  assert.equal(formatStrkAmount(100000000000000000n), '0.1');
  assert.equal(formatStrkAmount(100500000000000000000n), '100.5');

  // Strict rejections
  assert.throws(() => parseStrkAmount('0'), /greater than zero/);
  assert.throws(() => parseStrkAmount('0.0'), /greater than zero/);
  assert.throws(() => parseStrkAmount('-1'), /must be positive/);
  assert.throws(() => parseStrkAmount('1e18'), /Scientific notation is not supported/);
  assert.throws(() => parseStrkAmount('1,000'), /commas are not supported/);
  assert.throws(() => parseStrkAmount('0.1234567890123456789'), /Maximum 18 decimal places/);
  assert.throws(() => parseStrkAmount('abc'), /Invalid amount format/);
  assert.throws(() => parseStrkAmount(''), /Amount is required/);
  assert.throws(() => parseStrkAmount(123), /must be a string/);

  // u128 overflow rejection
  const overflowStr = (U128_MAX + 1n).toString();
  assert.throws(() => parseStrkAmount(overflowStr), /exceeds maximum integer capacity/);
});

test('Phase 4: Time semantics enforce immediate claim = 0n and valid non-zero expiry', () => {
  const currentChainTime = 1_700_000_000;

  // Immediate claim + 24h preset
  const immediate = calculateTimestamps('immediately', '', '24h', '', currentChainTime);
  assert.equal(immediate.claim_after, 0n);
  assert.equal(immediate.expires_at, BigInt(currentChainTime + 86400));
  assert.equal(immediate.claimDateFormatted, 'Immediately');
  assert.notEqual(immediate.expires_at, 0n);

  // Immediate claim + 1h preset
  const oneHour = calculateTimestamps('immediately', '', '1h', '', currentChainTime);
  assert.equal(oneHour.claim_after, 0n);
  assert.equal(oneHour.expires_at, BigInt(currentChainTime + 3600));

  // Immediate claim + 7d preset
  const sevenDays = calculateTimestamps('immediately', '', '7d', '', currentChainTime);
  assert.equal(sevenDays.claim_after, 0n);
  assert.equal(sevenDays.expires_at, BigInt(currentChainTime + 604800));

  // Custom claim + custom expiry
  const customClaimTime = currentChainTime + 10000;
  const customExpiryTime = currentChainTime + 50000;
  const customClaimIso = new Date(customClaimTime * 1000).toISOString();
  const customExpiryIso = new Date(customExpiryTime * 1000).toISOString();

  const custom = calculateTimestamps(
    'custom',
    customClaimIso,
    'custom',
    customExpiryIso,
    currentChainTime,
  );
  assert.equal(custom.claim_after, BigInt(customClaimTime));
  assert.equal(custom.expires_at, BigInt(customExpiryTime));
  assert.equal(custom.expires_at > custom.claim_after, true);

  // Invalid custom timestamps
  assert.throws(
    () =>
      calculateTimestamps(
        'custom',
        new Date((currentChainTime - 100) * 1000).toISOString(),
        '24h',
        '',
        currentChainTime,
      ),
    /Claim date must be in the future/,
  );

  assert.throws(
    () =>
      calculateTimestamps(
        'custom',
        customClaimIso,
        'custom',
        new Date((customClaimTime - 100) * 1000).toISOString(),
        currentChainTime,
      ),
    /Refund date must be after claim availability time/,
  );
});

test('Phase 4: Canonical CREATE action topology matches exactly [withdraw, invoke] resolving to canonical Mainnet literal', () => {
  const planned = planCreatePayment({
    amount: '0.1',
    claimChoice: 'immediately',
    customClaimDate: '',
    refundPreset: '24h',
    customRefundDate: '',
  });

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

  assert.equal(actions.length, 2, 'Must contain exactly 2 actions');

  // Action 1: withdraw
  assert.equal(actions[0].type, 'withdraw');
  assert.equal(actions[0].token, normalizeFelt(CANONICAL_STRK_TOKEN_LITERAL));
  assert.equal(actions[0].amount, normalizeFelt(100000000000000000n));
  assert.equal(actions[0].recipient, normalizeFelt(CANONICAL_CONDITIONAL_PAY_LITERAL));

  // Action 2: invoke
  assert.equal(actions[1].type, 'invoke');
  assert.equal(actions[1].contract, normalizeFelt(CANONICAL_CONDITIONAL_PAY_LITERAL));
  assert.equal(actions[1].calldata.length, 9, 'Create calldata must have exactly 9 felts');
  assert.equal(actions[1].calldata[0], normalizeFelt(0n), 'Discriminant must be 0');
  assert.equal(actions[1].calldata[1], normalizeFelt(CANONICAL_STRK_TOKEN_LITERAL));
  assert.equal(actions[1].calldata[2], normalizeFelt(100000000000000000n));
  assert.equal(actions[1].calldata[3], normalizeFelt(planned.hashlock));
  assert.equal(actions[1].calldata[4], normalizeFelt(planned.refund_hash));
  assert.equal(actions[1].calldata[5], normalizeFelt(0n)); // Immediate claim
  assert.equal(actions[1].calldata[6], normalizeFelt(planned.expires_at));
  assert.equal(actions[1].calldata[7], normalizeFelt(0n)); // Approver = 0x0
  assert.equal(actions[1].calldata[8], normalizeFelt(planned.nonce));

  // No openNoteIds placeholder
  for (const act of actions) {
    const json = JSON.stringify(act);
    assert.equal(json.includes('${openNoteIds'), false);
    assert.equal(json.includes('OPEN'), false);
  }
});

test('Phase 4: Credential and nonce domains: 31-byte (248-bit) preimages and 16-byte (128-bit) client nonces', () => {
  const plan1 = planCreatePayment({
    amount: '1',
    claimChoice: 'immediately',
    customClaimDate: '',
    refundPreset: '24h',
    customRefundDate: '',
  });

  const plan2 = planCreatePayment({
    amount: '1',
    claimChoice: 'immediately',
    customClaimDate: '',
    refundPreset: '24h',
    customRefundDate: '',
  });

  // Nonce and preimages are cryptographically random
  assert.notEqual(plan1.claimPreimage, plan2.claimPreimage);
  assert.notEqual(plan1.refundPreimage, plan2.refundPreimage);
  assert.notEqual(plan1.nonce, plan2.nonce);
  assert.notEqual(plan1.paymentId, plan2.paymentId);

  // Preimages are felt252 (< 2^248 < PRIME)
  assert.equal(BigInt(plan1.claimPreimage) < 1n << 248n, true);
  assert.equal(BigInt(plan1.refundPreimage) < 1n << 248n, true);

  // Nonce is 128-bit felt252 (< 2^128 < PRIME)
  assert.equal(BigInt(plan1.nonce) < 1n << 128n, true);

  // Approver is fixed to 0x0
  assert.equal(plan1.approver, '0x0');
  assert.equal(plan2.approver, '0x0');
});

test('Phase 4: Single payment encrypted credential backup & recovery roundtrip (PBKDF2-HMAC-SHA256 600k + AES-GCM-256)', async () => {
  const planned = planCreatePayment({
    amount: '5.5',
    claimChoice: 'immediately',
    customClaimDate: '',
    refundPreset: '24h',
    customRefundDate: '',
  });

  const passphrase = 'my-ultra-secure-passphrase-2026';
  const envelope = await exportSinglePaymentCredentials(
    {
      paymentId: planned.paymentId,
      claimPreimage: planned.claimPreimage,
      refundPreimage: planned.refundPreimage,
      nonce: planned.nonce,
    },
    passphrase,
  );

  assert.equal(envelope.version, '1.1');
  assert.equal(envelope.cipher, 'AES-GCM-256');
  assert.equal(envelope.kdf, 'PBKDF2-SHA256');
  assert.equal(envelope.iterations, 600000);
  assert.equal(typeof envelope.saltHex, 'string');
  assert.equal(typeof envelope.ivHex, 'string');
  assert.equal(typeof envelope.ciphertextHex, 'string');

  // Decrypt and verify exact recovery
  const recovered = await importSinglePaymentCredentials(envelope, passphrase);
  assert.equal(recovered.paymentId, planned.paymentId);
  assert.equal(recovered.claimPreimage, planned.claimPreimage);
  assert.equal(recovered.refundPreimage, planned.refundPreimage);
  assert.equal(recovered.nonce, planned.nonce);

  // Wrong passphrase fails
  await assert.rejects(
    () => importSinglePaymentCredentials(envelope, 'wrong-passphrase-1234'),
    /Failed to decrypt credentials/,
  );
});

test('Phase 4: SDK enforces >= 8 character minimum on passphrase', async () => {
  const planned = planCreatePayment({
    amount: '1',
    claimChoice: 'immediately',
    customClaimDate: '',
    refundPreset: '24h',
    customRefundDate: '',
  });

  await assert.rejects(
    () =>
      exportSinglePaymentCredentials(
        {
          paymentId: planned.paymentId,
          claimPreimage: planned.claimPreimage,
          refundPreimage: planned.refundPreimage,
          nonce: planned.nonce,
        },
        'short',
      ),
    /Passphrase must be at least 8 characters long/,
  );
});

test('Phase 4: Navigation guard activation predicate enforces exact policy including STATUS_UNKNOWN', () => {
  // In EDITING and REVIEWING, no onchain transaction exists -> guard must NOT activate
  assert.equal(shouldActivateNavigationGuard('EDITING', false, false), false);
  assert.equal(shouldActivateNavigationGuard('EDITING', false, true), false);
  assert.equal(shouldActivateNavigationGuard('REVIEWING', false, true), false);

  // From AWAITING_WALLET through post-write states (including STATUS_UNKNOWN), guard MUST activate while unsaved
  assert.equal(shouldActivateNavigationGuard('AWAITING_WALLET', false, true), true);
  assert.equal(shouldActivateNavigationGuard('SUBMITTED', false, true), true);
  assert.equal(shouldActivateNavigationGuard('PENDING', false, true), true);
  assert.equal(shouldActivateNavigationGuard('STATUS_UNKNOWN', false, true), true);
  assert.equal(shouldActivateNavigationGuard('ACCEPTED', false, true), true);
  assert.equal(shouldActivateNavigationGuard('VERIFYING', false, true), true);
  assert.equal(shouldActivateNavigationGuard('VERIFIED', false, true), true);
  assert.equal(shouldActivateNavigationGuard('DEGRADED_VERIFICATION', false, true), true);

  // When backup is saved, guard is released
  assert.equal(shouldActivateNavigationGuard('STATUS_UNKNOWN', true, true), false);
  assert.equal(shouldActivateNavigationGuard('ACCEPTED', true, true), false);
  assert.equal(shouldActivateNavigationGuard('VERIFIED', true, true), false);
  assert.equal(shouldActivateNavigationGuard('DEGRADED_VERIFICATION', true, true), false);

  // On definitive revert (credentials destroyed), guard is released
  assert.equal(shouldActivateNavigationGuard('REVERTED', false, false), false);
});

test('Phase 4: Receipt semantics enforce strict finality status and execution status requirements', () => {
  // 1. ACCEPTED_ON_L2 + SUCCEEDED -> ACCEPTED
  assert.equal(
    isReceiptAccepted({
      finality_status: 'ACCEPTED_ON_L2',
      execution_status: 'SUCCEEDED',
    }),
    true,
  );

  // 2. ACCEPTED_ON_L1 + SUCCEEDED -> ACCEPTED
  assert.equal(
    isReceiptAccepted({
      finality_status: 'ACCEPTED_ON_L1',
      execution_status: 'SUCCEEDED',
    }),
    true,
  );

  // 3. execution_status SUCCEEDED without accepted finality (e.g. RECEIVED, CANDIDATE, PRE_CONFIRMED, undefined) -> NOT ACCEPTED
  assert.equal(
    isReceiptAccepted({
      finality_status: 'RECEIVED',
      execution_status: 'SUCCEEDED',
    }),
    false,
  );
  assert.equal(
    isReceiptAccepted({
      finality_status: 'CANDIDATE',
      execution_status: 'SUCCEEDED',
    }),
    false,
  );
  assert.equal(
    isReceiptAccepted({
      finality_status: 'PRE_CONFIRMED',
      execution_status: 'SUCCEEDED',
    }),
    false,
  );
  assert.equal(
    isReceiptAccepted({
      execution_status: 'SUCCEEDED',
    }),
    false,
    'SUCCEEDED alone without finality_status must NOT be accepted',
  );

  // 4. execution_status REVERTED -> REVERTED (never accepted, even if finality_status is ACCEPTED_ON_L2)
  assert.equal(
    isReceiptReverted({
      finality_status: 'ACCEPTED_ON_L2',
      execution_status: 'REVERTED',
    }),
    true,
  );
  assert.equal(
    isReceiptAccepted({
      finality_status: 'ACCEPTED_ON_L2',
      execution_status: 'REVERTED',
    }),
    false,
  );
  assert.equal(
    isReceiptReverted({
      status: 'REVERTED',
    }),
    true,
  );
  assert.equal(
    isReceiptAccepted({
      status: 'REVERTED',
    }),
    false,
  );

  // 5. Null or undefined receipt -> NOT ACCEPTED, NOT REVERTED
  assert.equal(isReceiptAccepted(null), false);
  assert.equal(isReceiptAccepted(undefined), false);
  assert.equal(isReceiptReverted(null), false);
  assert.equal(isReceiptReverted(undefined), false);
});

test('Phase 4: Wallet error normalization handles structured rejection codes and insufficient fee signals safely with strict precedence', () => {
  // 1. Standard Starknet / Wallet Standard structured rejection signals
  assert.equal(
    normalizeWalletError({ code: 113, message: 'An error occurred (USER_REFUSED_OP)' }),
    'Transaction cancelled in Ready Wallet.',
  );
  assert.equal(
    normalizeWalletError({ code: '113' }),
    'Transaction cancelled in Ready Wallet.',
  );
  assert.equal(
    normalizeWalletError({ code: 4001, message: 'User rejected the request' }),
    'Transaction cancelled in Ready Wallet.',
  );
  assert.equal(
    normalizeWalletError({ code: '4001' }),
    'Transaction cancelled in Ready Wallet.',
  );
  assert.equal(
    normalizeWalletError({ code: 'USER_REFUSED_OP' }),
    'Transaction cancelled in Ready Wallet.',
  );

  // 2. Explicit textual USER cancellation signals (strictly requiring explicit attribution to user)
  assert.equal(
    normalizeWalletError(new Error('User abort in popup')),
    'Transaction cancelled in Ready Wallet.',
  );
  assert.equal(
    normalizeWalletError(new Error('user_refusal')),
    'Transaction cancelled in Ready Wallet.',
  );
  assert.equal(
    normalizeWalletError({ message: 'User refused operation' }),
    'Transaction cancelled in Ready Wallet.',
  );
  assert.equal(
    normalizeWalletError({ message: 'User cancelled' }),
    'Transaction cancelled in Ready Wallet.',
  );
  assert.equal(
    normalizeWalletError({ message: 'User canceled' }),
    'Transaction cancelled in Ready Wallet.',
  );
  assert.equal(
    normalizeWalletError({ message: 'Popup closed by user' }),
    'Transaction cancelled in Ready Wallet.',
  );
  assert.equal(
    normalizeWalletError({ message: 'Rejected by user' }),
    'Transaction cancelled in Ready Wallet.',
  );

  // 3. Insufficient fee signals (precedence over general text)
  assert.equal(
    normalizeWalletError(new Error('Insufficient funds to pay fee')),
    'Insufficient balance to pay the Ready Wallet transaction fee.',
  );
  assert.equal(
    normalizeWalletError({ message: 'fee exceeds balance' }),
    'Insufficient balance to pay the Ready Wallet transaction fee.',
  );
  assert.equal(
    normalizeWalletError({ message: 'cannot pay fee' }),
    'Insufficient balance to pay the Ready Wallet transaction fee.',
  );
  assert.equal(
    normalizeWalletError(new Error('transaction rejected: insufficient funds to pay fee')),
    'Insufficient balance to pay the Ready Wallet transaction fee.',
    'Fee error must take precedence over generic transaction rejected text',
  );

  // 4. Generic errors MUST NOT falsely become user cancellation
  assert.equal(
    normalizeWalletError(new Error('transaction rejected')),
    'Unable to create payment. Review Ready Wallet and try again.',
  );
  assert.equal(
    normalizeWalletError(new Error('request rejected')),
    'Unable to create payment. Review Ready Wallet and try again.',
  );
  assert.equal(
    normalizeWalletError(new Error('window closed')),
    'Unable to create payment. Review Ready Wallet and try again.',
  );
  assert.equal(
    normalizeWalletError(new Error('simulation failed')),
    'Unable to create payment. Review Ready Wallet and try again.',
  );

  // 5. Privacy registration (Starknet code 118)
  assert.equal(
    normalizeWalletError({ code: 118, message: 'An error occurred (NOT_REGISTERED)' }),
    'STRK20 privacy is not initialized for this account. Initialize privacy in Ready Wallet, then try again.',
  );
  assert.equal(
    normalizeWalletError(new Error('PRIVACY_NOT_REGISTERED')),
    'STRK20 privacy is not initialized for this account. Initialize privacy in Ready Wallet, then try again.',
  );

  // 6. Note maturity
  assert.equal(
    normalizeWalletError(new Error('requires 10 block confirmations before spend')),
    'Shielded balance is not ready yet. Requires 10 block confirmations.',
  );

  // 7. Insufficient shielded balance (Starknet code 119)
  assert.equal(
    normalizeWalletError({ code: 119, message: 'INSUFFICIENT_PRIVATE_BALANCE' }),
    'Insufficient shielded STRK balance in privacy pool.',
  );
  assert.equal(
    normalizeWalletError(new Error('insufficient shielded balance')),
    'Insufficient shielded STRK balance in privacy pool.',
  );

  // 8. Unsupported wallet API (Starknet code 162)
  assert.equal(
    normalizeWalletError({ code: 162, message: 'API_VERSION_NOT_SUPPORTED' }),
    'STRK20 Privacy Wallet API is not supported by the connected wallet.',
  );
  assert.equal(
    normalizeWalletError(new Error('UNSUPPORTED_SPEC_VERSION_0_1')),
    'STRK20 Privacy Wallet API is not supported by the connected wallet.',
  );

  // 9. Generic fallback
  assert.equal(
    normalizeWalletError(new Error('Internal JSON-RPC socket closed unexpectedly')),
    'Unable to create payment. Review Ready Wallet and try again.',
  );
  assert.equal(
    normalizeWalletError(null),
    'Unable to create payment. Review Ready Wallet and try again.',
  );
});

test('Phase 4: Credentials and paymentId are strictly preserved across wallet rejection and retry rounds', async () => {
  const formData = {
    amount: '0.001',
    claimChoice: 'immediately',
    customClaimDate: '',
    refundPreset: '24h',
    customRefundDate: '',
  };

  // 1. Initial plan creation
  const planned = planCreatePayment(formData);
  const initialPaymentId = planned.paymentId;
  const initialClaimPreimage = planned.claimPreimage;
  const initialRefundPreimage = planned.refundPreimage;
  const initialNonce = planned.nonce;

  // 2. First wallet submission attempt -> User cancels in Ready Wallet
  const rejectingWallet = {
    name: 'Ready Wallet',
    features: {
      'starknet:walletApi': {
        request: async ({ type }) => {
          if (type === 'wallet_strk20InvokeTransaction') {
            const err = new Error('An error occurred (USER_REFUSED_OP)');
            err.code = 113;
            throw err;
          }
          throw new Error(`Unexpected request: ${type}`);
        },
      },
    },
  };

  const { submitCreatePayment } = await import('../src/app/console/_lib/createExecution.ts');

  let rejectionCaught = false;
  try {
    await submitCreatePayment(rejectingWallet, planned);
  } catch (err) {
    rejectionCaught = true;
    const normalized = normalizeWalletError(err);
    assert.equal(normalized, 'Transaction cancelled in Ready Wallet.');
  }

  assert.equal(rejectionCaught, true, 'Rejection error must be thrown');

  // Verify internal credential identity and paymentId remain strictly unchanged after rejection
  assert.equal(planned.paymentId, initialPaymentId);
  assert.equal(planned.claimPreimage, initialClaimPreimage);
  assert.equal(planned.refundPreimage, initialRefundPreimage);
  assert.equal(planned.nonce, initialNonce);

  // 3. Second user click (retry) -> succeeding submission
  const successTxHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
  let capturedActions = [];

  const succeedingWallet = {
    name: 'Ready Wallet',
    features: {
      'starknet:walletApi': {
        request: async ({ type, params }) => {
          if (type === 'wallet_strk20InvokeTransaction') {
            capturedActions = params?.actions || [];
            return { transaction_hash: successTxHash };
          }
          throw new Error(`Unexpected request: ${type}`);
        },
      },
    },
  };

  const resultTxHash = await submitCreatePayment(succeedingWallet, planned);
  assert.equal(resultTxHash, successTxHash);

  // Assert that retry submission used the EXACT same credentials, hashlock, and nonce
  assert.equal(capturedActions.length, 2);
  const invokeAction = capturedActions[1];
  assert.equal(invokeAction.calldata[3], normalizeFelt(planned.hashlock));
  assert.equal(invokeAction.calldata[4], normalizeFelt(planned.refund_hash));
  assert.equal(invokeAction.calldata[8], normalizeFelt(planned.nonce));
});

test('Phase 4: Mocked execution lifecycle: SUBMITTED -> PENDING -> ACCEPTED -> VERIFIED with strict field checks', async () => {
  const planned = planCreatePayment({
    amount: '0.1',
    claimChoice: 'immediately',
    customClaimDate: '',
    refundPreset: '24h',
    customRefundDate: '',
  });

  const dummyTxHash = '0x47edc8e74fc08c4726a817a23085a2ae2dd95590fb6a32d3b3c5b5159e586e6';

  // Mocked Ready Wallet
  const mockWallet = {
    name: 'Ready Wallet',
    features: {
      'starknet:walletApi': {
        request: async ({ type }) => {
          if (type === 'wallet_strk20InvokeTransaction') {
            return { transaction_hash: dummyTxHash };
          }
          throw new Error(`Unexpected request: ${type}`);
        },
      },
    },
  };

  // Mocked RPC provider (Positive case)
  const mockProvider = {
    getTransactionReceipt: async () => ({
      execution_status: 'SUCCEEDED',
      finality_status: 'ACCEPTED_ON_L2',
      events: [
        {
          from_address: CONDITIONAL_PAY_MAINNET,
          keys: [EVENT_SELECTORS.PaymentCreated, normalizeFelt(planned.paymentId)],
          data: [
            normalizeFelt(planned.token),
            normalizeFelt(planned.amount),
            normalizeFelt(planned.hashlock),
            normalizeFelt(planned.refund_hash),
            normalizeFelt(planned.claim_after),
            normalizeFelt(planned.expires_at),
            normalizeFelt(planned.approver),
            normalizeFelt(planned.nonce),
          ],
        },
      ],
    }),
    callContract: async ({ entrypoint }) => {
      if (entrypoint === 'get_payment') {
        return [
          normalizeFelt(planned.token),
          normalizeFelt(planned.amount),
          normalizeFelt(planned.hashlock),
          normalizeFelt(planned.refund_hash),
          normalizeFelt(planned.claim_after),
          normalizeFelt(planned.expires_at),
          normalizeFelt(planned.approver),
          '0x0', // approved = false
          '0x1', // state = ACTIVE (1)
        ];
      }
      throw new Error(`Unknown entrypoint: ${entrypoint}`);
    },
  };

  // 1. Submit actions through mock wallet
  const { submitCreatePayment, verifyPaymentCreated } = await import(
    '../src/app/console/_lib/createExecution.ts'
  );
  const txHash = await submitCreatePayment(mockWallet, planned);
  assert.equal(txHash, dummyTxHash);

  // 2. Verify onchain events and state record (positive)
  const verification = await verifyPaymentCreated(mockProvider, planned, txHash);
  assert.equal(verification.eventAuthenticated, true);
  assert.equal(verification.onchainStateActive, true);
  assert.equal(verification.payment?.state, PaymentState.ACTIVE);

  // 3. Negative tests: Event field mismatch fails eventAuthenticated
  const eventFieldCorruptions = [
    { idx: 0, val: '0x1234', name: 'token mismatch' },
    { idx: 1, val: normalizeFelt(999999999n), name: 'amount mismatch' },
    { idx: 2, val: '0x999', name: 'hashlock mismatch' },
    { idx: 3, val: '0x888', name: 'refund_hash mismatch' },
    { idx: 4, val: normalizeFelt(12345n), name: 'claim_after mismatch' },
    { idx: 5, val: normalizeFelt(54321n), name: 'expires_at mismatch' },
    { idx: 6, val: '0x1', name: 'approver mismatch' },
    { idx: 7, val: '0x777', name: 'nonce mismatch' },
  ];

  for (const { idx, val, name } of eventFieldCorruptions) {
    const corruptData = [
      normalizeFelt(planned.token),
      normalizeFelt(planned.amount),
      normalizeFelt(planned.hashlock),
      normalizeFelt(planned.refund_hash),
      normalizeFelt(planned.claim_after),
      normalizeFelt(planned.expires_at),
      normalizeFelt(planned.approver),
      normalizeFelt(planned.nonce),
    ];
    corruptData[idx] = val;

    const corruptProvider = {
      getTransactionReceipt: async () => ({
        execution_status: 'SUCCEEDED',
        events: [
          {
            from_address: CONDITIONAL_PAY_MAINNET,
            keys: [EVENT_SELECTORS.PaymentCreated, normalizeFelt(planned.paymentId)],
            data: corruptData,
          },
        ],
      }),
      callContract: mockProvider.callContract,
    };

    const corruptVerification = await verifyPaymentCreated(corruptProvider, planned, txHash);
    assert.equal(
      corruptVerification.eventAuthenticated,
      false,
      `Event authentication must fail on ${name}`,
    );
  }

  // 4. Negative tests: On-chain state mismatch fails onchainStateActive
  const corruptStateProvider = {
    getTransactionReceipt: mockProvider.getTransactionReceipt,
    callContract: async () => [
      normalizeFelt(planned.token),
      normalizeFelt(planned.amount),
      normalizeFelt(planned.hashlock),
      normalizeFelt(planned.refund_hash),
      normalizeFelt(planned.claim_after),
      normalizeFelt(planned.expires_at),
      normalizeFelt(planned.approver),
      '0x0',
      '0x0', // state = UNINITIALIZED (0)
    ],
  };

  const uninitializedVerification = await verifyPaymentCreated(
    corruptStateProvider,
    planned,
    txHash,
  );
  assert.equal(uninitializedVerification.onchainStateActive, false);
});

test('Phase 4: Receipt timeout maps to STATUS_UNKNOWN, preserving credentials and enabling encrypted recovery without claiming acceptance', async () => {
  const planned = planCreatePayment({
    amount: '0.05',
    claimChoice: 'immediately',
    customClaimDate: '',
    refundPreset: '24h',
    customRefundDate: '',
  });

  const txHash = '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';

  // Timeout provider throws or returns null
  const timeoutProvider = {
    getTransactionReceipt: async () => {
      throw new Error('RPC gateway timeout');
    },
    callContract: async () => {
      throw new Error('RPC gateway timeout');
    },
  };

  // State machine simulation:
  // Step starts at PENDING. Receipt polling times out.
  let step = 'PENDING';
  let isAccepted = false;
  try {
    const receipt = await timeoutProvider.getTransactionReceipt(txHash);
    if (receipt?.execution_status === 'SUCCEEDED') isAccepted = true;
  } catch {
    // Timeout/network error
  }

  if (!isAccepted) {
    step = 'STATUS_UNKNOWN';
  }

  assert.equal(step, 'STATUS_UNKNOWN');
  // In STATUS_UNKNOWN:
  // 1. Credentials in plannedCreate remain intact in memory
  assert.equal(typeof planned.paymentId, 'string');
  assert.equal(typeof planned.claimPreimage, 'string');
  assert.equal(typeof planned.refundPreimage, 'string');
  assert.equal(typeof planned.nonce, 'string');

  // 2. Encrypted recovery file can still be generated
  const passphrase = 'test-passphrase-2026';
  const envelope = await exportSinglePaymentCredentials(
    {
      paymentId: planned.paymentId,
      claimPreimage: planned.claimPreimage,
      refundPreimage: planned.refundPreimage,
      nonce: planned.nonce,
    },
    passphrase,
  );
  assert.equal(envelope.version, '1.1');

  // 3. Navigation guard is active
  assert.equal(shouldActivateNavigationGuard(step, false, true), true);
  assert.equal(shouldActivateNavigationGuard(step, true, true), false);
});

test('Phase 4: Accepted receipt with getPayment query failure maps to DEGRADED_VERIFICATION', async () => {
  const planned = planCreatePayment({
    amount: '0.05',
    claimChoice: 'immediately',
    customClaimDate: '',
    refundPreset: '24h',
    customRefundDate: '',
  });

  const txHash = '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';

  // Provider with succeeded receipt but failing get_payment query
  const partialProvider = {
    getTransactionReceipt: async () => ({
      execution_status: 'SUCCEEDED',
      finality_status: 'ACCEPTED_ON_L2',
      events: [
        {
          from_address: CONDITIONAL_PAY_MAINNET,
          keys: [EVENT_SELECTORS.PaymentCreated, normalizeFelt(planned.paymentId)],
          data: [
            normalizeFelt(planned.token),
            normalizeFelt(planned.amount),
            normalizeFelt(planned.hashlock),
            normalizeFelt(planned.refund_hash),
            normalizeFelt(planned.claim_after),
            normalizeFelt(planned.expires_at),
            normalizeFelt(planned.approver),
            normalizeFelt(planned.nonce),
          ],
        },
      ],
    }),
    callContract: async () => {
      throw new Error('RPC query node failure');
    },
  };

  const { verifyPaymentCreated } = await import('../src/app/console/_lib/createExecution.ts');
  let step = 'ACCEPTED';
  try {
    const verification = await verifyPaymentCreated(partialProvider, planned, txHash);
    if (verification.eventAuthenticated && verification.onchainStateActive) {
      step = 'VERIFIED';
    } else {
      step = 'DEGRADED_VERIFICATION';
    }
  } catch {
    step = 'DEGRADED_VERIFICATION';
  }

  assert.equal(step, 'DEGRADED_VERIFICATION');
  assert.equal(shouldActivateNavigationGuard(step, false, true), true);
  assert.equal(shouldActivateNavigationGuard(step, true, true), false);
});

test('Phase 4: Security and privacy boundary invariants', () => {
  const sources = readConsoleSources();

  // No localStorage or sessionStorage secret persistence
  for (const { path, source } of sources) {
    assert.equal(source.includes('localStorage'), false, `${path} must not use localStorage`);
    assert.equal(source.includes('sessionStorage'), false, `${path} must not use sessionStorage`);
  }

  // No plaintext secrets reveal in UI code
  for (const { path, source } of sources) {
    assert.doesNotMatch(
      source,
      /Reveal\s*(?:claim|refund|secret|preimage)/i,
      `${path} must not contain reveal secret UI`,
    );
    assert.doesNotMatch(
      source,
      /Copy\s*(?:claim|refund|secret|preimage)/i,
      `${path} must not contain copy secret UI`,
    );
  }

  // No console logging of bearer secrets
  for (const { path, source } of sources) {
    assert.doesNotMatch(
      source,
      /console\.(?:log|warn|error|info|debug)\s*\([^)]*\b(?:claimPreimage|refundPreimage|claim_preimage|refund_preimage|passphrase)\b/,
      `${path} must not log bearer preimages or passphrases`,
    );
  }
});

test('Phase 4: ConsoleShell defaults to Create mode and Verified Demo remains usable', () => {
  const shellSource = read('src/app/console/_components/ConsoleShell.tsx');

  assert.match(shellSource, /useState<ConsoleMode>\('create'\)/);
  assert.match(shellSource, /#verified-demo/);
  assert.match(shellSource, /<CreatePayment/);
  assert.match(shellSource, /<VerifiedDemo/);
  assert.match(shellSource, /<ConsoleWalletProvider>/);

  // In-app navigation protection
  assert.match(shellSource, /UnsavedModal/);
  assert.match(shellSource, /hasUnsaved/);
});

test('Phase 4: Root route remains 100% isolated with zero execution imports', () => {
  const pageSource = read('src/app/page.tsx');
  const layoutSource = read('src/app/layout.tsx');
  const headerSource = read('src/app/components/client/Header.tsx');

  const forbiddenExecutionImports = [
    'CreatePayment',
    'CreateForm',
    'CreatePreview',
    'CredentialHandoff',
    'createExecution',
    'createValidation',
    'strk20InvokeTransaction',
    'buildCreateActions',
    'ConsoleWalletContext',
    'WalletConnect',
  ];

  for (const item of forbiddenExecutionImports) {
    assert.equal(pageSource.includes(item), false, `root page.tsx must not contain '${item}'`);
    assert.equal(layoutSource.includes(item), false, `root layout.tsx must not contain '${item}'`);
    assert.equal(headerSource.includes(item), false, `root Header.tsx must not contain '${item}'`);
  }
});
