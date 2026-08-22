"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { STRK20_ACTION } from "starknet";
import styles from "../../../uni.module.css";
import {
  PAYMENT_B_REFUND_EXPECTATION,
  RefundPreparationError,
  captureRefundRecoveryInputs,
  clearSecretRefundActions,
  clearSecretRefundSession,
  createRefundExecutionAttemptMutex,
  createRefundSessionKey,
  getSecretRefundSession,
  hasSecretRefundSession,
  parseRefundRecoveryEnvelopeText,
  preparePaymentBRefund,
  revalidatePaymentBRefund,
  storeSecretRefundSession,
  type RefundReadProvider,
  type RefundReadinessSummary,
} from "./paymentBRefundExecution";

interface PaymentBRefundExecutionPanelProps {
  conditionalPay: string;
  connectedAddress: string;
  networkName: string | undefined;
  isConnected: boolean;
  isMainnet: boolean;
  isSubmitting: boolean;
  provider: RefundReadProvider;
  executeActions: (
    actions: STRK20_ACTION[],
    onWalletSettled: () => void,
  ) => Promise<string | undefined>;
}

type PanelStatus =
  | { kind: "idle"; message: string }
  | { kind: "pending"; message: string }
  | { kind: "ok"; message: string }
  | { kind: "error"; message: string };

function safePreparationMessage(error: unknown): string {
  if (!(error instanceof RefundPreparationError)) {
    return "TX4 preparation failed without exposing credential material.";
  }
  switch (error.code) {
    case "INPUT_MISSING":
      return "Select the encrypted Payment B envelope and enter its passphrase.";
    case "ENVELOPE_PARSE_FAILED":
      return "The selected file is not a valid recovery envelope.";
    case "CRYPTO_DECRYPT_FAILED":
      return "Recovery decryption or authentication failed.";
    case "RECOVERY_SCHEMA_INVALID":
      return "The decrypted recovery data has an unsupported structure.";
    case "PAYMENT_ID_MISMATCH":
      return "The recovered Payment ID does not match Payment B.";
    case "REFUND_HASH_MISMATCH":
      return "The recovered refund credential does not match Payment B.";
    case "ONCHAIN_VALIDATION_MISMATCH":
      return "Live Payment B does not match the recovered public parameters.";
    case "NETWORK_NOT_MAINNET":
      return "TX4 is restricted to Starknet Mainnet.";
    case "PAYMENT_NOT_ACTIVE":
      return "Payment B is no longer ACTIVE.";
    case "PAYMENT_NOT_EXPIRED":
      return "Payment B has not yet expired according to the latest Mainnet block.";
    case "INSUFFICIENT_DEPTH":
      return "TX3 does not yet have sufficient block depth.";
    case "LIABILITY_MISMATCH":
      return "The live locked liability does not match Payment B.";
    case "INVALID_ACTIONS":
      return "The canonical REFUND payload failed validation.";
    case "RPC_REJECTED":
      return "Mainnet readiness checks could not be completed.";
  }
}

function formatStrk(wei: string): string {
  const value = BigInt(wei);
  const whole = value / 10n ** 18n;
  const fraction = (value % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction} STRK` : `${whole} STRK`;
}

export default function PaymentBRefundExecutionPanel({
  conditionalPay,
  connectedAddress,
  networkName,
  isConnected,
  isMainnet,
  isSubmitting,
  provider,
  executeActions,
}: PaymentBRefundExecutionPanelProps) {
  const [localDevelopment, setLocalDevelopment] = useState(false);
  const [prepared, setPrepared] = useState(false);
  const [readiness, setReadiness] = useState<RefundReadinessSummary | null>(null);
  const [sanitizedPayload, setSanitizedPayload] = useState<Array<Record<string, unknown>> | null>(
    null,
  );
  const [status, setStatus] = useState<PanelStatus>({
    kind: "idle",
    message: "Select the encrypted Payment B envelope to prepare TX4 locally.",
  });
  const envelopeInputRef = useRef<HTMLInputElement>(null);
  const passwordInputRef = useRef<HTMLInputElement>(null);
  const mountedRef = useRef(true);
  const connectedRef = useRef(isConnected);
  const mainnetRef = useRef(isMainnet);
  const sessionKeyRef = useRef<object | null>(null);
  const attemptMutexRef = useRef<ReturnType<typeof createRefundExecutionAttemptMutex> | null>(
    null,
  );
  if (sessionKeyRef.current === null) sessionKeyRef.current = createRefundSessionKey();
  if (attemptMutexRef.current === null) {
    attemptMutexRef.current = createRefundExecutionAttemptMutex();
  }
  connectedRef.current = isConnected;
  mainnetRef.current = isMainnet;

  const clearSecretMaterial = useCallback((updateUi: boolean) => {
    const sessionKey = sessionKeyRef.current;
    if (sessionKey) clearSecretRefundSession(sessionKey);
    if (passwordInputRef.current) passwordInputRef.current.value = "";
    if (envelopeInputRef.current) envelopeInputRef.current.value = "";
    if (updateUi) setPrepared(false);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    setLocalDevelopment(
      process.env.NODE_ENV === "development" &&
        (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"),
    );
    return () => {
      mountedRef.current = false;
      clearSecretMaterial(false);
    };
  }, [clearSecretMaterial]);

  useEffect(() => {
    if (!isConnected || !isMainnet) {
      clearSecretMaterial(true);
      setReadiness(null);
      setSanitizedPayload(null);
    }
  }, [clearSecretMaterial, isConnected, isMainnet]);

  if (!localDevelopment) return null;

  const handlePrepare = async () => {
    const mutex = attemptMutexRef.current;
    if (!mutex?.tryAcquire()) return;
    setReadiness(null);
    setSanitizedPayload(null);
    setStatus({ kind: "pending", message: "Decrypting and checking Mainnet refund eligibility…" });

    let passphrase = "";
    let file: File | undefined;
    let envelopeText = "";
    let envelope: ReturnType<typeof parseRefundRecoveryEnvelopeText> | undefined;
    let result: Awaited<ReturnType<typeof preparePaymentBRefund>> | undefined;
    let storedForExecution = false;

    try {
      [passphrase, file] = captureRefundRecoveryInputs(
        () => passwordInputRef.current?.value ?? "",
        () => envelopeInputRef.current?.files?.[0],
        () => clearSecretMaterial(true),
      );
      if (!isConnected || !connectedAddress) {
        throw new RefundPreparationError("RPC_REJECTED", "Connect Ready X on Mainnet first.");
      }

      try {
        envelopeText = await file.text();
      } catch {
        throw new RefundPreparationError(
          "ENVELOPE_PARSE_FAILED",
          "The selected recovery envelope could not be read.",
        );
      }
      envelope = parseRefundRecoveryEnvelopeText(envelopeText);
      result = await preparePaymentBRefund({
        provider,
        conditionalPay,
        recipient: connectedAddress,
        envelope,
        passphrase,
        isMainnet,
      });
      if (!mountedRef.current || !connectedRef.current || !mainnetRef.current) {
        throw new RefundPreparationError(
          "NETWORK_NOT_MAINNET",
          "The connected Mainnet session changed during preparation.",
        );
      }
      const sessionKey = sessionKeyRef.current;
      if (!sessionKey) throw new Error("Missing ephemeral session key");
      storeSecretRefundSession(sessionKey, result.actions);
      storedForExecution = true;
      setReadiness(result.readiness);
      setSanitizedPayload(result.sanitizedActions);
      setPrepared(true);
      setStatus({
        kind: "ok",
        message: "Recovery and expiry verified. TX4 is ready for one explicit execution.",
      });
    } catch (error) {
      if (!storedForExecution && result) clearSecretRefundActions(result.actions);
      clearSecretMaterial(mountedRef.current);
      if (mountedRef.current) {
        setStatus({ kind: "error", message: safePreparationMessage(error) });
      }
    } finally {
      if (!storedForExecution && result) clearSecretRefundActions(result.actions);
      passphrase = "";
      file = undefined;
      envelopeText = "";
      envelope = undefined;
      result = undefined;
      if (passwordInputRef.current) passwordInputRef.current.value = "";
      if (envelopeInputRef.current) envelopeInputRef.current.value = "";
      mutex.release();
    }
  };

  const handleExecute = async () => {
    const mutex = attemptMutexRef.current;
    if (!mutex?.tryAcquire()) return;
    const sessionKey = sessionKeyRef.current;
    const session = sessionKey ? getSecretRefundSession(sessionKey) : undefined;
    if (
      !session ||
      !readiness ||
      !isConnected ||
      !isMainnet ||
      !hasSecretRefundSession(sessionKey!)
    ) {
      clearSecretMaterial(true);
      setReadiness(null);
      setSanitizedPayload(null);
      setStatus({ kind: "error", message: "Prepared TX4 state is unavailable; prepare it again." });
      mutex.release();
      return;
    }

    setStatus({ kind: "pending", message: "Rechecking Mainnet immediately before execution…" });
    let walletSettled = false;
    const onWalletSettled = () => {
      if (walletSettled) return;
      walletSettled = true;
      clearSecretMaterial(mountedRef.current);
      if (mountedRef.current) {
        setReadiness(null);
        setSanitizedPayload(null);
      }
    };

    try {
      const refreshed = await revalidatePaymentBRefund({
        provider,
        conditionalPay,
        previous: readiness,
        isMainnet,
      });
      if (!mountedRef.current || !connectedRef.current || !mainnetRef.current) {
        throw new RefundPreparationError(
          "NETWORK_NOT_MAINNET",
          "The connected Mainnet session changed before execution.",
        );
      }
      setReadiness(refreshed);
      setStatus({ kind: "pending", message: "Waiting for Ready X confirmation…" });
      const transactionHash = await executeActions(session.actions, onWalletSettled);
      onWalletSettled();
      setStatus(
        transactionHash
          ? { kind: "ok", message: "TX4 submitted; secret-bearing state was cleared." }
          : { kind: "error", message: "TX4 was not submitted; secret-bearing state was cleared." },
      );
    } catch (error) {
      onWalletSettled();
      if (mountedRef.current) {
        setStatus({ kind: "error", message: safePreparationMessage(error) });
      }
    } finally {
      onWalletSettled();
      mutex.release();
    }
  };

  const handleCancel = () => {
    if (attemptMutexRef.current?.isLocked()) return;
    clearSecretMaterial(true);
    setReadiness(null);
    setSanitizedPayload(null);
    setStatus({ kind: "idle", message: "Prepared TX4 state was discarded." });
  };

  return (
    <section className={styles.executionUtility} aria-label="Local Payment B TX4 execution utility">
      <div className={styles.utilityEyebrow}>LOCAL MAINNET EVIDENCE UTILITY</div>
      <h2 className={styles.utilityTitle}>ConditionalPay REFUND (Payment B) — TX4</h2>
      <p className={styles.utilityCopy}>
        Select {PAYMENT_B_REFUND_EXPECTATION.envelopeFilename}. Decryption stays in browser memory;
        JavaScript cannot guarantee cryptographic zeroization of immutable strings, so cleanup is
        best-effort.
      </p>

      <div className={styles.utilityGrid}>
        <div><span>Network</span><strong>{networkName ?? "Unsupported"}</strong></div>
        <div><span>Payment B ID</span><strong>{PAYMENT_B_REFUND_EXPECTATION.paymentId}</strong></div>
        <div><span>Expiry</span><strong>{PAYMENT_B_REFUND_EXPECTATION.expiresAt.toString()}</strong></div>
        <div><span>Payment state</span><strong>{readiness?.paymentState ?? "not verified"}</strong></div>
        <div><span>Expiry eligible</span><strong>{readiness?.expiryEligible ? "yes" : "not verified"}</strong></div>
        <div><span>TX3 depth</span><strong>{readiness?.depth ?? "not verified"}</strong></div>
        <div><span>Locked liability</span><strong>{readiness?.lockedLiability ?? "not verified"}</strong></div>
        <div><span>Current fee</span><strong>{readiness ? formatStrk(readiness.feeWei) : "not verified"}</strong></div>
        <div><span>Action topology</span><strong>{readiness ? "transfer OPEN → invoke REFUND" : "not prepared"}</strong></div>
      </div>

      <label>
        Encrypted Payment B recovery envelope
        <input
          ref={envelopeInputRef}
          type="file"
          accept=".json,application/json"
          disabled={isSubmitting || attemptMutexRef.current?.isLocked()}
        />
      </label>
      <label>
        Recovery passphrase
        <input
          ref={passwordInputRef}
          type="password"
          autoComplete="new-password"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          disabled={isSubmitting || attemptMutexRef.current?.isLocked()}
        />
      </label>

      <button
        type="button"
        className={styles.btnCta}
        disabled={isSubmitting || attemptMutexRef.current?.isLocked()}
        onClick={handlePrepare}
      >
        Verify recovery and prepare TX4
      </button>

      {sanitizedPayload ? (
        <pre aria-label="Sanitized TX4 payload">{JSON.stringify(sanitizedPayload, null, 2)}</pre>
      ) : null}

      <div className={status.kind === "error" ? styles.utilityStatusError : styles.utilityStatus}>
        {status.message}
      </div>

      <button
        type="button"
        className={styles.btnCta}
        disabled={
          !prepared ||
          !isConnected ||
          !isMainnet ||
          isSubmitting ||
          attemptMutexRef.current?.isLocked()
        }
        onClick={handleExecute}
      >
        Execute TX4 REFUND once
      </button>
      <button
        type="button"
        className={styles.btn}
        disabled={isSubmitting || attemptMutexRef.current?.isLocked()}
        onClick={handleCancel}
      >
        Discard prepared TX4
      </button>
    </section>
  );
}
