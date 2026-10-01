'use client';

import { BookOpen, FileAudio, FileText, Globe2, LayoutTemplate, Presentation, Sparkles } from 'lucide-react';
import { BrandMark } from '@/components/brand/BrandMark';

export type FeatureMotionDemoVariant = 'sources' | 'grounded' | 'slides';

type FeatureMotionDemoProps = {
  variant: FeatureMotionDemoVariant;
  label: string;
  detail: string;
};

function SkeletonLines({ tone = 'slate' }: { tone?: 'slate' | 'blue' | 'emerald' | 'violet' }) {
  const toneClass = {
    slate: 'bg-white/20',
    blue: 'bg-blue-400/40',
    emerald: 'bg-emerald-400/40',
    violet: 'bg-violet-400/40',
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
    { title: '网页文献', detail: '研究背景', icon: Globe2, className: 'home-demo-source-a border-emerald-400/30 bg-emerald-500/15 text-emerald-200' },
    { title: '论文 PDF', detail: '关键段落', icon: FileText, className: 'home-demo-source-b border-blue-400/30 bg-blue-500/15 text-blue-200' },
    { title: '实验记录', detail: '方法要点', icon: FileAudio, className: 'home-demo-source-c border-violet-400/30 bg-violet-500/15 text-violet-200' },
  ];

  return (
    <div className="home-demo-frame home-demo-sources">
      <div className="home-demo-orbit home-demo-orbit-one" />
      <div className="home-demo-orbit home-demo-orbit-two" />

      <div className="absolute left-[10%] top-[12%] flex items-center gap-2 rounded-full border border-white/20 bg-black/40 px-4 py-2 text-sm font-semibold text-white/80 shadow-sm backdrop-blur-xl">
        <Sparkles className="h-4 w-4 text-blue-300" />
        加入文献库
      </div>

      {sources.map((source) => {
        const Icon = source.icon;
        return (
          <div key={source.title} className={`home-demo-source absolute rounded-3xl border p-4 shadow-[0_20px_52px_rgba(0,0,0,0.3)] backdrop-blur-xl ${source.className}`}>
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/10 shadow-sm">
                <Icon className="h-5 w-5" />
              </span>
              <div>
                <div className="text-sm font-semibold text-white">{source.title}</div>
                <div className="text-xs text-white/60">{source.detail}</div>
              </div>
            </div>
            <div className="mt-4">
              <SkeletonLines tone={source.title === '网页文献' ? 'emerald' : source.title === '论文 PDF' ? 'blue' : 'violet'} />
            </div>
          </div>
        );
      })}

      <div className="home-demo-workspace absolute left-1/2 top-[56%] w-[min(440px,calc(100%-3rem))] -translate-x-1/2 -translate-y-1/2 rounded-[30px] border border-white/20 bg-black/50 p-5 shadow-[0_26px_80px_rgba(0,0,0,0.4)] backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <BrandMark compact className="h-11 w-11 border-white/20 shadow-none" />
          <div className="min-w-0">
            <div className="text-sm font-semibold text-white">KnowTrail</div>
            <div className="truncate text-xs text-white/60">资料会变成可以追问的文献本。</div>
          </div>
          <BookOpen className="ml-auto h-5 w-5 text-blue-300" />
        </div>
        <div className="mt-5 grid grid-cols-3 gap-2">
          <span className="h-14 rounded-2xl bg-emerald-500/15" />
          <span className="h-14 rounded-2xl bg-blue-500/15" />
          <span className="h-14 rounded-2xl bg-violet-500/15" />
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
    { id: '1', title: '文献 1', tone: 'blue' },
    { id: '2', title: '文献 2', tone: 'emerald' },
    { id: '3', title: '记录 3', tone: 'violet' },
  ] as const;

  return (
    <div className="home-demo-frame home-demo-grounded">
      <div className="home-grounded-query absolute left-[6%] top-[10%] flex w-[min(380px,58%)] items-center gap-3 rounded-full border border-white/20 bg-black/40 px-5 py-3 shadow-[0_16px_44px_rgba(0,0,0,0.3)] backdrop-blur-xl">
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-white/80">这个结论依据什么？</span>
        <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-blue-500/20 text-xs font-semibold text-blue-200">?</span>
      </div>

      <div className="home-grounded-answer absolute bottom-[12%] left-[7%] w-[min(510px,56%)] rounded-[30px] border border-white/20 bg-black/50 p-6 shadow-[0_24px_72px_rgba(0,0,0,0.4)] backdrop-blur-xl">
        <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-blue-400/30 bg-blue-500/20 px-4 py-2 text-sm font-semibold text-blue-200">
          <span className="home-grounded-dot h-2.5 w-2.5 rounded-full bg-blue-400" />
          证据溯源回答
        </div>
        <div className="space-y-3.5">
          <span className="block h-3 w-[76%] rounded-full bg-white/20" />
          <span className="home-answer-focus block h-3 w-[88%] rounded-full bg-blue-400/40" />
          <span className="block h-3 w-[67%] rounded-full bg-white/20" />
          <span className="block h-3 w-[81%] rounded-full bg-white/20" />
        </div>
        <div className="mt-8 flex gap-2">
          <span className="h-9 w-12 rounded-full bg-blue-600" />
          <span className="home-answer-chip h-9 w-12 rounded-full bg-emerald-500" />
          <span className="h-9 w-12 rounded-full bg-violet-500" />
        </div>
      </div>

      <div className="home-grounded-source-list absolute right-[7%] top-[14%] w-[min(360px,34%)] rounded-[30px] border border-white/20 bg-black/50 p-5 shadow-[0_24px_72px_rgba(0,0,0,0.4)] backdrop-blur-xl">
        <div className="mb-5 inline-flex rounded-full border border-white/20 bg-white/10 px-5 py-2 text-sm font-medium text-white/70">证据来源</div>
        <div className="space-y-4">
          {sourceRows.map((source, index) => (
            <div
              key={source.id}
              className={`home-source-proof-row ${index === 1 ? 'home-source-proof-active' : ''} home-source-proof-${source.tone}`}
            >
              <span className="home-source-proof-badge">{source.id}</span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-white">{source.title}</div>
                <div className="mt-3 space-y-2 overflow-hidden">
                  <span className="home-source-proof-line block h-2.5 w-full rounded-full bg-white/20" />
                  <span className="home-source-proof-line block h-2.5 w-3/4 rounded-full bg-white/20" />
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

function SlidesDemo({ label, detail }: Pick<FeatureMotionDemoProps, 'label' | 'detail'>) {
  return (
    <div className="home-demo-frame home-demo-audio">
      <div className="absolute left-[8%] top-[12%] w-[min(380px,45%)] rounded-[30px] border border-amber-400/30 bg-amber-500/10 p-5 shadow-[0_24px_70px_rgba(0,0,0,0.3)] backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-500/20 text-amber-200">
            <Presentation className="h-5 w-5" />
          </span>
          <div>
            <div className="text-sm font-semibold text-white">组会材料</div>
            <div className="text-xs text-white/60">图片页与 HTML 原生排版</div>
          </div>
        </div>
        <div className="mt-6 space-y-3">
          <span className="block h-3 w-3/4 rounded-full bg-amber-400/40" />
          <SkeletonLines tone="slate" />
        </div>
      </div>

      <div className="absolute left-1/2 top-[52%] w-[min(560px,calc(100%-3rem))] -translate-x-1/2 -translate-y-1/2 rounded-[32px] border border-white/20 bg-black/50 p-5 shadow-[0_28px_82px_rgba(0,0,0,0.4)] backdrop-blur-xl">
        <div className="grid grid-cols-3 gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className={`home-slide-thumb rounded-2xl border border-white/10 bg-white/5 p-3 ${i === 1 ? 'ring-2 ring-blue-400/50' : ''}`} style={{ animationDelay: `${i * -0.7}s` }}>
              <span className="block h-2 w-2/3 rounded-full bg-blue-400/50" />
              <span className="mt-2 block h-1.5 w-full rounded-full bg-white/15" />
              <span className="mt-1.5 block h-1.5 w-4/5 rounded-full bg-white/15" />
              <span className="mt-3 block h-8 rounded-lg bg-white/10 shadow-sm" />
            </div>
          ))}
        </div>
      </div>

      <div className="absolute bottom-[11%] right-[8%] w-[min(360px,38%)] rounded-[30px] border border-emerald-400/30 bg-emerald-500/10 p-5 shadow-[0_24px_70px_rgba(0,0,0,0.3)] backdrop-blur-xl">
        <div className="mb-5 flex items-center gap-2 text-sm font-semibold text-emerald-200">
          <LayoutTemplate className="h-4 w-4" />
          可编辑导出
        </div>
        <div className="space-y-3">
          <span className="block h-10 rounded-2xl bg-white/10" />
          <span className="block h-10 rounded-2xl bg-white/6" />
        </div>
      </div>

      <div className="absolute right-[13%] top-[15%] hidden w-[210px] rounded-[26px] border border-amber-400/30 bg-amber-500/10 p-4 text-amber-200 shadow-[0_20px_58px_rgba(0,0,0,0.3)] backdrop-blur-xl md:block">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="h-4 w-4" />
          自动质检
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
  return <SlidesDemo label={label} detail={detail} />;
}
