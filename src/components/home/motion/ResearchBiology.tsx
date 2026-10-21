'use client';

import { useEffect, useRef, useState } from 'react';
import type { WebGLRenderer } from 'three';
import { useDecorationState } from './useDecorationState';

export function ResearchBiology() {
  const host = useRef<HTMLDivElement>(null);
  const { active, reduced, light } = useDecorationState(host);
  const runtime = useRef({ active, reduced, light });
  const wake = useRef<(() => void) | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => { runtime.current = { active, reduced, light }; wake.current?.(); }, [active, reduced, light]);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let cancelled = false;
    let cleanup: (() => void) | undefined;
    // Lazy chunk: WebGL is never needed by the literature list or chat workbench.
    void Promise.all([import('three'), import('./biology-scene')]).then(([THREE, { createBiologyScene }]) => {
      if (cancelled) return;
      let renderer: WebGLRenderer;
      try { renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' }); }
      catch { return; } // CSS illustration remains visible if WebGL2 is unavailable.
      renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
      renderer.setClearColor(0, 0); renderer.outputColorSpace = THREE.SRGBColorSpace;
      const biology = createBiologyScene();
      const camera = new THREE.PerspectiveCamera(40, 1, .1, 30); camera.position.z = 7.2;
      renderer.domElement.dataset.testid = 'research-biology-canvas';
      element.appendChild(renderer.domElement);
      let frame = 0, last = 0, elapsed = 0;
      const render = (time: number) => {
        frame = 0;
        if (cancelled) return;
        if (time - last >= 1000 / 24 || !runtime.current.active) {
          if (runtime.current.active) elapsed += Math.min((time - last) / 1000, .1);
          biology.update(elapsed, runtime.current.light); renderer.render(biology.scene, camera); last = time;
        }
        if (runtime.current.active) frame = requestAnimationFrame(render);
      };
      const resume = () => { cancelAnimationFrame(frame); frame = 0; last = performance.now(); render(last); };
      const resize = () => {
        const width = element.clientWidth, height = element.clientHeight;
        if (!width || !height) return;
        renderer.setSize(width, height); camera.aspect = width / height; camera.updateProjectionMatrix(); resume();
      };
      const lost = (event: Event) => { event.preventDefault(); cancelAnimationFrame(frame); setReady(false); };
      const restored = () => { setReady(true); resize(); };
      renderer.domElement.addEventListener('webglcontextlost', lost);
      renderer.domElement.addEventListener('webglcontextrestored', restored);
      const observer = new ResizeObserver(resize); observer.observe(element);
      wake.current = resume; resize(); setReady(true);
      cleanup = () => {
        wake.current = null; cancelAnimationFrame(frame); observer.disconnect();
        renderer.domElement.removeEventListener('webglcontextlost', lost); renderer.domElement.removeEventListener('webglcontextrestored', restored);
        biology.dispose(); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
      };
    }).catch(() => { /* Keep the CSS fallback; decorations must never prevent page use. */ });
    return () => { cancelled = true; cleanup?.(); };
  }, []);
  return (
    <div ref={host} className="research-biology" data-ready={ready} data-active={active} aria-hidden="true" data-testid="research-biology">
      <div className="research-biology-fallback"><span /><i /><i /><i /></div>
    </div>
  );
}
