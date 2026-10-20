'use client';

import { useEffect, useState } from 'react';
import { checkedApiFetch } from '@/lib/api-response';
import { BookOpen, Quote, FlaskConical, Presentation, UsersRound, ArrowRight } from 'lucide-react';
import { useAppPreferences } from './AppPreferencesProvider';

const capabilities = [
  { icon: BookOpen, zh: '文献与资料', en: 'Literature and sources', body: '按研究主题组织文献本、文件夹与资料，检索论文、发现信源，并整理文献矩阵。', english: 'Organize notebooks, folders and sources; search papers, discover sources and build literature matrices.' },
  { icon: Quote, zh: '问答与引证', en: 'Conversations and citations', body: '围绕选定资料提问，查看来源片段与引用线索，辅助核对证据。引用核验不能替代人工阅读全文。', english: 'Ask questions about selected sources and inspect excerpts and citations. Citation checks do not replace reading the full text.' },
  { icon: FlaskConical, zh: '研究与写作', en: 'Research and writing', body: '辅助深度研究、假设生成、实验设计、数据分析、学术写作与论文审查。具体工具以当前配置和页面提示为准。', english: 'Support research, hypotheses, experimental design, data analysis, writing and review. Tool availability depends on configuration and the notices shown in each tool.' },
  { icon: Presentation, zh: '科研成果', en: 'Research outputs', body: '整理科研示意图、汇报演示文稿和研究记录，下载已有成果，继续修改与核对。', english: 'Create scientific illustrations, presentations and research records; download, revise and verify your outputs.' },
  { icon: UsersRound, zh: '课题组协作', en: 'Team collaboration', body: '通过课题组共享与授权协作开展研究。可访问的资料和操作范围以文献本授权及成员权限为准。', english: 'Collaborate through team sharing and permissions. Access to sources and actions is governed by notebook and member permissions.' },
];

export function AboutSettings({ onNavigate }: { onNavigate: (section: string) => void }) {
  const { preferences } = useAppPreferences();
  const en = preferences.interfaceLanguage === 'en';
  const [release, setRelease] = useState('');
  const [releaseFailed, setReleaseFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void checkedApiFetch('/api/app-info', { cache: 'no-store', signal: controller.signal }).then(async response => {
      const payload: unknown = await response.json();
      if (!response.ok || !payload || typeof payload !== 'object' || !('releaseId' in payload) || typeof payload.releaseId !== 'string') throw new Error('release_unavailable');
      if (!controller.signal.aborted) setRelease(payload.releaseId);
    }).catch(() => { if (!controller.signal.aborted) setReleaseFailed(true); });
    return () => controller.abort();
  }, []);
  return <div data-testid="about-settings" className="space-y-7">
    <section className="space-y-3 border-b border-[var(--border-subtle)] pb-6">
      <span className="inline-flex rounded-full bg-blue-500/10 px-3 py-1 text-xs font-medium text-[var(--accent-blue)]">{en ? 'Research workspace · Web' : '科研工作空间 · 网页版'}</span>
      <h3 className="text-xl font-semibold">灵笔 · KnowTrail</h3>
      <p className="break-all text-xs text-[var(--text-tertiary)]">{en ? 'Release: ' : '当前发布：'}{release || (releaseFailed ? (en ? 'Unavailable' : '暂时无法读取') : (en ? 'Loading…' : '正在读取…'))}</p>
      <p className="text-sm leading-relaxed text-[var(--text-secondary)]">{en ? 'Bring literature, evidence, conversations and research outputs into one workspace. Start from sources, preserve your reasoning and return to evidence when revising.' : '把文献、证据、对话与研究成果放在同一个工作空间。从资料出发提出问题，保留研究过程，在修改与交流中随时回到来源。'}</p>
    </section>

    <section className="space-y-3"><h4 className="font-semibold">{en ? 'What you can do' : '灵笔可以做什么'}</h4>
      <div className="grid gap-3 sm:grid-cols-2">{capabilities.map(item => <article key={item.en} className="rounded-xl border border-[var(--border-subtle)] p-4">
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold"><item.icon className="h-4 w-4 shrink-0 text-[var(--accent-blue)]" />{en ? item.en : item.zh}</div>
        <p className="text-sm leading-relaxed text-[var(--text-secondary)]">{en ? item.english : item.body}</p>
      </article>)}</div>
    </section>

    <section className="space-y-3"><h4 className="font-semibold">{en ? 'Your data and preferences' : '数据与个人偏好'}</h4>
      <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed text-[var(--text-secondary)]">
        <li>{en ? 'Interface language and AI output language are independent. Font size and motion preferences are saved to your account. English interface translation is still in preview.' : '界面语言与 AI 输出语言独立设置；字号和动效偏好按账号保存。英文界面仍在逐步完善。'}</li>
        <li>{en ? 'Turning off conversation saving stops new browser and cloud saves. Existing history and manually saved research artifacts are retained. Turning it on also saves the current conversation.' : '关闭历史保存后，停止新增对话的浏览器与云端保存；已有历史和手动保存的研究成果仍保留。重新开启会保存当前对话。'}</li>
        <li>{en ? 'History downloads contain cloud-saved conversations and research artifacts as JSON. Download original source files separately from their notebooks.' : '历史下载以 JSON 提供云端已保存的对话与研究成果；原始附件需在对应文献本中另行下载。'}</li>
        <li>{en ? 'AI tasks may send selected source material to the model service being used. Check authorization before uploading or sharing sensitive research material.' : 'AI 任务可能将所选资料发送至当前使用的模型服务。上传或共享敏感研究资料前，请确认资料授权与保密要求。'}</li>
      </ul>
    </section>

    <section className="space-y-3"><h4 className="font-semibold">{en ? 'Common questions' : '常见问题'}</h4>
      <details className="rounded-xl border border-[var(--border-subtle)] p-4 text-sm"><summary className="cursor-pointer font-medium">{en ? 'Why is an AI tool unavailable?' : '为什么部分 AI 功能暂时不可用？'}</summary><p className="mt-3 leading-relaxed text-[var(--text-secondary)]">{en ? 'Check the notice in the tool, model configuration, membership and available points. Some tools require a connected third-party service. Do not repeatedly submit a task that is still running.' : '请先查看工具中的提示，再检查模型配置、会员和可用点数。部分工具依赖第三方服务连接；任务仍在处理中时，请勿反复提交。'}</p></details>
      <details className="rounded-xl border border-[var(--border-subtle)] p-4 text-sm"><summary className="cursor-pointer font-medium">{en ? 'How do I report a problem?' : '遇到问题时，应该提供哪些信息？'}</summary><p className="mt-3 leading-relaxed text-[var(--text-secondary)]">{en ? 'Record the tool name, time, steps, browser and on-screen error or task ID. Redact private source material and personal information in screenshots. Never include passwords, verification codes or API keys.' : '记录功能名称、发生时间、操作步骤、浏览器，以及页面错误或任务编号。截图时遮挡私人资料和个人信息，不要提供密码、验证码或 API 密钥。'}</p></details>
      <details className="rounded-xl border border-[var(--border-subtle)] p-4 text-sm"><summary className="cursor-pointer font-medium">{en ? 'How do updates work?' : '如何使用最新版本？'}</summary><p className="mt-3 leading-relaxed text-[var(--text-secondary)]">{en ? 'This is a web application. After an update is deployed, refresh the page to load it. Save important work first. If the screen appears outdated, try a full refresh.' : '灵笔为网页应用，更新发布后刷新页面即可加载。刷新前请先保存重要内容；如果仍显示旧界面，可以尝试强制刷新。'}</p></details>
    </section>

    <section className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4"><h4 className="mb-2 text-sm font-semibold">{en ? 'Research responsibility' : '科研使用提醒'}</h4><p className="text-sm leading-relaxed text-[var(--text-secondary)]">{en ? 'AI-generated content may contain errors or unsupported claims. Verify source texts, citations, data and conclusions before submission or publication. Generated writing, diagrams and analyses require human review; they do not constitute peer review or a guarantee of research validity.' : '内容由 AI 生成，可能存在错误或缺乏依据的判断。投稿、发表或对外使用前，请核对原文、引用、数据与结论。生成的文字、图表和分析均需人工审阅，不代表同行评审结论或科研有效性保证。'}</p></section>

    <div className="flex flex-wrap gap-2 border-t border-[var(--border-subtle)] pt-5">{[{ id: 'general', zh: '通用设置', en: 'General settings' }, { id: 'history', zh: '历史与下载', en: 'History & downloads' }, { id: 'security', zh: '账号安全', en: 'Account security' }].map(item => <button key={item.id} type="button" onClick={() => onNavigate(item.id)} className="liquid-glass-btn inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm">{en ? item.en : item.zh}<ArrowRight className="h-3.5 w-3.5" /></button>)}</div>
  </div>;
}
