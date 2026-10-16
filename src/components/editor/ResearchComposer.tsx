"use client";

import { useEffect, useRef, type ReactNode } from 'react';
import { Send, Square, SlidersHorizontal } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

export interface ResearchComposerOptions {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onStop?: () => void;
  busy: boolean;
  disabled: boolean;
  canSubmit: boolean;
  placeholder: string;
  maxLength?: number;
  settings?: ReactNode;
  settingsLabel?: string;
  hint?: string;
}
export type ResearchComposerRenderer = (options: ResearchComposerOptions) => ReactNode;

export function ResearchComposer({ sources, onBusyChange, ...options }: ResearchComposerOptions & {
  sources: ReactNode;
  onBusyChange: (busy: boolean) => void;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  const focused = useRef(false);
  useEffect(() => { onBusyChange(options.busy); return () => onBusyChange(false); }, [options.busy, onBusyChange]);
  useEffect(() => {
    if (!options.disabled && !focused.current) { input.current?.focus(); focused.current = true; }
  }, [options.disabled]);
  useEffect(() => {
    const element = input.current;
    if (element) { element.style.height = 'auto'; element.style.height = `${Math.min(element.scrollHeight, 140)}px`; }
  }, [options.value]);

  return (
    <div className="research-mode-composer" data-testid="research-mode-composer">
      <div className="quiet-composer research-mode-input" data-workspace-skill="false">
        <textarea ref={input} aria-label="输入研究问题" value={options.value} rows={1}
          maxLength={options.maxLength} placeholder={options.placeholder}
          disabled={options.disabled || options.busy}
          onChange={event => options.onChange(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              if (options.canSubmit && !options.busy) options.onSubmit();
            }
          }} />
        <div className="research-mode-actions">
          {sources}
          {options.settings && <Popover>
            <PopoverTrigger asChild>
              <button type="button" className="research-mode-settings" disabled={options.busy || options.disabled} aria-label={options.settingsLabel || '设置'}>
                <SlidersHorizontal size={16} /><span>{options.settingsLabel || '设置'}</span>
              </button>
            </PopoverTrigger>
            <PopoverContent side="top" align="end" className="research-mode-settings-content" aria-label={options.settingsLabel || '设置'}>
              {options.settings}
            </PopoverContent>
          </Popover>}
          {options.busy && options.onStop ?
            <button type="button" data-testid="chat-stop" onClick={options.onStop} aria-label="停止生成"><Square size={17} /></button> :
            <button type="button" data-testid="research-mode-send" onClick={options.onSubmit} disabled={!options.canSubmit || options.busy} aria-label={`使用${options.label}发送`}><Send size={21} /></button>}
        </div>
      </div>
      {options.hint && <p className="research-mode-hint" role="status">{options.hint}</p>}
    </div>
  );
}
