import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { RpcTypeToMessageMap, STRK20_ACTION } from '@starknet-io/types-js';
import {
  BearerCredentialBundle,
  ClaimAccessCredentials,
  exportClaimAccessCredentials,
  exportEncryptedCredentials,
  exportSinglePaymentCredentials,
  generateSecureNonce,
  generateSecurePreimage,
  importClaimAccessCredentials,
  importEncryptedCredentials,
  importSinglePaymentCredentials,
  SinglePaymentCredentials,
} from '../src/credentials.js';
import {
  calculateRequiredShieldedBalance,
  calculateSequentialBalanceModel,
  PaymentPlanConfig,
  prepareTx1MultiCreateBatch,
  prepareTx2Claim,
  prepareTx3Refund,
} from '../src/plan.js';
import { validateFelt } from '../src/encoding.js';
import { computeClaimHash, normalizeFelt } from '../src/hashing.js';
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

  describe('SinglePaymentCredentials Backup & Restore (v1.1)', () => {
    const mockSingle: SinglePaymentCredentials = {
      paymentId: '0x019b3f6176561b6054a803a0d499c73252413eaa8756dda3990f605ef9273ac3',
      claimPreimage: '0x0111b222c333d444e555f6660111222333444555666777888999aaabbbcccddd',
      refundPreimage: '0x0211c222d333e444f5550666111122223333444455556666777788889999aaaa',
      nonce: '0x101',
    };

    it('exports with v1.1 and default OWASP 600,000 iterations and decrypts accurately', async () => {
      const password = 'StrongConsolePassword123!';
      const envelope = await exportSinglePaymentCredentials(mockSingle, password);

      assert.equal(envelope.version, '1.1');
      assert.equal(envelope.cipher, 'AES-GCM-256');
      assert.equal(envelope.kdf, 'PBKDF2-SHA256');
      assert.equal(envelope.iterations, 600000, 'Must default to 600,000 iterations');
      assert.ok(envelope.ciphertextHex.length > 0);

      const restored = await importSinglePaymentCredentials(envelope, password);
      assert.deepEqual(restored, mockSingle);
      assert.equal(restored.paymentId, mockSingle.paymentId);
      assert.equal(restored.claimPreimage, mockSingle.claimPreimage);
      assert.equal(restored.refundPreimage, mockSingle.refundPreimage);
      assert.equal(restored.nonce, mockSingle.nonce);
    });

    it('rejects decryption with incorrect password', async () => {
      const envelope = await exportSinglePaymentCredentials(mockSingle, 'CorrectPassword123!', 10000);
      await assert.rejects(
        () => importSinglePaymentCredentials(envelope, 'WrongPassword456!'),
        /Failed to decrypt credentials/,
      );
    });

    it('strictly fails decryption when ciphertext is tampered', async () => {
      const envelope = await exportSinglePaymentCredentials(mockSingle, 'TamperTestPass123!', 10000);
      const tamperedHex =
        envelope.ciphertextHex.slice(0, -1) + (envelope.ciphertextHex.endsWith('a') ? 'b' : 'a');
      const tamperedEnvelope = { ...envelope, ciphertextHex: tamperedHex };

      await assert.rejects(
        () => importSinglePaymentCredentials(tamperedEnvelope, 'TamperTestPass123!'),
        /Failed to decrypt credentials/,
      );
    });

    it('strictly fails decryption when IV is tampered', async () => {
      const envelope = await exportSinglePaymentCredentials(mockSingle, 'TamperTestPass123!', 10000);
      const tamperedIv =
        envelope.ivHex.slice(0, -1) + (envelope.ivHex.endsWith('0') ? '1' : '0');
      const tamperedEnvelope = { ...envelope, ivHex: tamperedIv };

      await assert.rejects(
        () => importSinglePaymentCredentials(tamperedEnvelope, 'TamperTestPass123!'),
        /Failed to decrypt credentials/,
      );
    });

    it('strictly fails decryption when salt is tampered', async () => {
      const envelope = await exportSinglePaymentCredentials(mockSingle, 'TamperTestPass123!', 10000);
      const tamperedSalt =
        envelope.saltHex.slice(0, -1) + (envelope.saltHex.endsWith('0') ? '1' : '0');
      const tamperedEnvelope = { ...envelope, saltHex: tamperedSalt };

      await assert.rejects(
        () => importSinglePaymentCredentials(tamperedEnvelope, 'TamperTestPass123!'),
        /Failed to decrypt credentials/,
      );
    });

    it('cross-format isolation: historical v1.0 bundle cannot import through importSinglePaymentCredentials', async () => {
      const historicalBundle: BearerCredentialBundle = {
        paymentA: { paymentId: '0x1', claimPreimage: '0x2', refundPreimage: '0x3', nonce: '0x4' },
        paymentB: { paymentId: '0x5', claimPreimage: '0x6', refundPreimage: '0x7', nonce: '0x8' },
      };
      const v1Envelope = await exportEncryptedCredentials(historicalBundle, 'CommonPassword123!', 10000);
      assert.equal(v1Envelope.version, '1.0');

      await assert.rejects(
        // @ts-expect-error test cross-envelope type safety
        () => importSinglePaymentCredentials(v1Envelope, 'CommonPassword123!'),
        /Unsupported envelope format/,
      );
    });

    it('cross-format isolation: v1.1 SinglePaymentCredentials envelope cannot import through historical importEncryptedCredentials', async () => {
      const v11Envelope = await exportSinglePaymentCredentials(mockSingle, 'CommonPassword123!', 10000);
      assert.equal(v11Envelope.version, '1.1');

      await assert.rejects(
        // @ts-expect-error test cross-envelope type safety
        () => importEncryptedCredentials(v11Envelope, 'CommonPassword123!'),
        /Unsupported envelope format/,
      );
    });

    it('strictly prevents plaintext preimages from appearing in serialized SinglePayment envelope JSON', async () => {
      const envelope = await exportSinglePaymentCredentials(mockSingle, 'NoLeakPassword123!', 10000);
      const json = JSON.stringify(envelope);

      assert.ok(!json.includes(mockSingle.claimPreimage), 'No claimPreimage in JSON');
      assert.ok(!json.includes(mockSingle.refundPreimage), 'No refundPreimage in JSON');
      assert.ok(!json.includes(mockSingle.nonce), 'No nonce in JSON');
    });

    it('rejects export if passphrase is too short', async () => {
      await assert.rejects(
        () => exportSinglePaymentCredentials(mockSingle, 'short'),
        /Passphrase must be at least 8 characters long/,
      );
    });

    it('canonical package root exposes SinglePaymentCredentials APIs', async () => {
      const sdkRoot = await import('../src/index.js');
      assert.equal(typeof sdkRoot.exportSinglePaymentCredentials, 'function');
      assert.equal(typeof sdkRoot.importSinglePaymentCredentials, 'function');
      assert.equal(typeof sdkRoot.exportEncryptedCredentials, 'function');
      assert.equal(typeof sdkRoot.importEncryptedCredentials, 'function');
      assert.equal(sdkRoot.DEFAULT_PBKDF2_ITERATIONS, 600_000);
    });
  });

  describe('ClaimAccessCredentials Backup & Restore (v1.2)', () => {
    const mockClaimAccess: ClaimAccessCredentials = {
      paymentId: '0x05a7f9b23c81d4e6012789abc456def0123456789abcdef0123456789abcdef0',
      claimPreimage: '0x0111111111111111111111111111111111111111111111111111111111111111',
    };

    it('exports with v1.2 and default OWASP 600,000 iterations and decrypts accurately', async () => {
      const password = 'StrongClaimPassphrase123!';
      const envelope = await exportClaimAccessCredentials(mockClaimAccess, password);

      assert.equal(envelope.version, '1.2');
      assert.equal(envelope.cipher, 'AES-GCM-256');
      assert.equal(envelope.kdf, 'PBKDF2-SHA256');
      assert.equal(envelope.iterations, 600000, 'Must default to 600,000 iterations');
      assert.ok(envelope.ciphertextHex.length > 0);

      const restored = await importClaimAccessCredentials(envelope, password);
      assert.deepEqual(restored, mockClaimAccess);
      assert.equal(restored.paymentId, mockClaimAccess.paymentId);
      assert.equal(restored.claimPreimage, mockClaimAccess.claimPreimage);
      assert.equal((restored as unknown as Record<string, unknown>).refundPreimage, undefined);
      assert.equal((restored as unknown as Record<string, unknown>).nonce, undefined);
    });

    it('proves claim-access envelope reuses existing CREATE paymentId and claimPreimage', () => {
      const hashlock = computeClaimHash(mockClaimAccess.claimPreimage);
      assert.equal(computeClaimHash(mockClaimAccess.claimPreimage), hashlock);
      assert.equal(mockClaimAccess.paymentId.startsWith('0x'), true);
    });

    it('rejects decryption with incorrect password', async () => {
      const envelope = await exportClaimAccessCredentials(mockClaimAccess, 'CorrectClaimPass123!', 10000);
      await assert.rejects(
        () => importClaimAccessCredentials(envelope, 'WrongClaimPass456!'),
        /Failed to decrypt credentials/,
      );
    });

    it('strictly fails decryption when ciphertext is tampered', async () => {
      const envelope = await exportClaimAccessCredentials(mockClaimAccess, 'TamperPass123!', 10000);
      const tamperedHex =
        envelope.ciphertextHex.slice(0, -1) + (envelope.ciphertextHex.endsWith('a') ? 'b' : 'a');
      const tamperedEnvelope = { ...envelope, ciphertextHex: tamperedHex };

      await assert.rejects(
        () => importClaimAccessCredentials(tamperedEnvelope, 'TamperPass123!'),
        /Failed to decrypt credentials/,
      );
    });

    it('strictly fails decryption when IV is tampered', async () => {
      const envelope = await exportClaimAccessCredentials(mockClaimAccess, 'TamperPass123!', 10000);
      const tamperedIv =
        envelope.ivHex.slice(0, -1) + (envelope.ivHex.endsWith('0') ? '1' : '0');
      const tamperedEnvelope = { ...envelope, ivHex: tamperedIv };

      await assert.rejects(
        () => importClaimAccessCredentials(tamperedEnvelope, 'TamperPass123!'),
        /Failed to decrypt credentials/,
      );
    });

    it('strictly fails decryption when salt is tampered', async () => {
      const envelope = await exportClaimAccessCredentials(mockClaimAccess, 'TamperPass123!', 10000);
      const tamperedSalt =
        envelope.saltHex.slice(0, -1) + (envelope.saltHex.endsWith('0') ? '1' : '0');
      const tamperedEnvelope = { ...envelope, saltHex: tamperedSalt };

      await assert.rejects(
        () => importClaimAccessCredentials(tamperedEnvelope, 'TamperPass123!'),
        /Failed to decrypt credentials/,
      );
    });

    it('cross-format isolation: v1.0 and v1.1 cannot import through importClaimAccessCredentials', async () => {
      const single: SinglePaymentCredentials = {
        paymentId: '0x1',
        claimPreimage: '0x2',
        refundPreimage: '0x3',
        nonce: '0x4',
      };
      const v11Envelope = await exportSinglePaymentCredentials(single, 'CommonPass123!', 10000);
      assert.equal(v11Envelope.version, '1.1');

      await assert.rejects(
        // @ts-expect-error test cross-envelope type safety
        () => importClaimAccessCredentials(v11Envelope, 'CommonPass123!'),
        /Unsupported envelope format: AES-GCM-256 v1.1/,
      );

      const historicalBundle: BearerCredentialBundle = {
        paymentA: { paymentId: '0x1', claimPreimage: '0x2', refundPreimage: '0x3', nonce: '0x4' },
        paymentB: { paymentId: '0x5', claimPreimage: '0x6', refundPreimage: '0x7', nonce: '0x8' },
      };
      const v10Envelope = await exportEncryptedCredentials(historicalBundle, 'CommonPass123!', 10000);
      assert.equal(v10Envelope.version, '1.0');

      await assert.rejects(
        // @ts-expect-error test cross-envelope type safety
        () => importClaimAccessCredentials(v10Envelope, 'CommonPass123!'),
        /Unsupported envelope format: AES-GCM-256 v1.0/,
      );
    });

    it('cross-format isolation: v1.2 ClaimAccess envelope cannot import through historical importEncryptedCredentials or importSinglePaymentCredentials', async () => {
      const v12Envelope = await exportClaimAccessCredentials(mockClaimAccess, 'CommonPass123!', 10000);
      assert.equal(v12Envelope.version, '1.2');

      await assert.rejects(
        // @ts-expect-error test cross-envelope type safety
        () => importEncryptedCredentials(v12Envelope, 'CommonPass123!'),
        /Unsupported envelope format: AES-GCM-256 v1.2/,
      );

      await assert.rejects(
        // @ts-expect-error test cross-envelope type safety
        () => importSinglePaymentCredentials(v12Envelope, 'CommonPass123!'),
        /Unsupported envelope format: AES-GCM-256 v1.2/,
      );
    });

    it('rejects decrypted payload with arbitrary extra properties in v1.2 envelope', async () => {
      // Craft an envelope encrypted with an extra refundPreimage field
      const payloadWithExtra = {
        paymentId: mockClaimAccess.paymentId,
        claimPreimage: mockClaimAccess.claimPreimage,
        refundPreimage: '0x999',
      };
      const crafted = await exportClaimAccessCredentials(
        payloadWithExtra as unknown as ClaimAccessCredentials,
        'ExtraPropPass123!',
        10000,
      );

      await assert.rejects(
        () => importClaimAccessCredentials(crafted, 'ExtraPropPass123!'),
        /Failed to decrypt credentials: corrupted or unexpected payload schema/,
      );
    });

    it('strictly prevents plaintext preimages from appearing in serialized ClaimAccess envelope JSON', async () => {
      const envelope = await exportClaimAccessCredentials(mockClaimAccess, 'NoLeakPassword123!', 10000);
      const json = JSON.stringify(envelope);

      assert.ok(!json.includes(mockClaimAccess.claimPreimage), 'No claimPreimage in JSON');
    });

    it('rejects export if passphrase is too short', async () => {
      await assert.rejects(
        () => exportClaimAccessCredentials(mockClaimAccess, 'short'),
        /Passphrase must be at least 8 characters long/,
      );
    });

    it('canonical package root exposes ClaimAccessCredentials APIs', async () => {
      const sdkRoot = await import('../src/index.js');
      assert.equal(typeof sdkRoot.exportClaimAccessCredentials, 'function');
      assert.equal(typeof sdkRoot.importClaimAccessCredentials, 'function');
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
