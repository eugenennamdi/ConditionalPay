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
  RefundPreparationError,
  captureRefundRecoveryInputs,
  clearSecretRefundActions,
  clearSecretRefundSession,
  createRefundExecutionAttemptMutex,
  createRefundSessionKey,
  hasSecretRefundSession,
  parseRefundRecoveryEnvelopeText,
  preparePaymentBRefund,
  revalidatePaymentBRefund,
  storeSecretRefundSession,
} from "../src/app/components/client/WalletHandle/paymentBRefundExecution.ts";

const conditionalPay =
  "0x0166e31803cfab50383d5b636b86a5646233881fad3a2fb89354da63f6cdb483";
const pool = "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a";
const token = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const recipient = "0x06e27c65fb5bf5206614cbaeb9b34af55469cb91c2803bd1de242efac440ed40";
const amount = 100000000000000000n;
const claimPreimage = "0xabc123";
const refundPreimage = "0xdef456";
const nonce = "0x987654";
const expiresAt = 1900000000n;
const hashlock = computeClaimHash(claimPreimage);
const refundHash = computeRefundHash(refundPreimage);
const paymentId = computePaymentId({
  token,
  amount,
  hashlock,
  refund_hash: refundHash,
  claim_after: 0n,
  expires_at: expiresAt,
  approver: "0x0",
  nonce,
});
const passphrase = "PaymentBRefundTestPassphrase!";
const expectation = {
  paymentId,
  token,
  amount,
  refundHash,
  expiresAt,
  tx3Block: 80,
  minimumDepth: 10,
  envelopeFilename: "payment-b-test.encrypted.json",
};

function felt(value) {
  return typeof value === "bigint" ? `0x${value.toString(16)}` : value;
}

function mockProvider(overrides = {}) {
  const liveToken = overrides.token ?? token;
  const liveAmount = overrides.amount ?? amount;
  const liveHashlock = overrides.hashlock ?? hashlock;
  const liveRefundHash = overrides.refundHash ?? refundHash;
  const liveExpiresAt = overrides.expiresAt ?? expiresAt;
  const state = overrides.state ?? 1n;
  return {
    async callContract(call) {
      switch (call.entrypoint) {
        case "get_payment":
          return [
            felt(liveToken),
            felt(liveAmount),
            felt(liveHashlock),
            felt(liveRefundHash),
            "0x0",
            felt(liveExpiresAt),
            "0x0",
            "0x0",
            felt(state),
          ];
        case "get_locked_by_token":
          return [felt(overrides.locked ?? liveAmount)];
        case "get_strk20_pool":
          return [pool];
        case "get_fee_amount":
          return [overrides.fee ?? "0x53444835ec580000"];
        default:
          throw new Error("Unexpected mock entrypoint");
      }
    },
    async getBlockNumber() {
      return overrides.currentBlock ?? 100;
    },
    async getBlock() {
      return { timestamp: overrides.blockTimestamp ?? Number(expiresAt + 100n) };
    },
  };
}

async function encryptedFixture(overrides = {}) {
  return exportEncryptedCredentials(
    {
      paymentB: {
        paymentId: overrides.paymentId ?? paymentId,
        claimPreimage: overrides.claimPreimage ?? claimPreimage,
        refundPreimage: overrides.refundPreimage ?? refundPreimage,
        nonce: overrides.nonce ?? nonce,
        expiresAt: overrides.recoveredExpiresAt ?? `0x${expiresAt.toString(16)}`,
      },
    },
    passphrase,
    1000,
  );
}

async function prepare(overrides = {}) {
  return preparePaymentBRefund({
    provider: overrides.provider ?? mockProvider(),
    conditionalPay,
    recipient,
    envelope: overrides.envelope ?? (await encryptedFixture()),
    passphrase: overrides.passphrase ?? passphrase,
    isMainnet: overrides.isMainnet ?? true,
    expectation: overrides.expectation ?? expectation,
    nowUnix: overrides.nowUnix ?? expiresAt + 100n,
  });
}

describe("localhost Payment B REFUND recovery", () => {
  it("captures the selected file and passphrase before cleanup", async () => {
    const selectedFile = await encryptedFixture();
    const passwordInput = { value: passphrase };
    const fileInput = { file: selectedFile };

    const [capturedPassphrase, capturedFile] = captureRefundRecoveryInputs(
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
    clearSecretRefundActions(result.actions);
  });

  it("rejects missing input and malformed envelopes", () => {
    assert.throws(
      () => captureRefundRecoveryInputs(() => "", () => undefined, () => {}),
      (error) => error instanceof RefundPreparationError && error.code === "INPUT_MISSING",
    );
    for (const text of ["not-json", "null", JSON.stringify({ version: "1.0" })]) {
      assert.throws(
        () => parseRefundRecoveryEnvelopeText(text),
        (error) =>
          error instanceof RefundPreparationError && error.code === "ENVELOPE_PARSE_FAILED",
      );
    }
  });

  it("rejects a wrong passphrase", async () => {
    await assert.rejects(
      prepare({ passphrase: "incorrect-payment-b-passphrase" }),
      (error) =>
        error instanceof RefundPreparationError && error.code === "CRYPTO_DECRYPT_FAILED",
    );
  });

  it("rejects a tampered encrypted envelope", async () => {
    const envelope = await encryptedFixture();
    envelope.ciphertextHex = `${envelope.ciphertextHex.slice(0, -1)}${
      envelope.ciphertextHex.endsWith("0") ? "1" : "0"
    }`;
    await assert.rejects(
      prepare({ envelope }),
      (error) =>
        error instanceof RefundPreparationError && error.code === "CRYPTO_DECRYPT_FAILED",
    );
  });

  it("rejects Payment ID and refund-hash mismatches", async () => {
    await assert.rejects(
      prepare({ expectation: { ...expectation, paymentId: "0x123" } }),
      (error) =>
        error instanceof RefundPreparationError && error.code === "PAYMENT_ID_MISMATCH",
    );
    await assert.rejects(
      prepare({ expectation: { ...expectation, refundHash: "0x123" } }),
      (error) =>
        error instanceof RefundPreparationError && error.code === "REFUND_HASH_MISMATCH",
    );
  });

  it("rejects invalid recovery schema and recovered public-parameter drift", async () => {
    const invalidSchema = await exportEncryptedCredentials(
      { paymentB: { paymentId } },
      passphrase,
      1000,
    );
    await assert.rejects(
      prepare({ envelope: invalidSchema }),
      (error) =>
        error instanceof RefundPreparationError && error.code === "RECOVERY_SCHEMA_INVALID",
    );
    await assert.rejects(
      prepare({ provider: mockProvider({ hashlock: "0x123" }) }),
      (error) =>
        error instanceof RefundPreparationError &&
        error.code === "ONCHAIN_VALIDATION_MISMATCH",
    );
  });

  it("rejects non-ACTIVE and pre-expiry payments", async () => {
    await assert.rejects(
      prepare({ provider: mockProvider({ state: 3n }) }),
      (error) =>
        error instanceof RefundPreparationError && error.code === "PAYMENT_NOT_ACTIVE",
    );
    await assert.rejects(
      prepare({
        provider: mockProvider({ blockTimestamp: Number(expiresAt - 1n) }),
        nowUnix: expiresAt - 1n,
      }),
      (error) =>
        error instanceof RefundPreparationError && error.code === "PAYMENT_NOT_EXPIRED",
    );
  });

  it("rejects non-Mainnet, insufficient depth, and liability mismatch", async () => {
    await assert.rejects(
      prepare({ isMainnet: false }),
      (error) =>
        error instanceof RefundPreparationError && error.code === "NETWORK_NOT_MAINNET",
    );
    await assert.rejects(
      prepare({ provider: mockProvider({ currentBlock: 89 }) }),
      (error) =>
        error instanceof RefundPreparationError && error.code === "INSUFFICIENT_DEPTH",
    );
    await assert.rejects(
      prepare({ provider: mockProvider({ locked: 0n }) }),
      (error) =>
        error instanceof RefundPreparationError && error.code === "LIABILITY_MISMATCH",
    );
  });

  it("builds canonical [transfer OPEN, invoke REFUND] through the SDK", async () => {
    const result = await prepare();
    assert.deepEqual(result.actions.map((action) => action.type), ["transfer", "invoke"]);
    assert.equal(result.actions.filter((action) => action.type === "transfer").length, 1);
    assert.equal(result.actions.filter((action) => action.type === "invoke").length, 1);
    assert.equal(result.actions.at(-1).type, "invoke");
    assert.equal(result.actions[0].amount, "OPEN");
    assert.equal(result.actions[0].token.startsWith("0x4718"), true);
    assert.equal(result.actions[1].contract.startsWith("0x166e"), true);
    assert.equal(result.actions[1].calldata[0], "0x2");
    assert.equal(BigInt(result.actions[1].calldata[1]), BigInt(paymentId));
    assert.equal(result.actions[1].calldata[3], "${openNoteIds[0]}");
    assert.equal(result.sanitizedActions[1].calldata[2], "[REDACTED_REFUND_PREIMAGE]");
    assert.equal(JSON.stringify(result.sanitizedActions).includes(refundPreimage), false);
    assert.equal(result.readiness.paymentToken, token.slice(0, 2) + token.slice(3));
    assert.equal(result.readiness.paymentAmount, amount.toString());
    assert.equal(result.readiness.expiryEligible, true);
    assert.equal(result.readiness.feeWei, "6000000000000000000");
    clearSecretRefundActions(result.actions);
  });

  it("revalidates live state immediately before execution", async () => {
    const result = await prepare();
    const refreshed = await revalidatePaymentBRefund({
      provider: mockProvider(),
      conditionalPay,
      previous: result.readiness,
      isMainnet: true,
      expectation,
      nowUnix: expiresAt + 101n,
    });
    assert.equal(refreshed.paymentState, "ACTIVE");
    assert.equal(refreshed.expiryEligible, true);
    clearSecretRefundActions(result.actions);
  });

  it("enforces a synchronous duplicate-submit mutex", () => {
    const mutex = createRefundExecutionAttemptMutex();
    assert.deepEqual(
      Array.from({ length: 5 }, () => mutex.tryAcquire()),
      [true, false, false, false, false],
    );
    mutex.release();
    assert.equal(mutex.tryAcquire(), true);
  });

  it("best-effort clears secret sessions on terminal paths", async () => {
    for (const terminalPath of ["error", "success", "cancel", "disconnect", "unmount"]) {
      const result = await prepare();
      const key = createRefundSessionKey();
      const actions = result.actions;
      storeSecretRefundSession(key, actions);
      assert.equal(hasSecretRefundSession(key), true, terminalPath);
      clearSecretRefundSession(key);
      assert.equal(hasSecretRefundSession(key), false, terminalPath);
      assert.equal(actions.length, 0, terminalPath);
    }
  });
});

describe("Payment B TX4 panel source guards", () => {
  it("is localhost-only, secret-safe, and delegates exactly once", () => {
    const panelSource = readFileSync(
      new URL(
        "../src/app/components/client/WalletHandle/PaymentBRefundExecutionPanel.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    const utilitySource = readFileSync(
      new URL(
        "../src/app/components/client/WalletHandle/paymentBRefundExecution.ts",
        import.meta.url,
      ),
      "utf8",
    );
    const parentSource = readFileSync(
      new URL(
        "../src/app/components/client/WalletHandle/WalletAccountV6Tag.tsx",
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
    assert.equal(panelSource.includes("refundPreimage"), false);
    assert.doesNotMatch(panelSource, /useState[^\n]*passphrase/i);
    assert.match(panelSource, /type="password"/);
    assert.match(panelSource, /autoComplete="new-password"/);
    assert.match(panelSource, /captureRefundRecoveryInputs/);
    assert.match(panelSource, /process\.env\.NODE_ENV === "development"/);
    assert.match(panelSource, /window\.location\.hostname === "localhost"/);
    assert.match(panelSource, /Execute TX4 REFUND once/);
    assert.match(panelSource, /Sanitized TX4 payload/);
    assert.ok(
      panelSource.indexOf("!mountedRef.current || !connectedRef.current || !mainnetRef.current") <
        panelSource.indexOf("storeSecretRefundSession(sessionKey, result.actions)"),
      "Disconnect or unmount must prevent a late recovery result from creating a secret session",
    );
    assert.ok(
      panelSource.lastIndexOf(
        "!mountedRef.current || !connectedRef.current || !mainnetRef.current",
      ) < panelSource.indexOf("await executeActions(session.actions, onWalletSettled)"),
      "Disconnect or unmount must prevent a late revalidation from entering the wallet boundary",
    );
    assert.match(utilitySource, /\[REDACTED_REFUND_PREIMAGE\]/);
    assert.match(utilitySource, /buildRefundActions/);
    assert.match(utilitySource, /new WeakMap/);
    assert.equal(
      (panelSource.match(/await executeActions\(session\.actions, onWalletSettled\)/g) ?? [])
        .length,
      1,
    );
    const executeHandler = panelSource.slice(
      panelSource.indexOf("const handleExecute = async () =>"),
      panelSource.indexOf("const handleCancel = () =>"),
    );
    assert.ok(
      executeHandler.indexOf("if (!mutex?.tryAcquire()) return") <
        executeHandler.indexOf("await executeActions(session.actions, onWalletSettled)"),
      "The TX4 child mutex must be acquired before parent delegation",
    );
    assert.ok(
      executeHandler.indexOf(
        "mutex.release()",
        executeHandler.indexOf("await executeActions(session.actions, onWalletSettled)"),
      ) > executeHandler.indexOf("await executeActions(session.actions, onWalletSettled)"),
      "The TX4 child mutex must remain held until parent delegation settles",
    );
    assert.match(parentSource, /executePreparedPaymentBRefund/);
    assert.match(parentSource, /isMainnet=\{isMainnet\}/);
    assert.equal(
      (parentSource.match(/myWalletAccount\.strk20InvokeTransaction\(actions\)/g) ?? []).length,
      1,
    );
    assert.equal(parentSource.includes("actions.map((action) => action.calldata)"), false);
    assert.match(parentSource, /sensitiveWalletErrors/);
  });
});
