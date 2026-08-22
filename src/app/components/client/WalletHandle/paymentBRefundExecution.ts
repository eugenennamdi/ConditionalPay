import type { STRK20_ACTION } from "starknet";
import {
  OPEN_NOTE_ID_0,
  PaymentState,
  buildRefundActions,
  computeClaimHash,
  computePaymentId,
  computeRefundHash,
  getLockedByToken,
  getPayment,
  getStrk20Pool,
  importEncryptedCredentials,
  type EncryptedCredentialEnvelope,
} from "@conditionalpay/sdk";

export const PAYMENT_B_REFUND_EXPECTATION = {
  paymentId: "0x7e0d3d4225351e4436e7b5b62c28412fb2b876ab904dda8a51c0be19aeba134",
  token: "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
  amount: 100000000000000000n,
  refundHash: "0x3ec710a951d209164cccefccf6a77f14926ae2d32169cc6b32face0fd1495a0",
  expiresAt: 1787431718n,
  tx3Block: 13707204,
  minimumDepth: 10,
  envelopeFilename: "payment-b-7e0d3d422535.encrypted.json",
} as const;

export interface PaymentBRefundExpectation {
  paymentId: string;
  token: string;
  amount: bigint;
  refundHash: string;
  expiresAt: bigint;
  tx3Block: number;
  minimumDepth: number;
  envelopeFilename: string;
}

interface PaymentBRecoveryBundle {
  paymentB: {
    paymentId: string;
    claimPreimage: string;
    refundPreimage: string;
    nonce: string;
    expiresAt: string;
  };
}

export interface RefundReadProvider {
  callContract(
    call: { contractAddress: string; entrypoint: string; calldata?: string[] },
    blockIdentifier?: unknown,
  ): Promise<string[]>;
  getBlockNumber(): Promise<number>;
  getBlock(blockIdentifier: "latest"): Promise<{ timestamp: number }>;
}

export interface RefundReadinessSummary {
  network: "MAINNET";
  currentBlock: number;
  tx3Block: number;
  depth: number;
  latestBlockTimestamp: string;
  checkedAtUnix: string;
  paymentState: "ACTIVE";
  paymentToken: string;
  paymentAmount: string;
  refundHash: string;
  expiresAt: string;
  expiryEligible: true;
  lockedLiability: string;
  feeWei: string;
  recipient: string;
  refundHashVerificationPassed: true;
  canonicalSerializationPassed: true;
}

export interface PreparedPaymentBRefund {
  actions: STRK20_ACTION[];
  sanitizedActions: Array<Record<string, unknown>>;
  readiness: RefundReadinessSummary;
}

export type RefundPreparationErrorCode =
  | "INPUT_MISSING"
  | "ENVELOPE_PARSE_FAILED"
  | "CRYPTO_DECRYPT_FAILED"
  | "RECOVERY_SCHEMA_INVALID"
  | "PAYMENT_ID_MISMATCH"
  | "REFUND_HASH_MISMATCH"
  | "ONCHAIN_VALIDATION_MISMATCH"
  | "NETWORK_NOT_MAINNET"
  | "PAYMENT_NOT_ACTIVE"
  | "PAYMENT_NOT_EXPIRED"
  | "INSUFFICIENT_DEPTH"
  | "LIABILITY_MISMATCH"
  | "INVALID_ACTIONS"
  | "RPC_REJECTED";

export class RefundPreparationError extends Error {
  readonly code: RefundPreparationErrorCode;

  constructor(code: RefundPreparationErrorCode, safeMessage: string) {
    super(safeMessage);
    this.name = "RefundPreparationError";
    this.code = code;
  }
}

const walletApiFelt = /^0x(0|[a-fA-F1-9][a-fA-F0-9]{0,62})$/;
const envelopeHex = /^[a-fA-F0-9]+$/;

export function captureRefundRecoveryInputs<TFile>(
  readPassphrase: () => string,
  readFile: () => TFile | undefined,
  clearPreviousMaterial: () => void,
): [passphrase: string, file: TFile] {
  const passphrase = readPassphrase();
  const file = readFile();

  clearPreviousMaterial();
  if (!passphrase || !file) {
    throw new RefundPreparationError(
      "INPUT_MISSING",
      "Select the encrypted envelope and enter its passphrase.",
    );
  }
  return [passphrase, file];
}

export function parseRefundRecoveryEnvelopeText(text: string): EncryptedCredentialEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new RefundPreparationError(
      "ENVELOPE_PARSE_FAILED",
      "The selected recovery envelope is not valid JSON.",
    );
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new RefundPreparationError(
      "ENVELOPE_PARSE_FAILED",
      "The selected recovery envelope has an invalid structure.",
    );
  }
  const envelope = parsed as Partial<EncryptedCredentialEnvelope>;
  if (
    envelope.version !== "1.0" ||
    envelope.cipher !== "AES-GCM-256" ||
    envelope.kdf !== "PBKDF2-SHA256" ||
    !Number.isInteger(envelope.iterations) ||
    (envelope.iterations ?? 0) < 1000 ||
    typeof envelope.saltHex !== "string" ||
    envelope.saltHex.length !== 32 ||
    !envelopeHex.test(envelope.saltHex) ||
    typeof envelope.ivHex !== "string" ||
    envelope.ivHex.length !== 24 ||
    !envelopeHex.test(envelope.ivHex) ||
    typeof envelope.ciphertextHex !== "string" ||
    envelope.ciphertextHex.length < 32 ||
    envelope.ciphertextHex.length % 2 !== 0 ||
    !envelopeHex.test(envelope.ciphertextHex)
  ) {
    throw new RefundPreparationError(
      "ENVELOPE_PARSE_FAILED",
      "The selected recovery envelope has an invalid structure.",
    );
  }
  return envelope as EncryptedCredentialEnvelope;
}

function validateRecoverySchema(value: unknown): PaymentBRecoveryBundle {
  if (typeof value !== "object" || value === null) {
    throw new RefundPreparationError(
      "RECOVERY_SCHEMA_INVALID",
      "Decrypted recovery data has an unsupported schema.",
    );
  }
  const paymentB = (value as { paymentB?: unknown }).paymentB;
  if (typeof paymentB !== "object" || paymentB === null) {
    throw new RefundPreparationError(
      "RECOVERY_SCHEMA_INVALID",
      "Decrypted recovery data has an unsupported schema.",
    );
  }
  const candidate = paymentB as Record<string, unknown>;
  if (
    typeof candidate.paymentId !== "string" ||
    typeof candidate.claimPreimage !== "string" ||
    typeof candidate.refundPreimage !== "string" ||
    typeof candidate.nonce !== "string" ||
    typeof candidate.expiresAt !== "string"
  ) {
    throw new RefundPreparationError(
      "RECOVERY_SCHEMA_INVALID",
      "Decrypted recovery data has an unsupported schema.",
    );
  }
  return value as PaymentBRecoveryBundle;
}

function sameFelt(left: string, right: string): boolean {
  try {
    return BigInt(left) === BigInt(right);
  } catch {
    return false;
  }
}

function assertRefundTopology(
  actions: STRK20_ACTION[],
  conditionalPay: string,
  paymentId: string,
  token: string,
  recipient: string,
): void {
  if (
    actions.length !== 2 ||
    actions[0].type !== "transfer" ||
    actions[1].type !== "invoke" ||
    actions.filter((action) => action.type === "transfer").length !== 1 ||
    actions.filter((action) => action.type === "invoke").length !== 1 ||
    actions.at(-1)?.type !== "invoke"
  ) {
    throw new RefundPreparationError(
      "INVALID_ACTIONS",
      "Canonical REFUND action topology failed.",
    );
  }

  const [openTransfer, refundInvoke] = actions;
  if (
    openTransfer.amount !== "OPEN" ||
    !sameFelt(openTransfer.token, token) ||
    !sameFelt(openTransfer.recipient, recipient) ||
    !sameFelt(refundInvoke.contract, conditionalPay) ||
    refundInvoke.calldata.length !== 4 ||
    refundInvoke.calldata[0] !== "0x2" ||
    !sameFelt(refundInvoke.calldata[1], paymentId) ||
    refundInvoke.calldata[3] !== OPEN_NOTE_ID_0 ||
    actions.some((action) => action.type === "withdraw" || action.type === "deposit")
  ) {
    throw new RefundPreparationError(
      "INVALID_ACTIONS",
      "Canonical REFUND action validation failed.",
    );
  }

  const concreteFelts = [
    openTransfer.token,
    openTransfer.recipient,
    refundInvoke.contract,
    refundInvoke.calldata[0],
    refundInvoke.calldata[1],
    refundInvoke.calldata[2],
  ];
  if (!concreteFelts.every((felt) => walletApiFelt.test(felt))) {
    throw new RefundPreparationError(
      "INVALID_ACTIONS",
      "Wallet API felt canonicalization failed.",
    );
  }
}

function sanitizeRefundActions(actions: STRK20_ACTION[]): Array<Record<string, unknown>> {
  const [openTransfer, refundInvoke] = actions;
  if (openTransfer.type !== "transfer" || refundInvoke.type !== "invoke") {
    throw new RefundPreparationError("INVALID_ACTIONS", "Cannot sanitize invalid REFUND actions.");
  }
  return [
    { ...openTransfer },
    {
      ...refundInvoke,
      calldata: [
        refundInvoke.calldata[0],
        refundInvoke.calldata[1],
        "[REDACTED_REFUND_PREIMAGE]",
        refundInvoke.calldata[3],
      ],
    },
  ];
}

async function queryReadiness(input: {
  provider: RefundReadProvider;
  conditionalPay: string;
  recipient: string;
  expectation: PaymentBRefundExpectation;
  isMainnet: boolean;
  nowUnix: bigint;
}): Promise<{
  payment: Awaited<ReturnType<typeof getPayment>>;
  readiness: Omit<
    RefundReadinessSummary,
    "refundHashVerificationPassed" | "canonicalSerializationPassed"
  >;
}> {
  if (!input.isMainnet) {
    throw new RefundPreparationError(
      "NETWORK_NOT_MAINNET",
      "TX4 is restricted to Starknet Mainnet.",
    );
  }

  let payment: Awaited<ReturnType<typeof getPayment>>;
  try {
    payment = await getPayment(
      input.provider,
      input.conditionalPay,
      input.expectation.paymentId,
      "latest",
    );
  } catch {
    throw new RefundPreparationError("RPC_REJECTED", "Unable to read Payment B from Mainnet.");
  }

  if (payment.state !== PaymentState.ACTIVE) {
    throw new RefundPreparationError("PAYMENT_NOT_ACTIVE", "Payment B is not ACTIVE.");
  }
  if (
    !sameFelt(payment.token, input.expectation.token) ||
    payment.amount !== input.expectation.amount ||
    !sameFelt(payment.refund_hash, input.expectation.refundHash) ||
    payment.expires_at !== input.expectation.expiresAt
  ) {
    throw new RefundPreparationError(
      "ONCHAIN_VALIDATION_MISMATCH",
      "Live Payment B does not match the expected payment.",
    );
  }

  let currentBlock: number;
  let latestBlock: { timestamp: number };
  let locked: bigint;
  let feeRaw: string[];
  try {
    const pool = await getStrk20Pool(input.provider, input.conditionalPay, "latest");
    [currentBlock, latestBlock, locked, feeRaw] = await Promise.all([
      input.provider.getBlockNumber(),
      input.provider.getBlock("latest"),
      getLockedByToken(input.provider, input.conditionalPay, payment.token, "latest"),
      input.provider.callContract(
        { contractAddress: pool, entrypoint: "get_fee_amount", calldata: [] },
        "latest",
      ),
    ]);
  } catch {
    throw new RefundPreparationError(
      "RPC_REJECTED",
      "Unable to complete Mainnet readiness checks.",
    );
  }

  const depth = currentBlock - input.expectation.tx3Block;
  if (depth < input.expectation.minimumDepth) {
    throw new RefundPreparationError("INSUFFICIENT_DEPTH", "TX3 has insufficient block depth.");
  }
  if (
    input.nowUnix < payment.expires_at ||
    BigInt(latestBlock.timestamp) < payment.expires_at
  ) {
    throw new RefundPreparationError("PAYMENT_NOT_EXPIRED", "Payment B is not yet expired.");
  }
  if (locked !== payment.amount) {
    throw new RefundPreparationError(
      "LIABILITY_MISMATCH",
      "Payment B locked liability does not match.",
    );
  }
  if (feeRaw.length !== 1) {
    throw new RefundPreparationError("RPC_REJECTED", "STRK20 fee response was invalid.");
  }

  return {
    payment,
    readiness: {
      network: "MAINNET",
      currentBlock,
      tx3Block: input.expectation.tx3Block,
      depth,
      latestBlockTimestamp: String(latestBlock.timestamp),
      checkedAtUnix: input.nowUnix.toString(),
      paymentState: "ACTIVE",
      paymentToken: payment.token,
      paymentAmount: payment.amount.toString(),
      refundHash: payment.refund_hash,
      expiresAt: payment.expires_at.toString(),
      expiryEligible: true,
      lockedLiability: locked.toString(),
      feeWei: BigInt(feeRaw[0]).toString(),
      recipient: input.recipient,
    },
  };
}

export async function preparePaymentBRefund(input: {
  provider: RefundReadProvider;
  conditionalPay: string;
  recipient: string;
  envelope: EncryptedCredentialEnvelope;
  passphrase: string;
  isMainnet: boolean;
  expectation?: PaymentBRefundExpectation;
  nowUnix?: bigint;
}): Promise<PreparedPaymentBRefund> {
  const expectation = input.expectation ?? PAYMENT_B_REFUND_EXPECTATION;
  let recovery: PaymentBRecoveryBundle | undefined;
  let recovered: PaymentBRecoveryBundle["paymentB"] | undefined;
  let claimPreimage: string | undefined;
  let refundPreimage: string | undefined;

  try {
    if (!input.isMainnet) {
      throw new RefundPreparationError(
        "NETWORK_NOT_MAINNET",
        "TX4 is restricted to Starknet Mainnet.",
      );
    }
    try {
      const decrypted = await importEncryptedCredentials(input.envelope, input.passphrase);
      recovery = validateRecoverySchema(decrypted);
    } catch (error) {
      if (error instanceof RefundPreparationError) throw error;
      throw new RefundPreparationError(
        "CRYPTO_DECRYPT_FAILED",
        "Recovery decryption or authentication failed.",
      );
    }

    recovered = recovery.paymentB;
    claimPreimage = recovered.claimPreimage;
    refundPreimage = recovered.refundPreimage;
    if (!sameFelt(recovered.paymentId, expectation.paymentId)) {
      throw new RefundPreparationError(
        "PAYMENT_ID_MISMATCH",
        "Recovered Payment ID does not match Payment B.",
      );
    }

    let recoveredRefundHash: string;
    try {
      recoveredRefundHash = computeRefundHash(refundPreimage);
    } catch {
      throw new RefundPreparationError(
        "RECOVERY_SCHEMA_INVALID",
        "Decrypted recovery data has an unsupported schema.",
      );
    }
    if (!sameFelt(recoveredRefundHash, expectation.refundHash)) {
      throw new RefundPreparationError(
        "REFUND_HASH_MISMATCH",
        "Recovered refund credential does not match Payment B.",
      );
    }

    const { payment, readiness } = await queryReadiness({
      provider: input.provider,
      conditionalPay: input.conditionalPay,
      recipient: input.recipient,
      expectation,
      isMainnet: input.isMainnet,
      nowUnix: input.nowUnix ?? BigInt(Math.floor(Date.now() / 1000)),
    });

    let recoveredHashlock: string;
    let recomputedPaymentId: string;
    let recoveredExpiresAt: bigint;
    try {
      recoveredHashlock = computeClaimHash(claimPreimage);
      recomputedPaymentId = computePaymentId({
        token: payment.token,
        amount: payment.amount,
        hashlock: recoveredHashlock,
        refund_hash: recoveredRefundHash,
        claim_after: payment.claim_after,
        expires_at: payment.expires_at,
        approver: payment.approver,
        nonce: recovered.nonce,
      });
      recoveredExpiresAt = BigInt(recovered.expiresAt);
    } catch {
      throw new RefundPreparationError(
        "RECOVERY_SCHEMA_INVALID",
        "Decrypted recovery data has an unsupported schema.",
      );
    }
    if (
      !sameFelt(recoveredHashlock, payment.hashlock) ||
      !sameFelt(recoveredRefundHash, payment.refund_hash) ||
      !sameFelt(recomputedPaymentId, expectation.paymentId) ||
      recoveredExpiresAt !== payment.expires_at
    ) {
      throw new RefundPreparationError(
        "ONCHAIN_VALIDATION_MISMATCH",
        "Recovered public parameters do not match live Payment B.",
      );
    }

    const actions = buildRefundActions(input.conditionalPay, {
      payment_id: expectation.paymentId,
      refund_preimage: refundPreimage,
      token: payment.token,
      recipient: input.recipient,
    });
    assertRefundTopology(
      actions,
      input.conditionalPay,
      expectation.paymentId,
      payment.token,
      input.recipient,
    );

    return {
      actions,
      sanitizedActions: sanitizeRefundActions(actions),
      readiness: {
        ...readiness,
        refundHashVerificationPassed: true,
        canonicalSerializationPassed: true,
      },
    };
  } finally {
    // Best effort only: JavaScript immutable strings cannot be cryptographically zeroized.
    if (recovered) {
      recovered.claimPreimage = "0x0";
      recovered.refundPreimage = "0x0";
    }
    recovery = undefined;
    recovered = undefined;
    claimPreimage = undefined;
    refundPreimage = undefined;
  }
}

export async function revalidatePaymentBRefund(input: {
  provider: RefundReadProvider;
  conditionalPay: string;
  previous: RefundReadinessSummary;
  isMainnet: boolean;
  expectation?: PaymentBRefundExpectation;
  nowUnix?: bigint;
}): Promise<RefundReadinessSummary> {
  const expectation = input.expectation ?? PAYMENT_B_REFUND_EXPECTATION;
  const { payment, readiness } = await queryReadiness({
    provider: input.provider,
    conditionalPay: input.conditionalPay,
    recipient: input.previous.recipient,
    expectation,
    isMainnet: input.isMainnet,
    nowUnix: input.nowUnix ?? BigInt(Math.floor(Date.now() / 1000)),
  });
  if (
    !sameFelt(payment.token, input.previous.paymentToken) ||
    payment.amount.toString() !== input.previous.paymentAmount ||
    !sameFelt(payment.refund_hash, input.previous.refundHash) ||
    payment.expires_at.toString() !== input.previous.expiresAt
  ) {
    throw new RefundPreparationError(
      "ONCHAIN_VALIDATION_MISMATCH",
      "Payment B changed after preparation.",
    );
  }
  return {
    ...readiness,
    refundHashVerificationPassed: true,
    canonicalSerializationPassed: true,
  };
}

interface SecretRefundSession {
  actions: STRK20_ACTION[];
}

const secretRefundSessions = new WeakMap<object, SecretRefundSession>();

export function createRefundSessionKey(): object {
  return Object.freeze({});
}

export function storeSecretRefundSession(key: object, actions: STRK20_ACTION[]): void {
  clearSecretRefundSession(key);
  secretRefundSessions.set(key, { actions });
}

export function getSecretRefundSession(key: object): SecretRefundSession | undefined {
  return secretRefundSessions.get(key);
}

export function hasSecretRefundSession(key: object): boolean {
  return secretRefundSessions.has(key);
}

export function clearSecretRefundSession(key: object): void {
  const session = secretRefundSessions.get(key);
  if (session) clearSecretRefundActions(session.actions);
  secretRefundSessions.delete(key);
}

export function clearSecretRefundActions(actions: STRK20_ACTION[]): void {
  for (const action of actions) {
    if (action.type === "invoke") action.calldata.fill("0x0");
  }
  actions.splice(0, actions.length);
}

export interface RefundExecutionAttemptMutex {
  tryAcquire(): boolean;
  release(): void;
  isLocked(): boolean;
}

export function createRefundExecutionAttemptMutex(): RefundExecutionAttemptMutex {
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
