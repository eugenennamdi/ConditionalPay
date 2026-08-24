'use client';

import React, { useState } from 'react';
import { exportClaimAccessCredentials, exportSinglePaymentCredentials } from '@conditionalpay/sdk';
import styles from '../console.module.css';
import { CreateStep, PlannedCreate } from '../_lib/createTypes';

interface CredentialHandoffProps {
  planned: PlannedCreate;
  txHash: string;
  step: CreateStep;
  backupSaved: boolean;
  onBackupSavedChange: (saved: boolean) => void;
  onRecheck: () => void;
  isRechecking?: boolean;
  onCreateAnother: () => void;
}

function formatAddress(addr?: string): string {
  if (!addr) return '';
  if (addr.length <= 14) return addr;
  return `${addr.slice(0, 8)}…${addr.slice(-6)}`;
}

export default function CredentialHandoff({
  planned,
  txHash,
  step,
  backupSaved,
  onBackupSavedChange,
  onRecheck,
  isRechecking = false,
  onCreateAnother,
}: CredentialHandoffProps) {
  // Creator Recovery State
  const [recoveryPassphrase, setRecoveryPassphrase] = useState<string>('');
  const [confirmRecoveryPassphrase, setConfirmRecoveryPassphrase] = useState<string>('');
  const [recoveryError, setRecoveryError] = useState<string>('');
  const [isExportingRecovery, setIsExportingRecovery] = useState<boolean>(false);
  const [recoveryDownloaded, setRecoveryDownloaded] = useState<boolean>(false);

  // Claim Access State
  const [claimPassphrase, setClaimPassphrase] = useState<string>('');
  const [confirmClaimPassphrase, setConfirmClaimPassphrase] = useState<string>('');
  const [claimError, setClaimError] = useState<string>('');
  const [isExportingClaim, setIsExportingClaim] = useState<boolean>(false);
  const [claimDownloaded, setClaimDownloaded] = useState<boolean>(false);
  const [isClaimAccessExpanded, setIsClaimAccessExpanded] = useState<boolean>(false);

  async function handleExportRecovery() {
    setRecoveryError('');

    if (recoveryPassphrase.length < 8) {
      setRecoveryError('Passphrase must be at least 8 characters long.');
      return;
    }

    if (recoveryPassphrase !== confirmRecoveryPassphrase) {
      setRecoveryError('Passphrase and confirmation do not match.');
      return;
    }

    setIsExportingRecovery(true);

    try {
      const envelope = await exportSinglePaymentCredentials(
        {
          paymentId: planned.paymentId,
          claimPreimage: planned.claimPreimage,
          refundPreimage: planned.refundPreimage,
          nonce: planned.nonce,
        },
        recoveryPassphrase,
      );

      const jsonStr = JSON.stringify(envelope, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `conditionalpay-recovery-${planned.paymentId.slice(0, 10)}.encrypted.json`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);

      setTimeout(() => {
        URL.revokeObjectURL(url);
      }, 1000);

      setRecoveryDownloaded(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Encryption failed.';
      setRecoveryError(msg);
    } finally {
      setIsExportingRecovery(false);
    }
  }

  async function handleExportClaimAccess() {
    setClaimError('');

    if (claimPassphrase.length < 8) {
      setClaimError('Passphrase must be at least 8 characters long.');
      return;
    }

    if (claimPassphrase !== confirmClaimPassphrase) {
      setClaimError('Passphrase and confirmation do not match.');
      return;
    }

    setIsExportingClaim(true);

    try {
      const envelope = await exportClaimAccessCredentials(
        {
          paymentId: planned.paymentId,
          claimPreimage: planned.claimPreimage,
        },
        claimPassphrase,
      );

      const jsonStr = JSON.stringify(envelope, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `conditionalpay-claim-${planned.paymentId.slice(0, 10)}.encrypted.json`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);

      setTimeout(() => {
        URL.revokeObjectURL(url);
      }, 1000);

      setClaimDownloaded(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Encryption failed.';
      setClaimError(msg);
    } finally {
      setIsExportingClaim(false);
    }
  }

  const isPending = step === 'SUBMITTED' || step === 'PENDING';
  const isStatusUnknown = step === 'STATUS_UNKNOWN';
  const isAccepted = step === 'ACCEPTED';
  const isVerifying = step === 'VERIFYING';
  const isVerified = step === 'VERIFIED';
  const isDegraded = step === 'DEGRADED_VERIFICATION';

  const showRecheck = isStatusUnknown || isDegraded;
  const isClaimAccessAvailable = isAccepted || isVerifying || isVerified || isDegraded;

  return (
    <div className={styles.handoffContainer}>
      {/* Status Header */}
      <div className={styles.handoffHeader}>
        <div className={styles.handoffTitleRow}>
          <h2 className={styles.handoffTitle}>
            {isVerified
              ? 'PAYMENT CREATED'
              : isStatusUnknown || isPending
              ? 'TRANSACTION SUBMITTED'
              : 'TRANSACTION ACCEPTED'}
          </h2>
          {isVerified && <span className={styles.statusActiveBadge}>● ACTIVE</span>}
          {isPending && <span className={styles.statusPendingBadge}>PENDING</span>}
          {isStatusUnknown && <span className={styles.statusPendingBadge}>STATUS UNKNOWN</span>}
        </div>

        <p className={styles.handoffSubtitle}>
          {isPending && 'Transaction submitted. Waiting for Starknet confirmation…'}
          {isStatusUnknown &&
            'Starknet confirmation is temporarily unavailable. Save your recovery file while we re-check the transaction.'}
          {isAccepted &&
            'Transaction accepted. Save your recovery file while ConditionalPay verifies the payment.'}
          {isVerifying && 'Transaction accepted. Verifying onchain payment…'}
          {isVerified && 'Payment verified on Starknet.'}
          {isDegraded &&
            'Onchain payment verification is temporarily unavailable. Save your recovery file below.'}
        </p>

        {showRecheck && (
          <div className={styles.recheckRow}>
            <button
              type="button"
              className={styles.secondaryBtnSmall}
              onClick={onRecheck}
              disabled={isRechecking}
            >
              {isRechecking ? 'Checking…' : 'Re-check'}
            </button>
          </div>
        )}
      </div>

      {/* Identifiers Card */}
      <div className={styles.identifiersCard}>
        <div className={styles.identifierItem}>
          <span className={styles.identifierLabel}>Payment ID</span>
          <code className={styles.identifierCode} title={planned.paymentId}>
            {formatAddress(planned.paymentId)}
          </code>
        </div>

        <div className={styles.identifierItem}>
          <span className={styles.identifierLabel}>Transaction</span>
          <a
            href={`https://voyager.online/tx/${txHash}`}
            target="_blank"
            rel="noreferrer"
            className={styles.txLink}
            title={txHash}
          >
            <code>{formatAddress(txHash)}</code>
            <span aria-hidden="true">↗</span>
          </a>
        </div>

        <div className={styles.identifierItem}>
          <span className={styles.identifierLabel}>Amount</span>
          <span className={styles.identifierValue}>{planned.amountFormatted} STRK</span>
        </div>

        <div className={styles.identifierItem}>
          <span className={styles.identifierLabel}>Refund available</span>
          <span className={styles.identifierValue}>{planned.refundDateFormatted}</span>
        </div>
      </div>

      {/* Creator Recovery Surface */}
      {!isPending && (
        <div className={styles.recoveryCard}>
          <div className={styles.recoveryHeader}>
            <div className={styles.sectionBadgeRow}>
              <h3 className={styles.recoveryTitle}>CREATOR RECOVERY</h3>
              <span className={styles.creatorBadge}>CREATOR ONLY</span>
            </div>
            <p className={styles.recoveryDesc}>
              Save this encrypted backup to recover or refund your payment. Do not share your recovery file.
            </p>
          </div>

          {recoveryError && (
            <div className={styles.recoveryAlert} role="alert">
              {recoveryError}
            </div>
          )}

          <div className={styles.passphraseGrid}>
            <div className={styles.passphraseField}>
              <label htmlFor="recovery-passphrase" className={styles.formLabel}>
                Passphrase (min 8 characters)
              </label>
              <input
                id="recovery-passphrase"
                type="password"
                autoComplete="new-password"
                className={styles.passphraseInput}
                value={recoveryPassphrase}
                onChange={(e) => {
                  setRecoveryPassphrase(e.target.value);
                  if (recoveryError) setRecoveryError('');
                }}
              />
            </div>

            <div className={styles.passphraseField}>
              <label htmlFor="recovery-confirm-passphrase" className={styles.formLabel}>
                Confirm passphrase
              </label>
              <input
                id="recovery-confirm-passphrase"
                type="password"
                autoComplete="new-password"
                className={styles.passphraseInput}
                value={confirmRecoveryPassphrase}
                onChange={(e) => {
                  setConfirmRecoveryPassphrase(e.target.value);
                  if (recoveryError) setRecoveryError('');
                }}
              />
            </div>
          </div>

          <div className={styles.downloadActionRow}>
            <button
              type="button"
              className={styles.primaryBtn}
              onClick={handleExportRecovery}
              disabled={isExportingRecovery}
            >
              {isExportingRecovery ? 'Encrypting…' : 'Save recovery file'}
            </button>
          </div>

          {recoveryDownloaded && (
            <div className={styles.confirmationRow}>
              <label className={styles.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={backupSaved}
                  onChange={(e) => onBackupSavedChange(e.target.checked)}
                  className={styles.checkboxInput}
                />
                <span>I have downloaded and safely saved my recovery file</span>
              </label>
            </div>
          )}
        </div>
      )}

      {/* Claim Access Surface (Optional recipient handoff) */}
      {isClaimAccessAvailable && (
        <div className={styles.recoveryCard}>
          <div className={styles.recoveryHeader}>
            <div className={styles.sectionBadgeRow}>
              <h3 className={styles.recoveryTitle}>RECIPIENT HANDOFF</h3>
              <span className={styles.claimantBadge}>RECIPIENT HANDOFF</span>
            </div>
            <p className={styles.recoveryDesc}>
              Create encrypted claim access for the recipient. This lets the recipient claim the payment but cannot refund it.
            </p>
          </div>

          {!isClaimAccessExpanded ? (
            <div className={styles.downloadActionRow}>
              <button
                type="button"
                className={styles.secondaryBtn}
                onClick={() => setIsClaimAccessExpanded(true)}
              >
                Create claim access
              </button>
            </div>
          ) : (
            <>
              <p className={styles.recoverySubDesc}>
                Anyone with the claim-access file and its passphrase can claim the payment while the claim path is valid.
              </p>

              {claimError && (
                <div className={styles.recoveryAlert} role="alert">
                  {claimError}
                </div>
              )}

              <div className={styles.passphraseGrid}>
                <div className={styles.passphraseField}>
                  <label htmlFor="claim-passphrase" className={styles.formLabel}>
                    Recipient claim passphrase (min 8 characters)
                  </label>
                  <input
                    id="claim-passphrase"
                    type="password"
                    autoComplete="new-password"
                    className={styles.passphraseInput}
                    value={claimPassphrase}
                    onChange={(e) => {
                      setClaimPassphrase(e.target.value);
                      if (claimError) setClaimError('');
                    }}
                  />
                </div>

                <div className={styles.passphraseField}>
                  <label htmlFor="claim-confirm-passphrase" className={styles.formLabel}>
                    Confirm recipient claim passphrase
                  </label>
                  <input
                    id="claim-confirm-passphrase"
                    type="password"
                    autoComplete="new-password"
                    className={styles.passphraseInput}
                    value={confirmClaimPassphrase}
                    onChange={(e) => {
                      setConfirmClaimPassphrase(e.target.value);
                      if (claimError) setClaimError('');
                    }}
                  />
                </div>
              </div>

              <div className={styles.downloadActionRow}>
                <button
                  type="button"
                  className={styles.secondaryBtn}
                  onClick={handleExportClaimAccess}
                  disabled={isExportingClaim || claimPassphrase.length < 8 || confirmClaimPassphrase.length < 8}
                >
                  {isExportingClaim ? 'Encrypting…' : 'Download claim access'}
                </button>
              </div>

              {claimDownloaded && (
                <div className={styles.successCard}>
                  <p className={styles.successMessage}>
                    ✓ Claim access file downloaded. Provide this file and its passphrase to the recipient.
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Done & Create Another Payment */}
      <div className={styles.handoffFooter}>
        <button
          type="button"
          className={styles.secondaryBtn}
          onClick={onCreateAnother}
          disabled={!backupSaved && !isPending}
          title={!backupSaved ? 'Save your recovery file to continue' : undefined}
        >
          Create another payment
        </button>
      </div>
    </div>
  );
}
