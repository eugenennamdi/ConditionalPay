#!/usr/bin/env node

/**
 * Generates cairo/tests/generated_test_vectors.cairo from packages/sdk/test_vectors.json
 * Supports --check flag for CI / verification to assert zero drift.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const jsonPath = path.resolve(rootDir, 'packages/sdk/test_vectors.json');
const targetCairoPath = path.resolve(rootDir, 'cairo/tests/generated_test_vectors.cairo');

const isCheckMode = process.argv.includes('--check');

if (!fs.existsSync(jsonPath)) {
  console.error(`Error: test_vectors.json not found at ${jsonPath}`);
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

let cairoCode = `// =============================================================================
// AUTO-GENERATED — DO NOT EDIT
// Source: packages/sdk/test_vectors.json
// Generator: scripts/generate-cairo-vectors.mjs
// =============================================================================

use conditionalpay::{CreateParams, compute_hashlock, compute_payment_id, compute_refund_hash};
use starknet::ContractAddress;

fn contract_address(val: felt252) -> ContractAddress {
    val.try_into().unwrap()
}
`;

for (let i = 0; i < data.vectors.length; i++) {
  const v = data.vectors[i];
  const fnName = `test_generated_${v.name}`;

  const tokenLine = v.token.length > 20
    ? `let token: ContractAddress = contract_address(\n        ${v.token},\n    );`
    : `let token: ContractAddress = contract_address(${v.token});`;

  const approverLine = v.approver.length > 20
    ? `let approver: ContractAddress = contract_address(\n        ${v.approver},\n    );`
    : `let approver: ContractAddress = contract_address(${v.approver});`;

  cairoCode += `
#[test]
fn ${fnName}() {
    ${tokenLine}
    ${approverLine}
    let claim_preimage = ${v.claim_preimage};
    let refund_preimage = ${v.refund_preimage};

    let claim_hash = compute_hashlock(claim_preimage);
    assert(
        claim_hash == ${v.claim_hash},
        'Vector ${i + 1} claim_hash mismatch',
    );

    let refund_hash = compute_refund_hash(refund_preimage);
    assert(
        refund_hash == ${v.refund_hash},
        'Vector ${i + 1} refund_hash mismatch',
    );

    let params = CreateParams {
        token,
        amount: ${v.amount},
        hashlock: claim_hash,
        refund_hash,
        claim_after: ${v.claim_after},
        expires_at: ${v.expires_at},
        approver,
        nonce: ${v.nonce},
    };
    let payment_id = compute_payment_id(@params);
    assert(
        payment_id == ${v.payment_id},
        'Vector ${i + 1} payment_id mismatch',
    );
}
`;
}

if (isCheckMode) {
  if (!fs.existsSync(targetCairoPath)) {
    console.error(`Error: Target Cairo file ${targetCairoPath} does not exist.`);
    process.exit(1);
  }
  const existing = fs.readFileSync(targetCairoPath, 'utf8');
  if (existing.trim() !== cairoCode.trim()) {
    console.error(`Drift detected in ${targetCairoPath}. Run "npm run generate:test-vectors" to update.`);
    process.exit(1);
  }
  console.log(`✓ Test vectors are in sync (${data.vectors.length} vectors). Zero drift.`);
  process.exit(0);
}

fs.writeFileSync(targetCairoPath, cairoCode);
console.log(`✓ Generated ${targetCairoPath} from packages/sdk/test_vectors.json (${data.vectors.length} vectors)`);
