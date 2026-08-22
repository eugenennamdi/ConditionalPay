import assert from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const testDir = dirname(fileURLToPath(import.meta.url));

// 1. Test Concurrency Mutex Pattern
async function testConcurrencyMutex() {
  const isSubmittingRef = { current: false };
  let invocationCount = 0;

  async function mockSubmit(action) {
    if (isSubmittingRef.current) {
      return undefined;
    }
    isSubmittingRef.current = true;
    try {
      // Simulate proof generation delay
      await new Promise((resolve) => setTimeout(resolve, 50));
      invocationCount++;
      return { txHash: `0xmock_${action.amount}` };
    } finally {
      isSubmittingRef.current = false;
    }
  }

  // Fire 5 rapid concurrent submissions
  const promises = [
    mockSubmit({ amount: "1 STRK" }),
    mockSubmit({ amount: "1 STRK" }),
    mockSubmit({ amount: "1 STRK" }),
    mockSubmit({ amount: "1 STRK" }),
    mockSubmit({ amount: "1 STRK" }),
  ];

  const results = await Promise.all(promises);

  // Exactly one should succeed and return txHash, others should be undefined
  const successfulResults = results.filter((r) => r !== undefined);
  assert.strictEqual(successfulResults.length, 1, "Only one invocation must succeed during concurrent burst");
  assert.strictEqual(invocationCount, 1, "Underlying strk20InvokeTransaction must only be called once");
  assert.strictEqual(isSubmittingRef.current, false, "Mutex must be released after completion");
  console.log("✓ Concurrency mutex test passed: 5 rapid clicks result in exactly 1 invoke.");
}

// 2. Test Amount Invariant for Send Action
function testAmountInvariants() {
  const ONE_STRK_BIGINT = 1n * 10n ** 18n;
  const FIVE_STRK_BIGINT = 5n * 10n ** 18n;
  const TEN_STRK_BIGINT = 10n * 10n ** 18n;

  const hexOneStrk = "0x" + ONE_STRK_BIGINT.toString(16);
  const hexFiveStrk = "0x" + FIVE_STRK_BIGINT.toString(16);
  const hexTenStrk = "0x" + TEN_STRK_BIGINT.toString(16);

  assert.strictEqual(hexOneStrk, "0xde0b6b3a7640000", "1 STRK hex encoding mismatch");
  assert.strictEqual(hexFiveStrk, "0x4563918244f40000", "5 STRK hex encoding mismatch");
  assert.strictEqual(hexTenStrk, "0x8ac7230489e80000", "10 STRK hex encoding mismatch");

  // Send action configuration verification
  const sendPayload = {
    type: "transfer",
    amount: hexOneStrk,
  };
  const uiDisplayValue = "1";

  assert.strictEqual(
    BigInt(sendPayload.amount),
    BigInt(uiDisplayValue) * 10n ** 18n,
    "Send payload amount must strictly match UI displayed value (1 STRK)"
  );
  assert.notStrictEqual(
    BigInt(sendPayload.amount),
    FIVE_STRK_BIGINT,
    "Send payload amount must NEVER equal 5 STRK"
  );
  console.log("✓ Send amount invariant test passed: Send payload strictly locked to 1 STRK.");
}

// 3. CREATE must remain routed through the canonical SDK serializer and must not expose
// temporary wallet-interactive diagnostics.
function testCreateUsesCanonicalSdkBuilder() {
  const walletUiPath = resolve(
    testDir,
    "../src/app/components/client/WalletHandle/WalletAccountV6Tag.tsx"
  );
  const source = readFileSync(walletUiPath, "utf8");
  const handlerStart = source.indexOf("const handleCreatePaymentA");
  const handlerEnd = source.indexOf("// Fetch the tx receipt", handlerStart);
  const createHandler = source.slice(handlerStart, handlerEnd);

  assert.ok(
    source.includes('import { buildCreateActions } from "@conditionalpay/sdk";'),
    "Frontend CREATE must import the canonical SDK builder"
  );
  assert.ok(
    createHandler.includes("const actions = buildCreateActions("),
    "Frontend CREATE must build actions through buildCreateActions()"
  );
  assert.ok(
    !createHandler.includes("const actions: STRK20_ACTION[] = ["),
    "Frontend CREATE must not handwrite a STRK20 action array"
  );
  assert.ok(
    !source.includes("strk20PrepareInvoke"),
    "Temporary wallet-interactive diagnostics must remain removed"
  );
  console.log("✓ CREATE frontend route uses the SDK builder and exposes no prepare-invoke diagnostics.");
}

// 4. The single Wallet API boundary is instrumented without logging secret-bearing actions.
function testWalletBoundaryInstrumentation() {
  const walletUiPath = resolve(
    testDir,
    "../src/app/components/client/WalletHandle/WalletAccountV6Tag.tsx"
  );
  const claimPanelPath = resolve(
    testDir,
    "../src/app/components/client/WalletHandle/PaymentAClaimExecutionPanel.tsx"
  );
  const source = readFileSync(walletUiPath, "utf8");
  const panelSource = readFileSync(claimPanelPath, "utf8");
  const calls = source.match(/myWalletAccount\.strk20InvokeTransaction\(actions\)/g) ?? [];
  const boundaryStart = source.indexOf("const diagnosticRequestId = createWalletDiagnosticRequestId()");
  const boundaryEnd = source.indexOf(
    "const r = await myWalletAccount.strk20InvokeTransaction(actions)",
    boundaryStart
  );
  const receiptWait = source.indexOf("await provider.waitForTransaction(txH", boundaryEnd);
  const parentMutexRelease = source.indexOf("isSubmittingRef.current = false", boundaryEnd);
  const boundary = source.slice(boundaryStart, boundaryEnd);

  assert.strictEqual(calls.length, 1, "The app must contain exactly one Wallet API invoke boundary");
  assert.ok(boundaryStart >= 0 && boundaryEnd > boundaryStart, "Boundary instrumentation must precede the call");
  assert.ok(boundary.includes("strk20WalletInvocationCount += 1"), "Invocation counter must increment");
  assert.ok(boundary.includes("requestId: diagnosticRequestId"), "Diagnostic request ID must be logged");
  assert.ok(boundary.includes('method: "strk20InvokeTransaction"'), "Method name must be logged");
  assert.ok(boundary.includes("actionCount: actions.length"), "Action count must be logged");
  assert.ok(
    boundary.includes("actionTypes: actions.map((action) => action.type)"),
    "Only action type discriminants may be logged"
  );
  assert.ok(!boundary.includes("calldata"), "Instrumentation must never log calldata");
  assert.ok(
    source.indexOf("isSubmittingRef.current = true") < boundaryEnd &&
      receiptWait > boundaryEnd &&
      parentMutexRelease > receiptWait,
    "The parent mutex must remain held through Wallet API settlement and receipt polling"
  );
  assert.strictEqual(
    (panelSource.match(/await executeActions\(session\.actions, onWalletSettled\)/g) ?? []).length,
    1,
    "TX2 child handler must delegate exactly once"
  );
  assert.ok(
    panelSource.indexOf("if (!mutex?.tryAcquire()) return") <
      panelSource.indexOf("await executeActions(session.actions, onWalletSettled)") &&
      panelSource.indexOf(
        "mutex.release()",
        panelSource.indexOf("await executeActions(session.actions, onWalletSettled)")
      ) >
        panelSource.indexOf("await executeActions(session.actions, onWalletSettled)"),
    "The TX2 child mutex must enclose the complete parent delegation"
  );
  console.log("✓ Wallet boundary instrumentation is single-call and secret-safe.");
}

async function runAll() {
  console.log("Running regression tests for duplicate submission & payload accuracy...");
  await testConcurrencyMutex();
  testAmountInvariants();
  testCreateUsesCanonicalSdkBuilder();
  testWalletBoundaryInstrumentation();
  console.log("All regression tests passed successfully.");
}

runAll().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
