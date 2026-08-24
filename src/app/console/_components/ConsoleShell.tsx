'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import styles from '../console.module.css';
import VerifiedDemo from './VerifiedDemo';
import WalletConnect from './WalletConnect';
import CreatePayment from './CreatePayment';
import UnsavedModal from './UnsavedModal';
import { ConsoleWalletProvider } from '../_lib/ConsoleWalletContext';
import {
  CONDITIONAL_PAY_CONTRACT,
  STRK20_POOL_CONTRACT,
} from './verifiedDemoEvidence';

export type ConsoleMode = 'create' | 'claim' | 'refund' | 'verifiedDemo';

function formatAddress(addr: string): string {
  if (addr.length <= 14) return addr;
  return `${addr.slice(0, 8)}…${addr.slice(-6)}`;
}

function ConsoleInner() {
  const [activeMode, setActiveMode] = useState<ConsoleMode>('create');
  const [hasUnsaved, setHasUnsaved] = useState<boolean>(false);
  const [pendingMode, setPendingMode] = useState<ConsoleMode | null>(null);
  const [isUnsavedModalOpen, setIsUnsavedModalOpen] = useState<boolean>(false);

  useEffect(() => {
    function syncHash() {
      if (typeof window !== 'undefined') {
        const hash = window.location.hash.toLowerCase();
        if (hash === '#verified-demo' || hash === '#demo') {
          setActiveMode('verifiedDemo');
        } else if (hash === '#create') {
          setActiveMode('create');
        }
      }
    }

    syncHash();
    window.addEventListener('hashchange', syncHash);
    return () => window.removeEventListener('hashchange', syncHash);
  }, []);

  function handleModeClick(targetMode: ConsoleMode) {
    if (targetMode === activeMode) return;
    if (hasUnsaved) {
      setPendingMode(targetMode);
      setIsUnsavedModalOpen(true);
    } else {
      setActiveMode(targetMode);
    }
  }

  function handleStay() {
    setIsUnsavedModalOpen(false);
    setPendingMode(null);
  }

  function handleLeaveAnyway() {
    setIsUnsavedModalOpen(false);
    if (pendingMode) {
      setActiveMode(pendingMode);
      setPendingMode(null);
    }
  }

  return (
    <div className={styles.consolePage}>
      {/* Top Header */}
      <header className={styles.consoleHeaderSticky}>
        <div className={styles.consoleNav}>
          <Link
            href="/"
            className={styles.brandLockup}
            title="Return to ConditionalPay homepage"
            onClick={(e) => {
              if (hasUnsaved) {
                e.preventDefault();
                setIsUnsavedModalOpen(true);
              }
            }}
          >
            <Image
              src="/conditionalpay-mark.png"
              alt="ConditionalPay"
              width={28}
              height={16}
              className={styles.brandMark}
              priority
            />
            <div className={styles.brandTitleGroup}>
              <span className={styles.brandTitle}>ConditionalPay</span>
              <span className={styles.brandDivider}>/</span>
              <span className={styles.consoleLabel}>Console</span>
            </div>
          </Link>

          <div className={styles.headerMeta}>
            <div className={styles.networkBadge} aria-label="Connected to Starknet Mainnet">
              <span className={styles.networkDot} aria-hidden="true" />
              <span>Mainnet</span>
            </div>
            <WalletConnect />
          </div>
        </div>
      </header>

      {/* Main Console Body */}
      <main className={styles.consoleContainer}>
        {/* Mode Navigation Tabs */}
        <nav aria-label="Console modes" className={styles.modeTabList} role="tablist">
          <button
            role="tab"
            aria-selected={activeMode === 'create'}
            className={styles.modeTab}
            data-active={activeMode === 'create'}
            onClick={() => handleModeClick('create')}
          >
            <span>Create</span>
          </button>

          <button
            role="tab"
            aria-selected={activeMode === 'claim'}
            className={styles.modeTab}
            data-active={activeMode === 'claim'}
            disabled
            title="Claim flow unavailable in read-only mode"
          >
            <span>Claim</span>
          </button>

          <button
            role="tab"
            aria-selected={activeMode === 'refund'}
            className={styles.modeTab}
            data-active={activeMode === 'refund'}
            disabled
            title="Refund flow unavailable in read-only mode"
          >
            <span>Refund</span>
          </button>

          <button
            role="tab"
            aria-selected={activeMode === 'verifiedDemo'}
            className={styles.modeTab}
            data-active={activeMode === 'verifiedDemo'}
            onClick={() => handleModeClick('verifiedDemo')}
          >
            <span>Verified Demo</span>
          </button>
        </nav>

        {/* Active Workspace */}
        {activeMode === 'create' && <CreatePayment onUnsavedChange={setHasUnsaved} />}
        {activeMode === 'verifiedDemo' && <VerifiedDemo />}

        {/* Infrastructure Contract Bar */}
        <footer className={styles.contractFooter}>
          <div className={styles.contractInfoGroup}>
            <div className={styles.contractItem}>
              <strong>ConditionalPay:</strong>
              <code>{formatAddress(CONDITIONAL_PAY_CONTRACT)}</code>
              <a
                href={`https://voyager.online/contract/${CONDITIONAL_PAY_CONTRACT}`}
                target="_blank"
                rel="noreferrer"
                className={styles.explorerLink}
                title="View ConditionalPay contract on Voyager"
              >
                <span>Voyager</span>
                <span aria-hidden="true">↗</span>
              </a>
            </div>

            <div className={styles.contractItem}>
              <strong>STRK20 Pool:</strong>
              <code>{formatAddress(STRK20_POOL_CONTRACT)}</code>
              <a
                href={`https://voyager.online/contract/${STRK20_POOL_CONTRACT}`}
                target="_blank"
                rel="noreferrer"
                className={styles.explorerLink}
                title="View STRK20 pool contract on Voyager"
              >
                <span>Voyager</span>
                <span aria-hidden="true">↗</span>
              </a>
            </div>
          </div>
        </footer>
      </main>

      {/* In-app navigation guard modal */}
      <UnsavedModal
        isOpen={isUnsavedModalOpen}
        onStay={handleStay}
        onLeaveAnyway={handleLeaveAnyway}
      />
    </div>
  );
}

export default function ConsoleShell() {
  return (
    <ConsoleWalletProvider>
      <ConsoleInner />
    </ConsoleWalletProvider>
  );
}
