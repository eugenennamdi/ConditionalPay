import { ProviderInterface, RpcProvider } from "starknet";

export const CONDITIONAL_PAY_MAINNET =
    "0x0166e31803cfab50383d5b636b86a5646233881fad3a2fb89354da63f6cdb483";
export const STRK20_POOL_MAINNET =
    "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a";
export const STRK_MAINNET =
    "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

// Frontend RPC providers, indexed. NEXT_PUBLIC_PROVIDER_URL is the public-client
// RPC key segment documented in .env.example.
export const myFrontendProviders: ProviderInterface[] = [
    new RpcProvider({ nodeUrl: "https://starknet-mainnet.g.alchemy.com/starknet/version/rpc/v0_10/" + process.env.NEXT_PUBLIC_PROVIDER_URL }),
    new RpcProvider({ nodeUrl: "https://starknet-testnet.public.blastapi.io/rpc/v0_7" }),
    new RpcProvider({ nodeUrl: "https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_10/" + process.env.NEXT_PUBLIC_PROVIDER_URL })];

// Frontend provider indices where the STRK20 privacy pool is available, mapped to a
// display name. Retained for wallet-network resolution in the future product UX.
export const Strk20Networks: Record<number, string> = { 0: "MAINNET", 2: "SEPOLIA" };
