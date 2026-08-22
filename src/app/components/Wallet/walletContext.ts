"use client";
import { create } from "zustand";
import { ProviderInterface, AccountInterface, type WalletAccountV6 } from "starknet";
import { type WalletWithStarknetFeatures } from "@starknet-io/get-starknet-wallet-standard/features";


// import { StarknetWindowObject } from "@/app/core/StarknetWindowObject";

export interface WalletState {
    StarknetWalletObject: WalletWithStarknetFeatures | undefined,
    setMyStarknetWalletObject: (wallet: WalletWithStarknetFeatures) => void,
    address: string,
    setAddressAccount: (address: string) => void,
    chain: string,
    setChain: (chain: string) => void,
    myWalletAccount: WalletAccountV6|undefined;
    setMyWalletAccount: (myWAccount:WalletAccountV6)=>void;
    account: AccountInterface | undefined,
    setAccount: (account: AccountInterface) => void,
    provider: ProviderInterface | undefined,
    setProvider: (provider: ProviderInterface) => void,
    isConnected: boolean,
    setConnected: (isConnected: boolean) => void,
    displaySelectWalletUI: boolean,
    setSelectWalletUI: (displaySelectWalletUI: boolean) => void,
    walletApiList: string[],
    setWalletApiList: (version: string[]) => void,
    selectedApiVersion: string,
    setSelectedApiVersion: (version: string) => void,

}

export const useStoreWallet = create<WalletState>()(set => ({
    StarknetWalletObject: undefined,
    setMyStarknetWalletObject: (wallet: WalletWithStarknetFeatures) => { set({ StarknetWalletObject: wallet }) },
    address: "",
    setAddressAccount: (address: string) => { set({ address }) },
    chain: "",
    setChain: (chain: string) => { set({ chain }) },
    myWalletAccount: undefined,
    setMyWalletAccount: (myWAccount: WalletAccountV6) => { set({ myWalletAccount: myWAccount }) },
    account: undefined,
    setAccount: (account: AccountInterface) => { set({ account }) },
    provider: undefined,
    setProvider: (provider: ProviderInterface) => { set({ provider }) },
    isConnected: false,
    setConnected: (isConnected: boolean) => { set({ isConnected }) },
    displaySelectWalletUI: false,
    setSelectWalletUI: (displaySelectWalletUI: boolean) => { set({ displaySelectWalletUI }) },
    walletApiList: [],
    setWalletApiList: (walletApi: string[]) => { set({ walletApiList: walletApi }) },
    selectedApiVersion: "default",
    setSelectedApiVersion: (selectedApiVersion: string) => { set({ selectedApiVersion }) },
    }));
