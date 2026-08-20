import { validateContractAddress, validateFelt } from './encoding.js';
import { normalizeFelt } from './hashing.js';
import { BigIntish, BuildApproveCallParams, StandardCall } from './types.js';

/**
 * Composes a standard Starknet contract call for ConditionalPay.approve(payment_id).
 *
 * This is a standard public contract invocation by the authorized approver,
 * NOT a STRK20 private action.
 *
 * @param params Or positional args: (conditionalPay, paymentId).
 * @returns StandardCall object suitable for account.execute(...) or wallet invocation.
 */
export function buildApproveCall(
  conditionalPayOrParams: string | BuildApproveCallParams,
  maybePaymentId?: BigIntish,
): StandardCall {
  let conditionalPay: string;
  let paymentId: BigIntish;

  if (typeof conditionalPayOrParams === 'object' && conditionalPayOrParams !== null) {
    conditionalPay = conditionalPayOrParams.conditionalPay;
    paymentId = conditionalPayOrParams.paymentId;
  } else {
    conditionalPay = conditionalPayOrParams;
    if (maybePaymentId === undefined) {
      throw new TypeError(`Missing required paymentId parameter`);
    }
    paymentId = maybePaymentId;
  }

  validateContractAddress(conditionalPay, 'conditionalPay');
  validateFelt(paymentId, 'paymentId');

  return {
    contractAddress: normalizeFelt(conditionalPay),
    entrypoint: 'approve',
    calldata: [normalizeFelt(paymentId)],
  };
}
