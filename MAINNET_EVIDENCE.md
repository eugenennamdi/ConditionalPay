# ConditionalPay Mainnet Evidence

## Deployment

- Network: Starknet Mainnet
- ConditionalPay: [`0x0166e31803cfab50383d5b636b86a5646233881fad3a2fb89354da63f6cdb483`](https://voyager.online/contract/0x0166e31803cfab50383d5b636b86a5646233881fad3a2fb89354da63f6cdb483)
- Class hash: `0x04ba374a48b878cb1b59b9cbfdc1c56527a6a1d2c64f645c7435a79c037c828b`
- Canonical STRK20 pool: [`0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a`](https://voyager.online/contract/0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a)
- STRK: [`0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d`](https://voyager.online/contract/0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d)

Post-deployment reads confirmed that `get_strk20_pool()` equals the canonical STRK20 pool and that the initial `get_locked_by_token(STRK)` value was zero.

## Source Verification

- **Contract**: [`0x0166e31803cfab50383d5b636b86a5646233881fad3a2fb89354da63f6cdb483`](https://voyager.online/contract/0x0166e31803cfab50383d5b636b86a5646233881fad3a2fb89354da63f6cdb483)
- **Class hash**: `0x04ba374a48b878cb1b59b9cbfdc1c56527a6a1d2c64f645c7435a79c037c828b`
- **Cairo / Scarb**: `2.20.0`
- **Voyager verification**: `Success`
- **Verified class**: [https://voyager.online/class/0x04ba374a48b878cb1b59b9cbfdc1c56527a6a1d2c64f645c7435a79c037c828b](https://voyager.online/class/0x04ba374a48b878cb1b59b9cbfdc1c56527a6a1d2c64f645c7435a79c037c828b)

## Production Console Mainnet E2E (Phase 6)

The interactive [ConditionalPay Console](https://conditionalpay.vercel.app/console) was validated on Starknet Mainnet via Ready Wallet through a complete controlled end-to-end lifecycle.

| Step | Transaction | Block | Execution / finality | State transition | Authenticated ConditionalPay event |
|---|---|---:|---|---|---|
| CREATE | [`0x37b475d725258586de2db0ce2e6089585589c19658eb5142a1f1a555ddb555f`](https://voyager.online/tx/0x37b475d725258586de2db0ce2e6089585589c19658eb5142a1f1a555ddb555f) | 13827404 | `SUCCEEDED / ACCEPTED_ON_L2` | `UNINITIALIZED -> ACTIVE` | `PaymentCreated` |
| CLAIM PREVIEW | *Ready Wallet preview deliberately cancelled* | — | `CANCELLED_BY_USER` | *Remains ACTIVE* | — |
| REFUND | [`0x441b1912620f38de58222ab3b8acc562d1c3d157f4f85a695e3042a969974aa`](https://voyager.online/tx/0x441b1912620f38de58222ab3b8acc562d1c3d157f4f85a695e3042a969974aa) | 13829460 | `SUCCEEDED / ACCEPTED_ON_L2` | `ACTIVE -> REFUNDED` | `PaymentRefunded` |

### Lifecycle Details
- **Payment ID**: `0x33715ae8d6ff7d45f87c504ae6d203f32d412d2010a1175c4ca5da1e02a04d1`
- **Principal Amount**: `0.1 STRK`
- **Claim Time (`claim_after`)**: `0` (immediate eligibility)
- **Expiry (`expires_at`)**: `1787638190` (1 hour refund window)
- **CLAIM Preview**: Ready Wallet OPEN-note settlement topology was previewed and inspected, then deliberately cancelled. No CLAIM transaction was broadcast, and payment was re-verified onchain as `ACTIVE`.
- **Terminal State**: `getPayment(paymentId).state == 3` (`REFUNDED`). Replay is strictly prevented and funds returned to the creator's shielded STRK20 note.

## Historical Bootstrap Lifecycle

| Step | Transaction | Block | Execution / finality | State transition | Authenticated ConditionalPay event |
|---|---|---:|---|---|---|
| TX1 CREATE A | [`0x47edc8e74fc08c4726a817a23085a2ae2dd95590fb6a32d3b3c5b5159e586e6`](https://voyager.online/tx/0x47edc8e74fc08c4726a817a23085a2ae2dd95590fb6a32d3b3c5b5159e586e6) | 13701781 | `SUCCEEDED / ACCEPTED_ON_L1` | `UNINITIALIZED -> ACTIVE` | `PaymentCreated` |
| TX2 CLAIM A | [`0xde61c431a92dabc7b8672cd08cdce0b479b83ca261c0591992a84e6e7779b7`](https://voyager.online/tx/0xde61c431a92dabc7b8672cd08cdce0b479b83ca261c0591992a84e6e7779b7) | 13704626 | `SUCCEEDED / ACCEPTED_ON_L1` | `ACTIVE -> CLAIMED` | `PaymentClaimed` |
| TX3 CREATE B | [`0x2f2f88ab25f64a619aa05dcaff7c2af85efc6cd086a229696ac8edc3bdd6d26`](https://voyager.online/tx/0x2f2f88ab25f64a619aa05dcaff7c2af85efc6cd086a229696ac8edc3bdd6d26) | 13707204 | `SUCCEEDED / ACCEPTED_ON_L1` | `UNINITIALIZED -> ACTIVE` | `PaymentCreated` |
| TX4 REFUND B | [`0x64cfec311d340f97fb0d9245de01ab36f3267259ac162290265e55ca99dd88d`](https://voyager.online/tx/0x64cfec311d340f97fb0d9245de01ab36f3267259ac162290265e55ca99dd88d) | 13708549 | `SUCCEEDED / ACCEPTED_ON_L1` | `ACTIVE -> REFUNDED` | `PaymentRefunded` |

### Historical Snapshot
- Payment A: `CLAIMED`
- Payment B: `REFUNDED`
- Snapshot liability at block 13708549: `get_locked_by_token(STRK) = 0`

The historical localhost execution harness used for bootstrap transactions is preserved on branch `evidence/mainnet-lifecycle` at tag `mainnet-lifecycle-v1`.
