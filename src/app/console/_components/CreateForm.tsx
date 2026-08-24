'use client';

import React, { useState } from 'react';
import styles from '../console.module.css';
import { CreateFormData, ClaimChoice, RefundPreset } from '../_lib/createTypes';
import { parseStrkAmount } from '../_lib/createValidation';

interface CreateFormProps {
  initialData?: CreateFormData | null;
  onReview: (formData: CreateFormData) => void;
  isConnected: boolean;
  onConnectWallet: () => void;
}

export default function CreateForm({
  initialData,
  onReview,
  isConnected,
  onConnectWallet,
}: CreateFormProps) {
  const [amount, setAmount] = useState<string>(initialData?.amount ?? '');
  const [claimChoice, setClaimChoice] = useState<ClaimChoice>(
    initialData?.claimChoice ?? 'immediately',
  );
  const [customClaimDate, setCustomClaimDate] = useState<string>(
    initialData?.customClaimDate ?? '',
  );
  const [refundPreset, setRefundPreset] = useState<RefundPreset>(
    initialData?.refundPreset ?? '24h',
  );
  const [customRefundDate, setCustomRefundDate] = useState<string>(
    initialData?.customRefundDate ?? '',
  );
  const [formError, setFormError] = useState<string>('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');

    try {
      parseStrkAmount(amount);

      if (claimChoice === 'custom' && !customClaimDate) {
        throw new Error('Please select a claim date and time.');
      }

      if (refundPreset === 'custom' && !customRefundDate) {
        throw new Error('Please select an expiry date and time.');
      }

      onReview({
        amount,
        claimChoice,
        customClaimDate,
        refundPreset,
        customRefundDate,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Invalid form input.';
      setFormError(msg);
    }
  }

  return (
    <form className={styles.createFormContainer} onSubmit={handleSubmit} noValidate>
      <div className={styles.formHeader}>
        <h2 className={styles.formTitle}>CREATE PAYMENT</h2>
        <span className={styles.formTokenBadge}>STRK</span>
      </div>

      {formError && (
        <div className={styles.formAlert} role="alert">
          {formError}
        </div>
      )}

      {/* Amount Input */}
      <div className={styles.formFieldGroup}>
        <label htmlFor="create-amount" className={styles.formLabel}>
          Amount
        </label>
        <div className={styles.amountInputWrapper}>
          <input
            id="create-amount"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.0"
            className={styles.amountInput}
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              if (formError) setFormError('');
            }}
          />
          <span className={styles.amountSuffix}>STRK</span>
        </div>
      </div>

      {/* Claim Availability */}
      <div className={styles.formFieldGroup}>
        <label htmlFor="create-claim-choice" className={styles.formLabel}>
          Claim
        </label>
        <div className={styles.selectWrapper}>
          <select
            id="create-claim-choice"
            className={styles.formSelect}
            value={claimChoice}
            onChange={(e) => {
              setClaimChoice(e.target.value as ClaimChoice);
              if (formError) setFormError('');
            }}
          >
            <option value="immediately">Immediately</option>
            <option value="custom">Specific date &amp; time</option>
          </select>
        </div>

        {claimChoice === 'custom' && (
          <div className={styles.customDateWrapper}>
            <input
              type="datetime-local"
              className={styles.customDateInput}
              value={customClaimDate}
              onChange={(e) => setCustomClaimDate(e.target.value)}
              aria-label="Specific claim date and time"
            />
          </div>
        )}
      </div>

      {/* Refund Expiry */}
      <div className={styles.formFieldGroup}>
        <label htmlFor="create-refund-preset" className={styles.formLabel}>
          Refund after
        </label>
        <div className={styles.selectWrapper}>
          <select
            id="create-refund-preset"
            className={styles.formSelect}
            value={refundPreset}
            onChange={(e) => {
              setRefundPreset(e.target.value as RefundPreset);
              if (formError) setFormError('');
            }}
          >
            <option value="1h">1 hour</option>
            <option value="24h">24 hours</option>
            <option value="7d">7 days</option>
            <option value="custom">Custom</option>
          </select>
        </div>

        {refundPreset === 'custom' && (
          <div className={styles.customDateWrapper}>
            <input
              type="datetime-local"
              className={styles.customDateInput}
              value={customRefundDate}
              onChange={(e) => setCustomRefundDate(e.target.value)}
              aria-label="Custom refund expiry date and time"
            />
          </div>
        )}
      </div>

      {/* Form Action Row */}
      <div className={styles.formActionRow}>
        {isConnected ? (
          <button type="submit" className={styles.submitBtn}>
            Review payment →
          </button>
        ) : (
          <button
            type="button"
            className={styles.submitBtn}
            onClick={onConnectWallet}
          >
            Connect Ready Wallet to continue
          </button>
        )}
      </div>
    </form>
  );
}
