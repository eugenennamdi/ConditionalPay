'use client';

import React, { useRef, useState } from 'react';
import type { ProviderInterface } from 'starknet';
import type { WalletWithStarknetFeatures } from '@starknet-io/get-starknet-wallet-standard/features';
import styles from '../console.module.css';
import {
  isReceiptAccepted,
  isReceiptReverted,
  normalizeSettlementWalletError,
  preflightSettlement,
  type StarknetReceiptStatus,
  submitRefundPayment,
  verifySettlementOnchain,
} from '../_lib/settlementExecution';
import type {
  ImportedRefundCredential,
  SettlementPreflight,
  SettlementResultState,
  SettlementStep,
} from '../_lib/settlementTypes';
import SettlementImport from './SettlementImport';
import SettlementPreview from './SettlementPreview';
import SettlementResult from './SettlementResult';

interface RefundPaymentProps {
  wallet: WalletWithStarknetFeatures | null;
  provider: ProviderInterface;
  walletConnected: boolean;
  onConnectWallet: () => void;
  walletAddress?: string;
}

export default function RefundPayment({
  wallet,
  provider,
  walletConnected,
  onConnectWallet,
  walletAddress,
}: RefundPaymentProps) {
  const [step, setStep] = useState<SettlementStep>('IMPORT');
  const [creds, setCreds] = useState<ImportedRefundCredential | null>(null);
  const [preflight, setPreflight] = useState<SettlementPreflight | null>(null);
  const [txHash, setTxHash] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isRechecking, setIsRechecking] = useState<boolean>(false);

  const submitMutex = useRef<boolean>(false);
  const reviewedAddressRef = useRef<string | undefined>(walletAddress);

  async function handleImportSuccess(importedCreds: ImportedRefundCredential) {
    setError('');
    setCreds(importedCreds);

    try {
      const preflightResult = await preflightSettlement(provider, 'refund', importedCreds);
      setPreflight(preflightResult);
      reviewedAddressRef.current = walletAddress;
      setStep('REVIEWING');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Preflight validation failed.';
      setError(msg);
    }
  }

  async function handleSubmitRefund() {
    if (submitMutex.current || !wallet || !creds || !preflight || !walletAddress) {
      return;
    }

    // Recipient stability check: if wallet account changed, invalidate submission and prompt re-review
    if (reviewedAddressRef.current && walletAddress && reviewedAddressRef.current !== walletAddress) {
      setError('Wallet account changed. Review the settlement again before continuing.');
      reviewedAddressRef.current = walletAddress;
      setStep('REVIEWING');
      return;
    }

    submitMutex.current = true;
    setIsSubmitting(true);
    setError('');
    setStep('AWAITING_WALLET');

    try {
      const hash = await submitRefundPayment(
        wallet,
        creds.paymentId,
        creds.refundPreimage,
        preflight.token,
        walletAddress,
      );

      setTxHash(hash);
      setStep('SUBMITTED');
      void pollReceipt(hash);
    } catch (err: unknown) {
      submitMutex.current = false;
      setIsSubmitting(false);
      const normalizedError = normalizeSettlementWalletError(err, 'refund');
      setError(normalizedError);
      setStep('REVIEWING');
    }
  }

  async function pollReceipt(hash: string) {
    setStep('PENDING');

    let attempts = 0;
    const maxAttempts = 15;

    while (attempts < maxAttempts) {
      attempts++;
      try {
        const receipt = (await provider.getTransactionReceipt(hash)) as unknown as StarknetReceiptStatus;

        if (isReceiptReverted(receipt)) {
          setStep('REVERTED');
          submitMutex.current = false;
          setIsSubmitting(false);

          // Check onchain state in case of race
          try {
            const verify = await verifySettlementOnchain(provider, 'refund', creds!.paymentId, hash);
            if (verify.onchainStateSettled) {
              setStep('VERIFIED');
              return;
            }
          } catch {
            // ignore
          }

          setError('Transaction reverted on Starknet.');
          return;
        }

        if (isReceiptAccepted(receipt)) {
          setStep('ACCEPTED');
          submitMutex.current = false;
          setIsSubmitting(false);
          await runVerification(hash);
          return;
        }
      } catch {
        // RPC error during polling
      }

      await new Promise((resolve) => setTimeout(resolve, 3000));
    }

    // Polling timeout: status unknown
    submitMutex.current = false;
    setIsSubmitting(false);
    setStep('STATUS_UNKNOWN');
  }

  async function runVerification(hash: string) {
    setStep('VERIFYING');

    try {
      const result = await verifySettlementOnchain(provider, 'refund', creds!.paymentId, hash);
      if (result.onchainStateSettled) {
        setStep('VERIFIED');
      } else {
        setStep('DEGRADED_VERIFICATION');
      }
    } catch {
      setStep('DEGRADED_VERIFICATION');
    }
  }

  async function handleRecheck() {
    if (!txHash || isRechecking) return;
    setIsRechecking(true);

    if (step === 'STATUS_UNKNOWN') {
      await pollReceipt(txHash);
    } else if (step === 'DEGRADED_VERIFICATION') {
      await runVerification(txHash);
    }

    setIsRechecking(false);
  }

  function handleBackToImport() {
    setError('');
    setCreds(null);
    setPreflight(null);
    setStep('IMPORT');
  }

  function handleReset() {
    setError('');
    setCreds(null);
    setPreflight(null);
    setTxHash('');
    submitMutex.current = false;
    setIsSubmitting(false);
    setStep('IMPORT');
  }

  const resultState: SettlementResultState = {
    txHash,
    step,
    mode: 'refund',
    amountFormatted: preflight?.amountFormatted ?? '0',
    paymentId: creds?.paymentId ?? '',
    errorMessage: error,
  };

  if (step === 'IMPORT') {
    return (
      <div className={styles.settlementContainer}>
        {error && (
          <div className={styles.errorAlert} role="alert">
            {error}
          </div>
        )}
        <SettlementImport
          mode="refund"
          onImportSuccess={(c) => void handleImportSuccess(c as ImportedRefundCredential)}
          isProcessing={false}
        />
      </div>
    );
  }

  if (step === 'REVIEWING' || step === 'AWAITING_WALLET') {
    return (
      <div className={styles.settlementContainer}>
        {preflight && (
          <SettlementPreview
            mode="refund"
            preflight={preflight}
            onBack={handleBackToImport}
            onSubmit={() => void handleSubmitRefund()}
            isSubmitting={isSubmitting}
            walletConnected={walletConnected}
            onConnectWallet={onConnectWallet}
            walletAddress={walletAddress}
            errorMessage={error}
          />
        )}
      </div>
    );
  }

  // SUBMITTED, PENDING, ACCEPTED, VERIFYING, VERIFIED, STATUS_UNKNOWN, DEGRADED_VERIFICATION, REVERTED
  return (
    <div className={styles.settlementContainer}>
      {step === 'REVERTED' ? (
        <div className={styles.revertContainer}>
          <div className={styles.errorAlert} role="alert">
            {error || 'Transaction reverted on Starknet.'}
          </div>
          <div className={styles.actionRow}>
            <button type="button" className={styles.secondaryBtn} onClick={handleBackToImport}>
              Back to import
            </button>
            <button
              type="button"
              className={styles.primaryBtn}
              onClick={() => {
                setError('');
                setStep('REVIEWING');
              }}
            >
              Review and retry
            </button>
          </div>
        </div>
      ) : (
        <SettlementResult
          state={resultState}
          onRecheck={() => void handleRecheck()}
          isRechecking={isRechecking}
          onSettleAnother={handleReset}
        />
      )}
    </div>
  );
}
