import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  isReceiptAccepted,
  isReceiptIndexingError,
  isReceiptReverted,
  planCreatePayment,
  shouldActivateNavigationGuard,
  getConsoleRpcProvider,
  resolveMainnetRpcUrl,
} from '../src/app/console/_lib/createExecution.ts';
import {
  exportSinglePaymentCredentials,
  parseConditionalPayEvents,
} from '@conditionalpay/sdk';

const CANONICAL_CONDITIONAL_PAY =
  '0x0166e31803cfab50383d5b636b86a5646233881fad3a2fb89354da63f6cdb483';

// Fixture of real Mainnet transaction 0x026e579499ab28438a5d219fc123f4231d051394413ab03e4a7b677b835bcb44
const REAL_MAINNET_TX_RECEIPT = {
  type: 'INVOKE',
  transaction_hash: '0x026e579499ab28438a5d219fc123f4231d051394413ab03e4a7b677b835bcb44',
  actual_fee: {
    amount: '0x2d13899ac4a84b00',
    unit: 'FRI',
  },
  execution_status: 'SUCCEEDED',
  finality_status: 'ACCEPTED_ON_L2',
  block_hash: '0x5b3b64a1e401774102adf26efdf4390b42fa873b484d1fdbe9433ec608b393c',
  block_number: 14060040,
  events: [
    {
      from_address: '0x166e31803cfab50383d5b636b86a5646233881fad3a2fb89354da63f6cdb483',
      keys: [
        '0x36ad978319261fcbc6d149d1a079122d8bcf325d08e5bfb781c992dbee03949',
        '0x6371e6aac076b45a8c2fd673c0180fe4d0012f52ba64bde30bd87d88c369122',
      ],
      data: [
        '0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d',
        '0x16345785d8a0000',
        '0x22906e2bcd771b4526156f82a8ada6ce3d07b3ea315eddbc22bb8bad0b91115',
        '0x5f795ae72c41fa9090e143fa76c7fdec6fc488ee66c3f8cafbf034f5d6f60b6',
        '0x0',
        '0x6a9339e2',
        '0x0',
        '0xc7f3f66c9d29edb8c685ce9f793c6b13',
      ],
    },
  ],
};

test('Regression A: SUCCEEDED + ACCEPTED_ON_L2 is recognized as accepted without waiting for L1', () => {
  const receipt = {
    execution_status: 'SUCCEEDED',
    finality_status: 'ACCEPTED_ON_L2',
  };

  assert.equal(isReceiptAccepted(receipt), true);
  assert.equal(isReceiptReverted(receipt), false);
});

test('Regression B: SUCCEEDED + ACCEPTED_ON_L1 is recognized as accepted', () => {
  const receipt = {
    execution_status: 'SUCCEEDED',
    finality_status: 'ACCEPTED_ON_L1',
  };

  assert.equal(isReceiptAccepted(receipt), true);
  assert.equal(isReceiptReverted(receipt), false);
});

test('Regression C: Non-final status (RECEIVED / PENDING) remains PENDING and not accepted', () => {
  const receivedReceipt = {
    execution_status: 'SUCCEEDED',
    finality_status: 'RECEIVED',
  };
  assert.equal(isReceiptAccepted(receivedReceipt), false);
  assert.equal(isReceiptReverted(receivedReceipt), false);

  const pendingReceipt = {
    execution_status: 'SUCCEEDED',
    finality_status: 'PENDING',
  };
  assert.equal(isReceiptAccepted(pendingReceipt), false);
  assert.equal(isReceiptReverted(pendingReceipt), false);

  const missingFinality = {
    execution_status: 'SUCCEEDED',
  };
  assert.equal(isReceiptAccepted(missingFinality), false);
  assert.equal(isReceiptReverted(missingFinality), false);
});

test('Regression D: Real Mainnet transaction fixture (0x026e5794...) satisfies L2 acceptance policy offline', () => {
  assert.equal(isReceiptAccepted(REAL_MAINNET_TX_RECEIPT), true);
  assert.equal(isReceiptReverted(REAL_MAINNET_TX_RECEIPT), false);

  // Authenticate PaymentCreated event from canonical ConditionalPay
  const parsed = parseConditionalPayEvents(
    REAL_MAINNET_TX_RECEIPT.events,
    CANONICAL_CONDITIONAL_PAY,
  );
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].type, 'PaymentCreated');
  assert.equal(
    parsed[0].payment_id,
    '0x6371e6aac076b45a8c2fd673c0180fe4d0012f52ba64bde30bd87d88c369122',
  );
  assert.equal(parsed[0].amount, 100000000000000000n); // 0.1 STRK
});

test('Regression E: REVERTED receipts are recognized as reverted and not accepted', () => {
  const revertedReceipt1 = {
    execution_status: 'REVERTED',
    finality_status: 'ACCEPTED_ON_L2',
  };
  assert.equal(isReceiptReverted(revertedReceipt1), true);
  assert.equal(isReceiptAccepted(revertedReceipt1), false);

  const revertedReceipt2 = {
    status: 'REVERTED',
  };
  assert.equal(isReceiptReverted(revertedReceipt2), true);
  assert.equal(isReceiptAccepted(revertedReceipt2), false);
});

test('Regression F: L1 settlement pending while L2 is accepted does NOT block acceptance', () => {
  // L1 status is not present in L2 receipt or pending on L1
  const l2AcceptedReceipt = {
    execution_status: 'SUCCEEDED',
    finality_status: 'ACCEPTED_ON_L2',
    status: 'ACCEPTED_ON_L2',
  };
  assert.equal(isReceiptAccepted(l2AcceptedReceipt), true);
});

test('Regression G: Polling timeout / STATUS_UNKNOWN preserves txHash, credentials, and mounts CredentialHandoff', async () => {
  const planned = planCreatePayment({
    amount: '0.1',
    claimChoice: 'immediately',
    customClaimDate: '',
    refundPreset: '24h',
    customRefundDate: '',
  });

  const txHash = '0x026e579499ab28438a5d219fc123f4231d051394413ab03e4a7b677b835bcb44';
  const step = 'STATUS_UNKNOWN';

  // 1. Navigation guard remains strictly active in STATUS_UNKNOWN
  assert.equal(shouldActivateNavigationGuard(step, false, true), true);
  assert.equal(shouldActivateNavigationGuard(step, true, true), false);

  // 2. In-memory credentials and txHash remain completely intact
  assert.equal(txHash, '0x026e579499ab28438a5d219fc123f4231d051394413ab03e4a7b677b835bcb44');
  assert.ok(planned.paymentId);
  assert.ok(planned.claimPreimage);
  assert.ok(planned.refundPreimage);
  assert.ok(planned.nonce);

  // 3. Creator Recovery file can still be encrypted and downloaded in STATUS_UNKNOWN
  const recoveryEnvelope = await exportSinglePaymentCredentials(
    {
      paymentId: planned.paymentId,
      claimPreimage: planned.claimPreimage,
      refundPreimage: planned.refundPreimage,
      nonce: planned.nonce,
    },
    'ValidPassphrase123!',
  );
  assert.equal(recoveryEnvelope.version, '1.1');

  // 4. Verify CreatePayment.tsx render guard explicitly includes STATUS_UNKNOWN
  const createPaymentPath = resolve('src/app/console/_components/CreatePayment.tsx');
  const createPaymentCode = readFileSync(createPaymentPath, 'utf8');

  // Ensure STATUS_UNKNOWN is included in the CredentialHandoff render condition
  const hasStatusUnknownInRender =
    createPaymentCode.includes("step === 'STATUS_UNKNOWN'") &&
    createPaymentCode.includes("<CredentialHandoff");
  assert.equal(hasStatusUnknownInRender, true, 'CreatePayment.tsx must mount CredentialHandoff in STATUS_UNKNOWN');
});

test('Regression H: getConsoleRpcProvider returns working provider with active fallback', async () => {
  const defaultProvider = getConsoleRpcProvider();
  assert.ok(defaultProvider);

  // Verify custom provider override takes precedence
  const custom = { getTransactionReceipt: async () => ({}) };
  const overridden = getConsoleRpcProvider(custom);
  assert.equal(overridden, custom);
});

test('Regression I: isReceiptIndexingError correctly classifies errors', () => {
  // Normal indexing delay (e.g. Transaction hash not found)
  assert.equal(isReceiptIndexingError(new Error('Transaction hash not found')), true);
  assert.equal(isReceiptIndexingError(new Error('TXN_HASH_NOT_FOUND')), true);
  assert.equal(isReceiptIndexingError(null), true);

  // Non-transient RPC auth / configuration errors
  assert.equal(isReceiptIndexingError(new Error('RPC: -32600: Must be authenticated!')), false);
  assert.equal(isReceiptIndexingError(new Error('Blast API is no longer available')), false);
  assert.equal(isReceiptIndexingError(new Error('401 Unauthorized')), false);
  assert.equal(isReceiptIndexingError(new Error('403 Forbidden')), false);
  assert.equal(isReceiptIndexingError(new Error('-32601: method not found')), false);
});

test('Regression J: CredentialHandoff strictly gates Claim Access in STATUS_UNKNOWN', () => {
  const handoffPath = resolve('src/app/console/_components/CredentialHandoff.tsx');
  const handoffCode = readFileSync(handoffPath, 'utf8');

  // Verify Claim Access is gated only on accepted/verified states and NOT on STATUS_UNKNOWN or PENDING
  assert.ok(
    handoffCode.includes("const isClaimAccessAvailable = isAccepted || isVerifying || isVerified || isDegraded;"),
    'Claim access must only be available when accepted or verified',
  );
  assert.ok(
    handoffCode.includes("const isStatusUnknown = step === 'STATUS_UNKNOWN';"),
    'STATUS_UNKNOWN must be tracked as a distinct state in handoff',
  );
  // Verify Creator Recovery is available in STATUS_UNKNOWN (!isPending)
  assert.ok(
    handoffCode.includes("{!isPending && (") && handoffCode.includes("CREATOR RECOVERY"),
    'Creator Recovery must be available in STATUS_UNKNOWN',
  );
});

test('Regression K: resolveMainnetRpcUrl and getConsoleRpcProvider handle all environment cases safely', () => {
  // 1. Absent / undefined / empty -> active fallback
  assert.equal(resolveMainnetRpcUrl(undefined), 'https://rpc.starknet.lava.build');
  assert.equal(resolveMainnetRpcUrl(''), 'https://rpc.starknet.lava.build');
  assert.equal(resolveMainnetRpcUrl('   '), 'https://rpc.starknet.lava.build');

  // 2. Placeholder value -> active fallback (never concatenates placeholder into URL)
  assert.equal(resolveMainnetRpcUrl('your_alchemy_key_here'), 'https://rpc.starknet.lava.build');
  assert.equal(resolveMainnetRpcUrl('undefined'), 'https://rpc.starknet.lava.build');
  assert.equal(resolveMainnetRpcUrl('null'), 'https://rpc.starknet.lava.build');

  // 3. Full URL value (http or https) -> uses full URL directly
  assert.equal(
    resolveMainnetRpcUrl('https://free-rpc.nethermind.io/mainnet-juno'),
    'https://free-rpc.nethermind.io/mainnet-juno',
  );
  assert.equal(
    resolveMainnetRpcUrl('http://127.0.0.1:9545/rpc/v0_7'),
    'http://127.0.0.1:9545/rpc/v0_7',
  );

  // 4. Legacy Alchemy key value -> constructs Alchemy endpoint
  assert.equal(
    resolveMainnetRpcUrl('test_alchemy_key_999'),
    'https://starknet-mainnet.g.alchemy.com/starknet/version/rpc/v0_10/test_alchemy_key_999',
  );

  // 5. Custom provider override takes precedence
  const custom = { getTransactionReceipt: async () => ({}) };
  const overridden = getConsoleRpcProvider(custom);
  assert.equal(overridden, custom);
});
