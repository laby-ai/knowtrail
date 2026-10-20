'use client';

import { useLayoutEffect, useRef } from 'react';
import { useAppPreferences } from '@/components/account/AppPreferencesProvider';
import { useUiText } from '@/components/account/UiText';

/** Grow with typed, pasted and programmatically inserted text, within the CSS height cap. */
export function ChatMessageInput({ value, onChange, onSend, queued }: {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  queued: boolean;
}) {
  const field = useRef<HTMLTextAreaElement>(null);
  const { preferences } = useAppPreferences();
  const t = useUiText();
  useLayoutEffect(() => {
    const textarea = field.current;
    if (!textarea) return;
    const resize = () => {
      textarea.style.height = 'auto';
      textarea.style.height = `${textarea.scrollHeight + textarea.offsetHeight - textarea.clientHeight}px`;
    };
    resize();
    let previousWidth = textarea.clientWidth;
    const observer = new ResizeObserver(() => {
      const width = textarea.clientWidth;
      if (width === previousWidth) return;
      previousWidth = width;
      resize();
    });
    if (textarea.parentElement) observer.observe(textarea.parentElement);
    return () => observer.disconnect();
  }, [value, preferences.fontSize]);
  return <textarea
    ref={field}
    rows={1}
    wrap="soft"
    value={value}
    aria-label={t('输入你的问题')}
    data-testid="chat-composer-input"
    placeholder={queued ? t('输入问题加入等待队列…') : t('输入你的问题…')}
    title={t('Enter 发送，Shift+Enter 换行')}
    onChange={event => onChange(event.target.value)}
    onKeyDown={event => {
      if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
      event.preventDefault();
      if (value.trim()) onSend();
    }}
    className="liquid-glass-input min-w-0 flex-1 resize-none overflow-y-auto whitespace-pre-wrap break-words !py-3 !leading-6"
    style={{ minHeight: '3rem', maxHeight: 'min(12rem, 28dvh)', overflowWrap: 'anywhere' }}
  />;
}
