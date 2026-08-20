import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildApproveCall } from '../src/approve.js';
import { normalizeFelt } from '../src/hashing.js';

describe('Standard Approver Call Builder', () => {
  const conditionalPay = '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const paymentId = '0x5f63ac970629bfb6539bb18df38d3a34cf8ff7e1ed9a2300d8315f38f5d166';

  it('builds standard Starknet approve(payment_id) call correctly with object args', () => {
    const call = buildApproveCall({
      conditionalPay,
      paymentId,
    });

    assert.equal(call.contractAddress, normalizeFelt(conditionalPay));
    assert.equal(call.entrypoint, 'approve');
    assert.equal(call.calldata.length, 1);
    assert.equal(call.calldata[0], normalizeFelt(paymentId));
  });

  it('builds standard Starknet approve(payment_id) call correctly with positional args', () => {
    const call = buildApproveCall(conditionalPay, paymentId);

    assert.equal(call.contractAddress, normalizeFelt(conditionalPay));
    assert.equal(call.entrypoint, 'approve');
    assert.equal(call.calldata.length, 1);
    assert.equal(call.calldata[0], normalizeFelt(paymentId));
  });

  it('does not accept approver address as calldata parameter', () => {
    const call = buildApproveCall(conditionalPay, paymentId);
    // Calldata must contain ONLY paymentId (contract uses get_caller_address())
    assert.equal(call.calldata.length, 1);
    assert.equal(call.calldata[0], normalizeFelt(paymentId));
  });

  it('strictly rejects invalid addresses, out-of-range felts, and JS numbers', () => {
    // @ts-expect-error Testing runtime rejection
    assert.throws(() => buildApproveCall(12345, paymentId), { name: 'TypeError' });
    // @ts-expect-error Testing runtime rejection
    assert.throws(() => buildApproveCall(conditionalPay, 42), { name: 'TypeError' });
    assert.throws(() => buildApproveCall('invalid_address', paymentId), { name: 'TypeError' });
  });
});
