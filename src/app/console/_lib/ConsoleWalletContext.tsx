'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
  walletV6,
  validateAndParseAddress,
  constants as SNconstants,
} from 'starknet';
import { WALLET_API } from '@starknet-io/types-js';
import { createStore, type Store } from '@starknet-io/get-starknet-discovery';
import type { WalletWithStarknetFeatures } from '@starknet-io/get-starknet-wallet-standard/features';

export type WalletCapability = 'UNKNOWN' | 'SUPPORTED' | 'UNSUPPORTED';
export type PrivacyRegistration = 'UNKNOWN' | 'READY' | 'NOT_REGISTERED';
export type ChainStatus = 'MAINNET' | 'WRONG_NETWORK' | 'UNKNOWN';

export interface ConsoleWalletContextValue {
  wallets: WalletWithStarknetFeatures[];
  connectedWallet: WalletWithStarknetFeatures | null;
  address: string;
  isConnecting: boolean;
  chainStatus: ChainStatus;
  capability: WalletCapability;
  privacyStatus: PrivacyRegistration;
  errorMessage: string;
  handleConnect: () => Promise<void>;
  handleDisconnect: () => void;
  setPrivacyStatus: (status: PrivacyRegistration) => void;
  isReadyWalletDetected: boolean;
}

const ConsoleWalletContext = createContext<ConsoleWalletContextValue | null>(null);

function normalizeId(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function isReadyWallet(wallet: WalletWithStarknetFeatures): boolean {
  const norm = normalizeId(wallet.name);
  const custom = wallet as { id?: string; rdns?: string };
  return (
    norm.includes('ready') ||
    custom.id === 'ready' ||
    custom.id === 'ready-wallet' ||
    (typeof custom.rdns === 'string' && custom.rdns.toLowerCase().includes('ready'))
  );
}

let discoveryStoreInstance: Store | undefined;

function getDiscoveryStore(): Store {
  discoveryStoreInstance ??= createStore({ eip1193Adapters: [] });
  return discoveryStoreInstance;
}

export function ConsoleWalletProvider({ children }: { children: React.ReactNode }) {
  const [store] = useState(getDiscoveryStore);
  const [wallets, setWallets] = useState<WalletWithStarknetFeatures[]>(() => store.getWallets());
  const [connectedWallet, setConnectedWallet] = useState<WalletWithStarknetFeatures | null>(null);
  const [address, setAddress] = useState<string>('');
  const [isConnecting, setIsConnecting] = useState(false);
  const [chainStatus, setChainStatus] = useState<ChainStatus>('UNKNOWN');
  const [capability, setCapability] = useState<WalletCapability>('UNKNOWN');
  const [privacyStatus, setPrivacyStatus] = useState<PrivacyRegistration>('UNKNOWN');
  const [errorMessage, setErrorMessage] = useState<string>('');

  useEffect(() => {
    const unsubscribe = store.subscribe((next) => {
      setWallets(next.slice());
    });
    return () => unsubscribe();
  }, [store]);

  const handleConnect = useCallback(async () => {
    setErrorMessage('');
    setIsConnecting(true);

    try {
      const detectedReady = wallets.find(isReadyWallet);

      if (!detectedReady) {
        setErrorMessage('Ready Wallet not detected.');
        setIsConnecting(false);
        return;
      }

      const accountsResult = await walletV6.requestAccounts(detectedReady);
      if (!Array.isArray(accountsResult) || accountsResult.length === 0) {
        throw new Error('No Starknet account authorized by wallet.');
      }

      const parsedAddress = validateAndParseAddress(accountsResult[0]);
      setAddress(parsedAddress);

      const permissions = await walletV6.getPermissions(detectedReady);
      const isAuthorized = permissions.includes(WALLET_API.Permission.ACCOUNTS);
      if (!isAuthorized) {
        throw new Error('Account permission not granted.');
      }

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
          const specs = await walletV6.supportedSpecs(detectedReady);
          const hasSpec = Array.isArray(specs) && specs.length > 0;
          setCapability(hasSpec ? 'SUPPORTED' : 'UNKNOWN');
        }
      } catch {
        setCapability('UNKNOWN');
      }

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
  }, [wallets]);

  const handleDisconnect = useCallback(() => {
    setConnectedWallet(null);
    setAddress('');
    setChainStatus('UNKNOWN');
    setCapability('UNKNOWN');
    setPrivacyStatus('UNKNOWN');
    setErrorMessage('');
  }, []);

  const isReadyWalletDetected = Boolean(wallets.find(isReadyWallet));

  const value: ConsoleWalletContextValue = {
    wallets,
    connectedWallet,
    address,
    isConnecting,
    chainStatus,
    capability,
    privacyStatus,
    errorMessage,
    handleConnect,
    handleDisconnect,
    setPrivacyStatus,
    isReadyWalletDetected,
  };

  return (
    <ConsoleWalletContext.Provider value={value}>
      {children}
    </ConsoleWalletContext.Provider>
  );
}

export function useConsoleWallet(): ConsoleWalletContextValue {
  const ctx = useContext(ConsoleWalletContext);
  if (!ctx) {
    throw new Error('useConsoleWallet must be used within a ConsoleWalletProvider');
  }
  return ctx;
}
