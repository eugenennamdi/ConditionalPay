"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { STRK20_ACTION } from "starknet";
import styles from "../../../uni.module.css";
import {
  ClaimPreparationError,
  captureRecoveryAttemptInputs,
  createClaimSessionKey,
  createExecutionAttemptMutex,
  clearSecretClaimActions,
  clearSecretClaimSession,
  getSecretClaimSession,
  hasSecretClaimSession,
  parseRecoveryEnvelopeText,
  preparePaymentAClaim,
  revalidatePaymentAClaim,
  storeSecretClaimSession,
  type ClaimReadProvider,
  type ClaimReadinessSummary,
} from "./paymentAClaimExecution";

interface PaymentAClaimExecutionPanelProps {
  conditionalPay: string;
  connectedAddress: string;
  isConnected: boolean;
  isSubmitting: boolean;
  provider: ClaimReadProvider;
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
  if (!(error instanceof ClaimPreparationError)) {
    return "TX2 preparation failed without exposing credential material.";
  }
  switch (error.code) {
    case "INPUT_MISSING":
      return "Select the encrypted Payment A envelope and enter its passphrase.";
    case "ENVELOPE_PARSE_FAILED":
      return "The selected file is not a valid recovery envelope.";
    case "CRYPTO_DECRYPT_FAILED":
      return "Recovery decryption or authentication failed.";
    case "RECOVERY_SCHEMA_INVALID":
      return "The decrypted recovery data has an unsupported structure.";
    case "PAYMENT_ID_MISMATCH":
      return "The recovered Payment ID does not match Payment A.";
    case "HASHLOCK_MISMATCH":
      return "The recovered claim credential does not match Payment A.";
    case "ONCHAIN_VALIDATION_MISMATCH":
      return "Live Payment A does not match the recovered public parameters.";
    case "PAYMENT_NOT_ACTIVE":
      return "Payment A is no longer ACTIVE.";
    case "PAYMENT_EXPIRED":
      return "Payment A is expired.";
    case "APPROVAL_REQUIRED":
      return "Payment A currently requires approval.";
    case "INSUFFICIENT_DEPTH":
      return "TX1 does not yet have sufficient block depth.";
    case "LIABILITY_MISMATCH":
      return "The live locked liability does not match Payment A.";
    case "INVALID_ACTIONS":
      return "The canonical CLAIM payload failed validation.";
    case "RPC_REJECTED":
      return "Mainnet readiness checks could not be completed.";
  }
}

export default function PaymentAClaimExecutionPanel({
  conditionalPay,
  connectedAddress,
  isConnected,
  isSubmitting,
  provider,
  executeActions,
}: PaymentAClaimExecutionPanelProps) {
  const [localDevelopment, setLocalDevelopment] = useState(false);
  const [prepared, setPrepared] = useState(false);
  const [readiness, setReadiness] = useState<ClaimReadinessSummary | null>(null);
  const [sanitizedPayload, setSanitizedPayload] = useState<Array<Record<string, unknown>> | null>(
    null,
  );
  const [status, setStatus] = useState<PanelStatus>({
    kind: "idle",
    message: "Select the encrypted Payment A envelope to prepare TX2 locally.",
  });
  const envelopeInputRef = useRef<HTMLInputElement>(null);
  const passwordInputRef = useRef<HTMLInputElement>(null);
  const sessionKeyRef = useRef<object | null>(null);
  const attemptMutexRef = useRef<ReturnType<typeof createExecutionAttemptMutex> | null>(null);
  if (sessionKeyRef.current === null) sessionKeyRef.current = createClaimSessionKey();
  if (attemptMutexRef.current === null) attemptMutexRef.current = createExecutionAttemptMutex();

  const clearSecretMaterial = useCallback((updateUi: boolean) => {
    const sessionKey = sessionKeyRef.current;
    if (sessionKey) clearSecretClaimSession(sessionKey);
    if (passwordInputRef.current) passwordInputRef.current.value = "";
    if (envelopeInputRef.current) envelopeInputRef.current.value = "";
    if (updateUi) setPrepared(false);
  }, []);

  useEffect(() => {
    setLocalDevelopment(
      process.env.NODE_ENV === "development" &&
        (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"),
    );
    return () => clearSecretMaterial(false);
  }, [clearSecretMaterial]);

  useEffect(() => {
    if (!isConnected) {
      clearSecretMaterial(true);
      setReadiness(null);
      setSanitizedPayload(null);
    }
  }, [clearSecretMaterial, isConnected]);

  if (!localDevelopment) return null;

  const handlePrepare = async () => {
    const mutex = attemptMutexRef.current;
    if (!mutex?.tryAcquire()) return;
    setReadiness(null);
    setSanitizedPayload(null);
    setStatus({ kind: "pending", message: "Decrypting and checking Mainnet state…" });

    let passphrase = "";
    let file: File | undefined;
    let envelopeText = "";
    let envelope: ReturnType<typeof parseRecoveryEnvelopeText> | undefined;
    let result: Awaited<ReturnType<typeof preparePaymentAClaim>> | undefined;
    let storedForExecution = false;

    try {
      [passphrase, file] = captureRecoveryAttemptInputs(
        () => passwordInputRef.current?.value ?? "",
        () => envelopeInputRef.current?.files?.[0],
        () => clearSecretMaterial(true),
      );
      if (!isConnected || !connectedAddress) {
        throw new ClaimPreparationError("RPC_REJECTED", "Connect Ready X on Mainnet first.");
      }

      try {
        envelopeText = await file.text();
      } catch {
        throw new ClaimPreparationError(
          "ENVELOPE_PARSE_FAILED",
          "The selected recovery envelope could not be read.",
        );
      }
      envelope = parseRecoveryEnvelopeText(envelopeText);
      result = await preparePaymentAClaim({
        provider,
        conditionalPay,
        recipient: connectedAddress,
        envelope,
        passphrase,
      });
      const sessionKey = sessionKeyRef.current;
      if (!sessionKey) throw new Error("Missing ephemeral session key");
      storeSecretClaimSession(sessionKey, result.actions);
      storedForExecution = true;
      setReadiness(result.readiness);
      setSanitizedPayload(result.sanitizedActions);
      setPrepared(true);
      setStatus({
        kind: "ok",
        message: "Recovery verified. TX2 is prepared in memory and ready for explicit execution.",
      });
    } catch (error) {
      if (!storedForExecution && result) clearSecretClaimActions(result.actions);
      clearSecretMaterial(true);
      setStatus({ kind: "error", message: safePreparationMessage(error) });
    } finally {
      if (!storedForExecution && result) clearSecretClaimActions(result.actions);
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
    const session = sessionKey ? getSecretClaimSession(sessionKey) : undefined;
    if (!session || !readiness || !hasSecretClaimSession(sessionKey!)) {
      clearSecretMaterial(true);
      setStatus({ kind: "error", message: "Prepared TX2 state is unavailable; prepare it again." });
      mutex.release();
      return;
    }

    setStatus({ kind: "pending", message: "Rechecking Mainnet immediately before execution…" });
    let walletSettled = false;
    const onWalletSettled = () => {
      if (walletSettled) return;
      walletSettled = true;
      clearSecretMaterial(true);
    };

    try {
      const refreshed = await revalidatePaymentAClaim({
        provider,
        conditionalPay,
        previous: readiness,
      });
      setReadiness(refreshed);
      setStatus({ kind: "pending", message: "Waiting for Ready X confirmation…" });
      const transactionHash = await executeActions(session.actions, onWalletSettled);
      onWalletSettled();
      setStatus(
        transactionHash
          ? { kind: "ok", message: "TX2 submitted; secret-bearing state was cleared." }
          : { kind: "error", message: "TX2 was not submitted; secret-bearing state was cleared." },
      );
    } catch (error) {
      onWalletSettled();
      setStatus({ kind: "error", message: safePreparationMessage(error) });
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
    setStatus({ kind: "idle", message: "Prepared TX2 state was discarded." });
  };

  return (
    <section className={styles.panel} aria-label="Local Payment A TX2 execution utility">
      <div className={styles.warn}>
        Local development utility only. Credentials are decrypted in browser memory and are never
        rendered. JavaScript cannot guarantee cryptographic zeroization of immutable strings;
        cleanup is best-effort.
      </div>

      <label>
        Encrypted Payment A recovery envelope
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
        Verify recovery and prepare TX2
      </button>

      {readiness ? (
        <div>
          <div>Block depth: {readiness.depth}</div>
          <div>Payment: {readiness.paymentState}</div>
          <div>Locked liability: {readiness.lockedLiability}</div>
          <div>STRK20 fee: {readiness.feeWei}</div>
          <div>Approval required: no</div>
        </div>
      ) : null}

      {sanitizedPayload ? (
        <pre aria-label="Sanitized TX2 payload">{JSON.stringify(sanitizedPayload, null, 2)}</pre>
      ) : null}

      <div>{status.message}</div>

      <button
        type="button"
        className={styles.btnCta}
        disabled={!prepared || isSubmitting || attemptMutexRef.current?.isLocked()}
        onClick={handleExecute}
      >
        Execute TX2 CLAIM once
      </button>
      <button
        type="button"
        className={styles.btn}
        disabled={isSubmitting || attemptMutexRef.current?.isLocked()}
        onClick={handleCancel}
      >
        Discard prepared TX2
      </button>
    </section>
  );
}
