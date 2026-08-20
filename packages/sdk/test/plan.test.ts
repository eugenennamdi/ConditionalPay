import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { RpcTypeToMessageMap, STRK20_ACTION } from '@starknet-io/types-js';
import {
  BearerCredentialBundle,
  exportEncryptedCredentials,
  generateSecureNonce,
  generateSecurePreimage,
  importEncryptedCredentials,
} from '../src/credentials.js';
import {
  calculateRequiredShieldedBalance,
  calculateSequentialBalanceModel,
  PaymentPlanConfig,
  prepareTx1MultiCreateBatch,
  prepareTx2Claim,
  prepareTx3Refund,
} from '../src/plan.js';
import { validateContractAddress, validateFelt } from '../src/encoding.js';
import { normalizeFelt } from '../src/hashing.js';
import { OPEN_NOTE_ID_0 } from '../src/types.js';

describe('Mainnet Execution Plan Generator & Secure Credentials', () => {
  const conditionalPay = '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const token = '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d';
  const recipient = '0x053b40a647cedfca6ca84f542a0fe3673603190d52737e333680420fa390776a';

  describe('Secure Credential Generation', () => {
    it('generates valid, in-range felt252 preimages using random entropy', () => {
      const preimage1 = generateSecurePreimage();
      const preimage2 = generateSecurePreimage();

      validateFelt(preimage1, 'preimage1');
      validateFelt(preimage2, 'preimage2');

      assert.notEqual(preimage1, preimage2, 'Preimages must be unique');
    });

    it('generates deterministic preimages when custom entropy is provided', () => {
      const mockEntropy = () => new Uint8Array(31).fill(0x42);
      const preimage = generateSecurePreimage(mockEntropy);
      assert.ok(preimage.startsWith('0x4242'));
    });

    it('generates unique client nonces', () => {
      const nonce1 = generateSecureNonce();
      const nonce2 = generateSecureNonce();

      validateFelt(nonce1, 'nonce1');
      validateFelt(nonce2, 'nonce2');
      assert.notEqual(nonce1, nonce2);
    });
  });

  describe('Encrypted Bearer Credential Backup & Restore (OWASP 600,000 Iterations)', () => {
    const mockBundle: BearerCredentialBundle = {
      paymentA: {
        paymentId: '0x1111111111111111111111111111111111111111111111111111111111111111',
        claimPreimage: '0xaaaa1111',
        refundPreimage: '0xbbbb1111',
        nonce: '101',
      },
      paymentB: {
        paymentId: '0x2222222222222222222222222222222222222222222222222222222222222222',
        claimPreimage: '0xaaaa2222',
        refundPreimage: '0xbbbb2222',
        nonce: '102',
      },
    };

    it('exports with default OWASP 600,000 iterations and decrypts accurately', async () => {
      const password = 'StrongPassword123!';
      const envelope = await exportEncryptedCredentials(mockBundle, password);

      assert.equal(envelope.cipher, 'AES-GCM-256');
      assert.equal(envelope.kdf, 'PBKDF2-SHA256');
      assert.equal(envelope.iterations, 600000, 'Must default to 600,000 iterations');
      assert.ok(envelope.ciphertextHex.length > 0);

      const restored = await importEncryptedCredentials(envelope, password);
      assert.deepEqual(restored, mockBundle);
    });

    it('supports custom iteration counts and reads iterations from envelope on import', async () => {
      const password = 'CustomPassword123!';
      const envelope = await exportEncryptedCredentials(mockBundle, password, 50000);
      assert.equal(envelope.iterations, 50000);

      const restored = await importEncryptedCredentials(envelope, password);
      assert.deepEqual(restored, mockBundle);
    });

    it('rejects decryption with incorrect password', async () => {
      const envelope = await exportEncryptedCredentials(mockBundle, 'CorrectPassword123!', 10000);
      await assert.rejects(
        () => importEncryptedCredentials(envelope, 'WrongPassword456!'),
        /Failed to decrypt credentials/,
      );
    });

    it('strictly fails decryption when ciphertext is tampered', async () => {
      const envelope = await exportEncryptedCredentials(mockBundle, 'TamperTestPass123!', 10000);
      // Flip the last hex character of ciphertext
      const tamperedHex =
        envelope.ciphertextHex.slice(0, -1) + (envelope.ciphertextHex.endsWith('a') ? 'b' : 'a');
      const tamperedEnvelope = { ...envelope, ciphertextHex: tamperedHex };

      await assert.rejects(
        () => importEncryptedCredentials(tamperedEnvelope, 'TamperTestPass123!'),
        /Failed to decrypt credentials/,
      );
    });

    it('strictly fails decryption when IV is tampered', async () => {
      const envelope = await exportEncryptedCredentials(mockBundle, 'TamperTestPass123!', 10000);
      const tamperedIv =
        envelope.ivHex.slice(0, -1) + (envelope.ivHex.endsWith('0') ? '1' : '0');
      const tamperedEnvelope = { ...envelope, ivHex: tamperedIv };

      await assert.rejects(
        () => importEncryptedCredentials(tamperedEnvelope, 'TamperTestPass123!'),
        /Failed to decrypt credentials/,
      );
    });

    it('strictly fails decryption when salt is tampered', async () => {
      const envelope = await exportEncryptedCredentials(mockBundle, 'TamperTestPass123!', 10000);
      const tamperedSalt =
        envelope.saltHex.slice(0, -1) + (envelope.saltHex.endsWith('0') ? '1' : '0');
      const tamperedEnvelope = { ...envelope, saltHex: tamperedSalt };

      await assert.rejects(
        () => importEncryptedCredentials(tamperedEnvelope, 'TamperTestPass123!'),
        /Failed to decrypt credentials/,
      );
    });

    it('ensures independent exports generate distinct salt and IV', async () => {
      const password = 'SaltIvDistinctPassword123!';
      const env1 = await exportEncryptedCredentials(mockBundle, password, 10000);
      const env2 = await exportEncryptedCredentials(mockBundle, password, 10000);

      assert.notEqual(env1.saltHex, env2.saltHex, 'Salts must be independent');
      assert.notEqual(env1.ivHex, env2.ivHex, 'IVs must be independent');
      assert.notEqual(env1.ciphertextHex, env2.ciphertextHex, 'Ciphertexts must be independent');
    });

    it('strictly prevents plaintext preimages from appearing in serialized envelope JSON', async () => {
      const envelope = await exportEncryptedCredentials(mockBundle, 'NoLeakPassword123!', 10000);
      const json = JSON.stringify(envelope);

      assert.ok(!json.includes(mockBundle.paymentA.claimPreimage), 'No claimPreimage A in JSON');
      assert.ok(!json.includes(mockBundle.paymentA.refundPreimage), 'No refundPreimage A in JSON');
      assert.ok(!json.includes(mockBundle.paymentB.claimPreimage), 'No claimPreimage B in JSON');
      assert.ok(!json.includes(mockBundle.paymentB.refundPreimage), 'No refundPreimage B in JSON');
    });

    it('rejects export if passphrase is too short', async () => {
      await assert.rejects(
        () => exportEncryptedCredentials(mockBundle, 'short'),
        /Passphrase must be at least 8 characters long/,
      );
    });
  });

  describe('TX1 Multi-CREATE Batch Preparation', () => {
    it('generates exactly 4 application actions with correct sequence and independent IDs', () => {
      const paymentA: PaymentPlanConfig = {
        amount: 100000000000000000n, // 0.1 STRK
        claim_after: 0n,
        expires_at: 1000000n + 86400n, // 24 hours
        approver: '0x0',
        claim_preimage: '0xa111',
        refund_preimage: '0xa222',
        nonce: '101',
      };

      const paymentB: PaymentPlanConfig = {
        amount: 100000000000000000n, // 0.1 STRK
        claim_after: 0n,
        expires_at: 1000000n + 900n, // 15 minutes
        approver: '0x0',
        claim_preimage: '0xb111',
        refund_preimage: '0xb222',
        nonce: '102',
      };

      const plan = prepareTx1MultiCreateBatch({
        conditionalPay,
        token,
        paymentA,
        paymentB,
      });

      // 1. Structure check: exactly 4 actions
      assert.equal(plan.actions.length, 4);
      assert.equal(plan.actions[0].type, 'withdraw');
      assert.equal(plan.actions[0].recipient, normalizeFelt(conditionalPay));
      assert.equal(plan.actions[1].type, 'invoke');
      assert.equal(plan.actions[1].contract, normalizeFelt(conditionalPay));
      assert.equal(plan.actions[2].type, 'withdraw');
      assert.equal(plan.actions[2].recipient, normalizeFelt(conditionalPay));
      assert.equal(plan.actions[3].type, 'invoke');
      assert.equal(plan.actions[3].contract, normalizeFelt(conditionalPay));

      // 2. Distinct payment IDs and hashes
      assert.notEqual(plan.paymentIdA, plan.paymentIdB);
      assert.notEqual(plan.hashlockA, plan.hashlockB);
      assert.notEqual(plan.refundHashA, plan.refundHashB);

      // 3. Type conformance against STRK20_ACTION[]
      const actions: STRK20_ACTION[] = plan.actions;
      assert.equal(actions.length, 4);

      type WalletStrk20InvokeParams =
        RpcTypeToMessageMap['wallet_strk20InvokeTransaction']['params'];
      const payload: WalletStrk20InvokeParams = { actions: plan.actions };
      assert.equal(payload.actions.length, 4);
    });
  });

  describe('TX2 & TX3 Action Preparation', () => {
    it('prepares TX2 CLAIM action batch with canonical token and OPEN note placeholder', () => {
      const paymentId = '0x5f63ac970629bfb6539bb18df38d3a34cf8ff7e1ed9a2300d8315f38f5d166';
      const actions = prepareTx2Claim(conditionalPay, {
        payment_id: paymentId,
        claim_preimage: '0xc1a01',
        token,
        recipient,
      });

      assert.equal(actions.length, 2);
      assert.equal(actions[0].type, 'transfer');
      assert.equal(actions[0].token, normalizeFelt(token));
      assert.equal(actions[0].amount, 'OPEN');
      assert.equal(actions[0].recipient, normalizeFelt(recipient));
      assert.equal(actions[1].type, 'invoke');
      assert.equal(actions[1].contract, normalizeFelt(conditionalPay));
      assert.equal(actions[1].calldata[3], OPEN_NOTE_ID_0);
    });

    it('prepares TX3 REFUND action batch with canonical token and OPEN note placeholder', () => {
      const paymentId = '0x5f63ac970629bfb6539bb18df38d3a34cf8ff7e1ed9a2300d8315f38f5d166';
      const actions = prepareTx3Refund(conditionalPay, {
        payment_id: paymentId,
        refund_preimage: '0x1e401',
        token,
        recipient,
      });

      assert.equal(actions.length, 2);
      assert.equal(actions[0].type, 'transfer');
      assert.equal(actions[0].token, normalizeFelt(token));
      assert.equal(actions[0].amount, 'OPEN');
      assert.equal(actions[0].recipient, normalizeFelt(recipient));
      assert.equal(actions[1].type, 'invoke');
      assert.equal(actions[1].contract, normalizeFelt(conditionalPay));
      assert.equal(actions[1].calldata[3], OPEN_NOTE_ID_0);
    });
  });

  describe('Sequential Balance Model & Funding Calculations', () => {
    it('accurately tracks step-by-step balance progression and theoretical vs planning targets', () => {
      const startingBalance = 18700000000000000000n; // 18.7 STRK
      const fee = 6000000000000000000n; // 6.0 STRK
      const principalA = 100000000000000000n; // 0.1 STRK
      const principalB = 100000000000000000n; // 0.1 STRK
      const buffer = 500000000000000000n; // 0.5 STRK

      const model = calculateSequentialBalanceModel(
        startingBalance,
        fee,
        principalA,
        principalB,
        buffer,
      );

      // S - (6.0 + 0.1 + 0.1) = 18.7 - 6.2 = 12.5 STRK
      assert.equal(model.afterTx1, 12500000000000000000n);

      // 12.5 - 6.0 + 0.1 = 6.6 STRK
      assert.equal(model.afterTx2, 6600000000000000000n);

      // 6.6 - 6.0 + 0.1 = 0.7 STRK
      assert.equal(model.afterTx3, 700000000000000000n);

      // Theoretical sequential minimum = (3 * 6.0) + 0.1 = 18.1 STRK
      assert.equal(model.theoreticalMinimumStart, 18100000000000000000n);

      // Conservative plan target = (3 * 6.0) + 0.1 + 0.1 + 0.5 = 18.7 STRK
      assert.equal(model.conservativePlanStart, 18700000000000000000n);
    });

    it('calculates exact balance at 6 STRK fee with calculateRequiredShieldedBalance', () => {
      const fee = 6000000000000000000n; // 6.0 STRK
      const principalA = 100000000000000000n; // 0.1 STRK
      const principalB = 100000000000000000n; // 0.1 STRK
      const buffer = 500000000000000000n; // 0.5 STRK

      const total = calculateRequiredShieldedBalance(fee, principalA, principalB, buffer);

      // (6.0 * 3) + 0.1 + 0.1 + 0.5 = 18.7 STRK = 18700000000000000000 wei
      assert.equal(total, 18700000000000000000n);
    });
  });
});
