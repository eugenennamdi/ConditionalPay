import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computePaymentIdOnchain,
  decodeCairoBool,
  getLockedByToken,
  getPayment,
  getStrk20Pool,
  isApprovalGated,
  isPaymentActive,
  isPaymentInitialized,
  requiresApproval,
} from '../src/query.js';
import { computePaymentId, normalizeFelt } from '../src/hashing.js';
import { buildClaimActions, buildRefundActions } from '../src/actions.js';
import { CreateParams, Payment, PaymentState } from '../src/types.js';
import type { CallContractProvider } from '../src/query.js';

type ContractCall = Parameters<CallContractProvider['callContract']>[0];

describe('ConditionalPay Query Layer', () => {
  const conditionalPay = '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const token = '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d';
  const paymentId = '0x5f63ac970629bfb6539bb18df38d3a34cf8ff7e1ed9a2300d8315f38f5d166';
  const approverAddress = '0x053b40a647cedfca6ca84f542a0fe3673603190d52737e333680420fa390776a';
  const poolAddress = '0x053b40a647cedfca6ca84f542a0fe3673603190d52737e333680420fa390776a';

  const mockCreateParams: CreateParams = {
    token,
    amount: 1000000000000000000n,
    hashlock: '0x7b52c408bddeaaf8cc36a4c6c3bfd24c7a0e7b241b9fcad83c2c8173cd01261',
    refund_hash: '0x30c804f6f6b24dd19f29ff4bc2b54f1f44cb336a90dca293b80b413c0599ac5',
    claim_after: '100',
    expires_at: '300',
    approver: '0x0',
    nonce: '1',
  };

  describe('decodeCairoBool (Strict Cairo Boolean Decoding)', () => {
    it('decodes 0 as false and 1 as true', () => {
      assert.equal(decodeCairoBool('0'), false);
      assert.equal(decodeCairoBool('0x0'), false);
      assert.equal(decodeCairoBool('1'), true);
      assert.equal(decodeCairoBool('0x1'), true);
    });

    it('strictly rejects non-boolean numbers (e.g. 2, 3) with RangeError', () => {
      assert.throws(() => decodeCairoBool('2'), { name: 'RangeError' });
      assert.throws(() => decodeCairoBool('0x2'), { name: 'RangeError' });
      assert.throws(() => decodeCairoBool('10'), { name: 'RangeError' });
    });

    it('strictly rejects malformed boolean strings with TypeError', () => {
      assert.throws(() => decodeCairoBool('true'), { name: 'TypeError' });
      assert.throws(() => decodeCairoBool('invalid'), { name: 'TypeError' });
    });
  });

  describe('Approval Helper Semantics (isApprovalGated & requiresApproval)', () => {
    it('evaluates zero approver, approved false -> not gated, does not require approval', () => {
      const payment: Payment = {
        token,
        amount: 100n,
        hashlock: '0x1',
        refund_hash: '0x2',
        claim_after: 0n,
        expires_at: 0n,
        approver: '0x0',
        approved: false,
        state: PaymentState.ACTIVE,
      };

      assert.equal(isApprovalGated(payment), false);
      assert.equal(requiresApproval(payment), false);
    });

    it('evaluates configured approver, approved false -> gated, requires approval', () => {
      const payment: Payment = {
        token,
        amount: 100n,
        hashlock: '0x1',
        refund_hash: '0x2',
        claim_after: 0n,
        expires_at: 0n,
        approver: approverAddress,
        approved: false,
        state: PaymentState.ACTIVE,
      };

      assert.equal(isApprovalGated(payment), true);
      assert.equal(requiresApproval(payment), true);
    });

    it('evaluates configured approver, approved true -> gated, does not require approval (already approved)', () => {
      const payment: Payment = {
        token,
        amount: 100n,
        hashlock: '0x1',
        refund_hash: '0x2',
        claim_after: 0n,
        expires_at: 0n,
        approver: approverAddress,
        approved: true,
        state: PaymentState.ACTIVE,
      };

      assert.equal(isApprovalGated(payment), true);
      assert.equal(requiresApproval(payment), false);
    });
  });

  describe('getPayment', () => {
    it('calls get_payment entrypoint with exact calldata and decodes ACTIVE payment', async () => {
      let executedCall!: ContractCall;

      const mockProvider = {
        async callContract(call: ContractCall) {
          executedCall = call;
          return [
            token, // 0: token
            '0xde0b6b3a7640000', // 1: amount (1 STRK)
            '0x7b52c408bddeaaf8cc36a4c6c3bfd24c7a0e7b241b9fcad83c2c8173cd01261', // 2: hashlock
            '0x30c804f6f6b24dd19f29ff4bc2b54f1f44cb336a90dca293b80b413c0599ac5', // 3: refund_hash
            '0x64', // 4: claim_after (100)
            '0x12c', // 5: expires_at (300)
            '0x0', // 6: approver (0x0)
            '0x0', // 7: approved (false)
            '0x1', // 8: state (1 = ACTIVE)
          ];
        },
      };

      const payment = await getPayment(mockProvider, conditionalPay, paymentId);

      assert.equal(executedCall.contractAddress, normalizeFelt(conditionalPay));
      assert.equal(executedCall.entrypoint, 'get_payment');
      assert.deepEqual(executedCall.calldata, [normalizeFelt(paymentId)]);

      assert.equal(payment.token, normalizeFelt(token));
      assert.equal(payment.amount, 1000000000000000000n);
      assert.equal(payment.claim_after, 100n);
      assert.equal(payment.expires_at, 300n);
      assert.equal(payment.approved, false);
      assert.equal(payment.state, PaymentState.ACTIVE);
      assert.equal(isPaymentActive(payment), true);
      assert.equal(isPaymentInitialized(payment), true);
      assert.equal(isApprovalGated(payment), false);
      assert.equal(requiresApproval(payment), false);
    });

    it('decodes CLAIMED and REFUNDED states correctly', async () => {
      const claimedProvider = {
        async callContract() {
          return [token, '0x64', '0x1', '0x2', '0x0', '0x0', '0x0', '0x0', '0x2']; // state = 2
        },
      };
      const claimed = await getPayment(claimedProvider, conditionalPay, paymentId);
      assert.equal(claimed.state, PaymentState.CLAIMED);
      assert.equal(isPaymentActive(claimed), false);
      assert.equal(isPaymentInitialized(claimed), true);

      const refundedProvider = {
        async callContract() {
          return [token, '0x64', '0x1', '0x2', '0x0', '0x0', '0x0', '0x0', '0x3']; // state = 3
        },
      };
      const refunded = await getPayment(refundedProvider, conditionalPay, paymentId);
      assert.equal(refunded.state, PaymentState.REFUNDED);
      assert.equal(isPaymentActive(refunded), false);
      assert.equal(isPaymentInitialized(refunded), true);
    });

    it('decodes uninitialized zero payment with state UNINITIALIZED (0)', async () => {
      const defaultZeroProvider = {
        async callContract() {
          return ['0x0', '0x0', '0x0', '0x0', '0x0', '0x0', '0x0', '0x0', '0x0']; // state = 0
        },
      };
      const uninit = await getPayment(defaultZeroProvider, conditionalPay, paymentId);
      assert.equal(uninit.state, PaymentState.UNINITIALIZED);
      assert.equal(isPaymentInitialized(uninit), false);
      assert.equal(isPaymentActive(uninit), false);
    });

    it('strictly rejects invalid state discriminant from contract', async () => {
      const invalidStateProvider = {
        async callContract() {
          return [token, '0x64', '0x1', '0x2', '0x0', '0x0', '0x0', '0x0', '0x99']; // invalid state 99
        },
      };
      await assert.rejects(
        () => getPayment(invalidStateProvider, conditionalPay, paymentId),
        /Unknown or invalid PaymentState discriminant/,
      );
    });

    it('strictly rejects invalid approved boolean in get_payment response (e.g. 2)', async () => {
      const invalidBoolProvider = {
        async callContract() {
          return [token, '0x64', '0x1', '0x2', '0x0', '0x0', '0x0', '0x2', '0x1']; // approved = 2
        },
      };
      await assert.rejects(
        () => getPayment(invalidBoolProvider, conditionalPay, paymentId),
        /Invalid boolean value for approved: expected 0 or 1/,
      );
    });

    it('strictly enforces exact 9-felt response cardinality for get_payment', async () => {
      // Too short (8 felts)
      const tooShortProvider = {
        async callContract() {
          return [token, '0x64', '0x1', '0x2', '0x0', '0x0', '0x0', '0x0'];
        },
      };
      await assert.rejects(
        () => getPayment(tooShortProvider, conditionalPay, paymentId),
        /Invalid get_payment response: expected exactly 9 felts, received 8/,
      );

      // Too long (10 felts)
      const tooLongProvider = {
        async callContract() {
          return [token, '0x64', '0x1', '0x2', '0x0', '0x0', '0x0', '0x0', '0x1', '0x999'];
        },
      };
      await assert.rejects(
        () => getPayment(tooLongProvider, conditionalPay, paymentId),
        /Invalid get_payment response: expected exactly 9 felts, received 10/,
      );
    });
  });

  describe('getLockedByToken', () => {
    it('calls get_locked_by_token and decodes u128 balance to bigint', async () => {
      let executedCall!: ContractCall;
      const mockProvider = {
        async callContract(call: ContractCall) {
          executedCall = call;
          return ['0xde0b6b3a7640000']; // 1 STRK
        },
      };

      const locked = await getLockedByToken(mockProvider, conditionalPay, token);
      assert.equal(executedCall.entrypoint, 'get_locked_by_token');
      assert.deepEqual(executedCall.calldata, [normalizeFelt(token)]);
      assert.equal(locked, 1000000000000000000n);
    });

    it('strictly enforces exact 1-felt response cardinality for get_locked_by_token', async () => {
      // Empty response (0 felts)
      const emptyProvider = {
        async callContract() {
          return [];
        },
      };
      await assert.rejects(
        () => getLockedByToken(emptyProvider, conditionalPay, token),
        /Invalid get_locked_by_token response: expected exactly 1 felt, received 0/,
      );

      // Too long (2 felts)
      const tooLongProvider = {
        async callContract() {
          return ['0x1', '0x2'];
        },
      };
      await assert.rejects(
        () => getLockedByToken(tooLongProvider, conditionalPay, token),
        /Invalid get_locked_by_token response: expected exactly 1 felt, received 2/,
      );
    });
  });

  describe('getStrk20Pool', () => {
    it('calls get_strk20_pool and returns normalized contract address', async () => {
      let executedCall!: ContractCall;
      const mockProvider = {
        async callContract(call: ContractCall) {
          executedCall = call;
          return [poolAddress];
        },
      };

      const pool = await getStrk20Pool(mockProvider, conditionalPay);
      assert.equal(executedCall.entrypoint, 'get_strk20_pool');
      assert.deepEqual(executedCall.calldata, []);
      assert.equal(pool, normalizeFelt(poolAddress));
    });

    it('strictly enforces exact 1-felt response cardinality for get_strk20_pool', async () => {
      // Empty response (0 felts)
      const emptyProvider = {
        async callContract() {
          return [];
        },
      };
      await assert.rejects(
        () => getStrk20Pool(emptyProvider, conditionalPay),
        /Invalid get_strk20_pool response: expected exactly 1 felt, received 0/,
      );

      // Too long (2 felts)
      const tooLongProvider = {
        async callContract() {
          return [poolAddress, '0x2'];
        },
      };
      await assert.rejects(
        () => getStrk20Pool(tooLongProvider, conditionalPay),
        /Invalid get_strk20_pool response: expected exactly 1 felt, received 2/,
      );
    });
  });

  describe('computePaymentIdOnchain & Local Equality Verification', () => {
    it('encodes CreateParams into 8-element calldata and matches local computePaymentId', async () => {
      const localPaymentId = computePaymentId(mockCreateParams);
      let executedCall!: ContractCall;

      const mockProvider = {
        async callContract(call: ContractCall) {
          executedCall = call;
          return [localPaymentId];
        },
      };

      const onchainPaymentId = await computePaymentIdOnchain(
        mockProvider,
        conditionalPay,
        mockCreateParams,
      );

      assert.equal(executedCall.entrypoint, 'compute_payment_id');
      assert.ok(executedCall.calldata);
      assert.equal(executedCall.calldata.length, 8, 'compute_payment_id takes 8 felts');
      assert.equal(onchainPaymentId, localPaymentId);
    });

    it('strictly enforces exact 1-felt response cardinality for compute_payment_id', async () => {
      // Empty response (0 felts)
      const emptyProvider = {
        async callContract() {
          return [];
        },
      };
      await assert.rejects(
        () => computePaymentIdOnchain(emptyProvider, conditionalPay, mockCreateParams),
        /Invalid compute_payment_id response: expected exactly 1 felt, received 0/,
      );

      // Too long (2 felts)
      const tooLongProvider = {
        async callContract() {
          return ['0x1', '0x2'];
        },
      };
      await assert.rejects(
        () => computePaymentIdOnchain(tooLongProvider, conditionalPay, mockCreateParams),
        /Invalid compute_payment_id response: expected exactly 1 felt, received 2/,
      );
    });
  });

  describe('Phase 2B Token-Source Integration Proof', () => {
    it('demonstrates payment token read via getPayment feeds directly into buildClaimActions and buildRefundActions', async () => {
      const mockProvider = {
        async callContract() {
          return [
            token, // payment.token
            '0xde0b6b3a7640000',
            '0x7b52c408bddeaaf8cc36a4c6c3bfd24c7a0e7b241b9fcad83c2c8173cd01261',
            '0x30c804f6f6b24dd19f29ff4bc2b54f1f44cb336a90dca293b80b413c0599ac5',
            '0x64',
            '0x12c',
            '0x0',
            '0x0',
            '0x1', // ACTIVE
          ];
        },
      };

      const payment = await getPayment(mockProvider, conditionalPay, paymentId);
      assert.equal(isPaymentActive(payment), true);

      // Feed canonical payment.token into CLAIM
      const recipient = '0x053b40a647cedfca6ca84f542a0fe3673603190d52737e333680420fa390776a';
      const claimActions = buildClaimActions(conditionalPay, {
        payment_id: paymentId,
        claim_preimage: '0xc1a01',
        token: payment.token, // Sourced authoritatively from Payment record
        recipient,
      });
      assert.equal(claimActions[0].token, normalizeFelt(payment.token));

      // Feed canonical payment.token into REFUND
      const refundActions = buildRefundActions(conditionalPay, {
        payment_id: paymentId,
        refund_preimage: '0x1e401',
        token: payment.token, // Sourced authoritatively from Payment record
        recipient,
      });
      assert.equal(refundActions[0].token, normalizeFelt(payment.token));
    });
  });
});
