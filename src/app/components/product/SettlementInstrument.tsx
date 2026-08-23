'use client';

import Image from 'next/image';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import styles from '../../uni.module.css';

type Route = 'claim' | 'refund';

interface ConditionItem {
  name: string;
  status: string;
  verified: boolean;
}

const CONDITIONS_BY_ROUTE: Record<Route, ConditionItem[]> = {
  claim: [
    { name: 'Hashlock', status: 'Verified', verified: true },
    { name: 'Time', status: 'Window open', verified: true },
    { name: 'Approval', status: 'Not required', verified: false },
  ],
  refund: [
    { name: 'Refund hash', status: 'Verified', verified: true },
    { name: 'Expiry', status: 'Reached', verified: true },
    { name: 'Approval', status: 'Not required', verified: false },
  ],
};

export default function SettlementInstrument() {
  const [route, setRoute] = useState<Route>('claim');
  const [animating, setAnimating] = useState(false);
  const conditionsRef = useRef<(HTMLLIElement | null)[]>([]);
  const claimNoteRef = useRef<HTMLDivElement>(null);
  const refundNoteRef = useRef<HTMLDivElement>(null);
  const activeAnimRef = useRef<Animation[]>([]);
  const animationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const baseId = useId();

  // Desktop marker refs
  const dInputPipRef = useRef<SVGCircleElement>(null);
  const dBranchPipRef = useRef<SVGCircleElement>(null);
  // Mobile marker refs
  const mInputPipRef = useRef<SVGCircleElement>(null);
  const mBranchPipRef = useRef<SVGCircleElement>(null);

  const cancelActiveAnimation = useCallback(() => {
    activeAnimRef.current.forEach((anim) => anim.cancel());
    activeAnimRef.current = [];

    if (animationTimerRef.current !== null) {
      clearTimeout(animationTimerRef.current);
      animationTimerRef.current = null;
    }
  }, []);

  const runAnimation = useCallback((targetRoute: Route) => {
    cancelActiveAnimation();

    const reducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reducedMotion) {
      setAnimating(false);
      return;
    }

    setAnimating(true);
    const anims: Animation[] = [];

    const isMobile = typeof window !== 'undefined' && window.innerWidth <= 740;
    const inputPip = isMobile ? mInputPipRef.current : dInputPipRef.current;
    const branchPip = isMobile ? mBranchPipRef.current : dBranchPipRef.current;
    const activeNote = targetRoute === 'claim' ? claimNoteRef.current : refundNoteRef.current;
    const conditionItems = conditionsRef.current.filter(Boolean);

    // 1. Input rail value marker (0ms -> 300ms)
    if (inputPip) {
      const inputAnim = inputPip.animate(
        [
          { offsetDistance: '0%', opacity: 0 },
          { offsetDistance: '10%', opacity: 1, offset: 0.1 },
          { offsetDistance: '90%', opacity: 1, offset: 0.9 },
          { offsetDistance: '100%', opacity: 0 },
        ],
        {
          duration: 300,
          easing: 'cubic-bezier(0.23, 1, 0.32, 1)',
          fill: 'forwards',
        }
      );
      anims.push(inputAnim);
    }

    // 2. Condition checks resolve in cascade (240ms -> 460ms)
    conditionItems.forEach((item, idx) => {
      if (item) {
        const condAnim = item.animate(
          [
            { opacity: 0.4, transform: 'translateX(-2px)' },
            { opacity: 1, transform: 'translateX(0)' },
          ],
          {
            delay: 240 + idx * 60,
            duration: 180,
            easing: 'cubic-bezier(0.23, 1, 0.32, 1)',
            fill: 'both',
          }
        );
        anims.push(condAnim);
      }
    });

    // 3. Branch path marker travels along selected branch (440ms -> 800ms)
    if (branchPip) {
      const desktopBranchPath =
        targetRoute === 'claim'
          ? 'M 0 100 L 24 100 C 50 100, 52 26, 76 26 L 100 26'
          : 'M 0 100 L 24 100 C 50 100, 52 174, 76 174 L 100 174';
      const mobileBranchPath =
        targetRoute === 'claim'
          ? 'M 50 0 L 50 14 C 50 30, 25 30, 25 44'
          : 'M 50 0 L 50 14 C 50 30, 75 30, 75 44';

      branchPip.style.offsetPath = `path("${isMobile ? mobileBranchPath : desktopBranchPath}")`;

      const branchAnim = branchPip.animate(
        [
          { offsetDistance: '0%', opacity: 0 },
          { offsetDistance: '8%', opacity: 1, offset: 0.08 },
          { offsetDistance: '92%', opacity: 1, offset: 0.92 },
          { offsetDistance: '100%', opacity: 0 },
        ],
        {
          delay: 440,
          duration: 360,
          easing: 'cubic-bezier(0.23, 1, 0.32, 1)',
          fill: 'forwards',
        }
      );
      anims.push(branchAnim);
    }

    // 4. Output note settles in terminal state (760ms -> 960ms)
    if (activeNote) {
      const noteAnim = activeNote.animate(
        [
          { opacity: 0.65, transform: 'scale(0.97)' },
          { opacity: 1, transform: 'scale(1)' },
        ],
        {
          delay: 760,
          duration: 200,
          easing: 'cubic-bezier(0.23, 1, 0.32, 1)',
          fill: 'both',
        }
      );
      anims.push(noteAnim);
    }

    activeAnimRef.current = anims;

    animationTimerRef.current = setTimeout(() => {
      animationTimerRef.current = null;
      setAnimating(false);
    }, 980);
  }, [cancelActiveAnimation]);

  const handleSelectRoute = (nextRoute: Route, pointerInitiated: boolean) => {
    setRoute(nextRoute);

    if (!pointerInitiated) {
      cancelActiveAnimation();
      setAnimating(false);
      return;
    }

    runAnimation(nextRoute);
  };

  useEffect(() => {
    return cancelActiveAnimation;
  }, [cancelActiveAnimation]);

  const conditions = CONDITIONS_BY_ROUTE[route];

  return (
    <div
      className={styles.instrument}
      data-route={route}
      data-animating={animating ? 'true' : 'false'}
    >
      <div className={styles.instrumentHeader}>
        <span className={styles.instrumentTagline}>
          Conditional routing / {route === 'claim' ? '01' : '02'}
        </span>
        <span className={styles.instrumentLiveStatus}>
          <i aria-hidden="true" />
          Mainnet-proven flow
        </span>
      </div>

      <div className={styles.instrumentStage} aria-live="polite">
        {/* Node 1: Shielded Asset */}
        <div className={styles.assetNode}>
          <div className={styles.assetGlyph} aria-hidden="true">
            <span className={styles.glyphRingOuter} />
            <span className={styles.glyphRingInner} />
            <span className={styles.glyphCore} />
          </div>
          <span className={styles.nodeLabel}>Shielded asset</span>
        </div>

        {/* Input Rail (Connecting Asset to Conditions) */}
        <div className={styles.inputRailTrack} aria-hidden="true">
          <svg
            className={styles.inputRailSvg}
            viewBox="0 0 100 20"
            preserveAspectRatio="none"
          >
            <line x1="0" y1="10" x2="100" y2="10" className={styles.railBase} />
            <line x1="0" y1="10" x2="100" y2="10" className={styles.railActiveHighlight} />
            <circle
              ref={dInputPipRef}
              r="3.5"
              className={styles.valuePip}
              style={{ offsetPath: 'path("M 0 10 L 100 10")' }}
            />
          </svg>
          {/* Mobile vertical input rail */}
          <svg
            className={styles.mobileInputRailSvg}
            viewBox="0 0 20 100"
            preserveAspectRatio="none"
          >
            <line x1="10" y1="0" x2="10" y2="100" className={styles.railBase} />
            <line x1="10" y1="0" x2="10" y2="100" className={styles.railActiveHighlight} />
            <circle
              ref={mInputPipRef}
              r="3.5"
              className={styles.valuePip}
              style={{ offsetPath: 'path("M 10 0 L 10 100")' }}
            />
          </svg>
        </div>

        {/* Node 2: Conditions Engine */}
        <div className={styles.conditionGate} aria-label="Settlement condition verifications">
          <div className={styles.gateHeader}>
            <div className={styles.gateBrand}>
              <Image
                className={styles.gateLogo}
                src="/conditionalpay-mark.png"
                alt=""
                width={512}
                height={214}
              />
              <span>CONDITIONS</span>
            </div>
            <span className={styles.gateStageTag}>SETTLEMENT ENGINE</span>
          </div>

          <ul className={styles.gateConditions} aria-label={`${route} condition states`}>
            {conditions.map((item, index) => (
              <li
                key={`${route}-${item.name}`}
                ref={(el) => {
                  conditionsRef.current[index] = el;
                }}
                className={item.verified ? styles.conditionVerified : styles.conditionNeutral}
              >
                <i className={styles.conditionStatusDot} aria-hidden="true" />
                <span className={styles.conditionName}>{item.name}</span>
                <strong className={styles.conditionStatus}>{item.status}</strong>
              </li>
            ))}
          </ul>
        </div>

        {/* Branching Rail (Connecting Conditions to Output Notes) */}
        <div className={styles.branchRailTrack} aria-hidden="true">
          {/* Desktop Symmetrical Branch SVG */}
          <svg
            className={styles.desktopBranchSvg}
            viewBox="0 0 100 200"
            preserveAspectRatio="none"
          >
            {/* Neutral base paths */}
            <path
              className={styles.railBase}
              d="M 0 100 L 24 100 C 50 100, 52 26, 76 26 L 100 26"
            />
            <path
              className={styles.railBase}
              d="M 0 100 L 24 100 C 50 100, 52 174, 76 174 L 100 174"
            />

            {/* Active mineral green highlighted paths */}
            <path
              className={`${styles.railActiveBranch} ${styles.claimBranchActive}`}
              d="M 0 100 L 24 100 C 50 100, 52 26, 76 26 L 100 26"
              data-active={route === 'claim'}
            />
            <path
              className={`${styles.railActiveBranch} ${styles.refundBranchActive}`}
              d="M 0 100 L 24 100 C 50 100, 52 174, 76 174 L 100 174"
              data-active={route === 'refund'}
            />

            {/* Shared branching junction origin */}
            <circle cx="24" cy="100" r="2.5" className={styles.junctionOrigin} />

            {/* Value pip traveling along branch */}
            <circle
              ref={dBranchPipRef}
              r="3.5"
              className={styles.valuePip}
              style={{
                offsetPath: `path("${
                  route === 'claim'
                    ? 'M 0 100 L 24 100 C 50 100, 52 26, 76 26 L 100 26'
                    : 'M 0 100 L 24 100 C 50 100, 52 174, 76 174 L 100 174'
                }")`,
              }}
            />
          </svg>

          {/* Mobile Vertical Symmetrical Branch SVG */}
          <svg
            className={styles.mobileBranchSvg}
            viewBox="0 0 100 44"
            preserveAspectRatio="none"
          >
            <path className={styles.railBase} d="M 50 0 L 50 14 C 50 30, 25 30, 25 44" />
            <path className={styles.railBase} d="M 50 0 L 50 14 C 50 30, 75 30, 75 44" />

            <path
              className={`${styles.railActiveBranch} ${styles.claimBranchActive}`}
              d="M 50 0 L 50 14 C 50 30, 25 30, 25 44"
              data-active={route === 'claim'}
            />
            <path
              className={`${styles.railActiveBranch} ${styles.refundBranchActive}`}
              d="M 50 0 L 50 14 C 50 30, 75 30, 75 44"
              data-active={route === 'refund'}
            />

            <circle cx="50" cy="14" r="2.5" className={styles.junctionOrigin} />

            <circle
              ref={mBranchPipRef}
              r="3.5"
              className={styles.valuePip}
              style={{
                offsetPath: `path("${
                  route === 'claim'
                    ? 'M 50 0 L 50 14 C 50 30, 25 30, 25 44'
                    : 'M 50 0 L 50 14 C 50 30, 75 30, 75 44'
                }")`,
              }}
            />
          </svg>
        </div>

        {/* Node 3 & 4: Terminal Output Notes */}
        <div className={styles.outputsContainer}>
          {/* CLAIM Note */}
          <div
            ref={claimNoteRef}
            className={`${styles.outputCard} ${styles.claimOutputCard}`}
            data-active={route === 'claim'}
          >
            <div className={styles.outputGlyph} aria-hidden="true">
              <span className={styles.outputGlyphRing} />
              <span className={styles.outputGlyphDot} />
            </div>
            <div className={styles.outputContent}>
              <small className={styles.outputKicker}>CLAIM</small>
              <strong className={styles.outputTitle}>Claimed shielded note</strong>
            </div>
          </div>

          {/* REFUND Note */}
          <div
            ref={refundNoteRef}
            className={`${styles.outputCard} ${styles.refundOutputCard}`}
            data-active={route === 'refund'}
          >
            <div className={styles.outputGlyph} aria-hidden="true">
              <span className={styles.outputGlyphRing} />
              <span className={styles.outputGlyphDot} />
            </div>
            <div className={styles.outputContent}>
              <small className={styles.outputKicker}>REFUND</small>
              <strong className={styles.outputTitle}>Refunded shielded note</strong>
            </div>
          </div>
        </div>
      </div>

      <div className={styles.instrumentControls} aria-label="Preview settlement route">
        <span className={styles.controlsLabel}>Resolve through</span>
        <div className={styles.controlToggle} role="group" aria-label="Settlement path switch">
          <button
            id={`${baseId}-claim-btn`}
            type="button"
            className={styles.routeBtn}
            aria-pressed={route === 'claim'}
            onClick={(event) => handleSelectRoute('claim', event.detail > 0)}
          >
            CLAIM
          </button>
          <button
            id={`${baseId}-refund-btn`}
            type="button"
            className={styles.routeBtn}
            aria-pressed={route === 'refund'}
            onClick={(event) => handleSelectRoute('refund', event.detail > 0)}
          >
            REFUND
          </button>
        </div>
      </div>
    </div>
  );
}
