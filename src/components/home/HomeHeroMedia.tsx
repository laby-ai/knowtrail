'use client';

import { BookOpen, FileText, Globe2, Headphones, Presentation, Sparkles } from 'lucide-react';
import { BrandMark } from '@/components/brand/BrandMark';
import { AudioWave } from './motion/AudioWave';

const sourceTiles = [
  { label: '网页资料', icon: Globe2, className: 'left-[8%] top-[16%] border-emerald-400/30 bg-emerald-500/20 text-emerald-200' },
  { label: 'PDF 笔记', icon: FileText, className: 'left-[22%] top-[42%] border-blue-400/30 bg-blue-500/20 text-blue-200' },
  { label: '音频资料', icon: Headphones, className: 'right-[8%] top-[25%] border-violet-400/30 bg-violet-500/20 text-violet-200' },
  { label: '演示文稿', icon: Presentation, className: 'right-[18%] bottom-[13%] border-amber-400/30 bg-amber-500/20 text-amber-200' },
];

export function HomeHeroMedia() {
  return (
    <div className="home-motion-stage relative mx-auto h-[420px] w-full max-w-6xl overflow-hidden rounded-[34px] border border-white/18 bg-black/40 shadow-[0_26px_90px_rgba(0,0,0,0.4)] backdrop-blur-xl md:h-[520px]">
      <video
        className="absolute inset-x-0 bottom-0 h-full w-full object-cover opacity-95"
        controls
        autoPlay
        muted
        loop
        playsInline
        preload="metadata"
        poster="assets/home/lingbi-hero-poster.jpg"
        aria-label="灵笔产品介绍视频"
      >
        <source src="assets/home/lingbi-hero-loop.webm" type="video/webm" />
        <source src="assets/home/lingbi-hero-loop.mp4" type="video/mp4" />
      </video>

      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_16%,rgba(0,0,0,0.3),rgba(0,0,0,0.10)_42%,transparent_76%)]" />
      {sourceTiles.map((tile, index) => {
        const Icon = tile.icon;
        return (
          <div
            key={tile.label}
            className={`home-motion-float absolute hidden min-w-[176px] rounded-2xl border px-4 py-3 shadow-[0_14px_40px_rgba(0,0,0,0.3)] backdrop-blur-xl md:block ${tile.className}`}
            style={{ animationDelay: `${index * -1.2}s` }}
          >
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Icon className="h-4 w-4" />
              {tile.label}
            </div>
            {tile.label === '音频资料' ? <AudioWave /> : <div className="mt-3 space-y-2">
              <span className="block h-2 w-24 rounded-full bg-current/15" />
              <span className="block h-2 w-36 rounded-full bg-current/12" />
            </div>}
          </div>
        );
      })}

      <div className="home-motion-float-delayed absolute bottom-[20%] left-1/2 hidden -translate-x-1/2 items-center gap-3 rounded-3xl border border-white/20 bg-black/50 px-5 py-3 shadow-[0_18px_48px_rgba(0,0,0,0.4)] backdrop-blur-xl sm:flex">
        <BrandMark compact className="h-11 w-11 border-white/20 shadow-none" />
        <div>
          <div className="text-sm font-semibold text-white">KnowTrail</div>
          <div className="text-xs text-white/60">资料、笔记和回答保存在一起。</div>
        </div>
        <BookOpen className="h-5 w-5 text-blue-300" />
      </div>

      <div className="absolute bottom-5 right-6 hidden items-center gap-1.5 rounded-full border border-white/20 bg-black/40 px-3 py-2 text-xs font-semibold text-blue-200 shadow-sm backdrop-blur-xl md:flex">
        <Sparkles className="h-3.5 w-3.5" />
        资料整理流程展示
      </div>
    </div>
  );
}
