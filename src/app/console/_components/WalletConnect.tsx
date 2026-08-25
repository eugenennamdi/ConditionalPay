'use client';

import React, { useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import styles from '../console.module.css';
import { useConsoleWallet } from '../_lib/ConsoleWalletContext';

export type WalletCapability = 'UNKNOWN' | 'SUPPORTED' | 'UNSUPPORTED';
export type PrivacyRegistration = 'UNKNOWN' | 'READY' | 'NOT_REGISTERED';
export type ChainStatus = 'MAINNET' | 'WRONG_NETWORK' | 'UNKNOWN';

export const REQUIRED_NOTE_CONFIRMATIONS = 10;
export const NOTE_MATURITY_MESSAGE = 'Requires 10 block confirmations.';

function formatAddress(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export default function WalletConnect() {
  const {
    connectedWallet,
    address,
    isConnecting,
    chainStatus,
    capability,
    privacyStatus,
    errorMessage,
    handleConnect,
    handleDisconnect,
  } = useConsoleWallet();

  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const popoverRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Handle outside click to close popover
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(event.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(event.target as Node)
      ) {
        setIsPopoverOpen(false);
      }
    }

    if (isPopoverOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isPopoverOpen]);

  // Copy address helper
  async function handleCopyAddress() {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback if clipboard API unavailable
    }
  }

  const isConnected = !!address && !!connectedWallet;

  return (
    <div className={styles.walletConnectWrapper}>
      {isConnected ? (
        <div className={styles.connectedAnchor}>
          <button
            ref={triggerRef}
            type="button"
            className={styles.connectedPill}
            onClick={() => setIsPopoverOpen((prev) => !prev)}
            aria-expanded={isPopoverOpen}
            aria-haspopup="dialog"
            aria-label={`Connected wallet: ${formatAddress(address)}. Click for details.`}
          >
            {chainStatus === 'MAINNET' ? (
              <Image
                src="/tokens/strk.png"
                alt=""
                width={14}
                height={14}
                className={styles.connectedIcon}
                aria-hidden="true"
              />
            ) : (
              <span className={styles.warningDot} aria-hidden="true" />
            )}
            <span className={styles.connectedAddress}>{formatAddress(address)}</span>
          </button>

          {isPopoverOpen && (
            <div
              ref={popoverRef}
              className={styles.walletPopover}
              role="dialog"
              aria-label="Wallet details"
            >
              <div className={styles.popoverHeader}>
                <div className={styles.popoverWalletTitleGroup}>
                  <span className={styles.popoverWalletName}>Ready Wallet</span>
                  {chainStatus === 'WRONG_NETWORK' && (
                    <span className={styles.popoverNetworkTag}>
                      Wrong network
                    </span>
                  )}
                </div>
              </div>

              {chainStatus === 'WRONG_NETWORK' && (
                <div className={styles.popoverAlert} role="alert">
                  Wrong network. Switch Ready Wallet to Starknet Mainnet.
                </div>
              )}

              <div className={styles.popoverAddressRow}>
                <code className={styles.popoverFullAddress} title={address}>
                  {address}
                </code>
                <button
                  type="button"
                  className={styles.popoverCopyBtn}
                  onClick={handleCopyAddress}
                  title="Copy full address"
                >
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>

              <div className={styles.popoverReadinessGrid}>
                <div className={styles.popoverReadinessItem}>
                  <span className={styles.readinessLabel}>STRK20</span>
                  <span
                    className={
                      capability === 'SUPPORTED'
                        ? styles.readinessSupported
                        : styles.readinessNeutral
                    }
                  >
                    {capability === 'SUPPORTED'
                      ? 'Supported'
                      : capability === 'UNSUPPORTED'
                      ? 'Unsupported'
                      : 'Unknown'}
                  </span>
                </div>

                <div className={styles.popoverReadinessItem}>
                  <span className={styles.readinessLabel}>Privacy</span>
                  <span
                    className={
                      privacyStatus === 'READY'
                        ? styles.readinessSupported
                        : styles.readinessNeutral
                    }
                  >
                    {privacyStatus === 'READY'
                      ? 'Ready'
                      : privacyStatus === 'NOT_REGISTERED'
                      ? 'Not Registered'
                      : 'Unknown'}
                  </span>
                </div>
              </div>

              <div className={styles.popoverFooter}>
                <button
                  type="button"
                  className={styles.popoverDisconnectBtn}
                  onClick={handleDisconnect}
                >
                  Disconnect
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className={styles.disconnectedGroup}>
          <button
            type="button"
            className={styles.connectWalletBtn}
            onClick={handleConnect}
            disabled={isConnecting}
            aria-label={isConnecting ? 'Connecting to Ready Wallet' : 'Connect Ready Wallet'}
          >
            {isConnecting ? 'Connecting…' : 'Connect wallet'}
          </button>

          {errorMessage && (
            <div className={styles.connectErrorNotice} role="alert">
              <span>{errorMessage}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
