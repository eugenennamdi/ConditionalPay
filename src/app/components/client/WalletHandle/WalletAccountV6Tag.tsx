import styles from '../../../uni.module.css';

const PAYMENTS = [
  {
    name: 'Payment A',
    pathSubtitle: 'Claim path · Claimed after hashlock verification',
    outcome: 'CLAIMED',
    origin: {
      tag: 'UNINITIALIZED',
      desc: 'Before creation',
    },
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
        finality: 'ACCEPTED_ON_L1',
        hash: '0xde61c431a92dabc7b8672cd08cdce0b479b83ca261c0591992a84e6e7779b7',
      },
    ],
  },
  {
    name: 'Payment B',
    pathSubtitle: 'Refund path · Refunded after expiry',
    outcome: 'REFUNDED',
    origin: {
      tag: 'UNINITIALIZED',
      desc: 'Before creation',
    },
    steps: [
      {
        transaction: 'TX3',
        phase: 'CREATE',
        state: 'ACTIVE',
        event: 'PaymentCreated',
        block: '13,707,204',
        finality: 'ACCEPTED_ON_L1',
        hash: '0x2f2f88ab25f64a619aa05dcaff7c2af85efc6cd086a229696ac8edc3bdd6d26',
      },
      {
        transaction: 'TX4',
        phase: 'REFUND',
        state: 'REFUNDED',
        event: 'PaymentRefunded',
        block: '13,708,549',
        finality: 'ACCEPTED_ON_L1',
        hash: '0x64cfec311d340f97fb0d9245de01ab36f3267259ac162290265e55ca99dd88d',
      },
    ],
  },
] as const;

function formatHash(hash: string): string {
  if (hash.length <= 18) return hash;
  return `${hash.slice(0, 10)}…${hash.slice(-8)}`;
}

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
          <p className={styles.kicker}>MAINNET SETTLEMENT PROOF</p>
          <h2 id="mainnet-evidence-heading">
            <span>Both terminal paths,</span>
            <span>proven onchain.</span>
          </h2>
        </div>
        <p>
          Four authenticated Starknet Mainnet transactions prove both terminal outcomes—CLAIM
          and REFUND—against the deployed ConditionalPay contract. All are accepted on L1.
        </p>
      </div>

      <div className={styles.paymentTraces}>
        {PAYMENTS.map((payment) => (
          <article className={styles.paymentTrace} key={payment.name}>
            {/* Header: Payment title + subtitle (left) & outcome tag (right) */}
            <div className={styles.paymentHeader}>
              <div className={styles.paymentHeaderInfo}>
                <h3 className={styles.paymentTitle}>{payment.name}</h3>
                <p className={styles.paymentPathSubtitle}>{payment.pathSubtitle}</p>
              </div>
              <span className={styles.paymentOutcomeTag} data-outcome={payment.outcome}>
                {payment.outcome}
              </span>
            </div>

            {/* Lifecycle Timeline */}
            <div className={styles.timelineRail} role="list" aria-label={`${payment.name} lifecycle timeline`}>
              {/* Origin node: UNINITIALIZED */}
              <div className={styles.timelineNode} role="listitem">
                <i className={styles.timelineDot} aria-hidden="true" />
                <span className={styles.timelineStepTag}>{payment.origin.tag}</span>
                <span className={styles.timelineStepDesc}>{payment.origin.desc}</span>
              </div>

              {/* Step nodes: CREATE & CLAIM/REFUND */}
              {payment.steps.map((step, idx) => (
                <div
                  className={`${styles.timelineNode} ${idx === payment.steps.length - 1 ? styles.timelineTerminalNode : ''}`}
                  key={step.hash}
                  role="listitem"
                >
                  <i className={styles.timelineDot} aria-hidden="true" />
                  <span className={styles.timelineStepTag}>{step.transaction} · {step.phase}</span>
                  <strong className={styles.timelineEventName}>{step.event}</strong>
                  <div className={styles.timelineMetaGroup}>
                    <span className={styles.timelineStateTag} data-state={step.state}>
                      {step.state}
                    </span>
                    <small className={styles.timelineBlock}>Block {step.block}</small>
                  </div>
                </div>
              ))}
            </div>

            {/* Authenticated Onchain Proof Disclosure */}
            <details className={styles.traceDetails}>
              <summary className={styles.disclosureSummary}>
                <span className={styles.disclosureTitle}>Authenticated transactions</span>
                <span className={styles.disclosureAction}>View details</span>
              </summary>
              <div className={styles.proofRows}>
                {payment.steps.map((step) => (
                  <a
                    key={step.hash}
                    href={`https://voyager.online/tx/${step.hash}`}
                    target="_blank"
                    rel="noreferrer"
                    className={styles.proofRow}
                    aria-label={`${step.transaction} ${step.phase} on Voyager: ${step.hash}`}
                    title={step.hash}
                  >
                    <span className={styles.proofTxPhase}>
                      <strong>{step.transaction}</strong> · {step.phase}
                    </span>
                    <code className={styles.proofHash}>{formatHash(step.hash)}</code>
                    <span className={styles.proofStatus}>
                      SUCCEEDED · {step.finality}
                    </span>
                    <span className={styles.proofLinkIcon} aria-hidden="true">
                      <ExternalLinkIcon />
                    </span>
                  </a>
                ))}
              </div>
            </details>
          </article>
        ))}
      </div>
    </section>
  );
}
