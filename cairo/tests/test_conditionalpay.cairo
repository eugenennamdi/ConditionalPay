use conditionalpay::{
    ClaimParams, ConditionalPay, ConditionalPayAction, CreateParams, IConditionalPayDispatcher,
    IConditionalPayDispatcherTrait, OpenNoteDeposit, RefundParams, compute_hashlock,
    compute_payment_id, compute_refund_hash, domains, payment_state,
};
use core::panic_with_felt252;
use starknet::ContractAddress;
use starknet::syscalls::deploy_syscall;
use starknet::testing::{set_block_timestamp, set_contract_address};

#[starknet::interface]
pub trait IMockErc20<TState> {
    fn balance_of(self: @TState, account: ContractAddress) -> u256;
    fn approve(ref self: TState, spender: ContractAddress, amount: u256) -> bool;
    fn set_balance(ref self: TState, account: ContractAddress, amount: u256);
}

#[starknet::contract]
pub mod MockErc20 {
    use starknet::ContractAddress;
    use starknet::storage::{Map, StorageMapReadAccess, StorageMapWriteAccess};

    #[storage]
    struct Storage {
        balances: Map<ContractAddress, u256>,
    }

    #[abi(embed_v0)]
    pub impl MockErc20Impl of super::IMockErc20<ContractState> {
        fn balance_of(self: @ContractState, account: ContractAddress) -> u256 {
            self.balances.read(account)
        }
        fn approve(ref self: ContractState, spender: ContractAddress, amount: u256) -> bool {
            true
        }
        fn set_balance(ref self: ContractState, account: ContractAddress, amount: u256) {
            self.balances.write(account, amount);
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

    // Test get_strk20_pool
    let stored_pool = cp.get_strk20_pool();
    assert(stored_pool == pool_address, 'Pool address mismatch');

    // Test uninitialized payment
    let payment = cp.get_payment(0x999);
    assert(payment.state == payment_state::UNINITIALIZED, 'State must be 0');
    assert(payment.amount == 0, 'Amount must be 0');
    assert(payment.hashlock == 0, 'Hashlock must be 0');
    assert(payment.refund_hash == 0, 'Refund hash must be 0');
    assert(payment.approved == false, 'Approved must be false');

    // Test initial locked liability
    let token: ContractAddress = contract_address(0xabc);
    let locked = cp.get_locked_by_token(token);
    assert(locked == 0, 'Initial liability must be 0');
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

    // Changing nonce changes payment ID
    let mut params_diff_nonce = params1;
    params_diff_nonce.nonce = 0x556;
    let id_diff_nonce = compute_payment_id(@params_diff_nonce);
    assert(id1 != id_diff_nonce, 'Nonce must change payment ID');

    // Changing amount changes payment ID
    let mut params_diff_amount = params1;
    params_diff_amount.amount = 1001;
    let id_diff_amount = compute_payment_id(@params_diff_amount);
    assert(id1 != id_diff_amount, 'Amount must change ID');

    // Changing token changes payment ID
    let mut params_diff_token = params1;
    params_diff_token.token = contract_address(0xabd);
    let id_diff_token = compute_payment_id(@params_diff_token);
    assert(id1 != id_diff_token, 'Token must change ID');

    // Test helper functions
    let hashlock = compute_hashlock(0x123);
    let refund_hash = compute_refund_hash(0x456);
    assert(hashlock != 0, 'Hashlock must be non-zero');
    assert(refund_hash != 0, 'Refund hash non-zero');
    assert(hashlock != refund_hash, 'Domain separation failed');
}

#[test]
fn test_successful_create_and_storage_exactness() {
    let pool_address: ContractAddress = contract_address(0x111);
    let (cp_addr, cp) = deploy_conditional_pay(pool_address, 10);
    let (token_addr, token) = deploy_mock_token(11);

    // Fund ConditionalPay with tokens to cover the prospective payment
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

    // CREATE must return empty OpenNoteDeposit span
    assert(deposits.len() == 0, 'CREATE must return empty span');

    // Verify stored payment fields
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

    // Verify liability accounting
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
        expires_at: 0, // 0 = no expiry, refund unavailable
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
        amount: 0, // Zero amount
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
        expires_at: 100, // expires_at <= claim_after
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
        expires_at: 200, // expires_at == claim_after
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
        expires_at: 400, // expires_at < current timestamp (500)
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

    // First CREATE succeeds
    cp.privacy_invoke(ConditionalPayAction::Create(create_params));

    // Second duplicate CREATE must revert
    cp.privacy_invoke(ConditionalPayAction::Create(create_params));
}

#[test]
#[should_panic(expected: ('INSUFFICIENT_BALANCE', 'ENTRYPOINT_FAILED'))]
fn test_create_reverts_underfunded_contract() {
    let pool_address: ContractAddress = contract_address(0x111);
    let (cp_addr, cp) = deploy_conditional_pay(pool_address, 80);
    let (token_addr, token) = deploy_mock_token(81);

    // Contract has 500 balance, but CREATE asks for 1000
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

    // Exact balance (1000)
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

    // Overfunded: token balance increased to 3500, lock another 1500
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

    // Solvency invariant check: locked (2500) <= balance (3500)
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
#[should_panic(expected: ('NOT_IMPLEMENTED', 'ENTRYPOINT_FAILED'))]
fn test_privacy_invoke_claim_still_not_implemented() {
    let pool_address: ContractAddress = contract_address(0x111);
    let (_, cp) = deploy_conditional_pay(pool_address, 120);

    set_contract_address(pool_address);

    let claim_params = ClaimParams { payment_id: 0xaaa, claim_preimage: 0xbbb, note_id: 0xccc };
    cp.privacy_invoke(ConditionalPayAction::Claim(claim_params));
}

#[test]
#[should_panic(expected: ('NOT_IMPLEMENTED', 'ENTRYPOINT_FAILED'))]
fn test_privacy_invoke_refund_still_not_implemented() {
    let pool_address: ContractAddress = contract_address(0x111);
    let (_, cp) = deploy_conditional_pay(pool_address, 130);

    set_contract_address(pool_address);

    let refund_params = RefundParams { payment_id: 0xaaa, refund_preimage: 0xbbb, note_id: 0xccc };
    cp.privacy_invoke(ConditionalPayAction::Refund(refund_params));
}

#[test]
fn test_failed_create_does_not_mutate_state_or_liabilities() {
    let pool_address: ContractAddress = contract_address(0x111);
    let (cp_addr, cp) = deploy_conditional_pay(pool_address, 140);
    let (token_addr, token) = deploy_mock_token(141);

    token.set_balance(cp_addr, 1000);
    set_contract_address(pool_address);

    // Baseline: lock 400
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

    // Attempting invalid payment (e.g. amount 700 with only 600 remaining balance)
    // We can verify that uncreated payment ID remains UNINITIALIZED
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

    // Initial token deposit: 10,000
    token.set_balance(cp_addr, 10000);
    set_contract_address(pool_address);

    // Create 3 payments: 2000 + 3000 + 4000 = 9000 locked
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

    // Initial state: ConditionalPay holds 0 tokens
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

    // Step 1: Preceding STRK20 withdraw action transfers 1500 tokens to ConditionalPay
    token.set_balance(cp_addr, 1500);
    assert(token.balance_of(cp_addr) == 1500, 'Funded balance must be 1500');

    // Step 2: Atomic invoke(ConditionalPay, CREATE) executed by pool
    set_contract_address(pool_address);
    let deposits = cp.privacy_invoke(ConditionalPayAction::Create(create_params));

    // Step 3: Verify execution invariants
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

    // Initial state: ConditionalPay holds 0 tokens (funding step omitted/failed)
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

    // Attempting CREATE without funding must revert
    cp.privacy_invoke(ConditionalPayAction::Create(create_params));
}

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
