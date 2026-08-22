import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  computeClaimHash,
  computePaymentId,
  computeRefundHash,
  exportEncryptedCredentials,
} from "../packages/sdk/dist/src/index.js";
import {
  ClaimPreparationError,
  captureRecoveryAttemptInputs,
  clearSecretClaimActions,
  clearSecretClaimSession,
  createClaimSessionKey,
  createExecutionAttemptMutex,
  hasSecretClaimSession,
  parseRecoveryEnvelopeText,
  preparePaymentAClaim,
  storeSecretClaimSession,
} from "../src/app/components/client/WalletHandle/paymentAClaimExecution.ts";

const conditionalPay =
  "0x0166e31803cfab50383d5b636b86a5646233881fad3a2fb89354da63f6cdb483";
const token = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const pool = "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a";
const recipient = "0x053b40a647cedfca6ca84f542a0fe3673603190d52737e333680420fa390776a";
const claimPreimage = "0xc1a01";
const refundPreimage = "0x1e401";
const nonce = "0x123456";
const amount = 100000000000000000n;
const expiresAt = 2000000000n;
const passphrase = "synthetic-test-passphrase";
const hashlock = computeClaimHash(claimPreimage);
const refundHash = computeRefundHash(refundPreimage);
const createParams = {
  token,
  amount,
  hashlock,
  refund_hash: refundHash,
  claim_after: 0n,
  expires_at: expiresAt,
  approver: "0x0",
  nonce,
};
const paymentId = computePaymentId(createParams);
const expectation = {
  paymentId,
  hashlock,
  amount,
  tx1Block: 80,
  minimumDepth: 10,
};

function mockProvider(overrides = {}) {
  const state = overrides.state ?? 1n;
  const liveExpiresAt = overrides.expiresAt ?? expiresAt;
  const liveHashlock = overrides.hashlock ?? hashlock;
  const locked = overrides.locked ?? amount;
  return {
    async callContract(call) {
      switch (call.entrypoint) {
        case "get_payment":
          return [
            token,
            `0x${amount.toString(16)}`,
            liveHashlock,
            refundHash,
            "0x0",
            `0x${liveExpiresAt.toString(16)}`,
            "0x0",
            "0x0",
            `0x${state.toString(16)}`,
          ];
        case "get_locked_by_token":
          return [`0x${locked.toString(16)}`];
        case "get_strk20_pool":
          return [pool];
        case "get_fee_amount":
          return ["0x53444835ec580000"];
        default:
          throw new Error("Unexpected mock entrypoint");
      }
    },
    async getBlockNumber() {
      return overrides.currentBlock ?? 100;
    },
    async getBlock() {
      return { timestamp: overrides.blockTimestamp ?? 1900000000 };
    },
  };
}

async function encryptedFixture() {
  return exportEncryptedCredentials(
    {
      paymentA: {
        paymentId,
        claimPreimage,
        refundPreimage,
        nonce,
        expiresAt: `0x${expiresAt.toString(16)}`,
      },
      paymentB: {
        paymentId: "0x2",
        claimPreimage: "0x3",
        refundPreimage: "0x4",
        nonce: "0x5",
      },
    },
    passphrase,
    1000,
  );
}

async function prepare(overrides = {}) {
  return preparePaymentAClaim({
    provider: overrides.provider ?? mockProvider(),
    conditionalPay,
    recipient,
    envelope: overrides.envelope ?? (await encryptedFixture()),
    passphrase: overrides.passphrase ?? passphrase,
    expectation: overrides.expectation ?? expectation,
    nowUnix: overrides.nowUnix ?? 1900000000n,
  });
}

describe("local-only Payment A CLAIM recovery", () => {
  it("captures selected recovery inputs before cleanup and completes preparation", async () => {
    const selectedFile = await encryptedFixture();
    const passwordInput = { value: passphrase };
    const fileInput = { file: selectedFile };

    const [capturedPassphrase, capturedFile] = captureRecoveryAttemptInputs(
      () => passwordInput.value,
      () => fileInput.file,
      () => {
        passwordInput.value = "";
        fileInput.file = undefined;
      },
    );

    assert.equal(passwordInput.value, "");
    assert.equal(fileInput.file, undefined);
    assert.equal(capturedPassphrase, passphrase);
    assert.equal(capturedFile, selectedFile);

    const result = await prepare({ envelope: capturedFile, passphrase: capturedPassphrase });
    assert.equal(result.readiness.paymentState, "ACTIVE");
    assert.deepEqual(result.actions.map((action) => action.type), ["transfer", "invoke"]);
    clearSecretClaimActions(result.actions);
  });

  it("categorizes missing inputs before recovery", () => {
    assert.throws(
      () => captureRecoveryAttemptInputs(() => "", () => undefined, () => {}),
      (error) => error instanceof ClaimPreparationError && error.code === "INPUT_MISSING",
    );
  });

  it("categorizes invalid envelope JSON and structure", () => {
    for (const text of ["not-json", "null", JSON.stringify({ version: "1.0" })]) {
      assert.throws(
        () => parseRecoveryEnvelopeText(text),
        (error) =>
          error instanceof ClaimPreparationError && error.code === "ENVELOPE_PARSE_FAILED",
      );
    }
  });

  it("rejects a wrong passphrase without enabling an execution session", async () => {
    const key = createClaimSessionKey();
    await assert.rejects(
      prepare({ passphrase: "incorrect-test-passphrase" }),
      (error) => error instanceof ClaimPreparationError && error.code === "CRYPTO_DECRYPT_FAILED",
    );
    assert.equal(hasSecretClaimSession(key), false);
  });

  it("rejects an altered encrypted envelope", async () => {
    const envelope = await encryptedFixture();
    envelope.ciphertextHex = `${envelope.ciphertextHex.slice(0, -1)}${
      envelope.ciphertextHex.endsWith("0") ? "1" : "0"
    }`;
    await assert.rejects(
      prepare({ envelope }),
      (error) => error instanceof ClaimPreparationError && error.code === "CRYPTO_DECRYPT_FAILED",
    );
  });

  it("rejects an invalid decrypted recovery schema", async () => {
    const envelope = await exportEncryptedCredentials(
      { paymentA: { paymentId } },
      passphrase,
      1000,
    );
    await assert.rejects(
      prepare({ envelope }),
      (error) => error instanceof ClaimPreparationError && error.code === "RECOVERY_SCHEMA_INVALID",
    );
  });

  it("distinguishes recovered Payment ID and hashlock mismatches", async () => {
    await assert.rejects(
      prepare({ expectation: { ...expectation, paymentId: "0x123" } }),
      (error) => error instanceof ClaimPreparationError && error.code === "PAYMENT_ID_MISMATCH",
    );
    await assert.rejects(
      prepare({ expectation: { ...expectation, hashlock: "0x123" } }),
      (error) => error instanceof ClaimPreparationError && error.code === "HASHLOCK_MISMATCH",
    );
  });

  it("categorizes live onchain field mismatches separately", async () => {
    await assert.rejects(
      prepare({ provider: mockProvider({ hashlock: "0x123" }) }),
      (error) =>
        error instanceof ClaimPreparationError &&
        error.code === "ONCHAIN_VALIDATION_MISMATCH",
    );
  });

  it("rejects non-ACTIVE and expired live payments", async () => {
    await assert.rejects(
      prepare({ provider: mockProvider({ state: 2n }) }),
      (error) => error instanceof ClaimPreparationError && error.code === "PAYMENT_NOT_ACTIVE",
    );
    await assert.rejects(
      prepare({
        provider: mockProvider({ expiresAt: 1900000000n, blockTimestamp: 1900000000 }),
        nowUnix: 1900000000n,
      }),
      (error) => error instanceof ClaimPreparationError && error.code === "PAYMENT_EXPIRED",
    );
  });

  it("builds canonical [transfer OPEN, invoke CLAIM] exclusively through the SDK", async () => {
    const result = await prepare();
    assert.deepEqual(result.actions.map((action) => action.type), ["transfer", "invoke"]);
    assert.equal(result.actions.filter((action) => action.type === "transfer").length, 1);
    assert.equal(result.actions.filter((action) => action.type === "invoke").length, 1);
    assert.equal(result.actions.at(-1).type, "invoke");
    assert.equal(result.actions[0].amount, "OPEN");
    assert.equal(result.actions[1].calldata[3], "${openNoteIds[0]}");
    assert.equal(result.sanitizedActions[1].calldata[2], "[REDACTED_CLAIM_PREIMAGE]");
    assert.equal(JSON.stringify(result.sanitizedActions).includes(claimPreimage), false);
  });

  it("enforces a synchronous execution-attempt mutex", () => {
    const mutex = createExecutionAttemptMutex();
    assert.deepEqual(
      Array.from({ length: 5 }, () => mutex.tryAcquire()),
      [true, false, false, false, false],
    );
    mutex.release();
    assert.equal(mutex.tryAcquire(), true);
  });

  it("best-effort clears secret sessions after error, success, and cancel paths", async () => {
    for (const terminalPath of ["error", "success", "cancel"]) {
      const result = await prepare();
      const key = createClaimSessionKey();
      const actions = result.actions;
      storeSecretClaimSession(key, actions);
      assert.equal(hasSecretClaimSession(key), true, terminalPath);
      clearSecretClaimSession(key);
      assert.equal(hasSecretClaimSession(key), false, terminalPath);
      assert.equal(actions.length, 0, terminalPath);
    }
  });
});

describe("local-only panel source guards", () => {
  it("never renders/logs credentials or uses persistent browser storage", () => {
    const panelSource = readFileSync(
      new URL(
        "../src/app/components/client/WalletHandle/PaymentAClaimExecutionPanel.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    const utilitySource = readFileSync(
      new URL(
        "../src/app/components/client/WalletHandle/paymentAClaimExecution.ts",
        import.meta.url,
      ),
      "utf8",
    );
    for (const source of [panelSource, utilitySource]) {
      assert.equal(source.includes("console."), false);
      assert.equal(source.includes("localStorage"), false);
      assert.equal(source.includes("sessionStorage"), false);
    }
    assert.equal(panelSource.includes("claimPreimage"), false);
    assert.doesNotMatch(panelSource, /useState[^\n]*passphrase/i);
    assert.match(panelSource, /type="password"/);
    assert.match(panelSource, /autoComplete="new-password"/);
    assert.match(panelSource, /sanitizedPayload/);
    assert.match(panelSource, /captureRecoveryAttemptInputs/);
    assert.match(panelSource, /CRYPTO_DECRYPT_FAILED/);
    assert.match(panelSource, /ENVELOPE_PARSE_FAILED/);
    assert.match(utilitySource, /\[REDACTED_CLAIM_PREIMAGE\]/);
    assert.match(utilitySource, /buildClaimActions/);
    assert.match(utilitySource, /new WeakMap/);
    assert.match(panelSource, /process\.env\.NODE_ENV === "development"/);
    assert.match(panelSource, /window\.location\.hostname === "localhost"/);
  });
});
