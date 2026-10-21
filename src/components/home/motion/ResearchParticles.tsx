'use client';

import { useEffect, useRef } from 'react';
import { useDecorationState } from './useDecorationState';

export function ResearchParticles() {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const { active, reduced, light } = useDecorationState(host);
  useEffect(() => {
    const surface = canvas.current;
    const element = host.current;
    if (!surface || !element) return;
    const ctx = surface.getContext('2d');
    if (!ctx) return;
    let width = 0, height = 0, frame = 0, last = 0;
    const draw = (time: number) => {
      ctx.clearRect(0, 0, width, height);
      if (reduced) return;
      const count = width < 600 ? 14 : 38;
      for (let index = 0; index < count; index++) {
        const phase = index * 2.399;
        const x = ((index * .6180339 % 1) * width + Math.sin(time * .00008 + phase) * 14 + width) % width;
        const y = ((index * .381966 % 1) * height - time * (.002 + index % 3 * .001) + height * 100) % height;
        const alpha = .13 + (.5 + Math.sin(time * .001 + phase) * .5) * .36;
        ctx.fillStyle = light ? `rgba(96,112,198,${alpha})` : `rgba(163,199,255,${alpha})`;
        ctx.beginPath(); ctx.arc(x, y, index % 7 === 0 ? 1.8 : .9, 0, Math.PI * 2); ctx.fill();
        if (index % 7 === 0) {
          ctx.globalAlpha = .18;
          ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
        }
      }
    };
    const resize = () => {
      width = element.clientWidth; height = element.clientHeight;
      const ratio = Math.min(devicePixelRatio || 1, 1.5);
      surface.width = Math.round(width * ratio); surface.height = Math.round(height * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0); draw(0);
    };
    const tick = (time: number) => {
      if (time - last > 1000 / 24) { draw(time); last = time; }
      frame = requestAnimationFrame(tick);
    };
    const observer = new ResizeObserver(resize); observer.observe(element); resize();
    if (active) frame = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); ctx.clearRect(0, 0, width, height); };
  }, [active, reduced, light]);
  return <div ref={host} className="research-sky-particles" data-active={active} aria-hidden="true"><canvas ref={canvas} data-testid="research-particles-canvas" /></div>;
}
