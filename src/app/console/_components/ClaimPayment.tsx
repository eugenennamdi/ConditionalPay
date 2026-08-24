'use client';

import React, { useRef, useState } from 'react';
import type { ProviderInterface } from 'starknet';
import type { WalletWithStarknetFeatures } from '@starknet-io/get-starknet-wallet-standard/features';
import { exportClaimAccessCredentials } from '@conditionalpay/sdk';
import styles from '../console.module.css';
import {
  isReceiptAccepted,
  isReceiptReverted,
  normalizeSettlementWalletError,
  preflightSettlement,
  type StarknetReceiptStatus,
  submitClaimPayment,
  validateClaimAccessDerivation,
  verifySettlementOnchain,
} from '../_lib/settlementExecution';
import type {
  ImportedClaimCredential,
  SettlementPreflight,
  SettlementResultState,
  SettlementStep,
} from '../_lib/settlementTypes';
import SettlementImport from './SettlementImport';
import SettlementPreview from './SettlementPreview';
import SettlementResult from './SettlementResult';

interface ClaimPaymentProps {
  wallet: WalletWithStarknetFeatures | null;
  provider: ProviderInterface;
  walletConnected: boolean;
  onConnectWallet: () => void;
  walletAddress?: string;
}

function formatAddress(addr?: string): string {
  if (!addr) return '';
  if (addr.length <= 14) return addr;
  return `${addr.slice(0, 8)}…${addr.slice(-6)}`;
}

export default function ClaimPayment({
  wallet,
  provider,
  walletConnected,
  onConnectWallet,
  walletAddress,
}: ClaimPaymentProps) {
  const [step, setStep] = useState<SettlementStep>('IMPORT');
  const [creds, setCreds] = useState<ImportedClaimCredential | null>(null);
  const [preflight, setPreflight] = useState<SettlementPreflight | null>(null);
  const [txHash, setTxHash] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isRechecking, setIsRechecking] = useState<boolean>(false);

  // Derivation state
  const [derivePassphrase, setDerivePassphrase] = useState<string>('');
  const [deriveConfirm, setDeriveConfirm] = useState<string>('');
  const [deriveError, setDeriveError] = useState<string>('');
  const [deriveSuccess, setDeriveSuccess] = useState<boolean>(false);
  const [isDeriving, setIsDeriving] = useState<boolean>(false);

  const submitMutex = useRef<boolean>(false);
  const reviewedAddressRef = useRef<string | undefined>(walletAddress);

  async function handleImportSuccess(importedCreds: ImportedClaimCredential) {
    setError('');
    setCreds(importedCreds);

    try {
      const preflightResult = await preflightSettlement(provider, 'claim', importedCreds);
      setPreflight(preflightResult);

      if (importedCreds.isSelfClaim) {
        // Validate onchain state for derivation
        const derivationValidation = await validateClaimAccessDerivation(
          provider,
          importedCreds.paymentId,
        );
        if (!derivationValidation.isValid) {
          setError(derivationValidation.errorReason || 'Unable to verify payment status.');
        }
        setStep('CREATOR_CHOICE');
        return;
      }

      // Normal claimant flow with v1.2 claim-access artifact
      reviewedAddressRef.current = walletAddress;
      setStep('REVIEWING');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Preflight validation failed.';
      setError(msg);
    }
  }

  async function handleSubmitClaim() {
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
      const hash = await submitClaimPayment(
        wallet,
        creds.paymentId,
        creds.claimPreimage,
        preflight.token,
        walletAddress,
      );

      setTxHash(hash);
      setStep('SUBMITTED');
      void pollReceipt(hash);
    } catch (err: unknown) {
      submitMutex.current = false;
      setIsSubmitting(false);
      const normalizedError = normalizeSettlementWalletError(err, 'claim');
      setError(normalizedError);
      setStep('REVIEWING');
    }
  }

  async function handleDeriveClaimAccess(e: React.FormEvent) {
    e.preventDefault();
    setDeriveError('');

    if (!creds) {
      setDeriveError('No credential loaded.');
      return;
    }

    if (derivePassphrase.length < 8) {
      setDeriveError('Recipient passphrase must be at least 8 characters long.');
      return;
    }

    if (derivePassphrase !== deriveConfirm) {
      setDeriveError('Passphrases do not match.');
      return;
    }

    setIsDeriving(true);

    try {
      // Validate onchain state before export
      const validation = await validateClaimAccessDerivation(provider, creds.paymentId);
      if (!validation.isValid) {
        setDeriveError(validation.errorReason || 'Claim access cannot be generated.');
        setIsDeriving(false);
        return;
      }

      // Retain only paymentId and claimPreimage for derivation
      const payload = {
        paymentId: creds.paymentId,
        claimPreimage: creds.claimPreimage,
      };

      const envelope = await exportClaimAccessCredentials(payload, derivePassphrase);

      // Clear passphrase references immediately
      setDerivePassphrase('');
      setDeriveConfirm('');

      // Trigger browser download
      const blob = new Blob([JSON.stringify(envelope, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `conditionalpay-claim-${creds.paymentId.slice(0, 10)}.encrypted.json`;
      a.click();
      URL.revokeObjectURL(url);

      setDeriveSuccess(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to export claim access.';
      setDeriveError(msg);
    } finally {
      setIsDeriving(false);
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
            const verify = await verifySettlementOnchain(provider, 'claim', creds!.paymentId, hash);
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

    // Polling timed out without definitive receipt
    setStep('STATUS_UNKNOWN');
    submitMutex.current = false;
    setIsSubmitting(false);
  }

  async function runVerification(hash: string) {
    setStep('VERIFYING');
    try {
      const result = await verifySettlementOnchain(provider, 'claim', creds!.paymentId, hash);
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
    if (!creds || !txHash) return;
    setIsRechecking(true);
    setError('');

    try {
      if (step === 'STATUS_UNKNOWN') {
        const receipt = (await provider.getTransactionReceipt(txHash)) as unknown as StarknetReceiptStatus;
        if (isReceiptReverted(receipt)) {
          setStep('REVERTED');
          setError('Transaction reverted on Starknet.');
          return;
        }
        if (isReceiptAccepted(receipt)) {
          setStep('ACCEPTED');
          await runVerification(txHash);
          return;
        }
      }

      if (step === 'DEGRADED_VERIFICATION' || step === 'ACCEPTED' || step === 'VERIFYING') {
        await runVerification(txHash);
      }
    } catch {
      // Re-check failed
    } finally {
      setIsRechecking(false);
    }
  }

  function handleBackToImport() {
    setStep('IMPORT');
    setCreds(null);
    setPreflight(null);
    setTxHash('');
    setError('');
    setDerivePassphrase('');
    setDeriveConfirm('');
    setDeriveError('');
    setDeriveSuccess(false);
  }

  function handleReset() {
    handleBackToImport();
  }

  const resultState: SettlementResultState = {
    txHash,
    step,
    mode: 'claim',
    amountFormatted: preflight?.amountFormatted ?? '0.0',
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
          mode="claim"
          onImportSuccess={(c) => void handleImportSuccess(c as ImportedClaimCredential)}
          isProcessing={false}
        />
      </div>
    );
  }

  if (step === 'CREATOR_CHOICE') {
    return (
      <div className={styles.settlementContainer}>
        <div className={styles.settlementCard}>
          <div className={styles.settlementHeader}>
            <div className={styles.settlementTitleRow}>
              <h2 className={styles.formTitle}>CREATOR RECOVERY</h2>
              <span className={styles.creatorBadge}>CREATOR ONLY</span>
            </div>
            <p className={styles.settlementSubtitle}>
              This recovery can be used to claim the payment yourself or create encrypted access for a recipient.
            </p>
          </div>

          {creds && (
            <div className={styles.identifiersCard}>
              <div className={styles.identifierItem}>
                <span className={styles.previewLabel}>Payment ID</span>
                <code className={styles.previewCode} title={creds.paymentId}>
                  {formatAddress(creds.paymentId)}
                </code>
              </div>
              <div className={styles.identifierItem}>
                <span className={styles.previewLabel}>Status</span>
                <span className={styles.statusActiveText}>● ACTIVE</span>
              </div>
            </div>
          )}

          {error && (
            <div className={styles.errorAlert} role="alert">
              {error}
            </div>
          )}

          <div className={styles.actionRow}>
            <button
              type="button"
              className={styles.secondaryBtn}
              onClick={() => {
                setError('');
                setDeriveError('');
                setDeriveSuccess(false);
                setStep('DERIVE_CLAIM_ACCESS');
              }}
            >
              Create claim access
            </button>
            <button
              type="button"
              className={styles.primaryBtn}
              onClick={() => {
                setError('');
                reviewedAddressRef.current = walletAddress;
                setStep('REVIEWING');
              }}
            >
              Review self-claim
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (step === 'DERIVE_CLAIM_ACCESS') {
    return (
      <div className={styles.settlementContainer}>
        <div className={styles.settlementCard}>
          <div className={styles.settlementHeader}>
            <div className={styles.settlementTitleRow}>
              <h2 className={styles.formTitle}>CLAIM ACCESS</h2>
              <span className={styles.recipientBadge}>RECIPIENT HANDOFF</span>
            </div>
            <p className={styles.settlementSubtitle}>
              Create encrypted claim access for the recipient. This file can claim the payment. It cannot refund it. Anyone with this file and its passphrase can claim the payment while the claim path is valid.
            </p>
          </div>

          {deriveSuccess ? (
            <div className={styles.successCard}>
              <p className={styles.successMessage}>
                ✓ Claim access file downloaded. Provide this file and its passphrase to the recipient.
              </p>
              <div className={styles.actionRow}>
                <button
                  type="button"
                  className={styles.secondaryBtn}
                  onClick={() => {
                    setStep('CREATOR_CHOICE');
                    setDeriveSuccess(false);
                  }}
                >
                  Back to options
                </button>
                <button
                  type="button"
                  className={styles.primaryBtn}
                  onClick={() => {
                    setError('');
                    reviewedAddressRef.current = walletAddress;
                    setStep('REVIEWING');
                  }}
                >
                  Review self-claim
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleDeriveClaimAccess} className={styles.deriveForm}>
              <div className={styles.passphraseGrid}>
                <div className={styles.formField}>
                  <label htmlFor="derive-claim-passphrase" className={styles.formLabel}>
                    Recipient claim passphrase (min 8 characters)
                  </label>
                  <input
                    id="derive-claim-passphrase"
                    type="password"
                    autoComplete="new-password"
                    placeholder="Enter recipient passphrase"
                    className={styles.formInput}
                    value={derivePassphrase}
                    onChange={(e) => {
                      setDerivePassphrase(e.target.value);
                      if (deriveError) setDeriveError('');
                    }}
                  />
                </div>

                <div className={styles.formField}>
                  <label htmlFor="derive-claim-confirm" className={styles.formLabel}>
                    Confirm recipient claim passphrase
                  </label>
                  <input
                    id="derive-claim-confirm"
                    type="password"
                    autoComplete="new-password"
                    placeholder="Confirm recipient passphrase"
                    className={styles.formInput}
                    value={deriveConfirm}
                    onChange={(e) => {
                      setDeriveConfirm(e.target.value);
                      if (deriveError) setDeriveError('');
                    }}
                  />
                </div>
              </div>

              {deriveError && (
                <div className={styles.errorAlert} role="alert">
                  {deriveError}
                </div>
              )}

              <div className={styles.actionRow}>
                <button
                  type="button"
                  className={styles.secondaryBtn}
                  onClick={() => {
                    setStep('CREATOR_CHOICE');
                    setDeriveError('');
                    setDerivePassphrase('');
                    setDeriveConfirm('');
                  }}
                  disabled={isDeriving}
                >
                  Back
                </button>
                <button
                  type="submit"
                  className={styles.primaryBtn}
                  disabled={isDeriving || derivePassphrase.length < 8 || deriveConfirm.length < 8}
                >
                  {isDeriving ? 'Encrypting…' : 'Download claim access'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    );
  }

  if (step === 'REVIEWING' || step === 'AWAITING_WALLET') {
    return (
      <div className={styles.settlementContainer}>
        {error && (
          <div className={styles.errorAlert} role="alert">
            {error}
          </div>
        )}
        {preflight && (
          <SettlementPreview
            mode="claim"
            preflight={preflight}
            isSelfClaim={creds?.isSelfClaim}
            onBack={handleBackToImport}
            onSubmit={() => void handleSubmitClaim()}
            isSubmitting={isSubmitting}
            walletConnected={walletConnected}
            onConnectWallet={onConnectWallet}
            walletAddress={walletAddress}
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
