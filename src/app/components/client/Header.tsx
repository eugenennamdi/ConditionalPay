'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import styles from '../../uni.module.css';

const NAV_ITEMS = [
  { href: '#evidence', label: 'Mainnet Proof', id: 'evidence' },
  { href: '#protocol', label: 'Protocol', id: 'protocol' },
  { href: '#developers', label: 'SDK', id: 'developers' },
] as const;

export default function Navigation() {
  const [activeId, setActiveId] = useState<string>('');

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visibleEntries = entries.filter((entry) => entry.isIntersecting);
        if (visibleEntries.length > 0) {
          const topEntry = visibleEntries.reduce((prev, curr) =>
            curr.boundingClientRect.top < prev.boundingClientRect.top ? curr : prev
          );
          setActiveId(topEntry.target.id);
        }
      },
      {
        rootMargin: '-80px 0px -55% 0px',
        threshold: [0, 0.2, 0.5],
      }
    );

    NAV_ITEMS.forEach(({ id }) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, []);

  return (
    <header className={styles.headerSticky}>
      <nav className={styles.nav} aria-label="Primary navigation">
        <a className={styles.brand} href="#top" aria-label="ConditionalPay home">
          <Image
            className={styles.brandLogo}
            src="/conditionalpay-mark.png"
            alt=""
            width={512}
            height={214}
            loading="eager"
            priority
          />
          <span>ConditionalPay</span>
        </a>

        <div className={styles.navLinks}>
          {NAV_ITEMS.map((item) => (
            <a
              key={item.id}
              href={item.href}
              className={styles.navLink}
              data-active={activeId === item.id ? 'true' : undefined}
            >
              {item.label}
            </a>
          ))}
        </div>

        <div className={styles.navActions}>
          <Link href="/console" className={styles.headerConsoleCta}>
            Launch Console
          </Link>
        </div>
      </nav>
    </header>
  );
}
