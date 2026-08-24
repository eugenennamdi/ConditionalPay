export type ClaimChoice = 'immediately' | 'custom';
export type RefundPreset = '1h' | '24h' | '7d' | 'custom';

export interface CreateFormData {
  amount: string;
  claimChoice: ClaimChoice;
  customClaimDate: string;
  refundPreset: RefundPreset;
  customRefundDate: string;
}

export interface PlannedCreate {
  token: string;
  amount: bigint;
  amountFormatted: string;
  claim_after: bigint;
  expires_at: bigint;
  approver: string;
  nonce: string;
  claimPreimage: string;
  refundPreimage: string;
  hashlock: string;
  refund_hash: string;
  paymentId: string;
  refundDateFormatted: string;
  claimDateFormatted: string;
}

export type CreateStep =
  | 'EDITING'
  | 'REVIEWING'
  | 'AWAITING_WALLET'
  | 'SUBMITTED'
  | 'PENDING'
  | 'STATUS_UNKNOWN'
  | 'ACCEPTED'
  | 'VERIFYING'
  | 'VERIFIED'
  | 'DEGRADED_VERIFICATION'
  | 'REVERTED';
