import type { PaymentBTx3Configuration } from "./paymentBCreateExecution";

// Populated only after the localhost TX3 panel and its validation path are ready.
// This module contains public CREATE parameters only; bearer credentials remain solely
// in the encrypted recovery envelope outside the repository.
export const PAYMENT_B_TX3_CONFIGURATION: PaymentBTx3Configuration = {
  paymentId: "0x7e0d3d4225351e4436e7b5b62c28412fb2b876ab904dda8a51c0be19aeba134",
  token: "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
  amount: "100000000000000000",
  hashlock: "0x6a585e4b1ba73277dbb7d05d9b44b3aba17a491bb35275b70925a025ae5e735",
  refundHash: "0x3ec710a951d209164cccefccf6a77f14926ae2d32169cc6b32face0fd1495a0",
  nonce: "0x16b8282d39d6255a76ad402164fc29e3",
  generatedAtUnix: "1787430818",
  expiresAtUnix: "1787431718",
  envelopeFilename: "payment-b-7e0d3d422535.encrypted.json",
  recoveryRoundtripVerified: true,
};
