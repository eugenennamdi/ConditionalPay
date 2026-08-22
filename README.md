# ConditionalPay

Programmable private settlement infrastructure for [STRK20](https://strk20-by-example.org/starknet-wallet-api/starknet-js) on Starknet.

ConditionalPay lets applications lock a shielded asset behind a hashlock, time window, and optional approval gate, then settle it through either CLAIM or REFUND. The contract deliberately avoids storing creator, claimant, or refunder addresses while preserving public, auditable conditions and per-token solvency accounting.

## Why conditional settlement

Private assets still need programmable outcomes: pay when a secret is revealed, wait until a release time, require an approver, or return funds after expiry. A normal public escrow links user addresses directly to those actions. ConditionalPay instead receives and returns value through the STRK20 pool's `privacy_invoke` path, so the application contract enforces the conditions without recording those participant roles.

This is not a claim that the entire payment is hidden. Token, amount, conditions, timing, application activity, and OPEN-note settlement amount are public at the ConditionalPay/STRK20 boundary.

## Lifecycle

### CREATE

The wallet constructs `[withdraw, invoke CREATE]`. STRK20 withdraws the exact token amount to ConditionalPay, then the pool invokes the contract. ConditionalPay validates the amount and timing, derives a domain-separated Payment ID, verifies that its token balance covers the prospective liability, stores the payment as `ACTIVE`, increments `locked_by_token[token]`, and returns no output note.

### CLAIM

The wallet constructs `[transfer OPEN, invoke CLAIM]`. ConditionalPay requires an `ACTIVE` payment, a matching domain-separated claim preimage, `block_timestamp >= claim_after`, `block_timestamp < expires_at` when configured, and completed approval when an approver is configured. It transitions the payment to `CLAIMED`, reduces liability, and returns the stored token and amount to the selected STRK20 OPEN note.

### REFUND

The wallet constructs `[transfer OPEN, invoke REFUND]`. ConditionalPay requires an `ACTIVE` payment, a matching refund preimage, a configured expiry, and `block_timestamp >= expires_at`. It transitions the payment to `REFUNDED`, reduces liability, and returns the stored token and amount to the selected STRK20 OPEN note.

`CLAIMED` and `REFUNDED` are terminal states, preventing replay or double settlement.

## Conditions and credentials

- **Hashlock:** CLAIM reveals a preimage whose domain-separated Poseidon hash equals the stored hashlock.
- **Claim time:** `claim_after` is inclusive: CLAIM is allowed at or after that timestamp.
- **Expiry:** CLAIM requires `now < expires_at`; REFUND requires `now >= expires_at`. An expiry of zero means no claim expiry and no refund path.
- **Optional approval:** when `approver != 0`, that public Starknet address must call `approve(payment_id)` before CLAIM. The claim preimage is still required.
- **Bearer model:** claim and refund preimages are bearer credentials. Possession of an unused valid credential may authorize the corresponding eligible settlement.

The SDK supports password-encrypted recovery envelopes. Passphrases must never be stored beside envelopes, and plaintext credentials must not be persisted in query strings, browser storage, logs, analytics, or telemetry. See [SECURITY.md](./SECURITY.md).

## Architecture

```text
Application UI
    |
    | canonical actions from @conditionalpay/sdk
    v
Privacy-enabled Starknet wallet
    |
    | STRK20 proof construction, note management, relay
    v
Canonical STRK20 pool
    |
    | privacy_invoke(ConditionalPayAction)
    v
ConditionalPay
    |-- payment state machine
    |-- Poseidon hashlocks and Payment IDs
    |-- optional address-gated approval
    |-- per-token locked liability
    `-- exact ERC-20 allowance for settlement back to STRK20
```

The dapp does not receive the user's STRK20 viewing key, notes, or proof material. Wallet-mediated integration follows the official [STRK20 Wallet API guide](https://strk20-by-example.org/starknet-wallet-api/starknet-js).

## Privacy boundary

### Public

- ConditionalPay/anonymizer and STRK20 pool invocation.
- Token and amount at the application/anonymizer boundary.
- Hashlock, refund hash, nonce, claim timing, expiry, configured approver, and approval status.
- Lifecycle events and timing.
- Claim or refund preimage after successful revelation.
- OPEN-note settlement amount.

### Not stored or role-linked by ConditionalPay

- Creator address.
- Claimant address.
- Refunder address.

Settlement returns into a STRK20 note. Private transactions are relayed, so the transaction sender is the relayer and must not be treated as the user. ConditionalPay does not claim that token, amount, conditions, or timing are hidden.

## Mainnet deployment

- Network: Starknet Mainnet
- ConditionalPay: [`0x0166e31803cfab50383d5b636b86a5646233881fad3a2fb89354da63f6cdb483`](https://voyager.online/contract/0x0166e31803cfab50383d5b636b86a5646233881fad3a2fb89354da63f6cdb483)
- Class hash: `0x04ba374a48b878cb1b59b9cbfdc1c56527a6a1d2c64f645c7435a79c037c828b`
- Canonical STRK20 pool: [`0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a`](https://voyager.online/contract/0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a)
- STRK: [`0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d`](https://voyager.online/contract/0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d)

Deployment reads confirmed the canonical pool and zero initial liability. The complete Mainnet evidence is recorded in [MAINNET_EVIDENCE.md](./MAINNET_EVIDENCE.md) and `strk20.json`.

| Flow | Result | Authenticated event |
|---|---|---|
| TX1 CREATE A | `UNINITIALIZED -> ACTIVE` | `PaymentCreated` |
| TX2 CLAIM A | `ACTIVE -> CLAIMED` | `PaymentClaimed` |
| TX3 CREATE B | `UNINITIALIZED -> ACTIVE` | `PaymentCreated` |
| TX4 REFUND B | `ACTIVE -> REFUNDED` | `PaymentRefunded` |

Final verified liability: `get_locked_by_token(STRK) = 0`.

## SDK

`packages/sdk` provides:

- Domain-separated Poseidon hashing and Payment ID derivation.
- Strict Cairo-compatible validation and calldata encoding.
- Canonical `buildCreateActions`, `buildClaimActions`, and `buildRefundActions` builders.
- Onchain payment/liability queries and authenticated event parsing.
- CSPRNG credential generation and password-encrypted recovery envelopes.
- Cross-language TypeScript/Cairo test vectors.

The SDK is currently consumed as a private npm workspace package and is not published to npm.

## Development

Requirements: Node.js 24+, npm 11+, Scarb with Cairo 2.20-compatible tooling, and a Starknet RPC endpoint.

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Set `NEXT_PUBLIC_PROVIDER_URL` in `.env.local` to the RPC provider key segment expected by `src/utils/constants.ts`. This is a browser-exposed value; restrict it at the provider and never place wallet or recovery secrets in environment files.

## Verification

```bash
npm run check:test-vectors
npm run test:sdk
npm run test:frontend
npx tsc --noEmit
npm run lint
npm run build
(cd cairo && scarb --profile release test)
```

The Cairo and TypeScript suites share deterministic Poseidon vectors. Mainnet evidence demonstrates CREATE/CLAIM and CREATE/REFUND with final zero liability; it is not a substitute for a formal audit.

## Current limitations

- No formal third-party security audit has been completed.
- The submission UI is intentionally read-only after completing the evidence lifecycle; the historical localhost execution harness is preserved on branch `evidence/mainnet-lifecycle` and tag `mainnet-lifecycle-v1`.
- The frontend supports canonical STRK only, although the contract and SDK are token-generic.
- Credentials are bearer secrets with no onchain rotation or revocation.
- A valid credential holder may route settlement to another valid OPEN note; settlement is not bound to a stored claimant/refunder address.
- Payment discovery/indexing and a polished generic execution UX remain future product work.
- Wallet support depends on a compatible privacy-enabled Starknet wallet and the current Wallet API implementation.

## License

ConditionalPay is available under the [MIT License](./LICENSE). The original starter-kit copyright attribution is preserved.
