import type {
  STRK20_INVOKE_ACTION,
  STRK20_TRANSFER_ACTION,
  STRK20_WITHDRAW_ACTION,
} from 'starknet';
import type { STRK20_ACTION } from '@starknet-io/types-js';
import {
  encodeClaimWithPlaceholderCalldata,
  encodeCreateCalldata,
  encodeRefundWithPlaceholderCalldata,
  validateContractAddress,
} from './encoding.js';
import { normalizeFelt } from './hashing.js';
import {
  BuildClaimActionParams,
  BuildRefundActionParams,
  CreateParams,
} from './types.js';

/**
 * Composes the STRK20 Privacy Wallet API action batch for creating a ConditionalPay payment.
 *
 * Sequence (Strict Ordering):
 *   1. [withdraw] Private withdrawal from pool to fund ConditionalPay contract with token amount.
 *   2. [invoke]   External invoke to ConditionalPay.privacy_invoke(Create(...)).
 *
 * Requirements:
 *   - Exactly 2 application actions.
 *   - No OPEN note creation.
 *   - No fee action (handled by wallet).
 *   - Returns canonical `STRK20_ACTION[]` tuple directly assignable to `strk20InvokeTransaction`.
 *
 * @param conditionalPay Deployed address of the ConditionalPay contract.
 * @param params Deterministic payment creation parameters.
 * @returns Array of STRK20 actions to pass to strk20InvokeTransaction.
 */
export function buildCreateActions(
  conditionalPay: string,
  params: CreateParams,
): [STRK20_WITHDRAW_ACTION, STRK20_INVOKE_ACTION] {
  validateContractAddress(conditionalPay, 'conditionalPay');

  // encodeCreateCalldata validates params.token, amount, timestamps, approver, etc.
  const createCalldata = encodeCreateCalldata(params);

  const withdrawAction: STRK20_WITHDRAW_ACTION = {
    type: 'withdraw',
    token: normalizeFelt(params.token),
    amount: normalizeFelt(params.amount),
    recipient: normalizeFelt(conditionalPay),
  };

  const invokeAction: STRK20_INVOKE_ACTION = {
    type: 'invoke',
    contract: normalizeFelt(conditionalPay),
    calldata: createCalldata,
  };

  const actions: [STRK20_WITHDRAW_ACTION, STRK20_INVOKE_ACTION] = [withdrawAction, invokeAction];
  return actions satisfies STRK20_ACTION[];
}

/**
 * Composes the STRK20 Privacy Wallet API action batch for claiming an active ConditionalPay payment.
 *
 * Sequence (Strict Ordering):
 *   1. [transfer] Allocates a new OPEN settlement note inside the pool for `recipient`.
 *   2. [invoke]   External invoke to ConditionalPay.privacy_invoke(Claim(...)) with note_id = ${openNoteIds[0]}.
 *
 * Requirements:
 *   - Exactly 2 application actions.
 *   - note_id bound strictly to the wallet placeholder '${openNoteIds[0]}'.
 *   - No fee action (handled by wallet).
 *   - Returns canonical `STRK20_ACTION[]` tuple directly assignable to `strk20InvokeTransaction`.
 *
 * TOKEN SOURCE RULE:
 * `params.token` must be the token address read from the on-chain Payment record.
 *
 * RECIPIENT SEMANTICS:
 * `params.recipient` is exclusively a Wallet API settlement-routing input for open note allocation.
 * It is NOT included in ConditionalPay CLAIM calldata, and ConditionalPay stores NO claimant address.
 *
 * @param conditionalPay Deployed address of the ConditionalPay contract.
 * @param params Claim parameters including secret preimage, payment token, and destination recipient.
 * @returns Array of STRK20 actions to pass to strk20InvokeTransaction.
 */
export function buildClaimActions(
  conditionalPay: string,
  params: BuildClaimActionParams,
): [STRK20_TRANSFER_ACTION, STRK20_INVOKE_ACTION] {
  validateContractAddress(conditionalPay, 'conditionalPay');
  validateContractAddress(params.token, 'token');
  validateContractAddress(params.recipient, 'recipient');

  const claimCalldata = encodeClaimWithPlaceholderCalldata({
    payment_id: params.payment_id,
    claim_preimage: params.claim_preimage,
  });

  const openNoteAction: STRK20_TRANSFER_ACTION = {
    type: 'transfer',
    token: normalizeFelt(params.token),
    amount: 'OPEN',
    recipient: normalizeFelt(params.recipient),
  };

  const invokeAction: STRK20_INVOKE_ACTION = {
    type: 'invoke',
    contract: normalizeFelt(conditionalPay),
    calldata: claimCalldata,
  };

  const actions: [STRK20_TRANSFER_ACTION, STRK20_INVOKE_ACTION] = [openNoteAction, invokeAction];
  return actions satisfies STRK20_ACTION[];
}

/**
 * Composes the STRK20 Privacy Wallet API action batch for refunding an expired ConditionalPay payment.
 *
 * Sequence (Strict Ordering):
 *   1. [transfer] Allocates a new OPEN settlement note inside the pool for `recipient`.
 *   2. [invoke]   External invoke to ConditionalPay.privacy_invoke(Refund(...)) with note_id = ${openNoteIds[0]}.
 *
 * Requirements:
 *   - Exactly 2 application actions.
 *   - note_id bound strictly to the wallet placeholder '${openNoteIds[0]}'.
 *   - No fee action (handled by wallet).
 *   - Returns canonical `STRK20_ACTION[]` tuple directly assignable to `strk20InvokeTransaction`.
 *
 * TOKEN SOURCE RULE:
 * `params.token` must be the token address read from the on-chain Payment record.
 *
 * RECIPIENT SEMANTICS:
 * `params.recipient` is exclusively a Wallet API settlement-routing input for open note allocation.
 * It is NOT included in ConditionalPay REFUND calldata, and ConditionalPay stores NO refunder address.
 *
 * @param conditionalPay Deployed address of the ConditionalPay contract.
 * @param params Refund parameters including secret preimage, payment token, and destination recipient.
 * @returns Array of STRK20 actions to pass to strk20InvokeTransaction.
 */
export function buildRefundActions(
  conditionalPay: string,
  params: BuildRefundActionParams,
): [STRK20_TRANSFER_ACTION, STRK20_INVOKE_ACTION] {
  validateContractAddress(conditionalPay, 'conditionalPay');
  validateContractAddress(params.token, 'token');
  validateContractAddress(params.recipient, 'recipient');

  const refundCalldata = encodeRefundWithPlaceholderCalldata({
    payment_id: params.payment_id,
    refund_preimage: params.refund_preimage,
  });

  const openNoteAction: STRK20_TRANSFER_ACTION = {
    type: 'transfer',
    token: normalizeFelt(params.token),
    amount: 'OPEN',
    recipient: normalizeFelt(params.recipient),
  };

  const invokeAction: STRK20_INVOKE_ACTION = {
    type: 'invoke',
    contract: normalizeFelt(conditionalPay),
    calldata: refundCalldata,
  };

  const actions: [STRK20_TRANSFER_ACTION, STRK20_INVOKE_ACTION] = [openNoteAction, invokeAction];
  return actions satisfies STRK20_ACTION[];
}
