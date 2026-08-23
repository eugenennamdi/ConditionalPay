'use client';

import { KeyboardEvent, useId, useRef, useState } from 'react';
import styles from '../../uni.module.css';

const EXAMPLES = [
  {
    id: 'create',
    label: 'Create',
    description: 'Lock a shielded amount behind the configured conditions.',
    api: 'buildCreateActions',
    result: 'actions',
    arguments: ['conditionalPay', 'createParams'],
    topology: 'Withdraw → Invoke',
  },
  {
    id: 'claim',
    label: 'Claim',
    description: 'Settle an active payment into the claimant’s open note.',
    api: 'buildClaimActions',
    result: 'actions',
    arguments: ['conditionalPay', 'claimParams'],
    topology: 'Open note → Invoke',
  },
  {
    id: 'refund',
    label: 'Refund',
    description: 'Return an expired payment into the refunder’s open note.',
    api: 'buildRefundActions',
    result: 'actions',
    arguments: ['conditionalPay', 'refundParams'],
    topology: 'Open note → Invoke',
  },
  {
    id: 'query',
    label: 'Query',
    description: 'Strictly decode the canonical onchain Payment record.',
    api: 'getPayment',
    result: 'payment',
    arguments: ['provider', 'conditionalPay', 'paymentId'],
    topology: 'Read-only query',
  },
] as const;

function CodeExample({ example }: { example: (typeof EXAMPLES)[number] }) {
  const invocationPrefix = example.id === 'query' ? 'await ' : '';
  const lines = [
    <>
      <span className={styles.syntaxKeyword}>import</span>{' { '}
      <span className={styles.syntaxFunction}>{example.api}</span>{' } '}
      <span className={styles.syntaxKeyword}>from</span>{' '}
      <span className={styles.syntaxString}>&quot;@conditionalpay/sdk&quot;</span>;
    </>,
    <>&nbsp;</>,
    <>
      <span className={styles.syntaxKeyword}>const</span>{' '}
      <span className={styles.syntaxVariable}>{example.result}</span>{' = '}
      {invocationPrefix ? <span className={styles.syntaxKeyword}>{invocationPrefix}</span> : null}
      <span className={styles.syntaxFunction}>{example.api}</span>(
    </>,
    ...example.arguments.map((argument) => <>&nbsp;&nbsp;{argument},</>),
    <>);</>,
  ];

  return (
    <pre>
      <code>
        {lines.map((line, index) => (
          <span className={styles.codeLine} key={`${example.id}-${index}`}>
            <span className={styles.codeLineNumber} aria-hidden="true">{index + 1}</span>
            <span>{line}</span>
          </span>
        ))}
      </code>
    </pre>
  );
}

export default function CodeWorkspace() {
  const [activeIndex, setActiveIndex] = useState(0);
  const [animate, setAnimate] = useState(false);
  const tabsRef = useRef<Array<HTMLButtonElement | null>>([]);
  const baseId = useId();

  const focusTab = (index: number) => {
    setAnimate(false);
    setActiveIndex(index);
    tabsRef.current[index]?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    let nextIndex: number | undefined;
    if (event.key === 'ArrowRight') nextIndex = (activeIndex + 1) % EXAMPLES.length;
    if (event.key === 'ArrowLeft') nextIndex = (activeIndex - 1 + EXAMPLES.length) % EXAMPLES.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = EXAMPLES.length - 1;
    if (nextIndex === undefined) return;
    event.preventDefault();
    focusTab(nextIndex);
  };

  return (
    <div className={styles.codeWorkspace}>
      <div className={styles.workspaceTopline}>
        <span>ConditionalPay SDK</span>
        <span>TypeScript</span>
      </div>
      <div
        className={styles.codeTabs}
        data-motion={animate ? 'on' : 'off'}
        role="tablist"
        aria-label="ConditionalPay SDK examples"
      >
        {EXAMPLES.map((example, index) => (
          <button
            key={example.id}
            ref={(element) => { tabsRef.current[index] = element; }}
            id={`${baseId}-${example.id}-tab`}
            role="tab"
            type="button"
            aria-controls={`${baseId}-${example.id}-panel`}
            aria-selected={activeIndex === index}
            tabIndex={activeIndex === index ? 0 : -1}
            onClick={(event) => {
              setAnimate(event.detail > 0);
              setActiveIndex(index);
            }}
            onKeyDown={handleKeyDown}
          >
            <span aria-hidden="true">0{index + 1}</span>
            <strong>{example.label}</strong>
          </button>
        ))}
      </div>
      <div className={styles.workspacePanels} data-motion={animate ? 'on' : 'off'}>
        {EXAMPLES.map((example, index) => {
          const isActive = activeIndex === index;
          return (
            <div
              className={styles.codePanel}
              data-active={isActive ? 'true' : 'false'}
              id={`${baseId}-${example.id}-panel`}
              key={example.id}
              role="tabpanel"
              aria-hidden={!isActive}
              aria-labelledby={`${baseId}-${example.id}-tab`}
              tabIndex={isActive ? 0 : -1}
            >
              <div className={styles.codePanelHeader}>
                <p>{example.description}</p>
                <span>{example.topology}</span>
              </div>
              <CodeExample example={example} />
            </div>
          );
        })}
      </div>
      <div className={styles.workspaceFooter}>
        <span>Canonical serialization</span>
        <span><i aria-hidden="true" />Read-only preview</span>
      </div>
    </div>
  );
}
