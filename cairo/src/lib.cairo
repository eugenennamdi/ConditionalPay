use starknet::ContractAddress;

/// OpenNoteDeposit matches the STRK20 pool's expected positional Serde structure for note
/// settlement.
#[derive(Serde, Copy, Drop, PartialEq, Debug)]
pub struct OpenNoteDeposit {
    pub note_id: felt252,
    pub token: ContractAddress,
    pub amount: u128,
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

#[starknet::interface]
pub trait IConditionalPay<TState> {
    fn get_strk20_pool(self: @TState) -> ContractAddress;
    fn get_payment(self: @TState, payment_id: felt252) -> Payment;
    fn get_locked_by_token(self: @TState, token: ContractAddress) -> u128;
    fn privacy_invoke(ref self: TState, action: ConditionalPayAction) -> Span<OpenNoteDeposit>;
}

#[starknet::contract]
pub mod ConditionalPay {
    use core::panic_with_felt252;
    use starknet::storage::{
        Map, StorageMapReadAccess, StoragePointerReadAccess, StoragePointerWriteAccess,
    };
    use starknet::{ContractAddress, get_caller_address};
    use super::{ConditionalPayAction, IConditionalPay, OpenNoteDeposit, Payment};

    pub mod errors {
        pub const CALLER_NOT_POOL: felt252 = 'CALLER_NOT_POOL';
        pub const NOT_IMPLEMENTED: felt252 = 'NOT_IMPLEMENTED';
    }

    #[storage]
    struct Storage {
        strk20_pool: ContractAddress,
        payments: Map<felt252, Payment>,
        locked_by_token: Map<ContractAddress, u128>,
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

        fn privacy_invoke(
            ref self: ContractState, action: ConditionalPayAction,
        ) -> Span<OpenNoteDeposit> {
            let caller = get_caller_address();
            let pool = self.strk20_pool.read();
            assert(caller == pool, errors::CALLER_NOT_POOL);

            // Phase 1A scaffold: Action decoding verified, business logic intentionally deferred
            match action {
                ConditionalPayAction::Create(_) => { panic_with_felt252(errors::NOT_IMPLEMENTED) },
                ConditionalPayAction::Claim(_) => { panic_with_felt252(errors::NOT_IMPLEMENTED) },
                ConditionalPayAction::Refund(_) => { panic_with_felt252(errors::NOT_IMPLEMENTED) },
            }
        }
    }
}
