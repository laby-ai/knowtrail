'use client';

import { BookOpen, FileAudio, FileText, Globe2, Headphones, MessageCircle, Search, Sparkles } from 'lucide-react';
import { BrandMark } from '@/components/brand/BrandMark';

export type FeatureMotionDemoVariant = 'sources' | 'grounded' | 'audio';

type FeatureMotionDemoProps = {
  variant: FeatureMotionDemoVariant;
  label: string;
  detail: string;
};

function SkeletonLines({ tone = 'slate' }: { tone?: 'slate' | 'blue' | 'emerald' | 'violet' }) {
  const toneClass = {
    slate: 'bg-slate-200',
    blue: 'bg-blue-200',
    emerald: 'bg-emerald-200',
    violet: 'bg-violet-200',
  }[tone];

  return (
    <div className="space-y-2.5">
      <span className={`block h-2.5 w-full rounded-full ${toneClass}`} />
      <span className={`block h-2.5 w-3/4 rounded-full ${toneClass} opacity-80`} />
      <span className={`block h-2.5 w-5/6 rounded-full ${toneClass} opacity-60`} />
    </div>
  );
}

function SourcesDemo({ label, detail }: Pick<FeatureMotionDemoProps, 'label' | 'detail'>) {
  const sources = [
    { title: '网页资料', detail: '市场信号', icon: Globe2, className: 'home-demo-source-a border-emerald-100 bg-emerald-50 text-emerald-700' },
    { title: 'PDF 笔记', detail: '关键段落', icon: FileText, className: 'home-demo-source-b border-blue-100 bg-blue-50 text-blue-700' },
    { title: '音频片段', detail: '讨论要点', icon: FileAudio, className: 'home-demo-source-c border-violet-100 bg-violet-50 text-violet-700' },
  ];

  return (
    <div className="home-demo-frame home-demo-sources">
      <div className="home-demo-orbit home-demo-orbit-one" />
      <div className="home-demo-orbit home-demo-orbit-two" />

      <div className="absolute left-[10%] top-[12%] flex items-center gap-2 rounded-full border border-blue-100 bg-white/86 px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm backdrop-blur">
        <Sparkles className="h-4 w-4 text-blue-600" />
        加入来源
      </div>

      {sources.map((source) => {
        const Icon = source.icon;
        return (
          <div key={source.title} className={`home-demo-source absolute rounded-3xl border p-4 shadow-[0_20px_52px_rgba(91,118,163,0.14)] backdrop-blur ${source.className}`}>
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/82 shadow-sm">
                <Icon className="h-5 w-5" />
              </span>
              <div>
                <div className="text-sm font-semibold text-slate-950">{source.title}</div>
                <div className="text-xs text-slate-500">{source.detail}</div>
              </div>
            </div>
            <div className="mt-4">
              <SkeletonLines tone={source.title === '网页资料' ? 'emerald' : source.title === 'PDF 笔记' ? 'blue' : 'violet'} />
            </div>
          </div>
        );
      })}

      <div className="home-demo-workspace absolute left-1/2 top-[56%] w-[min(440px,calc(100%-3rem))] -translate-x-1/2 -translate-y-1/2 rounded-[30px] border border-blue-100 bg-white/92 p-5 shadow-[0_26px_80px_rgba(37,99,235,0.17)] backdrop-blur">
        <div className="flex items-center gap-3">
          <BrandMark compact className="h-11 w-11 border-blue-100 shadow-none" />
          <div className="min-w-0">
            <div className="text-sm font-semibold text-slate-950">KnowTrail</div>
            <div className="truncate text-xs text-slate-500">资料会变成可以追问的工作本。</div>
          </div>
          <BookOpen className="ml-auto h-5 w-5 text-blue-600" />
        </div>
        <div className="mt-5 grid grid-cols-3 gap-2">
          <span className="h-14 rounded-2xl bg-emerald-50" />
          <span className="h-14 rounded-2xl bg-blue-50" />
          <span className="h-14 rounded-2xl bg-violet-50" />
        </div>
      </div>

      <div className="home-demo-caption">
        <span>{label}</span>
        <small>{detail}</small>
      </div>
    </div>
  );
}

function GroundedDemo({ label, detail }: Pick<FeatureMotionDemoProps, 'label' | 'detail'>) {
  const sourceRows = [
    { id: '1', title: '来源 1', tone: 'blue' },
    { id: '2', title: '来源 2', tone: 'emerald' },
    { id: '3', title: '来源 3', tone: 'violet' },
  ] as const;

  return (
    <div className="home-demo-frame home-demo-grounded">
      <div className="home-grounded-query absolute left-[6%] top-[10%] flex w-[min(380px,58%)] items-center gap-3 rounded-full border border-blue-100 bg-white/88 px-5 py-3 shadow-[0_16px_44px_rgba(76,96,140,0.12)] backdrop-blur">
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-700">这个结论依据什么？</span>
        <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-blue-50 text-xs font-semibold text-blue-600">?</span>
      </div>

      <div className="home-grounded-answer absolute bottom-[12%] left-[7%] w-[min(510px,56%)] rounded-[30px] border border-blue-100 bg-white/92 p-6 shadow-[0_24px_72px_rgba(37,99,235,0.14)] backdrop-blur">
        <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-blue-100 bg-blue-50 px-4 py-2 text-sm font-semibold text-slate-700">
          <span className="home-grounded-dot h-2.5 w-2.5 rounded-full bg-blue-600" />
          带依据回答
        </div>
        <div className="space-y-3.5">
          <span className="block h-3 w-[76%] rounded-full bg-slate-200" />
          <span className="home-answer-focus block h-3 w-[88%] rounded-full bg-blue-200" />
          <span className="block h-3 w-[67%] rounded-full bg-slate-200" />
          <span className="block h-3 w-[81%] rounded-full bg-slate-200" />
        </div>
        <div className="mt-8 flex gap-2">
          <span className="h-9 w-12 rounded-full bg-blue-600" />
          <span className="home-answer-chip h-9 w-12 rounded-full bg-emerald-500" />
          <span className="h-9 w-12 rounded-full bg-violet-500" />
        </div>
      </div>

      <div className="home-grounded-source-list absolute right-[7%] top-[14%] w-[min(360px,34%)] rounded-[30px] border border-blue-100 bg-white/92 p-5 shadow-[0_24px_72px_rgba(76,96,140,0.14)] backdrop-blur">
        <div className="mb-5 inline-flex rounded-full border border-slate-200 bg-slate-50 px-5 py-2 text-sm font-medium text-slate-600">来源</div>
        <div className="space-y-4">
          {sourceRows.map((source, index) => (
            <div
              key={source.id}
              className={`home-source-proof-row ${index === 1 ? 'home-source-proof-active' : ''} home-source-proof-${source.tone}`}
            >
              <span className="home-source-proof-badge">{source.id}</span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-slate-700">{source.title}</div>
                <div className="mt-3 space-y-2 overflow-hidden">
                  <span className="home-source-proof-line block h-2.5 w-full rounded-full bg-slate-300" />
                  <span className="home-source-proof-line block h-2.5 w-3/4 rounded-full bg-slate-300" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="home-demo-caption">
        <span>{label}</span>
        <small>{detail}</small>
      </div>
    </div>
  );
}

function AudioDemo({ label, detail }: Pick<FeatureMotionDemoProps, 'label' | 'detail'>) {
  const bars = [22, 46, 30, 62, 38, 72, 44, 58, 34, 66, 40, 54, 28, 48, 24];

  return (
    <div className="home-demo-frame home-demo-audio">
      <div className="absolute left-[8%] top-[12%] w-[min(380px,45%)] rounded-[30px] border border-violet-100 bg-white/90 p-5 shadow-[0_24px_70px_rgba(91,65,199,0.13)] backdrop-blur">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-violet-50 text-violet-600">
            <Headphones className="h-5 w-5" />
          </span>
          <div>
            <div className="text-sm font-semibold text-slate-950">音频概览</div>
            <div className="text-xs text-slate-500">一段适合路上听的摘要</div>
          </div>
        </div>
        <div className="home-audio-visual mt-7 flex h-24 items-end gap-1.5 rounded-[24px] bg-violet-50/80 px-4 pb-4 pt-5">
          {bars.map((height, index) => (
            <span key={index} style={{ height: `${height}%`, animationDelay: `${index * -90}ms` }} />
          ))}
        </div>
      </div>

      <div className="absolute left-1/2 top-[52%] w-[min(560px,calc(100%-3rem))] -translate-x-1/2 -translate-y-1/2 rounded-[32px] border border-blue-100 bg-white/94 p-5 shadow-[0_28px_82px_rgba(37,99,235,0.16)] backdrop-blur">
        <div className="flex items-center gap-4">
          <button type="button" aria-hidden="true" className="flex h-14 w-14 items-center justify-center rounded-full bg-blue-600 text-white shadow-lg shadow-blue-500/20">
            <span className="ml-1 h-0 w-0 border-y-[9px] border-l-[14px] border-y-transparent border-l-white" />
          </button>
          <span className="text-sm font-medium text-slate-600">1:42</span>
          <span className="relative h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-200">
            <span className="home-audio-progress absolute inset-y-0 left-0 rounded-full bg-blue-600" />
          </span>
          <span className="text-sm font-medium text-slate-500">3:01</span>
        </div>
      </div>

      <div className="absolute bottom-[11%] right-[8%] w-[min(360px,38%)] rounded-[30px] border border-emerald-100 bg-emerald-50/86 p-5 shadow-[0_24px_70px_rgba(16,185,129,0.12)] backdrop-blur">
        <div className="mb-5 flex items-center gap-2 text-sm font-semibold text-emerald-700">
          <MessageCircle className="h-4 w-4" />
          继续追问
        </div>
        <div className="space-y-3">
          <span className="block h-10 rounded-2xl bg-white/82" />
          <span className="block h-10 rounded-2xl bg-white/62" />
        </div>
      </div>

      <div className="absolute right-[13%] top-[15%] hidden w-[210px] rounded-[26px] border border-amber-100 bg-amber-50/90 p-4 text-amber-700 shadow-[0_20px_58px_rgba(245,158,11,0.13)] backdrop-blur md:block">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Search className="h-4 w-4" />
          关键片段
        </div>
        <div className="mt-4">
          <SkeletonLines />
        </div>
      </div>

      <div className="home-demo-caption">
        <span>{label}</span>
        <small>{detail}</small>
      </div>
    </div>
  );
}

export function FeatureMotionDemo({ variant, label, detail }: FeatureMotionDemoProps) {
  if (variant === 'sources') return <SourcesDemo label={label} detail={detail} />;
  if (variant === 'grounded') return <GroundedDemo label={label} detail={detail} />;
  return <AudioDemo label={label} detail={detail} />;
}
