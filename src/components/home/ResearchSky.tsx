'use client';

import { useEffect, useState } from 'react';

/** Decorative only: meteors are clipped to the empty strip above the hero text. */
export function ResearchSky() {
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    const sync = () => setPaused(document.visibilityState !== 'visible');
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, []);
  return (
    <div className="research-sky" aria-hidden="true" data-paused={paused}>
      <div className="research-sky-planet" />
      <div className="research-sky-meteors">
        <span className="research-sky-meteor research-sky-meteor-first" />
        <span className="research-sky-meteor research-sky-meteor-second" />
      </div>
    </div>
  );
}
