# @conditionalpay/sdk

TypeScript SDK foundation for ConditionalPay privacy-preserving conditional payments on Starknet with STRK20.

> [!NOTE]
> This SDK powered the verified ConditionalPay Mainnet CREATE / CLAIM / CREATE / REFUND lifecycle. Transaction submission and wallet connection remain application-layer responsibilities. The package is private and is not published to npm.

---

## Overview

`@conditionalpay/sdk` provides core data structures, Poseidon hashing, Serde calldata encoders, STRK20 action builders, on-chain state query helpers, and lifecycle event parsers matching the frozen Cairo `ConditionalPay` contract (commit `2b5f7a0`).

---

## Scope

- **Domain Constants & Canonical Types**: Directly imports and re-exports canonical action types (`STRK20_ACTION`, `STRK20_WITHDRAW_ACTION`, `STRK20_TRANSFER_ACTION`, `STRK20_INVOKE_ACTION`, `STRK20_CALLDATA_ITEM`) from `starknet` and `@starknet-io/types-js`.
- **Deterministic Numeric Inputs**: All numeric and felt inputs strictly require `BigIntish = bigint | string`. JavaScript `number` is rejected to prevent silent precision loss beyond `Number.MAX_SAFE_INTEGER`.
- **Poseidon Hashing**: Pure functions to compute claim hashlocks, refund hashes, and payment IDs with exact Cairo parity.
- **Calldata Encoding**: Pure Serde encoders for `Create`, `Claim`, and `Refund` actions matching the frozen Cairo layout.
- **STRK20 Action Builders**: Pure composition helpers for `CREATE`, `CLAIM`, and `REFUND` action batches typed against `STRK20_ACTION[]`.
- **On-Chain Query Layer**: Dependency-injected view helpers (`getPayment`, `getLockedByToken`, `getStrk20Pool`, `computePaymentIdOnchain`).
- **Lifecycle Event Parsing**: Pure Starknet event parser (`parseConditionalPayEvent`, `parseConditionalPayEvents`) with exact selector matching and contract-address boundary checks.
- **Range & Boundary Validation**: Strict validation for `u128` ($[0, 2^{128}-1]$), `u64` ($[0, 2^{64}-1]$), `felt252` ($[0, \text{PRIME})$), and `ContractAddress` ($[0, 2^{251})$).
- **Cross-Language Test Vectors**: Deterministic vectors verified against both Cairo and TypeScript test suites.

---

## Query Layer (`query.ts`)

### 1. `getPayment(provider, conditionalPay, paymentId)`
Reads the stored payment record from `get_payment(payment_id)`.
- **State Decoding**:
  - `0` $\to$ `PaymentState.UNINITIALIZED`
  - `1` $\to$ `PaymentState.ACTIVE`
  - `2` $\to$ `PaymentState.CLAIMED`
  - `3` $\to$ `PaymentState.REFUNDED`
- **Existence Semantics**: An uninitialized / unknown payment ID returns a default payment record with `state === PaymentState.UNINITIALIZED`.
- **Exact Cardinality & Strict Bool**: Enforces exact 9-felt response layout and strict `core::bool` decoding (`0` -> `false`, `1` -> `true`; other values throw `RangeError`).
- **Pure Helpers**:
  - `isPaymentInitialized(payment)`: `payment.state !== UNINITIALIZED`
  - `isPaymentActive(payment)`: `payment.state === ACTIVE`
  - `isApprovalGated(payment)`: `BigInt(payment.approver) !== 0n`
  - `requiresApproval(payment)`: `isApprovalGated(payment) && !payment.approved`

### 2. `getLockedByToken(provider, conditionalPay, token)`
Reads `get_locked_by_token(token)` returning the total locked `u128` token liability as `bigint` (enforces exact 1-felt response).

### 3. `getStrk20Pool(provider, conditionalPay)`
Reads `get_strk20_pool()` returning the immutable STRK20 privacy pool address configured at contract deployment (enforces exact 1-felt response).

### 4. `computePaymentIdOnchain(provider, conditionalPay, params)`
Calls `compute_payment_id(params)` for on-chain verification and debug checks (enforces exact 1-felt response).

---

## Event Parsing (`events.ts`)

Parses raw Starknet events emitted by ConditionalPay with canonical selector matching and optional contract address origin authentication:

```typescript
import { parseConditionalPayEvent, parseConditionalPayEvents } from '@conditionalpay/sdk';

// Supplying expectedConditionalPay enforces contract origin authentication
const event = parseConditionalPayEvent(rawEvent, conditionalPayAddress);
if (event?.type === 'PaymentCreated') {
  console.log('Payment created:', event.payment_id, event.token, event.amount);
}
```

> [!NOTE]
> **Event Trust Boundary**: Calling `parseConditionalPayEvent(event)` without `expectedConditionalPay` parses the event structure and selectors only, and does **not** verify emitting contract provenance. To authenticate contract origin, pass `expectedConditionalPay`.

### Event Selectors
- `PaymentCreated`: `hash.getSelectorFromName('PaymentCreated')`
- `PaymentClaimed`: `hash.getSelectorFromName('PaymentClaimed')`
- `PaymentRefunded`: `hash.getSelectorFromName('PaymentRefunded')`
- `PaymentApproved`: `hash.getSelectorFromName('PaymentApproved')`

---

## STRK20 Action Composition & Ordering

### 1. CREATE Action Batch (`buildCreateActions`)
```
[ Action 1: withdraw ] -> Private withdrawal from pool to fund ConditionalPay contract
[ Action 2: invoke   ] -> External invoke to ConditionalPay.privacy_invoke(Create(...))
```

### 2. CLAIM Action Batch (`buildClaimActions`)
```
[ Action 1: transfer ] -> Allocates an OPEN settlement note (amount: "OPEN") for recipient
[ Action 2: invoke   ] -> External invoke to ConditionalPay.privacy_invoke(Claim(...)) with note_id = ${openNoteIds[0]}
```

### 3. REFUND Action Batch (`buildRefundActions`)
```
[ Action 1: transfer ] -> Allocates an OPEN settlement note (amount: "OPEN") for recipient
[ Action 2: invoke   ] -> External invoke to ConditionalPay.privacy_invoke(Refund(...)) with note_id = ${openNoteIds[0]}
```

---

## Integration Boundaries

### Token-Source Rule (CLAIM / REFUND)
The `token` passed to `buildClaimActions` and `buildRefundActions` must be the token read from the canonical on-chain `Payment` record for that `payment_id` (via `getPayment` / `PaymentCreated` event), **not** an arbitrary UI token selection.

### Recipient Semantics (CLAIM / REFUND)
The `recipient` parameter is exclusively a Wallet API settlement-routing input specifying the account for which the wallet allocates the destination open settlement note in the privacy pool. It is **never** passed into `ConditionalPay` contract calldata (`[discriminant, payment_id, preimage, '${openNoteIds[0]}']`), and the `ConditionalPay` contract stores no claimant or refunder identity on-chain.

---

## Security & Observability

- **Contract Storage**: ConditionalPay stores no creator, claimant, or refunder addresses on-chain.
- **Public Observability**: The payment configuration itself (payment ID, token, amount, hashlock, refund hash, timestamps, approver, nonce) and lifecycle events are public on Starknet. STRK20 provides the private-note balance and transfer layer.
- **Bearer Secrets**: `claim_preimage` and `refund_preimage` are bearer credentials that remain off-chain until settlement.

---

## Verification & Tests

```bash
# Typecheck
npm run typecheck

# Build TypeScript
npm run build

# Run all unit, parity, action, query, and event tests
npm test
```
