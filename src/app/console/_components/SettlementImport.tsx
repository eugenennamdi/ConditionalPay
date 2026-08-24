'use client';

import React, { useRef, useState } from 'react';
import styles from '../console.module.css';
import { importSettlementFile } from '../_lib/settlementExecution';
import type {
  ImportedClaimCredential,
  ImportedRefundCredential,
  SettlementMode,
} from '../_lib/settlementTypes';

interface SettlementImportProps {
  mode: SettlementMode;
  onImportSuccess: (creds: ImportedClaimCredential | ImportedRefundCredential) => void;
  isProcessing: boolean;
}

export default function SettlementImport({
  mode,
  onImportSuccess,
  isProcessing,
}: SettlementImportProps) {
  const [fileContent, setFileContent] = useState<string>('');
  const [fileName, setFileName] = useState<string>('');
  const [passphrase, setPassphrase] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [isDecrypting, setIsDecrypting] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    setError('');
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result;
      if (typeof text === 'string') {
        setFileContent(text);
      }
    };
    reader.onerror = () => {
      setError('Unable to read file.');
    };
    reader.readAsText(file);
  }

  async function handleContinue() {
    setError('');

    if (!fileContent) {
      setError('Please select a credential file.');
      return;
    }

    if (passphrase.length < 8) {
      setError('Passphrase must be at least 8 characters long.');
      return;
    }

    setIsDecrypting(true);

    try {
      const creds = await importSettlementFile(fileContent, passphrase, mode);

      // Release local text and passphrase references immediately
      setFileContent('');
      setPassphrase('');
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }

      onImportSuccess(creds);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to decrypt credentials.';
      setError(msg);
    } finally {
      setIsDecrypting(false);
    }
  }

  const isClaim = mode === 'claim';

  return (
    <div className={styles.settlementCard}>
      <div className={styles.settlementHeader}>
        <div className={styles.settlementTitleRow}>
          <h2 className={styles.formTitle}>{isClaim ? 'CLAIM PAYMENT' : 'REFUND PAYMENT'}</h2>
        </div>
        <p className={styles.settlementSubtitle}>
          {isClaim
            ? 'Import encrypted claim access to continue.'
            : 'Import your encrypted creator recovery backup to refund an expired payment.'}
        </p>
      </div>

      {error && (
        <div className={styles.errorAlert} role="alert">
          {error}
        </div>
      )}

      <div className={styles.formField}>
        <label className={styles.formLabel}>
          {isClaim ? 'Claim access file (.json)' : 'Recovery file (.json)'}
        </label>
        <div className={styles.fileInputRow}>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            onChange={handleFileSelect}
            className={styles.fileInput}
            id="settlement-file-input"
          />
          <label htmlFor="settlement-file-input" className={styles.fileChooseBtn}>
            {fileName ? fileName : 'Choose file'}
          </label>
        </div>
        {isClaim && (
          <p className={styles.secondaryFileHint}>
            Creator recovery files are also supported for self-claim.
          </p>
        )}
      </div>

      <div className={styles.formField}>
        <label htmlFor="settlement-passphrase" className={styles.formLabel}>
          Passphrase
        </label>
        <input
          id="settlement-passphrase"
          type="password"
          autoComplete="current-password"
          className={styles.passphraseInput}
          value={passphrase}
          placeholder="Enter file passphrase"
          onChange={(e) => {
            setPassphrase(e.target.value);
            if (error) setError('');
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void handleContinue();
            }
          }}
        />
      </div>

      <div className={styles.actionRow}>
        <button
          type="button"
          className={styles.primaryBtn}
          onClick={handleContinue}
          disabled={isProcessing || isDecrypting || !fileContent || passphrase.length < 8}
        >
          {isDecrypting ? 'Decrypting…' : 'Continue'}
        </button>
      </div>
    </div>
  );
}
