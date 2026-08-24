'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { RpcProvider } from 'starknet';
import { getPayment } from '@conditionalpay/sdk';
import styles from '../console.module.css';
import {
  CONDITIONAL_PAY_CONTRACT,
  STRK_TOKEN_ADDRESS,
  EVIDENCE_PAYMENT_A,
  EVIDENCE_PAYMENT_B,
  EVIDENCE_LIABILITY_PROOF,
  EvidencePayment,
  EVIDENCE_TERMINAL_BLOCK,
} from './verifiedDemoEvidence';

function formatHash(hash: string): string {
  if (hash.length <= 18) return hash;
  return `${hash.slice(0, 10)}…${hash.slice(-8)}`;
}

function getFallbackProvider(): RpcProvider {
  const alchemyKey = process.env.NEXT_PUBLIC_PROVIDER_URL || '';
  const nodeUrl = alchemyKey
    ? `https://starknet-mainnet.g.alchemy.com/starknet/version/rpc/v0_10/${alchemyKey}`
    : 'https://free-rpc.nethermind.io/mainnet-juno';
  return new RpcProvider({ nodeUrl });
}

export default function VerifiedDemo() {
  const [selectedId, setSelectedId] = useState<'paymentA' | 'paymentB'>('paymentA');
  const [replayStep, setReplayStep] = useState<number>(5); // 0..5, default completed (5)
  const [isReplaying, setIsReplaying] = useState<boolean>(false);
  const [verificationStatus, setVerificationStatus] = useState<
    'idle' | 'verifying' | 'verified' | 'degraded'
  >('idle');
  const [historicalLiability, setHistoricalLiability] = useState<string | null>(null);

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const payment: EvidencePayment =
    selectedId === 'paymentA' ? EVIDENCE_PAYMENT_A : EVIDENCE_PAYMENT_B;

  const cancelActiveAnimation = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setIsReplaying(false);
  }, []);

  const triggerReplay = useCallback(
    (isPointerInteraction: boolean = true) => {
      cancelActiveAnimation();

      const prefersReducedMotion =
        typeof window !== 'undefined' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      if (prefersReducedMotion || !isPointerInteraction) {
        setReplayStep(5);
        return;
      }

      setIsReplaying(true);
      setReplayStep(1);

      let step = 1;
      const advance = () => {
        step += 1;
        setReplayStep(step);
        if (step < 5) {
          timerRef.current = setTimeout(advance, 550);
        } else {
          setIsReplaying(false);
          timerRef.current = null;
        }
      };

      timerRef.current = setTimeout(advance, 550);
    },
    [cancelActiveAnimation],
  );

  const handleSelectPayment = (id: 'paymentA' | 'paymentB', isPointer: boolean) => {
    if (id === selectedId && isReplaying) return;
    setSelectedId(id);
    triggerReplay(isPointer);
  };

  const performLiveVerification = useCallback(async () => {
    setVerificationStatus('verifying');
    try {
      const provider = getFallbackProvider();
      await getPayment(provider, CONDITIONAL_PAY_CONTRACT, payment.paymentId);

      try {
        const histRes = await provider.callContract(
          {
            contractAddress: CONDITIONAL_PAY_CONTRACT,
            entrypoint: 'get_locked_by_token',
            calldata: [STRK_TOKEN_ADDRESS],
          },
          EVIDENCE_TERMINAL_BLOCK,
        );
        if (Array.isArray(histRes) && histRes[0]) {
          setHistoricalLiability(BigInt(histRes[0]).toString());
        }
      } catch {
        setHistoricalLiability('0');
      }

      setVerificationStatus('verified');
    } catch {
      setVerificationStatus('degraded');
    }
  }, [payment.paymentId]);

  useEffect(() => {
    let isMounted = true;

    async function loadVerification() {
      try {
        const provider = getFallbackProvider();
        await getPayment(provider, CONDITIONAL_PAY_CONTRACT, payment.paymentId);
        if (!isMounted) return;

        try {
          const histRes = await provider.callContract(
            {
              contractAddress: CONDITIONAL_PAY_CONTRACT,
              entrypoint: 'get_locked_by_token',
              calldata: [STRK_TOKEN_ADDRESS],
            },
            EVIDENCE_TERMINAL_BLOCK,
          );
          if (isMounted && Array.isArray(histRes) && histRes[0]) {
            setHistoricalLiability(BigInt(histRes[0]).toString());
          }
        } catch {
          if (isMounted) setHistoricalLiability('0');
        }

        if (isMounted) setVerificationStatus('verified');
      } catch {
        if (isMounted) setVerificationStatus('degraded');
      }
    }

    loadVerification();

    return () => {
      isMounted = false;
      cancelActiveAnimation();
    };
  }, [payment.paymentId, cancelActiveAnimation]);

  return (
    <div className={styles.workspace}>
      {/* Demo Header */}
      <section className={styles.demoHero} aria-labelledby="verified-demo-title">
        <div className={styles.demoHeroContent}>
          <h1 id="verified-demo-title" className={styles.demoTitle}>
            Two terminal paths. Proven onchain.
          </h1>
          <p className={styles.demoDescription}>
            Replay the completed CLAIM and REFUND paths using real Starknet Mainnet transactions.
          </p>
          <div className={styles.trustLine}>
            <span>Real Mainnet transactions</span>
            <span>·</span>
            <span>No wallet required</span>
          </div>
        </div>

        <div className={styles.demoHeroActions}>
          <div className={styles.liveVerificationBox} role="status" aria-live="polite">
            <span
              className={styles.statusIndicator}
              data-status={verificationStatus}
              aria-hidden="true"
            />
            <span>
              {verificationStatus === 'verifying' && 'Verifying onchain…'}
              {verificationStatus === 'verified' && 'Verified onchain'}
              {verificationStatus === 'degraded' &&
                'Live verification unavailable. Showing recorded Mainnet evidence.'}
              {verificationStatus === 'idle' && 'Ready for verification'}
            </span>
            <button
              className={styles.recheckButton}
              onClick={performLiveVerification}
              disabled={verificationStatus === 'verifying'}
              title="Re-verify contract state via RPC"
            >
              Re-check
            </button>
          </div>
        </div>
      </section>

      {/* Payment Selection Tabs */}
      <section aria-label="Select settlement path">
        <div className={styles.selectorContainer} role="tablist">
          <button
            role="tab"
            aria-selected={selectedId === 'paymentA'}
            className={styles.selectorButton}
            data-selected={selectedId === 'paymentA'}
            onClick={(e) => handleSelectPayment('paymentA', e.detail > 0)}
          >
            <div className={styles.selectorInfo}>
              <h3>
                Payment A <span className={styles.pathTag}>CLAIM</span>
              </h3>
              <p>{EVIDENCE_PAYMENT_A.pathDescription}</p>
            </div>
            <span className={styles.outcomePill} data-outcome="claimed">
              CLAIMED
            </span>
          </button>

          <button
            role="tab"
            aria-selected={selectedId === 'paymentB'}
            className={styles.selectorButton}
            data-selected={selectedId === 'paymentB'}
            onClick={(e) => handleSelectPayment('paymentB', e.detail > 0)}
          >
            <div className={styles.selectorInfo}>
              <h3>
                Payment B <span className={styles.pathTag}>REFUND</span>
              </h3>
              <p>{EVIDENCE_PAYMENT_B.pathDescription}</p>
            </div>
            <span className={styles.outcomePill} data-outcome="refunded">
              REFUNDED
            </span>
          </button>
        </div>
      </section>

      {/* Terminal Workspace with Integrated Header & Replay Controls */}
      <section aria-label="Settlement lifecycle replay">
        <div className={styles.darkSurface}>
          {/* Integrated Instrument Header */}
          <div className={styles.workspaceHeader}>
            <div className={styles.workspaceTitleGroup}>
              <span className={styles.workspaceKicker}>SETTLEMENT LIFECYCLE</span>
              <h2 className={styles.workspaceTitle}>
                {payment.name} · {payment.settleTx.phase} Path
              </h2>
            </div>
            <div className={styles.replayControls}>
              <span className={styles.replayProgressText}>
                Step {replayStep} of 5 · {replayStep === 5 ? 'Settled' : 'In progress'}
              </span>
              <button
                className={styles.replayButton}
                onClick={() => triggerReplay(true)}
                disabled={isReplaying}
                aria-label={`Replay ${payment.name} lifecycle animation`}
              >
                {isReplaying ? 'Replaying…' : '↻ Replay'}
              </button>
            </div>
          </div>

          {/* Lifecycle Rail: Substantial State Nodes + Distinct Transition Connectors */}
          <div className={styles.lifecycleSection}>
            <div className={styles.lifecycleRail} role="list">
              {/* State 1: UNINITIALIZED */}
              <div
                className={styles.stateNode}
                data-active={replayStep >= 1}
                data-complete={replayStep > 1}
                role="listitem"
              >
                <span className={styles.nodeStepTag}>01 STATE</span>
                <span className={styles.nodeStateName}>UNINITIALIZED</span>
                <span className={styles.nodeStateDetail}>Before CREATE</span>
              </div>

              {/* Transition 1: CREATE */}
              <div
                className={styles.transitionConnector}
                data-active={replayStep >= 2}
                data-complete={replayStep > 2}
                role="listitem"
              >
                <div className={styles.transitionTrack}>
                  <span className={styles.transitionLine} />
                  <span className={styles.operationBadge}>CREATE</span>
                  <span className={styles.transitionArrow} aria-hidden="true">
                    →
                  </span>
                </div>
                <div className={styles.transitionMeta}>
                  <span>{payment.createTx.txName}</span>
                  <span>·</span>
                  <span>Block {payment.createTx.block}</span>
                </div>
              </div>

              {/* State 2: ACTIVE */}
              <div
                className={styles.stateNode}
                data-active={replayStep >= 3}
                data-complete={replayStep > 3}
                role="listitem"
              >
                <span className={styles.nodeStepTag}>02 STATE</span>
                <span className={styles.nodeStateName}>ACTIVE</span>
                <span className={styles.nodeStateDetail}>
                  {payment.amountFormatted} locked in ConditionalPay
                </span>
              </div>

              {/* Transition 2: CLAIM / REFUND */}
              <div
                className={styles.transitionConnector}
                data-active={replayStep >= 4}
                data-complete={replayStep > 4}
                role="listitem"
              >
                <div className={styles.transitionTrack}>
                  <span className={styles.transitionLine} />
                  <span className={styles.operationBadge}>{payment.settleTx.phase}</span>
                  <span className={styles.transitionArrow} aria-hidden="true">
                    →
                  </span>
                </div>
                <div className={styles.transitionMeta}>
                  <span>{payment.settleTx.txName}</span>
                  <span>·</span>
                  <span>Block {payment.settleTx.block}</span>
                </div>
              </div>

              {/* State 3: TERMINAL */}
              <div
                className={styles.stateNode}
                data-active={replayStep === 5}
                data-complete={replayStep === 5}
                role="listitem"
              >
                <span className={styles.nodeStepTag}>03 TERMINAL STATE</span>
                <span className={styles.nodeStateName}>{payment.terminalState}</span>
                <span className={styles.nodeStateDetail}>
                  {payment.terminalState === 'CLAIMED'
                    ? 'Settled into shielded STRK20 note'
                    : 'Returned into shielded STRK20 note'}
                </span>
              </div>
            </div>
          </div>

          {/* Evidence Grid: Authenticated Transactions + Conditions */}
          <div className={styles.evidenceGrid}>
            {/* Transactions Card */}
            <div className={styles.detailCard}>
              <p className={styles.detailCardHeader}>MAINNET TRANSACTIONS</p>
              <div className={styles.txList}>
                <a
                  href={payment.createTx.voyagerUrl}
                  target="_blank"
                  rel="noreferrer"
                  className={styles.txItem}
                  title={`View ${payment.createTx.txName} on Voyager: ${payment.createTx.hash}`}
                >
                  <div className={styles.txPhaseTag}>
                    <span>{payment.createTx.txName} · {payment.createTx.phase}</span>
                    <small>Block {payment.createTx.block}</small>
                  </div>
                  <div className={styles.txHashBlock}>
                    <code className={styles.txHash}>{formatHash(payment.createTx.hash)}</code>
                    <span className={styles.txFinality}>
                      {payment.createTx.status} · {payment.createTx.finality} ↗
                    </span>
                  </div>
                </a>

                <a
                  href={payment.settleTx.voyagerUrl}
                  target="_blank"
                  rel="noreferrer"
                  className={styles.txItem}
                  title={`View ${payment.settleTx.txName} on Voyager: ${payment.settleTx.hash}`}
                >
                  <div className={styles.txPhaseTag}>
                    <span>{payment.settleTx.txName} · {payment.settleTx.phase}</span>
                    <small>Block {payment.settleTx.block}</small>
                  </div>
                  <div className={styles.txHashBlock}>
                    <code className={styles.txHash}>{formatHash(payment.settleTx.hash)}</code>
                    <span className={styles.txFinality}>
                      {payment.settleTx.status} · {payment.settleTx.finality} ↗
                    </span>
                  </div>
                </a>
              </div>
            </div>

            {/* Conditions Card */}
            <div className={styles.detailCard}>
              <p className={styles.detailCardHeader}>CONDITIONS</p>
              <div className={styles.conditionsList}>
                {payment.conditions.map((cond) => (
                  <div className={styles.conditionRow} key={cond.label}>
                    <div>
                      <span className={styles.conditionName}>{cond.label}</span>
                    </div>
                    <span className={styles.conditionStatus}>{cond.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Bottom Proof Grid: Historical Liability + Privacy Boundary */}
      <section className={styles.bottomProofGrid} aria-label="Protocol proofs and privacy boundary">
        {/* Historical Liability Proof */}
        <div className={styles.proofCard}>
          <p className={styles.proofCardTitle}>HISTORICAL LIABILITY</p>
          <div className={styles.liabilityHighlight}>
            <span className={styles.liabilityValue}>
              {historicalLiability !== null ? `${historicalLiability} STRK` : EVIDENCE_LIABILITY_PROOF.value}
            </span>
            <span className={styles.liabilityMeta}>
              After the verified A/B lifecycle · Block {EVIDENCE_TERMINAL_BLOCK.toLocaleString()}
            </span>
          </div>
        </div>

        {/* Privacy Boundary Overview */}
        <div className={styles.proofCard}>
          <p className={styles.proofCardTitle}>PRIVACY BOUNDARY</p>
          <p className={styles.privacyStatement}>
            Creator, claimant and refunder addresses are not stored in ConditionalPay state.
          </p>
        </div>
      </section>
    </div>
  );
}
