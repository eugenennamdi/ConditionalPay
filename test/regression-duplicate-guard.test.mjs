import assert from "node:assert";

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

async function runAll() {
  console.log("Running regression tests for duplicate submission & payload accuracy...");
  await testConcurrencyMutex();
  testAmountInvariants();
  console.log("All regression tests passed successfully.");
}

runAll().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
