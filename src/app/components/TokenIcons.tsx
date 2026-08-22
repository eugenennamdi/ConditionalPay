import Image from "next/image";

// Real token logos, served from /public/tokens.

type IconProps = { size?: number; className?: string };

function coin(src: string, alt: string) {
  return function Coin({ size = 32, className }: IconProps) {
    return (
      <Image
        src={src}
        alt={alt}
        width={size}
        height={size}
        className={className}
        style={{ display: "block", borderRadius: "50%" }}
      />
    );
  };
}

export const StrkCoin = coin("/tokens/strk.png", "STRK");
export const EthCoin = coin("/tokens/eth.png", "ETH");
export const BtcCoin = coin("/tokens/btc.webp", "BTC");
export const UsdcCoin = coin("/tokens/usdc.webp", "USDC");
export const ZecCoin = coin("/tokens/zec.png", "ZEC");
