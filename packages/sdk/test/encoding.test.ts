import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTRACT_ADDRESS_MAX,
  encodeActionCalldata,
  encodeClaimCalldata,
  encodeCreateCalldata,
  encodeRefundCalldata,
  STARKNET_PRIME,
  U128_MAX,
  U64_MAX,
  validateContractAddress,
  validateFelt,
  validateU128,
  validateU64,
} from '../src/encoding.js';
import { ClaimParams, CreateParams, RefundParams } from '../src/types.js';

describe('SDK Calldata Encoding & Range Validation Tests', () => {
  const sampleCreate: CreateParams = {
    token: '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d',
    amount: 1000000000000000000n,
    hashlock: '0x7b52c408bddeaaf8cc36a4c6c3bfd24c7a0e7b241b9fcad83c2c8173cd01261',
    refund_hash: '0x30c804f6f6b24dd19f29ff4bc2b54f1f44cb336a90dca293b80b413c0599ac5',
    claim_after: '100',
    expires_at: '300',
    approver: '0x0',
    nonce: '1',
  };

  const sampleClaim: ClaimParams = {
    payment_id: '0x5f63ac970629bfb6539bb18df38d3a34cf8ff7e1ed9a2300d8315f38f5d166',
    claim_preimage: '0xc1a01',
    note_id: '0x999',
  };

  const sampleRefund: RefundParams = {
    payment_id: '0x5f63ac970629bfb6539bb18df38d3a34cf8ff7e1ed9a2300d8315f38f5d166',
    refund_preimage: '0x1e401',
    note_id: '0x999',
  };

  it('encodes CREATE calldata with 9 elements and discriminant 0x0', () => {
    const calldata = encodeCreateCalldata(sampleCreate);
    assert.equal(calldata.length, 9, 'CREATE calldata must be 9 felts');
    assert.equal(calldata[0], '0x0', 'CREATE discriminant must be 0x0');
    assert.equal(calldata[1], '0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d');
    assert.equal(calldata[2], '0xde0b6b3a7640000'); // 1 STRK in hex
    assert.equal(calldata[3], sampleCreate.hashlock.toLowerCase());
    assert.equal(calldata[4], sampleCreate.refund_hash.toLowerCase());
    assert.equal(calldata[5], '0x64'); // 100 in hex
    assert.equal(calldata[6], '0x12c'); // 300 in hex
    assert.equal(calldata[7], '0x0');
    assert.equal(calldata[8], '0x1');
  });

  it('encodes CLAIM calldata with 4 elements and discriminant 0x1', () => {
    const calldata = encodeClaimCalldata(sampleClaim);
    assert.equal(calldata.length, 4, 'CLAIM calldata must be 4 felts');
    assert.equal(calldata[0], '0x1', 'CLAIM discriminant must be 0x1');
    assert.equal(calldata[1], sampleClaim.payment_id.toLowerCase());
    assert.equal(calldata[2], '0xc1a01');
    assert.equal(calldata[3], '0x999');
  });

  it('encodes REFUND calldata with 4 elements and discriminant 0x2', () => {
    const calldata = encodeRefundCalldata(sampleRefund);
    assert.equal(calldata.length, 4, 'REFUND calldata must be 4 felts');
    assert.equal(calldata[0], '0x2', 'REFUND discriminant must be 0x2');
    assert.equal(calldata[1], sampleRefund.payment_id.toLowerCase());
    assert.equal(calldata[2], '0x1e401');
    assert.equal(calldata[3], '0x999');
  });

  it('encodes polymorphic actions via encodeActionCalldata', () => {
    const createCalldata = encodeActionCalldata({ type: 'Create', params: sampleCreate });
    assert.equal(createCalldata[0], '0x0');
    assert.equal(createCalldata.length, 9);

    const claimCalldata = encodeActionCalldata({ type: 'Claim', params: sampleClaim });
    assert.equal(claimCalldata[0], '0x1');
    assert.equal(claimCalldata.length, 4);

    const refundCalldata = encodeActionCalldata({ type: 'Refund', params: sampleRefund });
    assert.equal(refundCalldata[0], '0x2');
    assert.equal(refundCalldata.length, 4);
  });

  it('validates ContractAddress boundary values matching Cairo corelib', () => {
    // 1. Zero address is ABI-valid
    assert.doesNotThrow(() => validateContractAddress('0x0', 'zero_address'));
    assert.doesNotThrow(() => validateContractAddress(0n, 'zero_address'));

    // 2. Highest valid ContractAddress (2^251 - 1)
    assert.doesNotThrow(() => validateContractAddress(CONTRACT_ADDRESS_MAX, 'max_address'));
    assert.doesNotThrow(() =>
      validateContractAddress(
        '0x7ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
        'max_address_hex',
      ),
    );

    // 3. First invalid value above ContractAddress bound (2^251) is rejected
    assert.throws(
      () => validateContractAddress(CONTRACT_ADDRESS_MAX + 1n, 'first_invalid_address'),
      { name: 'RangeError' },
    );
    assert.throws(
      () =>
        validateContractAddress(
          '0x800000000000000000000000000000000000000000000000000000000000000',
          'first_invalid_address_hex',
        ),
      { name: 'RangeError' },
    );

    // 4. Value that is a valid felt252 (PRIME - 1) but invalid ContractAddress is rejected
    assert.throws(
      () => validateContractAddress(STARKNET_PRIME - 1n, 'prime_minus_one_address'),
      { name: 'RangeError' },
    );

    // 5. Malformed string is rejected
    assert.throws(() => validateContractAddress('not_an_address', 'malformed_address'), {
      name: 'TypeError',
    });

    // 6. Number is rejected
    // @ts-expect-error Testing runtime rejection
    assert.throws(() => validateContractAddress(12345, 'number_address'), {
      name: 'TypeError',
    });
  });

  it('validates valid integer boundary limits without error', () => {
    // Zero amount is valid for generic ABI encoder
    assert.doesNotThrow(() => validateU128(0n, 'amount'));
    assert.doesNotThrow(() => validateU128('0', 'amount'));
    assert.doesNotThrow(() => validateU128(U128_MAX, 'amount'));

    // U64 bounds
    assert.doesNotThrow(() => validateU64(0n, 'timestamp'));
    assert.doesNotThrow(() => validateU64('0', 'timestamp'));
    assert.doesNotThrow(() => validateU64(U64_MAX, 'timestamp'));

    // Felt bounds
    assert.doesNotThrow(() => validateFelt(0n, 'felt'));
    assert.doesNotThrow(() => validateFelt('0x0', 'felt'));
    assert.doesNotThrow(() => validateFelt(STARKNET_PRIME - 1n, 'felt'));
  });

  it('strictly rejects out-of-range u128 values', () => {
    assert.throws(() => validateU128(-1n, 'amount'), { name: 'RangeError' });
    assert.throws(() => validateU128(U128_MAX + 1n, 'amount'), { name: 'RangeError' });
    assert.throws(() => validateU128('0x100000000000000000000000000000000', 'amount'), {
      name: 'RangeError',
    });
  });

  it('strictly rejects out-of-range u64 values', () => {
    assert.throws(() => validateU64(-1n, 'timestamp'), { name: 'RangeError' });
    assert.throws(() => validateU64(U64_MAX + 1n, 'timestamp'), { name: 'RangeError' });
    assert.throws(() => validateU64('0x10000000000000000', 'timestamp'), {
      name: 'RangeError',
    });
  });

  it('strictly rejects out-of-range felt252 values and invalid formats', () => {
    assert.throws(() => validateFelt(-1n, 'felt'), { name: 'RangeError' });
    assert.throws(() => validateFelt(STARKNET_PRIME, 'felt'), { name: 'RangeError' });
    assert.throws(() => validateFelt('invalid_hex_string', 'felt'), { name: 'TypeError' });
  });

  it('strictly rejects JavaScript numbers in all validation helpers', () => {
    // @ts-expect-error Testing runtime rejection
    assert.throws(() => validateFelt(12345, 'felt'), { name: 'TypeError' });
    // @ts-expect-error Testing runtime rejection
    assert.throws(() => validateU128(100, 'amount'), { name: 'TypeError' });
    // @ts-expect-error Testing runtime rejection
    assert.throws(() => validateU64(500, 'timestamp'), { name: 'TypeError' });
  });
});
