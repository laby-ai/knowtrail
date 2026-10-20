'use client';

import { useAppPreferences } from './AppPreferencesProvider';

const shortcuts = [
  { keys: ['Ctrl / ⌘', 'Shift', 'L'], zh: '打开文献检索', en: 'Open literature search' },
  { keys: ['Ctrl / ⌘', 'Shift', 'C'], zh: '将所选文献条目插入对话输入框', en: 'Insert selected bibliography entries into the chat input' },
  { keys: ['Ctrl / ⌘', 'Shift', 'T'], zh: '打开实验数据分析', en: 'Open research data analysis' },
  { keys: ['Enter'], zh: '发送对话消息', en: 'Send a chat message' },
  { keys: ['Shift', 'Enter'], zh: '在对话输入框中换行', en: 'Insert a new line in the chat input' },
];

export function ShortcutSettings() {
  const { preferences } = useAppPreferences();
  const en = preferences.interfaceLanguage === 'en';
  return <section data-testid="shortcut-settings" className="space-y-4">
    <h3 className="font-semibold">{en ? 'Keyboard shortcuts' : '快捷键'}</h3>
    <p className="text-sm leading-relaxed text-[var(--text-secondary)]">{en ? 'The first three shortcuts work in the notebook workspace with Research mode enabled. Select sources in the library before inserting bibliography entries. Use Ctrl on Windows and ⌘ on Mac.' : '前三项快捷键在文献本工作区开启科研模式后使用。插入文献条目前，请先在文献库中选择来源。Windows 使用 Ctrl，Mac 使用 ⌘。'}</p>
    <dl className="divide-y divide-[var(--border-subtle)] rounded-xl border border-[var(--border-subtle)] px-4">{shortcuts.map(item => <div key={item.en} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
      <dt className="text-sm leading-relaxed">{en ? item.en : item.zh}</dt>
      <dd className="flex shrink-0 flex-wrap items-center gap-1.5">{item.keys.map((key, index) => <span key={key} className="inline-flex items-center gap-1.5">{index > 0 && <span aria-hidden="true" className="text-xs text-[var(--text-tertiary)]">+</span>}<kbd className="rounded-md border border-[var(--border-subtle)] bg-[var(--glass-subtle)] px-2 py-1 text-xs font-medium">{key}</kbd></span>)}</dd>
    </div>)}</dl>
    <p className="text-xs leading-relaxed text-[var(--text-secondary)]">{en ? 'Some browsers or system utilities may intercept shortcut combinations. You can always use the corresponding buttons in the workspace.' : '部分浏览器或系统工具可能占用组合键；此时仍可使用工作区中的对应按钮。'}</p>
  </section>;
}
