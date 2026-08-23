import styles from '../../../uni.module.css';

const PAYMENTS = [
  {
    name: 'Payment A',
    outcome: 'CLAIMED',
    steps: [
      {
        transaction: 'TX1',
        phase: 'CREATE',
        state: 'ACTIVE',
        event: 'PaymentCreated',
        block: '13,701,781',
        finality: 'ACCEPTED_ON_L1',
        hash: '0x47edc8e74fc08c4726a817a23085a2ae2dd95590fb6a32d3b3c5b5159e586e6',
      },
      {
        transaction: 'TX2',
        phase: 'CLAIM',
        state: 'CLAIMED',
        event: 'PaymentClaimed',
        block: '13,704,626',
        finality: 'ACCEPTED_ON_L2',
        hash: '0xde61c431a92dabc7b8672cd08cdce0b479b83ca261c0591992a84e6e7779b7',
      },
    ],
  },
  {
    name: 'Payment B',
    outcome: 'REFUNDED',
    steps: [
      {
        transaction: 'TX3',
        phase: 'CREATE',
        state: 'ACTIVE',
        event: 'PaymentCreated',
        block: '13,707,204',
        finality: 'ACCEPTED_ON_L2',
        hash: '0x2f2f88ab25f64a619aa05dcaff7c2af85efc6cd086a229696ac8edc3bdd6d26',
      },
      {
        transaction: 'TX4',
        phase: 'REFUND',
        state: 'REFUNDED',
        event: 'PaymentRefunded',
        block: '13,708,549',
        finality: 'ACCEPTED_ON_L2',
        hash: '0x64cfec311d340f97fb0d9245de01ab36f3267259ac162290265e55ca99dd88d',
      },
    ],
  },
] as const;

function ExternalLinkIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4 12 12 4M6 4h6v6" />
    </svg>
  );
}

export default function WalletAccountV6Tag() {
  return (
    <section id="evidence" className={styles.evidenceSection} aria-labelledby="mainnet-evidence-heading">
      <div className={styles.evidenceIntro}>
        <div>
          <p className={styles.kicker}>Verified Mainnet lifecycle</p>
          <h2 id="mainnet-evidence-heading">Both terminal paths, proven onchain.</h2>
        </div>
        <p>
          Two live payments exercised CLAIM and REFUND against the deployed ConditionalPay
          contract. These are authenticated Starknet Mainnet transactions, not simulations.
        </p>
      </div>

      <div className={styles.proofSummary} aria-label="Mainnet lifecycle statistics">
        <p><strong>4</strong> verified Mainnet transactions</p>
        <p><strong>2</strong> terminal settlement paths</p>
        <p><strong>0</strong> final locked STRK liability</p>
      </div>

      <div className={styles.paymentTraces}>
        {PAYMENTS.map((payment) => (
          <article className={styles.paymentTrace} key={payment.name}>
            <div className={styles.traceIdentity}>
              <span>{payment.name}</span>
              <strong>{payment.outcome}</strong>
            </div>
            <div className={styles.traceRail}>
              <div className={styles.traceOrigin}>
                <i aria-hidden="true" />
                <span>UNINITIALIZED</span>
              </div>
              {payment.steps.map((step) => (
                <div className={styles.traceStep} key={step.hash}>
                  <i aria-hidden="true" />
                  <span>{step.transaction} · {step.phase}</span>
                  <strong>{step.event}</strong>
                  <small>{step.state} · Block {step.block}</small>
                </div>
              ))}
            </div>
            <details className={styles.traceDetails}>
              <summary>View authenticated transaction details</summary>
              <div>
                {payment.steps.map((step) => (
                  <a
                    key={step.hash}
                    href={`https://voyager.online/tx/${step.hash}`}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`${step.transaction} ${step.phase} on Voyager`}
                  >
                    <span>{step.transaction} · {step.phase}</span>
                    <code>{step.hash}</code>
                    <small>SUCCEEDED / {step.finality}</small>
                    <ExternalLinkIcon />
                  </a>
                ))}
              </div>
            </details>
          </article>
        ))}
      </div>

      <p className={styles.evidenceSafety}>
        Mainnet execution is frozen for submission. This public build contains no transaction,
        recovery, signing, proof-generation, or deployment controls.
      </p>
    </section>
  );
}
