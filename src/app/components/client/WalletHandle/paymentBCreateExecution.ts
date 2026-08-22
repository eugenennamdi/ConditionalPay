import {
  PaymentState,
  buildCreateActions,
  computePaymentId,
  getLockedByToken,
  getPayment,
  getStrk20Pool,
} from "@conditionalpay/sdk";
import type { STRK20_ACTION } from "starknet";

export const PAYMENT_B_AMOUNT = 100000000000000000n;
export const TX3_MINIMUM_EXPIRY_MARGIN_SECONDS = 5n * 60n;

export interface PaymentBTx3Configuration {
  paymentId: string;
  token: string;
  amount: string;
  hashlock: string;
  refundHash: string;
  nonce: string;
  generatedAtUnix: string;
  expiresAtUnix: string;
  envelopeFilename: string;
  recoveryRoundtripVerified: true;
}

export interface PaymentBReadProvider {
  callContract(
    call: { contractAddress: string; entrypoint: string; calldata?: string[] },
    blockIdentifier?: unknown,
  ): Promise<string[]>;
  getBlockNumber(): Promise<number>;
  getBlock(blockIdentifier: "latest"): Promise<{ timestamp: number }>;
}

export interface PaymentBCreateReadiness {
  paymentId: string;
  paymentState: "UNINITIALIZED";
  paymentToken: string;
  paymentAmount: string;
  generatedAtUnix: string;
  expiresAtUnix: string;
  currentBlock: number;
  latestBlockTimestamp: string;
  checkedAtUnix: string;
  remainingSeconds: string;
  lockedLiability: "0";
  feeWei: string;
  actionTopology: readonly ["withdraw", "invoke"];
  invokeCount: 1;
  invokeFinal: true;
  canonicalSerializationPassed: true;
  recoveryRoundtripVerified: true;
  envelopeFilename: string;
}

export interface PaymentBBaseReadiness {
  network: "MAINNET";
  currentBlock: number;
  checkedAtUnix: string;
  lockedLiability: string;
  feeWei: string;
}

export interface PreparedPaymentBCreate {
  actions: STRK20_ACTION[];
  readiness: PaymentBCreateReadiness;
}

export type PaymentBCreateErrorCode =
  | "CONFIGURATION_INVALID"
  | "NETWORK_NOT_MAINNET"
  | "PAYMENT_NOT_UNINITIALIZED"
  | "LIABILITY_NOT_ZERO"
  | "EXPIRY_MARGIN_TOO_LOW"
  | "INVALID_ACTIONS"
  | "RPC_REJECTED";

export class PaymentBCreateError extends Error {
  readonly code: PaymentBCreateErrorCode;

  constructor(code: PaymentBCreateErrorCode, safeMessage: string) {
    super(safeMessage);
    this.name = "PaymentBCreateError";
    this.code = code;
  }
}

export function isResolvedMainnetNetwork(networkName: string | undefined): boolean {
  return networkName === "MAINNET";
}

export function safePaymentBCreateMessage(error: unknown): string {
  if (!(error instanceof PaymentBCreateError)) {
    return "TX3 readiness failed without exposing recovery material.";
  }
  switch (error.code) {
    case "CONFIGURATION_INVALID":
      return "Payment B public configuration is invalid.";
    case "NETWORK_NOT_MAINNET":
      return "TX3 is restricted to Starknet Mainnet.";
    case "PAYMENT_NOT_UNINITIALIZED":
      return "Payment B is no longer UNINITIALIZED.";
    case "LIABILITY_NOT_ZERO":
      return "ConditionalPay currently has a non-zero STRK liability.";
    case "EXPIRY_MARGIN_TOO_LOW":
      return "Payment B has less than five minutes remaining; execution is disabled.";
    case "INVALID_ACTIONS":
      return "The canonical CREATE payload failed validation.";
    case "RPC_REJECTED":
      return "Mainnet readiness checks could not be completed.";
  }
}

export async function runPaymentBReadinessRefresh<T>(input: {
  read: () => Promise<T>;
  onChecking: () => void;
  onReady: (value: T) => void;
  onError: (error: unknown) => void;
}): Promise<void> {
  input.onChecking();
  try {
    input.onReady(await input.read());
  } catch (error) {
    input.onError(error);
  }
}

const walletApiFelt = /^0x(0|[a-fA-F1-9][a-fA-F0-9]{0,62})$/;

function sameFelt(left: string, right: string): boolean {
  try {
    return BigInt(left) === BigInt(right);
  } catch {
    return false;
  }
}

function createParams(configuration: PaymentBTx3Configuration) {
  return {
    token: configuration.token,
    amount: BigInt(configuration.amount),
    hashlock: configuration.hashlock,
    refund_hash: configuration.refundHash,
    claim_after: 0n,
    expires_at: BigInt(configuration.expiresAtUnix),
    approver: "0x0",
    nonce: configuration.nonce,
  };
}

function validateConfiguration(configuration: PaymentBTx3Configuration): void {
  let recomputedPaymentId: string;
  try {
    if (
      BigInt(configuration.amount) !== PAYMENT_B_AMOUNT ||
      BigInt(configuration.generatedAtUnix) + 15n * 60n !== BigInt(configuration.expiresAtUnix) ||
      !configuration.envelopeFilename.startsWith("payment-b-") ||
      !configuration.envelopeFilename.endsWith(".encrypted.json") ||
      configuration.recoveryRoundtripVerified !== true
    ) {
      throw new Error("invalid public configuration");
    }
    recomputedPaymentId = computePaymentId(createParams(configuration));
  } catch {
    throw new PaymentBCreateError(
      "CONFIGURATION_INVALID",
      "Payment B public configuration failed validation.",
    );
  }
  if (!sameFelt(recomputedPaymentId, configuration.paymentId)) {
    throw new PaymentBCreateError(
      "CONFIGURATION_INVALID",
      "Payment B ID does not match its public configuration.",
    );
  }
}

function assertCreateTopology(
  actions: STRK20_ACTION[],
  conditionalPay: string,
  configuration: PaymentBTx3Configuration,
): void {
  if (
    actions.length !== 2 ||
    actions[0].type !== "withdraw" ||
    actions[1].type !== "invoke" ||
    actions.filter((action) => action.type === "invoke").length !== 1 ||
    actions.at(-1)?.type !== "invoke"
  ) {
    throw new PaymentBCreateError("INVALID_ACTIONS", "Canonical CREATE topology failed.");
  }

  const [withdraw, invoke] = actions;
  if (
    !sameFelt(withdraw.token, configuration.token) ||
    BigInt(withdraw.amount) !== PAYMENT_B_AMOUNT ||
    !sameFelt(withdraw.recipient, conditionalPay) ||
    !sameFelt(invoke.contract, conditionalPay) ||
    invoke.calldata.length !== 9 ||
    invoke.calldata[0] !== "0x0" ||
    !sameFelt(invoke.calldata[1], configuration.token) ||
    BigInt(invoke.calldata[2]) !== PAYMENT_B_AMOUNT ||
    !sameFelt(invoke.calldata[3], configuration.hashlock) ||
    !sameFelt(invoke.calldata[4], configuration.refundHash) ||
    invoke.calldata[5] !== "0x0" ||
    BigInt(invoke.calldata[6]) !== BigInt(configuration.expiresAtUnix) ||
    invoke.calldata[7] !== "0x0" ||
    !sameFelt(invoke.calldata[8], configuration.nonce) ||
    actions.some((action) => action.type === "deposit" || action.type === "transfer")
  ) {
    throw new PaymentBCreateError("INVALID_ACTIONS", "Canonical CREATE payload failed validation.");
  }

  const numericFelts = [
    withdraw.token,
    withdraw.amount,
    withdraw.recipient,
    invoke.contract,
    ...invoke.calldata,
  ];
  if (!numericFelts.every((felt) => walletApiFelt.test(felt))) {
    throw new PaymentBCreateError("INVALID_ACTIONS", "Wallet API felt canonicalization failed.");
  }
}

async function queryReadiness(input: {
  provider: PaymentBReadProvider;
  conditionalPay: string;
  configuration: PaymentBTx3Configuration;
  isMainnet: boolean;
  nowUnix: bigint;
}): Promise<Omit<PaymentBCreateReadiness, "actionTopology" | "invokeCount" | "invokeFinal" | "canonicalSerializationPassed">> {
  if (!input.isMainnet) {
    throw new PaymentBCreateError("NETWORK_NOT_MAINNET", "TX3 is restricted to Starknet Mainnet.");
  }

  let payment: Awaited<ReturnType<typeof getPayment>>;
  let locked: bigint;
  let feeRaw: string[];
  let latestBlock: { timestamp: number };
  let currentBlock: number;
  try {
    const pool = await getStrk20Pool(input.provider, input.conditionalPay, "latest");
    [payment, locked, feeRaw, latestBlock, currentBlock] = await Promise.all([
      getPayment(input.provider, input.conditionalPay, input.configuration.paymentId, "latest"),
      getLockedByToken(input.provider, input.conditionalPay, input.configuration.token, "latest"),
      input.provider.callContract(
        { contractAddress: pool, entrypoint: "get_fee_amount", calldata: [] },
        "latest",
      ),
      input.provider.getBlock("latest"),
      input.provider.getBlockNumber(),
    ]);
  } catch (error) {
    if (error instanceof PaymentBCreateError) throw error;
    throw new PaymentBCreateError("RPC_REJECTED", "Mainnet TX3 readiness checks failed.");
  }

  if (payment.state !== PaymentState.UNINITIALIZED) {
    throw new PaymentBCreateError(
      "PAYMENT_NOT_UNINITIALIZED",
      "Payment B is no longer UNINITIALIZED.",
    );
  }
  if (locked !== 0n) {
    throw new PaymentBCreateError("LIABILITY_NOT_ZERO", "ConditionalPay liability is not zero.");
  }
  if (feeRaw.length !== 1) {
    throw new PaymentBCreateError("RPC_REJECTED", "The STRK20 fee response was invalid.");
  }

  const expiresAt = BigInt(input.configuration.expiresAtUnix);
  const remainingLocal = expiresAt - input.nowUnix;
  const remainingBlock = expiresAt - BigInt(latestBlock.timestamp);
  const remainingSeconds = remainingLocal < remainingBlock ? remainingLocal : remainingBlock;
  if (remainingSeconds < TX3_MINIMUM_EXPIRY_MARGIN_SECONDS) {
    throw new PaymentBCreateError(
      "EXPIRY_MARGIN_TOO_LOW",
      "Payment B has less than five minutes of expiry safety margin.",
    );
  }

  return {
    paymentId: input.configuration.paymentId,
    paymentState: "UNINITIALIZED",
    paymentToken: input.configuration.token,
    paymentAmount: input.configuration.amount,
    generatedAtUnix: input.configuration.generatedAtUnix,
    expiresAtUnix: input.configuration.expiresAtUnix,
    currentBlock,
    latestBlockTimestamp: String(latestBlock.timestamp),
    checkedAtUnix: input.nowUnix.toString(),
    remainingSeconds: remainingSeconds.toString(),
    lockedLiability: "0",
    feeWei: BigInt(feeRaw[0]).toString(),
    recoveryRoundtripVerified: true,
    envelopeFilename: input.configuration.envelopeFilename,
  };
}

export async function queryPaymentBBaseReadiness(input: {
  provider: PaymentBReadProvider;
  conditionalPay: string;
  token: string;
  isMainnet: boolean;
  nowUnix?: bigint;
}): Promise<PaymentBBaseReadiness> {
  if (!input.isMainnet) {
    throw new PaymentBCreateError("NETWORK_NOT_MAINNET", "TX3 is restricted to Starknet Mainnet.");
  }

  let locked: bigint;
  let feeRaw: string[];
  let currentBlock: number;
  try {
    const pool = await getStrk20Pool(input.provider, input.conditionalPay, "latest");
    [locked, feeRaw, currentBlock] = await Promise.all([
      getLockedByToken(input.provider, input.conditionalPay, input.token, "latest"),
      input.provider.callContract(
        { contractAddress: pool, entrypoint: "get_fee_amount", calldata: [] },
        "latest",
      ),
      input.provider.getBlockNumber(),
    ]);
  } catch {
    throw new PaymentBCreateError("RPC_REJECTED", "Mainnet TX3 readiness checks failed.");
  }
  if (feeRaw.length !== 1) {
    throw new PaymentBCreateError("RPC_REJECTED", "The STRK20 fee response was invalid.");
  }

  return {
    network: "MAINNET",
    currentBlock,
    checkedAtUnix: (input.nowUnix ?? BigInt(Math.floor(Date.now() / 1000))).toString(),
    lockedLiability: locked.toString(),
    feeWei: BigInt(feeRaw[0]).toString(),
  };
}

export async function preparePaymentBCreate(input: {
  provider: PaymentBReadProvider;
  conditionalPay: string;
  configuration: PaymentBTx3Configuration;
  isMainnet: boolean;
  nowUnix?: bigint;
}): Promise<PreparedPaymentBCreate> {
  validateConfiguration(input.configuration);
  const actions = buildCreateActions(input.conditionalPay, createParams(input.configuration));
  assertCreateTopology(actions, input.conditionalPay, input.configuration);
  const readiness = await queryReadiness({
    ...input,
    nowUnix: input.nowUnix ?? BigInt(Math.floor(Date.now() / 1000)),
  });
  return {
    actions,
    readiness: {
      ...readiness,
      actionTopology: ["withdraw", "invoke"],
      invokeCount: 1,
      invokeFinal: true,
      canonicalSerializationPassed: true,
    },
  };
}

export async function revalidatePaymentBCreate(input: {
  provider: PaymentBReadProvider;
  conditionalPay: string;
  configuration: PaymentBTx3Configuration;
  previous: PaymentBCreateReadiness;
  isMainnet: boolean;
  nowUnix?: bigint;
}): Promise<PaymentBCreateReadiness> {
  const refreshed = await preparePaymentBCreate({
    provider: input.provider,
    conditionalPay: input.conditionalPay,
    configuration: input.configuration,
    isMainnet: input.isMainnet,
    nowUnix: input.nowUnix,
  });
  if (
    !sameFelt(refreshed.readiness.paymentId, input.previous.paymentId) ||
    refreshed.readiness.paymentAmount !== input.previous.paymentAmount ||
    refreshed.readiness.expiresAtUnix !== input.previous.expiresAtUnix
  ) {
    clearPaymentBCreateActions(refreshed.actions);
    throw new PaymentBCreateError(
      "CONFIGURATION_INVALID",
      "Payment B public configuration changed after preparation.",
    );
  }
  clearPaymentBCreateActions(refreshed.actions);
  return refreshed.readiness;
}

export function clearPaymentBCreateActions(actions: STRK20_ACTION[]): void {
  for (const action of actions) {
    if (action.type === "invoke") action.calldata.fill("0x0");
  }
  actions.splice(0, actions.length);
}

export interface PaymentBExecutionAttemptMutex {
  tryAcquire(): boolean;
  release(): void;
  isLocked(): boolean;
}

export function createPaymentBExecutionAttemptMutex(): PaymentBExecutionAttemptMutex {
  let locked = false;
  return {
    tryAcquire() {
      if (locked) return false;
      locked = true;
      return true;
    },
    release() {
      locked = false;
    },
    isLocked() {
      return locked;
    },
  };
}
