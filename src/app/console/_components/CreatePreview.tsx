'use client';

import React from 'react';
import styles from '../console.module.css';
import { PlannedCreate } from '../_lib/createTypes';

interface CreatePreviewProps {
  planned: PlannedCreate;
  isSubmitting: boolean;
  onEdit: () => void;
  onCreate: () => void;
  errorMessage?: string;
}

export default function CreatePreview({
  planned,
  isSubmitting,
  onEdit,
  onCreate,
  errorMessage,
}: CreatePreviewProps) {
  return (
    <div className={styles.previewContainer}>
      <div className={styles.previewHeader}>
        <h2 className={styles.previewTitle}>REVIEW CREATE</h2>
      </div>

      {errorMessage && (
        <div className={styles.previewAlert} role="alert">
          {errorMessage}
        </div>
      )}

      <div className={styles.previewGrid}>
        <div className={styles.previewItem}>
          <span className={styles.previewLabel}>Amount</span>
          <span className={styles.previewValueBold}>{planned.amountFormatted} STRK</span>
        </div>

        <div className={styles.previewItem}>
          <span className={styles.previewLabel}>Claim</span>
          <span className={styles.previewValue}>{planned.claimDateFormatted}</span>
        </div>

        <div className={styles.previewItem}>
          <span className={styles.previewLabel}>Refund available</span>
          <span className={styles.previewValue}>{planned.refundDateFormatted}</span>
        </div>

        <div className={styles.previewItem}>
          <span className={styles.previewLabel}>Approval</span>
          <span className={styles.previewValue}>Not required</span>
        </div>
      </div>

      <div className={styles.previewActionsSection}>
        <div className={styles.previewSectionHeader}>ACTIONS</div>
        <div className={styles.actionStepsList}>
          <div className={styles.actionStepItem}>
            <span className={styles.actionStepNum}>01</span>
            <span className={styles.actionStepName}>Withdraw</span>
            <span className={styles.actionStepDesc}>
              {planned.amountFormatted} STRK → ConditionalPay
            </span>
          </div>
          <div className={styles.actionStepItem}>
            <span className={styles.actionStepNum}>02</span>
            <span className={styles.actionStepName}>Invoke</span>
            <span className={styles.actionStepDesc}>CREATE</span>
          </div>
        </div>
      </div>

      <div className={styles.previewNetworkRow}>
        <span className={styles.previewNetworkLabel}>Network</span>
        <span className={styles.previewNetworkValue}>Starknet Mainnet</span>
      </div>

      <p className={styles.previewNotice}>
        Network/privacy fees are shown by Ready Wallet before confirmation.
      </p>

      <div className={styles.previewButtonRow}>
        <button
          type="button"
          className={styles.secondaryBtn}
          onClick={onEdit}
          disabled={isSubmitting}
        >
          Edit
        </button>
        <button
          type="button"
          className={styles.primaryBtn}
          onClick={onCreate}
          disabled={isSubmitting}
        >
          {isSubmitting ? 'Confirming in Ready Wallet…' : 'Create in Ready Wallet'}
        </button>
      </div>
    </div>
  );
}
