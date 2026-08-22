# ConditionalPay security

ConditionalPay is experimental software. No formal third-party security audit has been completed.

## Responsible disclosure

Please report vulnerabilities privately through the [ConditionalPay repository's GitHub Security Advisories](https://github.com/eugenennamdi/ConditionalPay/security/advisories/new). Do not include bearer credentials, wallet secrets, private keys, or live recovery envelopes in a public issue.

## Bearer credentials

The claim and refund preimages are bearer credentials:

- Possession of a valid, unused claim preimage may authorize CLAIM while the payment is `ACTIVE`, `block_timestamp >= claim_after`, `block_timestamp < expires_at` when an expiry exists, and any configured approval gate has been satisfied.
- Possession of a valid, unused refund preimage may authorize REFUND while the payment is `ACTIVE` and `block_timestamp >= expires_at`. Refund is unavailable when `expires_at = 0`.
- A leaked credential cannot be revoked or rotated in the deployed protocol. The practical response is to use the credential first if it is currently eligible, or allow the competing terminal path to settle when eligible.
- `CLAIMED` and `REFUNDED` are terminal states. The `ACTIVE` requirement prevents replay and double settlement.

An optional approver adds an address-gated condition to CLAIM: the configured Starknet address must call `approve(payment_id)` while the payment is `ACTIVE`. Approval does not replace the claim preimage, does not authorize REFUND, and does not bind settlement to a claimant address.

## Credential storage and transport

ConditionalPay's SDK supports password-encrypted recovery envelopes using AES-256-GCM and PBKDF2-HMAC-SHA256. The passphrase and envelope must be stored separately.

- Never persist plaintext preimages or passphrases in `localStorage`, `sessionStorage`, environment files, query strings, telemetry, analytics, or logs.
- Do not transport credentials in URL query parameters. Prefer an explicit encrypted-file handoff through a user-controlled secure channel.
- Recovery envelopes remain sensitive encrypted artifacts. Keep them outside the repository with restrictive filesystem permissions.
- Decrypt only for the immediate action and release references after success, rejection, error, disconnect, cancellation, or unmount.
- JavaScript immutable strings and garbage collection prevent guaranteed cryptographic zeroization. Browser cleanup is best-effort, not a zeroization guarantee.

## Privacy boundary

ConditionalPay does not store creator, claimant, or refunder addresses. STRK20 wallet flows are relayed, so a transaction sender must not be interpreted as the user.

The following remain public at the application/anonymizer boundary or in ConditionalPay state and events:

- ConditionalPay and STRK20 pool interaction.
- Token, amount, timing, hashlock, refund hash, nonce, approval state, and configured approver.
- Claim or refund preimage after successful onchain revelation.
- The settlement amount carried by an OPEN note.

Settlement returns value into a STRK20 note, but ConditionalPay does not claim that token, amount, conditions, or timing are hidden.

## STRK20 v2 note routing

CLAIM and REFUND accept the `note_id` supplied through the Wallet API's OPEN-note placeholder. A holder of a valid bearer credential may route settlement to another valid OPEN note. This is not a solvency or replay vulnerability: the payment amount and token remain fixed, liability is reduced once, and the payment enters a terminal state. It is nevertheless an important part of the bearer authorization model—credential possession authorizes settlement and does not bind the output to a stored claimant or refunder address.

## Solvency and liability accounting

- CREATE requires a non-zero amount, a unique payment ID, valid timing, and an actual contract token balance that covers the prospective per-token liability.
- `locked_by_token[token]` increases by exactly the stored amount on CREATE and decreases by exactly that amount on CLAIM or REFUND.
- CLAIM and REFUND verify that recorded liability is sufficient before reducing it.
- The settlement note's token and amount come from the stored payment, not untrusted frontend input.

## Allowance and external-call behavior

On CLAIM or REFUND, ConditionalPay transitions the payment to its terminal state and reduces liability before calling the token contract. It then approves the canonical STRK20 pool for exactly the stored payment amount and requires the token's `approve` call to return `true`; it does not grant an unlimited or additive allowance. The pool is expected to consume that exact allowance during atomic settlement.

`privacy_invoke` accepts calls only from the immutable STRK20 pool. Terminal-state writes before the external token approval and the pool-only caller check block the tested token-callback reentrancy paths. There is no general-purpose reentrancy guard; non-standard or malicious token behavior remains a trust boundary, and the submission frontend supports canonical STRK only.

## Scope and limitations

- The contract and SDK have comprehensive local regression tests and a verified small-value Mainnet lifecycle, but those are not substitutes for an independent audit.
- The deployed contract is immutable for this evidence release. Any future change requires a new class/deployment and a new review.
- Users remain responsible for secure credential custody, endpoint integrity, wallet security, and verifying network/contract identifiers before execution.
