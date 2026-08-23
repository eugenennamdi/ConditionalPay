import Image from 'next/image';
import styles from './uni.module.css';
import WalletAccountV6Tag from './components/client/WalletHandle/WalletAccountV6Tag';
import CodeWorkspace from './components/product/CodeWorkspace';
import SettlementInstrument from './components/product/SettlementInstrument';
import {
  CONDITIONAL_PAY_MAINNET,
  STRK20_POOL_MAINNET,
} from '@/utils/constants';

const REPOSITORY_URL = 'https://github.com/eugenennamdi/ConditionalPay';
const VOYAGER_CONTRACT_URL = 'https://voyager.online/contract';
const STRK20_URL = 'https://strk20.starknet.io/';

const ARCHITECTURE = [
  ['01', 'Application'],
  ['02', 'SDK'],
  ['03', 'Ready X / STRK20'],
  ['04', 'Privacy pool'],
  ['05', 'ConditionalPay'],
  ['06', 'STRK20 settlement'],
  ['07', 'Shielded note'],
] as const;

const CONDITIONS = [
  {
    index: '01',
    name: 'Hashlock',
    label: 'Bearer authorization',
    description: 'A bearer claim credential authorizes CLAIM without storing a claimant address.',
  },
  {
    index: '02',
    name: 'Time',
    label: 'Claim window / expiry',
    description: 'Timing defines when CLAIM is valid and when the REFUND path becomes available.',
  },
  {
    index: '03',
    name: 'Approval',
    label: 'Optional attestation',
    description: 'An optional approver can gate settlement without becoming the recipient.',
  },
] as const;

import Navigation from './components/client/Header';

function ArrowIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 3v9M4.5 8.5 8 12l3.5-3.5" />
    </svg>
  );
}

function ExternalLinkIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4 12 12 4M6 4h6v6" />
    </svg>
  );
}

export default function Page() {
  return (
    <div className={styles.page}>
      <Navigation repositoryUrl={REPOSITORY_URL} />

      <main id="top">
        <header className={styles.hero}>
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}>STRK20 SETTLEMENT INFRASTRUCTURE</p>
            <h1>
              <span className={styles.heroLead}>Private assets.</span>
              <span>Programmable settlement.</span>
            </h1>
            <p className={styles.heroSupport}>
              ConditionalPay adds verifiable settlement conditions to{' '}
              <a className={styles.strk20Link} href={STRK20_URL} target="_blank" rel="noreferrer">
                STRK20
              </a>{' '}
              without storing creator, claimant, or refunder addresses in protocol state.
            </p>
            <div className={styles.heroActions}>
              <a className={styles.primaryLink} href="#evidence">
                Inspect Mainnet Proof
                <span className={styles.heroLinkIcon} aria-hidden="true"><ArrowIcon /></span>
              </a>
              <a className={styles.secondaryLink} href="#developers">Explore the SDK</a>
            </div>
          </div>

          <SettlementInstrument />

          <div className={styles.proofLine} aria-label="Mainnet deployment summary">
            <span><i aria-hidden="true" />Live on Starknet Mainnet</span>
            <span>4 verified transactions</span>
            <span>2 terminal paths proven</span>
            <span>0 final locked STRK liability</span>
          </div>
        </header>

        <WalletAccountV6Tag />

        <section id="protocol" className={styles.protocolSection} aria-labelledby="protocol-heading">
          <div className={styles.sectionIntro}>
            <div>
              <p className={styles.kicker}>How ConditionalPay settles</p>
              <h2 id="protocol-heading">One private rail. Conditions at the application boundary.</h2>
            </div>
            <p>
              A shielded asset moves through the wallet-managed STRK20 path, crosses the
              ConditionalPay boundary once, and returns as a shielded note after the configured
              conditions resolve.
            </p>
          </div>

          <figure className={styles.architectureFigure}>
            <figcaption className={styles.srOnly}>
              ConditionalPay settlement architecture from application to shielded note.
            </figcaption>
            <ol className={styles.architectureRail}>
              {ARCHITECTURE.map(([index, label]) => {
                const isConditionalPay = label === 'ConditionalPay';

                return (
                  <li className={isConditionalPay ? styles.architectureBoundary : undefined} key={label}>
                    {isConditionalPay ? (
                      <>
                        <span className={styles.architectureBoundaryPlane} aria-hidden="true" />
                        <span className={styles.architectureBoundaryLabel}>
                          ConditionalPay boundary
                        </span>
                      </>
                    ) : null}
                    <span className={styles.architectureIndex}>{index}</span>
                    <strong>{label}</strong>
                    {isConditionalPay ? (
                      <span
                        className={styles.architectureConditions}
                        aria-label="Hashlock, time, and approval conditions"
                      >
                        <span>Hashlock</span>
                        <i aria-hidden="true" />
                        <span>Time</span>
                        <i aria-hidden="true" />
                        <span>Approval</span>
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ol>
            <div className={styles.railLegend}>
              <span className={styles.railLegendInput}>Application</span>
              <span className={styles.railLegendPrivacy}>Wallet privacy</span>
              <span className={styles.railLegendOutput}>Shielded output</span>
            </div>
          </figure>

          <div className={styles.conditionLayout}>
            <div className={styles.conditionIntro}>
              <span>At the ConditionalPay boundary</span>
              <h3>
                <span>Conditions compose</span>
                <span>around settlement.</span>
              </h3>
              <p>
                CREATE locks value into an ACTIVE payment. CLAIM resolves once the claim
                credential, timing, and any configured approval conditions are satisfied. After
                expiry, a valid refund credential resolves the payment through REFUND.
              </p>
            </div>
            <ol className={styles.conditionList}>
              {CONDITIONS.map((condition) => (
                <li key={condition.name}>
                  <span className={styles.conditionIndex}>{condition.index}</span>
                  <div>
                    <span>{condition.label}</span>
                    <h3>{condition.name}</h3>
                  </div>
                  <p>{condition.description}</p>
                </li>
              ))}
            </ol>
          </div>

          <div className={styles.privacyBoundary}>
            <div className={styles.privacyStoredBlock}>
              <span className={styles.boundaryMarker}>Not stored by ConditionalPay</span>
              <h3>ConditionalPay stores no creator, claimant, or refunder addresses.</h3>
            </div>
            <div className={styles.privacyPublicBlock}>
              <span className={styles.boundaryMarker}>Remains public</span>
              <div className={styles.publicDisclosureList}>
                <div className={styles.publicDisclosureItem}>
                  <strong>Token + amount</strong>
                  <span>At the app–anonymizer boundary</span>
                </div>
                <div className={styles.publicDisclosureItem}>
                  <strong>Timing + configured conditions</strong>
                  <span>Including any configured approver</span>
                </div>
                <div className={styles.publicDisclosureItem}>
                  <strong>Claim / refund preimages</strong>
                  <span>Once exercised</span>
                </div>
              </div>
            </div>
            <p className={styles.privacyQualification}>
              ConditionalPay limits participant-address exposure at the application contract. It
              does not provide full transaction, timing, or amount privacy.
            </p>
          </div>
        </section>

        <section id="developers" className={styles.developerSection} aria-labelledby="developers-heading">
          <div className={styles.developerIntro}>
            <p className={styles.kicker}>FOR DEVELOPERS</p>
            <h2 id="developers-heading">A canonical SDK for the full settlement lifecycle.</h2>
            <p>
              Typed builders produce correctly ordered STRK20 Wallet API actions, while query helpers
              decode the frozen Cairo contract state.
            </p>
            <div className={styles.docLinks}>
              <a href={`${REPOSITORY_URL}/blob/main/README.md`} target="_blank" rel="noreferrer">
                README <ExternalLinkIcon />
              </a>
              <a href={`${REPOSITORY_URL}/blob/main/SECURITY.md`} target="_blank" rel="noreferrer">
                Security <ExternalLinkIcon />
              </a>
              <a href={`${REPOSITORY_URL}/blob/main/MAINNET_EVIDENCE.md`} target="_blank" rel="noreferrer">
                Mainnet evidence <ExternalLinkIcon />
              </a>
            </div>
          </div>
          <CodeWorkspace />
        </section>

        <section className={styles.deploymentSection} aria-labelledby="deployment-heading">
          <div className={styles.deploymentTitle}>
            <p className={styles.kicker}>INFRASTRUCTURE</p>
            <h2 id="deployment-heading">Deployed on Starknet Mainnet</h2>
          </div>
          <div className={styles.contractRows}>
            <div className={styles.contractRow}>
              <span>ConditionalPay contract</span>
              <a
                href={`${VOYAGER_CONTRACT_URL}/${CONDITIONAL_PAY_MAINNET}`}
                target="_blank"
                rel="noreferrer"
                title={CONDITIONAL_PAY_MAINNET}
                aria-label={`ConditionalPay contract on Voyager: ${CONDITIONAL_PAY_MAINNET}`}
              >
                <code>{CONDITIONAL_PAY_MAINNET}</code>
                <ExternalLinkIcon />
              </a>
            </div>
            <div className={styles.contractRow}>
              <span>STRK20 privacy pool</span>
              <a
                href={`${VOYAGER_CONTRACT_URL}/${STRK20_POOL_MAINNET}`}
                target="_blank"
                rel="noreferrer"
                title={STRK20_POOL_MAINNET}
                aria-label={`STRK20 privacy pool contract on Voyager: ${STRK20_POOL_MAINNET}`}
              >
                <code>{STRK20_POOL_MAINNET}</code>
                <ExternalLinkIcon />
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className={styles.footer}>
        <div className={styles.footerBrand}>
          <Image
            className={styles.brandLogo}
            src="/conditionalpay-mark.png"
            alt=""
            width={512}
            height={214}
          />
          <span>ConditionalPay</span>
        </div>
        <p>Programmable private settlement infrastructure for STRK20.</p>
        <div className={styles.footerLinks}>
          <a href={REPOSITORY_URL} target="_blank" rel="noreferrer">GitHub</a>
          <a href="#evidence">Mainnet Proof</a>
          <a href="#top">Back to top</a>
        </div>
      </footer>
    </div>
  );
}
