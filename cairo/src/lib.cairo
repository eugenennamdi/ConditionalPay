use starknet::ContractAddress;

/// OpenNoteDeposit matches the STRK20 pool's expected positional Serde structure for note
/// settlement.
#[derive(Serde, Copy, Drop, PartialEq, Debug)]
pub struct OpenNoteDeposit {
    pub note_id: felt252,
    pub token: ContractAddress,
    pub amount: u128,
}

/// Minimal ERC-20 interface for querying balance and managing token allowances.
#[starknet::interface]
pub trait IErc20<TState> {
    fn balance_of(self: @TState, account: ContractAddress) -> u256;
    fn approve(ref self: TState, spender: ContractAddress, amount: u256) -> bool;
}

/// Lifecycle states for a ConditionalPay escrow.
pub mod payment_state {
    pub const UNINITIALIZED: u8 = 0;
    pub const ACTIVE: u8 = 1;
    pub const CLAIMED: u8 = 2;
    pub const REFUNDED: u8 = 3;
}

/// Domain separation constants for Poseidon hashing across Cairo and TypeScript SDK.
pub mod domains {
    pub const CONDITIONALPAY_CLAIM_V1: felt252 = 'CONDITIONALPAY_CLAIM_V1';
    pub const CONDITIONALPAY_REFUND_V1: felt252 = 'CONDITIONALPAY_REFUND_V1';
    pub const CONDITIONALPAY_PAYMENT_V1: felt252 = 'CONDITIONALPAY_PAYMENT_V1';
}

/// Stored payment record (no creator or claimant addresses stored).
#[derive(Drop, Serde, Copy, starknet::Store, PartialEq, Debug)]
pub struct Payment {
    pub token: ContractAddress,
    pub amount: u128,
    pub hashlock: felt252,
    pub refund_hash: felt252,
    pub claim_after: u64,
    pub expires_at: u64,
    pub approver: ContractAddress,
    pub approved: bool,
    pub state: u8,
}

/// Typed parameters for creating a conditional payment.
#[derive(Serde, Copy, Drop, PartialEq, Debug)]
pub struct CreateParams {
    pub token: ContractAddress,
    pub amount: u128,
    pub hashlock: felt252,
    pub refund_hash: felt252,
    pub claim_after: u64,
    pub expires_at: u64,
    pub approver: ContractAddress,
    pub nonce: felt252,
}

/// Typed parameters for claiming a conditional payment.
#[derive(Serde, Copy, Drop, PartialEq, Debug)]
pub struct ClaimParams {
    pub payment_id: felt252,
    pub claim_preimage: felt252,
    pub note_id: felt252,
}

/// Typed parameters for refunding an expired conditional payment.
#[derive(Serde, Copy, Drop, PartialEq, Debug)]
pub struct RefundParams {
    pub payment_id: felt252,
    pub refund_preimage: felt252,
    pub note_id: felt252,
}

/// Action enum deserialized by privacy_invoke.
#[derive(Serde, Copy, Drop, PartialEq, Debug)]
pub enum ConditionalPayAction {
    Create: CreateParams,
    Claim: ClaimParams,
    Refund: RefundParams,
}

/// Domain-separated Poseidon hashing helpers.
pub fn compute_hashlock(claim_preimage: felt252) -> felt252 {
    core::poseidon::poseidon_hash_span(
        array![domains::CONDITIONALPAY_CLAIM_V1, claim_preimage].span(),
    )
}

pub fn compute_refund_hash(refund_preimage: felt252) -> felt252 {
    core::poseidon::poseidon_hash_span(
        array![domains::CONDITIONALPAY_REFUND_V1, refund_preimage].span(),
    )
}

pub fn compute_payment_id(params: @CreateParams) -> felt252 {
    core::poseidon::poseidon_hash_span(
        array![
            domains::CONDITIONALPAY_PAYMENT_V1, (*params.token).into(), (*params.amount).into(),
            *params.hashlock, *params.refund_hash, (*params.claim_after).into(),
            (*params.expires_at).into(), (*params.approver).into(), *params.nonce,
        ]
            .span(),
    )
}

#[starknet::interface]
pub trait IConditionalPay<TState> {
    fn get_strk20_pool(self: @TState) -> ContractAddress;
    fn get_payment(self: @TState, payment_id: felt252) -> Payment;
    fn get_locked_by_token(self: @TState, token: ContractAddress) -> u128;
    fn compute_payment_id(self: @TState, params: CreateParams) -> felt252;
    fn privacy_invoke(ref self: TState, action: ConditionalPayAction) -> Span<OpenNoteDeposit>;
}

#[starknet::contract]
pub mod ConditionalPay {
    use core::panic_with_felt252;
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess,
    };
    use starknet::{ContractAddress, get_block_timestamp, get_caller_address, get_contract_address};
    use super::{
        ClaimParams, ConditionalPayAction, CreateParams, IConditionalPay, IErc20Dispatcher,
        IErc20DispatcherTrait, OpenNoteDeposit, Payment, compute_hashlock, compute_payment_id,
        payment_state,
    };

    pub mod errors {
        pub const CALLER_NOT_POOL: felt252 = 'CALLER_NOT_POOL';
        pub const NOT_IMPLEMENTED: felt252 = 'NOT_IMPLEMENTED';
        pub const ZERO_AMOUNT: felt252 = 'ZERO_AMOUNT';
        pub const INVALID_EXPIRY: felt252 = 'INVALID_EXPIRY';
        pub const PAYMENT_ALREADY_EXISTS: felt252 = 'PAYMENT_ALREADY_EXISTS';
        pub const INSUFFICIENT_BALANCE: felt252 = 'INSUFFICIENT_BALANCE';
        pub const PAYMENT_NOT_ACTIVE: felt252 = 'PAYMENT_NOT_ACTIVE';
        pub const INVALID_CLAIM_SECRET: felt252 = 'INVALID_CLAIM_SECRET';
        pub const CLAIM_TOO_EARLY: felt252 = 'CLAIM_TOO_EARLY';
        pub const PAYMENT_EXPIRED: felt252 = 'PAYMENT_EXPIRED';
        pub const APPROVAL_REQUIRED: felt252 = 'APPROVAL_REQUIRED';
        pub const INSUFFICIENT_LOCKED_AMOUNT: felt252 = 'INSUFFICIENT_LOCKED_AMOUNT';
        pub const ERC20_APPROVE_FAILED: felt252 = 'ERC20_APPROVE_FAILED';
    }

    #[storage]
    struct Storage {
        strk20_pool: ContractAddress,
        payments: Map<felt252, Payment>,
        locked_by_token: Map<ContractAddress, u128>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        PaymentCreated: PaymentCreated,
        PaymentClaimed: PaymentClaimed,
    }

    #[derive(Drop, starknet::Event)]
    pub struct PaymentCreated {
        #[key]
        pub payment_id: felt252,
        pub token: ContractAddress,
        pub amount: u128,
        pub hashlock: felt252,
        pub refund_hash: felt252,
        pub claim_after: u64,
        pub expires_at: u64,
        pub approver: ContractAddress,
        pub nonce: felt252,
    }

    #[derive(Drop, starknet::Event)]
    pub struct PaymentClaimed {
        #[key]
        pub payment_id: felt252,
    }

    #[constructor]
    pub fn constructor(ref self: ContractState, strk20_pool: ContractAddress) {
        self.strk20_pool.write(strk20_pool);
    }

    #[abi(embed_v0)]
    pub impl ConditionalPayImpl of IConditionalPay<ContractState> {
        fn get_strk20_pool(self: @ContractState) -> ContractAddress {
            self.strk20_pool.read()
        }

        fn get_payment(self: @ContractState, payment_id: felt252) -> Payment {
            self.payments.read(payment_id)
        }

        fn get_locked_by_token(self: @ContractState, token: ContractAddress) -> u128 {
            self.locked_by_token.read(token)
        }

        fn compute_payment_id(self: @ContractState, params: CreateParams) -> felt252 {
            compute_payment_id(@params)
        }

        fn privacy_invoke(
            ref self: ContractState, action: ConditionalPayAction,
        ) -> Span<OpenNoteDeposit> {
            let caller = get_caller_address();
            let pool = self.strk20_pool.read();
            assert(caller == pool, errors::CALLER_NOT_POOL);

            match action {
                ConditionalPayAction::Create(params) => { self.handle_create(params) },
                ConditionalPayAction::Claim(params) => { self.handle_claim(params) },
                ConditionalPayAction::Refund(_) => { panic_with_felt252(errors::NOT_IMPLEMENTED) },
            }
        }
    }

    #[generate_trait]
    impl InternalFunctions of InternalFunctionsTrait {
        fn handle_create(ref self: ContractState, params: CreateParams) -> Span<OpenNoteDeposit> {
            // 1. Validate amount
            assert(params.amount != 0, errors::ZERO_AMOUNT);

            // 2. Validate timing / expiry configuration
            if params.expires_at != 0 {
                assert(params.expires_at > params.claim_after, errors::INVALID_EXPIRY);
                assert(params.expires_at > get_block_timestamp(), errors::INVALID_EXPIRY);
            }

            // 3. Deterministically derive payment ID and verify uniqueness
            let payment_id = compute_payment_id(@params);
            let existing_payment = self.payments.read(payment_id);
            assert(
                existing_payment.state == payment_state::UNINITIALIZED,
                errors::PAYMENT_ALREADY_EXISTS,
            );

            // 4. Verify solvency: check actual ERC-20 contract balance covers prospective liability
            let current_locked = self.locked_by_token.read(params.token);
            let new_locked = current_locked + params.amount;
            let erc20 = IErc20Dispatcher { contract_address: params.token };
            let contract_balance: u256 = erc20.balance_of(get_contract_address());
            assert(contract_balance >= new_locked.into(), errors::INSUFFICIENT_BALANCE);

            // 5. Commit state updates
            self
                .payments
                .write(
                    payment_id,
                    Payment {
                        token: params.token,
                        amount: params.amount,
                        hashlock: params.hashlock,
                        refund_hash: params.refund_hash,
                        claim_after: params.claim_after,
                        expires_at: params.expires_at,
                        approver: params.approver,
                        approved: false,
                        state: payment_state::ACTIVE,
                    },
                );
            self.locked_by_token.write(params.token, new_locked);

            // 6. Emit indexable PaymentCreated event
            self
                .emit(
                    PaymentCreated {
                        payment_id,
                        token: params.token,
                        amount: params.amount,
                        hashlock: params.hashlock,
                        refund_hash: params.refund_hash,
                        claim_after: params.claim_after,
                        expires_at: params.expires_at,
                        approver: params.approver,
                        nonce: params.nonce,
                    },
                );

            // 7. CREATE returns empty OpenNoteDeposit span (no output note created)
            array![].span()
        }

        fn handle_claim(ref self: ContractState, params: ClaimParams) -> Span<OpenNoteDeposit> {
            // 1. Load payment and require ACTIVE
            let mut payment = self.payments.read(params.payment_id);
            assert(payment.state == payment_state::ACTIVE, errors::PAYMENT_NOT_ACTIVE);

            // 2. Verify claim preimage against hashlock using domain-separated Poseidon
            let computed_hash = compute_hashlock(params.claim_preimage);
            assert(computed_hash == payment.hashlock, errors::INVALID_CLAIM_SECRET);

            // 3. Timing checks
            let now = get_block_timestamp();
            assert(now >= payment.claim_after, errors::CLAIM_TOO_EARLY);
            if payment.expires_at != 0 {
                assert(now < payment.expires_at, errors::PAYMENT_EXPIRED);
            }

            // 4. Approval gate (if approver is configured, payment must be approved)
            let zero_address: ContractAddress = 0x0.try_into().unwrap();
            if payment.approver != zero_address {
                assert(payment.approved, errors::APPROVAL_REQUIRED);
            }

            // 5. Liability verification & reduction
            let current_locked = self.locked_by_token.read(payment.token);
            assert(current_locked >= payment.amount, errors::INSUFFICIENT_LOCKED_AMOUNT);
            let new_locked = current_locked - payment.amount;

            // 6. Transition state to CLAIMED (terminal) & write reduced liability
            payment.state = payment_state::CLAIMED;
            self.payments.write(params.payment_id, payment);
            self.locked_by_token.write(payment.token, new_locked);

            // 7. ERC-20 approval to the stored STRK20 pool for exact payment amount
            let pool = self.strk20_pool.read();
            let erc20 = IErc20Dispatcher { contract_address: payment.token };
            let approved = erc20.approve(pool, payment.amount.into());
            assert(approved, errors::ERC20_APPROVE_FAILED);

            // 8. Emit PaymentClaimed event
            self.emit(PaymentClaimed { payment_id: params.payment_id });

            // 9. Return one OpenNoteDeposit for private note settlement
            array![
                OpenNoteDeposit {
                    note_id: params.note_id, token: payment.token, amount: payment.amount,
                },
            ]
                .span()
        }
    }
}
