use conditionalpay::{
    ClaimParams, ConditionalPay, ConditionalPayAction, CreateParams, IConditionalPayDispatcher,
    IConditionalPayDispatcherTrait, OpenNoteDeposit, Payment, RefundParams, compute_hashlock,
    compute_payment_id, compute_refund_hash, domains, payment_state,
};
use core::panic_with_felt252;
use starknet::ContractAddress;
use starknet::syscalls::deploy_syscall;
use starknet::testing::{set_block_timestamp, set_contract_address};

#[starknet::interface]
pub trait IMockErc20<TState> {
    fn balance_of(self: @TState, account: ContractAddress) -> u256;
    fn allowance(self: @TState, owner: ContractAddress, spender: ContractAddress) -> u256;
    fn approve(ref self: TState, spender: ContractAddress, amount: u256) -> bool;
    fn transfer_from(
        ref self: TState, sender: ContractAddress, recipient: ContractAddress, amount: u256,
    ) -> bool;
    fn set_balance(ref self: TState, account: ContractAddress, amount: u256);
    fn set_fail_approve(ref self: TState, fail: bool);
    fn set_revert_approve(ref self: TState, revert_val: bool);
    fn set_allowance_for_test(
        ref self: TState, owner: ContractAddress, spender: ContractAddress, amount: u256,
    );
}

#[starknet::contract]
pub mod MockErc20 {
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess,
    };
    use starknet::{ContractAddress, get_caller_address};

    #[storage]
    struct Storage {
        balances: Map<ContractAddress, u256>,
        allowances: Map<(ContractAddress, ContractAddress), u256>,
        fail_approve: bool,
        revert_approve: bool,
    }

    #[abi(embed_v0)]
    pub impl MockErc20Impl of super::IMockErc20<ContractState> {
        fn balance_of(self: @ContractState, account: ContractAddress) -> u256 {
            self.balances.read(account)
        }

        fn allowance(
            self: @ContractState, owner: ContractAddress, spender: ContractAddress,
        ) -> u256 {
            self.allowances.read((owner, spender))
        }

        fn approve(ref self: ContractState, spender: ContractAddress, amount: u256) -> bool {
            if self.revert_approve.read() {
                core::panic_with_felt252('ERC20_APPROVE_REVERT');
            }
            if self.fail_approve.read() {
                return false;
            }
            let caller = get_caller_address();
            self.allowances.write((caller, spender), amount);
            true
        }

        fn transfer_from(
            ref self: ContractState,
            sender: ContractAddress,
            recipient: ContractAddress,
            amount: u256,
        ) -> bool {
            let caller = get_caller_address();
            let allowed = self.allowances.read((sender, caller));
            assert(allowed >= amount, 'INSUFFICIENT_ALLOWANCE');
            let sender_bal = self.balances.read(sender);
            assert(sender_bal >= amount, 'INSUFFICIENT_BALANCE');

            self.allowances.write((sender, caller), allowed - amount);
            self.balances.write(sender, sender_bal - amount);
            let recipient_bal = self.balances.read(recipient);
            self.balances.write(recipient, recipient_bal + amount);
            true
        }

        fn set_balance(ref self: ContractState, account: ContractAddress, amount: u256) {
            self.balances.write(account, amount);
        }

        fn set_fail_approve(ref self: ContractState, fail: bool) {
            self.fail_approve.write(fail);
        }

        fn set_revert_approve(ref self: ContractState, revert_val: bool) {
            self.revert_approve.write(revert_val);
        }

        fn set_allowance_for_test(
            ref self: ContractState, owner: ContractAddress, spender: ContractAddress, amount: u256,
        ) {
            self.allowances.write((owner, spender), amount);
        }
    }
}

// -----------------------------------------------------------------------------
// TEST FIXTURE CONTRACT (For state-manipulation testing without production backdoors)
// -----------------------------------------------------------------------------

#[starknet::interface]
pub trait ITestStateConditionalPay<TState> {
    fn get_strk20_pool(self: @TState) -> ContractAddress;
    fn get_payment(self: @TState, payment_id: felt252) -> Payment;
    fn get_locked_by_token(self: @TState, token: ContractAddress) -> u128;
    fn compute_payment_id(self: @TState, params: CreateParams) -> felt252;
    fn privacy_invoke(ref self: TState, action: ConditionalPayAction) -> Span<OpenNoteDeposit>;
    fn approve(ref self: TState, payment_id: felt252);
    fn set_payment_for_test(ref self: TState, payment_id: felt252, payment: Payment);
    fn set_locked_by_token_for_test(ref self: TState, token: ContractAddress, amount: u128);
}

#[starknet::contract]
pub mod TestStateConditionalPay {
    use conditionalpay::{
        ClaimParams, ConditionalPayAction, CreateParams, IErc20Dispatcher, IErc20DispatcherTrait,
        OpenNoteDeposit, Payment, RefundParams, compute_hashlock, compute_payment_id,
        compute_refund_hash, payment_state,
    };
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess,
    };
    use starknet::{ContractAddress, get_block_timestamp, get_caller_address, get_contract_address};

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
        pub const INVALID_REFUND_SECRET: felt252 = 'INVALID_REFUND_SECRET';
        pub const NO_EXPIRY: felt252 = 'NO_EXPIRY';
        pub const PAYMENT_NOT_EXPIRED: felt252 = 'PAYMENT_NOT_EXPIRED';
        pub const CALLER_NOT_APPROVER: felt252 = 'CALLER_NOT_APPROVER';
        pub const NO_APPROVER_CONFIGURED: felt252 = 'NO_APPROVER_CONFIGURED';
        pub const INVALID_STRK20_POOL: felt252 = 'INVALID_STRK20_POOL';
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
        PaymentRefunded: PaymentRefunded,
        PaymentApproved: PaymentApproved,
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

    #[derive(Drop, starknet::Event)]
    pub struct PaymentRefunded {
        #[key]
        pub payment_id: felt252,
    }

    #[derive(Drop, starknet::Event)]
    pub struct PaymentApproved {
        #[key]
        pub payment_id: felt252,
    }

    #[constructor]
    pub fn constructor(ref self: ContractState, strk20_pool: ContractAddress) {
        let zero_address: ContractAddress = 0x0.try_into().unwrap();
        assert(strk20_pool != zero_address, errors::INVALID_STRK20_POOL);
        self.strk20_pool.write(strk20_pool);
    }

    #[abi(embed_v0)]
    pub impl TestStateConditionalPayImpl of super::ITestStateConditionalPay<ContractState> {
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

        fn set_payment_for_test(ref self: ContractState, payment_id: felt252, payment: Payment) {
            self.payments.write(payment_id, payment);
        }

        fn set_locked_by_token_for_test(
            ref self: ContractState, token: ContractAddress, amount: u128,
        ) {
            self.locked_by_token.write(token, amount);
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
                ConditionalPayAction::Refund(params) => { self.handle_refund(params) },
            }
        }

        fn approve(ref self: ContractState, payment_id: felt252) {
            let mut payment = self.payments.read(payment_id);
            assert(payment.state == payment_state::ACTIVE, errors::PAYMENT_NOT_ACTIVE);

            let zero_address: ContractAddress = 0x0.try_into().unwrap();
            assert(payment.approver != zero_address, errors::NO_APPROVER_CONFIGURED);

            let caller = get_caller_address();
            assert(caller == payment.approver, errors::CALLER_NOT_APPROVER);

            payment.approved = true;
            self.payments.write(payment_id, payment);

            self.emit(PaymentApproved { payment_id });
        }
    }

    #[generate_trait]
    impl InternalFunctions of InternalFunctionsTrait {
        fn handle_create(ref self: ContractState, params: CreateParams) -> Span<OpenNoteDeposit> {
            assert(params.amount != 0, errors::ZERO_AMOUNT);
            if params.expires_at != 0 {
                assert(params.expires_at > params.claim_after, errors::INVALID_EXPIRY);
                assert(params.expires_at > get_block_timestamp(), errors::INVALID_EXPIRY);
            }
            let payment_id = compute_payment_id(@params);
            let existing_payment = self.payments.read(payment_id);
            assert(
                existing_payment.state == payment_state::UNINITIALIZED,
                errors::PAYMENT_ALREADY_EXISTS,
            );
            let current_locked = self.locked_by_token.read(params.token);
            let new_locked = current_locked + params.amount;
            let erc20 = IErc20Dispatcher { contract_address: params.token };
            let contract_balance: u256 = erc20.balance_of(get_contract_address());
            assert(contract_balance >= new_locked.into(), errors::INSUFFICIENT_BALANCE);

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
            array![].span()
        }

        fn handle_claim(ref self: ContractState, params: ClaimParams) -> Span<OpenNoteDeposit> {
            let mut payment = self.payments.read(params.payment_id);
            assert(payment.state == payment_state::ACTIVE, errors::PAYMENT_NOT_ACTIVE);
            let computed_hash = compute_hashlock(params.claim_preimage);
            assert(computed_hash == payment.hashlock, errors::INVALID_CLAIM_SECRET);
            let now = get_block_timestamp();
            assert(now >= payment.claim_after, errors::CLAIM_TOO_EARLY);
            if payment.expires_at != 0 {
                assert(now < payment.expires_at, errors::PAYMENT_EXPIRED);
            }
            let zero_address: ContractAddress = 0x0.try_into().unwrap();
            if payment.approver != zero_address {
                assert(payment.approved, errors::APPROVAL_REQUIRED);
            }
            let current_locked = self.locked_by_token.read(payment.token);
            assert(current_locked >= payment.amount, errors::INSUFFICIENT_LOCKED_AMOUNT);
            let new_locked = current_locked - payment.amount;
            payment.state = payment_state::CLAIMED;
            self.payments.write(params.payment_id, payment);
            self.locked_by_token.write(payment.token, new_locked);
            let pool = self.strk20_pool.read();
            let erc20 = IErc20Dispatcher { contract_address: payment.token };
            let approved = erc20.approve(pool, payment.amount.into());
            assert(approved, errors::ERC20_APPROVE_FAILED);
            self.emit(PaymentClaimed { payment_id: params.payment_id });
            array![
                OpenNoteDeposit {
                    note_id: params.note_id, token: payment.token, amount: payment.amount,
                },
            ]
                .span()
        }

        fn handle_refund(ref self: ContractState, params: RefundParams) -> Span<OpenNoteDeposit> {
            let mut payment = self.payments.read(params.payment_id);
            assert(payment.state == payment_state::ACTIVE, errors::PAYMENT_NOT_ACTIVE);
            let computed_hash = compute_refund_hash(params.refund_preimage);
            assert(computed_hash == payment.refund_hash, errors::INVALID_REFUND_SECRET);
            assert(payment.expires_at != 0, errors::NO_EXPIRY);
            let now = get_block_timestamp();
            assert(now >= payment.expires_at, errors::PAYMENT_NOT_EXPIRED);
            let current_locked = self.locked_by_token.read(payment.token);
            assert(current_locked >= payment.amount, errors::INSUFFICIENT_LOCKED_AMOUNT);
            let new_locked = current_locked - payment.amount;
            payment.state = payment_state::REFUNDED;
            self.payments.write(params.payment_id, payment);
            self.locked_by_token.write(payment.token, new_locked);
            let pool = self.strk20_pool.read();
            let erc20 = IErc20Dispatcher { contract_address: payment.token };
            let approved = erc20.approve(pool, payment.amount.into());
            assert(approved, errors::ERC20_APPROVE_FAILED);
            self.emit(PaymentRefunded { payment_id: params.payment_id });
            array![
                OpenNoteDeposit {
                    note_id: params.note_id, token: payment.token, amount: payment.amount,
                },
            ]
                .span()
        }
    }
}

#[starknet::interface]
pub trait IMockPoolHarness<TState> {
    fn setup_and_fund(ref self: TState, cp: ContractAddress, token: ContractAddress, amount: u256);
    fn invoke_claim_and_fail_after(
        ref self: TState,
        cp: ContractAddress,
        payment_id: felt252,
        claim_preimage: felt252,
        note_id: felt252,
    );
    fn invoke_refund_and_fail_after(
        ref self: TState,
        cp: ContractAddress,
        payment_id: felt252,
        refund_preimage: felt252,
        note_id: felt252,
    );
    fn invoke_claim_and_settle(
        ref self: TState,
        cp: ContractAddress,
        payment_id: felt252,
        claim_preimage: felt252,
        note_id: felt252,
        token: ContractAddress,
        amount: u256,
    );
    fn invoke_refund_and_settle(
        ref self: TState,
        cp: ContractAddress,
        payment_id: felt252,
        refund_preimage: felt252,
        note_id: felt252,
        token: ContractAddress,
        amount: u256,
    );
}

#[starknet::contract]
pub mod MockPoolHarness {
    use conditionalpay::{
        ClaimParams, ConditionalPayAction, IConditionalPayDispatcher,
        IConditionalPayDispatcherTrait, RefundParams,
    };
    use core::panic_with_felt252;
    use starknet::{ContractAddress, get_contract_address};
    use super::{IMockErc20Dispatcher, IMockErc20DispatcherTrait};

    #[storage]
    struct Storage {}

    #[abi(embed_v0)]
    pub impl MockPoolHarnessImpl of super::IMockPoolHarness<ContractState> {
        fn setup_and_fund(
            ref self: ContractState, cp: ContractAddress, token: ContractAddress, amount: u256,
        ) {
            let erc20 = IMockErc20Dispatcher { contract_address: token };
            erc20.set_balance(cp, amount);
        }

        fn invoke_claim_and_fail_after(
            ref self: ContractState,
            cp: ContractAddress,
            payment_id: felt252,
            claim_preimage: felt252,
            note_id: felt252,
        ) {
            let cp_dispatcher = IConditionalPayDispatcher { contract_address: cp };
            let claim_params = ClaimParams { payment_id, claim_preimage, note_id };
            let deposits = cp_dispatcher.privacy_invoke(ConditionalPayAction::Claim(claim_params));
            assert(deposits.len() == 1, 'Deposits len != 1');
            panic_with_felt252('POOL_DOWNSTREAM_REVERT');
        }

        fn invoke_refund_and_fail_after(
            ref self: ContractState,
            cp: ContractAddress,
            payment_id: felt252,
            refund_preimage: felt252,
            note_id: felt252,
        ) {
            let cp_dispatcher = IConditionalPayDispatcher { contract_address: cp };
            let refund_params = RefundParams { payment_id, refund_preimage, note_id };
            let deposits = cp_dispatcher
                .privacy_invoke(ConditionalPayAction::Refund(refund_params));
            assert(deposits.len() == 1, 'Deposits len != 1');
            panic_with_felt252('POOL_DOWNSTREAM_REVERT');
        }

        fn invoke_claim_and_settle(
            ref self: ContractState,
            cp: ContractAddress,
            payment_id: felt252,
            claim_preimage: felt252,
            note_id: felt252,
            token: ContractAddress,
            amount: u256,
        ) {
            let cp_dispatcher = IConditionalPayDispatcher { contract_address: cp };
            let claim_params = ClaimParams { payment_id, claim_preimage, note_id };
            let deposits = cp_dispatcher.privacy_invoke(ConditionalPayAction::Claim(claim_params));
            assert(deposits.len() == 1, 'Deposits len != 1');

            let erc20 = IMockErc20Dispatcher { contract_address: token };
            let pulled = erc20.transfer_from(cp, get_contract_address(), amount);
            assert(pulled, 'Pull failed');
        }

        fn invoke_refund_and_settle(
            ref self: ContractState,
            cp: ContractAddress,
            payment_id: felt252,
            refund_preimage: felt252,
            note_id: felt252,
            token: ContractAddress,
            amount: u256,
        ) {
            let cp_dispatcher = IConditionalPayDispatcher { contract_address: cp };
            let refund_params = RefundParams { payment_id, refund_preimage, note_id };
            let deposits = cp_dispatcher
                .privacy_invoke(ConditionalPayAction::Refund(refund_params));
            assert(deposits.len() == 1, 'Deposits len != 1');

            let erc20 = IMockErc20Dispatcher { contract_address: token };
            let pulled = erc20.transfer_from(cp, get_contract_address(), amount);
            assert(pulled, 'Pull failed');
        }
    }
}

#[starknet::interface]
pub trait IReentrantMockToken<TState> {
    fn balance_of(self: @TState, account: ContractAddress) -> u256;
    fn allowance(self: @TState, owner: ContractAddress, spender: ContractAddress) -> u256;
    fn approve(ref self: TState, spender: ContractAddress, amount: u256) -> bool;
    fn transfer_from(
        ref self: TState, sender: ContractAddress, recipient: ContractAddress, amount: u256,
    ) -> bool;
    fn set_balance(ref self: TState, account: ContractAddress, amount: u256);
    fn set_reenter_target(ref self: TState, target: ContractAddress, payment_id: felt252);
    fn set_reenter_action(ref self: TState, action: u8);
}

#[starknet::contract]
pub mod ReentrantMockToken {
    use conditionalpay::{
        ClaimParams, ConditionalPayAction, IConditionalPayDispatcher,
        IConditionalPayDispatcherTrait, RefundParams,
    };
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess,
    };
    use starknet::{ContractAddress, get_caller_address};

    #[storage]
    struct Storage {
        balances: Map<ContractAddress, u256>,
        allowances: Map<(ContractAddress, ContractAddress), u256>,
        reenter_target: ContractAddress,
        reenter_payment_id: felt252,
        reenter_action: u8,
    }

    #[abi(embed_v0)]
    pub impl ReentrantMockTokenImpl of super::IReentrantMockToken<ContractState> {
        fn balance_of(self: @ContractState, account: ContractAddress) -> u256 {
            self.balances.read(account)
        }

        fn allowance(
            self: @ContractState, owner: ContractAddress, spender: ContractAddress,
        ) -> u256 {
            self.allowances.read((owner, spender))
        }

        fn approve(ref self: ContractState, spender: ContractAddress, amount: u256) -> bool {
            let caller = get_caller_address();
            self.allowances.write((caller, spender), amount);

            let action = self.reenter_action.read();
            if action != 0 {
                let target = self.reenter_target.read();
                let pid = self.reenter_payment_id.read();
                let cp = IConditionalPayDispatcher { contract_address: target };

                self.reenter_action.write(0);

                if action == 1 {
                    cp
                        .privacy_invoke(
                            ConditionalPayAction::Claim(
                                ClaimParams {
                                    payment_id: pid, claim_preimage: 0x123, note_id: 0x1,
                                },
                            ),
                        );
                } else if action == 2 {
                    cp
                        .privacy_invoke(
                            ConditionalPayAction::Refund(
                                RefundParams {
                                    payment_id: pid, refund_preimage: 0x123, note_id: 0x1,
                                },
                            ),
                        );
                } else if action == 3 {
                    cp.approve(pid);
                }
            }

            true
        }

        fn transfer_from(
            ref self: ContractState,
            sender: ContractAddress,
            recipient: ContractAddress,
            amount: u256,
        ) -> bool {
            let caller = get_caller_address();
            let allowed = self.allowances.read((sender, caller));
            assert(allowed >= amount, 'INSUFFICIENT_ALLOWANCE');
            let sender_bal = self.balances.read(sender);
            assert(sender_bal >= amount, 'INSUFFICIENT_BALANCE');

            self.allowances.write((sender, caller), allowed - amount);
            self.balances.write(sender, sender_bal - amount);
            let recipient_bal = self.balances.read(recipient);
            self.balances.write(recipient, recipient_bal + amount);
            true
        }

        fn set_balance(ref self: ContractState, account: ContractAddress, amount: u256) {
            self.balances.write(account, amount);
        }

        fn set_reenter_target(
            ref self: ContractState, target: ContractAddress, payment_id: felt252,
        ) {
            self.reenter_target.write(target);
            self.reenter_payment_id.write(payment_id);
        }

        fn set_reenter_action(ref self: ContractState, action: u8) {
            self.reenter_action.write(action);
        }
    }
}

fn contract_address(val: felt252) -> ContractAddress {
    val.try_into().unwrap()
}

fn deploy_mock_token(salt: felt252) -> (ContractAddress, IMockErc20Dispatcher) {
    let (addr, _) = deploy_syscall(
        MockErc20::TEST_CLASS_HASH.try_into().unwrap(), salt, array![].span(), false,
    )
        .unwrap();
    (addr, IMockErc20Dispatcher { contract_address: addr })
}

fn deploy_reentrant_mock_token(salt: felt252) -> (ContractAddress, IReentrantMockTokenDispatcher) {
    let (addr, _) = deploy_syscall(
        ReentrantMockToken::TEST_CLASS_HASH.try_into().unwrap(), salt, array![].span(), false,
    )
        .unwrap();
    (addr, IReentrantMockTokenDispatcher { contract_address: addr })
}

fn deploy_mock_pool_harness(salt: felt252) -> (ContractAddress, IMockPoolHarnessDispatcher) {
    let (addr, _) = deploy_syscall(
        MockPoolHarness::TEST_CLASS_HASH.try_into().unwrap(), salt, array![].span(), false,
    )
        .unwrap();
    (addr, IMockPoolHarnessDispatcher { contract_address: addr })
}

fn deploy_conditional_pay(
    pool_address: ContractAddress, salt: felt252,
) -> (ContractAddress, IConditionalPayDispatcher) {
    let mut calldata = ArrayTrait::new();
    calldata.append(pool_address.into());
    let (addr, _) = deploy_syscall(
        ConditionalPay::TEST_CLASS_HASH.try_into().unwrap(), salt, calldata.span(), false,
    )
        .unwrap();
    (addr, IConditionalPayDispatcher { contract_address: addr })
}

fn deploy_test_state_conditional_pay(
    pool_address: ContractAddress, salt: felt252,
) -> (ContractAddress, ITestStateConditionalPayDispatcher) {
    let mut calldata = ArrayTrait::new();
    calldata.append(pool_address.into());
    let (addr, _) = deploy_syscall(
        TestStateConditionalPay::TEST_CLASS_HASH.try_into().unwrap(), salt, calldata.span(), false,
    )
        .unwrap();
    (addr, ITestStateConditionalPayDispatcher { contract_address: addr })
}

// =============================================================================
// CATEGORY 1: FOUNDATION & CONSTANTS (Phase 1A) — 4 Tests
// =============================================================================

#[test]
fn test_state_constants() {
    assert(payment_state::UNINITIALIZED == 0, 'UNINITIALIZED must be 0');
    assert(payment_state::ACTIVE == 1, 'ACTIVE must be 1');
    assert(payment_state::CLAIMED == 2, 'CLAIMED must be 2');
    assert(payment_state::REFUNDED == 3, 'REFUNDED must be 3');
}

#[test]
fn test_domain_constants() {
    assert(domains::CONDITIONALPAY_CLAIM_V1 == 'CONDITIONALPAY_CLAIM_V1', 'Bad claim domain');
    assert(domains::CONDITIONALPAY_REFUND_V1 == 'CONDITIONALPAY_REFUND_V1', 'Bad refund domain');
    assert(domains::CONDITIONALPAY_PAYMENT_V1 == 'CONDITIONALPAY_PAYMENT_V1', 'Bad payment domain');
}

#[test]
fn test_constructor_and_getters() {
    let pool_address: ContractAddress = contract_address(0x123456789);
    let (_, cp) = deploy_conditional_pay(pool_address, 1);

    let stored_pool = cp.get_strk20_pool();
    assert(stored_pool == pool_address, 'Pool address mismatch');

    let payment = cp.get_payment(0x999);
    assert(payment.state == payment_state::UNINITIALIZED, 'State must be 0');
    assert(payment.amount == 0, 'Amount must be 0');
    assert(payment.hashlock == 0, 'Hashlock must be 0');
    assert(payment.refund_hash == 0, 'Refund hash must be 0');
    assert(payment.approved == false, 'Approved must be false');

    let token: ContractAddress = contract_address(0xabc);
    let locked = cp.get_locked_by_token(token);
    assert(locked == 0, 'Initial liability must be 0');
}

#[test]
fn test_constructor_zero_pool_address_reverts() {
    let zero_pool: ContractAddress = contract_address(0x0);
    let mut calldata = ArrayTrait::new();
    calldata.append(zero_pool.into());
    let result = deploy_syscall(
        ConditionalPay::TEST_CLASS_HASH.try_into().unwrap(), 9999, calldata.span(), false,
    );
    assert(result.is_err(), 'Deploy should fail');
    let err_data = result.unwrap_err();
    assert(*err_data.at(0) == 'INVALID_STRK20_POOL', 'Wrong revert reason');
}

#[test]
fn test_constructor_nonzero_pool_address_succeeds() {
    let pool_address: ContractAddress = contract_address(0x123456789);
    let (_, cp) = deploy_conditional_pay(pool_address, 9998);
    assert(cp.get_strk20_pool() == pool_address, 'Pool address mismatch');
}

#[test]
fn test_stored_pool_immutable_through_public_abi() {
    let pool_address: ContractAddress = contract_address(0x987654321);
    let (_, cp) = deploy_conditional_pay(pool_address, 9997);
    assert(cp.get_strk20_pool() == pool_address, 'Pool address mismatch');
}

#[test]
fn test_payment_id_derivation_deterministic() {
    let params1 = CreateParams {
        token: contract_address(0xabc),
        amount: 1000,
        hashlock: 0x111,
        refund_hash: 0x222,
        claim_after: 100,
        expires_at: 200,
        approver: contract_address(0x444),
        nonce: 0x555,
    };
    let id1 = compute_payment_id(@params1);
    let id2 = compute_payment_id(@params1);
    assert(id1 == id2, 'ID must be deterministic');

    let mut params_diff_nonce = params1;
    params_diff_nonce.nonce = 0x556;
    let id_diff_nonce = compute_payment_id(@params_diff_nonce);
    assert(id1 != id_diff_nonce, 'Nonce must change payment ID');

    let mut params_diff_amount = params1;
    params_diff_amount.amount = 1001;
    let id_diff_amount = compute_payment_id(@params_diff_amount);
    assert(id1 != id_diff_amount, 'Amount must change ID');

    let mut params_diff_token = params1;
    params_diff_token.token = contract_address(0xabd);
    let id_diff_token = compute_payment_id(@params_diff_token);
    assert(id1 != id_diff_token, 'Token must change ID');

    let hashlock = compute_hashlock(0x123);
    let refund_hash = compute_refund_hash(0x456);
    assert(hashlock != 0, 'Hashlock must be non-zero');
    assert(refund_hash != 0, 'Refund hash non-zero');
    assert(hashlock != refund_hash, 'Domain separation failed');
}

// =============================================================================
// CATEGORY 2: CREATE FLOW (Phase 1B) — 15 Tests
// =============================================================================

#[test]
fn test_successful_create_and_storage_exactness() {
    let pool_address: ContractAddress = contract_address(0x111);
    let (cp_addr, cp) = deploy_conditional_pay(pool_address, 10);
    let (token_addr, token) = deploy_mock_token(11);

    token.set_balance(cp_addr, 5000);
    set_block_timestamp(50);
    set_contract_address(pool_address);

    let create_params = CreateParams {
        token: token_addr,
        amount: 2000,
        hashlock: 0xaaa,
        refund_hash: 0xbbb,
        claim_after: 100,
        expires_at: 200,
        approver: contract_address(0x999),
        nonce: 0x12345,
    };

    let expected_payment_id = cp.compute_payment_id(create_params);
    let deposits = cp.privacy_invoke(ConditionalPayAction::Create(create_params));

    assert(deposits.len() == 0, 'CREATE must return empty span');

    let payment = cp.get_payment(expected_payment_id);
    assert(payment.token == token_addr, 'Stored token mismatch');
    assert(payment.amount == 2000, 'Stored amount mismatch');
    assert(payment.hashlock == 0xaaa, 'Stored hashlock mismatch');
    assert(payment.refund_hash == 0xbbb, 'Stored refund_hash mismatch');
    assert(payment.claim_after == 100, 'Stored claim_after mismatch');
    assert(payment.expires_at == 200, 'Stored expires_at mismatch');
    assert(payment.approver == contract_address(0x999), 'Stored approver mismatch');
    assert(payment.approved == false, 'Initial approved must be false');
    assert(payment.state == payment_state::ACTIVE, 'Initial state must be ACTIVE');

    let locked = cp.get_locked_by_token(token_addr);
    assert(locked == 2000, 'Locked amount must be 2000');
}

#[test]
fn test_create_with_zero_expiry_succeeds() {
    let pool_address: ContractAddress = contract_address(0x111);
    let (cp_addr, cp) = deploy_conditional_pay(pool_address, 20);
    let (token_addr, token) = deploy_mock_token(21);

    token.set_balance(cp_addr, 1000);
    set_contract_address(pool_address);

    let create_params = CreateParams {
        token: token_addr,
        amount: 1000,
        hashlock: 0xaaa,
        refund_hash: 0xbbb,
        claim_after: 500,
        expires_at: 0,
        approver: contract_address(0x0),
        nonce: 0x111,
    };

    let deposits = cp.privacy_invoke(ConditionalPayAction::Create(create_params));
    assert(deposits.len() == 0, 'Must return empty span');

    let payment_id = cp.compute_payment_id(create_params);
    let payment = cp.get_payment(payment_id);
    assert(payment.state == payment_state::ACTIVE, 'Must be ACTIVE');
    assert(payment.expires_at == 0, 'expires_at must be 0');
}

#[test]
#[should_panic(expected: ('ZERO_AMOUNT', 'ENTRYPOINT_FAILED'))]
fn test_create_reverts_zero_amount() {
    let pool_address: ContractAddress = contract_address(0x111);
    let (cp_addr, cp) = deploy_conditional_pay(pool_address, 30);
    let (token_addr, token) = deploy_mock_token(31);

    token.set_balance(cp_addr, 1000);
    set_contract_address(pool_address);

    let create_params = CreateParams {
        token: token_addr,
        amount: 0,
        hashlock: 0xaaa,
        refund_hash: 0xbbb,
        claim_after: 100,
        expires_at: 200,
        approver: contract_address(0x0),
        nonce: 0x1,
    };

    cp.privacy_invoke(ConditionalPayAction::Create(create_params));
}

#[test]
#[should_panic(expected: ('INVALID_EXPIRY', 'ENTRYPOINT_FAILED'))]
fn test_create_reverts_expires_at_before_claim_after() {
    let pool_address: ContractAddress = contract_address(0x111);
    let (cp_addr, cp) = deploy_conditional_pay(pool_address, 40);
    let (token_addr, token) = deploy_mock_token(41);

    token.set_balance(cp_addr, 1000);
    set_contract_address(pool_address);

    let create_params = CreateParams {
        token: token_addr,
        amount: 500,
        hashlock: 0xaaa,
        refund_hash: 0xbbb,
        claim_after: 200,
        expires_at: 100,
        approver: contract_address(0x0),
        nonce: 0x1,
    };

    cp.privacy_invoke(ConditionalPayAction::Create(create_params));
}

#[test]
#[should_panic(expected: ('INVALID_EXPIRY', 'ENTRYPOINT_FAILED'))]
fn test_create_reverts_expires_at_equal_claim_after() {
    let pool_address: ContractAddress = contract_address(0x111);
    let (cp_addr, cp) = deploy_conditional_pay(pool_address, 50);
    let (token_addr, token) = deploy_mock_token(51);

    token.set_balance(cp_addr, 1000);
    set_contract_address(pool_address);

    let create_params = CreateParams {
        token: token_addr,
        amount: 500,
        hashlock: 0xaaa,
        refund_hash: 0xbbb,
        claim_after: 200,
        expires_at: 200,
        approver: contract_address(0x0),
        nonce: 0x1,
    };

    cp.privacy_invoke(ConditionalPayAction::Create(create_params));
}

#[test]
#[should_panic(expected: ('INVALID_EXPIRY', 'ENTRYPOINT_FAILED'))]
fn test_create_reverts_expired_at_creation() {
    let pool_address: ContractAddress = contract_address(0x111);
    let (cp_addr, cp) = deploy_conditional_pay(pool_address, 60);
    let (token_addr, token) = deploy_mock_token(61);

    token.set_balance(cp_addr, 1000);
    set_block_timestamp(500);
    set_contract_address(pool_address);

    let create_params = CreateParams {
        token: token_addr,
        amount: 500,
        hashlock: 0xaaa,
        refund_hash: 0xbbb,
        claim_after: 100,
        expires_at: 400,
        approver: contract_address(0x0),
        nonce: 0x1,
    };

    cp.privacy_invoke(ConditionalPayAction::Create(create_params));
}

#[test]
#[should_panic(expected: ('PAYMENT_ALREADY_EXISTS', 'ENTRYPOINT_FAILED'))]
fn test_create_reverts_duplicate_payment_id() {
    let pool_address: ContractAddress = contract_address(0x111);
    let (cp_addr, cp) = deploy_conditional_pay(pool_address, 70);
    let (token_addr, token) = deploy_mock_token(71);

    token.set_balance(cp_addr, 5000);
    set_contract_address(pool_address);

    let create_params = CreateParams {
        token: token_addr,
        amount: 1000,
        hashlock: 0xaaa,
        refund_hash: 0xbbb,
        claim_after: 100,
        expires_at: 200,
        approver: contract_address(0x0),
        nonce: 0x1,
    };

    cp.privacy_invoke(ConditionalPayAction::Create(create_params));
    cp.privacy_invoke(ConditionalPayAction::Create(create_params));
}

#[test]
#[should_panic(expected: ('INSUFFICIENT_BALANCE', 'ENTRYPOINT_FAILED'))]
fn test_create_reverts_underfunded_contract() {
    let pool_address: ContractAddress = contract_address(0x111);
    let (cp_addr, cp) = deploy_conditional_pay(pool_address, 80);
    let (token_addr, token) = deploy_mock_token(81);

    token.set_balance(cp_addr, 500);
    set_contract_address(pool_address);

    let create_params = CreateParams {
        token: token_addr,
        amount: 1000,
        hashlock: 0xaaa,
        refund_hash: 0xbbb,
        claim_after: 100,
        expires_at: 200,
        approver: contract_address(0x0),
        nonce: 0x1,
    };

    cp.privacy_invoke(ConditionalPayAction::Create(create_params));
}

#[test]
fn test_exact_and_overfunded_balance_accounting() {
    let pool_address: ContractAddress = contract_address(0x111);
    let (cp_addr, cp) = deploy_conditional_pay(pool_address, 90);
    let (token_addr, token) = deploy_mock_token(91);

    token.set_balance(cp_addr, 1000);
    set_contract_address(pool_address);

    let p1 = CreateParams {
        token: token_addr,
        amount: 1000,
        hashlock: 0x111,
        refund_hash: 0x222,
        claim_after: 100,
        expires_at: 200,
        approver: contract_address(0x0),
        nonce: 1,
    };
    cp.privacy_invoke(ConditionalPayAction::Create(p1));
    assert(cp.get_locked_by_token(token_addr) == 1000, 'Locked must be 1000');

    token.set_balance(cp_addr, 3500);
    let p2 = CreateParams {
        token: token_addr,
        amount: 1500,
        hashlock: 0x333,
        refund_hash: 0x444,
        claim_after: 100,
        expires_at: 200,
        approver: contract_address(0x0),
        nonce: 2,
    };
    cp.privacy_invoke(ConditionalPayAction::Create(p2));
    assert(cp.get_locked_by_token(token_addr) == 2500, 'Locked must be 2500');
    assert(cp.get_locked_by_token(token_addr) <= 3500, 'Solvency invariant failed');
}

#[test]
fn test_multi_token_liability_isolation() {
    let pool_address: ContractAddress = contract_address(0x111);
    let (cp_addr, cp) = deploy_conditional_pay(pool_address, 100);
    let (token_a, token_a_ctrl) = deploy_mock_token(101);
    let (token_b, token_b_ctrl) = deploy_mock_token(102);

    token_a_ctrl.set_balance(cp_addr, 2000);
    token_b_ctrl.set_balance(cp_addr, 5000);

    set_contract_address(pool_address);

    let pa = CreateParams {
        token: token_a,
        amount: 1200,
        hashlock: 0x111,
        refund_hash: 0x222,
        claim_after: 100,
        expires_at: 200,
        approver: contract_address(0x0),
        nonce: 1,
    };
    cp.privacy_invoke(ConditionalPayAction::Create(pa));

    let pb = CreateParams {
        token: token_b,
        amount: 3400,
        hashlock: 0x333,
        refund_hash: 0x444,
        claim_after: 100,
        expires_at: 200,
        approver: contract_address(0x0),
        nonce: 2,
    };
    cp.privacy_invoke(ConditionalPayAction::Create(pb));

    assert(cp.get_locked_by_token(token_a) == 1200, 'Token A liability mismatch');
    assert(cp.get_locked_by_token(token_b) == 3400, 'Token B liability mismatch');
}

#[test]
#[should_panic(expected: ('CALLER_NOT_POOL', 'ENTRYPOINT_FAILED'))]
fn test_privacy_invoke_create_reverts_if_not_pool() {
    let pool_address: ContractAddress = contract_address(0x111);
    let (cp_addr, cp) = deploy_conditional_pay(pool_address, 110);
    let (token_addr, token) = deploy_mock_token(111);

    token.set_balance(cp_addr, 1000);
    set_contract_address(contract_address(0xbad));

    let create_params = CreateParams {
        token: token_addr,
        amount: 1000,
        hashlock: 0x111,
        refund_hash: 0x222,
        claim_after: 100,
        expires_at: 200,
        approver: contract_address(0x0),
        nonce: 1,
    };

    cp.privacy_invoke(ConditionalPayAction::Create(create_params));
}

#[test]
fn test_failed_create_does_not_mutate_state_or_liabilities() {
    let pool_address: ContractAddress = contract_address(0x111);
    let (cp_addr, cp) = deploy_conditional_pay(pool_address, 140);
    let (token_addr, token) = deploy_mock_token(141);

    token.set_balance(cp_addr, 1000);
    set_contract_address(pool_address);

    let valid_p = CreateParams {
        token: token_addr,
        amount: 400,
        hashlock: 0x111,
        refund_hash: 0x222,
        claim_after: 100,
        expires_at: 200,
        approver: contract_address(0x0),
        nonce: 1,
    };
    cp.privacy_invoke(ConditionalPayAction::Create(valid_p));
    assert(cp.get_locked_by_token(token_addr) == 400, 'Baseline locked must be 400');

    let uncreated_id = cp
        .compute_payment_id(
            CreateParams {
                token: token_addr,
                amount: 700,
                hashlock: 0x333,
                refund_hash: 0x444,
                claim_after: 100,
                expires_at: 200,
                approver: contract_address(0x0),
                nonce: 2,
            },
        );
    let payment = cp.get_payment(uncreated_id);
    assert(payment.state == payment_state::UNINITIALIZED, 'State must be UNINITIALIZED');
    assert(cp.get_locked_by_token(token_addr) == 400, 'Locked must remain 400');
}

#[test]
fn test_solvency_invariant_multi_create() {
    let pool_address: ContractAddress = contract_address(0x111);
    let (cp_addr, cp) = deploy_conditional_pay(pool_address, 150);
    let (token_addr, token) = deploy_mock_token(151);

    token.set_balance(cp_addr, 10000);
    set_contract_address(pool_address);

    let p1 = CreateParams {
        token: token_addr,
        amount: 2000,
        hashlock: 0x111,
        refund_hash: 0x222,
        claim_after: 10,
        expires_at: 100,
        approver: contract_address(0x0),
        nonce: 1,
    };
    let p2 = CreateParams {
        token: token_addr,
        amount: 3000,
        hashlock: 0x333,
        refund_hash: 0x444,
        claim_after: 20,
        expires_at: 200,
        approver: contract_address(0x0),
        nonce: 2,
    };
    let p3 = CreateParams {
        token: token_addr,
        amount: 4000,
        hashlock: 0x555,
        refund_hash: 0x666,
        claim_after: 30,
        expires_at: 300,
        approver: contract_address(0x0),
        nonce: 3,
    };

    cp.privacy_invoke(ConditionalPayAction::Create(p1));
    cp.privacy_invoke(ConditionalPayAction::Create(p2));
    cp.privacy_invoke(ConditionalPayAction::Create(p3));

    let total_locked = cp.get_locked_by_token(token_addr);
    assert(total_locked == 9000, 'Total locked should be 9000');
    assert(total_locked <= 10000, 'Solvency invariant broken');
}

#[test]
fn test_create_funding_order_realistic() {
    let pool_address: ContractAddress = contract_address(0x111);
    let (cp_addr, cp) = deploy_conditional_pay(pool_address, 160);
    let (token_addr, token) = deploy_mock_token(161);

    assert(token.balance_of(cp_addr) == 0, 'Initial balance must be 0');
    assert(cp.get_locked_by_token(token_addr) == 0, 'Initial locked must be 0');

    let create_params = CreateParams {
        token: token_addr,
        amount: 1500,
        hashlock: 0x111,
        refund_hash: 0x222,
        claim_after: 50,
        expires_at: 500,
        approver: contract_address(0x0),
        nonce: 0x999,
    };

    token.set_balance(cp_addr, 1500);
    assert(token.balance_of(cp_addr) == 1500, 'Funded balance must be 1500');

    set_contract_address(pool_address);
    let deposits = cp.privacy_invoke(ConditionalPayAction::Create(create_params));

    assert(deposits.len() == 0, 'Must return empty span');

    let payment_id = cp.compute_payment_id(create_params);
    let payment = cp.get_payment(payment_id);
    assert(payment.state == payment_state::ACTIVE, 'Payment must be ACTIVE');
    assert(payment.amount == 1500, 'Payment amount must be 1500');

    let locked = cp.get_locked_by_token(token_addr);
    assert(locked == 1500, 'Liability must be 1500');
    assert(token.balance_of(cp_addr) >= locked.into(), 'Balance must cover liability');
}

#[test]
#[should_panic(expected: ('INSUFFICIENT_BALANCE', 'ENTRYPOINT_FAILED'))]
fn test_create_without_preceding_funding_reverts() {
    let pool_address: ContractAddress = contract_address(0x111);
    let (cp_addr, cp) = deploy_conditional_pay(pool_address, 170);
    let (token_addr, token) = deploy_mock_token(171);

    assert(token.balance_of(cp_addr) == 0, 'Balance must be 0');

    set_contract_address(pool_address);
    let create_params = CreateParams {
        token: token_addr,
        amount: 1500,
        hashlock: 0x111,
        refund_hash: 0x222,
        claim_after: 50,
        expires_at: 500,
        approver: contract_address(0x0),
        nonce: 0x999,
    };

    cp.privacy_invoke(ConditionalPayAction::Create(create_params));
}

// =============================================================================
// CATEGORY 3: ABI / SERDE ENCODING (Phase 1A & 1B) — 3 Tests
// =============================================================================

#[test]
fn test_serde_actions() {
    let create_params = CreateParams {
        token: contract_address(0xabc),
        amount: 5000,
        hashlock: 0x111,
        refund_hash: 0x222,
        claim_after: 100,
        expires_at: 200,
        approver: contract_address(0x444),
        nonce: 0x555,
    };
    let action_create = ConditionalPayAction::Create(create_params);
    let mut serialized = ArrayTrait::new();
    action_create.serialize(ref serialized);
    let mut span = serialized.span();
    let deserialized: ConditionalPayAction = Serde::deserialize(ref span).unwrap();
    assert(deserialized == action_create, 'Serde Create mismatch');
    assert(span.len() == 0, 'Create left trailing data');

    let claim_params = ClaimParams { payment_id: 0xaaa, claim_preimage: 0xbbb, note_id: 0xccc };
    let action_claim = ConditionalPayAction::Claim(claim_params);
    let mut serialized = ArrayTrait::new();
    action_claim.serialize(ref serialized);
    let mut span = serialized.span();
    let deserialized: ConditionalPayAction = Serde::deserialize(ref span).unwrap();
    assert(deserialized == action_claim, 'Serde Claim mismatch');
    assert(span.len() == 0, 'Claim left trailing data');

    let refund_params = RefundParams { payment_id: 0xaaa, refund_preimage: 0xbbb, note_id: 0xccc };
    let action_refund = ConditionalPayAction::Refund(refund_params);
    let mut serialized = ArrayTrait::new();
    action_refund.serialize(ref serialized);
    let mut span = serialized.span();
    let deserialized: ConditionalPayAction = Serde::deserialize(ref span).unwrap();
    assert(deserialized == action_refund, 'Serde Refund mismatch');
    assert(span.len() == 0, 'Refund left trailing data');
}

#[test]
fn test_open_note_deposit_exact_serde_layout() {
    let deposit = OpenNoteDeposit { note_id: 0x101, token: contract_address(0x202), amount: 0x303 };
    let mut serialized = ArrayTrait::new();
    deposit.serialize(ref serialized);

    assert(serialized.len() == 3, 'Deposit must be 3 felts');
    assert(*serialized.at(0) == 0x101, 'note_id mismatch');
    assert(*serialized.at(1) == 0x202, 'token mismatch');
    assert(*serialized.at(2) == 0x303, 'amount mismatch');

    let deposits = array![deposit].span();
    let mut span_serialized = ArrayTrait::new();
    deposits.serialize(ref span_serialized);

    assert(span_serialized.len() == 4, 'Span must be 4 felts');
    assert(*span_serialized.at(0) == 1, 'Span length prefix must be 1');
    assert(*span_serialized.at(1) == 0x101, 'Span note_id mismatch');
    assert(*span_serialized.at(2) == 0x202, 'Span token mismatch');
    assert(*span_serialized.at(3) == 0x303, 'Span amount mismatch');

    let empty_deposits: Span<OpenNoteDeposit> = array![].span();
    let mut empty_serialized = ArrayTrait::new();
    empty_deposits.serialize(ref empty_serialized);
    assert(empty_serialized.len() == 1, 'Empty span must be 1 felt');
    assert(*empty_serialized.at(0) == 0, 'Empty span length must be 0');
}

#[test]
fn test_enum_discriminant_calldata_decoding() {
    let mut raw_create = array![0, 0xabc, 1000, 0x111, 0x222, 100, 200, 0x444, 0x555];
    let mut span_create = raw_create.span();
    let action_create: ConditionalPayAction = Serde::deserialize(ref span_create).unwrap();
    assert(span_create.len() == 0, 'Create calldata not consumed');
    match action_create {
        ConditionalPayAction::Create(params) => {
            assert(params.token == contract_address(0xabc), 'Bad token');
            assert(params.amount == 1000, 'Bad amount');
            assert(params.hashlock == 0x111, 'Bad hashlock');
            assert(params.refund_hash == 0x222, 'Bad refund_hash');
            assert(params.claim_after == 100, 'Bad claim_after');
            assert(params.expires_at == 200, 'Bad expires_at');
            assert(params.approver == contract_address(0x444), 'Bad approver');
            assert(params.nonce == 0x555, 'Bad nonce');
        },
        _ => panic_with_felt252('Expected Create variant'),
    }

    let mut raw_claim = array![1, 0xaaa, 0xbbb, 0xccc];
    let mut span_claim = raw_claim.span();
    let action_claim: ConditionalPayAction = Serde::deserialize(ref span_claim).unwrap();
    assert(span_claim.len() == 0, 'Claim calldata not consumed');
    match action_claim {
        ConditionalPayAction::Claim(params) => {
            assert(params.payment_id == 0xaaa, 'Bad payment_id');
            assert(params.claim_preimage == 0xbbb, 'Bad claim_preimage');
            assert(params.note_id == 0xccc, 'Bad note_id');
        },
        _ => panic_with_felt252('Expected Claim variant'),
    }

    let mut raw_refund = array![2, 0xaaa, 0xbbb, 0xccc];
    let mut span_refund = raw_refund.span();
    let action_refund: ConditionalPayAction = Serde::deserialize(ref span_refund).unwrap();
    assert(span_refund.len() == 0, 'Refund calldata not consumed');
    match action_refund {
        ConditionalPayAction::Refund(params) => {
            assert(params.payment_id == 0xaaa, 'Bad payment_id');
            assert(params.refund_preimage == 0xbbb, 'Bad refund_preimage');
            assert(params.note_id == 0xccc, 'Bad note_id');
        },
        _ => panic_with_felt252('Expected Refund variant'),
    }
}

// =============================================================================
// CATEGORY 4: CLAIM FLOW (Phase 1C) — 23 Tests
// =============================================================================

#[test]
fn test_successful_claim_flow() {
    let pool_address: ContractAddress = contract_address(0x111);
    let (cp_addr, cp) = deploy_conditional_pay(pool_address, 200);
    let (token_addr, token) = deploy_mock_token(201);

    token.set_balance(cp_addr, 5000);
    set_block_timestamp(50);
    set_contract_address(pool_address);

    let claim_secret = 0x123456;
    let hashlock = compute_hashlock(claim_secret);
    let refund_hash = compute_refund_hash(0x654321);

    let create_params = CreateParams {
        token: token_addr,
        amount: 1800,
        hashlock,
        refund_hash,
        claim_after: 100,
        expires_at: 300,
        approver: contract_address(0x0),
        nonce: 0x111,
    };
    let payment_id = cp.compute_payment_id(create_params);
    cp.privacy_invoke(ConditionalPayAction::Create(create_params));

    assert(cp.get_locked_by_token(token_addr) == 1800, 'Pre-claim locked != 1800');

    set_block_timestamp(150);

    let open_note_id = 0x9999;
    let claim_params = ClaimParams {
        payment_id, claim_preimage: claim_secret, note_id: open_note_id,
    };

    let deposits = cp.privacy_invoke(ConditionalPayAction::Claim(claim_params));

    assert(deposits.len() == 1, 'Must return 1 deposit note');
    let deposit = *deposits.at(0);
    assert(deposit.note_id == open_note_id, 'Returned note_id mismatch');
    assert(deposit.token == token_addr, 'Returned token mismatch');
    assert(deposit.amount == 1800, 'Returned amount mismatch');

    let payment = cp.get_payment(payment_id);
    assert(payment.state == payment_state::CLAIMED, 'State must be CLAIMED');
    assert(cp.get_locked_by_token(token_addr) == 0, 'Post-claim locked must be 0');

    let allowance = token.allowance(cp_addr, pool_address);
    assert(allowance == 1800, 'Allowance to pool != 1800');
}

#[test]
#[should_panic(expected: ('INVALID_CLAIM_SECRET', 'ENTRYPOINT_FAILED'))]
fn test_claim_wrong_preimage_reverts() {
    let pool_address: ContractAddress = contract_address(0x111);
    let (cp_addr, cp) = deploy_conditional_pay(pool_address, 210);
    let (token_addr, token) = deploy_mock_token(211);

    token.set_balance(cp_addr, 2000);
    set_block_timestamp(50);
    set_contract_address(pool_address);

    let claim_secret = 0x123456;
    let hashlock = compute_hashlock(claim_secret);

    let create_params = CreateParams {
        token: token_addr,
        amount: 1000,
        hashlock,
        refund_hash: 0x222,
        claim_after: 100,
        expires_at: 300,
        approver: contract_address(0x0),
        nonce: 0x1,
    };
    let payment_id = cp.compute_payment_id(create_params);
    cp.privacy_invoke(ConditionalPayAction::Create(create_params));

    set_block_timestamp(150);
    let claim_params = ClaimParams { payment_id, claim_preimage: 0x999888, note_id: 0x1 };

    cp.privacy_invoke(ConditionalPayAction::Claim(claim_params));
}

#[test]
#[should_panic(expected: ('INVALID_CLAIM_SECRET', 'ENTRYPOINT_FAILED'))]
fn test_claim_refund_preimage_fails_due_to_domain_separation() {
    let pool_address: ContractAddress = contract_address(0x111);
    let (cp_addr, cp) = deploy_conditional_pay(pool_address, 220);
    let (token_addr, token) = deploy_mock_token(221);

    token.set_balance(cp_addr, 2000);
    set_block_timestamp(50);
    set_contract_address(pool_address);

    let shared_secret = 0xabcdef;
    let hashlock = compute_hashlock(shared_secret);
    let refund_hash = compute_refund_hash(shared_secret);

    let create_params = CreateParams {
        token: token_addr,
        amount: 1000,
        hashlock,
        refund_hash,
        claim_after: 100,
        expires_at: 300,
        approver: contract_address(0x0),
        nonce: 0x1,
    };
    let payment_id = cp.compute_payment_id(create_params);
    cp.privacy_invoke(ConditionalPayAction::Create(create_params));

    set_block_timestamp(150);

    let claim_params = ClaimParams { payment_id, claim_preimage: refund_hash, note_id: 0x1 };

    cp.privacy_invoke(ConditionalPayAction::Claim(claim_params));
}

#[test]
#[should_panic(expected: ('CLAIM_TOO_EARLY', 'ENTRYPOINT_FAILED'))]
fn test_claim_before_claim_after_reverts() {
    let pool_address: ContractAddress = contract_address(0x111);
    let (cp_addr, cp) = deploy_conditional_pay(pool_address, 230);
    let (token_addr, token) = deploy_mock_token(231);

    token.set_balance(cp_addr, 2000);
    set_block_timestamp(50);
    set_contract_address(pool_address);

    let claim_secret = 0x123456;
    let hashlock = compute_hashlock(claim_secret);

    let create_params = CreateParams {
        token: token_addr,
        amount: 1000,
        hashlock,
        refund_hash: 0x222,
        claim_after: 100,
        expires_at: 300,
        approver: contract_address(0x0),
        nonce: 0x1,
    };
    let payment_id = cp.compute_payment_id(create_params);
    cp.privacy_invoke(ConditionalPayAction::Create(create_params));

    set_block_timestamp(99);
    let claim_params = ClaimParams { payment_id, claim_preimage: claim_secret, note_id: 0x1 };

    cp.privacy_invoke(ConditionalPayAction::Claim(claim_params));
}

#[test]
fn test_claim_exactly_at_claim_after_succeeds() {
    let pool_address: ContractAddress = contract_address(0x111);
    let (cp_addr, cp) = deploy_conditional_pay(pool_address, 240);
    let (token_addr, token) = deploy_mock_token(241);

    token.set_balance(cp_addr, 2000);
    set_block_timestamp(50);
    set_contract_address(pool_address);

    let claim_secret = 0x123456;
    let hashlock = compute_hashlock(claim_secret);

    let create_params = CreateParams {
        token: token_addr,
        amount: 1000,
        hashlock,
        refund_hash: 0x222,
        claim_after: 100,
        expires_at: 300,
        approver: contract_address(0x0),
        nonce: 0x1,
    };
    let payment_id = cp.compute_payment_id(create_params);
    cp.privacy_invoke(ConditionalPayAction::Create(create_params));

    set_block_timestamp(100);
    let claim_params = ClaimParams { payment_id, claim_preimage: claim_secret, note_id: 0x1 };

    let deposits = cp.privacy_invoke(ConditionalPayAction::Claim(claim_params));
    assert(deposits.len() == 1, 'Claim at boundary must succeed');
    assert(cp.get_payment(payment_id).state == payment_state::CLAIMED, 'Must be CLAIMED');
}

#[test]
fn test_claim_before_expiry_succeeds() {
    let pool_address: ContractAddress = contract_address(0x111);
    let (cp_addr, cp) = deploy_conditional_pay(pool_address, 250);
    let (token_addr, token) = deploy_mock_token(251);

    token.set_balance(cp_addr, 2000);
    set_block_timestamp(50);
    set_contract_address(pool_address);

    let claim_secret = 0x123456;
    let hashlock = compute_hashlock(claim_secret);

    let create_params = CreateParams {
        token: token_addr,
        amount: 1000,
        hashlock,
        refund_hash: 0x222,
        claim_after: 100,
        expires_at: 300,
        approver: contract_address(0x0),
        nonce: 0x1,
    };
    let payment_id = cp.compute_payment_id(create_params);
    cp.privacy_invoke(ConditionalPayAction::Create(create_params));

    set_block_timestamp(299);
    let claim_params = ClaimParams { payment_id, claim_preimage: claim_secret, note_id: 0x1 };

    let deposits = cp.privacy_invoke(ConditionalPayAction::Claim(claim_params));
    assert(deposits.len() == 1, 'Claim before expiry must pass');
}

#[test]
#[should_panic(expected: ('PAYMENT_EXPIRED', 'ENTRYPOINT_FAILED'))]
fn test_claim_exactly_at_expiry_reverts() {
    let pool_address: ContractAddress = contract_address(0x111);
    let (cp_addr, cp) = deploy_conditional_pay(pool_address, 260);
    let (token_addr, token) = deploy_mock_token(261);

    token.set_balance(cp_addr, 2000);
    set_block_timestamp(50);
    set_contract_address(pool_address);

    let claim_secret = 0x123456;
    let hashlock = compute_hashlock(claim_secret);

    let create_params = CreateParams {
        token: token_addr,
        amount: 1000,
        hashlock,
        refund_hash: 0x222,
        claim_after: 100,
        expires_at: 300,
        approver: contract_address(0x0),
        nonce: 0x1,
    };
    let payment_id = cp.compute_payment_id(create_params);
    cp.privacy_invoke(ConditionalPayAction::Create(create_params));

    set_block_timestamp(300);
    let claim_params = ClaimParams { payment_id, claim_preimage: claim_secret, note_id: 0x1 };

    cp.privacy_invoke(ConditionalPayAction::Claim(claim_params));
}

#[test]
#[should_panic(expected: ('PAYMENT_EXPIRED', 'ENTRYPOINT_FAILED'))]
fn test_claim_after_expiry_reverts() {
    let pool_address: ContractAddress = contract_address(0x111);
    let (cp_addr, cp) = deploy_conditional_pay(pool_address, 270);
    let (token_addr, token) = deploy_mock_token(271);

    token.set_balance(cp_addr, 2000);
    set_block_timestamp(50);
    set_contract_address(pool_address);

    let claim_secret = 0x123456;
    let hashlock = compute_hashlock(claim_secret);

    let create_params = CreateParams {
        token: token_addr,
        amount: 1000,
        hashlock,
        refund_hash: 0x222,
        claim_after: 100,
        expires_at: 300,
        approver: contract_address(0x0),
        nonce: 0x1,
    };
    let payment_id = cp.compute_payment_id(create_params);
    cp.privacy_invoke(ConditionalPayAction::Create(create_params));

    set_block_timestamp(301);
    let claim_params = ClaimParams { payment_id, claim_preimage: claim_secret, note_id: 0x1 };

    cp.privacy_invoke(ConditionalPayAction::Claim(claim_params));
}

#[test]
fn test_claim_no_expiry_payment_succeeds_at_any_future_time() {
    let pool_address: ContractAddress = contract_address(0x111);
    let (cp_addr, cp) = deploy_conditional_pay(pool_address, 280);
    let (token_addr, token) = deploy_mock_token(281);

    token.set_balance(cp_addr, 2000);
    set_block_timestamp(50);
    set_contract_address(pool_address);

    let claim_secret = 0x123456;
    let hashlock = compute_hashlock(claim_secret);

    let create_params = CreateParams {
        token: token_addr,
        amount: 1000,
        hashlock,
        refund_hash: 0x222,
        claim_after: 100,
        expires_at: 0,
        approver: contract_address(0x0),
        nonce: 0x1,
    };
    let payment_id = cp.compute_payment_id(create_params);
    cp.privacy_invoke(ConditionalPayAction::Create(create_params));

    set_block_timestamp(999999);
    let claim_params = ClaimParams { payment_id, claim_preimage: claim_secret, note_id: 0x1 };

    let deposits = cp.privacy_invoke(ConditionalPayAction::Claim(claim_params));
    assert(deposits.len() == 1, 'Must succeed with no expiry');
    assert(cp.get_payment(payment_id).state == payment_state::CLAIMED, 'Must be CLAIMED');
}

#[test]
#[should_panic(expected: ('PAYMENT_NOT_ACTIVE', 'ENTRYPOINT_FAILED'))]
fn test_claim_uninitialized_payment_reverts() {
    let pool_address: ContractAddress = contract_address(0x111);
    let (_, cp) = deploy_conditional_pay(pool_address, 290);

    set_contract_address(pool_address);
    let claim_params = ClaimParams { payment_id: 0x123999, claim_preimage: 0x123, note_id: 0x1 };

    cp.privacy_invoke(ConditionalPayAction::Claim(claim_params));
}

#[test]
#[should_panic(expected: ('PAYMENT_NOT_ACTIVE', 'ENTRYPOINT_FAILED'))]
fn test_replayed_claim_reverts_and_cannot_reduce_liability_twice() {
    let pool_address: ContractAddress = contract_address(0x111);
    let (cp_addr, cp) = deploy_conditional_pay(pool_address, 300);
    let (token_addr, token) = deploy_mock_token(301);

    token.set_balance(cp_addr, 2000);
    set_block_timestamp(50);
    set_contract_address(pool_address);

    let claim_secret = 0x123456;
    let hashlock = compute_hashlock(claim_secret);

    let create_params = CreateParams {
        token: token_addr,
        amount: 1000,
        hashlock,
        refund_hash: 0x222,
        claim_after: 100,
        expires_at: 300,
        approver: contract_address(0x0),
        nonce: 0x1,
    };
    let payment_id = cp.compute_payment_id(create_params);
    cp.privacy_invoke(ConditionalPayAction::Create(create_params));

    set_block_timestamp(150);
    let claim_params = ClaimParams { payment_id, claim_preimage: claim_secret, note_id: 0x1 };

    cp.privacy_invoke(ConditionalPayAction::Claim(claim_params));
    assert(cp.get_locked_by_token(token_addr) == 0, 'Liability must be 0');

    cp.privacy_invoke(ConditionalPayAction::Claim(claim_params));
}

#[test]
#[should_panic(expected: ('APPROVAL_REQUIRED', 'ENTRYPOINT_FAILED'))]
fn test_claim_with_configured_approver_and_unapproved_reverts() {
    let pool_address: ContractAddress = contract_address(0x111);
    let (cp_addr, cp) = deploy_conditional_pay(pool_address, 310);
    let (token_addr, token) = deploy_mock_token(311);

    token.set_balance(cp_addr, 2000);
    set_block_timestamp(50);
    set_contract_address(pool_address);

    let claim_secret = 0x123456;
    let hashlock = compute_hashlock(claim_secret);
    let approver_address = contract_address(0x888);

    let create_params = CreateParams {
        token: token_addr,
        amount: 1000,
        hashlock,
        refund_hash: 0x222,
        claim_after: 100,
        expires_at: 300,
        approver: approver_address,
        nonce: 0x1,
    };
    let payment_id = cp.compute_payment_id(create_params);
    cp.privacy_invoke(ConditionalPayAction::Create(create_params));

    set_block_timestamp(150);
    let claim_params = ClaimParams { payment_id, claim_preimage: claim_secret, note_id: 0x1 };

    cp.privacy_invoke(ConditionalPayAction::Claim(claim_params));
}

#[test]
#[should_panic(expected: ('CALLER_NOT_POOL', 'ENTRYPOINT_FAILED'))]
fn test_claim_unauthorized_caller_reverts() {
    let pool_address: ContractAddress = contract_address(0x111);
    let (cp_addr, cp) = deploy_conditional_pay(pool_address, 320);
    let (token_addr, token) = deploy_mock_token(321);

    token.set_balance(cp_addr, 2000);
    set_block_timestamp(50);
    set_contract_address(pool_address);

    let claim_secret = 0x123456;
    let hashlock = compute_hashlock(claim_secret);

    let create_params = CreateParams {
        token: token_addr,
        amount: 1000,
        hashlock,
        refund_hash: 0x222,
        claim_after: 100,
        expires_at: 300,
        approver: contract_address(0x0),
        nonce: 0x1,
    };
    let payment_id = cp.compute_payment_id(create_params);
    cp.privacy_invoke(ConditionalPayAction::Create(create_params));

    set_block_timestamp(150);
    set_contract_address(contract_address(0xbad));
    let claim_params = ClaimParams { payment_id, claim_preimage: claim_secret, note_id: 0x1 };

    cp.privacy_invoke(ConditionalPayAction::Claim(claim_params));
}

#[test]
fn test_multi_token_claim_liability_isolation() {
    let pool_address: ContractAddress = contract_address(0x111);
    let (cp_addr, cp) = deploy_conditional_pay(pool_address, 330);
    let (token_a, token_a_ctrl) = deploy_mock_token(331);
    let (token_b, token_b_ctrl) = deploy_mock_token(332);

    token_a_ctrl.set_balance(cp_addr, 5000);
    token_b_ctrl.set_balance(cp_addr, 5000);
    set_block_timestamp(50);
    set_contract_address(pool_address);

    let secret_a = 0x111aaa;
    let secret_b = 0x222bbb;

    let pa = CreateParams {
        token: token_a,
        amount: 1500,
        hashlock: compute_hashlock(secret_a),
        refund_hash: 0x111,
        claim_after: 100,
        expires_at: 300,
        approver: contract_address(0x0),
        nonce: 1,
    };
    let id_a = cp.compute_payment_id(pa);
    cp.privacy_invoke(ConditionalPayAction::Create(pa));

    let pb = CreateParams {
        token: token_b,
        amount: 2500,
        hashlock: compute_hashlock(secret_b),
        refund_hash: 0x222,
        claim_after: 100,
        expires_at: 300,
        approver: contract_address(0x0),
        nonce: 2,
    };
    let _id_b = cp.compute_payment_id(pb);
    cp.privacy_invoke(ConditionalPayAction::Create(pb));

    assert(cp.get_locked_by_token(token_a) == 1500, 'Locked A != 1500');
    assert(cp.get_locked_by_token(token_b) == 2500, 'Locked B != 2500');

    set_block_timestamp(150);
    cp
        .privacy_invoke(
            ConditionalPayAction::Claim(
                ClaimParams { payment_id: id_a, claim_preimage: secret_a, note_id: 0xa },
            ),
        );

    assert(cp.get_locked_by_token(token_a) == 0, 'Locked A must be 0');
    assert(cp.get_locked_by_token(token_b) == 2500, 'Locked B must remain 2500');
}

#[test]
fn test_claimed_terminal_state_and_solvency_invariant() {
    let pool_address: ContractAddress = contract_address(0x111);
    let (cp_addr, cp) = deploy_conditional_pay(pool_address, 340);
    let (token_addr, token) = deploy_mock_token(341);

    token.set_balance(cp_addr, 10000);
    set_block_timestamp(50);
    set_contract_address(pool_address);

    let secret1 = 0x111;
    let secret2 = 0x222;

    let p1 = CreateParams {
        token: token_addr,
        amount: 3000,
        hashlock: compute_hashlock(secret1),
        refund_hash: 0x1,
        claim_after: 100,
        expires_at: 400,
        approver: contract_address(0x0),
        nonce: 1,
    };
    let id1 = cp.compute_payment_id(p1);
    cp.privacy_invoke(ConditionalPayAction::Create(p1));

    let p2 = CreateParams {
        token: token_addr,
        amount: 4000,
        hashlock: compute_hashlock(secret2),
        refund_hash: 0x2,
        claim_after: 100,
        expires_at: 400,
        approver: contract_address(0x0),
        nonce: 2,
    };
    let id2 = cp.compute_payment_id(p2);
    cp.privacy_invoke(ConditionalPayAction::Create(p2));

    assert(cp.get_locked_by_token(token_addr) == 7000, 'Initial locked != 7000');

    set_block_timestamp(200);
    cp
        .privacy_invoke(
            ConditionalPayAction::Claim(
                ClaimParams { payment_id: id1, claim_preimage: secret1, note_id: 0x10 },
            ),
        );

    let locked_after_claim1 = cp.get_locked_by_token(token_addr);
    assert(locked_after_claim1 == 4000, 'Locked after claim != 4000');
    assert(
        locked_after_claim1 <= token.balance_of(cp_addr).try_into().unwrap(),
        'Solvency invariant failed',
    );

    assert(cp.get_payment(id1).state == payment_state::CLAIMED, 'P1 must be CLAIMED');
    assert(cp.get_payment(id2).state == payment_state::ACTIVE, 'P2 must remain ACTIVE');
}

#[test]
fn test_full_settlement_transaction_boundary_simulation() {
    let pool_address: ContractAddress = contract_address(0x111);
    let (cp_addr, cp) = deploy_conditional_pay(pool_address, 400);
    let (token_addr, token) = deploy_mock_token(401);

    token.set_balance(cp_addr, 2000);
    set_block_timestamp(50);
    set_contract_address(pool_address);

    let claim_secret = 0x555666;
    let hashlock = compute_hashlock(claim_secret);
    let create_params = CreateParams {
        token: token_addr,
        amount: 2000,
        hashlock,
        refund_hash: 0x111,
        claim_after: 100,
        expires_at: 300,
        approver: contract_address(0x0),
        nonce: 0x1,
    };
    let payment_id = cp.compute_payment_id(create_params);
    cp.privacy_invoke(ConditionalPayAction::Create(create_params));

    assert(cp.get_locked_by_token(token_addr) == 2000, 'Pre-claim locked != 2000');
    assert(token.balance_of(cp_addr) == 2000, 'Pre-claim balance != 2000');

    set_block_timestamp(150);
    let open_note_id = 0x777;
    let deposits = cp
        .privacy_invoke(
            ConditionalPayAction::Claim(
                ClaimParams { payment_id, claim_preimage: claim_secret, note_id: open_note_id },
            ),
        );

    assert(deposits.len() == 1, 'Must return 1 deposit note');
    assert(cp.get_payment(payment_id).state == payment_state::CLAIMED, 'State != CLAIMED');
    assert(cp.get_locked_by_token(token_addr) == 0, 'Locked != 0');
    assert(token.allowance(cp_addr, pool_address) == 2000, 'Allowance != 2000');

    set_contract_address(pool_address);
    let pulled = token.transfer_from(cp_addr, pool_address, 2000);
    assert(pulled, 'transfer_from failed');

    assert(token.allowance(cp_addr, pool_address) == 0, 'Post-settle allowance != 0');
    assert(token.balance_of(cp_addr) == 0, 'Post-settle CP balance != 0');
    assert(token.balance_of(pool_address) == 2000, 'Pool did not receive tokens');
    assert(cp.get_locked_by_token(token_addr) == 0, 'Post-settle locked != 0');
    assert(
        cp.get_locked_by_token(token_addr) <= token.balance_of(cp_addr).try_into().unwrap(),
        'Post-settle solvency failed',
    );
}

#[test]
#[should_panic(expected: ('ERC20_APPROVE_FAILED', 'ENTRYPOINT_FAILED'))]
fn test_claim_erc20_approve_returning_false_reverts() {
    let pool_address: ContractAddress = contract_address(0x111);
    let (cp_addr, cp) = deploy_conditional_pay(pool_address, 410);
    let (token_addr, token) = deploy_mock_token(411);

    token.set_balance(cp_addr, 2000);
    set_block_timestamp(50);
    set_contract_address(pool_address);

    let claim_secret = 0x123456;
    let hashlock = compute_hashlock(claim_secret);
    let create_params = CreateParams {
        token: token_addr,
        amount: 1000,
        hashlock,
        refund_hash: 0x222,
        claim_after: 100,
        expires_at: 300,
        approver: contract_address(0x0),
        nonce: 0x1,
    };
    let payment_id = cp.compute_payment_id(create_params);
    cp.privacy_invoke(ConditionalPayAction::Create(create_params));

    token.set_fail_approve(true);

    set_block_timestamp(150);
    let claim_params = ClaimParams { payment_id, claim_preimage: claim_secret, note_id: 0x1 };

    cp.privacy_invoke(ConditionalPayAction::Claim(claim_params));
}

#[test]
#[should_panic(expected: ('INVALID_CLAIM_SECRET', 'ENTRYPOINT_FAILED'))]
fn test_claim_wrong_payment_id_cannot_claim_other_payment() {
    let pool_address: ContractAddress = contract_address(0x111);
    let (cp_addr, cp) = deploy_conditional_pay(pool_address, 420);
    let (token_addr, token) = deploy_mock_token(421);

    token.set_balance(cp_addr, 5000);
    set_block_timestamp(50);
    set_contract_address(pool_address);

    let secret1 = 0x111111;
    let secret2 = 0x222222;

    let p1 = CreateParams {
        token: token_addr,
        amount: 1000,
        hashlock: compute_hashlock(secret1),
        refund_hash: 0x1,
        claim_after: 100,
        expires_at: 300,
        approver: contract_address(0x0),
        nonce: 1,
    };
    let id1 = cp.compute_payment_id(p1);
    cp.privacy_invoke(ConditionalPayAction::Create(p1));

    let p2 = CreateParams {
        token: token_addr,
        amount: 2000,
        hashlock: compute_hashlock(secret2),
        refund_hash: 0x2,
        claim_after: 100,
        expires_at: 300,
        approver: contract_address(0x0),
        nonce: 2,
    };
    let _id2 = cp.compute_payment_id(p2);
    cp.privacy_invoke(ConditionalPayAction::Create(p2));

    set_block_timestamp(150);

    let claim_params = ClaimParams { payment_id: id1, claim_preimage: secret2, note_id: 0x1 };
    cp.privacy_invoke(ConditionalPayAction::Claim(claim_params));
}

#[test]
fn test_failed_claim_state_preservation() {
    let pool_address: ContractAddress = contract_address(0x111);
    let (cp_addr, cp) = deploy_conditional_pay(pool_address, 430);
    let (token_addr, token) = deploy_mock_token(431);

    token.set_balance(cp_addr, 2000);
    set_block_timestamp(50);
    set_contract_address(pool_address);

    let claim_secret = 0x123456;
    let hashlock = compute_hashlock(claim_secret);
    let create_params = CreateParams {
        token: token_addr,
        amount: 1000,
        hashlock,
        refund_hash: 0x222,
        claim_after: 100,
        expires_at: 300,
        approver: contract_address(0x0),
        nonce: 0x1,
    };
    let payment_id = cp.compute_payment_id(create_params);
    cp.privacy_invoke(ConditionalPayAction::Create(create_params));

    let payment_before = cp.get_payment(payment_id);
    assert(payment_before.state == payment_state::ACTIVE, 'State must be ACTIVE');
    assert(cp.get_locked_by_token(token_addr) == 1000, 'Locked must be 1000');
    assert(token.allowance(cp_addr, pool_address) == 0, 'Allowance must be 0');

    let uninit_payment = cp.get_payment(0x999999);
    assert(uninit_payment.state == payment_state::UNINITIALIZED, 'State must be UNINITIALIZED');
}

#[test]
#[should_panic(expected: ('PAYMENT_NOT_ACTIVE', 'ENTRYPOINT_FAILED'))]
fn test_refunded_payment_cannot_be_claimed() {
    let pool_address: ContractAddress = contract_address(0x111);
    let (cp_addr, cp) = deploy_test_state_conditional_pay(pool_address, 500);
    let (token_addr, token) = deploy_mock_token(501);

    token.set_balance(cp_addr, 2000);
    set_block_timestamp(150);
    set_contract_address(pool_address);

    let claim_secret = 0x123456;
    let hashlock = compute_hashlock(claim_secret);
    let refund_hash = compute_refund_hash(0x654321);
    let payment_id = 0x501;

    let refunded_payment = Payment {
        token: token_addr,
        amount: 1000,
        hashlock,
        refund_hash,
        claim_after: 100,
        expires_at: 300,
        approver: contract_address(0x0),
        approved: false,
        state: payment_state::REFUNDED,
    };
    cp.set_payment_for_test(payment_id, refunded_payment);
    cp.set_locked_by_token_for_test(token_addr, 0);

    let claim_params = ClaimParams { payment_id, claim_preimage: claim_secret, note_id: 0x1 };

    cp.privacy_invoke(ConditionalPayAction::Claim(claim_params));
}

#[test]
#[should_panic(expected: ('INSUFFICIENT_LOCKED_AMOUNT', 'ENTRYPOINT_FAILED'))]
fn test_claim_insufficient_locked_amount_reverts_without_mutation() {
    let pool_address: ContractAddress = contract_address(0x111);
    let (cp_addr, cp) = deploy_test_state_conditional_pay(pool_address, 510);
    let (token_addr, token) = deploy_mock_token(511);

    token.set_balance(cp_addr, 2000);
    set_block_timestamp(150);
    set_contract_address(pool_address);

    let claim_secret = 0x123456;
    let hashlock = compute_hashlock(claim_secret);
    let refund_hash = compute_refund_hash(0x654321);
    let payment_id = 0x502;

    let active_payment = Payment {
        token: token_addr,
        amount: 1000,
        hashlock,
        refund_hash,
        claim_after: 100,
        expires_at: 300,
        approver: contract_address(0x0),
        approved: false,
        state: payment_state::ACTIVE,
    };
    cp.set_payment_for_test(payment_id, active_payment);
    cp.set_locked_by_token_for_test(token_addr, 500);

    let claim_params = ClaimParams { payment_id, claim_preimage: claim_secret, note_id: 0x1 };

    cp.privacy_invoke(ConditionalPayAction::Claim(claim_params));
}

#[test]
#[should_panic(expected: ('ERC20_APPROVE_REVERT', 'ENTRYPOINT_FAILED', 'ENTRYPOINT_FAILED'))]
fn test_claim_erc20_approve_revert_rolls_back() {
    let pool_address: ContractAddress = contract_address(0x111);
    let (cp_addr, cp) = deploy_conditional_pay(pool_address, 520);
    let (token_addr, token) = deploy_mock_token(521);

    token.set_balance(cp_addr, 2000);
    set_block_timestamp(50);
    set_contract_address(pool_address);

    let claim_secret = 0x123456;
    let hashlock = compute_hashlock(claim_secret);
    let create_params = CreateParams {
        token: token_addr,
        amount: 1000,
        hashlock,
        refund_hash: 0x222,
        claim_after: 100,
        expires_at: 300,
        approver: contract_address(0x0),
        nonce: 0x1,
    };
    let payment_id = cp.compute_payment_id(create_params);
    cp.privacy_invoke(ConditionalPayAction::Create(create_params));

    token.set_revert_approve(true);

    set_block_timestamp(150);
    let claim_params = ClaimParams { payment_id, claim_preimage: claim_secret, note_id: 0x1 };

    cp.privacy_invoke(ConditionalPayAction::Claim(claim_params));
}

#[test]
fn test_claim_does_not_accumulate_existing_allowance() {
    let pool_address: ContractAddress = contract_address(0x111);
    let (cp_addr, cp) = deploy_conditional_pay(pool_address, 530);
    let (token_addr, token) = deploy_mock_token(531);

    token.set_balance(cp_addr, 5000);
    set_block_timestamp(50);
    set_contract_address(pool_address);

    token.set_allowance_for_test(cp_addr, pool_address, 500);
    assert(token.allowance(cp_addr, pool_address) == 500, 'Initial allowance != 500');

    let claim_secret = 0x123456;
    let hashlock = compute_hashlock(claim_secret);
    let create_params = CreateParams {
        token: token_addr,
        amount: 1200,
        hashlock,
        refund_hash: 0x222,
        claim_after: 100,
        expires_at: 300,
        approver: contract_address(0x0),
        nonce: 0x1,
    };
    let payment_id = cp.compute_payment_id(create_params);
    cp.privacy_invoke(ConditionalPayAction::Create(create_params));

    set_block_timestamp(150);
    let claim_params = ClaimParams { payment_id, claim_preimage: claim_secret, note_id: 0x1 };
    cp.privacy_invoke(ConditionalPayAction::Claim(claim_params));

    let post_claim_allowance = token.allowance(cp_addr, pool_address);
    assert(post_claim_allowance == 1200, 'Allowance must be 1200 not 1700');

    set_contract_address(pool_address);
    let pulled = token.transfer_from(cp_addr, pool_address, 1200);
    assert(pulled, 'transfer_from failed');
    assert(token.allowance(cp_addr, pool_address) == 0, 'Post-pull allowance != 0');
}

// =============================================================================
// CATEGORY 5: REFUND FLOW (Phase 1D) — 18 Tests
// =============================================================================

#[test]
fn test_successful_refund_flow() {
    let pool_address: ContractAddress = contract_address(0x111);
    let (cp_addr, cp) = deploy_conditional_pay(pool_address, 600);
    let (token_addr, token) = deploy_mock_token(601);

    token.set_balance(cp_addr, 5000);
    set_block_timestamp(50);
    set_contract_address(pool_address);

    let refund_secret = 0x1e401;
    let hashlock = compute_hashlock(0xc1a01);
    let refund_hash = compute_refund_hash(refund_secret);

    let create_params = CreateParams {
        token: token_addr,
        amount: 2500,
        hashlock,
        refund_hash,
        claim_after: 100,
        expires_at: 300,
        approver: contract_address(0x0),
        nonce: 0x1,
    };
    let payment_id = cp.compute_payment_id(create_params);
    cp.privacy_invoke(ConditionalPayAction::Create(create_params));

    assert(cp.get_locked_by_token(token_addr) == 2500, 'Pre-refund locked != 2500');

    // Advance time past expires_at
    set_block_timestamp(350);

    let open_note_id = 0x888;
    let refund_params = RefundParams {
        payment_id, refund_preimage: refund_secret, note_id: open_note_id,
    };

    let deposits = cp.privacy_invoke(ConditionalPayAction::Refund(refund_params));

    // 1. Verify returned OpenNoteDeposit
    assert(deposits.len() == 1, 'Must return 1 deposit note');
    let deposit = *deposits.at(0);
    assert(deposit.note_id == open_note_id, 'Returned note_id mismatch');
    assert(deposit.token == token_addr, 'Returned token mismatch');
    assert(deposit.amount == 2500, 'Returned amount mismatch');

    // 2. Verify state transition to REFUNDED
    let payment = cp.get_payment(payment_id);
    assert(payment.state == payment_state::REFUNDED, 'State must be REFUNDED');

    // 3. Verify exact liability reduction
    assert(cp.get_locked_by_token(token_addr) == 0, 'Post-refund locked != 0');

    // 4. Verify ERC-20 allowance to the pool
    let allowance = token.allowance(cp_addr, pool_address);
    assert(allowance == 2500, 'Allowance to pool != 2500');
}

#[test]
#[should_panic(expected: ('INVALID_REFUND_SECRET', 'ENTRYPOINT_FAILED'))]
fn test_refund_wrong_preimage_reverts() {
    let pool_address: ContractAddress = contract_address(0x111);
    let (cp_addr, cp) = deploy_conditional_pay(pool_address, 610);
    let (token_addr, token) = deploy_mock_token(611);

    token.set_balance(cp_addr, 2000);
    set_block_timestamp(50);
    set_contract_address(pool_address);

    let refund_secret = 0x1e401;
    let create_params = CreateParams {
        token: token_addr,
        amount: 1000,
        hashlock: compute_hashlock(0xc1a01),
        refund_hash: compute_refund_hash(refund_secret),
        claim_after: 100,
        expires_at: 300,
        approver: contract_address(0x0),
        nonce: 0x1,
    };
    let payment_id = cp.compute_payment_id(create_params);
    cp.privacy_invoke(ConditionalPayAction::Create(create_params));

    set_block_timestamp(350);
    let refund_params = RefundParams { payment_id, refund_preimage: 0xbad5ec, note_id: 0x1 };

    cp.privacy_invoke(ConditionalPayAction::Refund(refund_params));
}

#[test]
#[should_panic(expected: ('INVALID_REFUND_SECRET', 'ENTRYPOINT_FAILED'))]
fn test_refund_claim_preimage_fails_due_to_domain_separation() {
    let pool_address: ContractAddress = contract_address(0x111);
    let (cp_addr, cp) = deploy_conditional_pay(pool_address, 620);
    let (token_addr, token) = deploy_mock_token(621);

    token.set_balance(cp_addr, 2000);
    set_block_timestamp(50);
    set_contract_address(pool_address);

    let shared_secret = 0x54a123;
    let create_params = CreateParams {
        token: token_addr,
        amount: 1000,
        hashlock: compute_hashlock(shared_secret),
        refund_hash: compute_refund_hash(shared_secret),
        claim_after: 100,
        expires_at: 300,
        approver: contract_address(0x0),
        nonce: 0x1,
    };
    let payment_id = cp.compute_payment_id(create_params);
    cp.privacy_invoke(ConditionalPayAction::Create(create_params));

    set_block_timestamp(350);

    // If an attacker passes hashlock as the refund preimage
    let refund_params = RefundParams {
        payment_id, refund_preimage: compute_hashlock(shared_secret), note_id: 0x1,
    };

    cp.privacy_invoke(ConditionalPayAction::Refund(refund_params));
}

#[test]
#[should_panic(expected: ('PAYMENT_NOT_EXPIRED', 'ENTRYPOINT_FAILED'))]
fn test_refund_before_expiry_reverts() {
    let pool_address: ContractAddress = contract_address(0x111);
    let (cp_addr, cp) = deploy_conditional_pay(pool_address, 630);
    let (token_addr, token) = deploy_mock_token(631);

    token.set_balance(cp_addr, 2000);
    set_block_timestamp(50);
    set_contract_address(pool_address);

    let refund_secret = 0x1e401;
    let create_params = CreateParams {
        token: token_addr,
        amount: 1000,
        hashlock: compute_hashlock(0x123),
        refund_hash: compute_refund_hash(refund_secret),
        claim_after: 100,
        expires_at: 300,
        approver: contract_address(0x0),
        nonce: 0x1,
    };
    let payment_id = cp.compute_payment_id(create_params);
    cp.privacy_invoke(ConditionalPayAction::Create(create_params));

    // Timestamp 299 is strictly before expires_at 300
    set_block_timestamp(299);
    let refund_params = RefundParams { payment_id, refund_preimage: refund_secret, note_id: 0x1 };

    cp.privacy_invoke(ConditionalPayAction::Refund(refund_params));
}

#[test]
fn test_refund_exactly_at_expiry_succeeds() {
    let pool_address: ContractAddress = contract_address(0x111);
    let (cp_addr, cp) = deploy_conditional_pay(pool_address, 640);
    let (token_addr, token) = deploy_mock_token(641);

    token.set_balance(cp_addr, 2000);
    set_block_timestamp(50);
    set_contract_address(pool_address);

    let refund_secret = 0x1e401;
    let create_params = CreateParams {
        token: token_addr,
        amount: 1000,
        hashlock: compute_hashlock(0x123),
        refund_hash: compute_refund_hash(refund_secret),
        claim_after: 100,
        expires_at: 300,
        approver: contract_address(0x0),
        nonce: 0x1,
    };
    let payment_id = cp.compute_payment_id(create_params);
    cp.privacy_invoke(ConditionalPayAction::Create(create_params));

    // Timestamp exactly at expires_at 300
    set_block_timestamp(300);
    let refund_params = RefundParams { payment_id, refund_preimage: refund_secret, note_id: 0x1 };

    let deposits = cp.privacy_invoke(ConditionalPayAction::Refund(refund_params));
    assert(deposits.len() == 1, 'Refund at boundary must pass');
    assert(cp.get_payment(payment_id).state == payment_state::REFUNDED, 'Must be REFUNDED');
}

#[test]
fn test_refund_after_expiry_succeeds() {
    let pool_address: ContractAddress = contract_address(0x111);
    let (cp_addr, cp) = deploy_conditional_pay(pool_address, 650);
    let (token_addr, token) = deploy_mock_token(651);

    token.set_balance(cp_addr, 2000);
    set_block_timestamp(50);
    set_contract_address(pool_address);

    let refund_secret = 0x1e401;
    let create_params = CreateParams {
        token: token_addr,
        amount: 1000,
        hashlock: compute_hashlock(0x123),
        refund_hash: compute_refund_hash(refund_secret),
        claim_after: 100,
        expires_at: 300,
        approver: contract_address(0x0),
        nonce: 0x1,
    };
    let payment_id = cp.compute_payment_id(create_params);
    cp.privacy_invoke(ConditionalPayAction::Create(create_params));

    set_block_timestamp(400);
    let refund_params = RefundParams { payment_id, refund_preimage: refund_secret, note_id: 0x1 };

    let deposits = cp.privacy_invoke(ConditionalPayAction::Refund(refund_params));
    assert(deposits.len() == 1, 'Refund after expiry must pass');
    assert(cp.get_payment(payment_id).state == payment_state::REFUNDED, 'Must be REFUNDED');
}

#[test]
#[should_panic(expected: ('NO_EXPIRY', 'ENTRYPOINT_FAILED'))]
fn test_refund_zero_expiry_payment_reverts() {
    let pool_address: ContractAddress = contract_address(0x111);
    let (cp_addr, cp) = deploy_conditional_pay(pool_address, 660);
    let (token_addr, token) = deploy_mock_token(661);

    token.set_balance(cp_addr, 2000);
    set_block_timestamp(50);
    set_contract_address(pool_address);

    let refund_secret = 0x1e401;
    let create_params = CreateParams {
        token: token_addr,
        amount: 1000,
        hashlock: compute_hashlock(0x123),
        refund_hash: compute_refund_hash(refund_secret),
        claim_after: 100,
        expires_at: 0, // No expiry configured
        approver: contract_address(0x0),
        nonce: 0x1,
    };
    let payment_id = cp.compute_payment_id(create_params);
    cp.privacy_invoke(ConditionalPayAction::Create(create_params));

    set_block_timestamp(999999);
    let refund_params = RefundParams { payment_id, refund_preimage: refund_secret, note_id: 0x1 };

    cp.privacy_invoke(ConditionalPayAction::Refund(refund_params));
}

#[test]
#[should_panic(expected: ('PAYMENT_NOT_ACTIVE', 'ENTRYPOINT_FAILED'))]
fn test_refund_uninitialized_payment_reverts() {
    let pool_address: ContractAddress = contract_address(0x111);
    let (_, cp) = deploy_conditional_pay(pool_address, 670);

    set_contract_address(pool_address);
    let refund_params = RefundParams { payment_id: 0x999888, refund_preimage: 0x123, note_id: 0x1 };

    cp.privacy_invoke(ConditionalPayAction::Refund(refund_params));
}

#[test]
#[should_panic(expected: ('PAYMENT_NOT_ACTIVE', 'ENTRYPOINT_FAILED'))]
fn test_refund_already_claimed_payment_reverts() {
    let pool_address: ContractAddress = contract_address(0x111);
    let (cp_addr, cp) = deploy_conditional_pay(pool_address, 680);
    let (token_addr, token) = deploy_mock_token(681);

    token.set_balance(cp_addr, 2000);
    set_block_timestamp(50);
    set_contract_address(pool_address);

    let claim_secret = 0xc1a01;
    let refund_secret = 0x1e401;
    let create_params = CreateParams {
        token: token_addr,
        amount: 1000,
        hashlock: compute_hashlock(claim_secret),
        refund_hash: compute_refund_hash(refund_secret),
        claim_after: 100,
        expires_at: 300,
        approver: contract_address(0x0),
        nonce: 0x1,
    };
    let payment_id = cp.compute_payment_id(create_params);
    cp.privacy_invoke(ConditionalPayAction::Create(create_params));

    // Claim during active claim window
    set_block_timestamp(150);
    cp
        .privacy_invoke(
            ConditionalPayAction::Claim(
                ClaimParams { payment_id, claim_preimage: claim_secret, note_id: 0x1 },
            ),
        );

    // Attempt refund after expiry
    set_block_timestamp(350);
    let refund_params = RefundParams { payment_id, refund_preimage: refund_secret, note_id: 0x2 };

    cp.privacy_invoke(ConditionalPayAction::Refund(refund_params));
}

#[test]
#[should_panic(expected: ('PAYMENT_NOT_ACTIVE', 'ENTRYPOINT_FAILED'))]
fn test_refund_already_refunded_payment_reverts() {
    let pool_address: ContractAddress = contract_address(0x111);
    let (cp_addr, cp) = deploy_conditional_pay(pool_address, 690);
    let (token_addr, token) = deploy_mock_token(691);

    token.set_balance(cp_addr, 2000);
    set_block_timestamp(50);
    set_contract_address(pool_address);

    let refund_secret = 0x1e401;
    let create_params = CreateParams {
        token: token_addr,
        amount: 1000,
        hashlock: compute_hashlock(0x123),
        refund_hash: compute_refund_hash(refund_secret),
        claim_after: 100,
        expires_at: 300,
        approver: contract_address(0x0),
        nonce: 0x1,
    };
    let payment_id = cp.compute_payment_id(create_params);
    cp.privacy_invoke(ConditionalPayAction::Create(create_params));

    set_block_timestamp(350);
    let refund_params = RefundParams { payment_id, refund_preimage: refund_secret, note_id: 0x1 };

    // First refund succeeds
    cp.privacy_invoke(ConditionalPayAction::Refund(refund_params));
    assert(cp.get_locked_by_token(token_addr) == 0, 'Liability must be 0');

    // Second refund attempt must revert
    cp.privacy_invoke(ConditionalPayAction::Refund(refund_params));
}

#[test]
fn test_multi_token_refund_liability_isolation() {
    let pool_address: ContractAddress = contract_address(0x111);
    let (cp_addr, cp) = deploy_conditional_pay(pool_address, 700);
    let (token_a, token_a_ctrl) = deploy_mock_token(701);
    let (token_b, token_b_ctrl) = deploy_mock_token(702);

    token_a_ctrl.set_balance(cp_addr, 5000);
    token_b_ctrl.set_balance(cp_addr, 5000);
    set_block_timestamp(50);
    set_contract_address(pool_address);

    let secret_a = 0x1ea;
    let secret_b = 0x1eb;

    let pa = CreateParams {
        token: token_a,
        amount: 1500,
        hashlock: compute_hashlock(0x111),
        refund_hash: compute_refund_hash(secret_a),
        claim_after: 100,
        expires_at: 300,
        approver: contract_address(0x0),
        nonce: 1,
    };
    let id_a = cp.compute_payment_id(pa);
    cp.privacy_invoke(ConditionalPayAction::Create(pa));

    let pb = CreateParams {
        token: token_b,
        amount: 2500,
        hashlock: compute_hashlock(0x222),
        refund_hash: compute_refund_hash(secret_b),
        claim_after: 100,
        expires_at: 300,
        approver: contract_address(0x0),
        nonce: 2,
    };
    let _id_b = cp.compute_payment_id(pb);
    cp.privacy_invoke(ConditionalPayAction::Create(pb));

    assert(cp.get_locked_by_token(token_a) == 1500, 'Locked A != 1500');
    assert(cp.get_locked_by_token(token_b) == 2500, 'Locked B != 2500');

    set_block_timestamp(350);
    cp
        .privacy_invoke(
            ConditionalPayAction::Refund(
                RefundParams { payment_id: id_a, refund_preimage: secret_a, note_id: 0xa },
            ),
        );

    assert(cp.get_locked_by_token(token_a) == 0, 'Locked A must be 0');
    assert(cp.get_locked_by_token(token_b) == 2500, 'Locked B must remain 2500');
}

#[test]
#[should_panic(expected: ('INSUFFICIENT_LOCKED_AMOUNT', 'ENTRYPOINT_FAILED'))]
fn test_refund_insufficient_locked_amount_reverts_without_mutation() {
    let pool_address: ContractAddress = contract_address(0x111);
    let (cp_addr, cp) = deploy_test_state_conditional_pay(pool_address, 710);
    let (token_addr, token) = deploy_mock_token(711);

    token.set_balance(cp_addr, 2000);
    set_block_timestamp(350);
    set_contract_address(pool_address);

    let refund_secret = 0x1e401;
    let payment_id = 0x710;

    let active_payment = Payment {
        token: token_addr,
        amount: 1000,
        hashlock: compute_hashlock(0x123),
        refund_hash: compute_refund_hash(refund_secret),
        claim_after: 100,
        expires_at: 300,
        approver: contract_address(0x0),
        approved: false,
        state: payment_state::ACTIVE,
    };
    cp.set_payment_for_test(payment_id, active_payment);
    cp.set_locked_by_token_for_test(token_addr, 500);

    let refund_params = RefundParams { payment_id, refund_preimage: refund_secret, note_id: 0x1 };

    cp.privacy_invoke(ConditionalPayAction::Refund(refund_params));
}

#[test]
fn test_failed_refund_state_preservation() {
    let pool_address: ContractAddress = contract_address(0x111);
    let (cp_addr, cp) = deploy_conditional_pay(pool_address, 720);
    let (token_addr, token) = deploy_mock_token(721);

    token.set_balance(cp_addr, 2000);
    set_block_timestamp(50);
    set_contract_address(pool_address);

    let refund_secret = 0x1e401;
    let create_params = CreateParams {
        token: token_addr,
        amount: 1000,
        hashlock: compute_hashlock(0x123),
        refund_hash: compute_refund_hash(refund_secret),
        claim_after: 100,
        expires_at: 300,
        approver: contract_address(0x0),
        nonce: 0x1,
    };
    let payment_id = cp.compute_payment_id(create_params);
    cp.privacy_invoke(ConditionalPayAction::Create(create_params));

    let payment_before = cp.get_payment(payment_id);
    assert(payment_before.state == payment_state::ACTIVE, 'State must be ACTIVE');
    assert(cp.get_locked_by_token(token_addr) == 1000, 'Locked must be 1000');
    assert(token.allowance(cp_addr, pool_address) == 0, 'Allowance must be 0');
}

#[test]
#[should_panic(expected: ('ERC20_APPROVE_FAILED', 'ENTRYPOINT_FAILED'))]
fn test_refund_erc20_approve_returning_false_reverts() {
    let pool_address: ContractAddress = contract_address(0x111);
    let (cp_addr, cp) = deploy_conditional_pay(pool_address, 730);
    let (token_addr, token) = deploy_mock_token(731);

    token.set_balance(cp_addr, 2000);
    set_block_timestamp(50);
    set_contract_address(pool_address);

    let refund_secret = 0x1e401;
    let create_params = CreateParams {
        token: token_addr,
        amount: 1000,
        hashlock: compute_hashlock(0x123),
        refund_hash: compute_refund_hash(refund_secret),
        claim_after: 100,
        expires_at: 300,
        approver: contract_address(0x0),
        nonce: 0x1,
    };
    let payment_id = cp.compute_payment_id(create_params);
    cp.privacy_invoke(ConditionalPayAction::Create(create_params));

    token.set_fail_approve(true);

    set_block_timestamp(350);
    let refund_params = RefundParams { payment_id, refund_preimage: refund_secret, note_id: 0x1 };

    cp.privacy_invoke(ConditionalPayAction::Refund(refund_params));
}

#[test]
#[should_panic(expected: ('ERC20_APPROVE_REVERT', 'ENTRYPOINT_FAILED', 'ENTRYPOINT_FAILED'))]
fn test_refund_erc20_approve_revert_rolls_back() {
    let pool_address: ContractAddress = contract_address(0x111);
    let (cp_addr, cp) = deploy_conditional_pay(pool_address, 740);
    let (token_addr, token) = deploy_mock_token(741);

    token.set_balance(cp_addr, 2000);
    set_block_timestamp(50);
    set_contract_address(pool_address);

    let refund_secret = 0x1e401;
    let create_params = CreateParams {
        token: token_addr,
        amount: 1000,
        hashlock: compute_hashlock(0x123),
        refund_hash: compute_refund_hash(refund_secret),
        claim_after: 100,
        expires_at: 300,
        approver: contract_address(0x0),
        nonce: 0x1,
    };
    let payment_id = cp.compute_payment_id(create_params);
    cp.privacy_invoke(ConditionalPayAction::Create(create_params));

    token.set_revert_approve(true);

    set_block_timestamp(350);
    let refund_params = RefundParams { payment_id, refund_preimage: refund_secret, note_id: 0x1 };

    cp.privacy_invoke(ConditionalPayAction::Refund(refund_params));
}

#[test]
fn test_refund_does_not_accumulate_existing_allowance() {
    let pool_address: ContractAddress = contract_address(0x111);
    let (cp_addr, cp) = deploy_conditional_pay(pool_address, 750);
    let (token_addr, token) = deploy_mock_token(751);

    token.set_balance(cp_addr, 5000);
    set_block_timestamp(50);
    set_contract_address(pool_address);

    token.set_allowance_for_test(cp_addr, pool_address, 700);
    assert(token.allowance(cp_addr, pool_address) == 700, 'Initial allowance != 700');

    let refund_secret = 0x1e401;
    let create_params = CreateParams {
        token: token_addr,
        amount: 1400,
        hashlock: compute_hashlock(0x123),
        refund_hash: compute_refund_hash(refund_secret),
        claim_after: 100,
        expires_at: 300,
        approver: contract_address(0x0),
        nonce: 0x1,
    };
    let payment_id = cp.compute_payment_id(create_params);
    cp.privacy_invoke(ConditionalPayAction::Create(create_params));

    set_block_timestamp(350);
    let refund_params = RefundParams { payment_id, refund_preimage: refund_secret, note_id: 0x1 };
    cp.privacy_invoke(ConditionalPayAction::Refund(refund_params));

    let post_refund_allowance = token.allowance(cp_addr, pool_address);
    assert(post_refund_allowance == 1400, 'Allowance must be 1400 not 2100');

    set_contract_address(pool_address);
    let pulled = token.transfer_from(cp_addr, pool_address, 1400);
    assert(pulled, 'transfer_from failed');
    assert(token.allowance(cp_addr, pool_address) == 0, 'Post-pull allowance != 0');
}

#[test]
fn test_full_refund_settlement_transaction_boundary_simulation() {
    let pool_address: ContractAddress = contract_address(0x111);
    let (cp_addr, cp) = deploy_conditional_pay(pool_address, 760);
    let (token_addr, token) = deploy_mock_token(761);

    token.set_balance(cp_addr, 3000);
    set_block_timestamp(50);
    set_contract_address(pool_address);

    let refund_secret = 0x1e777;
    let create_params = CreateParams {
        token: token_addr,
        amount: 3000,
        hashlock: compute_hashlock(0x111),
        refund_hash: compute_refund_hash(refund_secret),
        claim_after: 100,
        expires_at: 300,
        approver: contract_address(0x0),
        nonce: 0x1,
    };
    let payment_id = cp.compute_payment_id(create_params);
    cp.privacy_invoke(ConditionalPayAction::Create(create_params));

    assert(cp.get_locked_by_token(token_addr) == 3000, 'Pre-refund locked != 3000');
    assert(token.balance_of(cp_addr) == 3000, 'Pre-refund balance != 3000');

    set_block_timestamp(350);
    let open_note_id = 0x999;
    let deposits = cp
        .privacy_invoke(
            ConditionalPayAction::Refund(
                RefundParams { payment_id, refund_preimage: refund_secret, note_id: open_note_id },
            ),
        );

    assert(deposits.len() == 1, 'Must return 1 deposit note');
    assert(cp.get_payment(payment_id).state == payment_state::REFUNDED, 'State != REFUNDED');
    assert(cp.get_locked_by_token(token_addr) == 0, 'Locked != 0');
    assert(token.allowance(cp_addr, pool_address) == 3000, 'Allowance != 3000');

    set_contract_address(pool_address);
    let pulled = token.transfer_from(cp_addr, pool_address, 3000);
    assert(pulled, 'transfer_from failed');

    assert(token.allowance(cp_addr, pool_address) == 0, 'Post-settle allowance != 0');
    assert(token.balance_of(cp_addr) == 0, 'Post-settle CP balance != 0');
    assert(token.balance_of(pool_address) == 3000, 'Pool did not receive tokens');
    assert(cp.get_locked_by_token(token_addr) == 0, 'Post-settle locked != 0');
    assert(
        cp.get_locked_by_token(token_addr) <= token.balance_of(cp_addr).try_into().unwrap(),
        'Post-settle solvency failed',
    );
}

#[test]
#[should_panic(expected: ('CALLER_NOT_POOL', 'ENTRYPOINT_FAILED'))]
fn test_refund_unauthorized_caller_reverts() {
    let pool_address: ContractAddress = contract_address(0x111);
    let (cp_addr, cp) = deploy_conditional_pay(pool_address, 770);
    let (token_addr, token) = deploy_mock_token(771);

    token.set_balance(cp_addr, 2000);
    set_block_timestamp(50);
    set_contract_address(pool_address);

    let refund_secret = 0x1e401;
    let create_params = CreateParams {
        token: token_addr,
        amount: 1000,
        hashlock: compute_hashlock(0x123),
        refund_hash: compute_refund_hash(refund_secret),
        claim_after: 100,
        expires_at: 300,
        approver: contract_address(0x0),
        nonce: 0x1,
    };
    let payment_id = cp.compute_payment_id(create_params);
    cp.privacy_invoke(ConditionalPayAction::Create(create_params));

    set_block_timestamp(350);
    set_contract_address(contract_address(0xbad));
    let refund_params = RefundParams { payment_id, refund_preimage: refund_secret, note_id: 0x1 };

    cp.privacy_invoke(ConditionalPayAction::Refund(refund_params));
}

// =============================================================================
// CATEGORY 6: APPROVER ENTRYPOINT (Phase 1D) — 9 Tests
// =============================================================================

#[test]
fn test_approve_entrypoint_success() {
    let pool_address: ContractAddress = contract_address(0x111);
    let (cp_addr, cp) = deploy_conditional_pay(pool_address, 800);
    let (token_addr, token) = deploy_mock_token(801);

    token.set_balance(cp_addr, 2000);
    set_block_timestamp(50);
    set_contract_address(pool_address);

    let approver_address: ContractAddress = contract_address(0xaa77);
    let create_params = CreateParams {
        token: token_addr,
        amount: 1000,
        hashlock: compute_hashlock(0x123),
        refund_hash: compute_refund_hash(0x456),
        claim_after: 100,
        expires_at: 300,
        approver: approver_address,
        nonce: 0x1,
    };
    let payment_id = cp.compute_payment_id(create_params);
    cp.privacy_invoke(ConditionalPayAction::Create(create_params));

    let payment_before = cp.get_payment(payment_id);
    assert(payment_before.approved == false, 'Approved initially false');

    // Call approve as the approver
    set_contract_address(approver_address);
    cp.approve(payment_id);

    let payment_after = cp.get_payment(payment_id);
    assert(payment_after.approved == true, 'Approved must be true');
    assert(payment_after.state == payment_state::ACTIVE, 'State must remain ACTIVE');
    assert(payment_after.amount == 1000, 'Amount must remain 1000');
    assert(cp.get_locked_by_token(token_addr) == 1000, 'Liability must remain 1000');
}

#[test]
#[should_panic(expected: ('CALLER_NOT_APPROVER', 'ENTRYPOINT_FAILED'))]
fn test_approve_non_approver_caller_reverts() {
    let pool_address: ContractAddress = contract_address(0x111);
    let (cp_addr, cp) = deploy_conditional_pay(pool_address, 810);
    let (token_addr, token) = deploy_mock_token(811);

    token.set_balance(cp_addr, 2000);
    set_block_timestamp(50);
    set_contract_address(pool_address);

    let approver_address: ContractAddress = contract_address(0xaa77);
    let create_params = CreateParams {
        token: token_addr,
        amount: 1000,
        hashlock: compute_hashlock(0x123),
        refund_hash: compute_refund_hash(0x456),
        claim_after: 100,
        expires_at: 300,
        approver: approver_address,
        nonce: 0x1,
    };
    let payment_id = cp.compute_payment_id(create_params);
    cp.privacy_invoke(ConditionalPayAction::Create(create_params));

    // Call approve as a stranger
    set_contract_address(contract_address(0xbad));
    cp.approve(payment_id);
}

#[test]
#[should_panic(expected: ('NO_APPROVER_CONFIGURED', 'ENTRYPOINT_FAILED'))]
fn test_approve_no_approver_configured_reverts() {
    let pool_address: ContractAddress = contract_address(0x111);
    let (cp_addr, cp) = deploy_conditional_pay(pool_address, 820);
    let (token_addr, token) = deploy_mock_token(821);

    token.set_balance(cp_addr, 2000);
    set_block_timestamp(50);
    set_contract_address(pool_address);

    let create_params = CreateParams {
        token: token_addr,
        amount: 1000,
        hashlock: compute_hashlock(0x123),
        refund_hash: compute_refund_hash(0x456),
        claim_after: 100,
        expires_at: 300,
        approver: contract_address(0x0), // No approver configured
        nonce: 0x1,
    };
    let payment_id = cp.compute_payment_id(create_params);
    cp.privacy_invoke(ConditionalPayAction::Create(create_params));

    set_contract_address(contract_address(0xca11));
    cp.approve(payment_id);
}

#[test]
#[should_panic(expected: ('PAYMENT_NOT_ACTIVE', 'ENTRYPOINT_FAILED'))]
fn test_approve_uninitialized_payment_reverts() {
    let pool_address: ContractAddress = contract_address(0x111);
    let (_, cp) = deploy_conditional_pay(pool_address, 830);

    set_contract_address(contract_address(0xaa01));
    cp.approve(0x99901);
}

#[test]
#[should_panic(expected: ('PAYMENT_NOT_ACTIVE', 'ENTRYPOINT_FAILED'))]
fn test_approve_claimed_payment_reverts() {
    let pool_address: ContractAddress = contract_address(0x111);
    let (cp_addr, cp) = deploy_conditional_pay(pool_address, 840);
    let (token_addr, token) = deploy_mock_token(841);

    token.set_balance(cp_addr, 2000);
    set_block_timestamp(50);
    set_contract_address(pool_address);

    let claim_secret = 0xc1a01;
    let approver_address = contract_address(0xaa01);
    let create_params = CreateParams {
        token: token_addr,
        amount: 1000,
        hashlock: compute_hashlock(claim_secret),
        refund_hash: compute_refund_hash(0x456),
        claim_after: 100,
        expires_at: 300,
        approver: approver_address,
        nonce: 0x1,
    };
    let payment_id = cp.compute_payment_id(create_params);
    cp.privacy_invoke(ConditionalPayAction::Create(create_params));

    // Approver approves
    set_contract_address(approver_address);
    cp.approve(payment_id);

    // Claimant claims
    set_block_timestamp(150);
    set_contract_address(pool_address);
    cp
        .privacy_invoke(
            ConditionalPayAction::Claim(
                ClaimParams { payment_id, claim_preimage: claim_secret, note_id: 0x1 },
            ),
        );

    // Approving a CLAIMED payment must revert
    set_contract_address(approver_address);
    cp.approve(payment_id);
}

#[test]
#[should_panic(expected: ('PAYMENT_NOT_ACTIVE', 'ENTRYPOINT_FAILED'))]
fn test_approve_refunded_payment_reverts() {
    let pool_address: ContractAddress = contract_address(0x111);
    let (cp_addr, cp) = deploy_conditional_pay(pool_address, 850);
    let (token_addr, token) = deploy_mock_token(851);

    token.set_balance(cp_addr, 2000);
    set_block_timestamp(50);
    set_contract_address(pool_address);

    let refund_secret = 0x1e401;
    let approver_address = contract_address(0xaa01);
    let create_params = CreateParams {
        token: token_addr,
        amount: 1000,
        hashlock: compute_hashlock(0x123),
        refund_hash: compute_refund_hash(refund_secret),
        claim_after: 100,
        expires_at: 300,
        approver: approver_address,
        nonce: 0x1,
    };
    let payment_id = cp.compute_payment_id(create_params);
    cp.privacy_invoke(ConditionalPayAction::Create(create_params));

    // Refund after expiry
    set_block_timestamp(350);
    set_contract_address(pool_address);
    cp
        .privacy_invoke(
            ConditionalPayAction::Refund(
                RefundParams { payment_id, refund_preimage: refund_secret, note_id: 0x1 },
            ),
        );

    // Approving a REFUNDED payment must revert
    set_contract_address(approver_address);
    cp.approve(payment_id);
}

#[test]
fn test_approve_repeated_call_idempotent() {
    let pool_address: ContractAddress = contract_address(0x111);
    let (cp_addr, cp) = deploy_conditional_pay(pool_address, 860);
    let (token_addr, token) = deploy_mock_token(861);

    token.set_balance(cp_addr, 2000);
    set_block_timestamp(50);
    set_contract_address(pool_address);

    let approver_address = contract_address(0xaa01);
    let create_params = CreateParams {
        token: token_addr,
        amount: 1000,
        hashlock: compute_hashlock(0x123),
        refund_hash: compute_refund_hash(0x456),
        claim_after: 100,
        expires_at: 300,
        approver: approver_address,
        nonce: 0x1,
    };
    let payment_id = cp.compute_payment_id(create_params);
    cp.privacy_invoke(ConditionalPayAction::Create(create_params));

    set_contract_address(approver_address);
    cp.approve(payment_id);
    assert(cp.get_payment(payment_id).approved == true, 'First approve failed');

    // Repeated approve by stored approver is idempotent
    cp.approve(payment_id);
    assert(cp.get_payment(payment_id).approved == true, 'Second approve failed');
}

#[test]
fn test_approved_payment_can_subsequently_claim() {
    let pool_address: ContractAddress = contract_address(0x111);
    let (cp_addr, cp) = deploy_conditional_pay(pool_address, 870);
    let (token_addr, token) = deploy_mock_token(871);

    token.set_balance(cp_addr, 2000);
    set_block_timestamp(50);
    set_contract_address(pool_address);

    let claim_secret = 0xc1a01;
    let approver_address = contract_address(0xaa01);
    let create_params = CreateParams {
        token: token_addr,
        amount: 1000,
        hashlock: compute_hashlock(claim_secret),
        refund_hash: compute_refund_hash(0x456),
        claim_after: 100,
        expires_at: 300,
        approver: approver_address,
        nonce: 0x1,
    };
    let payment_id = cp.compute_payment_id(create_params);
    cp.privacy_invoke(ConditionalPayAction::Create(create_params));

    // Approver approves
    set_contract_address(approver_address);
    cp.approve(payment_id);

    // Claimant claims
    set_block_timestamp(150);
    set_contract_address(pool_address);
    let deposits = cp
        .privacy_invoke(
            ConditionalPayAction::Claim(
                ClaimParams { payment_id, claim_preimage: claim_secret, note_id: 0x1 },
            ),
        );

    assert(deposits.len() == 1, 'Claim must succeed');
    assert(cp.get_payment(payment_id).state == payment_state::CLAIMED, 'Must be CLAIMED');
}

// =============================================================================
// CATEGORY 7: CROSS-PATH STATE MACHINE & INVARIANTS (Phase 1D) — 5 Tests
// =============================================================================

#[test]
#[should_panic(expected: ('PAYMENT_NOT_ACTIVE', 'ENTRYPOINT_FAILED'))]
fn test_claimed_payment_cannot_later_refund() {
    let pool_address: ContractAddress = contract_address(0x111);
    let (cp_addr, cp) = deploy_conditional_pay(pool_address, 900);
    let (token_addr, token) = deploy_mock_token(901);

    token.set_balance(cp_addr, 2000);
    set_block_timestamp(50);
    set_contract_address(pool_address);

    let claim_secret = 0xc1a01;
    let refund_secret = 0x1e401;
    let create_params = CreateParams {
        token: token_addr,
        amount: 1000,
        hashlock: compute_hashlock(claim_secret),
        refund_hash: compute_refund_hash(refund_secret),
        claim_after: 100,
        expires_at: 300,
        approver: contract_address(0x0),
        nonce: 0x1,
    };
    let payment_id = cp.compute_payment_id(create_params);
    cp.privacy_invoke(ConditionalPayAction::Create(create_params));

    // Claim at 150
    set_block_timestamp(150);
    cp
        .privacy_invoke(
            ConditionalPayAction::Claim(
                ClaimParams { payment_id, claim_preimage: claim_secret, note_id: 0x1 },
            ),
        );
    assert(cp.get_payment(payment_id).state == payment_state::CLAIMED, 'Must be CLAIMED');

    // Attempt refund at 400
    set_block_timestamp(400);
    cp
        .privacy_invoke(
            ConditionalPayAction::Refund(
                RefundParams { payment_id, refund_preimage: refund_secret, note_id: 0x2 },
            ),
        );
}

#[test]
#[should_panic(expected: ('PAYMENT_NOT_ACTIVE', 'ENTRYPOINT_FAILED'))]
fn test_refunded_payment_cannot_later_claim() {
    let pool_address: ContractAddress = contract_address(0x111);
    let (cp_addr, cp) = deploy_conditional_pay(pool_address, 910);
    let (token_addr, token) = deploy_mock_token(911);

    token.set_balance(cp_addr, 2000);
    set_block_timestamp(50);
    set_contract_address(pool_address);

    let claim_secret = 0xc1a01;
    let refund_secret = 0x1e401;
    let create_params = CreateParams {
        token: token_addr,
        amount: 1000,
        hashlock: compute_hashlock(claim_secret),
        refund_hash: compute_refund_hash(refund_secret),
        claim_after: 100,
        expires_at: 300,
        approver: contract_address(0x0),
        nonce: 0x1,
    };
    let payment_id = cp.compute_payment_id(create_params);
    cp.privacy_invoke(ConditionalPayAction::Create(create_params));

    // Refund at 350
    set_block_timestamp(350);
    cp
        .privacy_invoke(
            ConditionalPayAction::Refund(
                RefundParams { payment_id, refund_preimage: refund_secret, note_id: 0x1 },
            ),
        );
    assert(cp.get_payment(payment_id).state == payment_state::REFUNDED, 'Must be REFUNDED');

    // Attempt claim
    cp
        .privacy_invoke(
            ConditionalPayAction::Claim(
                ClaimParams { payment_id, claim_preimage: claim_secret, note_id: 0x2 },
            ),
        );
}

#[test]
fn test_claim_before_expiry_and_refund_after_expiry_handoff() {
    let pool_address: ContractAddress = contract_address(0x111);
    let (cp_addr, cp) = deploy_conditional_pay(pool_address, 920);
    let (token_addr, token) = deploy_mock_token(921);

    token.set_balance(cp_addr, 5000);
    set_block_timestamp(50);
    set_contract_address(pool_address);

    let claim_secret = 0xc1a01;
    let refund_secret = 0x1e401;

    // Payment 1: claimed at 299 (just before expiry 300)
    let p1 = CreateParams {
        token: token_addr,
        amount: 1000,
        hashlock: compute_hashlock(claim_secret),
        refund_hash: compute_refund_hash(refund_secret),
        claim_after: 100,
        expires_at: 300,
        approver: contract_address(0x0),
        nonce: 1,
    };
    let id1 = cp.compute_payment_id(p1);
    cp.privacy_invoke(ConditionalPayAction::Create(p1));

    // Payment 2: refunded at 300 (exactly at expiry 300)
    let p2 = CreateParams {
        token: token_addr,
        amount: 1500,
        hashlock: compute_hashlock(claim_secret),
        refund_hash: compute_refund_hash(refund_secret),
        claim_after: 100,
        expires_at: 300,
        approver: contract_address(0x0),
        nonce: 2,
    };
    let id2 = cp.compute_payment_id(p2);
    cp.privacy_invoke(ConditionalPayAction::Create(p2));

    // At 299: claim succeeds for p1
    set_block_timestamp(299);
    let d1 = cp
        .privacy_invoke(
            ConditionalPayAction::Claim(
                ClaimParams { payment_id: id1, claim_preimage: claim_secret, note_id: 0x1 },
            ),
        );
    assert(d1.len() == 1, 'Claim at 299 must pass');
    assert(cp.get_payment(id1).state == payment_state::CLAIMED, 'P1 must be CLAIMED');

    // At 300: refund succeeds for p2
    set_block_timestamp(300);
    let d2 = cp
        .privacy_invoke(
            ConditionalPayAction::Refund(
                RefundParams { payment_id: id2, refund_preimage: refund_secret, note_id: 0x2 },
            ),
        );
    assert(d2.len() == 1, 'Refund at 300 must pass');
    assert(cp.get_payment(id2).state == payment_state::REFUNDED, 'P2 must be REFUNDED');

    assert(cp.get_locked_by_token(token_addr) == 0, 'Total locked must be 0');
}

#[test]
fn test_unapproved_approver_gated_payment_can_refund_after_expiry() {
    let pool_address: ContractAddress = contract_address(0x111);
    let (cp_addr, cp) = deploy_conditional_pay(pool_address, 930);
    let (token_addr, token) = deploy_mock_token(931);

    token.set_balance(cp_addr, 2000);
    set_block_timestamp(50);
    set_contract_address(pool_address);

    let refund_secret = 0x1e401;
    let approver_address = contract_address(0xaa01);
    let create_params = CreateParams {
        token: token_addr,
        amount: 1000,
        hashlock: compute_hashlock(0x123),
        refund_hash: compute_refund_hash(refund_secret),
        claim_after: 100,
        expires_at: 300,
        approver: approver_address, // Approver configured but NEVER approved
        nonce: 0x1,
    };
    let payment_id = cp.compute_payment_id(create_params);
    cp.privacy_invoke(ConditionalPayAction::Create(create_params));

    // Time passes past expiry
    set_block_timestamp(350);

    // Refund succeeds despite missing approval
    let deposits = cp
        .privacy_invoke(
            ConditionalPayAction::Refund(
                RefundParams { payment_id, refund_preimage: refund_secret, note_id: 0x1 },
            ),
        );
    assert(deposits.len() == 1, 'Refund must succeed');
    assert(cp.get_payment(payment_id).state == payment_state::REFUNDED, 'Must be REFUNDED');
}

#[test]
fn test_multi_payment_mixed_claim_refund_active_solvency_invariant() {
    let pool_address: ContractAddress = contract_address(0x111);
    let (cp_addr, cp) = deploy_conditional_pay(pool_address, 940);
    let (token_addr, token) = deploy_mock_token(941);

    token.set_balance(cp_addr, 10000);
    set_block_timestamp(50);
    set_contract_address(pool_address);

    let sec_claim1 = 0xc101;
    let sec_refund2 = 0x1e02;

    // Payment 1 (amount 2000): will be CLAIMED
    let p1 = CreateParams {
        token: token_addr,
        amount: 2000,
        hashlock: compute_hashlock(sec_claim1),
        refund_hash: compute_refund_hash(0x1),
        claim_after: 100,
        expires_at: 300,
        approver: contract_address(0x0),
        nonce: 1,
    };
    let id1 = cp.compute_payment_id(p1);
    cp.privacy_invoke(ConditionalPayAction::Create(p1));

    // Payment 2 (amount 3000): will be REFUNDED
    let p2 = CreateParams {
        token: token_addr,
        amount: 3000,
        hashlock: compute_hashlock(0x2),
        refund_hash: compute_refund_hash(sec_refund2),
        claim_after: 100,
        expires_at: 300,
        approver: contract_address(0x0),
        nonce: 2,
    };
    let id2 = cp.compute_payment_id(p2);
    cp.privacy_invoke(ConditionalPayAction::Create(p2));

    // Payment 3 (amount 4000): will remain ACTIVE
    let p3 = CreateParams {
        token: token_addr,
        amount: 4000,
        hashlock: compute_hashlock(0x3),
        refund_hash: compute_refund_hash(0x3),
        claim_after: 100,
        expires_at: 900,
        approver: contract_address(0x0),
        nonce: 3,
    };
    let id3 = cp.compute_payment_id(p3);
    cp.privacy_invoke(ConditionalPayAction::Create(p3));

    assert(cp.get_locked_by_token(token_addr) == 9000, 'Initial locked != 9000');

    // 1. Claim payment 1 at timestamp 150
    set_block_timestamp(150);
    cp
        .privacy_invoke(
            ConditionalPayAction::Claim(
                ClaimParams { payment_id: id1, claim_preimage: sec_claim1, note_id: 0x10 },
            ),
        );
    token.transfer_from(cp_addr, pool_address, 2000);
    assert(cp.get_locked_by_token(token_addr) == 7000, 'Locked after claim != 7000');

    // 2. Refund payment 2 at timestamp 350
    set_block_timestamp(350);
    cp
        .privacy_invoke(
            ConditionalPayAction::Refund(
                RefundParams { payment_id: id2, refund_preimage: sec_refund2, note_id: 0x20 },
            ),
        );
    token.transfer_from(cp_addr, pool_address, 3000);

    // 3. Verify terminal states & remaining active obligation
    assert(cp.get_payment(id1).state == payment_state::CLAIMED, 'P1 must be CLAIMED');
    assert(cp.get_payment(id2).state == payment_state::REFUNDED, 'P2 must be REFUNDED');
    assert(cp.get_payment(id3).state == payment_state::ACTIVE, 'P3 must be ACTIVE');

    // Invariant: locked liability equals exactly the remaining active payment (4000)
    let final_locked = cp.get_locked_by_token(token_addr);
    assert(final_locked == 4000, 'Final locked must be 4000');
    assert(
        final_locked <= token.balance_of(cp_addr).try_into().unwrap(),
        'Final solvency invariant failed',
    );
    assert(token.balance_of(cp_addr) == 5000, 'CP remaining balance != 5000');
}

// =============================================================================
// CATEGORY 8: OUTER TRANSACTION ROLLBACK & REENTRANCY SECURITY (Security Freeze) — 7 Tests
// =============================================================================

#[test]
#[should_panic(expected: ('POOL_DOWNSTREAM_REVERT', 'ENTRYPOINT_FAILED'))]
fn test_outer_claim_revert_rolls_back_entire_call_chain() {
    let (harness_addr, harness) = deploy_mock_pool_harness(1000);
    let (cp_addr, cp) = deploy_conditional_pay(harness_addr, 1001);
    let (token_addr, _token) = deploy_mock_token(1002);

    harness.setup_and_fund(cp_addr, token_addr, 5000);
    set_block_timestamp(50);
    set_contract_address(harness_addr);

    let claim_secret = 0xc1a01;
    let create_params = CreateParams {
        token: token_addr,
        amount: 2000,
        hashlock: compute_hashlock(claim_secret),
        refund_hash: compute_refund_hash(0x1e401),
        claim_after: 100,
        expires_at: 300,
        approver: contract_address(0x0),
        nonce: 0x1,
    };
    let payment_id = cp.compute_payment_id(create_params);
    cp.privacy_invoke(ConditionalPayAction::Create(create_params));

    assert(cp.get_payment(payment_id).state == payment_state::ACTIVE, 'State != ACTIVE');
    assert(cp.get_locked_by_token(token_addr) == 2000, 'Locked != 2000');

    set_block_timestamp(150);

    // Outer pool harness invokes claim and then deliberately reverts downstream
    harness.invoke_claim_and_fail_after(cp_addr, payment_id, claim_secret, 0x999);
}

#[test]
#[should_panic(expected: ('POOL_DOWNSTREAM_REVERT', 'ENTRYPOINT_FAILED'))]
fn test_outer_refund_revert_rolls_back_entire_call_chain() {
    let (harness_addr, harness) = deploy_mock_pool_harness(1010);
    let (cp_addr, cp) = deploy_conditional_pay(harness_addr, 1011);
    let (token_addr, _token) = deploy_mock_token(1012);

    harness.setup_and_fund(cp_addr, token_addr, 5000);
    set_block_timestamp(50);
    set_contract_address(harness_addr);

    let refund_secret = 0x1e401;
    let create_params = CreateParams {
        token: token_addr,
        amount: 2000,
        hashlock: compute_hashlock(0xc1a01),
        refund_hash: compute_refund_hash(refund_secret),
        claim_after: 100,
        expires_at: 300,
        approver: contract_address(0x0),
        nonce: 0x1,
    };
    let payment_id = cp.compute_payment_id(create_params);
    cp.privacy_invoke(ConditionalPayAction::Create(create_params));

    set_block_timestamp(350);

    // Outer pool harness invokes refund and then deliberately reverts downstream
    harness.invoke_refund_and_fail_after(cp_addr, payment_id, refund_secret, 0x999);
}

#[test]
fn test_outer_claim_and_settle_full_lifecycle_invariants() {
    let (harness_addr, harness) = deploy_mock_pool_harness(1020);
    let (cp_addr, cp) = deploy_conditional_pay(harness_addr, 1021);
    let (token_addr, token) = deploy_mock_token(1022);

    harness.setup_and_fund(cp_addr, token_addr, 2000);
    set_block_timestamp(50);
    set_contract_address(harness_addr);

    let claim_secret = 0xc1a01;
    let create_params = CreateParams {
        token: token_addr,
        amount: 2000,
        hashlock: compute_hashlock(claim_secret),
        refund_hash: compute_refund_hash(0x1e401),
        claim_after: 100,
        expires_at: 300,
        approver: contract_address(0x0),
        nonce: 0x1,
    };
    let payment_id = cp.compute_payment_id(create_params);
    cp.privacy_invoke(ConditionalPayAction::Create(create_params));

    set_block_timestamp(150);

    // Full outer settlement: claim + pool transfer_from in same transaction
    harness.invoke_claim_and_settle(cp_addr, payment_id, claim_secret, 0x999, token_addr, 2000);

    // Invariants post-settlement:
    assert(cp.get_payment(payment_id).state == payment_state::CLAIMED, 'State != CLAIMED');
    assert(cp.get_locked_by_token(token_addr) == 0, 'Locked != 0');
    assert(token.balance_of(cp_addr) == 0, 'CP balance != 0');
    assert(token.balance_of(harness_addr) == 2000, 'Harness balance != 2000');
    assert(token.allowance(cp_addr, harness_addr) == 0, 'Allowance != 0');
}

#[test]
fn test_outer_refund_and_settle_full_lifecycle_invariants() {
    let (harness_addr, harness) = deploy_mock_pool_harness(1030);
    let (cp_addr, cp) = deploy_conditional_pay(harness_addr, 1031);
    let (token_addr, token) = deploy_mock_token(1032);

    harness.setup_and_fund(cp_addr, token_addr, 3000);
    set_block_timestamp(50);
    set_contract_address(harness_addr);

    let refund_secret = 0x1e401;
    let create_params = CreateParams {
        token: token_addr,
        amount: 3000,
        hashlock: compute_hashlock(0xc1a01),
        refund_hash: compute_refund_hash(refund_secret),
        claim_after: 100,
        expires_at: 300,
        approver: contract_address(0x0),
        nonce: 0x1,
    };
    let payment_id = cp.compute_payment_id(create_params);
    cp.privacy_invoke(ConditionalPayAction::Create(create_params));

    set_block_timestamp(350);

    // Full outer settlement: refund + pool transfer_from in same transaction
    harness.invoke_refund_and_settle(cp_addr, payment_id, refund_secret, 0x999, token_addr, 3000);

    // Invariants post-settlement:
    assert(cp.get_payment(payment_id).state == payment_state::REFUNDED, 'State != REFUNDED');
    assert(cp.get_locked_by_token(token_addr) == 0, 'Locked != 0');
    assert(token.balance_of(cp_addr) == 0, 'CP balance != 0');
    assert(token.balance_of(harness_addr) == 3000, 'Harness balance != 3000');
    assert(token.allowance(cp_addr, harness_addr) == 0, 'Allowance != 0');
}

#[test]
#[should_panic(
    expected: ('CALLER_NOT_POOL', 'ENTRYPOINT_FAILED', 'ENTRYPOINT_FAILED', 'ENTRYPOINT_FAILED'),
)]
fn test_reentrant_token_privacy_invoke_claim_blocked() {
    let pool_address: ContractAddress = contract_address(0x111);
    let (cp_addr, cp) = deploy_conditional_pay(pool_address, 1040);
    let (token_addr, token) = deploy_reentrant_mock_token(1041);

    token.set_balance(cp_addr, 2000);
    set_block_timestamp(50);
    set_contract_address(pool_address);

    let claim_secret = 0xc1a01;
    let create_params = CreateParams {
        token: token_addr,
        amount: 1000,
        hashlock: compute_hashlock(claim_secret),
        refund_hash: compute_refund_hash(0x1e401),
        claim_after: 100,
        expires_at: 300,
        approver: contract_address(0x0),
        nonce: 0x1,
    };
    let payment_id = cp.compute_payment_id(create_params);
    cp.privacy_invoke(ConditionalPayAction::Create(create_params));

    set_block_timestamp(150);

    // Configure token to reenter privacy_invoke(Claim) when approve() is called
    token.set_reenter_target(cp_addr, payment_id);
    token.set_reenter_action(1);

    let claim_params = ClaimParams { payment_id, claim_preimage: claim_secret, note_id: 0x1 };
    cp.privacy_invoke(ConditionalPayAction::Claim(claim_params));
}

#[test]
#[should_panic(
    expected: ('CALLER_NOT_POOL', 'ENTRYPOINT_FAILED', 'ENTRYPOINT_FAILED', 'ENTRYPOINT_FAILED'),
)]
fn test_reentrant_token_privacy_invoke_refund_blocked() {
    let pool_address: ContractAddress = contract_address(0x111);
    let (cp_addr, cp) = deploy_conditional_pay(pool_address, 1050);
    let (token_addr, token) = deploy_reentrant_mock_token(1051);

    token.set_balance(cp_addr, 2000);
    set_block_timestamp(50);
    set_contract_address(pool_address);

    let refund_secret = 0x1e401;
    let create_params = CreateParams {
        token: token_addr,
        amount: 1000,
        hashlock: compute_hashlock(0xc1a01),
        refund_hash: compute_refund_hash(refund_secret),
        claim_after: 100,
        expires_at: 300,
        approver: contract_address(0x0),
        nonce: 0x1,
    };
    let payment_id = cp.compute_payment_id(create_params);
    cp.privacy_invoke(ConditionalPayAction::Create(create_params));

    set_block_timestamp(350);

    // Configure token to reenter privacy_invoke(Refund) when approve() is called
    token.set_reenter_target(cp_addr, payment_id);
    token.set_reenter_action(2);

    let refund_params = RefundParams { payment_id, refund_preimage: refund_secret, note_id: 0x1 };
    cp.privacy_invoke(ConditionalPayAction::Refund(refund_params));
}

#[test]
#[should_panic(
    expected: ('PAYMENT_NOT_ACTIVE', 'ENTRYPOINT_FAILED', 'ENTRYPOINT_FAILED', 'ENTRYPOINT_FAILED'),
)]
fn test_reentrant_token_approve_entrypoint_blocked() {
    let pool_address: ContractAddress = contract_address(0x111);
    let (cp_addr, cp) = deploy_conditional_pay(pool_address, 1060);
    let (token_addr, token) = deploy_reentrant_mock_token(1061);

    token.set_balance(cp_addr, 2000);
    set_block_timestamp(50);
    set_contract_address(pool_address);

    let claim_secret = 0xc1a01;
    let create_params = CreateParams {
        token: token_addr,
        amount: 1000,
        hashlock: compute_hashlock(claim_secret),
        refund_hash: compute_refund_hash(0x1e401),
        claim_after: 100,
        expires_at: 300,
        approver: token_addr, // Set token as approver to test state guard
        nonce: 0x1,
    };
    let payment_id = cp.compute_payment_id(create_params);
    cp.privacy_invoke(ConditionalPayAction::Create(create_params));

    // Approver approves initially
    set_contract_address(token_addr);
    cp.approve(payment_id);

    set_block_timestamp(150);
    set_contract_address(pool_address);

    // Configure token to attempt approve(payment_id) during settlement approve()
    token.set_reenter_target(cp_addr, payment_id);
    token.set_reenter_action(3);

    let claim_params = ClaimParams { payment_id, claim_preimage: claim_secret, note_id: 0x1 };
    cp.privacy_invoke(ConditionalPayAction::Claim(claim_params));
}
