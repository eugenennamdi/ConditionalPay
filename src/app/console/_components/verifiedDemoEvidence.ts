/**
 * Canonical Mainnet evidence for the ConditionalPay Verified Demo.
 * Read-only. These payment IDs and hashes reflect completed, authentic onchain Mainnet settlement.
 *
 * Security Invariant: This module is isolated to Verified Demo and must NEVER be imported
 * into executable transaction flows.
 */

export const CONDITIONAL_PAY_CONTRACT =
  '0x0166e31803cfab50383d5b636b86a5646233881fad3a2fb89354da63f6cdb483' as const;

export const STRK20_POOL_CONTRACT =
  '0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a' as const;

export const STRK_TOKEN_ADDRESS =
  '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d' as const;

export const EVIDENCE_TERMINAL_BLOCK = 13_708_549 as const;

export interface EvidenceTransaction {
  phase: 'CREATE' | 'CLAIM' | 'REFUND';
  txName: string;
  hash: string;
  block: number;
  status: 'SUCCEEDED';
  finality: 'ACCEPTED_ON_L1';
  voyagerUrl: string;
}

export interface EvidencePayment {
  id: 'paymentA' | 'paymentB';
  name: string;
  pathName: string;
  pathDescription: string;
  paymentId: string;
  amountFormatted: string;
  tokenSymbol: string;
  terminalState: 'CLAIMED' | 'REFUNDED';
  createTx: EvidenceTransaction;
  settleTx: EvidenceTransaction;
  conditions: {
    label: string;
    value: string;
    detail: string;
  }[];
}

export const EVIDENCE_PAYMENT_A: EvidencePayment = {
  id: 'paymentA',
  name: 'Payment A',
  pathName: 'CLAIM Path',
  pathDescription: 'Hashlock-authorized settlement',
  paymentId: '0x19b3f6176561b6054a803a0d499c73252413eaa8756dda3990f605ef9273ac3',
  amountFormatted: '0.1 STRK',
  tokenSymbol: 'STRK',
  terminalState: 'CLAIMED',
  createTx: {
    phase: 'CREATE',
    txName: 'TX1',
    hash: '0x47edc8e74fc08c4726a817a23085a2ae2dd95590fb6a32d3b3c5b5159e586e6',
    block: 13_701_781,
    status: 'SUCCEEDED',
    finality: 'ACCEPTED_ON_L1',
    voyagerUrl:
      'https://voyager.online/tx/0x47edc8e74fc08c4726a817a23085a2ae2dd95590fb6a32d3b3c5b5159e586e6',
  },
  settleTx: {
    phase: 'CLAIM',
    txName: 'TX2',
    hash: '0xde61c431a92dabc7b8672cd08cdce0b479b83ca261c0591992a84e6e7779b7',
    block: 13_704_626,
    status: 'SUCCEEDED',
    finality: 'ACCEPTED_ON_L1',
    voyagerUrl:
      'https://voyager.online/tx/0xde61c431a92dabc7b8672cd08cdce0b479b83ca261c0591992a84e6e7779b7',
  },
  conditions: [
    {
      label: 'Hashlock',
      value: 'Verified',
      detail: 'Poseidon preimage revealed and verified onchain',
    },
    {
      label: 'Claim window',
      value: 'Valid',
      detail: 'Claimed before expiry threshold',
    },
    {
      label: 'Approval',
      value: 'Not required',
      detail: 'Standard un-gated conditional payment (approver 0x0)',
    },
  ],
};

export const EVIDENCE_PAYMENT_B: EvidencePayment = {
  id: 'paymentB',
  name: 'Payment B',
  pathName: 'REFUND Path',
  pathDescription: 'Post-expiry settlement',
  paymentId: '0x7e0d3d4225351e4436e7b5b62c28412fb2b876ab904dda8a51c0be19aeba134',
  amountFormatted: '0.1 STRK',
  tokenSymbol: 'STRK',
  terminalState: 'REFUNDED',
  createTx: {
    phase: 'CREATE',
    txName: 'TX3',
    hash: '0x2f2f88ab25f64a619aa05dcaff7c2af85efc6cd086a229696ac8edc3bdd6d26',
    block: 13_707_204,
    status: 'SUCCEEDED',
    finality: 'ACCEPTED_ON_L1',
    voyagerUrl:
      'https://voyager.online/tx/0x2f2f88ab25f64a619aa05dcaff7c2af85efc6cd086a229696ac8edc3bdd6d26',
  },
  settleTx: {
    phase: 'REFUND',
    txName: 'TX4',
    hash: '0x64cfec311d340f97fb0d9245de01ab36f3267259ac162290265e55ca99dd88d',
    block: 13_708_549,
    status: 'SUCCEEDED',
    finality: 'ACCEPTED_ON_L1',
    voyagerUrl:
      'https://voyager.online/tx/0x64cfec311d340f97fb0d9245de01ab36f3267259ac162290265e55ca99dd88d',
  },
  conditions: [
    {
      label: 'Refund hash',
      value: 'Verified',
      detail: 'Poseidon refund preimage authenticated',
    },
    {
      label: 'Expiry',
      value: 'Reached',
      detail: 'Current block >= expiry threshold at settlement',
    },
    {
      label: 'Approval',
      value: 'Not required',
      detail: 'Standard un-gated conditional payment (approver 0x0)',
    },
  ],
};

export const EVIDENCE_LIABILITY_PROOF = {
  label: 'HISTORICAL LIABILITY',
  value: '0 STRK',
  context: 'After the verified A/B lifecycle · Block 13,708,549',
  block: EVIDENCE_TERMINAL_BLOCK,
} as const;
