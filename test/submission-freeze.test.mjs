import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(testDirectory, "..");

function read(relativePath) {
  return readFileSync(resolve(repositoryRoot, relativePath), "utf8");
}

function readProductionSources(directory = resolve(repositoryRoot, "src")) {
  const sources = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      sources.push(...readProductionSources(absolutePath));
    } else if (/\.[cm]?[jt]sx?$/.test(entry.name)) {
      sources.push({
        path: absolutePath.slice(repositoryRoot.length + 1),
        source: readFileSync(absolutePath, "utf8"),
      });
    }
  }

  return sources;
}

test("root route imports no wallet or Console execution boundary", () => {
  const page = read("src/app/page.tsx");
  const layout = read("src/app/layout.tsx");

  for (const forbidden of [
    "SelectWallet",
    "WalletConnect",
    "strk20InvokeTransaction",
    "buildCreateActions",
    "buildClaimActions",
    "buildRefundActions",
    "generateSecurePreimage",
    "generateSecureNonce",
    "walletContext",
    "console/",
    "@conditionalpay/sdk",
  ]) {
    assert.equal(
      page.includes(forbidden),
      false,
      `root page.tsx must not contain '${forbidden}'`,
    );
  }

  for (const forbidden of [
    "walletContext",
    "WalletAccountV6",
    "SelectWallet",
    "WalletConnect",
  ]) {
    assert.equal(
      layout.includes(forbidden),
      false,
      `root layout.tsx must not contain '${forbidden}'`,
    );
  }
});

test("submission interactions gate optional motion and identify the private workspace SDK", () => {
  const settlementInstrument = read(
    "src/app/components/product/SettlementInstrument.tsx",
  );
  const codeWorkspace = read("src/app/components/product/CodeWorkspace.tsx");
  const styles = read("src/app/uni.module.css");

  assert.match(
    settlementInstrument,
    /handleSelectRoute\('claim', event\.detail > 0\)/,
  );
  assert.match(
    settlementInstrument,
    /handleSelectRoute\('refund', event\.detail > 0\)/,
  );
  assert.match(settlementInstrument, /animationTimerRef/);
  assert.match(
    settlementInstrument,
    /clearTimeout\(animationTimerRef\.current\)/,
  );
  assert.match(settlementInstrument, /return cancelActiveAnimation/);

  assert.match(codeWorkspace, /setAnimate\(event\.detail > 0\)/);
  assert.match(codeWorkspace, /Private workspace SDK/);
  assert.match(styles, /\.codeTabs\[data-motion='on'\] button \{/);
  assert.match(styles, /\.codeTabs\[data-motion='on'\] button::after \{/);

  const baseTabRule = styles.match(/\.codeTabs button \{([\s\S]*?)\}/)?.[1] ?? "";
  const baseTabIndicatorRule =
    styles.match(/\.codeTabs button::after \{([\s\S]*?)\}/)?.[1] ?? "";

  assert.doesNotMatch(baseTabRule, /transition:/);
  assert.doesNotMatch(baseTabIndicatorRule, /transition:/);
});

test("submission evidence identifies the canonical deployment and qualifying transactions", () => {
  const submission = JSON.parse(read("strk20.json"));

  assert.deepEqual(submission.contracts, [
    "0x0166e31803cfab50383d5b636b86a5646233881fad3a2fb89354da63f6cdb483",
  ]);
  assert.deepEqual(submission.transactions, [
    "0x37b475d725258586de2db0ce2e6089585589c19658eb5142a1f1a555ddb555f",
    "0xde61c431a92dabc7b8672cd08cdce0b479b83ca261c0591992a84e6e7779b7",
    "0x441b1912620f38de58222ab3b8acc562d1c3d157f4f85a695e3042a969974aa",
  ]);
  assert.equal(submission.demo_video, "");
  assert.equal(submission.demo_url, "https://conditionalpay.vercel.app");
});

test("stale evidence harness modules are absent from main", () => {
  const harnessPaths = [
    "src/app/components/client/WalletHandle/PaymentAClaimExecutionPanel.tsx",
    "src/app/components/client/WalletHandle/PaymentBCreateExecutionPanel.tsx",
    "src/app/components/client/WalletHandle/PaymentBRefundExecutionPanel.tsx",
    "src/app/components/client/WalletHandle/paymentAClaimExecution.ts",
    "src/app/components/client/WalletHandle/paymentBCreateExecution.ts",
    "src/app/components/client/WalletHandle/paymentBRefundExecution.ts",
    "src/app/components/client/WalletHandle/paymentBTx3Configuration.ts",
  ];

  for (const path of harnessPaths) {
    assert.equal(
      existsSync(resolve(repositoryRoot, path)),
      false,
      `${path} must not exist in the production tree`,
    );
  }
});

test("completed evidence Payment IDs are confined to verifiedDemoEvidence.ts", () => {
  const evidencePaymentIds = [
    "0x19b3f6176561b6054a803a0d499c73252413eaa8756dda3990f605ef9273ac3",
    "0x7e0d3d4225351e4436e7b5b62c28412fb2b876ab904dda8a51c0be19aeba134",
  ];

  for (const { path, source } of readProductionSources()) {
    if (path.includes("verifiedDemoEvidence")) continue;
    for (const paymentId of evidencePaymentIds) {
      assert.equal(
        source.includes(paymentId),
        false,
        `${path} must not contain completed evidence Payment ID ${paymentId}`,
      );
    }
  }
});

test("production source contains no evidence recovery machinery or browser secret persistence", () => {
  const forbiddenPatterns = [
    {
      label: "Payment A evidence recovery envelope",
      pattern: /payment-a-19b3f6176561\.encrypted\.json/i,
    },
    {
      label: "Payment B evidence recovery envelope",
      pattern: /payment-b-7e0d3d422535\.encrypted\.json/i,
    },
    {
      label: "plaintext passphrase file reference",
      pattern: /["'`][^"'`\n]*\.passphrase["'`]/i,
    },
    {
      label: "hardcoded passphrase literal in source",
      pattern: /(?:passphrase|password)\s*[:=]\s*["'`][^"'`\n]{8,}["'`]/i,
    },
    {
      label: "credential or preimage logging in source",
      pattern:
        /console\.(?:log|warn|error|info|debug)\s*\([^)]*\b(?:claimPreimage|refundPreimage|claim_preimage|refund_preimage|rawPreimage)\b/,
    },
    {
      label: "browser secret persistence API",
      pattern:
        /\b(?:window\.)?(?:localStorage|sessionStorage)\s*(?:\[|\.\s*(?:getItem|setItem|removeItem|clear|key)\s*\()/,
    },
  ];

  for (const { path, source } of readProductionSources()) {
    for (const { label, pattern } of forbiddenPatterns) {
      assert.doesNotMatch(source, pattern, `${path} must not contain ${label}`);
    }
  }
});
