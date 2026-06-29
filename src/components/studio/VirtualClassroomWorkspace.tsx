'use client';

import { ArrowLeft, ExternalLink, HelpCircle, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useApp } from '@/contexts/AppContext';

const CLASSROOM_ORIGIN = (process.env.NEXT_PUBLIC_VIRTUAL_CLASSROOM_ORIGIN || '').trim().replace(/\/$/, '');
const NATIVE_CLASSROOM_URL = '/virtual-classroom';

function startsWithClassroomOrigin(url: string) {
  return Boolean(
    CLASSROOM_ORIGIN &&
      (url === CLASSROOM_ORIGIN ||
        url.startsWith(`${CLASSROOM_ORIGIN}/`) ||
        url.startsWith(`${CLASSROOM_ORIGIN}?`)),
  );
}

function normalizeFrameUrl(url?: string) {
  const resolved = !url
    ? NATIVE_CLASSROOM_URL
    : url.startsWith('http://') || url.startsWith('https://')
      ? url
      : CLASSROOM_ORIGIN && !url.startsWith('/virtual-classroom') && !startsWithClassroomOrigin(url)
        ? `${CLASSROOM_ORIGIN}${url.startsWith('/') ? url : `/${url}`}`
        : url.startsWith('/')
          ? url
          : `/${url}`;

  if (resolved.startsWith('/')) {
    const separator = resolved.includes('?') ? '&' : '?';
    return resolved.includes('embed=') ? resolved : `${resolved}${separator}embed=lingbi`;
  }

  try {
    const parsed = new URL(resolved);
    if (!CLASSROOM_ORIGIN || parsed.origin === CLASSROOM_ORIGIN) parsed.searchParams.set('embed', 'lingbi');
    return parsed.toString();
  } catch {
    return resolved;
  }
}

export function VirtualClassroomWorkspace() {
  const { virtualClassroomViewer, closeVirtualClassroom } = useApp();
  const [reloadToken, setReloadToken] = useState(0);
  const [frameReady, setFrameReady] = useState(false);

  const frameUrl = useMemo(
    () => normalizeFrameUrl(virtualClassroomViewer?.url),
    [virtualClassroomViewer?.url],
  );

  useEffect(() => {
    setFrameReady(false);
  }, [frameUrl, reloadToken]);

  if (!virtualClassroomViewer) return null;

  const classroomMeta = [
    virtualClassroomViewer.sourceCount ? `${virtualClassroomViewer.sourceCount} 个资料` : null,
    virtualClassroomViewer.sceneCount ? `${virtualClassroomViewer.sceneCount} 个场景` : null,
    virtualClassroomViewer.actionsCount ? `${virtualClassroomViewer.actionsCount} 个动作` : null,
  ].filter(Boolean).join(' · ');
  const sourceSummary = virtualClassroomViewer.sourceSummary;

  return (
    <main className="relative h-full min-w-0 overflow-hidden bg-[#f8fbff]" data-testid="virtual-classroom-workspace">
      <div className="pointer-events-none absolute left-4 right-4 top-4 z-10 flex items-start justify-between gap-3">
        <div className="pointer-events-auto flex items-center gap-2">
          <button
            type="button"
            onClick={closeVirtualClassroom}
            className="liquid-glass-btn rounded-full px-4 py-2 text-xs font-semibold shadow-[var(--glass-shadow-sm)]"
            data-testid="virtual-classroom-close-workspace"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            回到资料对话
          </button>
          <div
            className="rounded-full border border-[var(--glass-border)] bg-[var(--glass-subtle)] px-3 py-2 text-xs shadow-[var(--glass-shadow-sm)] backdrop-blur-xl"
            data-testid="virtual-classroom-workspace-title"
          >
            <span className="font-semibold text-[var(--text-primary)]">
              {virtualClassroomViewer.title || '虚拟教室'}
            </span>
            {classroomMeta && (
              <span className="ml-2 text-[var(--text-secondary)]">{classroomMeta}</span>
            )}
            {sourceSummary && (
              <span className="ml-2 hidden max-w-[280px] truncate text-[var(--text-tertiary)] lg:inline-block">
                {sourceSummary}
              </span>
            )}
          </div>
        </div>

        <div className="pointer-events-auto flex shrink-0 items-center gap-2 rounded-full border border-[var(--glass-border)] bg-[var(--glass-subtle)] p-1.5 shadow-[var(--glass-shadow-sm)] backdrop-blur-xl">
          <button
            type="button"
            className="rounded-full p-2 text-[var(--text-secondary)] transition hover:bg-[var(--glass-hover)] hover:text-[var(--text-primary)]"
            title={classroomMeta ? `${virtualClassroomViewer.title || '虚拟课堂'} · ${classroomMeta}` : (virtualClassroomViewer.title || '虚拟课堂')}
            aria-label="课堂说明"
          >
            <HelpCircle className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => {
              setFrameReady(false);
              setReloadToken(value => value + 1);
            }}
            className="rounded-full p-2 text-[var(--text-secondary)] transition hover:bg-[var(--glass-hover)] hover:text-[var(--text-primary)]"
            data-testid="virtual-classroom-reload-frame"
            title="刷新课堂"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
          <a
            href={frameUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-full p-2 text-[var(--text-secondary)] transition hover:bg-[var(--glass-hover)] hover:text-[var(--text-primary)]"
            data-testid="virtual-classroom-open-external"
            title="新窗口打开"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>

      {!frameReady && (
        <div
          className="pointer-events-none absolute inset-x-0 top-0 z-[5] flex h-24 items-center justify-center bg-gradient-to-b from-[#f8fbff] via-[#f8fbff]/90 to-transparent"
          data-testid="virtual-classroom-loading"
        >
          <div className="mt-10 rounded-full border border-[var(--glass-border)] bg-[var(--glass)] px-4 py-2 text-xs font-medium text-[var(--text-secondary)] shadow-[var(--glass-shadow-sm)] backdrop-blur-xl">
            正在进入课堂...
          </div>
        </div>
      )}

      <section className="h-full min-h-0" data-testid="virtual-classroom-native-workspace">
        <iframe
          key={`${frameUrl}-${reloadToken}`}
          src={frameUrl}
          title={virtualClassroomViewer.title || '虚拟课堂'}
          className="h-full w-full border-0 bg-white"
          allow="microphone; camera; clipboard-read; clipboard-write; fullscreen"
          onLoad={() => setFrameReady(true)}
          data-testid="virtual-classroom-iframe"
        />
      </section>
    </main>
  );
}
