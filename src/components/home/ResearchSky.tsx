'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import { ResearchOrbit } from './ResearchOrbit';

const METEOR_NAMES = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth'] as const;
const PARTICLES = Array.from({ length: 16 }, (_, index) => ({
  left: `${4 + index * 37 % 92}%`,
  top: `${8 + index * 23 % 78}%`,
  animationDelay: `${-index * 1.7}s`,
  animationDuration: `${16 + index % 5 * 3}s`,
} satisfies CSSProperties));

/** One shared decorative layer; each page clips meteors to its own empty strip. */
export function ResearchSky({ variant = 'hero' }: { variant?: 'hero' | 'notebooks' | 'workspace' }) {
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    const sync = () => setPaused(document.visibilityState !== 'visible');
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, []);
  return (
    <div className="research-sky" aria-hidden="true" data-paused={paused} data-page={variant}>
      <div className="research-sky-planet" />
      {variant === 'hero' && <ResearchOrbit />}
      <div className="research-sky-particles">
        {PARTICLES.map((style, index) => <span key={index} className="research-sky-particle" style={style} />)}
      </div>
      <div className="research-sky-meteors">
        {METEOR_NAMES.map(name => <span key={name} className={`research-sky-meteor research-sky-meteor-${name}`} />)}
      </div>
    </div>
  );
}
