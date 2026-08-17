# Phase 0: STRK20 Mainnet Integration & Wallet Compatibility Validation

## 1. Environment & Dependency Baseline
- **Network**: Starknet Mainnet (`SN_MAIN`)
- **Wallet**: Ready X (Standard Account, v5.33.8)
- **Dependency Stack (Frozen)**:
  - `starknet`: `10.7.0`
  - `@starknet-io/get-starknet-discovery`: `6.0.4`
  - `@starknet-io/get-starknet-wallet-standard`: `6.0.4`
  - `@starknet-io/types-js`: `0.10.4-beta.2`
  - React `19.2.1` / Next.js `16.3.1` (webpack)

---

## 2. Compatibility Findings & Protocol Insights
1. **Wallet API Spec Alignment**:
   - The legacy starter dependency stack produced `Unknown request type: wallet_strk20Balances` because older `starknet.js` v10.4.0 RPC definitions did not match Ready X's Wallet API v0.10.4-beta implementation.
   - Upgrading and unifying the dependency tree to `starknet@10.7.0` + `get-starknet@6.0.4` resolved all method routing errors cleanly without type assertions or casts.
2. **Account Initialization (`NOT_REGISTERED`)**:
   - A fresh Standard Account initially reports `NOT_REGISTERED` from `wallet_strk20Balances`.
   - First-time STRK20 privacy initialization and viewing key registration was completed through Ready X's native Shield flow.
   - Following native initialization, `strk20Balances([])` successfully queries and returns real-time shielded note balances.
3. **Fee Mechanism (`wallet_strk20InvokeTransaction`)**:
   - For dapp-initiated private invoke transactions (`wallet_strk20InvokeTransaction`), the wallet automatically adds a fee-withdrawal action covering the paymaster/relayer pool fee ($6.0\text{ STRK}$, read via `get_fee_amount()`).
   - This fee is debited directly from the user's private shielded note balance inside the ZK proof.

---

## 3. Verified Mainnet Transactions (Phase 0 Integration Evidence)

> [!NOTE]
> On Starknet Mainnet, STRK20 private note amounts are cryptographically shielded and blinded on-chain; public block explorers only display the pool's `apply_actions` execution and the on-chain protocol fee. The private transfer amounts below are recorded from Ready X's local decrypted activity log.

| Transaction Type | Transaction Hash | Block Number | Execution / Finality Status | Decrypted Payload (Ready X) |
|---|---|---|---|---|
| **Phase 0 Tx #1 (Shield / Top-up)** | `0x03b1232842317ca830bd990dabcc46b381dbed07246e89c04f4d82fa17c34fe4` | `13449823` | `SUCCEEDED` / `ACCEPTED_ON_L2` | Native Shield (11 STRK top-up, total 13 STRK) |
| **Phase 0 Tx #2A (Private Action A)** | `0x7b98df007702428718a6bd62abdf195e8324c3e5642e5407c07e68859497fd2` | `13449996` | `SUCCEEDED` / `ACCEPTED_ON_L2` | 5 STRK private action |
| **Phase 0 Tx #2B (Private Action B)** | `0x0269f2309ba7b891ed0c19296e343e816404ab7a6406f50017f5f0a560711ab2` | `13450020` | `SUCCEEDED` / `ACCEPTED_ON_L2` | 1 STRK private self-transfer |

### Balance Reconciliation
- Starting Shielded Balance: `13.0 STRK`
- Transaction A: 5 STRK private action (principal returned/scoped to self, $-6.0\text{ STRK}$ fee) $\rightarrow$ `7.0 STRK`
- Transaction B: 1 STRK private self-transfer (principal returned to self, $-6.0\text{ STRK}$ fee) $\rightarrow$ `1.0 STRK`
- Final Verified `strk20Balances()` Balance: **`1.0 STRK`** ($13.0 - 6.0 - 6.0 = 1.0\text{ STRK}$).

---

## 4. Incident Analysis: Double Action Dispatch
- **Incident**: Two distinct private transactions (Tx 2A and Tx 2B) were proved and broadcast within 24 blocks.
- **Code Audit**:
  - The **Echo** tab handler had a hardcoded payload of `5 STRK` (`FIVE_STRK`).
  - The **Send** tab handler had a hardcoded payload of `1 STRK` (`ONE_STRK`).
  - The prior UI lacked an in-flight submission lock and did not disable tabs or the CTA button during client-side ZK proof generation.
- **Reconstruction**: The most likely cause based on runtime evidence and code inspection is that an Echo action (5 STRK) was triggered prior to or during a switch to the Send tab (1 STRK), causing both promises to be dispatched sequentially to Ready X.

---

## 5. UI Safeguards Implemented
1. **Synchronous In-Memory Mutex (`isSubmittingRef`)**:
   - Immediate single-frame lock via `useRef<boolean>` that synchronously rejects subsequent click events.
2. **Visual & Interaction State (`isSubmitting`, `submittingPhase`)**:
   - Disables all action tabs and the primary CTA button immediately upon click.
   - Displays real-time proving/submission status with a spinner (`"Proving & requesting wallet approval…"`, `"Waiting for L2 confirmation…"`).
3. **Guaranteed Release**: `try ... finally` ensures the lock and submitting states are unlocked on both terminal confirmation and error catch.
4. **Automated Regression Tests** (`test/regression-duplicate-guard.test.mjs`):
   - Concurrency burst test: Verifies that 5 rapid simultaneous clicks result in exactly 1 underlying execution.
   - Payload invariant test: Verifies that the Send action payload strictly matches $1.0\text{ STRK}$ (`0xde0b6b3a7640000`) and equals the UI constant.

---

## 6. Standalone Phase 0 Unshield Validation: DEFERRED
- **Status**: **DEFERRED**
- **Rationale**: Standalone unshielding is deferred because the primary objective of Phase 0 (validating the STRK20 Mainnet wallet connection, balance querying, ZK proof assembly, and private invoke submission) has been fully established. All remaining Mainnet testing will focus on actual ConditionalPay smart contract workflows in Phase 4.

---

## 7. Final Submission Scope Clarification
- The transaction hashes recorded in this document serve as **Phase 0 integration baseline evidence only**.
- They are **NOT** the final transaction hashes for `strk20.json`.
- The final hackathon submission hashes in `strk20.json` will demonstrate qualifying end-to-end ConditionalPay flows (CREATE, CLAIM, REFUND) interacting with the deployed ConditionalPay Cairo contract.
