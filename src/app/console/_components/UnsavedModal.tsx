'use client';

import React from 'react';
import styles from '../console.module.css';

interface UnsavedModalProps {
  isOpen: boolean;
  onStay: () => void;
  onLeaveAnyway: () => void;
}

export default function UnsavedModal({
  isOpen,
  onStay,
  onLeaveAnyway,
}: UnsavedModalProps) {
  if (!isOpen) return null;

  return (
    <div className={styles.modalBackdrop} role="dialog" aria-modal="true" aria-labelledby="unsaved-modal-title">
      <div className={styles.modalCard}>
        <h3 id="unsaved-modal-title" className={styles.modalTitle}>
          Recovery file not saved
        </h3>
        <p className={styles.modalMessage}>
          Leaving now may permanently remove access to this payment&apos;s claim and refund
          credentials.
        </p>
        <div className={styles.modalActionRow}>
          <button type="button" className={styles.primaryBtn} onClick={onStay}>
            Stay
          </button>
          <button type="button" className={styles.secondaryBtn} onClick={onLeaveAnyway}>
            Leave anyway
          </button>
        </div>
      </div>
    </div>
  );
}
