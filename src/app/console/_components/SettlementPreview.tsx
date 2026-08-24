'use client';

import React from 'react';
import styles from '../console.module.css';
import type { SettlementMode, SettlementPreflight } from '../_lib/settlementTypes';

interface SettlementPreviewProps {
  mode: SettlementMode;
  preflight: SettlementPreflight;
  isSelfClaim?: boolean;
  onBack: () => void;
  onSubmit: () => void;
  isSubmitting: boolean;
  walletConnected: boolean;
  onConnectWallet: () => void;
  walletAddress?: string;
}

function formatAddress(addr?: string): string {
  if (!addr) return '';
  if (addr.length <= 14) return addr;
  return `${addr.slice(0, 8)}…${addr.slice(-6)}`;
}

export default function SettlementPreview({
  mode,
  preflight,
  isSelfClaim = false,
  onBack,
  onSubmit,
  isSubmitting,
  walletConnected,
  onConnectWallet,
  walletAddress,
}: SettlementPreviewProps) {
  const isClaim = mode === 'claim';
  const isExecutable = isClaim ? preflight.isClaimAvailable : preflight.isRefundAvailable;
  const blockedReason = isClaim ? preflight.claimBlockedReason : preflight.refundBlockedReason;

  return (
    <div className={styles.settlementPreviewContainer}>
      <div className={styles.previewHeader}>
        <div className={styles.previewTitleRow}>
          <h2 className={styles.previewTitle}>{isClaim ? 'REVIEW CLAIM' : 'REVIEW REFUND'}</h2>
          <span className={styles.statusActiveBadge}>● ACTIVE</span>
          {isSelfClaim && <span className={styles.creatorBadge}>CREATOR SELF-CLAIM</span>}
        </div>
        <p className={styles.previewSubtitle}>
          {isClaim
            ? 'Review and execute your private payment settlement into a shielded STRK20 note.'
            : 'Review and execute your private refund into a shielded STRK20 note.'}
        </p>
      </div>

      {/* Preflight Parameter Cards */}
      <div className={styles.previewGrid}>
        <div className={styles.previewItem}>
          <span className={styles.previewLabel}>Amount</span>
          <span className={styles.previewValue}>{preflight.amountFormatted} STRK</span>
        </div>

        <div className={styles.previewItem}>
          <span className={styles.previewLabel}>Payment ID</span>
          <code className={styles.previewCode} title={preflight.paymentId}>
            {formatAddress(preflight.paymentId)}
          </code>
        </div>

        <div className={styles.previewItem}>
          <span className={styles.previewLabel}>Settlement</span>
          <span className={styles.previewValue}>Shielded STRK20 note</span>
        </div>

        <div className={styles.previewItem}>
          <span className={styles.previewLabel}>Network</span>
          <span className={styles.previewValue}>Starknet Mainnet</span>
        </div>

        {walletAddress && (
          <div className={styles.previewItem}>
            <span className={styles.previewLabel}>Settlement wallet</span>
            <code className={styles.previewCode} title={walletAddress}>
              {formatAddress(walletAddress)}
            </code>
          </div>
        )}
      </div>

      {/* Settlement Actions List */}
      <div className={styles.actionsCard}>
        <h3 className={styles.actionsCardTitle}>ACTIONS</h3>
        <div className={styles.actionItem}>
          <span className={styles.actionStepNum}>01</span>
          <div className={styles.actionStepDetails}>
            <strong className={styles.actionStepName}>Open shielded note</strong>
            <span className={styles.actionStepDesc}>
              Prepares settlement in your Ready Wallet
            </span>
          </div>
        </div>

        <div className={styles.actionItem}>
          <span className={styles.actionStepNum}>02</span>
          <div className={styles.actionStepDetails}>
            <strong className={styles.actionStepName}>
              {isClaim ? 'Invoke CLAIM' : 'Invoke REFUND'}
            </strong>
            <span className={styles.actionStepDesc}>
              {isClaim
                ? 'Settles the payment into the shielded note'
                : 'Returns the payment into the shielded note'}
            </span>
          </div>
        </div>
      </div>

      {/* Availability / Blocked Warnings */}
      {!isExecutable && blockedReason && (
        <div className={styles.warningAlert} role="alert">
          {blockedReason}
        </div>
      )}

      {/* Privacy Notice */}
      <p className={styles.privacyNotice}>
        Network/privacy fees are shown by Ready Wallet before confirmation.
      </p>

      {/* Action Buttons */}
      <div className={styles.previewButtonRow}>
        <button
          type="button"
          className={styles.secondaryBtn}
          onClick={onBack}
          disabled={isSubmitting}
        >
          Back
        </button>

        {!walletConnected ? (
          <button type="button" className={styles.primaryBtn} onClick={onConnectWallet}>
            Connect Ready Wallet
          </button>
        ) : (
          <button
            type="button"
            className={styles.primaryBtn}
            onClick={onSubmit}
            disabled={isSubmitting || !isExecutable}
          >
            {isSubmitting
              ? 'Opening wallet…'
              : isClaim
              ? 'Claim in Ready Wallet'
              : 'Refund in Ready Wallet'}
          </button>
        )}
      </div>
    </div>
  );
}
