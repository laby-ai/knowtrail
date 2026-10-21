'use client';

import { useEffect, useState } from 'react';
import { ResearchParticles } from './motion/ResearchParticles';

const METEOR_NAMES = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth'] as const;

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
      <ResearchParticles />
      <div className="research-sky-meteors">
        {METEOR_NAMES.map(name => <span key={name} className={`research-sky-meteor research-sky-meteor-${name}`} />)}
      </div>
    </div>
  );
}
