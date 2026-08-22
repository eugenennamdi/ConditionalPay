"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { STRK20_ACTION } from "starknet";
import styles from "../../../uni.module.css";
import {
  TX3_MINIMUM_EXPIRY_MARGIN_SECONDS,
  clearPaymentBCreateActions,
  createPaymentBExecutionAttemptMutex,
  preparePaymentBCreate,
  queryPaymentBBaseReadiness,
  revalidatePaymentBCreate,
  runPaymentBReadinessRefresh,
  safePaymentBCreateMessage,
  type PaymentBBaseReadiness,
  type PaymentBCreateReadiness,
  type PaymentBReadProvider,
  type PaymentBTx3Configuration,
} from "./paymentBCreateExecution";

interface PaymentBCreateExecutionPanelProps {
  conditionalPay: string;
  configuration: PaymentBTx3Configuration | null;
  token: string;
  networkName: string | undefined;
  isConnected: boolean;
  isMainnet: boolean;
  isSubmitting: boolean;
  provider: PaymentBReadProvider;
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

function formatStrk(wei: string): string {
  const value = BigInt(wei);
  const whole = value / 10n ** 18n;
  const fraction = (value % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction} STRK` : `${whole} STRK`;
}

function formatCountdown(seconds: bigint): string {
  if (seconds <= 0n) return "expired";
  const minutes = seconds / 60n;
  const remainder = seconds % 60n;
  return `${minutes}m ${remainder.toString().padStart(2, "0")}s`;
}

export default function PaymentBCreateExecutionPanel({
  conditionalPay,
  configuration,
  token,
  networkName,
  isConnected,
  isMainnet,
  isSubmitting,
  provider,
  executeActions,
}: PaymentBCreateExecutionPanelProps) {
  const [localDevelopment, setLocalDevelopment] = useState(false);
  const [readiness, setReadiness] = useState<PaymentBCreateReadiness | null>(null);
  const [baseReadiness, setBaseReadiness] = useState<PaymentBBaseReadiness | null>(null);
  const [prepared, setPrepared] = useState(false);
  const [nowUnix, setNowUnix] = useState(() => BigInt(Math.floor(Date.now() / 1000)));
  const [status, setStatus] = useState<PanelStatus>({
    kind: "idle",
    message: "Waiting for a fresh, recovery-verified Payment B configuration.",
  });
  const actionsRef = useRef<STRK20_ACTION[] | null>(null);
  const attemptMutexRef = useRef<ReturnType<typeof createPaymentBExecutionAttemptMutex> | null>(
    null,
  );
  if (attemptMutexRef.current === null) {
    attemptMutexRef.current = createPaymentBExecutionAttemptMutex();
  }

  const clearPreparedMaterial = useCallback(() => {
    if (actionsRef.current) clearPaymentBCreateActions(actionsRef.current);
    actionsRef.current = null;
    setPrepared(false);
  }, []);

  useEffect(() => {
    setLocalDevelopment(
      process.env.NODE_ENV === "development" &&
        (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"),
    );
    return () => clearPreparedMaterial();
  }, [clearPreparedMaterial]);

  useEffect(() => {
    const timer = window.setInterval(
      () => setNowUnix(BigInt(Math.floor(Date.now() / 1000))),
      1000,
    );
    return () => window.clearInterval(timer);
  }, []);

  const refreshReadiness = useCallback(async () => {
    const mutex = attemptMutexRef.current;
    if (!localDevelopment) {
      setStatus({ kind: "error", message: "TX3 readiness is available only on localhost." });
      return;
    }
    if (!mutex?.tryAcquire()) {
      setStatus({ kind: "error", message: "A TX3 readiness check is already running." });
      return;
    }
    clearPreparedMaterial();
    setReadiness(null);
    setBaseReadiness(null);
    type RefreshResult =
      | { kind: "base"; value: PaymentBBaseReadiness }
      | { kind: "payment"; value: Awaited<ReturnType<typeof preparePaymentBCreate>> };
    let result: RefreshResult | undefined;
    let retained = false;
    try {
      await runPaymentBReadinessRefresh<RefreshResult>({
        onChecking: () => {
          setStatus({ kind: "pending", message: "Checking current Mainnet readiness…" });
        },
        read: async () =>
          configuration
            ? {
                kind: "payment",
                value: await preparePaymentBCreate({
                  provider,
                  conditionalPay,
                  configuration,
                  isMainnet,
                }),
              }
            : {
                kind: "base",
                value: await queryPaymentBBaseReadiness({
                  provider,
                  conditionalPay,
                  token,
                  isMainnet,
                }),
              },
        onReady: (value) => {
          result = value;
          if (value.kind === "payment") {
            actionsRef.current = value.value.actions;
            retained = true;
            setReadiness(value.value.readiness);
            setBaseReadiness({
              network: "MAINNET",
              currentBlock: value.value.readiness.currentBlock,
              checkedAtUnix: value.value.readiness.checkedAtUnix,
              lockedLiability: value.value.readiness.lockedLiability,
              feeWei: value.value.readiness.feeWei,
            });
            setPrepared(true);
            setStatus({
              kind: "ok",
              message: "TX3 is recovery-verified, canonical, and ready for one explicit execution.",
            });
            return;
          }
          setBaseReadiness(value.value);
          setStatus({
            kind: "ok",
            message: "Mainnet readiness passed. Generate a fresh Payment B before TX3 execution.",
          });
        },
        onError: (error) => {
          setStatus({ kind: "error", message: safePaymentBCreateMessage(error) });
        },
      });
    } finally {
      if (!retained && result?.kind === "payment") {
        clearPaymentBCreateActions(result.value.actions);
      }
      result = undefined;
      mutex.release();
    }
  }, [clearPreparedMaterial, conditionalPay, configuration, isMainnet, localDevelopment, provider, token]);

  useEffect(() => {
    if (!localDevelopment) return;
    void refreshReadiness();
  }, [configuration, localDevelopment, refreshReadiness]);

  useEffect(() => {
    if (!isConnected || !isMainnet) {
      clearPreparedMaterial();
    }
  }, [clearPreparedMaterial, isConnected, isMainnet]);

  if (!localDevelopment) return null;

  const remainingSeconds = configuration
    ? BigInt(configuration.expiresAtUnix) - nowUnix
    : 0n;
  const hasSafetyMargin = remainingSeconds >= TX3_MINIMUM_EXPIRY_MARGIN_SECONDS;

  const handleExecute = async () => {
    const mutex = attemptMutexRef.current;
    if (!mutex?.tryAcquire()) return;
    const actions = actionsRef.current;
    if (!configuration || !readiness || !prepared || !actions || !isConnected || !isMainnet) {
      clearPreparedMaterial();
      setStatus({ kind: "error", message: "Prepared TX3 state is unavailable; refresh it." });
      mutex.release();
      return;
    }

    setStatus({ kind: "pending", message: "Rechecking Mainnet immediately before execution…" });
    let walletSettled = false;
    const onWalletSettled = () => {
      if (walletSettled) return;
      walletSettled = true;
      clearPreparedMaterial();
    };

    try {
      const refreshed = await revalidatePaymentBCreate({
        provider,
        conditionalPay,
        configuration,
        previous: readiness,
        isMainnet,
      });
      setReadiness(refreshed);
      setStatus({ kind: "pending", message: "Waiting for Ready X confirmation…" });
      const transactionHash = await executeActions(actions, onWalletSettled);
      onWalletSettled();
      setStatus(
        transactionHash
          ? { kind: "ok", message: "TX3 submitted; prepared state was cleared." }
          : { kind: "error", message: "TX3 was not submitted; prepared state was cleared." },
      );
    } catch (error) {
      onWalletSettled();
      setStatus({ kind: "error", message: safePaymentBCreateMessage(error) });
    } finally {
      onWalletSettled();
      mutex.release();
    }
  };

  return (
    <section className={styles.executionUtility} aria-label="Local Payment B TX3 execution utility">
      <div className={styles.utilityEyebrow}>LOCAL MAINNET EVIDENCE UTILITY</div>
      <h2 className={styles.utilityTitle}>ConditionalPay CREATE (Payment B) — TX3</h2>
      <p className={styles.utilityCopy}>
        Separate from TX1. Public CREATE parameters are loaded only after encrypted recovery
        generation and decrypt/recompute verification complete outside the repository.
      </p>

      <div className={styles.utilityGrid}>
        <div><span>Network</span><strong>{networkName ?? "Unsupported"}</strong></div>
        <div><span>Payment B ID</span><strong>{configuration?.paymentId ?? "not loaded"}</strong></div>
        <div><span>Amount</span><strong>{configuration ? formatStrk(configuration.amount) : "not configured"}</strong></div>
        <div><span>Expiry</span><strong>{configuration ? new Date(Number(configuration.expiresAtUnix) * 1000).toISOString() : "not configured"}</strong></div>
        <div><span>Countdown</span><strong>{configuration ? formatCountdown(remainingSeconds) : "not configured"}</strong></div>
        <div><span>Recovery</span><strong>{configuration?.recoveryRoundtripVerified ? "verified" : "not configured"}</strong></div>
        <div><span>Envelope</span><strong>{configuration?.envelopeFilename ?? "not configured"}</strong></div>
        <div><span>Payment state</span><strong>{configuration ? readiness?.paymentState ?? "checking" : "not configured"}</strong></div>
        <div><span>Locked liability</span><strong>{readiness?.lockedLiability ?? baseReadiness?.lockedLiability ?? "checking"}</strong></div>
        <div><span>Current fee</span><strong>{readiness ? formatStrk(readiness.feeWei) : baseReadiness ? formatStrk(baseReadiness.feeWei) : "checking"}</strong></div>
        <div><span>Action topology</span><strong>{configuration ? readiness?.actionTopology.join(" → ") ?? "checking" : "not configured"}</strong></div>
      </div>
      {!configuration ? (
        <div className={styles.warn}>No fresh Payment B is configured. TX3 execution remains disabled.</div>
      ) : null}

      <div className={status.kind === "error" ? styles.utilityStatusError : styles.utilityStatus}>
        {status.message}
      </div>

      <button
        type="button"
        className={styles.btnCta}
        disabled={isSubmitting || attemptMutexRef.current?.isLocked()}
        onClick={() => void refreshReadiness()}
      >
        Refresh TX3 readiness
      </button>
      <button
        type="button"
        className={styles.btnCta}
        disabled={
          !prepared ||
          !hasSafetyMargin ||
          !isConnected ||
          !isMainnet ||
          isSubmitting ||
          attemptMutexRef.current?.isLocked()
        }
        onClick={handleExecute}
      >
        Execute CREATE Payment B (TX3)
      </button>
    </section>
  );
}
