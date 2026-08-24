import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(testDirectory, "..");

function read(relativePath) {
  return readFileSync(resolve(repositoryRoot, relativePath), "utf8");
}

test("Phase 2: Root Header includes only Launch Console CTA", () => {
  const headerSource = read("src/app/components/client/Header.tsx");

  assert.match(headerSource, /href="\/console"/);
  assert.match(headerSource, /Launch Console/);
  assert.match(headerSource, /headerConsoleCta/);
  assert.doesNotMatch(headerSource, /href=".*github\.com"/i);
  assert.doesNotMatch(headerSource, />GitHub</);
});

test("Phase 2: Footer includes GitHub icon link and animated Back-to-Top link", () => {
  const pageSource = read("src/app/page.tsx");
  const cssSource = read("src/app/uni.module.css");

  assert.match(pageSource, /footerActions/);
  assert.match(pageSource, /footerIconLink/);
  assert.match(pageSource, /backToTopLink/);
  assert.match(pageSource, /GitHubIcon/);
  assert.match(pageSource, /ArrowUpIcon/);
  assert.match(pageSource, /aria-label="GitHub repository"/);
  assert.match(pageSource, /aria-label="Back to top"/);

  assert.match(cssSource, /\.footerActions/);
  assert.match(cssSource, /\.footerIconLink/);
  assert.match(cssSource, /\.backToTopLink/);
  assert.match(cssSource, /\.backToTopLink:hover svg\s*\{\s*transform:\s*translateY\(-2\.5px\);/);
});

test("Phase 2: Root route / remains strictly read-only with zero wallet/write/credential imports", () => {
  const forbiddenExecutionMethods = [
    "SelectWallet",
    "WalletConnect",
    "walletContext",
    "strk20InvokeTransaction",
    "buildCreateActions",
    "buildClaimActions",
    "buildRefundActions",
    "generateSecurePreimage",
    "generateSecureNonce",
    "exportEncryptedCredentials",
    "importEncryptedCredentials",
    "importSinglePaymentCredentials",
    "exportSinglePaymentCredentials",
    "localStorage",
    "sessionStorage",
    "@conditionalpay/sdk",
    "console/",
  ];

  const rootFiles = [
    "src/app/page.tsx",
    "src/app/layout.tsx",
    "src/app/components/client/Header.tsx",
  ];

  for (const relativePath of rootFiles) {
    const source = read(relativePath);
    for (const forbidden of forbiddenExecutionMethods) {
      assert.equal(
        source.includes(forbidden),
        false,
        `${relativePath} must not contain forbidden write/wallet/credential keyword '${forbidden}'`,
      );
    }
  }
});

test("Phase 2: Console shell and hash navigation support /console and /console#verified-demo deep-links", () => {
  const shellSource = read("src/app/console/_components/ConsoleShell.tsx");

  assert.match(shellSource, /#verified-demo/);
  assert.match(shellSource, /hashchange/);
  assert.match(shellSource, /syncHash/);
});
