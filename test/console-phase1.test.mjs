import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(testDirectory, "..");

// Independent Canonical Constants for Assertion
const CANONICAL_CONDITIONAL_PAY_CONTRACT =
  "0x0166e31803cfab50383d5b636b86a5646233881fad3a2fb89354da63f6cdb483";
const CANONICAL_STRK20_POOL_CONTRACT =
  "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a";
const CANONICAL_STRK_TOKEN =
  "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

const CANONICAL_PAYMENT_A_ID =
  "0x19b3f6176561b6054a803a0d499c73252413eaa8756dda3990f605ef9273ac3";
const CANONICAL_PAYMENT_A_CREATE_HASH =
  "0x47edc8e74fc08c4726a817a23085a2ae2dd95590fb6a32d3b3c5b5159e586e6";
const CANONICAL_PAYMENT_A_CREATE_BLOCK = 13_701_781;
const CANONICAL_PAYMENT_A_CLAIM_HASH =
  "0xde61c431a92dabc7b8672cd08cdce0b479b83ca261c0591992a84e6e7779b7";
const CANONICAL_PAYMENT_A_CLAIM_BLOCK = 13_704_626;

const CANONICAL_PAYMENT_B_ID =
  "0x7e0d3d4225351e4436e7b5b62c28412fb2b876ab904dda8a51c0be19aeba134";
const CANONICAL_PAYMENT_B_CREATE_HASH =
  "0x2f2f88ab25f64a619aa05dcaff7c2af85efc6cd086a229696ac8edc3bdd6d26";
const CANONICAL_PAYMENT_B_CREATE_BLOCK = 13_707_204;
const CANONICAL_PAYMENT_B_REFUND_HASH =
  "0x64cfec311d340f97fb0d9245de01ab36f3267259ac162290265e55ca99dd88d";
const CANONICAL_PAYMENT_B_REFUND_BLOCK = 13_708_549;

const CANONICAL_LIABILITY_BLOCK = 13_708_549;
const CANONICAL_LIABILITY_VALUE = "0 STRK";

function read(relativePath) {
  return readFileSync(resolve(repositoryRoot, relativePath), "utf8");
}

function readConsoleSources(directory = resolve(repositoryRoot, "src/app/console")) {
  const sources = [];
  if (!existsSync(directory)) return sources;

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      sources.push(...readConsoleSources(absolutePath));
    } else if (/\.[cm]?[jt]sx?$/.test(entry.name)) {
      sources.push({
        path: absolutePath.slice(repositoryRoot.length + 1),
        source: readFileSync(absolutePath, "utf8"),
      });
    }
  }

  return sources;
}

test("Phase 1: /console route and components exist", () => {
  const requiredFiles = [
    "src/app/console/layout.tsx",
    "src/app/console/page.tsx",
    "src/app/console/console.module.css",
    "src/app/console/_components/ConsoleShell.tsx",
    "src/app/console/_components/VerifiedDemo.tsx",
    "src/app/console/_components/verifiedDemoEvidence.ts",
  ];

  for (const file of requiredFiles) {
    assert.equal(
      existsSync(resolve(repositoryRoot, file)),
      true,
      `${file} must exist`,
    );
  }
});

test("Phase 1: Verified Demo evidence matches exact independent canonical Mainnet constants", async () => {
  const evidence = await import("../src/app/console/_components/verifiedDemoEvidence.ts");

  // Contract Addresses & Token
  assert.equal(evidence.CONDITIONAL_PAY_CONTRACT, CANONICAL_CONDITIONAL_PAY_CONTRACT);
  assert.equal(evidence.STRK20_POOL_CONTRACT, CANONICAL_STRK20_POOL_CONTRACT);
  assert.equal(evidence.STRK_TOKEN_ADDRESS, CANONICAL_STRK_TOKEN);

  // Terminal Block & Liability Proof
  assert.equal(evidence.EVIDENCE_TERMINAL_BLOCK, CANONICAL_LIABILITY_BLOCK);
  assert.equal(evidence.EVIDENCE_LIABILITY_PROOF.block, CANONICAL_LIABILITY_BLOCK);
  assert.equal(evidence.EVIDENCE_LIABILITY_PROOF.value, CANONICAL_LIABILITY_VALUE);

  // Payment A
  assert.equal(evidence.EVIDENCE_PAYMENT_A.paymentId, CANONICAL_PAYMENT_A_ID);
  assert.equal(evidence.EVIDENCE_PAYMENT_A.terminalState, "CLAIMED");
  assert.equal(evidence.EVIDENCE_PAYMENT_A.createTx.hash, CANONICAL_PAYMENT_A_CREATE_HASH);
  assert.equal(evidence.EVIDENCE_PAYMENT_A.createTx.block, CANONICAL_PAYMENT_A_CREATE_BLOCK);
  assert.equal(evidence.EVIDENCE_PAYMENT_A.createTx.phase, "CREATE");
  assert.equal(evidence.EVIDENCE_PAYMENT_A.createTx.txName, "TX1");
  assert.equal(
    evidence.EVIDENCE_PAYMENT_A.createTx.voyagerUrl,
    `https://voyager.online/tx/${CANONICAL_PAYMENT_A_CREATE_HASH}`,
  );
  assert.equal(evidence.EVIDENCE_PAYMENT_A.settleTx.hash, CANONICAL_PAYMENT_A_CLAIM_HASH);
  assert.equal(evidence.EVIDENCE_PAYMENT_A.settleTx.block, CANONICAL_PAYMENT_A_CLAIM_BLOCK);
  assert.equal(evidence.EVIDENCE_PAYMENT_A.settleTx.phase, "CLAIM");
  assert.equal(evidence.EVIDENCE_PAYMENT_A.settleTx.txName, "TX2");
  assert.equal(
    evidence.EVIDENCE_PAYMENT_A.settleTx.voyagerUrl,
    `https://voyager.online/tx/${CANONICAL_PAYMENT_A_CLAIM_HASH}`,
  );

  // Payment B
  assert.equal(evidence.EVIDENCE_PAYMENT_B.paymentId, CANONICAL_PAYMENT_B_ID);
  assert.equal(evidence.EVIDENCE_PAYMENT_B.terminalState, "REFUNDED");
  assert.equal(evidence.EVIDENCE_PAYMENT_B.createTx.hash, CANONICAL_PAYMENT_B_CREATE_HASH);
  assert.equal(evidence.EVIDENCE_PAYMENT_B.createTx.block, CANONICAL_PAYMENT_B_CREATE_BLOCK);
  assert.equal(evidence.EVIDENCE_PAYMENT_B.createTx.phase, "CREATE");
  assert.equal(evidence.EVIDENCE_PAYMENT_B.createTx.txName, "TX3");
  assert.equal(
    evidence.EVIDENCE_PAYMENT_B.createTx.voyagerUrl,
    `https://voyager.online/tx/${CANONICAL_PAYMENT_B_CREATE_HASH}`,
  );
  assert.equal(evidence.EVIDENCE_PAYMENT_B.settleTx.hash, CANONICAL_PAYMENT_B_REFUND_HASH);
  assert.equal(evidence.EVIDENCE_PAYMENT_B.settleTx.block, CANONICAL_PAYMENT_B_REFUND_BLOCK);
  assert.equal(evidence.EVIDENCE_PAYMENT_B.settleTx.phase, "REFUND");
  assert.equal(evidence.EVIDENCE_PAYMENT_B.settleTx.txName, "TX4");
  assert.equal(
    evidence.EVIDENCE_PAYMENT_B.settleTx.voyagerUrl,
    `https://voyager.online/tx/${CANONICAL_PAYMENT_B_REFUND_HASH}`,
  );

  // Cross-Transaction Uniqueness Assertions
  assert.notEqual(
    evidence.EVIDENCE_PAYMENT_A.createTx.hash,
    evidence.EVIDENCE_PAYMENT_B.createTx.hash,
    "Payment A CREATE must not equal Payment B CREATE",
  );
  assert.notEqual(
    evidence.EVIDENCE_PAYMENT_A.paymentId,
    evidence.EVIDENCE_PAYMENT_B.paymentId,
    "Payment A ID must not equal Payment B ID",
  );

  const allHashes = [
    evidence.EVIDENCE_PAYMENT_A.createTx.hash,
    evidence.EVIDENCE_PAYMENT_A.settleTx.hash,
    evidence.EVIDENCE_PAYMENT_B.createTx.hash,
    evidence.EVIDENCE_PAYMENT_B.settleTx.hash,
  ];
  assert.equal(new Set(allHashes).size, 4, "All 4 transaction hashes must be strictly unique");

  const allBlocks = [
    evidence.EVIDENCE_PAYMENT_A.createTx.block,
    evidence.EVIDENCE_PAYMENT_A.settleTx.block,
    evidence.EVIDENCE_PAYMENT_B.createTx.block,
    evidence.EVIDENCE_PAYMENT_B.settleTx.block,
  ];
  assert.equal(new Set(allBlocks).size, 4, "All 4 block numbers must be distinct historical milestones");
});

test("Phase 1: strk20.json matches canonical contract and qualifying transactions exactly", () => {
  const strk20 = JSON.parse(read("strk20.json"));

  assert.deepEqual(strk20.contracts, [CANONICAL_CONDITIONAL_PAY_CONTRACT]);
  assert.deepEqual(strk20.transactions, [
    "0x37b475d725258586de2db0ce2e6089585589c19658eb5142a1f1a555ddb555f",
    CANONICAL_PAYMENT_A_CLAIM_HASH,
    "0x441b1912620f38de58222ab3b8acc562d1c3d157f4f85a695e3042a969974aa",
  ]);
});

test("Phase 1: Evidence Payment IDs are confined strictly to verifiedDemoEvidence.ts", () => {
  const evidencePaymentIds = [CANONICAL_PAYMENT_A_ID, CANONICAL_PAYMENT_B_ID];

  for (const { path, source } of readConsoleSources()) {
    if (path.includes("verifiedDemoEvidence")) continue;
    for (const paymentId of evidencePaymentIds) {
      assert.equal(
        source.includes(paymentId),
        false,
        `${path} must not contain evidence payment ID ${paymentId}`,
      );
    }
  }
});

test("Phase 1: Console is read-only and contains no write builders or wallet execution", () => {
  const forbiddenWriteMethods = [
    "strk20InvokeTransaction",
    "buildCreateActions",
    "buildClaimActions",
    "buildRefundActions",
    "account.execute",
    "SelectWallet",
    "generateSecurePreimage",
    "generateSecureNonce",
    "localStorage",
    "sessionStorage",
  ];

  const phase1Sources = readConsoleSources().filter(
    ({ path }) =>
      path.includes("VerifiedDemo") ||
      path.includes("verifiedDemoEvidence") ||
      path.endsWith("console/page.tsx") ||
      path.endsWith("console/layout.tsx"),
  );

  for (const { path, source } of phase1Sources) {
    for (const forbidden of forbiddenWriteMethods) {
      assert.equal(
        source.includes(forbidden),
        false,
        `${path} must not contain write/wallet method '${forbidden}' in Phase 1`,
      );
    }
  }
});

test("Phase 1: VerifiedDemo supports reduced motion, degradation wording, and clean simplicity-first structure", () => {
  const demoSource = read("src/app/console/_components/VerifiedDemo.tsx");
  const shellSource = read("src/app/console/_components/ConsoleShell.tsx");

  // Reduced motion and animation safety
  assert.match(demoSource, /prefers-reduced-motion/);
  assert.match(demoSource, /cancelActiveAnimation/);
  assert.match(demoSource, /clearTimeout/);
  assert.doesNotMatch(demoSource, /setInterval/); // No auto-loop polling

  // Live read-only RPC verification & graceful degradation
  assert.match(demoSource, /getPayment/);
  assert.match(demoSource, /get_locked_by_token/);
  assert.doesNotMatch(demoSource, /Live verification unavailable/);
  assert.doesNotMatch(demoSource, /Historical record verified/);
  assert.doesNotMatch(demoSource, /WalletConnect/);
  assert.doesNotMatch(demoSource, /requireWallet/);
  assert.doesNotMatch(demoSource, /isConnected/);

  // Shell header and navigation
  assert.match(shellSource, /href="\/"/);
  assert.match(shellSource, /Mainnet/);
  assert.doesNotMatch(shellSource, /← Protocol/);
  assert.doesNotMatch(shellSource, /LIVE/);
  assert.doesNotMatch(shellSource, /Read-Only Verified Mode/);
  assert.match(shellSource, /#verified-demo/);
  assert.match(shellSource, /hashchange/);

  // No implementation phase labels in ConsoleShell
  assert.doesNotMatch(shellSource, /Phase 4/);
  assert.doesNotMatch(shellSource, /Phase 5/);

  // Tightened lifecycle copy
  assert.match(demoSource, /Before CREATE/);
  assert.match(demoSource, /locked in ConditionalPay/);
  assert.match(demoSource, /Settled into shielded STRK20 note/);
  assert.match(demoSource, /Returned into shielded STRK20 note/);

  // Refined section headers and conditions
  assert.match(demoSource, /MAINNET TRANSACTIONS/);
  assert.match(demoSource, /CONDITIONS/);
  assert.match(demoSource, /HISTORICAL LIABILITY/);
  assert.match(demoSource, /PRIVACY BOUNDARY/);
  assert.match(
    demoSource,
    /Creator, claimant and refunder addresses are not stored in ConditionalPay state\./,
  );
  assert.doesNotMatch(demoSource, /Privacy model/);
});
