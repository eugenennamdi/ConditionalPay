'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { RpcProvider, type ProviderInterface } from 'starknet';
import styles from '../console.module.css';
import { useConsoleWallet } from '../_lib/ConsoleWalletContext';
import { CreateFormData, CreateStep, PlannedCreate } from '../_lib/createTypes';
import {
  isReceiptAccepted,
  isReceiptReverted,
  normalizeWalletError,
  planCreatePayment,
  shouldActivateNavigationGuard,
  submitCreatePayment,
  verifyPaymentCreated,
} from '../_lib/createExecution';
import CreateForm from './CreateForm';
import CreatePreview from './CreatePreview';
import CredentialHandoff from './CredentialHandoff';
import { myFrontendProviders } from '@/utils/constants';

interface CreatePaymentProps {
  onUnsavedChange?: (hasUnsaved: boolean) => void;
  customProvider?: ProviderInterface;
}

export default function CreatePayment({
  onUnsavedChange,
  customProvider,
}: CreatePaymentProps) {
  const {
    connectedWallet,
    address,
    chainStatus,
    handleConnect,
  } = useConsoleWallet();

  const [step, setStep] = useState<CreateStep>('EDITING');
  const [formData, setFormData] = useState<CreateFormData | null>(null);
  const [plannedCreate, setPlannedCreate] = useState<PlannedCreate | null>(null);
  const [txHash, setTxHash] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [backupSaved, setBackupSaved] = useState<boolean>(false);
  const [isRechecking, setIsRechecking] = useState<boolean>(false);

  const submittingRef = useRef<boolean>(false);
  const providerRef = useRef<ProviderInterface>(
    customProvider ?? myFrontendProviders[0] ?? new RpcProvider({ nodeUrl: 'https://starknet-mainnet.public.blastapi.io/rpc/v0_7' }),
  );

  useEffect(() => {
    if (customProvider) {
      providerRef.current = customProvider;
    }
  }, [customProvider]);

  // Determine if credentials exist that require navigation protection
  const hasUnsavedCredentials = shouldActivateNavigationGuard(
    step,
    backupSaved,
    plannedCreate !== null,
  );

  useEffect(() => {
    onUnsavedChange?.(hasUnsavedCredentials);
  }, [hasUnsavedCredentials, onUnsavedChange]);

  // Tab close / reload browser protection
  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (hasUnsavedCredentials) {
        e.preventDefault();
        e.returnValue = '';
      }
    }

    if (hasUnsavedCredentials) {
      window.addEventListener('beforeunload', handleBeforeUnload);
    }
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedCredentials]);

  // 1. Transition EDITING -> REVIEWING (Generate credentials ONCE)
  function handleReview(data: CreateFormData) {
    setErrorMessage('');
    try {
      const planned = planCreatePayment(data);
      setPlannedCreate(planned);
      setFormData(data);
      setStep('REVIEWING');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to prepare payment.';
      setErrorMessage(msg);
    }
  }

  // 2. User clicks Edit in Review screen: Discard credentials and return to form
  function handleEdit() {
    setPlannedCreate(null); // Discard in-memory credentials
    setStep('EDITING');
    setErrorMessage('');
  }

  // 3. Poll receipt and perform post-write verification
  const pollTransactionReceipt = useCallback(async (hash: string, planned: PlannedCreate) => {
    setStep('PENDING');
    const provider = providerRef.current;

    try {
      let isAccepted = false;
      let attempts = 0;
      const maxAttempts = 60; // Up to ~3 minutes

      while (attempts < maxAttempts && !isAccepted) {
        attempts++;
        try {
          const receipt = (await provider.getTransactionReceipt(hash)) as {
            execution_status?: string;
            finality_status?: string;
            status?: string;
          };

          if (isReceiptReverted(receipt)) {
            setStep('REVERTED');
            setPlannedCreate(null); // Destroy credentials on revert
            setErrorMessage('Transaction was reverted on Starknet.');
            return;
          }

          if (isReceiptAccepted(receipt)) {
            isAccepted = true;
            break;
          }
        } catch {
          // Transaction may not be indexed yet, keep polling
        }
        await new Promise((r) => setTimeout(r, 3000));
      }

      if (isAccepted) {
        // ACCEPTED: Recovery file download becomes IMMEDIATELY ACTIVE
        setStep('ACCEPTED');

        // Asynchronously verify onchain events and state record
        setStep('VERIFYING');
        try {
          const verification = await verifyPaymentCreated(provider, planned, hash);
          if (verification.eventAuthenticated && verification.onchainStateActive) {
            setStep('VERIFIED');
          } else {
            setStep('DEGRADED_VERIFICATION');
          }
        } catch {
          setStep('DEGRADED_VERIFICATION');
        }
      } else {
        // Receipt poll timeout is NOT a revert; status is unknown. Keep credentials available for recovery.
        setStep('STATUS_UNKNOWN');
      }
    } catch {
      setStep('STATUS_UNKNOWN');
    }
  }, []);

  // 4. User clicks Create in Ready Wallet (Single-flight mutex protected)
  const handleExecuteCreate = useCallback(async () => {
    if (submittingRef.current) return;
    if (!connectedWallet || !plannedCreate) return;

    if (chainStatus !== 'MAINNET') {
      setErrorMessage('Switch Ready Wallet to Starknet Mainnet before creating a payment.');
      return;
    }

    submittingRef.current = true;
    setIsSubmitting(true);
    setErrorMessage('');
    setStep('AWAITING_WALLET');

    try {
      const hash = await submitCreatePayment(connectedWallet, plannedCreate);
      setTxHash(hash);
      setStep('SUBMITTED');

      // Poll transaction receipt
      pollTransactionReceipt(hash, plannedCreate);
    } catch (err: unknown) {
      const normalizedMsg = normalizeWalletError(err);
      setErrorMessage(normalizedMsg);
      // On wallet rejection or submission failure: return to REVIEWING, PRESERVING credentials & paymentId
      setStep('REVIEWING');
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  }, [connectedWallet, plannedCreate, chainStatus, pollTransactionReceipt]);

  // 5. Re-check onchain verification for degraded or status-unknown state
  async function handleRecheck() {
    if (!plannedCreate || !txHash) return;
    setIsRechecking(true);
    const provider = providerRef.current;

    try {
      if (step === 'STATUS_UNKNOWN') {
        // Look up receipt status only (NEVER resubmit CREATE)
        try {
          const receipt = (await provider.getTransactionReceipt(txHash)) as {
            execution_status?: string;
            finality_status?: string;
            status?: string;
          };

          if (isReceiptReverted(receipt)) {
            setStep('REVERTED');
            setPlannedCreate(null); // Destroy credentials on revert
            setErrorMessage('Transaction was reverted on Starknet.');
            return;
          }

          if (isReceiptAccepted(receipt)) {
            setStep('ACCEPTED');
            setStep('VERIFYING');
            try {
              const verification = await verifyPaymentCreated(provider, plannedCreate, txHash);
              if (verification.eventAuthenticated && verification.onchainStateActive) {
                setStep('VERIFIED');
              } else {
                setStep('DEGRADED_VERIFICATION');
              }
            } catch {
              setStep('DEGRADED_VERIFICATION');
            }
          }
        } catch {
          // Receipt query still unavailable, keep STATUS_UNKNOWN
        }
      } else if (step === 'DEGRADED_VERIFICATION') {
        // Receipt was already accepted; re-verify onchain events and getPayment
        try {
          const verification = await verifyPaymentCreated(provider, plannedCreate, txHash);
          if (verification.eventAuthenticated && verification.onchainStateActive) {
            setStep('VERIFIED');
          }
        } catch {
          // Keep degraded
        }
      }
    } finally {
      setIsRechecking(false);
    }
  }

  // 6. Reset to Create Another Payment
  function handleCreateAnother() {
    setPlannedCreate(null);
    setFormData(null);
    setTxHash('');
    setBackupSaved(false);
    setErrorMessage('');
    setStep('EDITING');
  }

  const isConnected = !!address && !!connectedWallet;

  return (
    <div className={styles.createWorkflowWrapper}>
      {step === 'EDITING' && (
        <CreateForm
          initialData={formData}
          onReview={handleReview}
          isConnected={isConnected}
          onConnectWallet={handleConnect}
        />
      )}

      {(step === 'REVIEWING' || step === 'AWAITING_WALLET') && plannedCreate && (
        <CreatePreview
          planned={plannedCreate}
          isSubmitting={isSubmitting}
          onEdit={handleEdit}
          onCreate={handleExecuteCreate}
          errorMessage={errorMessage}
        />
      )}

      {(step === 'SUBMITTED' ||
        step === 'PENDING' ||
        step === 'ACCEPTED' ||
        step === 'VERIFYING' ||
        step === 'VERIFIED' ||
        step === 'DEGRADED_VERIFICATION') &&
        plannedCreate && (
          <CredentialHandoff
            planned={plannedCreate}
            txHash={txHash}
            step={step}
            backupSaved={backupSaved}
            onBackupSavedChange={setBackupSaved}
            onRecheck={handleRecheck}
            isRechecking={isRechecking}
            onCreateAnother={handleCreateAnother}
          />
        )}

      {step === 'REVERTED' && (
        <div className={styles.revertedContainer}>
          <div className={styles.revertedHeader}>
            <h2 className={styles.revertedTitle}>TRANSACTION REVERTED</h2>
            <p className={styles.revertedDesc}>
              The transaction reverted on Starknet. No payment was created and no funds were locked.
            </p>
          </div>
          {errorMessage && (
            <div className={styles.formAlert} role="alert">
              {errorMessage}
            </div>
          )}
          <div className={styles.formActionRow}>
            <button
              type="button"
              className={styles.submitBtn}
              onClick={handleCreateAnother}
            >
              Start new payment
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
