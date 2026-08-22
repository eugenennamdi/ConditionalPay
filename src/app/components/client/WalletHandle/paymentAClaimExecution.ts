import type { STRK20_ACTION } from "starknet";
import {
  OPEN_NOTE_ID_0,
  PaymentState,
  buildClaimActions,
  computeClaimHash,
  computePaymentId,
  computeRefundHash,
  getLockedByToken,
  getPayment,
  getStrk20Pool,
  importEncryptedCredentials,
  requiresApproval,
  type EncryptedCredentialEnvelope,
} from "@conditionalpay/sdk";

export const PAYMENT_A_CLAIM_EXPECTATION = {
  paymentId: "0x19b3f6176561b6054a803a0d499c73252413eaa8756dda3990f605ef9273ac3",
  hashlock: "0x7be05eb23f518758d26904b9b19f45f77a7780bb74444601e60ee92ef0c4d30",
  amount: 100000000000000000n,
  tx1Block: 13701781,
  minimumDepth: 10,
} as const;

export interface PaymentAClaimExpectation {
  paymentId: string;
  hashlock: string;
  amount: bigint;
  tx1Block: number;
  minimumDepth: number;
}

interface PaymentARecoveryBundle {
  paymentA: {
    paymentId: string;
    claimPreimage: string;
    refundPreimage: string;
    nonce: string;
    expiresAt?: string;
  };
}

export interface ClaimReadProvider {
  callContract(
    call: { contractAddress: string; entrypoint: string; calldata?: string[] },
    blockIdentifier?: unknown,
  ): Promise<string[]>;
  getBlockNumber(): Promise<number>;
  getBlock(blockIdentifier: "latest"): Promise<{ timestamp: number }>;
}

export interface ClaimReadinessSummary {
  currentBlock: number;
  tx1Block: number;
  depth: number;
  paymentState: "ACTIVE";
  paymentToken: string;
  paymentAmount: string;
  expiresAt: string;
  beforeExpiry: true;
  requiresApproval: false;
  lockedLiability: string;
  feeWei: string;
  recipient: string;
  claimHashVerificationPassed: true;
  canonicalSerializationPassed: true;
}

export interface PreparedPaymentAClaim {
  actions: STRK20_ACTION[];
  sanitizedActions: Array<Record<string, unknown>>;
  readiness: ClaimReadinessSummary;
}

export type ClaimPreparationErrorCode =
  | "INPUT_MISSING"
  | "ENVELOPE_PARSE_FAILED"
  | "CRYPTO_DECRYPT_FAILED"
  | "RECOVERY_SCHEMA_INVALID"
  | "PAYMENT_ID_MISMATCH"
  | "HASHLOCK_MISMATCH"
  | "ONCHAIN_VALIDATION_MISMATCH"
  | "PAYMENT_NOT_ACTIVE"
  | "PAYMENT_EXPIRED"
  | "APPROVAL_REQUIRED"
  | "INSUFFICIENT_DEPTH"
  | "LIABILITY_MISMATCH"
  | "INVALID_ACTIONS"
  | "RPC_REJECTED";

export class ClaimPreparationError extends Error {
  readonly code: ClaimPreparationErrorCode;

  constructor(code: ClaimPreparationErrorCode, safeMessage: string) {
    super(safeMessage);
    this.name = "ClaimPreparationError";
    this.code = code;
  }
}

const walletApiFelt = /^0x(0|[a-fA-F1-9][a-fA-F0-9]{0,62})$/;
const envelopeHex = /^[a-fA-F0-9]+$/;

export function captureRecoveryAttemptInputs<TFile>(
  readPassphrase: () => string,
  readFile: () => TFile | undefined,
  clearPreviousMaterial: () => void,
): [passphrase: string, file: TFile] {
  const passphrase = readPassphrase();
  const file = readFile();

  // Capture both browser-owned values before cleanup clears the input elements.
  clearPreviousMaterial();
  if (!passphrase || !file) {
    throw new ClaimPreparationError(
      "INPUT_MISSING",
      "Select the encrypted envelope and enter its passphrase.",
    );
  }
  return [passphrase, file];
}

export function parseRecoveryEnvelopeText(text: string): EncryptedCredentialEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ClaimPreparationError(
      "ENVELOPE_PARSE_FAILED",
      "The selected recovery envelope is not valid JSON.",
    );
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new ClaimPreparationError(
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
    throw new ClaimPreparationError(
      "ENVELOPE_PARSE_FAILED",
      "The selected recovery envelope has an invalid structure.",
    );
  }
  return envelope as EncryptedCredentialEnvelope;
}

function validateRecoverySchema(value: unknown): PaymentARecoveryBundle {
  if (typeof value !== "object" || value === null) {
    throw new ClaimPreparationError(
      "RECOVERY_SCHEMA_INVALID",
      "Decrypted recovery data has an unsupported schema.",
    );
  }
  const paymentA = (value as { paymentA?: unknown }).paymentA;
  if (typeof paymentA !== "object" || paymentA === null) {
    throw new ClaimPreparationError(
      "RECOVERY_SCHEMA_INVALID",
      "Decrypted recovery data has an unsupported schema.",
    );
  }
  const candidate = paymentA as Record<string, unknown>;
  if (
    typeof candidate.paymentId !== "string" ||
    typeof candidate.claimPreimage !== "string" ||
    typeof candidate.refundPreimage !== "string" ||
    typeof candidate.nonce !== "string" ||
    (candidate.expiresAt !== undefined && typeof candidate.expiresAt !== "string")
  ) {
    throw new ClaimPreparationError(
      "RECOVERY_SCHEMA_INVALID",
      "Decrypted recovery data has an unsupported schema.",
    );
  }
  return value as PaymentARecoveryBundle;
}

function sameFelt(left: string, right: string): boolean {
  try {
    return BigInt(left) === BigInt(right);
  } catch {
    return false;
  }
}

function assertClaimTopology(
  actions: STRK20_ACTION[],
  paymentId: string,
  token: string,
  recipient: string,
): void {
  if (
    actions.length !== 2 ||
    actions[0].type !== "transfer" ||
    actions[1].type !== "invoke" ||
    actions.filter((action) => action.type === "transfer").length !== 1 ||
    actions.filter((action) => action.type === "invoke").length !== 1
  ) {
    throw new ClaimPreparationError("INVALID_ACTIONS", "Canonical CLAIM action topology failed.");
  }

  const [openTransfer, claimInvoke] = actions;
  if (
    openTransfer.amount !== "OPEN" ||
    !sameFelt(openTransfer.token, token) ||
    !sameFelt(openTransfer.recipient, recipient) ||
    claimInvoke.calldata.length !== 4 ||
    claimInvoke.calldata[0] !== "0x1" ||
    !sameFelt(claimInvoke.calldata[1], paymentId) ||
    claimInvoke.calldata[3] !== OPEN_NOTE_ID_0 ||
    actions.some((action) => action.type === "withdraw" || action.type === "deposit")
  ) {
    throw new ClaimPreparationError("INVALID_ACTIONS", "Canonical CLAIM action validation failed.");
  }

  const numericFelts = [
    openTransfer.token,
    openTransfer.recipient,
    claimInvoke.contract,
    claimInvoke.calldata[0],
    claimInvoke.calldata[1],
    claimInvoke.calldata[2],
  ];
  if (!numericFelts.every((felt) => walletApiFelt.test(felt))) {
    throw new ClaimPreparationError("INVALID_ACTIONS", "Wallet API felt canonicalization failed.");
  }
}

function sanitizeClaimActions(actions: STRK20_ACTION[]): Array<Record<string, unknown>> {
  const [openTransfer, claimInvoke] = actions;
  if (openTransfer.type !== "transfer" || claimInvoke.type !== "invoke") {
    throw new ClaimPreparationError("INVALID_ACTIONS", "Cannot sanitize invalid CLAIM actions.");
  }
  return [
    { ...openTransfer },
    {
      ...claimInvoke,
      calldata: [
        claimInvoke.calldata[0],
        claimInvoke.calldata[1],
        "[REDACTED_CLAIM_PREIMAGE]",
        claimInvoke.calldata[3],
      ],
    },
  ];
}

async function queryReadiness(
  provider: ClaimReadProvider,
  conditionalPay: string,
  recipient: string,
  expectation: PaymentAClaimExpectation,
  nowUnix: bigint,
): Promise<{
  payment: Awaited<ReturnType<typeof getPayment>>;
  readiness: Omit<ClaimReadinessSummary, "claimHashVerificationPassed" | "canonicalSerializationPassed">;
}> {
  let payment: Awaited<ReturnType<typeof getPayment>>;
  try {
    payment = await getPayment(provider, conditionalPay, expectation.paymentId, "latest");
  } catch {
    throw new ClaimPreparationError("RPC_REJECTED", "Unable to read Payment A from Mainnet.");
  }

  if (payment.state !== PaymentState.ACTIVE) {
    throw new ClaimPreparationError("PAYMENT_NOT_ACTIVE", "Payment A is not ACTIVE.");
  }
  if (
    payment.amount !== expectation.amount ||
    !sameFelt(payment.hashlock, expectation.hashlock)
  ) {
    throw new ClaimPreparationError(
      "ONCHAIN_VALIDATION_MISMATCH",
      "Live Payment A does not match the expected payment.",
    );
  }
  if (requiresApproval(payment)) {
    throw new ClaimPreparationError("APPROVAL_REQUIRED", "Payment A currently requires approval.");
  }

  let currentBlock: number;
  let latestBlock: { timestamp: number };
  let locked: bigint;
  let feeRaw: string[];
  try {
    const pool = await getStrk20Pool(provider, conditionalPay, "latest");
    [currentBlock, latestBlock, locked, feeRaw] = await Promise.all([
      provider.getBlockNumber(),
      provider.getBlock("latest"),
      getLockedByToken(provider, conditionalPay, payment.token, "latest"),
      provider.callContract(
        { contractAddress: pool, entrypoint: "get_fee_amount", calldata: [] },
        "latest",
      ),
    ]);
  } catch {
    throw new ClaimPreparationError("RPC_REJECTED", "Unable to complete Mainnet readiness checks.");
  }

  const depth = currentBlock - expectation.tx1Block;
  if (depth < expectation.minimumDepth) {
    throw new ClaimPreparationError("INSUFFICIENT_DEPTH", "TX1 has insufficient block depth.");
  }
  if (
    nowUnix >= payment.expires_at ||
    BigInt(latestBlock.timestamp) >= payment.expires_at
  ) {
    throw new ClaimPreparationError("PAYMENT_EXPIRED", "Payment A is expired.");
  }
  if (locked !== payment.amount) {
    throw new ClaimPreparationError("LIABILITY_MISMATCH", "Payment A locked liability does not match.");
  }
  if (feeRaw.length !== 1) {
    throw new ClaimPreparationError("RPC_REJECTED", "STRK20 fee response was invalid.");
  }

  return {
    payment,
    readiness: {
      currentBlock,
      tx1Block: expectation.tx1Block,
      depth,
      paymentState: "ACTIVE",
      paymentToken: payment.token,
      paymentAmount: payment.amount.toString(),
      expiresAt: payment.expires_at.toString(),
      beforeExpiry: true,
      requiresApproval: false,
      lockedLiability: locked.toString(),
      feeWei: BigInt(feeRaw[0]).toString(),
      recipient,
    },
  };
}

export async function preparePaymentAClaim(input: {
  provider: ClaimReadProvider;
  conditionalPay: string;
  recipient: string;
  envelope: EncryptedCredentialEnvelope;
  passphrase: string;
  expectation?: PaymentAClaimExpectation;
  nowUnix?: bigint;
}): Promise<PreparedPaymentAClaim> {
  const expectation = input.expectation ?? PAYMENT_A_CLAIM_EXPECTATION;
  let recovery: PaymentARecoveryBundle | undefined;
  let recovered: PaymentARecoveryBundle["paymentA"] | undefined;
  let claimPreimage: string | undefined;
  let refundPreimage: string | undefined;

  try {
    try {
      const decrypted = await importEncryptedCredentials(input.envelope, input.passphrase);
      recovery = validateRecoverySchema(decrypted);
    } catch (error) {
      if (error instanceof ClaimPreparationError) throw error;
      throw new ClaimPreparationError(
        "CRYPTO_DECRYPT_FAILED",
        "Recovery decryption or authentication failed.",
      );
    }

    recovered = recovery.paymentA;
    claimPreimage = recovered.claimPreimage;
    refundPreimage = recovered.refundPreimage;
    if (!sameFelt(recovered.paymentId, expectation.paymentId)) {
      throw new ClaimPreparationError(
        "PAYMENT_ID_MISMATCH",
        "Recovered Payment ID does not match Payment A.",
      );
    }

    let recoveredHashlock: string;
    try {
      recoveredHashlock = computeClaimHash(claimPreimage);
    } catch {
      throw new ClaimPreparationError(
        "RECOVERY_SCHEMA_INVALID",
        "Decrypted recovery data has an unsupported schema.",
      );
    }
    if (!sameFelt(recoveredHashlock, expectation.hashlock)) {
      throw new ClaimPreparationError(
        "HASHLOCK_MISMATCH",
        "Recovered claim credential does not match Payment A.",
      );
    }

    const { payment, readiness } = await queryReadiness(
      input.provider,
      input.conditionalPay,
      input.recipient,
      expectation,
      input.nowUnix ?? BigInt(Math.floor(Date.now() / 1000)),
    );

    let refundHash: string;
    let recomputedPaymentId: string;
    let recoveredExpiresAt: bigint | undefined;
    try {
      refundHash = computeRefundHash(refundPreimage);
      recomputedPaymentId = computePaymentId({
        token: payment.token,
        amount: payment.amount,
        hashlock: recoveredHashlock,
        refund_hash: refundHash,
        claim_after: payment.claim_after,
        expires_at: payment.expires_at,
        approver: payment.approver,
        nonce: recovered.nonce,
      });
      recoveredExpiresAt =
        recovered.expiresAt === undefined ? undefined : BigInt(recovered.expiresAt);
    } catch {
      throw new ClaimPreparationError(
        "RECOVERY_SCHEMA_INVALID",
        "Decrypted recovery data has an unsupported schema.",
      );
    }
    if (
      !sameFelt(refundHash, payment.refund_hash) ||
      !sameFelt(recomputedPaymentId, expectation.paymentId) ||
      (recoveredExpiresAt !== undefined && recoveredExpiresAt !== payment.expires_at)
    ) {
      throw new ClaimPreparationError(
        "ONCHAIN_VALIDATION_MISMATCH",
        "Recovered public parameters do not match live Payment A.",
      );
    }

    const actions = buildClaimActions(input.conditionalPay, {
      payment_id: expectation.paymentId,
      claim_preimage: claimPreimage,
      token: payment.token,
      recipient: input.recipient,
    });
    assertClaimTopology(actions, expectation.paymentId, payment.token, input.recipient);

    return {
      actions,
      sanitizedActions: sanitizeClaimActions(actions),
      readiness: {
        ...readiness,
        claimHashVerificationPassed: true,
        canonicalSerializationPassed: true,
      },
    };
  } finally {
    // Best effort only: JavaScript immutable strings cannot be cryptographically zeroized.
    recovery = undefined;
    recovered = undefined;
    claimPreimage = undefined;
    refundPreimage = undefined;
  }
}

export async function revalidatePaymentAClaim(input: {
  provider: ClaimReadProvider;
  conditionalPay: string;
  previous: ClaimReadinessSummary;
  expectation?: PaymentAClaimExpectation;
  nowUnix?: bigint;
}): Promise<ClaimReadinessSummary> {
  const expectation = input.expectation ?? PAYMENT_A_CLAIM_EXPECTATION;
  const { payment, readiness } = await queryReadiness(
    input.provider,
    input.conditionalPay,
    input.previous.recipient,
    expectation,
    input.nowUnix ?? BigInt(Math.floor(Date.now() / 1000)),
  );
  if (
    !sameFelt(payment.token, input.previous.paymentToken) ||
    payment.amount.toString() !== input.previous.paymentAmount ||
    payment.expires_at.toString() !== input.previous.expiresAt
  ) {
    throw new ClaimPreparationError(
      "ONCHAIN_VALIDATION_MISMATCH",
      "Payment A changed after preparation.",
    );
  }
  return {
    ...readiness,
    claimHashVerificationPassed: true,
    canonicalSerializationPassed: true,
  };
}

interface SecretClaimSession {
  actions: STRK20_ACTION[];
}

const secretClaimSessions = new WeakMap<object, SecretClaimSession>();

export function createClaimSessionKey(): object {
  return Object.freeze({});
}

export function storeSecretClaimSession(key: object, actions: STRK20_ACTION[]): void {
  clearSecretClaimSession(key);
  secretClaimSessions.set(key, { actions });
}

export function getSecretClaimSession(key: object): SecretClaimSession | undefined {
  return secretClaimSessions.get(key);
}

export function hasSecretClaimSession(key: object): boolean {
  return secretClaimSessions.has(key);
}

export function clearSecretClaimSession(key: object): void {
  const session = secretClaimSessions.get(key);
  if (session) clearSecretClaimActions(session.actions);
  secretClaimSessions.delete(key);
}

export function clearSecretClaimActions(actions: STRK20_ACTION[]): void {
  for (const action of actions) {
    if (action.type === "invoke") action.calldata.fill("0x0");
  }
  actions.splice(0, actions.length);
}

export interface ExecutionAttemptMutex {
  tryAcquire(): boolean;
  release(): void;
  isLocked(): boolean;
}

export function createExecutionAttemptMutex(): ExecutionAttemptMutex {
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
