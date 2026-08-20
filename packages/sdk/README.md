# @conditionalpay/sdk

TypeScript SDK foundation for ConditionalPay privacy-preserving conditional payments on Starknet with STRK20.

> [!WARNING]
> This SDK is currently in **Phase 2B (STRK20 Action Builders)** development. Transaction submission and wallet connection hooks are handled by the dapp application layer. This package is private and not published to npm.

---

## Overview

`@conditionalpay/sdk` provides core data structures, Poseidon hashing, Serde calldata encoders, and STRK20 Privacy Wallet API action builders matching the frozen Cairo `ConditionalPay` contract (commit `2b5f7a0`).

---

## Scope (Phase 2A & 2B)

- **Domain Constants & Canonical Types**: Directly imports and re-exports canonical action types (`STRK20_ACTION`, `STRK20_WITHDRAW_ACTION`, `STRK20_TRANSFER_ACTION`, `STRK20_INVOKE_ACTION`, `STRK20_CALLDATA_ITEM`) from `starknet`.
- **Deterministic Numeric Inputs**: All numeric and felt inputs strictly require `BigIntish = bigint | string`. JavaScript `number` is rejected at runtime and compile-time to prevent silent precision loss beyond `Number.MAX_SAFE_INTEGER`.
- **Poseidon Hashing**: Pure functions to compute claim hashlocks, refund hashes, and payment IDs with exact Cairo parity.
- **Calldata Encoding**: Encoders for `Create`, `Claim`, and `Refund` actions matching the frozen Cairo Serde layout.
- **STRK20 Action Builders**: Pure composition helpers for `CREATE`, `CLAIM`, and `REFUND` action batches directly typed against `STRK20_ACTION[]` for `WalletAccountV6.strk20InvokeTransaction(...)`.
- **Standard Approver Call**: Helper for `ConditionalPay.approve(payment_id)`.
- **Range & Boundary Validation**: Strict validation for `u128` ($[0, 2^{128}-1]$), `u64` ($[0, 2^{64}-1]$), `felt252` ($[0, \text{PRIME})$), and `ContractAddress` ($[0, 2^{251})$).
- **Cross-Language Test Vectors**: Deterministic vectors verified against both Cairo and TypeScript test suites.

---

## STRK20 Action Composition & Ordering

### 1. CREATE Action Batch (`buildCreateActions`)
```
[ Action 1: withdraw ] -> Private withdrawal from pool to fund ConditionalPay contract
[ Action 2: invoke   ] -> External invoke to ConditionalPay.privacy_invoke(Create(...))
```
- **Ordering**: The contract must receive funds before `privacy_invoke(Create)` executes so that the token balance can be verified.
- **Rules**: Exactly 2 actions. No OPEN notes created. No fee action (wallet handles submission fees).

### 2. CLAIM Action Batch (`buildClaimActions`)
```
[ Action 1: transfer ] -> Allocates an OPEN settlement note (amount: "OPEN") for recipient
[ Action 2: invoke   ] -> External invoke to ConditionalPay.privacy_invoke(Claim(...)) with note_id = ${openNoteIds[0]}
```
- **Placeholder**: `OPEN_NOTE_ID_0 = '${openNoteIds[0]}'` is dynamically bound to the open note created in Action 1.
- **Rules**: Exactly 2 actions. No fee action appended.

### 3. REFUND Action Batch (`buildRefundActions`)
```
[ Action 1: transfer ] -> Allocates an OPEN settlement note (amount: "OPEN") for recipient
[ Action 2: invoke   ] -> External invoke to ConditionalPay.privacy_invoke(Refund(...)) with note_id = ${openNoteIds[0]}
```
- **Placeholder**: `OPEN_NOTE_ID_0 = '${openNoteIds[0]}'`.
- **Rules**: Exactly 2 actions. No fee action appended.

### 4. APPROVE Call (`buildApproveCall`)
```typescript
{
  contractAddress: conditionalPay,
  entrypoint: 'approve',
  calldata: [paymentId]
}
```
- Standard public contract call executed by the designated approver account.

---

## Important Integration Boundaries

### Token-Source Rule (CLAIM / REFUND)
The `token` passed to `buildClaimActions` and `buildRefundActions` must be the token read from the canonical on-chain `Payment` record for that `payment_id` (via `getPayment` / event lookup in Phase 2C), **not** an arbitrary UI token selection.

### Recipient Semantics (CLAIM / REFUND)
The `recipient` parameter is exclusively a Wallet API settlement-routing input specifying the account for which the wallet allocates the destination open settlement note in the privacy pool. It is **never** passed into `ConditionalPay` contract calldata (`[discriminant, payment_id, preimage, '${openNoteIds[0]}']`), and the `ConditionalPay` contract stores no claimant or refunder identity on-chain.

---

## Atomicity & Security Assumptions

- **Batch Atomicity**: `CREATE` relies on the funding withdrawal and contract invoke executing atomically within the same STRK20 batch.
- **Settlement Atomicity**: `CLAIM` and `REFUND` rely on OPEN note allocation, `privacy_invoke`, and pool settlement occurring within the surrounding STRK20 transaction.
- **Fee Ownership**: The wallet (via `strk20InvokeTransaction`) manages the fee action. The SDK action builders describe application-level actions only.
- **Bearer Credentials**: `claim_preimage` and `refund_preimage` are bearer secrets. Action builders never log, persist, or expose secret credentials.

---

## Verification & Tests

```bash
# Typecheck
npm run typecheck

# Build TypeScript
npm run build

# Run unit, parity, and action tests
npm test
```
