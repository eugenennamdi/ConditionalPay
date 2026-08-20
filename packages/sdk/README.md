# @conditionalpay/sdk

TypeScript SDK foundation for ConditionalPay privacy-preserving conditional payments on Starknet with STRK20.

> [!WARNING]
> This SDK is currently in **Phase 2A (Foundation & Parity)** development. Wallet action composition and transaction execution are intentionally not yet implemented. This package is not published to npm and is not yet production ready.

---

## Overview

`@conditionalpay/sdk` provides core data structures, Poseidon hashing, and Serde calldata encoders matching the frozen Cairo `ConditionalPay` contract (commit `2b5f7a0`).

---

## Scope (Phase 2A)

- **Domain Constants & Types**: Mirrors Cairo types, payment states, and action discriminants.
- **Deterministic Numeric Inputs**: All numeric and felt inputs strictly require `BigIntish = bigint | string`. JavaScript `number` is rejected at runtime and compile-time to prevent silent precision loss beyond `Number.MAX_SAFE_INTEGER`.
- **Poseidon Hashing**: Pure functions to compute claim hashlocks, refund hashes, and payment IDs with exact Cairo parity.
- **Calldata Encoding**: Encoders for `Create`, `Claim`, and `Refund` actions matching the frozen Cairo Serde layout.
- **Range & Boundary Validation**: Strict validation for `u128` ($[0, 2^{128}-1]$), `u64` ($[0, 2^{64}-1]$), and `felt252` ($[0, \text{PRIME})$).
- **Cross-Language Test Vectors**: Deterministic vectors verified against both Cairo and TypeScript test suites.

---

## Domain Separation & Hashing Formulas

All hashing is computed using Poseidon over the Starknet prime field with explicit domain separation.

### 1. Claim Hashlock
$$\text{hashlock} = \text{Poseidon}\left(\text{'CONDITIONALPAY\_CLAIM\_V1'}, \text{claim\_preimage}\right)$$
- Domain constant: `0x434f4e444954494f4e414c5041595f434c41494d5f5631`

### 2. Refund Hash
$$\text{refund\_hash} = \text{Poseidon}\left(\text{'CONDITIONALPAY\_REFUND\_V1'}, \text{refund\_preimage}\right)$$
- Domain constant: `0x434f4e444954494f4e414c5041595f524546554e445f5631`

### 3. Payment ID
$$\text{payment\_id} = \text{Poseidon}\left(\begin{array}{l}
\text{'CONDITIONALPAY\_PAYMENT\_V1'}, \\
\text{token}, \\
\text{amount}, \\
\text{hashlock}, \\
\text{refund\_hash}, \\
\text{claim\_after}, \\
\text{expires\_at}, \\
\text{approver}, \\
\text{nonce}
\end{array}\right)$$
- Domain constant: `0x434f4e444954494f4e414c5041595f5041594d454e545f5631`
- Excludes creator/claimant addresses and pool address from the hash.

---

## Action Discriminants & Serde Calldata Layout

| Action | Discriminant | Calldata Layout | Length |
|---|---|---|---|
| `Create` | `0` | `[0, token, amount, hashlock, refund_hash, claim_after, expires_at, approver, nonce]` | 9 felts |
| `Claim` | `1` | `[1, payment_id, claim_preimage, note_id]` | 4 felts |
| `Refund` | `2` | `[2, payment_id, refund_preimage, note_id]` | 4 felts |

---

## Security & Privacy Model

- **Bearer Credentials**: `claim_preimage` and `refund_preimage` are bearer credentials. Anyone possessing a valid unused preimage can exercise its authorized path within the valid timing window.
- **Identity Privacy**: ConditionalPay does not store creator, claimant, or refunder addresses on-chain.
- **Public Observability**: Payment IDs, token addresses, amounts, hashlocks, timestamps, approver addresses, nonces, and event logs are publicly visible on Starknet. STRK20 provides the private-note layer.
- **Routing**: `note_id` controls settlement destination in STRK20 open-note deposits.

---

## Verification & Tests

```bash
# Typecheck
npm run typecheck

# Build TypeScript
npm run build

# Run unit & parity tests
npm test
```
