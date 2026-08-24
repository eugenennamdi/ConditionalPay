'use client';

import React from 'react';
import styles from '../console.module.css';
import type { SettlementResultState } from '../_lib/settlementTypes';

interface SettlementResultProps {
  state: SettlementResultState;
  onRecheck: () => void;
  isRechecking?: boolean;
  onSettleAnother: () => void;
}

function formatAddress(addr: string): string {
  if (addr.length <= 14) return addr;
  return `${addr.slice(0, 8)}…${addr.slice(-6)}`;
}

export default function SettlementResult({
  state,
  onRecheck,
  isRechecking = false,
  onSettleAnother,
}: SettlementResultProps) {
  const isClaim = state.mode === 'claim';
  const isVerified = state.step === 'VERIFIED';
  const isStatusUnknown = state.step === 'STATUS_UNKNOWN';
  const isDegraded = state.step === 'DEGRADED_VERIFICATION';
  const isPending =
    state.step === 'SUBMITTED' ||
    state.step === 'PENDING' ||
    state.step === 'ACCEPTED' ||
    state.step === 'VERIFYING';

  const showRecheck = isStatusUnknown || isDegraded;

  return (
    <div className={styles.settlementResultContainer}>
      <div className={styles.resultHeader}>
        <div className={styles.resultTitleRow}>
          <h2 className={styles.resultTitle}>
            {isVerified
              ? isClaim
                ? 'PAYMENT CLAIMED'
                : 'PAYMENT REFUNDED'
              : isStatusUnknown || isPending
              ? 'TRANSACTION SUBMITTED'
              : 'TRANSACTION ACCEPTED'}
          </h2>
          {isVerified && (
            <span className={styles.statusSettledBadge}>
              {isClaim ? '● CLAIMED' : '● REFUNDED'}
            </span>
          )}
          {isPending && <span className={styles.statusPendingBadge}>PENDING</span>}
          {isStatusUnknown && <span className={styles.statusPendingBadge}>STATUS UNKNOWN</span>}
          {isDegraded && <span className={styles.statusPendingBadge}>DEGRADED VERIFICATION</span>}
        </div>

        <p className={styles.resultSubtitle}>
          {isVerified &&
            (isClaim
              ? `${state.amountFormatted} STRK settled into a shielded STRK20 note.`
              : `${state.amountFormatted} STRK returned into a shielded STRK20 note.`)}
          {isPending && 'Transaction submitted. Waiting for Starknet confirmation…'}
          {isStatusUnknown &&
            'Starknet confirmation is temporarily unavailable. We are re-checking the transaction.'}
          {isDegraded &&
            'Transaction accepted on Starknet. Settlement verification is temporarily unavailable.'}
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

      {/* Transaction Identifiers */}
      <div className={styles.identifiersCard}>
        <div className={styles.identifierItem}>
          <span className={styles.identifierLabel}>Payment ID</span>
          <code className={styles.identifierCode} title={state.paymentId}>
            {formatAddress(state.paymentId)}
          </code>
        </div>

        <div className={styles.identifierItem}>
          <span className={styles.identifierLabel}>Transaction</span>
          <a
            href={`https://voyager.online/tx/${state.txHash}`}
            target="_blank"
            rel="noreferrer"
            className={styles.txLink}
            title={state.txHash}
          >
            <code>{formatAddress(state.txHash)}</code>
            <span aria-hidden="true">↗</span>
          </a>
        </div>

        <div className={styles.identifierItem}>
          <span className={styles.identifierLabel}>Settlement</span>
          <span className={styles.identifierValue}>Shielded STRK20 note</span>
        </div>

        <div className={styles.identifierItem}>
          <span className={styles.identifierLabel}>Amount</span>
          <span className={styles.identifierValue}>{state.amountFormatted} STRK</span>
        </div>
      </div>

      {/* Maturity Note */}
      {isVerified && (
        <div className={styles.maturityCard}>
          <span className={styles.maturityIcon}>ℹ</span>
          <span className={styles.maturityText}>
            Requires 10 block confirmations before the new note can be used again.
          </span>
        </div>
      )}

      {/* Settle Another Action */}
      <div className={styles.resultFooter}>
        <button type="button" className={styles.secondaryBtn} onClick={onSettleAnother}>
          {isClaim ? 'Claim another payment' : 'Refund another payment'}
        </button>
      </div>
    </div>
  );
}
