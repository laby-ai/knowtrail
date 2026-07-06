'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ArrowRight, BookOpen, Menu, Presentation, Quote, Sparkles, Upload } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { BrandMark } from '@/components/brand/BrandMark';
import type { AccountAuthSession } from '@/lib/account-auth-client';
import {
  ACCOUNT_NOTEBOOK_NEXT,
  NOTEBOOK_HOME_HREF,
  type AccountCenterStatus,
} from '@/components/home/workspace-types';
import { HomeHeroMedia } from '@/components/home/HomeHeroMedia';
import { MotionReveal } from '@/components/home/MotionReveal';
import { FeatureMotionDemo, type FeatureMotionDemoVariant } from '@/components/home/FeatureMotionDemos';

type LandingPageProps = {
  accountStatus: AccountCenterStatus | null;
  accountSession: AccountAuthSession | null;
  onOpenNotebookHome: () => void;
};

const researchFeatures = [
  {
    icon: Upload,
    title: '加入来源',
    body: '上传 PDF、网页、音频、文档或笔记。KnowTrail 会整理要点，并把不同主题关联起来。',
    variant: 'sources' as FeatureMotionDemoVariant,
    label: '来源整理',
    detail: 'PDF、网页、音频和笔记放在同一个工作本里。',
  },
  {
    icon: Quote,
    title: '带着依据回答',
    body: '围绕来源提问。回答会尽量回到原文，并保留可以复核的引用线索。',
    variant: 'grounded' as FeatureMotionDemoVariant,
    label: '带依据回答',
    detail: '每次回答都尽量贴近原始来源。',
  },
  {
    icon: Presentation,
    title: '生成演示文稿',
    body: '把一组来源整理成可编辑的演示文稿，图片页与 HTML 原生排版任选，随时回到工作本继续追问。',
    variant: 'slides' as FeatureMotionDemoVariant,
    label: '演示文稿',
    detail: '一组资料一键生成可编辑幻灯片。',
  },
];

const principleSources = [
  { number: '1', title: '来源摘录', body: '标记关键段落', badgeClass: 'bg-blue-600', className: 'left-[6%] top-[14%] border-blue-200 bg-blue-50/92 text-blue-700' },
  { number: '2', title: '研究笔记', body: '保留观点与上下文', badgeClass: 'bg-emerald-500', className: 'bottom-[10%] left-[12%] border-emerald-200 bg-emerald-50/92 text-emerald-700' },
  { number: '3', title: '音频片段', body: '定位相关段落', badgeClass: 'bg-violet-500', className: 'right-[12%] top-[9%] border-violet-200 bg-violet-50/92 text-violet-700' },
];

function ResearchPartnerSection() {
  return (
    <section className="mx-auto max-w-7xl px-5 py-20">
      <MotionReveal>
        <h2 className="text-center text-4xl font-normal tracking-tight text-slate-950 md:text-5xl">从来源到理解</h2>
      </MotionReveal>
      <div className="mt-12 space-y-16">
        {researchFeatures.map((feature, index) => {
          const Icon = feature.icon;
          const flip = index % 2 === 1;
          return (
            <MotionReveal
              key={feature.title}
              delay={index * 0.08}
              className={`grid items-center gap-8 lg:grid-cols-[0.52fr_1fr] ${flip ? 'lg:grid-cols-[1fr_0.52fr]' : ''}`}
            >
              <div className={flip ? 'lg:order-2' : ''}>
                <Icon className="mb-5 h-9 w-9 text-slate-950" strokeWidth={2.1} />
                <h3 className="text-3xl font-normal tracking-tight text-slate-950">{feature.title}</h3>
                <p className="mt-5 max-w-sm text-lg leading-8 text-slate-600">{feature.body}</p>
              </div>
              <div className={flip ? 'lg:order-1' : ''}>
                <FeatureMotionDemo variant={feature.variant} label={feature.label} detail={feature.detail} />
              </div>
            </MotionReveal>
          );
        })}
      </div>
    </section>
  );
}

function WorkPrincipleSection() {
  const shouldReduceMotion = useReducedMotion();

  return (
    <section className="mx-auto grid max-w-7xl items-center gap-10 px-5 py-20 lg:grid-cols-[0.72fr_1.28fr]">
      <MotionReveal>
        <h2 className="text-4xl font-normal tracking-tight text-slate-950 md:text-5xl">工作原理</h2>
        <p className="mt-6 max-w-md text-lg leading-8 text-slate-600">
          把来源放进一个工作本。提问时，回答会围绕这组来源组织，并保留可复核的依据。
        </p>
      </MotionReveal>

      <MotionReveal delay={0.1}>
        <div className="relative min-h-[560px] overflow-hidden rounded-[34px] border border-blue-100 bg-[radial-gradient(circle_at_70%_18%,rgba(219,234,254,0.88),transparent_34%),radial-gradient(circle_at_18%_80%,rgba(209,250,229,0.72),transparent_34%),#ffffff] p-5 shadow-[0_28px_76px_rgba(37,99,235,0.10)] sm:p-8">
          <div className="absolute inset-0 bg-[linear-gradient(120deg,rgba(255,255,255,0.78),rgba(255,255,255,0.28))]" />

          {principleSources.map((source, index) => (
            <motion.div
              key={source.title}
              className={`home-principle-source absolute hidden w-[250px] rounded-[26px] border p-5 shadow-[0_22px_50px_rgba(76,96,140,0.13)] backdrop-blur md:block ${source.className}`}
              animate={shouldReduceMotion ? undefined : { y: [0, -8, 0] }}
              transition={{ duration: 7.5 + index * 0.8, repeat: Infinity, ease: 'easeInOut', delay: index * -1.1 }}
            >
              <div className="flex items-center gap-3">
                <span className={`flex h-11 w-11 items-center justify-center rounded-2xl text-base font-semibold text-white shadow-sm ${source.badgeClass}`}>
                  {source.number}
                </span>
                <div>
                  <div className="text-sm font-semibold text-slate-950">{source.title}</div>
                  <div className="mt-1 text-xs text-slate-500">{source.body}</div>
                </div>
              </div>
              <div className="mt-5 space-y-2">
                <span className="block h-2.5 w-full rounded-full bg-current/18" />
                <span className="block h-2.5 w-3/5 rounded-full bg-current/14" />
              </div>
            </motion.div>
          ))}

          <motion.div
            className="absolute left-1/2 top-[52%] w-[min(560px,calc(100%-2.5rem))] -translate-x-1/2 -translate-y-1/2 rounded-[30px] border border-blue-100 bg-white/92 p-6 shadow-[0_30px_86px_rgba(37,99,235,0.18)] backdrop-blur-md sm:p-8"
            animate={shouldReduceMotion ? undefined : { scale: [1, 1.012, 1], boxShadow: ['0 30px 86px rgba(37,99,235,0.15)', '0 34px 98px rgba(37,99,235,0.22)', '0 30px 86px rgba(37,99,235,0.15)'] }}
            transition={{ duration: 8.5, repeat: Infinity, ease: 'easeInOut' }}
          >
            <div className="flex items-center justify-between gap-4">
              <div className="rounded-full border border-blue-100 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-700">
                带依据回答
              </div>
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-400">
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                来源已检查
              </div>
            </div>
            <div className="mt-8 space-y-3">
              <span className="block h-3 w-3/4 rounded-full bg-slate-200" />
              <span className="home-evidence-breathe block h-3 w-[88%] rounded-full bg-blue-200" />
              <span className="block h-3 w-2/3 rounded-full bg-slate-200" />
              <span className="block h-3 w-5/6 rounded-full bg-slate-200" />
            </div>
            <div className="mt-8 flex flex-wrap gap-2">
              {['来源 1', '来源 2', '来源 3'].map((item, index) => (
                <span
                  key={item}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold ${index === 1 ? 'home-evidence-chip bg-emerald-500 text-white' : 'bg-slate-100 text-slate-500'}`}
                >
                  {item}
                </span>
              ))}
            </div>
          </motion.div>

          <motion.div
            className="absolute bottom-8 right-8 hidden max-w-xs items-center gap-3 rounded-3xl border border-blue-100 bg-white/88 px-4 py-3 shadow-[0_18px_46px_rgba(37,99,235,0.13)] backdrop-blur md:flex"
            animate={shouldReduceMotion ? undefined : { y: [0, -7, 0] }}
            transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut', delay: -2.4 }}
          >
            <BrandMark compact className="h-10 w-10 border-blue-100 shadow-none" />
            <div>
              <div className="text-sm font-semibold text-slate-950">KnowTrail</div>
              <div className="text-xs text-slate-500">问题、回答和来源上下文保存在一起。</div>
            </div>
          </motion.div>
        </div>
      </MotionReveal>
    </section>
  );
}

export function LandingPage({ accountStatus, accountSession, onOpenNotebookHome }: LandingPageProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const opensNotebookDirectly = Boolean(accountSession);
  const accountUrl = opensNotebookDirectly ? NOTEBOOK_HOME_HREF : `/account?next=${ACCOUNT_NOTEBOOK_NEXT}`;
  const accountCtaText = accountSession ? '进入工作本' : accountStatus?.configured ? '登录后使用' : '试用 KnowTrail';
  const mobileAccountCtaText = accountSession ? '进入' : accountStatus?.configured ? '登录' : '试用';
  const openNotebookHomeFromLink = (event: React.MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    onOpenNotebookHome();
  };
  const accountLinkClick = opensNotebookDirectly ? openNotebookHomeFromLink : undefined;

  return (
    <div className="min-h-screen bg-[#eef4ff] text-slate-950">
      <nav className="sticky top-0 z-50 bg-[#eaf2ff]/92 px-5 py-4 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-3">
            <BrandMark compact />
            <span className="whitespace-nowrap text-2xl font-semibold tracking-tight">KnowTrail</span>
          </Link>
          <div className="hidden items-center gap-8 text-base font-semibold text-slate-800 md:flex">
            <a href="#overview" className="border-b-2 border-slate-950 pb-1">概览</a>
            <a href="#how-it-works" className="pb-1">方案</a>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href={accountUrl}
              onClick={accountLinkClick}
              className="hidden h-11 items-center rounded-full px-4 text-sm font-semibold text-slate-700 transition hover:bg-white/70 md:inline-flex"
              data-testid="nav-open-notebooks"
            >
              工作本
            </Link>
            <Link
              href={accountUrl}
              onClick={accountLinkClick}
              className="inline-flex h-11 items-center gap-2 whitespace-nowrap rounded-full bg-blue-600 px-3 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(37,99,235,0.22)] transition hover:bg-blue-700 sm:px-5"
              data-testid="nav-login-account"
            >
              <span className="hidden sm:inline">{accountCtaText}</span>
              <span className="sm:hidden">{mobileAccountCtaText}</span>
              <ArrowRight className="h-4 w-4" />
            </Link>
            <button
              type="button"
              className="inline-flex h-11 w-11 items-center justify-center rounded-full text-slate-700 hover:bg-white/70 md:hidden"
              aria-label="打开菜单"
              aria-expanded={mobileMenuOpen}
              onClick={() => setMobileMenuOpen(open => !open)}
            >
              <Menu className="h-5 w-5" />
            </button>
          </div>
        </div>
        {mobileMenuOpen && (
          <div className="mx-auto mt-3 grid max-w-7xl gap-2 rounded-2xl border border-blue-100 bg-white/94 p-2 text-sm font-semibold text-slate-800 shadow-[0_18px_50px_rgba(37,99,235,0.12)] md:hidden">
            <a href="#overview" className="rounded-xl px-4 py-3 hover:bg-blue-50" onClick={() => setMobileMenuOpen(false)}>概览</a>
            <a href="#how-it-works" className="rounded-xl px-4 py-3 hover:bg-blue-50" onClick={() => setMobileMenuOpen(false)}>方案</a>
            <Link href={accountUrl} onClick={(event) => { setMobileMenuOpen(false); accountLinkClick?.(event); }} className="rounded-xl px-4 py-3 hover:bg-blue-50">
              工作本
            </Link>
          </div>
        )}
      </nav>

      <main id="overview">
        <section className="px-5 pb-12 pt-8 md:pt-14">
          <div className="mx-auto max-w-[1560px] rounded-[34px] bg-white px-5 pb-6 pt-16 shadow-[0_30px_90px_rgba(37,99,235,0.08)] md:px-8 md:pt-28">
            <div className="mx-auto max-w-5xl text-center">
              <h1 className="text-5xl font-normal leading-[1.08] tracking-[-0.03em] text-[#303134] md:text-7xl">
                了解<span className="bg-gradient-to-r from-blue-500 via-sky-400 to-emerald-400 bg-clip-text text-transparent">任何资料</span>
              </h1>
              <p className="mx-auto mt-7 max-w-3xl text-xl leading-8 text-slate-600">
                以你信任的来源为基础，把 PDF、网页、音频和笔记放进一个工作本，用提问、引用和演示文稿继续研究。
              </p>
              <div className="mt-8 flex justify-center">
                <Link
                  href={accountUrl}
                  onClick={accountLinkClick}
                  className="inline-flex h-14 items-center justify-center gap-2 rounded-full bg-blue-600 px-8 text-lg font-semibold text-white shadow-[0_14px_30px_rgba(37,99,235,0.22)] transition hover:bg-blue-700"
                  data-testid="hero-login-account"
                >
                  试用 KnowTrail
                </Link>
              </div>
            </div>
            <div className="mt-10 md:mt-12">
              <HomeHeroMedia />
            </div>
          </div>
        </section>

        <ResearchPartnerSection />
        <div id="how-it-works">
          <WorkPrincipleSection />
        </div>

        <section className="mx-auto max-w-7xl px-5 pb-24">
          <div className="flex flex-col items-center justify-between gap-5 rounded-[28px] border border-blue-100 bg-white p-7 shadow-sm md:flex-row">
            <div className="flex items-center gap-4">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                <Sparkles className="h-5 w-5" />
              </span>
              <div>
                <h2 className="text-2xl font-normal tracking-tight text-slate-950">从一个工作本开始</h2>
                <p className="mt-1 text-sm text-slate-600">上传来源、提出问题、保存结果。</p>
              </div>
            </div>
            <Link
              href={accountUrl}
              onClick={accountLinkClick}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-slate-950 px-6 text-sm font-semibold text-white transition hover:bg-slate-800"
              data-testid="hero-open-notebooks"
            >
              进入工作本
              <BookOpen className="h-4 w-4" />
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
