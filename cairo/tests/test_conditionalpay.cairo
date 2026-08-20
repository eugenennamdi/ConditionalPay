use conditionalpay::{
    ClaimParams, ConditionalPay, ConditionalPayAction, CreateParams, OpenNoteDeposit, RefundParams,
    domains, payment_state,
};
use core::panic_with_felt252;
use starknet::ContractAddress;
use starknet::testing::set_caller_address;

fn contract_address(val: felt252) -> ContractAddress {
    val.try_into().unwrap()
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
    let mut state = ConditionalPay::contract_state_for_testing();
    ConditionalPay::constructor(ref state, pool_address);

    // Test get_strk20_pool
    let stored_pool = ConditionalPay::ConditionalPayImpl::get_strk20_pool(@state);
    assert(stored_pool == pool_address, 'Pool address mismatch');

    // Test uninitialized payment
    let payment = ConditionalPay::ConditionalPayImpl::get_payment(@state, 0x999);
    assert(payment.state == payment_state::UNINITIALIZED, 'State must be 0');
    assert(payment.amount == 0, 'Amount must be 0');
    assert(payment.hashlock == 0, 'Hashlock must be 0');
    assert(payment.refund_hash == 0, 'Refund hash must be 0');
    assert(payment.approved == false, 'Approved must be false');

    // Test initial locked liability
    let token: ContractAddress = contract_address(0xabc);
    let locked = ConditionalPay::ConditionalPayImpl::get_locked_by_token(@state, token);
    assert(locked == 0, 'Initial liability must be 0');
}

#[test]
#[should_panic(expected: ('CALLER_NOT_POOL',))]
fn test_privacy_invoke_reverts_if_not_pool() {
    let pool_address: ContractAddress = contract_address(0x123456789);
    let unauthorized_caller: ContractAddress = contract_address(0x99999);
    let mut state = ConditionalPay::contract_state_for_testing();
    ConditionalPay::constructor(ref state, pool_address);

    set_caller_address(unauthorized_caller);

    let action = ConditionalPayAction::Create(
        CreateParams {
            token: contract_address(0xabc),
            amount: 1000,
            hashlock: 0x111,
            refund_hash: 0x222,
            claim_after: 100,
            expires_at: 200,
            approver: contract_address(0x0),
            nonce: 0x333,
        },
    );

    ConditionalPay::ConditionalPayImpl::privacy_invoke(ref state, action);
}

#[test]
#[should_panic(expected: ('NOT_IMPLEMENTED',))]
fn test_privacy_invoke_scaffold_reverts_not_implemented() {
    let pool_address: ContractAddress = contract_address(0x123456789);
    let mut state = ConditionalPay::contract_state_for_testing();
    ConditionalPay::constructor(ref state, pool_address);

    set_caller_address(pool_address);

    let action = ConditionalPayAction::Create(
        CreateParams {
            token: contract_address(0xabc),
            amount: 1000,
            hashlock: 0x111,
            refund_hash: 0x222,
            claim_after: 100,
            expires_at: 200,
            approver: contract_address(0x0),
            nonce: 0x333,
        },
    );

    ConditionalPay::ConditionalPayImpl::privacy_invoke(ref state, action);
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

    // Exact layout check: 3 felts [note_id, token, amount]
    assert(serialized.len() == 3, 'Deposit must be 3 felts');
    assert(*serialized.at(0) == 0x101, 'note_id mismatch');
    assert(*serialized.at(1) == 0x202, 'token mismatch');
    assert(*serialized.at(2) == 0x303, 'amount mismatch');

    // Span<OpenNoteDeposit> serialization check (as returned by privacy_invoke)
    let deposits = array![deposit].span();
    let mut span_serialized = ArrayTrait::new();
    deposits.serialize(ref span_serialized);

    // Layout: [len: 1, note_id, token, amount]
    assert(span_serialized.len() == 4, 'Span must be 4 felts');
    assert(*span_serialized.at(0) == 1, 'Span length prefix must be 1');
    assert(*span_serialized.at(1) == 0x101, 'Span note_id mismatch');
    assert(*span_serialized.at(2) == 0x202, 'Span token mismatch');
    assert(*span_serialized.at(3) == 0x303, 'Span amount mismatch');

    // Empty Span<OpenNoteDeposit> check (CREATE output)
    let empty_deposits: Span<OpenNoteDeposit> = array![].span();
    let mut empty_serialized = ArrayTrait::new();
    empty_deposits.serialize(ref empty_serialized);
    assert(empty_serialized.len() == 1, 'Empty span must be 1 felt');
    assert(*empty_serialized.at(0) == 0, 'Empty span length must be 0');
}

#[test]
fn test_enum_discriminant_calldata_decoding() {
    // 0 = Create
    let mut raw_create = array![
        0, // Discriminant 0
        0xabc, // token
        1000, // amount
        0x111, // hashlock
        0x222, // refund_hash
        100, // claim_after
        200, // expires_at
        0x444, // approver
        0x555 // nonce
    ];
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

    // 1 = Claim
    let mut raw_claim = array![
        1, // Discriminant 1
        0xaaa, // payment_id
        0xbbb, // claim_preimage
        0xccc // note_id
    ];
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

    // 2 = Refund
    let mut raw_refund = array![
        2, // Discriminant 2
        0xaaa, // payment_id
        0xbbb, // refund_preimage
        0xccc // note_id
    ];
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
