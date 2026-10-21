'use client';
import { useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** A stable portal target keeps streaming state alive while the modal itself unmounts. */
export function PersistentStudioTool({ active, target, children }: { active: boolean; target: HTMLElement | null; children: ReactNode }) {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    const element = document.createElement('div');
    setHost(element);
    return () => element.remove();
  }, []);
  useLayoutEffect(() => {
    if (!host) return;
    host.toggleAttribute('hidden', !active);
    if (active && target) target.appendChild(host);
    else host.remove();
    return () => host.remove();
  }, [host, active, target]);
  return host ? createPortal(children, host) : null;
}
