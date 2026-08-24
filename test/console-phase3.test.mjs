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

test("Phase 3: WalletConnect component exists and is mounted in ConsoleShell", () => {
  const walletConnectPath = "src/app/console/_components/WalletConnect.tsx";
  assert.equal(
    existsSync(resolve(repositoryRoot, walletConnectPath)),
    true,
    "WalletConnect.tsx must exist under src/app/console/_components/",
  );

  const shellSource = read("src/app/console/_components/ConsoleShell.tsx");
  assert.match(shellSource, /import WalletConnect from '\.\/WalletConnect'/);
  assert.match(shellSource, /<WalletConnect \/>/);
});

test("Phase 3: Root route remains strictly isolated from wallet code", () => {
  const pageSource = read("src/app/page.tsx");
  const layoutSource = read("src/app/layout.tsx");
  const headerSource = read("src/app/components/client/Header.tsx");

  const forbiddenWalletKeywords = [
    "WalletConnect",
    "requestAccounts",
    "supportedWalletApi",
    "supportedSpecs",
    "getDiscoveryStore",
    "strk20Balances",
    "walletV6",
  ];

  for (const keyword of forbiddenWalletKeywords) {
    assert.equal(
      pageSource.includes(keyword),
      false,
      `root page.tsx must not contain '${keyword}'`,
    );
    assert.equal(
      layoutSource.includes(keyword),
      false,
      `root layout.tsx must not contain '${keyword}'`,
    );
    assert.equal(
      headerSource.includes(keyword),
      false,
      `root Header.tsx must not contain '${keyword}'`,
    );
  }
});

test("Phase 3: Ready Wallet is the only targeted wallet; no other wallets advertised", () => {
  const connectSource = read("src/app/console/_components/WalletConnect.tsx");

  assert.match(connectSource, /Ready Wallet/);
  assert.match(connectSource, /isReadyWallet/);

  // Must not advertise competitors in UI
  assert.doesNotMatch(connectSource, /Argent X/i);
  assert.doesNotMatch(connectSource, /Braavos/i);
  assert.doesNotMatch(connectSource, /MetaMask/i);
  assert.doesNotMatch(connectSource, /Xverse/i);
});

test("Phase 3: Wallet connection requires explicit user action and executes no automatic requests on mount", () => {
  const connectSource = read("src/app/console/_components/WalletConnect.tsx");

  // Mount effect only subscribes to discovery store
  assert.match(connectSource, /store\.subscribe/);
  assert.doesNotMatch(connectSource, /useEffect\(\s*\(\)\s*=>\s*\{\s*handleConnect/);
  assert.doesNotMatch(connectSource, /useEffect\(\s*\(\)\s*=>\s*\{\s*walletV6\.requestAccounts/);

  // Explicit click handler initiates requestAccounts
  assert.match(connectSource, /onClick=\{handleConnect\}/);
  assert.match(connectSource, /walletV6\.requestAccounts/);
});

test("Phase 3: Zero transaction execution, signing, or write builders present in Console", () => {
  const forbiddenExecutionKeywords = [
    "strk20InvokeTransaction",
    "account.execute",
    "buildCreateActions",
    "buildClaimActions",
    "buildRefundActions",
    "generateSecurePreimage",
    "generateSecureNonce",
    "exportEncryptedCredentials",
    "importEncryptedCredentials",
    "importSinglePaymentCredentials",
    "exportSinglePaymentCredentials",
  ];

  for (const { path, source } of readConsoleSources()) {
    for (const forbidden of forbiddenExecutionKeywords) {
      assert.equal(
        source.includes(forbidden),
        false,
        `${path} must not contain forbidden write method '${forbidden}' in Phase 3`,
      );
    }
  }
});

test("Phase 3: No browser persistence (localStorage / sessionStorage) in Console", () => {
  for (const { path, source } of readConsoleSources()) {
    assert.equal(
      source.includes("localStorage"),
      false,
      `${path} must not access localStorage`,
    );
    assert.equal(
      source.includes("sessionStorage"),
      false,
      `${path} must not access sessionStorage`,
    );
  }
});

test("Phase 3: Mainnet chain verification exists and enforces Starknet Mainnet", () => {
  const connectSource = read("src/app/console/_components/WalletConnect.tsx");

  assert.match(connectSource, /SNconstants\.StarknetChainId\.SN_MAIN/);
  assert.match(connectSource, /0x534e5f4d41494e/);
  assert.match(connectSource, /WRONG_NETWORK/);
  assert.match(
    connectSource,
    /Wrong network\. Switch Ready Wallet to Starknet Mainnet\./,
  );
});

test("Phase 3: Wallet capability and privacy registration remain distinct states", () => {
  const connectSource = read("src/app/console/_components/WalletConnect.tsx");

  // Distinct types and states
  assert.match(connectSource, /export type WalletCapability = 'UNKNOWN' | 'SUPPORTED' | 'UNSUPPORTED'/);
  assert.match(connectSource, /export type PrivacyRegistration = 'UNKNOWN' | 'READY' | 'NOT_REGISTERED'/);
  assert.match(connectSource, /supportedWalletApi/);
  assert.match(connectSource, /setCapability/);
  assert.match(connectSource, /setPrivacyStatus/);
});

test("Phase 3: 10-block maturity constant and message remain exact", () => {
  const connectSource = read("src/app/console/_components/WalletConnect.tsx");

  assert.match(connectSource, /export const REQUIRED_NOTE_CONFIRMATIONS = 10;/);
  assert.match(connectSource, /export const NOTE_MATURITY_MESSAGE = 'Requires 10 block confirmations\.';/);
});

test("Phase 3: Verified Demo remains usable without a wallet and contains no wallet blocker", () => {
  const demoSource = read("src/app/console/_components/VerifiedDemo.tsx");

  assert.doesNotMatch(demoSource, /WalletConnect/);
  assert.doesNotMatch(demoSource, /requireWallet/);
  assert.doesNotMatch(demoSource, /isConnected/);
  assert.match(demoSource, /Real Mainnet transactions/);
  assert.match(demoSource, /No wallet required/);
});

test("Phase 3: No secret collection (private keys, recovery phrase, seed phrase) UI exists", () => {
  for (const { source } of readConsoleSources()) {
    assert.doesNotMatch(source, /private key/i);
    assert.doesNotMatch(source, /seed phrase/i);
    assert.doesNotMatch(source, /recovery phrase/i);
    assert.doesNotMatch(source, /mnemonic/i);
  }
});
