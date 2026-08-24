import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'ConditionalPay Console · Verified Settlement',
  description:
    'Operational console for ConditionalPay: live-verified onchain settlement proofs, conditional lifecycles, and developer infrastructure on Starknet Mainnet.',
};

export default function ConsoleLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
