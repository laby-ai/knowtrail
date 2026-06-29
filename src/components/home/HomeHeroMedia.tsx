'use client';

import { BookOpen, FileText, Globe2, Headphones, Presentation, Sparkles } from 'lucide-react';
import { BrandMark } from '@/components/brand/BrandMark';

const sourceTiles = [
  { label: '网页资料', icon: Globe2, className: 'left-[8%] top-[16%] bg-emerald-50/92 text-emerald-700' },
  { label: 'PDF 笔记', icon: FileText, className: 'left-[22%] top-[42%] bg-blue-50/94 text-blue-700' },
  { label: '音频概览', icon: Headphones, className: 'right-[8%] top-[25%] bg-violet-50/92 text-violet-700' },
  { label: '演示文稿', icon: Presentation, className: 'right-[18%] bottom-[13%] bg-amber-50/94 text-amber-700' },
];

export function HomeHeroMedia() {
  return (
    <div className="home-motion-stage pointer-events-none relative mx-auto h-[420px] w-full max-w-6xl overflow-hidden rounded-[34px] bg-white shadow-[0_26px_90px_rgba(73,104,170,0.14)] ring-1 ring-blue-100/80 md:h-[520px]">
      <video
        className="absolute inset-x-0 bottom-0 h-full w-full object-cover opacity-95"
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        poster="/assets/home/lingbi-hero-poster.jpg"
        aria-hidden="true"
      >
        <source src="/assets/home/lingbi-hero-loop.webm" type="video/webm" />
        <source src="/assets/home/lingbi-hero-loop.mp4" type="video/mp4" />
      </video>

      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_16%,rgba(255,255,255,0.94),rgba(255,255,255,0.20)_42%,rgba(255,255,255,0)_76%)]" />
      <div className="absolute left-1/2 top-[44%] flex w-[calc(100%-2rem)] max-w-[460px] -translate-x-1/2 -translate-y-1/2 items-center gap-2 rounded-[28px] border border-blue-100 bg-white/90 px-3 py-3 shadow-[0_18px_50px_rgba(37,99,235,0.16)] backdrop-blur sm:w-auto sm:gap-3 sm:px-5 sm:py-4">
        <button
          type="button"
          aria-hidden="true"
          className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-blue-600 text-white shadow-lg shadow-blue-500/25 sm:h-12 sm:w-12"
        >
          <span className="h-5 w-1.5 rounded-full bg-white" />
          <span className="ml-1 h-5 w-1.5 rounded-full bg-white" />
        </button>
        <span className="flex-shrink-0 text-sm font-medium text-slate-600">1:42</span>
        <span className="relative h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-200 sm:w-44 sm:flex-none">
          <span className="absolute inset-y-0 left-0 w-[58%] rounded-full bg-blue-600" />
          <span className="absolute left-[55%] top-1/2 h-5 w-5 -translate-y-1/2 rounded-full bg-blue-500 shadow-md shadow-blue-500/30" />
        </span>
        <span className="flex-shrink-0 text-sm font-medium text-slate-500">3:01</span>
      </div>

      {sourceTiles.map((tile, index) => {
        const Icon = tile.icon;
        return (
          <div
            key={tile.label}
            className={`home-motion-float absolute hidden min-w-[176px] rounded-2xl border border-white/80 px-4 py-3 shadow-[0_14px_40px_rgba(95,116,160,0.14)] backdrop-blur md:block ${tile.className}`}
            style={{ animationDelay: `${index * -1.2}s` }}
          >
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Icon className="h-4 w-4" />
              {tile.label}
            </div>
            <div className="mt-3 space-y-2">
              <span className="block h-2 w-24 rounded-full bg-current/15" />
              <span className="block h-2 w-36 rounded-full bg-current/12" />
            </div>
          </div>
        );
      })}

      <div className="home-motion-float-delayed absolute bottom-[20%] left-1/2 hidden -translate-x-1/2 items-center gap-3 rounded-3xl border border-blue-100 bg-white/88 px-5 py-3 shadow-[0_18px_48px_rgba(37,99,235,0.14)] backdrop-blur sm:flex">
        <BrandMark compact className="h-11 w-11 border-blue-100 shadow-none" />
        <div>
          <div className="text-sm font-semibold text-slate-950">KnowTrail</div>
          <div className="text-xs text-slate-500">资料、笔记和回答保存在一起。</div>
        </div>
        <BookOpen className="h-5 w-5 text-blue-600" />
      </div>

      <div className="absolute bottom-5 right-6 hidden items-center gap-1.5 rounded-full border border-blue-100 bg-white/86 px-3 py-2 text-xs font-semibold text-blue-700 shadow-sm md:flex">
        <Sparkles className="h-3.5 w-3.5" />
        实时资料脉络
      </div>
    </div>
  );
}
