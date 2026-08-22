import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { computePaymentId } from "../packages/sdk/dist/src/index.js";
import {
  PaymentBCreateError,
  clearPaymentBCreateActions,
  createPaymentBExecutionAttemptMutex,
  isResolvedMainnetNetwork,
  preparePaymentBCreate,
  queryPaymentBBaseReadiness,
  revalidatePaymentBCreate,
  runPaymentBReadinessRefresh,
  safePaymentBCreateMessage,
} from "../src/app/components/client/WalletHandle/paymentBCreateExecution.ts";

const conditionalPay =
  "0x0166e31803cfab50383d5b636b86a5646233881fad3a2fb89354da63f6cdb483";
const pool = "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a";
const token = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const generatedAt = 2000000000n;
const expiresAt = generatedAt + 15n * 60n;
const params = {
  token,
  amount: 100000000000000000n,
  hashlock: "0x1234",
  refund_hash: "0x5678",
  claim_after: 0n,
  expires_at: expiresAt,
  approver: "0x0",
  nonce: "0x9abc",
};
const configuration = {
  paymentId: computePaymentId(params),
  token,
  amount: params.amount.toString(),
  hashlock: params.hashlock,
  refundHash: params.refund_hash,
  nonce: params.nonce,
  generatedAtUnix: generatedAt.toString(),
  expiresAtUnix: expiresAt.toString(),
  envelopeFilename: "payment-b-test.encrypted.json",
  recoveryRoundtripVerified: true,
};

function mockProvider(overrides = {}) {
  return {
    async callContract(call) {
      switch (call.entrypoint) {
        case "get_payment":
          return ["0x0", "0x0", "0x0", "0x0", "0x0", "0x0", "0x0", "0x0", overrides.state ?? "0x0"];
        case "get_locked_by_token":
          return [overrides.locked ?? "0x0"];
        case "get_strk20_pool":
          return [pool];
        case "get_fee_amount":
          return [overrides.fee ?? "0x53444835ec580000"];
        default:
          throw new Error("Unexpected mock entrypoint");
      }
    },
    async getBlockNumber() {
      return 100;
    },
    async getBlock() {
      return { timestamp: overrides.blockTimestamp ?? Number(generatedAt + 10n) };
    },
  };
}

async function prepare(overrides = {}) {
  return preparePaymentBCreate({
    provider: overrides.provider ?? mockProvider(),
    conditionalPay,
    configuration: overrides.configuration ?? configuration,
    isMainnet: overrides.isMainnet ?? true,
    nowUnix: overrides.nowUnix ?? generatedAt + 10n,
  });
}

describe("localhost Payment B TX3 preparation", () => {
  it("uses the parent-resolved network name as the only Mainnet representation", () => {
    assert.equal(isResolvedMainnetNetwork("MAINNET"), true);
    assert.equal(isResolvedMainnetNetwork("SEPOLIA"), false);
    assert.equal(isResolvedMainnetNetwork("SN_MAIN"), false);
    assert.equal(isResolvedMainnetNetwork("0x534e5f4d41494e"), false);
  });

  it("refresh calls the read-only readiness function and publishes checking then ready", async () => {
    const transitions = [];
    let readCount = 0;
    let surfaced;
    await runPaymentBReadinessRefresh({
      onChecking: () => transitions.push("checking"),
      read: async () => {
        readCount += 1;
        return prepare();
      },
      onReady: (value) => {
        transitions.push("ready");
        surfaced = value;
      },
      onError: () => transitions.push("error"),
    });
    assert.equal(readCount, 1);
    assert.deepEqual(transitions, ["checking", "ready"]);
    assert.equal(surfaced.readiness.paymentState, "UNINITIALIZED");
    assert.equal(surfaced.readiness.lockedLiability, "0");
    assert.equal(surfaced.readiness.feeWei, "6000000000000000000");
    assert.deepEqual(surfaced.readiness.actionTopology, ["withdraw", "invoke"]);
    clearPaymentBCreateActions(surfaced.actions);
  });

  it("reports base Mainnet readiness with no Payment B loaded", async () => {
    const result = await queryPaymentBBaseReadiness({
      provider: mockProvider(),
      conditionalPay,
      token,
      isMainnet: true,
      nowUnix: generatedAt,
    });
    assert.equal(result.network, "MAINNET");
    assert.equal(result.lockedLiability, "0");
    assert.equal(result.feeWei, "6000000000000000000");
  });

  it("surfaces RPC failures as a safe explicit refresh error", async () => {
    const transitions = [];
    await runPaymentBReadinessRefresh({
      onChecking: () => transitions.push("checking"),
      read: () =>
        queryPaymentBBaseReadiness({
          provider: {
            ...mockProvider(),
            async callContract() {
              throw new Error("sensitive upstream diagnostics");
            },
          },
          conditionalPay,
          token,
          isMainnet: true,
        }),
      onReady: () => transitions.push("ready"),
      onError: (error) => transitions.push(safePaymentBCreateMessage(error)),
    });
    assert.deepEqual(transitions, ["checking", "Mainnet readiness checks could not be completed."]);
    assert.equal(transitions.join(" ").includes("sensitive upstream diagnostics"), false);
  });

  it("builds canonical [withdraw, invoke CREATE] exclusively through the SDK", async () => {
    const result = await prepare();
    assert.deepEqual(result.actions.map((action) => action.type), ["withdraw", "invoke"]);
    assert.equal(result.actions.filter((action) => action.type === "invoke").length, 1);
    assert.equal(result.actions.at(-1).type, "invoke");
    assert.equal(result.actions[0].token.startsWith("0x4718"), true);
    assert.equal(result.actions[0].recipient.startsWith("0x166e"), true);
    assert.equal(result.actions[1].contract.startsWith("0x166e"), true);
    assert.equal(result.actions[1].calldata[0], "0x0");
    assert.equal(result.readiness.paymentState, "UNINITIALIZED");
    assert.equal(result.readiness.lockedLiability, "0");
    assert.deepEqual(result.readiness.actionTopology, ["withdraw", "invoke"]);
    clearPaymentBCreateActions(result.actions);
  });

  it("rejects non-Mainnet, initialized payment, non-zero liability, and low expiry margin", async () => {
    await assert.rejects(
      prepare({ isMainnet: false }),
      (error) => error instanceof PaymentBCreateError && error.code === "NETWORK_NOT_MAINNET",
    );
    await assert.rejects(
      prepare({ provider: mockProvider({ state: "0x1" }) }),
      (error) => error instanceof PaymentBCreateError && error.code === "PAYMENT_NOT_UNINITIALIZED",
    );
    await assert.rejects(
      prepare({ provider: mockProvider({ locked: "0x1" }) }),
      (error) => error instanceof PaymentBCreateError && error.code === "LIABILITY_NOT_ZERO",
    );
    await assert.rejects(
      prepare({ nowUnix: expiresAt - 299n }),
      (error) => error instanceof PaymentBCreateError && error.code === "EXPIRY_MARGIN_TOO_LOW",
    );
  });

  it("rejects altered public configuration and revalidates immediately before execution", async () => {
    await assert.rejects(
      prepare({ configuration: { ...configuration, paymentId: "0x123" } }),
      (error) => error instanceof PaymentBCreateError && error.code === "CONFIGURATION_INVALID",
    );
    const prepared = await prepare();
    const refreshed = await revalidatePaymentBCreate({
      provider: mockProvider(),
      conditionalPay,
      configuration,
      previous: prepared.readiness,
      isMainnet: true,
      nowUnix: generatedAt + 20n,
    });
    assert.equal(refreshed.paymentState, "UNINITIALIZED");
    clearPaymentBCreateActions(prepared.actions);
  });

  it("enforces a synchronous execution-attempt mutex", () => {
    const mutex = createPaymentBExecutionAttemptMutex();
    assert.deepEqual(Array.from({ length: 5 }, () => mutex.tryAcquire()), [true, false, false, false, false]);
    mutex.release();
    assert.equal(mutex.tryAcquire(), true);
  });
});

describe("Payment B TX3 panel source guards", () => {
  it("is localhost-only, separate from TX1, secret-free, and delegates once", () => {
    const panelSource = readFileSync(
      new URL("../src/app/components/client/WalletHandle/PaymentBCreateExecutionPanel.tsx", import.meta.url),
      "utf8",
    );
    const utilitySource = readFileSync(
      new URL("../src/app/components/client/WalletHandle/paymentBCreateExecution.ts", import.meta.url),
      "utf8",
    );
    const parentSource = readFileSync(
      new URL("../src/app/components/client/WalletHandle/WalletAccountV6Tag.tsx", import.meta.url),
      "utf8",
    );
    for (const source of [panelSource, utilitySource]) {
      assert.equal(source.includes("localStorage"), false);
      assert.equal(source.includes("sessionStorage"), false);
      assert.equal(source.includes("console."), false);
      assert.equal(source.includes("claimPreimage"), false);
      assert.equal(source.includes("refundPreimage"), false);
    }
    assert.match(panelSource, /process\.env\.NODE_ENV === "development"/);
    assert.match(panelSource, /window\.location\.hostname === "localhost"/);
    assert.match(panelSource, /Execute CREATE Payment B \(TX3\)/);
    assert.match(panelSource, /queryPaymentBBaseReadiness/);
    assert.match(panelSource, /runPaymentBReadinessRefresh/);
    assert.match(panelSource, /Mainnet readiness passed/);
    assert.equal((panelSource.match(/await executeActions\(actions, onWalletSettled\)/g) ?? []).length, 1);
    assert.match(utilitySource, /buildCreateActions/);
    assert.match(parentSource, /handleCreatePaymentA/);
    assert.match(parentSource, /executePreparedPaymentBCreate/);
    assert.match(parentSource, /isResolvedMainnetNetwork\(networkName\)/);
    assert.equal(parentSource.includes("chainIdWA"), false);
    assert.equal(parentSource.includes('BigInt("0x534e5f4d41494e")'), false);
    assert.equal(
      (parentSource.match(/myWalletAccount\.strk20InvokeTransaction\(actions\)/g) ?? []).length,
      1,
    );
  });
});
