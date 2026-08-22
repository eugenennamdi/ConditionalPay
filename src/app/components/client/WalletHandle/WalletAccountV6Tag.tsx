import styles from "../../../uni.module.css";
import { CONDITIONAL_PAY_MAINNET } from "@/utils/constants";

const MAINNET_TRANSACTIONS = [
  {
    label: "TX1 CREATE A",
    hash: "0x47edc8e74fc08c4726a817a23085a2ae2dd95590fb6a32d3b3c5b5159e586e6",
    block: 13701781,
    transition: "UNINITIALIZED -> ACTIVE",
    event: "PaymentCreated",
  },
  {
    label: "TX2 CLAIM A",
    hash: "0xde61c431a92dabc7b8672cd08cdce0b479b83ca261c0591992a84e6e7779b7",
    block: 13704626,
    transition: "ACTIVE -> CLAIMED",
    event: "PaymentClaimed",
  },
  {
    label: "TX3 CREATE B",
    hash: "0x2f2f88ab25f64a619aa05dcaff7c2af85efc6cd086a229696ac8edc3bdd6d26",
    block: 13707204,
    transition: "UNINITIALIZED -> ACTIVE",
    event: "PaymentCreated",
  },
  {
    label: "TX4 REFUND B",
    hash: "0x64cfec311d340f97fb0d9245de01ab36f3267259ac162290265e55ca99dd88d",
    block: 13708549,
    transition: "ACTIVE -> REFUNDED",
    event: "PaymentRefunded",
  },
] as const;

function shortHash(value: string): string {
  return `${value.slice(0, 10)}...${value.slice(-8)}`;
}

export default function WalletAccountV6Tag() {
  return (
    <section className={styles.panel} aria-labelledby="mainnet-evidence-heading">
      <div className={styles.inputBlock}>
        <div className={styles.inputLabel}>ConditionalPay Mainnet</div>
        <div className={styles.inputMain}>
          <h2 id="mainnet-evidence-heading" className={styles.bigValue}>
            Lifecycle verified
          </h2>
        </div>
        <div className={styles.subLine}>
          <span>CREATE / CLAIM / CREATE / REFUND</span>
          <span className={styles.netOk}>Final liability: 0 STRK</span>
        </div>
      </div>

      <div className={styles.warn}>
        Mainnet execution is frozen for submission. This public build contains no transaction,
        recovery, signing, proof-generation, or deployment controls.
      </div>

      <div className={styles.receipt}>
        <div className={styles.receiptHead}>
          <span className={styles.receiptIcon}>✓</span>
          <span>Verified deployment</span>
        </div>
        <div className={styles.receiptRows}>
          <div className={styles.receiptRow}>
            <span className={styles.receiptLabel}>Network</span>
            <span className={styles.receiptValue}>Starknet Mainnet</span>
          </div>
          <div className={styles.receiptRow}>
            <span className={styles.receiptLabel}>Contract</span>
            <a
              className={styles.receiptLink}
              href={`https://voyager.online/contract/${CONDITIONAL_PAY_MAINNET}`}
              target="_blank"
              rel="noreferrer"
            >
              {shortHash(CONDITIONAL_PAY_MAINNET)} ↗
            </a>
          </div>
          <div className={styles.receiptRow}>
            <span className={styles.receiptLabel}>Payment A</span>
            <span className={styles.receiptValue}>CLAIMED</span>
          </div>
          <div className={styles.receiptRow}>
            <span className={styles.receiptLabel}>Payment B</span>
            <span className={styles.receiptValue}>REFUNDED</span>
          </div>
        </div>
      </div>

      {MAINNET_TRANSACTIONS.map((transaction) => (
        <div className={styles.receipt} key={transaction.hash}>
          <div className={styles.receiptHead}>
            <span className={styles.receiptIcon}>✓</span>
            <span>{transaction.label}</span>
          </div>
          <div className={styles.receiptRows}>
            <div className={styles.receiptRow}>
              <span className={styles.receiptLabel}>Transition</span>
              <span className={styles.receiptValue}>{transaction.transition}</span>
            </div>
            <div className={styles.receiptRow}>
              <span className={styles.receiptLabel}>Event</span>
              <span className={styles.receiptValue}>{transaction.event}</span>
            </div>
            <div className={styles.receiptRow}>
              <span className={styles.receiptLabel}>Block</span>
              <span className={styles.receiptValue}>{transaction.block}</span>
            </div>
            <div className={styles.receiptRow}>
              <span className={styles.receiptLabel}>Transaction</span>
              <a
                className={styles.receiptLink}
                href={`https://voyager.online/tx/${transaction.hash}`}
                target="_blank"
                rel="noreferrer"
              >
                {shortHash(transaction.hash)} ↗
              </a>
            </div>
          </div>
        </div>
      ))}
    </section>
  );
}
