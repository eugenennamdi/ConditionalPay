# ConditionalPay

**Programmable private settlement infrastructure for STRK20 on Starknet.**

STRK20 gives applications shielded assets.
ConditionalPay makes those assets programmable.

[![Live Console](https://img.shields.io/badge/Live%20Console-conditionalpay.vercel.app-blue)](https://conditionalpay.vercel.app/console)
[![Mainnet Contract](https://img.shields.io/badge/Mainnet-0x0166e318...b483-emerald)](https://voyager.online/contract/0x0166e31803cfab50383d5b636b86a5646233881fad3a2fb89354da63f6cdb483)
[![Voyager Verified](https://img.shields.io/badge/Voyager-Source%20Verified-brightgreen)](https://voyager.online/contract/0x0166e31803cfab50383d5b636b86a5646233881fad3a2fb89354da63f6cdb483)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

- **Production Console:** [https://conditionalpay.vercel.app/console](https://conditionalpay.vercel.app/console)
- **Mainnet Contract:** [`0x0166e31803cfab50383d5b636b86a5646233881fad3a2fb89354da63f6cdb483`](https://voyager.online/contract/0x0166e31803cfab50383d5b636b86a5646233881fad3a2fb89354da63f6cdb483) *(Source Verified on Voyager)*
- **Mainnet Evidence:** [MAINNET_EVIDENCE.md](./MAINNET_EVIDENCE.md)
- **3-Minute Mainnet Demo:** [https://youtu.be/MuCbdCYPIzc](https://youtu.be/MuCbdCYPIzc)

---

## State machine

```text
CREATE → ACTIVE → CLAIMED
                ↘ REFUNDED
```

- **Hashlocked claims:** CLAIM reveals a domain-separated Poseidon preimage matching the stored hashlock.
- **Time locks:** `claim_after` gates execution until a block timestamp; `expires_at` opens the refund window.
- **Optional approval:** configured Starknet address must invoke `approve(payment_id)` before claim revelation.
- **Encrypted Creator Recovery:** client-side PBKDF2 (600,000 iter) + AES-256-GCM envelope preserving full payment metadata and preimages.
- **Reduced Claim Access:** exportable recipient envelope containing solely the payment identifier and claim preimage.
- **Ready Wallet STRK20 integration:** native STRK20 `strk20InvokeTransaction` execution with OPEN-note settlement topology.
- **Shielded return:** settled funds return directly into STRK20 shielded notes.

---

## How it works

Standard public escrows link user account addresses directly to locked funds and claim operations. ConditionalPay instead operates through the STRK20 pool's `privacy_invoke` path:

1. **CREATE (`withdraw` + `invoke CREATE`):** The wallet withdraws funds from an STRK20 note directly to ConditionalPay. ConditionalPay verifies incoming funding against prospective liability, derives a domain-separated Payment ID, and stores the payment as `ACTIVE`.
2. **CLAIM (`transfer OPEN` + `invoke CLAIM`):** The claimant presents the claim preimage. Upon verifying time conditions, optional approval, and hashlock validity, ConditionalPay marks the payment `CLAIMED` and deposits the stored amount into the claimant's STRK20 OPEN note.
3. **REFUND (`transfer OPEN` + `invoke REFUND`):** If the payment expires (`block_timestamp >= expires_at`), the creator presents the refund preimage to transition the state to `REFUNDED` and recover funds into their STRK20 OPEN note.

`CLAIMED` and `REFUNDED` are strict terminal states, preventing double settlement or replay.

---

## Interactive Console

The production application at [`/console`](https://conditionalpay.vercel.app/console) provides full lifecycle management:

- **Create Payment:** configure amount, claim eligibility time, expiry window, and optional approver; generates cryptographic felt252 preimages and downloads an encrypted Creator Recovery file.
- **Claim Access Handoff:** creator exports a password-encrypted recipient bundle containing only the claim credential.
- **Claim Settlement:** recipient imports Claim Access credentials, runs preflight verification, and executes settlement to Ready Wallet.
- **Refund Settlement:** creator imports Creator Recovery, verifies expiry eligibility, and executes refund settlement.
- **Verified Demo:** independent, wallet-free replay mode that authenticates recorded Mainnet evidence and queries live Starknet RPC state.

---

## Architecture

```text
Application UI / Console
    │
    │ @conditionalpay/sdk action builders
    ▼
Ready Wallet / Privacy Wallet
    │
    │ STRK20 zero-knowledge proof construction & note relay
    ▼
Canonical STRK20 Pool (0x040337...812a)
    │
    │ privacy_invoke(ConditionalPayAction)
    ▼
ConditionalPay Contract (0x0166e3...b483)
    ├── Payment state machine & Poseidon hashlocks
    ├── Address-gated approval registry
    ├── Per-token locked liability accounting (get_locked_by_token)
    └── Exact ERC-20 allowance for settlement back to STRK20
```

---

## Privacy boundary

### What ConditionalPay protects
- **No address storage:** ConditionalPay does not store creator, claimant, or refunder addresses in its payment state.
- **Shielded outputs:** Settlement returns directly into STRK20 shielded notes via `transfer OPEN`.
- **Relayed execution:** Private transactions are submitted by STRK20 relayers; transaction senders do not represent participant identities.

### What remains public onchain
- Token address and principal amount at the contract boundary.
- Hashlocks, refund hashes, nonces, timing constraints (`claim_after`, `expires_at`), approver address, and approval state.
- Emitted lifecycle events (`PaymentCreated`, `PaymentClaimed`, `PaymentRefunded`).
- Revealed preimages after successful claim or refund execution.
- OPEN-note settlement amounts at the STRK20 boundary.

*ConditionalPay makes no claim of total anonymity, hidden token amounts, or hidden timing conditions.*

---

## Verified Mainnet evidence

- **ConditionalPay:** [`0x0166e31803cfab50383d5b636b86a5646233881fad3a2fb89354da63f6cdb483`](https://voyager.online/contract/0x0166e31803cfab50383d5b636b86a5646233881fad3a2fb89354da63f6cdb483) *(Source Verified on Voyager)*
- **Class hash:** `0x04ba374a48b878cb1b59b9cbfdc1c56527a6a1d2c64f645c7435a79c037c828b`
- **Canonical STRK20 pool:** [`0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a`](https://voyager.online/contract/0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a)
- **STRK:** [`0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d`](https://voyager.online/contract/0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d)

| Step | Transaction | Block | Status | Authenticated Event |
|---|---|---:|---|---|
| CREATE | [`0x37b475...db555f`](https://voyager.online/tx/0x37b475d725258586de2db0ce2e6089585589c19658eb5142a1f1a555ddb555f) | 13827404 | `ACCEPTED_ON_L2` | `PaymentCreated` |
| CLAIM | [`0xde61c4...7779b7`](https://voyager.online/tx/0xde61c431a92dabc7b8672cd08cdce0b479b83ca261c0591992a84e6e7779b7) | 13704626 | `ACCEPTED_ON_L1` | `PaymentClaimed` |
| REFUND | [`0x441b19...974aa`](https://voyager.online/tx/0x441b1912620f38de58222ab3b8acc562d1c3d157f4f85a695e3042a969974aa) | 13829460 | `ACCEPTED_ON_L2` | `PaymentRefunded` |

See [MAINNET_EVIDENCE.md](./MAINNET_EVIDENCE.md) for full transaction parameters and historical bootstrap details.

---

## SDK

`packages/sdk` provides typed TypeScript abstractions:

- Domain-separated Poseidon hashing and Payment ID derivation matching Cairo contract logic.
- Canonical action builders: `buildCreateActions`, `buildClaimActions`, `buildRefundActions`.
- Onchain state queries (`getPayment`, `getLockedByToken`, `getStrk20Pool`).
- Authenticated event parsing (`parseConditionalPayEvent`).
- CSPRNG credential generation (`generateSecurePreimage`, `generateSecureNonce`).
- OWASP PBKDF2/AES-256-GCM encrypted envelope export and import (`exportSinglePaymentCredentials`, `importClaimAccessCredentials`).
- Deterministic cross-language test vectors shared with Cairo suites.

---

## Development and testing

### Prerequisites
- Node.js 24+
- npm 11+
- Scarb (Cairo 2.20+)
- Starknet RPC endpoint

```bash
# Install dependencies
npm ci

# Environment configuration
cp .env.example .env.local

# Run complete test suites
(cd cairo && scarb test)
npm run check:test-vectors
npm run test:sdk
npm run test:frontend
npm test

# Build production application
npm run build
```

---

## Security and limitations

- **Audit status:** No formal third-party audit has been completed.
- **Bearer model:** Claim and refund preimages are bearer secrets. Anyone with access to a valid preimage and meeting timing/approval conditions may execute settlement.
- **Key management:** Passphrases must never be stored beside encrypted envelopes. Plaintext preimages are never persisted to disk, browser storage, or server logs. See [SECURITY.md](./SECURITY.md).
- **Token support:** Frontend Console is configured for canonical STRK, though the Cairo contract and TypeScript SDK are token-agnostic.
- **Wallet compatibility:** Requires a privacy-enabled Starknet wallet supporting the STRK20 Wallet API (such as Ready Wallet).

---

## License

ConditionalPay is released under the [MIT License](./LICENSE). Original starter-kit copyright attribution is preserved.
