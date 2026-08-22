# ConditionalPay Mainnet evidence

## Deployment

- Network: Starknet Mainnet
- ConditionalPay: [`0x0166e31803cfab50383d5b636b86a5646233881fad3a2fb89354da63f6cdb483`](https://voyager.online/contract/0x0166e31803cfab50383d5b636b86a5646233881fad3a2fb89354da63f6cdb483)
- Class hash: `0x04ba374a48b878cb1b59b9cbfdc1c56527a6a1d2c64f645c7435a79c037c828b`
- Canonical STRK20 pool: [`0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a`](https://voyager.online/contract/0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a)
- STRK: [`0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d`](https://voyager.online/contract/0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d)

Post-deployment reads confirmed that `get_strk20_pool()` equals the canonical STRK20 pool and that the initial `get_locked_by_token(STRK)` value was zero.

## Verified lifecycle

| Step | Transaction | Block | Execution / finality | State transition | Authenticated ConditionalPay event |
|---|---|---:|---|---|---|
| TX1 CREATE A | [`0x47edc8e74fc08c4726a817a23085a2ae2dd95590fb6a32d3b3c5b5159e586e6`](https://voyager.online/tx/0x47edc8e74fc08c4726a817a23085a2ae2dd95590fb6a32d3b3c5b5159e586e6) | 13701781 | `SUCCEEDED / ACCEPTED_ON_L1` | `UNINITIALIZED -> ACTIVE` | `PaymentCreated` |
| TX2 CLAIM A | [`0xde61c431a92dabc7b8672cd08cdce0b479b83ca261c0591992a84e6e7779b7`](https://voyager.online/tx/0xde61c431a92dabc7b8672cd08cdce0b479b83ca261c0591992a84e6e7779b7) | 13704626 | `SUCCEEDED / ACCEPTED_ON_L2` | `ACTIVE -> CLAIMED` | `PaymentClaimed` |
| TX3 CREATE B | [`0x2f2f88ab25f64a619aa05dcaff7c2af85efc6cd086a229696ac8edc3bdd6d26`](https://voyager.online/tx/0x2f2f88ab25f64a619aa05dcaff7c2af85efc6cd086a229696ac8edc3bdd6d26) | 13707204 | `SUCCEEDED / ACCEPTED_ON_L2` | `UNINITIALIZED -> ACTIVE` | `PaymentCreated` |
| TX4 REFUND B | [`0x64cfec311d340f97fb0d9245de01ab36f3267259ac162290265e55ca99dd88d`](https://voyager.online/tx/0x64cfec311d340f97fb0d9245de01ab36f3267259ac162290265e55ca99dd88d) | 13708549 | `SUCCEEDED / ACCEPTED_ON_L2` | `ACTIVE -> REFUNDED` | `PaymentRefunded` |

The events above were authenticated by contract address and event selector. They must not be attributed using each transaction's sender because STRK20 private transactions are relayed.

## Final state

- Payment A: `CLAIMED`
- Payment B: `REFUNDED`
- `get_locked_by_token(STRK) = 0`

The historical localhost execution harness used for these transactions is preserved separately on branch `evidence/mainnet-lifecycle` at tag `mainnet-lifecycle-v1`. It is intentionally absent from the submission UI.
