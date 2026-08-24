import { Payment } from '@conditionalpay/sdk';

export type SettlementMode = 'claim' | 'refund';

export type SettlementStep =
  | 'IMPORT'
  | 'CREATOR_CHOICE'
  | 'DERIVE_CLAIM_ACCESS'
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

export interface ImportedClaimCredential {
  paymentId: string;
  claimPreimage: string;
  isSelfClaim?: boolean;
}

export interface ImportedRefundCredential {
  paymentId: string;
  refundPreimage: string;
}

export interface SettlementPreflight {
  paymentId: string;
  payment: Payment;
  amountFormatted: string;
  token: string;
  claimDateFormatted: string;
  refundDateFormatted: string;
  isClaimAvailable: boolean;
  isRefundAvailable: boolean;
  claimBlockedReason?: string;
  refundBlockedReason?: string;
  requiresApproval: boolean;
}

export interface SettlementResultState {
  txHash: string;
  step: SettlementStep;
  mode: SettlementMode;
  amountFormatted: string;
  paymentId: string;
  errorMessage?: string;
}
