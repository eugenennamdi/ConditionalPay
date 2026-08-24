'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  walletV6,
  validateAndParseAddress,
  constants as SNconstants,
} from 'starknet';
import { WALLET_API } from '@starknet-io/types-js';
import { createStore, type Store } from '@starknet-io/get-starknet-discovery';
import type { WalletWithStarknetFeatures } from '@starknet-io/get-starknet-wallet-standard/features';
import styles from '../console.module.css';

export type WalletCapability = 'UNKNOWN' | 'SUPPORTED' | 'UNSUPPORTED';
export type PrivacyRegistration = 'UNKNOWN' | 'READY' | 'NOT_REGISTERED';
export type ChainStatus = 'MAINNET' | 'WRONG_NETWORK' | 'UNKNOWN';

export const REQUIRED_NOTE_CONFIRMATIONS = 10;
export const NOTE_MATURITY_MESSAGE = 'Requires 10 block confirmations.';

function normalizeId(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isReadyWallet(wallet: WalletWithStarknetFeatures): boolean {
  const norm = normalizeId(wallet.name);
  const custom = wallet as { id?: string; rdns?: string };
  return (
    norm.includes('ready') ||
    custom.id === 'ready' ||
    custom.id === 'ready-wallet' ||
    (typeof custom.rdns === 'string' && custom.rdns.toLowerCase().includes('ready'))
  );
}

function formatAddress(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

let discoveryStoreInstance: Store | undefined;

function getDiscoveryStore(): Store {
  discoveryStoreInstance ??= createStore({ eip1193Adapters: [] });
  return discoveryStoreInstance;
}

export default function WalletConnect() {
  const [store] = useState(getDiscoveryStore);
  const [wallets, setWallets] = useState<WalletWithStarknetFeatures[]>(() => store.getWallets());
  const [connectedWallet, setConnectedWallet] = useState<WalletWithStarknetFeatures | null>(null);
  const [address, setAddress] = useState<string>('');
  const [isConnecting, setIsConnecting] = useState(false);
  const [chainStatus, setChainStatus] = useState<ChainStatus>('UNKNOWN');
  const [capability, setCapability] = useState<WalletCapability>('UNKNOWN');
  const [privacyStatus, setPrivacyStatus] = useState<PrivacyRegistration>('UNKNOWN');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const popoverRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Subscribe to discovery updates on mount (no execution, no network requests)
  useEffect(() => {
    const unsubscribe = store.subscribe((next) => {
      setWallets(next.slice());
    });
    return () => unsubscribe();
  }, [store]);

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

  // Connect explicit action
  async function handleConnect() {
    setErrorMessage('');
    setIsConnecting(true);

    try {
      const detectedReady = wallets.find(isReadyWallet);

      if (!detectedReady) {
        setErrorMessage('Ready Wallet not detected.');
        setIsConnecting(false);
        return;
      }

      // Request account access through standard Wallet API v6
      const accountsResult = await walletV6.requestAccounts(detectedReady);
      if (!Array.isArray(accountsResult) || accountsResult.length === 0) {
        throw new Error('No Starknet account authorized by wallet.');
      }

      const parsedAddress = validateAndParseAddress(accountsResult[0]);
      setAddress(parsedAddress);

      // Query permissions
      const permissions = await walletV6.getPermissions(detectedReady);
      const isAuthorized = permissions.includes(WALLET_API.Permission.ACCOUNTS);
      if (!isAuthorized) {
        throw new Error('Account permission not granted.');
      }

      // Chain verification (Mainnet required)
      const chainId = await walletV6.requestChainId(detectedReady);
      const isMainnet =
        chainId === SNconstants.StarknetChainId.SN_MAIN ||
        chainId === 'SN_MAIN' ||
        chainId === '0x534e5f4d41494e';

      if (isMainnet) {
        setChainStatus('MAINNET');
      } else {
        setChainStatus('WRONG_NETWORK');
        setErrorMessage('Wrong network. Switch Ready Wallet to Starknet Mainnet.');
      }

      // Wallet capability verification (STRK20 detection via version query)
      try {
        const supportedApis = await walletV6.supportedWalletApi(detectedReady);
        const hasV010OrHigher =
          Array.isArray(supportedApis) &&
          supportedApis.some((api) => {
            const num = parseFloat(api);
            return num >= 0.1 || api.includes('0.10');
          });

        if (hasV010OrHigher) {
          setCapability('SUPPORTED');
        } else {
          // Check supportedSpecs fallback
          const specs = await walletV6.supportedSpecs(detectedReady);
          const hasSpec = Array.isArray(specs) && specs.length > 0;
          setCapability(hasSpec ? 'SUPPORTED' : 'UNKNOWN');
        }
      } catch {
        setCapability('UNKNOWN');
      }

      // Privacy registration status:
      // Read-only discovery without user data prompt defaults to UNKNOWN.
      setPrivacyStatus('UNKNOWN');
      setConnectedWallet(detectedReady);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Wallet connection failed.';
      setErrorMessage(msg);
      setConnectedWallet(null);
      setAddress('');
      setChainStatus('UNKNOWN');
      setCapability('UNKNOWN');
    } finally {
      setIsConnecting(false);
    }
  }

  // Disconnect explicit action (resets local in-memory session state)
  function handleDisconnect() {
    setConnectedWallet(null);
    setAddress('');
    setChainStatus('UNKNOWN');
    setCapability('UNKNOWN');
    setPrivacyStatus('UNKNOWN');
    setErrorMessage('');
    setIsPopoverOpen(false);
  }

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
            <span
              className={chainStatus === 'MAINNET' ? styles.connectedDot : styles.warningDot}
              aria-hidden="true"
            />
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
                  <span className={styles.popoverNetworkTag}>
                    {chainStatus === 'MAINNET' ? 'Mainnet' : 'Wrong network'}
                  </span>
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
