'use client';

import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import styles from '../../uni.module.css';

type Route = 'claim' | 'refund';

const CONDITION_STATES = {
  claim: [
    ['Hashlock', 'Verified'],
    ['Time', 'Window open'],
    ['Approval', 'Not required'],
  ],
  refund: [
    ['Refund hash', 'Verified'],
    ['Expiry', 'Reached'],
    ['Approval', 'Not required'],
  ],
} as const;

export default function SettlementInstrument() {
  const [route, setRoute] = useState<Route>('claim');
  const [motionRequest, setMotionRequest] = useState({ id: 0, enabled: true });
  const activeAnimationsRef = useRef<Animation[]>([]);
  const inputRailRef = useRef<HTMLSpanElement>(null);
  const inputMarkerRef = useRef<HTMLElement>(null);
  const conditionRefs = useRef<(HTMLLIElement | null)[]>([]);
  const claimTrackRef = useRef<HTMLSpanElement>(null);
  const refundTrackRef = useRef<HTMLSpanElement>(null);
  const claimProgressRef = useRef<HTMLSpanElement>(null);
  const refundProgressRef = useRef<HTMLSpanElement>(null);
  const claimMarkerRef = useRef<HTMLElement>(null);
  const refundMarkerRef = useRef<HTMLElement>(null);
  const claimOutputRef = useRef<HTMLDivElement>(null);
  const refundOutputRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    activeAnimationsRef.current.forEach((animation) => animation.cancel());
    activeAnimationsRef.current = [];

    if (!motionRequest.enabled) return;

    const inputRail = inputRailRef.current;
    const inputMarker = inputMarkerRef.current;
    const track = route === 'claim' ? claimTrackRef.current : refundTrackRef.current;
    const progress = route === 'claim' ? claimProgressRef.current : refundProgressRef.current;
    const marker = route === 'claim' ? claimMarkerRef.current : refundMarkerRef.current;
    const output = route === 'claim' ? claimOutputRef.current : refundOutputRef.current;
    const conditions = conditionRefs.current.filter((condition) => condition !== null);

    if (!inputRail || !inputMarker || !track || !progress || !marker || !output) return;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const animations: Animation[] = [];

    if (reducedMotion) {
      animations.push(
        output.animate([{ opacity: 0.72 }, { opacity: 1 }], {
          duration: 180,
          easing: 'cubic-bezier(0.23, 1, 0.32, 1)',
        }),
      );
      activeAnimationsRef.current = animations;
      return () => animations.forEach((animation) => animation.cancel());
    }

    const getTravel = (rail: HTMLElement, valueMarker: HTMLElement) => {
      const railRect = rail.getBoundingClientRect();
      const markerRect = valueMarker.getBoundingClientRect();
      const vertical = railRect.height > railRect.width;
      const distance = vertical
        ? Math.max(0, railRect.height - markerRect.height)
        : Math.max(0, railRect.width - markerRect.width);

      return {
        destination: vertical
          ? `translate3d(0, ${distance}px, 0)`
          : `translate3d(${distance}px, 0, 0)`,
        vertical,
      };
    };

    const inputTravel = getTravel(inputRail, inputMarker);
    const branchTravel = getTravel(track, marker);

    animations.push(
      inputMarker.animate(
        [
          { opacity: 0, transform: 'translate3d(0, 0, 0)' },
          { opacity: 1, transform: 'translate3d(0, 0, 0)', offset: 0.12 },
          { opacity: 1, transform: inputTravel.destination, offset: 0.82 },
          { opacity: 0, transform: inputTravel.destination },
        ],
        {
          duration: 500,
          easing: 'cubic-bezier(0.77, 0, 0.175, 1)',
        },
      ),
    );

    conditions.forEach((condition, index) => {
      animations.push(
        condition.animate(
          [
            { opacity: 0.48, transform: 'translate3d(0, 0, 0)' },
            { opacity: 1, transform: 'translate3d(3px, 0, 0)', offset: 0.56 },
            { opacity: 1, transform: 'translate3d(0, 0, 0)' },
          ],
          {
            delay: 390 + index * 110,
            duration: 220,
            easing: 'cubic-bezier(0.23, 1, 0.32, 1)',
            fill: 'both',
          },
        ),
      );
    });

    animations.push(
      progress.animate(
        [
          {
            opacity: 0.35,
            transform: branchTravel.vertical ? 'scaleY(0)' : 'scaleX(0)',
          },
          {
            opacity: 1,
            transform: branchTravel.vertical ? 'scaleY(1)' : 'scaleX(1)',
          },
        ],
        {
          delay: 740,
          duration: 420,
          easing: 'cubic-bezier(0.77, 0, 0.175, 1)',
          fill: 'both',
        },
      ),
      marker.animate(
        [
          { opacity: 0, transform: 'translate3d(0, 0, 0)' },
          { opacity: 1, transform: 'translate3d(0, 0, 0)', offset: 0.1 },
          { opacity: 1, transform: branchTravel.destination, offset: 0.86 },
          { opacity: 0, transform: branchTravel.destination },
        ],
        {
          delay: 780,
          duration: 520,
          easing: 'cubic-bezier(0.77, 0, 0.175, 1)',
          fill: 'both',
        },
      ),
      output.animate(
        [
          { opacity: 0.64, transform: 'scale(0.96)' },
          { opacity: 1, transform: 'scale(1)' },
        ],
        {
          delay: 1190,
          duration: 180,
          easing: 'cubic-bezier(0.23, 1, 0.32, 1)',
          fill: 'backwards',
        },
      ),
    );

    activeAnimationsRef.current = animations;
    return () => animations.forEach((animation) => animation.cancel());
  }, [motionRequest, route]);

  const selectRoute = (nextRoute: Route, pointerInitiated: boolean) => {
    setRoute(nextRoute);
    setMotionRequest((request) => ({ id: request.id + 1, enabled: pointerInitiated }));
  };

  return (
    <div
      className={styles.instrument}
      data-route={route}
      data-motion={motionRequest.enabled ? 'on' : 'off'}
    >
      <div className={styles.instrumentHeader}>
        <span>Conditional routing / {route === 'claim' ? '01' : '02'}</span>
        <span><i aria-hidden="true" />Verified path</span>
      </div>

      <div className={styles.instrumentStage} aria-live="polite">
        <div className={styles.assetNode}>
          <span className={styles.assetGlyph} aria-hidden="true"><i /><i /><i /></span>
          <span>Shielded asset</span>
        </div>

        <span ref={inputRailRef} className={styles.inputRail} aria-hidden="true">
          <i ref={inputMarkerRef} className={styles.inputMarker} />
        </span>

        <div className={styles.conditionGate}>
          <div className={styles.gateHeading}>
            <span className={styles.gateCore}>
              <Image
                className={styles.gateLogo}
                src="/conditionalpay-mark.png"
                alt=""
                width={512}
                height={214}
              />
            </span>
            <span>
              <small>ConditionalPay</small>
              <strong>Conditions</strong>
            </span>
          </div>
          <ul className={styles.gateConditions} aria-label={`${route} route condition states`}>
            {CONDITION_STATES[route].map(([label, status], index) => (
              <li
                key={label}
                ref={(element) => {
                  conditionRefs.current[index] = element;
                }}
              >
                <i aria-hidden="true" />
                <span>{label}</span>
                <strong>{status}</strong>
              </li>
            ))}
          </ul>
        </div>

        <div className={styles.routeMap} aria-label="Claim and refund settlement outcomes">
          <svg
            className={`${styles.routeFork} ${styles.routeForkDesktop}`}
            viewBox="0 0 32 100"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <path
              className={styles.routeForkBase}
              d="M0 50H11C15 50 16 47 16 43V32C16 27 19 25 24 25H32M16 50V68C16 73 19 75 24 75H32"
            />
            <path
              className={`${styles.routeForkActive} ${styles.claimForkPath}`}
              d="M0 50H11C15 50 16 47 16 43V32C16 27 19 25 24 25H32"
            />
            <path
              className={`${styles.routeForkActive} ${styles.refundForkPath}`}
              d="M0 50H11C15 50 16 53 16 57V68C16 73 19 75 24 75H32"
            />
          </svg>
          <svg
            className={`${styles.routeFork} ${styles.routeForkMobile}`}
            viewBox="0 0 100 40"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <path
              className={styles.routeForkBase}
              d="M50 0V11C50 15 47 16 43 16H32C27 16 25 19 25 24V40M50 16H68C73 16 75 19 75 24V40"
            />
            <path
              className={`${styles.routeForkActive} ${styles.claimForkPath}`}
              d="M50 0V11C50 15 47 16 43 16H32C27 16 25 19 25 24V40"
            />
            <path
              className={`${styles.routeForkActive} ${styles.refundForkPath}`}
              d="M50 0V11C50 15 53 16 57 16H68C73 16 75 19 75 24V40"
            />
          </svg>
          <div className={`${styles.routeLane} ${styles.claimLane}`}>
            <span ref={claimTrackRef} className={styles.routeTrack} aria-hidden="true">
              <span ref={claimProgressRef} className={styles.routeProgress} />
              <i ref={claimMarkerRef} className={styles.settlementMarker} />
            </span>
            <div ref={claimOutputRef} className={styles.routeOutput} aria-current={route === 'claim'}>
              <span className={styles.routeNoteGlyph} aria-hidden="true"><i /><i /></span>
              <span className={styles.routeCopy}>
                <small>CLAIM</small>
                <strong>Claimed shielded note</strong>
              </span>
            </div>
          </div>

          <div className={`${styles.routeLane} ${styles.refundLane}`}>
            <span ref={refundTrackRef} className={styles.routeTrack} aria-hidden="true">
              <span ref={refundProgressRef} className={styles.routeProgress} />
              <i ref={refundMarkerRef} className={styles.settlementMarker} />
            </span>
            <div ref={refundOutputRef} className={styles.routeOutput} aria-current={route === 'refund'}>
              <span className={styles.routeNoteGlyph} aria-hidden="true"><i /><i /></span>
              <span className={styles.routeCopy}>
                <small>REFUND</small>
                <strong>Refunded shielded note</strong>
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className={styles.instrumentControls} aria-label="Preview settlement route">
        <span>Resolve through</span>
        <div>
          {(['claim', 'refund'] as const).map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={route === item}
              onClick={(event) => selectRoute(item, event.detail > 0)}
            >
              {item.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
