'use client';

import React, { useState } from 'react';
import { exportSinglePaymentCredentials } from '@conditionalpay/sdk';
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

function formatAddress(addr: string): string {
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
  const [passphrase, setPassphrase] = useState<string>('');
  const [confirmPassphrase, setConfirmPassphrase] = useState<string>('');
  const [passphraseError, setPassphraseError] = useState<string>('');
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [downloadInitiated, setDownloadInitiated] = useState<boolean>(false);

  async function handleExportDownload() {
    setPassphraseError('');

    if (passphrase.length < 8) {
      setPassphraseError('Passphrase must be at least 8 characters long.');
      return;
    }

    if (passphrase !== confirmPassphrase) {
      setPassphraseError('Passphrase and confirmation do not match.');
      return;
    }

    setIsExporting(true);

    try {
      const envelope = await exportSinglePaymentCredentials(
        {
          paymentId: planned.paymentId,
          claimPreimage: planned.claimPreimage,
          refundPreimage: planned.refundPreimage,
          nonce: planned.nonce,
        },
        passphrase,
      );

      const jsonStr = JSON.stringify(envelope, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `conditionalpay-${planned.paymentId.slice(0, 10)}.encrypted.json`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);

      setTimeout(() => {
        URL.revokeObjectURL(url);
      }, 1000);

      setDownloadInitiated(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Encryption failed.';
      setPassphraseError(msg);
    } finally {
      setIsExporting(false);
    }
  }

  const isPending = step === 'SUBMITTED' || step === 'PENDING';
  const isStatusUnknown = step === 'STATUS_UNKNOWN';
  const isAccepted = step === 'ACCEPTED';
  const isVerifying = step === 'VERIFYING';
  const isVerified = step === 'VERIFIED';
  const isDegraded = step === 'DEGRADED_VERIFICATION';

  const showRecheck = isStatusUnknown || isDegraded;

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

      {/* Save Recovery File Surface (Active upon ACCEPTED, VERIFIED, or DEGRADED) */}
      {!isPending && (
        <div className={styles.recoveryCard}>
          <div className={styles.recoveryHeader}>
            <h3 className={styles.recoveryTitle}>SAVE RECOVERY FILE</h3>
            <p className={styles.recoveryDesc}>
              This encrypted file contains the bearer credentials needed to CLAIM or REFUND this
              payment. Protect it with a passphrase.
            </p>
          </div>

          {passphraseError && (
            <div className={styles.recoveryAlert} role="alert">
              {passphraseError}
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
                value={passphrase}
                onChange={(e) => {
                  setPassphrase(e.target.value);
                  if (passphraseError) setPassphraseError('');
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
                value={confirmPassphrase}
                onChange={(e) => {
                  setConfirmPassphrase(e.target.value);
                  if (passphraseError) setPassphraseError('');
                }}
              />
            </div>
          </div>

          <div className={styles.downloadActionRow}>
            <button
              type="button"
              className={styles.primaryBtn}
              onClick={handleExportDownload}
              disabled={isExporting}
            >
              {isExporting ? 'Encrypting…' : 'Download Encrypted Recovery (.json)'}
            </button>
          </div>

          {downloadInitiated && (
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
