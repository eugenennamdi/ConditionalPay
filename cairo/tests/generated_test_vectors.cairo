// =============================================================================
// AUTO-GENERATED — DO NOT EDIT
// Source: packages/sdk/test_vectors.json
// Generator: scripts/generate-cairo-vectors.mjs
// =============================================================================

use conditionalpay::{CreateParams, compute_hashlock, compute_payment_id, compute_refund_hash};
use starknet::ContractAddress;

fn contract_address(val: felt252) -> ContractAddress {
    val.try_into().unwrap()
}

#[test]
fn test_generated_vector_1_standard_unapproved_1strk() {
    let token: ContractAddress = contract_address(
        0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d,
    );
    let approver: ContractAddress = contract_address(0x0);
    let claim_preimage = 0xc1a01;
    let refund_preimage = 0x1e401;

    let claim_hash = compute_hashlock(claim_preimage);
    assert(
        claim_hash == 0x7b52c408bddeaaf8cc36a4c6c3bfd24c7a0e7b241b9fcad83c2c8173cd01261,
        'Vector 1 claim_hash mismatch',
    );

    let refund_hash = compute_refund_hash(refund_preimage);
    assert(
        refund_hash == 0x30c804f6f6b24dd19f29ff4bc2b54f1f44cb336a90dca293b80b413c0599ac5,
        'Vector 1 refund_hash mismatch',
    );

    let params = CreateParams {
        token,
        amount: 1000000000000000000,
        hashlock: claim_hash,
        refund_hash,
        claim_after: 100,
        expires_at: 300,
        approver,
        nonce: 0x1,
    };
    let payment_id = compute_payment_id(@params);
    assert(
        payment_id == 0x5f63ac970629bfb6539bb18df38d3a34cf8ff7e1ed9a2300d8315f38f5d166,
        'Vector 1 payment_id mismatch',
    );
}

#[test]
fn test_generated_vector_2_configured_approver_small_amount() {
    let token: ContractAddress = contract_address(
        0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d,
    );
    let approver: ContractAddress = contract_address(
        0x53b40a647cedfca6ca84f542a0fe3673603190d52737e333680420fa390776a,
    );
    let claim_preimage = 0xaa11;
    let refund_preimage = 0xbb22;

    let claim_hash = compute_hashlock(claim_preimage);
    assert(
        claim_hash == 0xa2da475f5762d5b13ee9196b07333213e7ff39452ce32c3e410429825db71d,
        'Vector 2 claim_hash mismatch',
    );

    let refund_hash = compute_refund_hash(refund_preimage);
    assert(
        refund_hash == 0x2e329b9232cd2745e9ee2df8d4d511c75441d3c03233e4085992deb07db349,
        'Vector 2 refund_hash mismatch',
    );

    let params = CreateParams {
        token,
        amount: 500,
        hashlock: claim_hash,
        refund_hash,
        claim_after: 0,
        expires_at: 1000,
        approver,
        nonce: 0x2a,
    };
    let payment_id = compute_payment_id(@params);
    assert(
        payment_id == 0x491a56f25d50d867ff4e068928c0d152229ddfc6c150eed0854014105334a9,
        'Vector 2 payment_id mismatch',
    );
}

#[test]
fn test_generated_vector_3_no_expiry_eth_amount() {
    let token: ContractAddress = contract_address(
        0x49d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7,
    );
    let approver: ContractAddress = contract_address(0x0);
    let claim_preimage = 0x778899;
    let refund_preimage = 0x112233;

    let claim_hash = compute_hashlock(claim_preimage);
    assert(
        claim_hash == 0x57a6b9c9c5140904005926bfb24b41edfcb7e4bc7d8eacbf3d69879a91c4f49,
        'Vector 3 claim_hash mismatch',
    );

    let refund_hash = compute_refund_hash(refund_preimage);
    assert(
        refund_hash == 0x6fe32e4c3785abec5152a1509007c59350f54cde240aea3937a3766a4d9ead6,
        'Vector 3 refund_hash mismatch',
    );

    let params = CreateParams {
        token,
        amount: 2500000000000000000,
        hashlock: claim_hash,
        refund_hash,
        claim_after: 500,
        expires_at: 0,
        approver,
        nonce: 0x64,
    };
    let payment_id = compute_payment_id(@params);
    assert(
        payment_id == 0x761ce52cf10e82bab4fd9cd771dbbe5d2ed3d0d5356af3f5d2cf13e00a8964f,
        'Vector 3 payment_id mismatch',
    );
}

#[test]
fn test_generated_vector_4_nonce_domain_variation() {
    let token: ContractAddress = contract_address(
        0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d,
    );
    let approver: ContractAddress = contract_address(0x0);
    let claim_preimage = 0xc1a01;
    let refund_preimage = 0x1e401;

    let claim_hash = compute_hashlock(claim_preimage);
    assert(
        claim_hash == 0x7b52c408bddeaaf8cc36a4c6c3bfd24c7a0e7b241b9fcad83c2c8173cd01261,
        'Vector 4 claim_hash mismatch',
    );

    let refund_hash = compute_refund_hash(refund_preimage);
    assert(
        refund_hash == 0x30c804f6f6b24dd19f29ff4bc2b54f1f44cb336a90dca293b80b413c0599ac5,
        'Vector 4 refund_hash mismatch',
    );

    let params = CreateParams {
        token,
        amount: 1000000000000000000,
        hashlock: claim_hash,
        refund_hash,
        claim_after: 100,
        expires_at: 300,
        approver,
        nonce: 0x2,
    };
    let payment_id = compute_payment_id(@params);
    assert(
        payment_id == 0x70ecf0f6d8927b1c685758b13b8011caa5a6c2747a666aa628fd044104f9f0a,
        'Vector 4 payment_id mismatch',
    );
}

#[test]
fn test_generated_vector_5_u128_max_bound_and_large_timestamps() {
    let token: ContractAddress = contract_address(
        0x53c5b25c9f7864944959f6d2b59f91d0e8a203732d038b36f5b161479c40064,
    );
    let approver: ContractAddress = contract_address(0x111222333);
    let claim_preimage = 0x987654321;
    let refund_preimage = 0x123456789;

    let claim_hash = compute_hashlock(claim_preimage);
    assert(
        claim_hash == 0x7fd7932866e5aaca45f04fdffb4b52aeb848c3d06f97c5e1923d6eecc3dabc5,
        'Vector 5 claim_hash mismatch',
    );

    let refund_hash = compute_refund_hash(refund_preimage);
    assert(
        refund_hash == 0x58de0d0f03f7efcff2ca7120152594246e329e7fc36ce650e8de76c943dec7e,
        'Vector 5 refund_hash mismatch',
    );

    let params = CreateParams {
        token,
        amount: 340282366920938463463374607431768211455,
        hashlock: claim_hash,
        refund_hash,
        claim_after: 1700000000,
        expires_at: 1800000000,
        approver,
        nonce: 0xf423f,
    };
    let payment_id = compute_payment_id(@params);
    assert(
        payment_id == 0x72644c3d151db7a4919c788f90e2796894c8ce0df0ba0369e46ba1bb373f6db,
        'Vector 5 payment_id mismatch',
    );
}

#[test]
fn test_generated_vector_6_minimal_edge_case() {
    let token: ContractAddress = contract_address(
        0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d,
    );
    let approver: ContractAddress = contract_address(0x0);
    let claim_preimage = 0x1;
    let refund_preimage = 0x2;

    let claim_hash = compute_hashlock(claim_preimage);
    assert(
        claim_hash == 0x22a69d2c8165f7380bf1f16676e68556cb045e4c907c7c9ed6914d379f5f88c,
        'Vector 6 claim_hash mismatch',
    );

    let refund_hash = compute_refund_hash(refund_preimage);
    assert(
        refund_hash == 0x2fd15805e90dbad7d77098a095845bc6503410d6c96a2649bca96d1dbdcd4a5,
        'Vector 6 refund_hash mismatch',
    );

    let params = CreateParams {
        token,
        amount: 1,
        hashlock: claim_hash,
        refund_hash,
        claim_after: 0,
        expires_at: 0,
        approver,
        nonce: 0x0,
    };
    let payment_id = compute_payment_id(@params);
    assert(
        payment_id == 0x2a7cb9f292f7604dcc28393d9b9ab1c06f7e7918b39492381ef5c01062e9fcf,
        'Vector 6 payment_id mismatch',
    );
}
