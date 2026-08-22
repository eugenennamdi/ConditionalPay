# ConditionalPay deployment

- Network: Starknet Mainnet
- ConditionalPay: `0x0166e31803cfab50383d5b636b86a5646233881fad3a2fb89354da63f6cdb483`
- Class hash: `0x04ba374a48b878cb1b59b9cbfdc1c56527a6a1d2c64f645c7435a79c037c828b`
- Canonical STRK20 pool: `0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a`
- STRK: `0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d`

Deployment verification confirmed that `get_strk20_pool()` matches the canonical pool and that the initial STRK liability was zero. The verified Mainnet CREATE / CLAIM / CREATE / REFUND lifecycle completed with Payment A `CLAIMED`, Payment B `REFUNDED`, and final `get_locked_by_token(STRK) = 0`.
