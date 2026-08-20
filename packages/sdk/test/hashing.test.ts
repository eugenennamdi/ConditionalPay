import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  computeClaimHash,
  computePaymentId,
  computeRefundHash,
  DOMAINS,
  normalizeFelt,
} from '../src/hashing.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface TestVector {
  name: string;
  description: string;
  token: string;
  amount: string;
  claim_preimage: string;
  refund_preimage: string;
  claim_after: string;
  expires_at: string;
  approver: string;
  nonce: string;
  claim_hash: string;
  refund_hash: string;
  payment_id: string;
}

interface TestVectorsFile {
  version: string;
  domains: Record<string, string>;
  vectors: TestVector[];
}

const testVectorsPath = path.resolve(__dirname, '../test_vectors.json');
const testVectorsData: TestVectorsFile = JSON.parse(fs.readFileSync(testVectorsPath, 'utf8'));

describe('SDK Hashing & Parity Tests', () => {
  it('verifies domain constants match Cairo definitions exactly', () => {
    assert.equal(
      DOMAINS.CONDITIONALPAY_CLAIM_V1,
      '0x434f4e444954494f4e414c5041595f434c41494d5f5631',
      'CONDITIONALPAY_CLAIM_V1 constant mismatch',
    );
    assert.equal(
      DOMAINS.CONDITIONALPAY_REFUND_V1,
      '0x434f4e444954494f4e414c5041595f524546554e445f5631',
      'CONDITIONALPAY_REFUND_V1 constant mismatch',
    );
    assert.equal(
      DOMAINS.CONDITIONALPAY_PAYMENT_V1,
      '0x434f4e444954494f4e414c5041595f5041594d454e545f5631',
      'CONDITIONALPAY_PAYMENT_V1 constant mismatch',
    );
  });

  it('proves domain separation between claim and refund hashes for identical preimages', () => {
    const preimage = '0x123456789abcdef';
    const claimHash = computeClaimHash(preimage);
    const refundHash = computeRefundHash(preimage);
    assert.notEqual(claimHash, refundHash, 'Domain separation failed');
  });

  it('normalizes string and bigint inputs consistently without precision loss', () => {
    assert.equal(normalizeFelt('0'), '0x0');
    assert.equal(normalizeFelt('0x0'), '0x0');
    assert.equal(normalizeFelt(0n), '0x0');
    assert.equal(normalizeFelt('42'), '0x2a');
    assert.equal(normalizeFelt('0x2a'), '0x2a');
    assert.equal(normalizeFelt(42n), '0x2a');
    assert.equal(
      normalizeFelt(1000000000000000000n),
      '0xde0b6b3a7640000', // 1 STRK in wei
    );
    assert.equal(
      normalizeFelt('1000000000000000000'),
      '0xde0b6b3a7640000',
    );
  });

  it('strictly rejects unsafe JavaScript numbers to prevent silent precision loss', () => {
    // Number type must be rejected at runtime by normalizeFelt
    assert.throws(
      // @ts-expect-error Testing runtime rejection of unsafe number
      () => normalizeFelt(42),
      {
        name: 'TypeError',
        message: /Unsafe JavaScript number '42' rejected/,
      },
    );

    assert.throws(
      // @ts-expect-error Testing runtime rejection of unsafe number
      () => computeClaimHash(12345),
      {
        name: 'TypeError',
        message: /Unsafe JavaScript number '12345' rejected/,
      },
    );

    assert.throws(
      // @ts-expect-error Testing runtime rejection of unsafe number
      () => computeRefundHash(67890),
      {
        name: 'TypeError',
        message: /Unsafe JavaScript number '67890' rejected/,
      },
    );
  });

  it('verifies all 6 deterministic cross-language test vectors', () => {
    for (const vector of testVectorsData.vectors) {
      // 1. Verify claim hash
      const computedClaimHash = computeClaimHash(vector.claim_preimage);
      assert.equal(
        computedClaimHash,
        vector.claim_hash,
        `Claim hash mismatch for vector: ${vector.name}`,
      );

      // 2. Verify refund hash
      const computedRefundHash = computeRefundHash(vector.refund_preimage);
      assert.equal(
        computedRefundHash,
        vector.refund_hash,
        `Refund hash mismatch for vector: ${vector.name}`,
      );

      // 3. Verify payment ID
      const computedPaymentId = computePaymentId({
        token: vector.token,
        amount: BigInt(vector.amount),
        hashlock: computedClaimHash,
        refund_hash: computedRefundHash,
        claim_after: BigInt(vector.claim_after),
        expires_at: BigInt(vector.expires_at),
        approver: vector.approver,
        nonce: vector.nonce,
      });

      assert.equal(
        computedPaymentId,
        vector.payment_id,
        `Payment ID mismatch for vector: ${vector.name}`,
      );
    }
  });

  it('verifies nonces provide domain uniqueness for otherwise identical payments', () => {
    const v1 = testVectorsData.vectors.find((v) => v.name === 'vector_1_standard_unapproved_1strk')!;
    const v4 = testVectorsData.vectors.find((v) => v.name === 'vector_4_nonce_domain_variation')!;

    assert.equal(v1.amount, v4.amount);
    assert.equal(v1.token, v4.token);
    assert.equal(v1.claim_preimage, v4.claim_preimage);
    assert.equal(v1.refund_preimage, v4.refund_preimage);
    assert.notEqual(v1.nonce, v4.nonce);
    assert.notEqual(v1.payment_id, v4.payment_id);
  });
});
