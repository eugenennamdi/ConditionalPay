import { ProviderInterface, RpcProvider } from "starknet";

export const CONDITIONAL_PAY_MAINNET =
    "0x0166e31803cfab50383d5b636b86a5646233881fad3a2fb89354da63f6cdb483";
export const STRK20_POOL_MAINNET =
    "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a";
export const STRK_MAINNET =
    "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

function resolveRpcUrl(envValue?: string, network: 'mainnet' | 'sepolia' = 'mainnet'): string {
    const trimmed = envValue ? envValue.trim() : '';
    const isPlaceholderOrEmpty =
        !trimmed ||
        trimmed === 'your_alchemy_key_here' ||
        trimmed === 'undefined' ||
        trimmed === 'null';

    if (isPlaceholderOrEmpty) {
        return network === 'mainnet'
            ? 'https://rpc.starknet.lava.build'
            : 'https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_10/your_alchemy_key_here';
    }

    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
        return trimmed;
    }

    return `https://starknet-${network}.g.alchemy.com/starknet/version/rpc/v0_10/${trimmed}`;
}

// Frontend RPC providers, indexed. NEXT_PUBLIC_PROVIDER_URL is the public-client
// RPC URL or Alchemy key segment documented in .env.example.
export const myFrontendProviders: ProviderInterface[] = [
    new RpcProvider({ nodeUrl: resolveRpcUrl(process.env.NEXT_PUBLIC_PROVIDER_URL, 'mainnet') }),
    new RpcProvider({ nodeUrl: resolveRpcUrl(process.env.NEXT_PUBLIC_PROVIDER_URL, 'sepolia') }),
    new RpcProvider({ nodeUrl: resolveRpcUrl(process.env.NEXT_PUBLIC_PROVIDER_URL, 'sepolia') })
];

// Frontend provider indices where the STRK20 privacy pool is available, mapped to a
// display name. Retained for wallet-network resolution in the future product UX.
export const Strk20Networks: Record<number, string> = { 0: "MAINNET", 2: "SEPOLIA" };
