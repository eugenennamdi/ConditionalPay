import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type {
  STRK20_CALLDATA_ITEM,
  STRK20_INVOKE_ACTION,
  STRK20_TRANSFER_ACTION,
  STRK20_WITHDRAW_ACTION,
} from 'starknet';
import type {
  RpcTypeToMessageMap,
  STRK20_ACTION,
} from '@starknet-io/types-js';
import {
  buildClaimActions,
  buildCreateActions,
  buildRefundActions,
} from '../src/actions.js';
import { encodeCreateCalldata } from '../src/encoding.js';
import { normalizeFelt } from '../src/hashing.js';
import {
  BuildClaimActionParams,
  BuildRefundActionParams,
  ConditionalPayStrk20Action,
  CreateParams,
  OPEN_NOTE_ID_0,
} from '../src/types.js';

describe('STRK20 Wallet Action Builders', () => {
  const conditionalPay = '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const mainnetConditionalPay =
    '0x0166e31803cfab50383d5b636b86a5646233881fad3a2fb89354da63f6cdb483';
  const token = '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d';
  const recipient = '0x053b40a647cedfca6ca84f542a0fe3673603190d52737e333680420fa390776a';
  const walletApiFelt = /^0x(0|[a-fA-F1-9][a-fA-F0-9]{0,62})$/;

  const createParams: CreateParams = {
    token,
    amount: 1000000000000000000n, // 1 STRK
    hashlock: '0x7b52c408bddeaaf8cc36a4c6c3bfd24c7a0e7b241b9fcad83c2c8173cd01261',
    refund_hash: '0x30c804f6f6b24dd19f29ff4bc2b54f1f44cb336a90dca293b80b413c0599ac5',
    claim_after: '100',
    expires_at: '300',
    approver: '0x0',
    nonce: '1',
  };

  const claimParams: BuildClaimActionParams = {
    payment_id: '0x5f63ac970629bfb6539bb18df38d3a34cf8ff7e1ed9a2300d8315f38f5d166',
    claim_preimage: '0xc1a01',
    token, // Must originate from on-chain Payment record
    recipient,
  };

  const refundParams: BuildRefundActionParams = {
    payment_id: '0x5f63ac970629bfb6539bb18df38d3a34cf8ff7e1ed9a2300d8315f38f5d166',
    refund_preimage: '0x1e401',
    token, // Must originate from on-chain Payment record
    recipient,
  };

  describe('CREATE Action Builder', () => {
    it('composes exactly 2 application actions with funding preceding invoke', () => {
      const actions = buildCreateActions(conditionalPay, createParams);

      assert.equal(actions.length, 2, 'CREATE must produce exactly 2 application actions');

      const [withdrawAction, invokeAction] = actions;

      // 1. Funding action must be first (withdraw from pool to ConditionalPay)
      assert.equal(withdrawAction.type, 'withdraw');
      assert.equal(withdrawAction.token, normalizeFelt(token));
      assert.equal(withdrawAction.amount, '0xde0b6b3a7640000');
      assert.equal(withdrawAction.recipient, normalizeFelt(conditionalPay));

      // 2. Invoke action must be second
      assert.equal(invokeAction.type, 'invoke');
      assert.equal(invokeAction.contract, normalizeFelt(conditionalPay));

      // 3. Calldata matches frozen CREATE Serde layout
      const expectedCalldata = encodeCreateCalldata(createParams);
      assert.deepEqual(invokeAction.calldata, expectedCalldata);
      assert.equal(invokeAction.calldata[0], '0x0', 'CREATE discriminant must be 0x0');
    });

    it('does not contain OPEN note creation, placeholders, or SDK fee actions', () => {
      const actions = buildCreateActions(conditionalPay, createParams);

      for (const action of actions) {
        assert.notEqual(action.type, 'transfer', 'CREATE must not contain transfer/OPEN action');
        if (action.type === 'invoke') {
          assert.ok(
            !action.calldata.includes(OPEN_NOTE_ID_0),
            'CREATE calldata must not contain open-note placeholder',
          );
        }
      }
    });

    it('canonicalizes every Mainnet CREATE felt and leaves exactly one final invoke', () => {
      const actions = buildCreateActions(mainnetConditionalPay, createParams);

      assert.deepEqual(
        actions.map((action) => action.type),
        ['withdraw', 'invoke'],
        'CREATE ordering must be exactly [withdraw, invoke]',
      );
      assert.equal(
        actions.filter((action) => action.type === 'invoke').length,
        1,
        'CREATE must contain exactly one invoke',
      );
      assert.equal(actions.at(-1)?.type, 'invoke', 'CREATE invoke must be final');

      const [withdraw, invoke] = actions;
      assert.equal(
        withdraw.token,
        '0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d',
      );
      assert.notEqual(withdraw.token, token, 'STRK must not retain its padded encoding');
      assert.equal(
        withdraw.recipient,
        '0x166e31803cfab50383d5b636b86a5646233881fad3a2fb89354da63f6cdb483',
      );
      assert.equal(invoke.contract, withdraw.recipient);
      assert.notEqual(
        invoke.contract,
        mainnetConditionalPay,
        'ConditionalPay must not retain its padded encoding',
      );

      const numericFelts = [
        withdraw.token,
        withdraw.amount,
        withdraw.recipient,
        invoke.contract,
        ...invoke.calldata,
      ];
      for (const felt of numericFelts) {
        assert.match(felt, walletApiFelt, `non-canonical Wallet API felt: ${felt}`);
      }
    });

    it('strictly rejects invalid parameters and unsafe numbers in CREATE', () => {
      // @ts-expect-error Testing runtime rejection
      assert.throws(() => buildCreateActions(12345, createParams), { name: 'TypeError' });
      // @ts-expect-error Testing runtime rejection
      assert.throws(() => buildCreateActions(conditionalPay, { ...createParams, amount: 100 }), {
        name: 'TypeError',
      });
      assert.throws(
        () => buildCreateActions(conditionalPay, { ...createParams, token: 'invalid_hex' }),
        { name: 'TypeError' },
      );
    });
  });

  describe('CLAIM Action Builder', () => {
    it('composes exactly 2 application actions with OPEN note preceding invoke', () => {
      const actions = buildClaimActions(conditionalPay, claimParams);

      assert.equal(actions.length, 2, 'CLAIM must produce exactly 2 application actions');

      const [openNoteAction, invokeAction] = actions;

      // 1. OPEN note allocation must be first
      assert.equal(openNoteAction.type, 'transfer');
      assert.equal(openNoteAction.token, normalizeFelt(token));
      assert.equal(openNoteAction.amount, 'OPEN');
      assert.equal(openNoteAction.recipient, normalizeFelt(recipient));

      // 2. Invoke action must be second
      assert.equal(invokeAction.type, 'invoke');
      assert.equal(invokeAction.contract, normalizeFelt(conditionalPay));

      // 3. Calldata has length 4 with discriminant 0x1 and placeholder in note_id position
      assert.equal(invokeAction.calldata.length, 4);
      assert.equal(invokeAction.calldata[0], '0x1', 'CLAIM discriminant must be 0x1');
      assert.equal(invokeAction.calldata[1], normalizeFelt(claimParams.payment_id));
      assert.equal(invokeAction.calldata[2], normalizeFelt(claimParams.claim_preimage));
      assert.equal(invokeAction.calldata[3], OPEN_NOTE_ID_0, 'note_id must be OPEN_NOTE_ID_0');
    });

    it('does not contain SDK-generated fee actions', () => {
      const actions = buildClaimActions(conditionalPay, claimParams);
      assert.equal(actions.length, 2);
    });

    it('strictly rejects invalid parameters and unsafe numbers in CLAIM', () => {
      // @ts-expect-error Testing runtime rejection
      assert.throws(() => buildClaimActions(conditionalPay, { ...claimParams, claim_preimage: 42 }), {
        name: 'TypeError',
      });
      assert.throws(
        () => buildClaimActions(conditionalPay, { ...claimParams, recipient: 'invalid_recipient' }),
        { name: 'TypeError' },
      );
    });
  });

  describe('REFUND Action Builder', () => {
    it('composes exactly 2 application actions with OPEN note preceding invoke', () => {
      const actions = buildRefundActions(conditionalPay, refundParams);

      assert.equal(actions.length, 2, 'REFUND must produce exactly 2 application actions');

      const [openNoteAction, invokeAction] = actions;

      // 1. OPEN note allocation must be first
      assert.equal(openNoteAction.type, 'transfer');
      assert.equal(openNoteAction.token, normalizeFelt(token));
      assert.equal(openNoteAction.amount, 'OPEN');
      assert.equal(openNoteAction.recipient, normalizeFelt(recipient));

      // 2. Invoke action must be second
      assert.equal(invokeAction.type, 'invoke');
      assert.equal(invokeAction.contract, normalizeFelt(conditionalPay));

      // 3. Calldata has length 4 with discriminant 0x2 and placeholder in note_id position
      assert.equal(invokeAction.calldata.length, 4);
      assert.equal(invokeAction.calldata[0], '0x2', 'REFUND discriminant must be 0x2');
      assert.equal(invokeAction.calldata[1], normalizeFelt(refundParams.payment_id));
      assert.equal(invokeAction.calldata[2], normalizeFelt(refundParams.refund_preimage));
      assert.equal(invokeAction.calldata[3], OPEN_NOTE_ID_0, 'note_id must be OPEN_NOTE_ID_0');
    });

    it('does not contain SDK-generated fee actions', () => {
      const actions = buildRefundActions(conditionalPay, refundParams);
      assert.equal(actions.length, 2);
    });

    it('strictly rejects invalid parameters and unsafe numbers in REFUND', () => {
      // @ts-expect-error Testing runtime rejection
      assert.throws(() => buildRefundActions(conditionalPay, { ...refundParams, refund_preimage: 42 }), {
        name: 'TypeError',
      });
      assert.throws(
        () => buildRefundActions(conditionalPay, { ...refundParams, token: 'invalid_token' }),
        { name: 'TypeError' },
      );
    });
  });

  describe('Canonical Type Conformance & Wallet Compatibility', () => {
    it('proves builder outputs are directly assignable to canonical STRK20_ACTION[] without casts', () => {
      // 1. Assign directly to canonical STRK20_ACTION[] from @starknet-io/types-js
      const createActions: STRK20_ACTION[] = buildCreateActions(conditionalPay, createParams);
      const claimActions: STRK20_ACTION[] = buildClaimActions(conditionalPay, claimParams);
      const refundActions: STRK20_ACTION[] = buildRefundActions(conditionalPay, refundParams);

      assert.equal(createActions.length, 2);
      assert.equal(claimActions.length, 2);
      assert.equal(refundActions.length, 2);

      // 2. Assign directly to narrowed ConditionalPayStrk20Action[]
      const narrowedCreate: ConditionalPayStrk20Action[] = buildCreateActions(conditionalPay, createParams);
      const narrowedClaim: ConditionalPayStrk20Action[] = buildClaimActions(conditionalPay, claimParams);
      const narrowedRefund: ConditionalPayStrk20Action[] = buildRefundActions(conditionalPay, refundParams);

      assert.equal(narrowedCreate.length, 2);
      assert.equal(narrowedClaim.length, 2);
      assert.equal(narrowedRefund.length, 2);

      // 3. Verify specific tuple action types conform to canonical interfaces
      const [withdraw, createInvoke]: [STRK20_WITHDRAW_ACTION, STRK20_INVOKE_ACTION] =
        buildCreateActions(conditionalPay, createParams);
      assert.equal(withdraw.type, 'withdraw');
      assert.equal(createInvoke.type, 'invoke');

      const [claimOpen, claimInvoke]: [STRK20_TRANSFER_ACTION, STRK20_INVOKE_ACTION] =
        buildClaimActions(conditionalPay, claimParams);
      assert.equal(claimOpen.type, 'transfer');
      assert.equal(claimInvoke.type, 'invoke');

      const [refundOpen, refundInvoke]: [STRK20_TRANSFER_ACTION, STRK20_INVOKE_ACTION] =
        buildRefundActions(conditionalPay, refundParams);
      assert.equal(refundOpen.type, 'transfer');
      assert.equal(refundInvoke.type, 'invoke');
    });

    it('proves builder outputs directly satisfy WalletAccountV6.strk20InvokeTransaction action parameter type', () => {
      // Exact compile-time proof against RpcTypeToMessageMap['wallet_strk20InvokeTransaction']['params']
      type WalletStrk20InvokeParams =
        RpcTypeToMessageMap['wallet_strk20InvokeTransaction']['params'];

      const createPayload: WalletStrk20InvokeParams = {
        actions: buildCreateActions(conditionalPay, createParams),
      };
      const claimPayload: WalletStrk20InvokeParams = {
        actions: buildClaimActions(conditionalPay, claimParams),
      };
      const refundPayload: WalletStrk20InvokeParams = {
        actions: buildRefundActions(conditionalPay, refundParams),
      };

      assert.equal(createPayload.actions.length, 2);
      assert.equal(claimPayload.actions.length, 2);
      assert.equal(refundPayload.actions.length, 2);
    });

    it('proves invoke calldata items conform to canonical STRK20_CALLDATA_ITEM[] type', () => {
      const [, claimInvoke] = buildClaimActions(conditionalPay, claimParams);
      const calldataItems: STRK20_CALLDATA_ITEM[] = claimInvoke.calldata;

      assert.equal(calldataItems.length, 4);
      assert.equal(calldataItems[3], OPEN_NOTE_ID_0);
    });

    it('proves two independent CREATE action batches compose into a valid 4-action STRK20 batch', () => {
      const createParamsB: CreateParams = {
        ...createParams,
        hashlock: '0x30c804f6f6b24dd19f29ff4bc2b54f1f44cb336a90dca293b80b413c0599ac5',
        refund_hash: '0x7b52c408bddeaaf8cc36a4c6c3bfd24c7a0e7b241b9fcad83c2c8173cd01261',
        nonce: '2',
      };

      const actionsA = buildCreateActions(conditionalPay, createParams);
      const actionsB = buildCreateActions(conditionalPay, createParamsB);

      // Compose interleaved funding & invocation
      const batch: STRK20_ACTION[] = [...actionsA, ...actionsB];

      assert.equal(batch.length, 4, 'Multi-CREATE batch contains exactly 4 application actions');
      assert.equal(batch[0].type, 'withdraw');
      assert.equal(batch[1].type, 'invoke');
      assert.equal(batch[2].type, 'withdraw');
      assert.equal(batch[3].type, 'invoke');

      type WalletStrk20InvokeParams =
        RpcTypeToMessageMap['wallet_strk20InvokeTransaction']['params'];
      const multiCreatePayload: WalletStrk20InvokeParams = { actions: batch };
      assert.equal(multiCreatePayload.actions.length, 4);
    });
  });

  describe('Placeholder Safety & Invariant Tests', () => {
    it('proves OPEN_NOTE_ID_0 is exactly ${openNoteIds[0]}', () => {
      assert.equal(OPEN_NOTE_ID_0, '${openNoteIds[0]}');
    });

    it('proves generic felt normalization rejects template strings', () => {
      assert.throws(() => normalizeFelt(OPEN_NOTE_ID_0), /Failed to normalize felt/);
      assert.throws(() => normalizeFelt('${openNoteIds[1]}'), /Failed to normalize felt/);
      assert.throws(() => normalizeFelt('${arbitrary}'), /Failed to normalize felt/);
    });
  });
});
