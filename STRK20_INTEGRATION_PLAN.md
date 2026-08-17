# STRK20 Privacy Integration Plan — ConditionalPay

Generated 2026-08-17 by the strk20-privacy-integration skill. Revised 2026-08-17 (r4).
Statuses below were current at generation time — re-verify "coming soon" items before building against them.

---

## 1. Project snapshot

- **Stack**: Next.js 16, React 19, TypeScript, starknet.js 10.4.0, get-starknet 6.0.2 (needs bump), types-js 0.10.3, zustand 5.x, no backend
- **Cairo**: Scarb (edition 2024_07), starknet dep 2.18.0, no snfoundry.toml — echo helper only (`cairo/src/lib.cairo`)
- **Relevant code**:
  - Wallet connection: `src/app/components/client/WalletHandle/SelectWallet.tsx:64` (`handleSelectedWallet` → `WalletAccountV6.connect`)
  - Transaction layer: `src/app/components/client/WalletHandle/WalletAccountV6Tag.tsx:194` (`submit` → `strk20InvokeTransaction`)
  - State: `src/app/components/Wallet/walletContext.ts` (zustand store, holds `WalletAccountV6`)
  - Config: `src/utils/constants.ts` (DEMO token, echo helper addresses, providers)
  - Cairo: `cairo/src/lib.cairo` (echo `privacy_invoke` — round-trip demo)
- **Privacy goal** (from interview): Settle claimed/refunded ConditionalPay outputs directly back into STRK20 shielded notes, so the recipient's subsequent private activity is unlinked from the settlement event. The helper invocation, token, amount, timing, and configured onchain conditions are **not hidden**. The shielded initiator behind a privacy transaction remains unlinkable.
- **Environment**: Mainnet from day one. Sepolia is optional for dev convenience, not the primary integration target. Wallet scope: Ready extension (current), Xverse (in progress).

---

## 2. Chosen route: Anonymizer contract + Privacy Wallet API

ConditionalPay is a DeFi protocol with its own onchain contract — it locks shielded-note-funded escrows behind verifiable conditions (hashlock, timelock, optional approval gate) and settles outputs back into the pool as shielded notes.

This requires **both**:
- The **Privacy Wallet API** (via starknet.js `WalletAccountV6`) for user-facing flows: shield, unshield, transfer, and triggering contract actions through the wallet.
- An **app-specific anonymizer contract** (ConditionalPay itself) that implements `privacy_invoke` for create/claim/refund settlement — the pool calls it atomically.

**The rule this follows**: this app never touches viewing keys — the user's wallet acts on its behalf via starknet.js. The ConditionalPay contract is the team's own code to build, review, and maintain.

Reference: https://strk20-by-example.org/helpers/privacy-invoke

---

## 3. What this delivers — hidden vs visible

| Private (inside the pool) | Public (visible onchain) |
|---|---|
| The shielded initiator behind a privacy transaction (unlinkable to the pool interaction) | The ConditionalPay helper invocation itself |
| Sender and receiver of private in-pool transfers | Deposit and withdrawal amounts (the public ERC-20 legs) |
| Transfer amounts and token type (in-pool) | The fact that a pool interaction occurred |
| Which notes were spent | Timing of pool interactions |
| Subsequent activity after settlement — the claim/refund output lands as a shielded note, unlinked from further private activity | Token and amount locked in a conditional payment |
| The identity of the creator (no creator address stored on-chain) | Hashlock and refund-hash commitments |
| The identity of the claimant (bearer credential; no claimant address stored on-chain) | Preimages once revealed on-chain for claim/refund |
| | Timelock / expiry configuration (`claim_after`, `expires_at`) |
| | Explicitly stored approver address (if configured) |
| | Approval gate state and approval event |

**Honest limit**: ConditionalPay's anonymizer hides the _user's address_ behind the settlement action — the pool calls the contract, not the user, so the shielded initiator is not exposed onchain. The amounts, the conditions, and the app activity itself remain public. The privacy value is twofold: (1) the shielded user behind the privacy transaction is unlinkable to the visible pool interaction, and (2) settlement outputs land as shielded notes, so the recipient's _subsequent_ private activity (transfers, swaps, further settlements) is unlinked from the settlement that funded them.

**What ConditionalPay does NOT claim to hide**: the helper invocation, token, amount, timing, configured conditions, or explicitly stored approver address. These are public by design.

**Bearer credential model**: there is no `claimant` address stored on-chain. Anyone who knows the `claim_preimage` can claim. Anyone who knows the `refund_preimage` can refund (after expiry). This avoids unnecessarily publishing intended recipient addresses.

---

## 4. Prerequisites & versions

- `starknet@10.4.0` — already installed ✓
- `@starknet-io/get-starknet-discovery@6.0.3`, `@starknet-io/get-starknet-wallet-standard@6.0.3` — **upgrade from 6.0.2** (npm `next` tag; `6.0.4` is now on `next`, but the skill pins 6.0.3; verify 6.0.4 compatibility before adopting)
- `@starknet-io/types-js@0.10.3` — already installed ✓
- Test wallet: **Ready extension** (current privacy-enabled wallet)
- Cairo toolchain: Scarb (edition 2024_07), starknet 2.18.0 — add **Starknet Foundry** (`snfoundry.toml`, snforge) for contract tests
- `sncast` for declare/deploy

---

## 5. Integration route (detailed)

### 5.1. Exact STRK20 integration route

**Anonymizer contract (Branch B) + Privacy Wallet API (Branch C)**.

1. The ConditionalPay Cairo contract implements `privacy_invoke` with a **Serde-deserialized enum discriminator** — a single entrypoint routes CREATE, CLAIM, and REFUND. APPROVE is a **separate normal contract entrypoint** (not `privacy_invoke`), restricted to the configured approver.
2. The verified STRK20 pool address is stored in contract storage via the **constructor**. `privacy_invoke` authorizes `get_caller_address()` against this stored address — never against a `pool_address` supplied through calldata.
3. The frontend uses `WalletAccountV6.strk20InvokeTransaction(actions)` to compose multi-action private transactions.
4. The wallet handles registration, keys, proving, and pool interaction. The dapp never touches viewing keys.
5. The contract and SDK are **token-generic** — any ERC-20 token address accepted. The MVP frontend exposes only STRK initially.

The reference anonymizer to study: `packages/ekubo_swap_anonymizer` and `packages/vesu_lending_anonymizer` in the [Privacy SDK monorepo](https://github.com/starkware-libs/starknet-privacy). The echo helper in `cairo/src/lib.cairo` is a minimal `privacy_invoke` skeleton — ConditionalPay's contract replaces it with condition logic, state, and a custom ABI.

### 5.2. Existing starter-kit files we retain

| File | Retain? | Notes |
|---|---|---|
| `src/app/components/client/WalletHandle/SelectWallet.tsx` | ✅ Keep | Wallet connection — works as-is, good get-starknet v6 pattern |
| `src/app/components/Wallet/walletContext.ts` | ✅ Keep | Zustand wallet state — extend for ConditionalPay state |
| `src/app/components/client/provider/providerContext.ts` | ✅ Keep | Provider index store — reuse |
| `src/app/layout.tsx` | ✅ Keep | Root layout — update metadata for ConditionalPay |
| `src/app/globals.css` | ✅ Keep | Base styles — extend |
| `src/app/uni.module.css` | ✅ Keep | Component styles — extend for ConditionalPay UI |
| `src/app/components/TokenIcons.tsx` | ✅ Keep | Token icons — reuse |
| `package.json` | ✅ Keep | Bump get-starknet versions, update name/description |
| `tsconfig.json`, `next.config.js`, `.editorconfig`, `.gitignore` | ✅ Keep | Config — no changes needed |
| `.env.example`, `.env.local` | ✅ Keep | Update env vars for ConditionalPay contract addresses |

### 5.3. Starter-kit demo code to eventually remove

| File / code | What it is | When to remove |
|---|---|---|
| `src/app/components/client/WalletHandle/WalletAccountV6Tag.tsx` | Entire file — demo action tabs (shield/send/unshield/echo/balances) with hardcoded amounts | Replace with ConditionalPay UI in Phase 3 |
| `src/utils/constants.ts` — echo helper constants (`Strk20EchoHelperAddress`, `Strk20EchoHelperSepolia`, `Strk20EchoHelperClassHash`, `echoHelperForIndex`) | Demo echo helper addresses and class hash | Remove once ConditionalPay contract replaces the echo helper |
| `cairo/src/lib.cairo` | Echo helper contract (no-op round-trip) | Replace with ConditionalPay contract |
| `cairo/address.md` | Echo helper deployment addresses | Replace with ConditionalPay deployment info |
| `src/app/page.tsx` — hero copy ("Just Encrypt Everything"), footer repo link | Starter-kit branding | Update in Phase 3 |
| `public/next.svg`, `public/vercel.svg` | Starter template assets | Remove when no longer needed |
| DEMO constants in `WalletAccountV6Tag.tsx` (`TEN_STRK`, `FIVE_STRK`, `ONE_STRK`) | Hardcoded demo amounts | Replaced by user-input amounts |

### 5.4. New app files/modules we will require

```
packages/
└── sdk/                              # NEW: reusable ConditionalPay SDK package
    ├── package.json                  # name: @conditionalpay/sdk (not published to npm yet)
    ├── tsconfig.json
    ├── README.md                     # independently documented for other builders
    └── src/
        ├── index.ts                  # public API barrel
        ├── types.ts                  # Payment, PaymentEvent, domain constants
        ├── actions.ts                # buildCreateActions, buildClaimActions, buildRefundActions
        ├── approve.ts                # buildApproveCall
        ├── hashing.ts               # domain-separated Poseidon: derivePaymentId, computeHashlock, computeRefundHash
        ├── events.ts                 # parsePaymentEvents
        └── query.ts                  # getPayment (reads contract storage)
src/
├── utils/
│   └── constants.ts                  # MODIFY: add ConditionalPay contract addresses, remove echo helpers
├── app/
│   ├── page.tsx                      # MODIFY: ConditionalPay branding + layout
│   ├── components/
│   │   ├── CreatePayment.tsx         # NEW: CREATE flow UI
│   │   ├── ClaimPayment.tsx          # NEW: CLAIM flow UI
│   │   ├── ApprovePayment.tsx        # NEW: APPROVE flow UI (optional gate)
│   │   ├── RefundPayment.tsx         # NEW: REFUND flow UI
│   │   ├── PaymentCard.tsx           # NEW: payment status card (state machine display)
│   │   ├── PaymentList.tsx           # NEW: list user's payments (from local persistence)
│   │   └── client/WalletHandle/
│   │       └── SelectWallet.tsx      # KEEP as-is
│   └── ...
strk20.json                           # NEW: hackathon submission — {"transactions": [...]}
test_vectors.json                     # NEW: cross-language Poseidon test vectors (§12.1)
SECURITY.md                           # NEW: bearer-credential threat model (Phase 4)
cairo/
├── Scarb.toml                        # MODIFY: rename package, add snforge dep
├── snfoundry.toml                    # NEW: Starknet Foundry config
├── src/
│   └── lib.cairo                     # REPLACE: ConditionalPay contract
└── tests/
    └── test_conditionalpay.cairo     # NEW: contract tests
```

---

## 6. ConditionalPay contract responsibilities

The ConditionalPay contract is **not** a generic escrow — it is an anonymizer-style contract that the STRK20 pool calls via `privacy_invoke`. Its responsibilities:

1. **Store the verified pool address** — the constructor receives the STRK20 pool address and writes it to storage. `privacy_invoke` asserts `get_caller_address() == self.pool_address.read()`. No pool address is accepted through calldata.
2. **Hold conditional payments** — each payment is a struct with: `payment_id`, `token`, `amount`, `hashlock`, `refund_hash`, `claim_after`, `expires_at`, optional `approver`, `approved`, `state`. **No `claimant` field** — the hashlock is a bearer claim credential.
3. **Route operations via enum discriminator** — `privacy_invoke` deserializes a `ConditionalPayAction` enum from calldata. Variant index `0` = CREATE, `1` = CLAIM, `2` = REFUND.
4. **CREATE** — accept funds from the pool, validate conditions and timing, compute and verify payment ID, store the payment record. Returns **empty `Span<OpenNoteDeposit>`** (no output notes on creation).
5. **CLAIM** — verify domain-separated hashlock preimage, timing window, and approval gate (if configured). Approve pool to pull locked tokens. Decrease `locked_by_token[token]`. Returns one `OpenNoteDeposit`.
6. **REFUND** — verify domain-separated refund preimage and expiry. Approve pool to pull locked tokens. Decrease `locked_by_token[token]`. Returns one `OpenNoteDeposit`. If no `expires_at` is configured (value 0), refund is **unavailable**.
7. **APPROVE** — **separate normal entrypoint** (not `privacy_invoke`). Requires `payment.state == ACTIVE` — approving an already-settled payment reverts. Restricted to the configured approver address via `get_caller_address()` check. Flips an `approved` storage flag. No pool interaction, no token movement, no shielded notes.
8. **Per-token solvency ledger** — the contract maintains `locked_by_token: Map<ContractAddress, u128>`. CREATE increases `locked_by_token[token]` by `amount` and verifies the contract's actual ERC-20 balance for that token covers `locked_by_token[token]` (after the increase). CLAIM and REFUND decrease `locked_by_token[token]` by exactly `payment.amount`, once. This prevents the contract from accepting payments it cannot cover and ensures amount conservation across concurrent payments.
9. **Token-generic** — the contract accepts any ERC-20 token address. Token is stored per-payment.
10. **Atomic rollback** — if any step in `privacy_invoke` reverts, the entire pool operation rolls back — no tokens stranded.
11. **Emit events** — `PaymentCreated`, `PaymentClaimed`, `PaymentRefunded`, `PaymentApproved` (for indexing).

### 6.1. `privacy_invoke` ABI

There is no mandatory `(token, pool_address, note_id)` signature. The ABI explicitly carries the fields ConditionalPay requires:

```cairo
#[derive(Serde, Drop)]
enum ConditionalPayAction {
    Create: CreateParams,
    Claim: ClaimParams,
    Refund: RefundParams,
}

#[derive(Serde, Drop)]
struct CreateParams {
    token: ContractAddress,
    amount: u128,
    hashlock: felt252,       // poseidon("CONDITIONALPAY_CLAIM_V1", claim_preimage)
    refund_hash: felt252,    // poseidon("CONDITIONALPAY_REFUND_V1", refund_preimage)
    claim_after: u64,
    expires_at: u64,         // 0 = no expiry, no refund
    approver: ContractAddress, // 0 = no approval gate
    nonce: felt252,          // client-generated random, ensures payment ID uniqueness
}

#[derive(Serde, Drop)]
struct ClaimParams {
    payment_id: felt252,
    claim_preimage: felt252,
    note_id: felt252,        // pool-substituted "${openNoteIds[0]}" for the output open note
}

#[derive(Serde, Drop)]
struct RefundParams {
    payment_id: felt252,
    refund_preimage: felt252,
    note_id: felt252,        // pool-substituted "${openNoteIds[0]}" for the output open note
}

fn privacy_invoke(
    ref self: TState,
    action: ConditionalPayAction,
) -> Span<OpenNoteDeposit>
```

**Key design decisions**:
- CREATE receives `token` and `amount` explicitly — the contract must record the exact liability backing each payment.
- CREATE does **not** receive a `note_id` — it creates no open notes, so there is no `"${openNoteIds[0]}"` placeholder.
- CLAIM and REFUND receive `note_id` — the pool substitutes this from the open note created by the `transfer` action in the same STRK20 transaction.
- No `pool_address` in the signature — authorized against constructor-stored storage.
- No `claimant` — bearer credential model.

### 6.2. Domain-separated hashing

All Poseidon hashes use explicit domain separators to prevent cross-purpose preimage reuse:

```
hashlock     = poseidon_hash("CONDITIONALPAY_CLAIM_V1",   claim_preimage)
refund_hash  = poseidon_hash("CONDITIONALPAY_REFUND_V1",  refund_preimage)
payment_id   = poseidon_hash("CONDITIONALPAY_PAYMENT_V1",
                  token, amount,
                  hashlock, refund_hash,
                  claim_after, expires_at,
                  approver, nonce)
```

- **`CONDITIONALPAY_CLAIM_V1`**: a claim preimage cannot be used as a refund preimage and vice versa.
- **`CONDITIONALPAY_PAYMENT_V1`**: payment ID is deterministic from all parameters + nonce. The client-generated `nonce` (random felt252) ensures uniqueness even for otherwise identical payment parameters.
- The contract recomputes `payment_id` from the CREATE params and verifies it matches — the client and contract derive the same ID.

### 6.3. Payment struct (stored on-chain)

```cairo
#[derive(Drop, Serde, starknet::Store)]
struct Payment {
    token: ContractAddress,
    amount: u128,
    hashlock: felt252,
    refund_hash: felt252,
    claim_after: u64,
    expires_at: u64,
    approver: ContractAddress,
    approved: bool,
    state: u8,               // 0 = uninitialized, 1 = ACTIVE, 2 = CLAIMED, 3 = REFUNDED
}
```

No `claimant` field. No `creator` field. The hashlock is the bearer claim credential; the refund_hash is the bearer refund credential.

---

## 7. Core flows

### 7.1. CREATE flow

```
Initiator (wallet) ──► WalletAccountV6.strk20InvokeTransaction([
  { type: "withdraw", token, amount, recipient: conditionalPayContract },
  { type: "invoke", contract: conditionalPayContract, calldata: [
      0,  // enum variant: Create
      token, amount,
      hashlock, refund_hash,
      claim_after, expires_at,
      approver_or_zero, nonce
  ] }
])
```

1. Pool withdraws `amount` of `token` to ConditionalPay contract
2. ConditionalPay validates: `amount > 0`, if `expires_at != 0` then `expires_at > claim_after` and `expires_at > block_timestamp`
3. ConditionalPay computes `payment_id` from all params using domain-separated Poseidon (§6.2), verifies it does not already exist in storage
4. Stores the `Payment` struct keyed by `payment_id` with state = ACTIVE
5. Emits `PaymentCreated { payment_id, token, amount, hashlock, refund_hash, claim_after, expires_at, approver, nonce }`
6. Returns **empty `Span<OpenNoteDeposit>`** — no output notes on creation

**No `"${openNoteIds[0]}"` in CREATE**: CREATE does not reference any open note ID. It uses `withdraw` + `invoke` only. There is no `transfer` action in CREATE because there are no output notes.

**Privacy note**: the helper invocation, token, amount, hashlock, refund_hash, timing config, and approver address are public in calldata. The shielded initiator behind this privacy transaction is **not exposed** — the pool calls the contract, and the privacy transaction is relayed, so the initiator's identity is unlinkable to this onchain event.

### 7.2. CLAIM flow

```
Claimant (wallet) ──► WalletAccountV6.strk20InvokeTransaction([
  { type: "transfer", token, amount: "OPEN", recipient: claimantAddress },
  { type: "invoke", contract: conditionalPayContract, calldata: [
      1,  // enum variant: Claim
      payment_id, claim_preimage,
      "${openNoteIds[0]}"
  ] }
])
```

1. ConditionalPay verifies: payment is ACTIVE, `poseidon_hash("CONDITIONALPAY_CLAIM_V1", claim_preimage) == payment.hashlock`
2. Timing: `claim_after <= block_timestamp` AND (if `expires_at != 0`) `block_timestamp < expires_at`
3. Approval: if `payment.approver != 0`, requires `payment.approved == true`
4. Sets state = CLAIMED **before** ERC-20 approve (reentrancy guard)
5. Approves pool to pull `payment.amount` of `payment.token`
6. Pool pulls tokens and credits them as an open note to the claimant → **claimant receives shielded funds**
7. Emits `PaymentClaimed { payment_id }`
8. Returns one `OpenNoteDeposit { note_id, token: payment.token, amount: payment.amount }`

**Bearer model**: anyone who holds the `claim_preimage` can claim. No claimant address check — the preimage IS the credential.

**Privacy value**: the open note lands in the claimant's shielded balance. Their subsequent private transfers, swaps, or further settlements are **unlinked** from this claim.

### 7.3. APPROVE flow

```
Approver (wallet) ──► Standard execute (not privacy_invoke) on ConditionalPay:
  approve(payment_id)
```

This is a **public, non-private transaction** — the approver calls the contract directly. No pool interaction, no shielded notes. The approval is a simple storage flag flip.

**Access control**: the contract verifies `payment.state == ACTIVE` (approving a settled payment reverts) and `get_caller_address() == payment.approver`. Only the configured approver for that specific payment can call this, and only while the payment is still active.

**Why not `privacy_invoke`**: approval doesn't move tokens. It's a boolean gate. Running it through the pool would add unnecessary complexity and pool fees for zero privacy benefit (the approver's identity is already explicitly stored and public by design).

### 7.4. REFUND flow

```
Refunder (wallet) ──► WalletAccountV6.strk20InvokeTransaction([
  { type: "transfer", token, amount: "OPEN", recipient: refundRecipient },
  { type: "invoke", contract: conditionalPayContract, calldata: [
      2,  // enum variant: Refund
      payment_id, refund_preimage,
      "${openNoteIds[0]}"
  ] }
])
```

1. ConditionalPay verifies: payment is ACTIVE, `poseidon_hash("CONDITIONALPAY_REFUND_V1", refund_preimage) == payment.refund_hash`
2. Timing: `payment.expires_at != 0` (expiry is configured) AND `block_timestamp >= payment.expires_at` (expired)
3. Sets state = REFUNDED **before** ERC-20 approve (reentrancy guard)
4. Approves pool to pull `payment.amount` of `payment.token`
5. Pool pulls tokens and credits them as an open note → **refund settles into shielded note**
6. Emits `PaymentRefunded { payment_id }`
7. Returns one `OpenNoteDeposit { note_id, token: payment.token, amount: payment.amount }`

**Refund authorization**: a valid `refund_preimage` is required. Anyone cannot refund an expired payment merely by supplying their own open-note recipient — they must know the refund secret.

**No expiry = no refund**: if `expires_at == 0`, the payment has no expiry and can only be claimed. REFUND reverts.

### 7.5. Expiry semantics

```
         claim_after                     expires_at
              │                               │
──────────────┼───────────────────────────────┼──────────────►  time
  too early   │      CLAIM window             │  REFUND only
              │  claim_after <= now            │  now >= expires_at
              │         < expires_at           │
```

- **Before `claim_after`**: neither CLAIM nor REFUND is possible
- **`claim_after <= now < expires_at`**: CLAIM is possible (if hashlock + approval pass). REFUND is not possible.
- **`now >= expires_at`**: REFUND is possible (if refund preimage valid). CLAIM is **no longer possible** — the window has closed.
- **`expires_at == 0`**: no expiry configured. CLAIM is possible any time after `claim_after`. REFUND is unavailable.

**CREATE-time validation** (if `expires_at != 0`):
- `expires_at > claim_after` — there must be a non-zero claim window
- `expires_at > block_timestamp` — the payment must not be created already expired

---

## 8. State-machine invariants

```
              ┌──────────┐
   CREATE ──► │  ACTIVE   │
              └─────┬─────┘
                    │
          ┌─────────┼─────────┐
          ▼                   ▼
    ┌──────────┐        ┌──────────┐
    │ CLAIMED  │        │ REFUNDED │
    └──────────┘        └──────────┘
```

**Invariants** (enforced in the contract):

1. **CLAIM/REFUND mutual exclusivity**: a payment can transition to CLAIMED **or** REFUNDED, never both. The state check is the first thing in both paths — if `state != ACTIVE`, revert.
2. **Double settlement prevention**: once a payment is CLAIMED or REFUNDED, no further `privacy_invoke` call can act on it. The state is set to the terminal value **before** the ERC-20 approve, preventing reentrancy from extracting funds twice.
3. **Expiry boundary enforcement**:
   - CLAIM requires `claim_after <= block_timestamp` AND (if `expires_at != 0`) `block_timestamp < expires_at`
   - REFUND requires `expires_at != 0` AND `block_timestamp >= expires_at`
   - If `expires_at == 0`, REFUND always reverts — the payment can only be claimed
   - CREATE validates (if `expires_at != 0`): `expires_at > claim_after` AND `expires_at > block_timestamp`
4. **Hashlock gate (domain-separated)**: CLAIM requires `poseidon_hash("CONDITIONALPAY_CLAIM_V1", claim_preimage) == payment.hashlock`.
5. **Refund authorization (domain-separated)**: REFUND requires `poseidon_hash("CONDITIONALPAY_REFUND_V1", refund_preimage) == payment.refund_hash`. An expired payment cannot be refunded without knowledge of the refund secret.
6. **Approval authorization**: only the address stored in `payment.approver` can call `approve(payment_id)`. The contract checks `payment.state == ACTIVE` (approving a settled payment reverts) and `get_caller_address() == payment.approver`. If `payment.approver == 0`, no approval is required and the approval gate is skipped during CLAIM.
7. **Approval gate** (if configured): CLAIM requires `approved == true` when `payment.approver != 0`. A payment with a configured approver cannot be claimed without explicit approval, regardless of valid preimage and timing.
8. **Payment ID uniqueness**: each payment's `payment_id` is derived deterministically via domain-separated Poseidon from all CREATE params including a client-generated random `nonce`. CREATE reverts if a `payment_id` already exists in storage. The contract recomputes and verifies the ID.
9. **Amount conservation**: the exact `amount` deposited by the pool into the contract during CREATE is the exact `amount` returned to the pool during CLAIM or REFUND. The contract never takes a fee, splits, or partially releases. `OpenNoteDeposit.amount` in the return value equals the stored `payment.amount`.
10. **Pool-only `privacy_invoke`**: the contract asserts `get_caller_address() == self.pool_address.read()` at the top of `privacy_invoke`. The pool address is stored in contract storage via the constructor. Only the verified STRK20 pool can invoke this entrypoint.
11. **Terminal states**: CLAIMED and REFUNDED are terminal — no further transitions allowed. Any `privacy_invoke` targeting a terminal-state payment ID reverts.
12. **No partial claims**: the full locked amount is settled in one atomic operation.
13. **Atomicity**: if `privacy_invoke` reverts, the pool's withdrawal + open note creation also revert — no tokens stranded.
14. **No claimant binding**: the hashlock is a bearer credential. No on-chain claimant address is stored or checked. Anyone with the preimage can claim within the valid time window.
15. **Per-token solvency**: the contract maintains `locked_by_token: Map<ContractAddress, u128>`. CREATE increases `locked_by_token[token]` by `payment.amount` and asserts the contract's actual ERC-20 balance for that token `>=` `locked_by_token[token]` (post-increase). CLAIM and REFUND decrease `locked_by_token[token]` by exactly `payment.amount`, exactly once (state is set to terminal before the decrease). At all times, `locked_by_token[token] <= IERC20(token).balance_of(self)`. This prevents the contract from accepting payments it cannot back and ensures correctness across multiple concurrent payments in the same token.

---

## 9. Privacy boundary — exactly what is public and private

### Public (visible onchain)

- The ConditionalPay contract address and all interactions with it
- **CREATE**: token, amount, hashlock, refund_hash, `claim_after`, `expires_at`, explicitly stored approver address (if configured), nonce
- **CLAIM**: the fact that a claim happened, the claim_preimage (once revealed), the payment_id
- **APPROVE**: the approver's address, the payment_id, the approval timestamp
- **REFUND**: the fact that a refund happened, the refund_preimage (once revealed), the payment_id
- Timing of all pool interactions
- The `privacy_invoke` calldata
- Pool deposit and withdrawal amounts (ERC-20 legs)

### Private (inside the pool)

- **The shielded initiator** behind a privacy transaction — the pool calls the contract via a relayer, so the user who initiated the CREATE is not exposed onchain. Their shielded identity is unlinkable to the visible helper invocation.
- **The identity of the claimant** — no claimant address stored on-chain. The bearer credential (preimage) is the only authorization.
- **Subsequent activity** after settlement: the claim/refund output lands as a shielded note, unlinked from further private transfers, swaps, or settlements
- The sender and receiver of private in-pool transfers
- Transfer amounts within the pool
- Which notes were spent in private transfers

### What ConditionalPay does NOT claim to hide

- The helper invocation itself
- The token, amount, timing, or conditions configured on a payment
- Explicitly stored approver addresses
- The link between the settlement event and the specific payment's payment_id
- The preimages, once revealed on-chain during claim or refund

### What ConditionalPay DOES provide

- **Initiator unlinkability**: the shielded user who created the payment is not exposed — the privacy transaction is relayed through the pool, and the pool calls the contract. The onchain record shows the pool interacting with ConditionalPay, not the initiator.
- **Claimant unlinkability**: no claimant address is stored or required on-chain. The bearer preimage is the claim credential.
- **Settlement unlinking**: the output of a claim/refund lands as a shielded note. Once inside the pool, the funds are indistinguishable from other shielded funds. The recipient can transfer them privately without revealing they came from a ConditionalPay settlement.
- **Atomic settlement**: claim/refund settles directly into the pool — no intermediate public-balance step that could be observed.

---

## 10. Mainnet blockers & wallet assumptions

### Blockers

1. **get-starknet pin**: currently 6.0.2, needs bump to 6.0.3 (6.0.4 now on `next` — verify before pinning)
2. **No Starknet Foundry setup**: need `snfoundry.toml` and snforge for contract tests before mainnet deploy
3. **Security readiness** (team-owned, not a hard sprint blocker):
   - Comprehensive snforge test suite covering all invariants from §8
   - Simulation / dry-run of all flows on mainnet before real-value use
   - Small-value mainnet deployment and end-to-end test before production use
   - External security review is desirable but not a hard sprint blocker
4. **Pool fees**: currently ~4 STRK per private operation (read from `get_fee_amount`). ConditionalPay flows involve multiple pool operations (CREATE, then CLAIM or REFUND) — fee economics must be validated
5. **Note maturity**: freshly shielded funds take ~10 blocks to mature. A CREATE immediately after a shield may fail — UX must surface the wait or compose the operations

### Wallet assumptions

- **Ready extension** is the only privacy-enabled wallet today — all testing targets it
- **Xverse** dapp-facing Wallet API is in progress (mid-July 2026) — track as a future addition
- **Braavos, Privy, other wallets**: not privacy-enabled — graceful degradation required (hide ConditionalPay actions, prompt for Ready/Xverse)
- **Deposit screening**: enforced onchain by the protocol — deposits can be declined. Surface screening status in UX rather than treating it as a bug

---

## 11. Contract testing strategy

### Local tests (snforge) — primary

1. **Unit tests**: each state transition (CREATE, CLAIM, REFUND, APPROVE) in isolation
2. **Invariant tests** — every invariant from §8:
   - CLAIM/REFUND mutual exclusivity (can't do both)
   - Double settlement prevention (second CLAIM or REFUND on same payment_id reverts)
   - Expiry boundary: CLAIM fails before `claim_after`, CLAIM fails at/after `expires_at`, REFUND fails before `expires_at`, REFUND fails when `expires_at == 0`
   - CREATE-time validation: `expires_at > claim_after`, `expires_at > block_timestamp` (when `expires_at != 0`)
   - Refund authorization: REFUND with wrong `refund_preimage` reverts, REFUND with claim_preimage reverts (domain separation)
   - Approval authorization: non-approver calling `approve` reverts; `approve` on a CLAIMED or REFUNDED payment reverts
   - Payment ID uniqueness: CREATE with duplicate payment_id reverts
   - Amount conservation: claimed/refunded amount equals created amount
   - Pool-only `privacy_invoke`: non-pool caller reverts (verified against constructor-stored address)
   - Domain separation: claim_preimage used as refund_preimage reverts, and vice versa
   - Per-token solvency: `locked_by_token` increases on CREATE, decreases on CLAIM/REFUND; CREATE reverts if contract ERC-20 balance < `locked_by_token[token]` post-increase (underfunded CREATE)
3. **Solvency-specific tests**:
   - **Underfunded CREATE**: mock a scenario where the contract receives less ERC-20 than `payment.amount` — CREATE must revert
   - **Multiple concurrent payments**: CREATE three payments (same token), CLAIM one, verify `locked_by_token` reflects the remaining two; REFUND another, verify `locked_by_token` reflects the last; final CLAIM zeroes the ledger
   - **Amount conservation across lifecycle**: sum of all settled amounts equals sum of all created amounts per token — no value created or destroyed
   - **Multi-token isolation**: payments in token A do not affect solvency accounting for token B
4. **Edge cases**: `claim_after == expires_at` (rejected at CREATE — `expires_at > claim_after`), `expires_at == 0` + REFUND attempt, approval after payment already claimed (reverts), CREATE with `expires_at <= block_timestamp` (rejected)
5. **Atomicity**: verify that a revert in `privacy_invoke` rolls back correctly (use `should_panic` tests)
6. **Event emission**: verify `PaymentCreated`, `PaymentClaimed`, `PaymentRefunded`, `PaymentApproved` events emit correctly with correct indexed keys
7. **Cross-language test vectors**: a fixed set of test vectors (hardcoded preimages, tokens, amounts, nonces) that both the Cairo contract tests and the TypeScript SDK tests compute against. The vectors prove the domain-separated Poseidon outputs (hashlock, refund_hash, payment_id) are identical across Cairo and TypeScript. Vectors live in `test_vectors.json` shared between `cairo/tests/` and `packages/sdk/`. See §12.1 for the vector format.

### Integration tests (mainnet — primary target)

1. **Phase 0 connectivity**: three confirmed mainnet STRK20 transactions with preserved hashes
2. **Small-value mainnet deployment**: deploy ConditionalPay with low-value test parameters
3. Full CREATE → CLAIM flow on mainnet with Ready wallet
4. Full CREATE → REFUND flow (with short `expires_at` in the past)
5. CREATE → APPROVE → CLAIM flow (approval gate)
6. Verify open notes are credited correctly (check shielded balances after claim/refund)
7. Verify against the wallet test dapp: https://starknet-wallet-account.vercel.app/

### Sepolia (optional, secondary)

Sepolia may be used for rapid iteration during development, but is **not** the primary integration target. The sprint is mainnet-only. All final validation happens on mainnet.

### What local devnet does NOT cover

STRK20 end-to-end flows need the pool, a privacy-enabled wallet, and proving — pure local devnet doesn't exercise this path. Contract logic is tested locally via snforge; privacy integration is tested on mainnet with the Ready extension.

---

## 12. SDK architecture

ConditionalPay ships a reusable TypeScript SDK in `packages/sdk/`. It is an independently documented package that other builders can consume. It is **not** published to npm yet — consumed via workspace reference.

The SDK is **token-generic**. The MVP frontend restricts token selection to STRK, but the SDK accepts any ERC-20 address.

```typescript
// packages/sdk/src/types.ts

export const DOMAIN = {
  CLAIM:   "CONDITIONALPAY_CLAIM_V1",
  REFUND:  "CONDITIONALPAY_REFUND_V1",
  PAYMENT: "CONDITIONALPAY_PAYMENT_V1",
} as const;

export interface CreatePaymentParams {
  token: string;           // ERC-20 address (hex) — any token
  amount: bigint;          // smallest unit
  claimPreimage: string;   // random secret — creator generates, shares with claimant
  refundPreimage: string;  // random secret — creator keeps
  claimAfter: number;      // Unix timestamp — earliest claim time
  expiresAt: number;       // Unix timestamp — refund possible after (0 = no expiry, no refund)
  approver?: string;       // optional approver address (0x0 = no approval gate)
  nonce: string;           // client-generated random felt252
}

export interface ClaimPaymentParams {
  paymentId: string;       // derived payment ID
  claimPreimage: string;   // the claim secret
  claimantAddress: string; // open note recipient (the claimer's shielded address)
  token: string;           // needed for the "transfer" action
}

export interface RefundPaymentParams {
  paymentId: string;       // derived payment ID
  refundPreimage: string;  // the refund secret
  refundRecipient: string; // open note recipient
  token: string;           // needed for the "transfer" action
}
```

```typescript
// packages/sdk/src/hashing.ts

// Domain-separated Poseidon hashing
export function computeHashlock(claimPreimage: string): string;
  // → poseidon("CONDITIONALPAY_CLAIM_V1", claimPreimage)

export function computeRefundHash(refundPreimage: string): string;
  // → poseidon("CONDITIONALPAY_REFUND_V1", refundPreimage)

export function derivePaymentId(params: {
  token: string; amount: bigint;
  hashlock: string; refundHash: string;
  claimAfter: number; expiresAt: number;
  approver: string; nonce: string;
}): string;
  // → poseidon("CONDITIONALPAY_PAYMENT_V1", token, amount, hashlock, refundHash,
  //            claimAfter, expiresAt, approver, nonce)
```

```typescript
// packages/sdk/src/actions.ts

// Each returns WALLET_API.STRK20_ACTION[] for strk20InvokeTransaction
export function buildCreateActions(contractAddr: string, params: CreatePaymentParams): STRK20_ACTION[];
  // → [withdraw, invoke] — NO transfer, NO "${openNoteIds[0]}"

export function buildClaimActions(contractAddr: string, params: ClaimPaymentParams): STRK20_ACTION[];
  // → [transfer (OPEN note), invoke with "${openNoteIds[0]}"]

export function buildRefundActions(contractAddr: string, params: RefundPaymentParams): STRK20_ACTION[];
  // → [transfer (OPEN note), invoke with "${openNoteIds[0]}"]

// APPROVE is a normal contract call, not privacy_invoke
export function buildApproveCall(contractAddr: string, paymentId: string): Call;

// Event parsing — reads PaymentCreated/Claimed/Refunded/Approved from tx receipt
export function parsePaymentEvents(receipt: any): PaymentEvent[];

// Payment lookup — reads contract storage
export function getPayment(provider: ProviderInterface, contractAddr: string, paymentId: string): Promise<Payment>;
```

### 12.1. Cross-language test vectors

A shared `test_vectors.json` file lives at the repo root and is consumed by both `cairo/tests/` and `packages/sdk/` test suites. Each vector fixes all inputs and the expected outputs. If either side produces a different hash, the test fails.

```json
{
  "vectors": [
    {
      "comment": "basic payment — all fields populated",
      "claim_preimage": "0x1234...",
      "refund_preimage": "0x5678...",
      "token": "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
      "amount": "1000000000000000000",
      "claim_after": 1700000000,
      "expires_at": 1700086400,
      "approver": "0x0",
      "nonce": "0xabc123...",
      "expected_hashlock": "0x...",
      "expected_refund_hash": "0x...",
      "expected_payment_id": "0x..."
    }
  ]
}
```

At minimum three vectors: (1) basic payment with all fields, (2) zero approver / zero expiry, (3) values that stress felt252 boundaries. The Cairo test reads these constants inline (Cairo cannot read JSON at test time); the TypeScript test reads the JSON file directly. Both must produce identical outputs.

---

## 13. Payment discovery

The creator's identity is deliberately unlinkable from the on-chain payment. This means a user-specific `PaymentList` **cannot** be reconstructed by querying creator-address events — there is no creator address on-chain.

### MVP approach

1. **Creator side — non-secret metadata**: after a successful CREATE transaction, the frontend persists non-secret payment metadata to **`localStorage`** keyed by the connected wallet address: `{ paymentId, token, amount, claimAfter, expiresAt, nonce, txHash }`. The `PaymentList` component reads from this local store. **Raw `claimPreimage` and `refundPreimage` MUST NOT be stored in plain `localStorage`.**

2. **Creator side — secret recovery**: the MVP uses an explicit **copy / export** model for bearer secrets:
   - Immediately after CREATE, the UI presents the `claimPreimage` and `refundPreimage` for the user to **copy and save** (e.g. in a password manager, encrypted notes, or a downloaded file).
   - The UI prompts a "Copy claim credential" and "Copy refund secret" action and does not dismiss the creation dialog until the user has acknowledged they saved both.
   - Secrets are cleared from in-memory state after the user navigates away. They are not persisted in the browser.
   - **Future upgrade path**: encrypted client-side storage (e.g. WebCrypto `AES-GCM` keyed to a wallet-signed challenge) can be added later without changing the data model.

3. **Claimant side — URL fragment**: the creator shares a **claim credential** with the claimant out-of-band. The credential is formatted as a URL with a **fragment** (not query parameters): `/claim#id=...&secret=...`. Fragments are **not sent to the server** and are parsed client-side only. The frontend reads the fragment on load, populates the claim form, and **removes the fragment from the visible URL** (via `history.replaceState`) to minimize accidental exposure in screenshots or browser history.

4. **On-chain lookup**: given a `paymentId`, anyone can call `getPayment()` to read the payment's current state (ACTIVE/CLAIMED/REFUNDED), token, amount, timing config, and approval status. This allows the frontend to display payment status for known payment IDs.

5. **Event scanning** (supplementary): `PaymentCreated` events include `paymentId`, `token`, `amount`, `hashlock`, `refund_hash`, timing, approver, and nonce. These can be scanned to reconstruct a global list of all payments, but cannot be attributed to specific creators.

### Future extensions (out of scope for MVP)

- Server-side encrypted payment index (creator encrypts payment metadata with their own key, stores it server-side for cross-device access)
- Event-based indexing with selective disclosure

---

## 14. Phased implementation order

### Phase 0 — STRK20 Mainnet connectivity proof

**Goal**: prove the existing starter kit works end-to-end on Starknet Mainnet with the Ready wallet before writing any ConditionalPay product code. This validates the toolchain, wallet, pool, and RPC connectivity.

1. Bump get-starknet to 6.0.3 in `package.json`
2. Set `NEXT_PUBLIC_PROVIDER_URL` to a valid Alchemy mainnet key in `.env.local`
3. `npm install && npm run dev`
4. Connect Ready wallet on Mainnet
5. Execute **three actual STRK20 transactions** on Mainnet and record their hashes:
   - **Shield** (deposit) a small amount of STRK → record tx hash
   - **Private self-transfer** → record tx hash
   - **Unshield** (withdraw) back to public balance → record tx hash
6. Confirm: `WalletAccountV6` connects, `strk20InvokeTransaction` submits, transactions confirm, receipts parse correctly

**Exit criterion**: three confirmed mainnet STRK20 transactions (shield, private self-transfer, unshield). A balance query does not count as a transaction. Record hashes internally for team reference.

**`strk20.json`** at the repo root uses the hackathon-required root format. Phase 0 hashes may be included initially, but the **final submission** `transactions` array must contain at least three successful mainnet STRK20 transactions that run through the ConditionalPay contract (CREATE, CLAIM, REFUND):
```json
{
  "transactions": [
    "0x...",
    "0x...",
    "0x..."
  ]
}
```

### Phase 1 — Contract foundation (CREATE + APPROVE)

1. Add Starknet Foundry config (`snfoundry.toml`)
2. Replace `cairo/src/lib.cairo` with ConditionalPay contract:
   - Constructor: receives and stores pool address
   - `privacy_invoke` with `ConditionalPayAction` enum discriminator
   - CREATE path: validate params (timing, amount), compute payment_id, store payment, increase `locked_by_token[token]`, verify ERC-20 balance covers liability, return empty span
   - `approve` entrypoint (requires `state == ACTIVE`, storage flag, `get_caller_address() == payment.approver` check)
   - Pool-only caller check against constructor-stored address
   - Domain-separated Poseidon hashing (§6.2)
   - `locked_by_token` storage map (§6 item 8, §8 invariant 15)
3. Create `test_vectors.json` at repo root with ≥3 vectors (§12.1)
4. Write snforge tests for CREATE + APPROVE + payment ID uniqueness + pool-only invariant + CREATE-time validation + domain separation + solvency (underfunded CREATE) + cross-language vector verification
5. Initialize `packages/sdk/` with `package.json`, types, hashing module, `buildCreateActions`, `buildApproveCall`
6. SDK test suite: verify `computeHashlock`, `computeRefundHash`, `derivePaymentId` produce outputs matching `test_vectors.json`
7. Update `src/utils/constants.ts` — add ConditionalPay contract address placeholder, keep existing provider/network config
8. Verify: `scarb build` passes, snforge tests pass, SDK tests pass, frontend builds with `npm run build`

### Phase 2 — Full contract (CLAIM + REFUND)

1. Implement CLAIM logic (domain-separated hashlock verification, timing window, approval gate, pool settlement, decrease `locked_by_token`, return `OpenNoteDeposit`)
2. Implement REFUND logic (domain-separated refund_hash verification, expiry, pool settlement, decrease `locked_by_token`, return `OpenNoteDeposit`)
3. Write snforge tests for all state transitions, all invariants from §8, edge cases, events, and solvency-specific tests (§11 item 3: underfunded CREATE, multiple concurrent payments, amount conservation, multi-token isolation)
4. Add `buildClaimActions`, `buildRefundActions`, `parsePaymentEvents`, `getPayment`, `derivePaymentId` to the SDK
5. Add SDK `README.md` documentation
6. Verify: full snforge test suite passes — every invariant covered; SDK tests pass against `test_vectors.json`

### Phase 3 — Frontend + mainnet integration

1. Replace `WalletAccountV6Tag.tsx` with ConditionalPay UI components (`CreatePayment`, `ClaimPayment`, `ApprovePayment`, `RefundPayment`, `PaymentCard`, `PaymentList`)
2. `PaymentList` reads non-secret metadata from `localStorage` (§13). Raw secrets are NOT stored in `localStorage`.
3. `CreatePayment` presents "Copy claim credential" and "Copy refund secret" after successful CREATE — modal does not dismiss until user acknowledges (§13 item 2)
4. `ClaimPayment` accepts claim credential via **URL fragment** (`/claim#id=...&secret=...`) — parsed client-side, fragment removed from visible URL via `history.replaceState` (§13 item 3). Manual entry also supported.
5. Frontend restricts token selection to STRK (SDK remains token-generic)
6. Update `page.tsx` with ConditionalPay branding and layout
7. Update `layout.tsx` metadata
8. Remove remaining demo code (echo constants, echo helper references)
9. Declare + deploy contract to mainnet via sncast (constructor: mainnet pool address)
10. Small-value mainnet end-to-end: CREATE → CLAIM, CREATE → REFUND, CREATE → APPROVE → CLAIM with Ready extension
11. Populate `strk20.json` with ≥3 ConditionalPay mainnet tx hashes (hackathon submission format: `{"transactions": [...]}`)
12. Graceful degradation: detect wallets without privacy support, hide ConditionalPay actions
13. Fee UX: read pool fee from `get_fee_amount`, surface in UI, subtract from MAX amounts
14. Note maturity UX: surface the ~10-block wait after shielding

### Phase 4 — Hardening

1. Write `SECURITY.md` documenting the bearer-credential threat model (see §16)
2. Team-owned security review of contract code
3. Simulation / dry-run of adversarial scenarios (double-claim, expired-then-claim race, unauthorized approve, refund with wrong preimage, solvency drain attempt)
4. Larger-value mainnet tests
5. External security review (desirable, not a hard sprint blocker)
5. Production deployment with documented contract addresses

---

## 15. What is explicitly out of scope for the MVP

1. **Multi-token frontend** — the contract and SDK are token-generic, but the MVP frontend exposes only STRK. Multi-token UI is a future extension.
2. **Batch/multi-payment creation** — one payment per transaction in the MVP.
3. **Server-side payment indexing** — the MVP uses `localStorage` for creator payment persistence. Cross-device sync or server-side index is future work.
4. **Private sub-accounts** — the Wallet API route for sub-accounts is still pending. Tracked for future.
5. **Custom condition primitives beyond hashlock/timelock/approval** — the MVP supports exactly these three. Extensible condition framework is a future design.
6. **Mobile wallet support** — Ready extension only (browser).
7. **Paymaster / gasless transactions** — fee UX is still being designed by the STRK20 team. Track and adopt when available.
8. **Privacy Bridge / cross-chain funding** — out of scope. Users must hold tokens on Starknet.
9. **Backend / server-side account management** — ConditionalPay is a pure dapp (wallet-only, no backend keys).
10. **Generic escrow or payout features** — ConditionalPay is developer infrastructure for programmable conditional settlement, not an end-user escrow app.
11. **UI/UX design system** — MVP extends the starter kit's styles. A design overhaul is a separate effort.
12. **Automated contract deployment from the UI** — MVP uses sncast for deploy. The echo helper's "deploy from UI" pattern is removed.
13. **Sepolia-first development** — the sprint is mainnet-only. Sepolia is optional for convenience.
14. **npm publish of SDK** — `packages/sdk/` is consumed via workspace reference. Publishing to npm is a future step.

---

## 16. Compliance & security notes

- **Deposit screening** is enforced onchain by the protocol from v0.14.3; it applies on every route, including self-hosted proving.
- **Selective disclosure** exists for legitimate regulatory requests — it is not automatic compliance, carries no regulator endorsement, and the ConditionalPay team owns its own legal/compliance decisions and any use-case KYC.
- **The team owns** review, deployment, and maintenance of the ConditionalPay contract. This skill never generates the contract — it provides design guidance.
- **Security approach**: comprehensive snforge tests (all invariants from §8), simulation/dry-run, small-value mainnet deployment, team-owned security review. External review is desirable but not a hard sprint blocker.
- **Never attribute activity to a transaction sender.** Private transactions are relayed, so the sender is the relayer. Any feature that counts per-user activity reads the pool's `Deposit` event and filters on its **first indexed key (topic1)**.
- **Bearer credentials**: the `claim_preimage` and `refund_preimage` are sensitive secrets. The SDK and frontend must treat them as credentials — never log them, never include in analytics, clear from memory after use. Claim credentials must be shared via URL fragments (not query parameters) to avoid server-side logging.
- **`SECURITY.md` requirement** (Phase 4): the repo must ship a `SECURITY.md` documenting the bearer-credential threat model. At minimum it must state:
  1. Anyone who obtains a valid, unused `claim_preimage` can exercise the claim during its valid time window. The hashlock is a bearer credential — there is no additional address-based authorization.
  2. Anyone who obtains a valid, unused `refund_preimage` can exercise the refund after expiry. The refund_hash is a bearer credential.
  3. If a bearer secret is leaked, the only mitigation is to exercise it before the attacker does (or, for claims, to wait for expiry and refund).
  4. Secrets must not be stored in plain `localStorage`, URL query parameters, server-side logs, or analytics. The MVP uses explicit copy/export; encrypted client-side storage is a future upgrade.
  5. The `approve` entrypoint is address-gated (not bearer) — only the configured approver can call it, and only while the payment is ACTIVE.

---

## 17. Open items to re-verify at build time

- [ ] get-starknet `next` tag: 6.0.4 is now published — verify compatibility before pinning (skill pins 6.0.3)
- [ ] `packages/sub_account_anonymizer` — no longer present in the monorepo (was cited by the skill). A new `packages/shadow_account_anonymizer` exists — check if relevant.
- [ ] Xverse dapp-facing Wallet API status — re-check
- [ ] Wallet API spec v0.10.4-rc.1 in flight — track
- [ ] Pool fee amount — read from `get_fee_amount` at build time
- [ ] Note maturity timing — confirm ~10 blocks on current mainnet
- [ ] Fee/paymaster design — still being designed by STRK20 team
- [ ] `starknet` npm `next` tag now at 10.7.0 — evaluate if later versions add anything useful (pinned 10.4.0 is sufficient)
- [ ] Verify `privacy_invoke` calldata deserialization matches the enum Serde layout in the deployed pool version

---

## 18. Links

| What | Where |
|---|---|
| STRK20 pool (mainnet) | https://voyager.online/contract/0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a |
| Privacy SDK monorepo | https://github.com/starkware-libs/starknet-privacy |
| SDK quickstart | https://github.com/starkware-libs/starknet-privacy/blob/main/sdk/README.md |
| WalletAccount guide | https://starknet-js.com/docs/next/guides/account/walletAccount/#with-get-starknet-v6 |
| Wallet test dapp | https://starknet-wallet-account.vercel.app/ |
| Wallet API spec v0.10.3 | https://github.com/starkware-libs/starknet-specs/releases/tag/v0.10.3 |
| Whitepaper | https://eprint.iacr.org/2026/474 |
| Anonymizer anatomy (privacy_invoke) | https://strk20-by-example.org/helpers/privacy-invoke |
| Swap anonymizer example | https://strk20-by-example.org/helpers/swap-helper |
| Vault anonymizer example | https://strk20-by-example.org/helpers/vesu-lending-helper |
| Private DeFi via Wallet API | https://strk20-by-example.org/starknet-wallet-api/private-defi |
| What is STRK20 | https://strk20-by-example.org/what-is-strk20 |
| Notes & nullifiers | https://strk20-by-example.org/notes-and-nullifiers |
| Builder privacy overview | https://strk20-by-example.org/builder-privacy-overview |
| Compliance | https://strk20-by-example.org/compliance |
| Cairo CoreStars Telegram | @sncorestars |
