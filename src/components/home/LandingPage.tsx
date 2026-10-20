'use client';

import { UiText } from '@/components/account/UiText';
import Link from 'next/link';
import { ResearchSky } from '@/components/home/ResearchSky';
import {
  BarChart3,
  BookOpen,
  ClipboardCheck,
  Database,
  FileDown,
  GitCompare,
  PenLine,
  Presentation,
  Quote,
  Sparkles,
  Table2,
  Upload,
  UsersRound,
  type LucideIcon,
} from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { BrandMark } from '@/components/brand/BrandMark';
import { ThemeToggle } from '@/components/ui/theme-toggle';
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
    title: '建立文献库',
    body: '上传 PDF、网页、音频、文档或研究笔记。KnowTrail 会整理要点、保留出处，并把主题词和证据线索关联起来。',
    variant: 'sources' as FeatureMotionDemoVariant,
    label: '文献库整理',
    detail: 'PDF、网页、音频和研究笔记放在同一个文献本里。',
  },
  {
    icon: Quote,
    title: '证据溯源回答',
    body: '围绕来源提问。回答会回到原文依据，保留可复核的引用线索，区分资料原文与分析判断。',
    variant: 'grounded' as FeatureMotionDemoVariant,
    label: '证据溯源',
    detail: '每次回答都尽量贴近原始来源。',
  },
  {
    icon: Presentation,
    title: '形成组会材料',
    body: '把一组文献和实验记录整理成可编辑的汇报材料，图片页与 HTML 原生排版任选，随时回到文献本继续追问。',
    variant: 'slides' as FeatureMotionDemoVariant,
    label: '组会材料',
    detail: '一组资料一键生成可编辑汇报。',
  },
];

const principleSources = [
  { number: '1', title: '文献摘录', body: '标记关键段落', badgeClass: 'bg-blue-600', className: 'left-[6%] top-[14%] border-blue-200 bg-blue-50/92 text-blue-700' },
  { number: '2', title: '研究笔记', body: '保留观点与上下文', badgeClass: 'bg-emerald-500', className: 'bottom-[10%] left-[12%] border-emerald-200 bg-emerald-50/92 text-emerald-700' },
  { number: '3', title: '实验记录', body: '定位证据段落', badgeClass: 'bg-violet-500', className: 'right-[12%] top-[9%] border-violet-200 bg-violet-50/92 text-violet-700' },
];

type ResearchRoadmapGroup = {
  label: string;
  title: string;
  body: string;
  accentClass: string;
  items: {
    icon: LucideIcon;
    title: string;
    body: string;
  }[];
};

const researchRoadmap: ResearchRoadmapGroup[] = [
  {
    label: '已在使用',
    title: '先把可溯源的文献本做扎实',
    body: '围绕用户已上传的论文、网页和研究笔记组织问答与产物，不把来源和分析判断混在一起。',
    accentClass: 'border-blue-400/30 bg-blue-500/20 text-blue-200',
    items: [
      { icon: Quote, title: '证据溯源问答', body: '回答优先基于已选来源，并保留可复核的引用线索。' },
      { icon: BookOpen, title: '文献本 / 课题本', body: '把文献、笔记和后续产物留在同一个研究上下文。' },
      { icon: Presentation, title: '组会材料', body: '把一组资料整理成可继续编辑和核对来源的汇报材料。' },
    ],
  },
  {
    label: '正在强化',
    title: '把文献整理成可核验的研究材料',
    body: '通过段落证据、跨文献比较和文献矩阵，检查研究主张及其来源。',
    accentClass: 'border-emerald-400/30 bg-emerald-500/20 text-emerald-200',
    items: [
      { icon: ClipboardCheck, title: '段落级引用定位', body: '让摘要、观点和对比结论能回到具体来源片段。' },
      { icon: GitCompare, title: '跨文献对比', body: '抽取多篇文献的共识、分歧和研究演化线索。' },
      { icon: Table2, title: '文献矩阵', body: '按方法、数据、结果和局限组织横向对比表。' },
    ],
  },
  {
    label: '已接入',
    title: '计算结果、交付论文、共享研究资料',
    body: '从原始表格执行统计计算，导出章节草稿，并按成员权限保存和共享研究资料。',
    accentClass: 'border-white/20 bg-white/10 text-white/70',
    items: [
      { icon: BarChart3, title: '数据分析与 Results 草稿', body: '对 CSV/Excel 执行描述统计、Welch 检验或回归，导出图表、结果与复现脚本。' },
      { icon: PenLine, title: '证据驱动写作', body: '起草并编辑章节段落，通过证据编号查看检索片段与原文位置。' },
      { icon: Database, title: '相关期刊检索', body: '从 Crossref 获取主题相关论文的真实刊载期刊、ISSN 与 DOI。' },
      { icon: FileDown, title: 'LaTeX / Word 导出', body: '导出通用学术稿，选择单栏或双栏排版，并查看官方期刊模板入口。' },
      { icon: UsersRound, title: '课题组协作', body: '按成员权限共享研究文档和选定文献，保存时检查版本冲突并记录修改。' },
    ],
  },
];

function ResearchPartnerSection() {
  return (
    <section className="mx-auto max-w-7xl px-5 py-20">
      <MotionReveal>
        <h2 className="text-center text-4xl font-normal tracking-tight text-white md:text-5xl"><UiText>从文献到证据链</UiText></h2>
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
                <Icon className="mb-5 h-9 w-9 text-white" strokeWidth={2.1} />
                <h3 className="text-3xl font-normal tracking-tight text-white">{feature.title}</h3>
                <p className="mt-5 max-w-sm text-lg leading-8 text-white/70">{feature.body}</p>
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

function ResearchRoadmapSection() {
  return (
    <section className="mx-auto max-w-7xl px-5 py-20">
      <MotionReveal>
        <div className="max-w-3xl">
          <p className="text-sm font-semibold text-blue-300"><UiText>科研能力路线图</UiText></p>
          <h2 className="mt-3 text-4xl font-normal tracking-tight text-white md:text-5xl"><UiText>
            围绕真实来源完成研究与交付
          </UiText></h2>
          <p className="mt-5 text-lg leading-8 text-white/70"><UiText>
            灵笔会沿着文献调研、实验设计、数据分析、论文写作和投稿准备逐步打磨。当前先把可信来源、证据溯源和研究产物闭环做稳。
          </UiText></p>
        </div>
      </MotionReveal>

      <div className="mt-10 grid gap-5 lg:grid-cols-3">
        {researchRoadmap.map((group, groupIndex) => (
          <MotionReveal key={group.title} delay={groupIndex * 0.08}>
            <div className="liquid-glass-card h-full rounded-[28px] p-6">
              <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${group.accentClass}`}>
                {group.label}
              </span>
              <h3 className="mt-5 text-2xl font-normal leading-tight tracking-tight text-white">{group.title}</h3>
              <p className="mt-3 text-sm leading-6 text-white/70">{group.body}</p>

              <div className="mt-6 space-y-3">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <div key={item.title} className="liquid-glass-inset rounded-2xl p-4">
                      <div className="flex items-start gap-3">
                        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white/80" style={{ background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.3) 0%, rgba(139, 92, 246, 0.3) 100%)' }}>
                          <Icon className="h-4.5 w-4.5" />
                        </span>
                        <div>
                          <div className="text-sm font-semibold text-white">{item.title}</div>
                          <p className="mt-1 text-xs leading-5 text-white/60">{item.body}</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </MotionReveal>
        ))}
      </div>
    </section>
  );
}

function WorkPrincipleSection() {
  const shouldReduceMotion = useReducedMotion();

  return (
    <section className="mx-auto grid max-w-7xl items-center gap-10 px-5 py-20 lg:grid-cols-[0.72fr_1.28fr]">
      <MotionReveal>
        <h2 className="text-4xl font-normal tracking-tight text-white md:text-5xl"><UiText>科研工作流</UiText></h2>
        <p className="mt-6 max-w-md text-lg leading-8 text-white/70"><UiText>
          把来源放进一个文献本。提问时，回答会围绕这组来源组织，并保留可复核的依据。
        </UiText></p>
      </MotionReveal>

      <MotionReveal delay={0.1}>
        <div className="liquid-glass-card relative min-h-[560px] overflow-hidden rounded-[34px] p-5 sm:p-8">
          <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 via-purple-500/10 to-emerald-500/10" />

          {principleSources.map((source, index) => (
            <motion.div
              key={source.title}
              className={`home-principle-source absolute hidden w-[250px] rounded-[26px] border border-white/20 p-5 shadow-[0_22px_50px_rgba(76,96,140,0.13)] backdrop-blur-xl md:block ${source.className}`}
              animate={shouldReduceMotion ? undefined : { y: [0, -8, 0] }}
              transition={{ duration: 7.5 + index * 0.8, repeat: Infinity, ease: 'easeInOut', delay: index * -1.1 }}
            >
              <div className="flex items-center gap-3">
                <span className={`flex h-11 w-11 items-center justify-center rounded-2xl text-base font-semibold text-white shadow-sm ${source.badgeClass}`}>
                  {source.number}
                </span>
                <div>
                  <div className="text-sm font-semibold text-white">{source.title}</div>
                  <div className="mt-1 text-xs text-white/60">{source.body}</div>
                </div>
              </div>
              <div className="mt-5 space-y-2">
                <span className="block h-2.5 w-full rounded-full bg-white/20" />
                <span className="block h-2.5 w-3/5 rounded-full bg-white/15" />
              </div>
            </motion.div>
          ))}

          <motion.div
            className="absolute left-1/2 top-[52%] w-[min(560px,calc(100%-2.5rem))] -translate-x-1/2 -translate-y-1/2 rounded-[30px] border border-white/20 bg-black/40 p-6 shadow-[0_30px_86px_rgba(37,99,235,0.18)] backdrop-blur-xl sm:p-8"
            animate={shouldReduceMotion ? undefined : { scale: [1, 1.012, 1], boxShadow: ['0 30px 86px rgba(37,99,235,0.15)', '0 34px 98px rgba(37,99,235,0.22)', '0 30px 86px rgba(37,99,235,0.15)'] }}
            transition={{ duration: 8.5, repeat: Infinity, ease: 'easeInOut' }}
          >
            <div className="flex items-center justify-between gap-4">
              <div className="rounded-full border border-blue-400/30 bg-blue-500/20 px-4 py-2 text-sm font-semibold text-blue-200"><UiText>
                证据溯源回答
              </UiText></div>
              <div className="flex items-center gap-2 text-xs font-semibold text-white/50">
                <span className="h-2 w-2 rounded-full bg-emerald-400" /><UiText>
                引用线索已检查
              </UiText></div>
            </div>
            <div className="mt-8 space-y-3">
              <span className="block h-3 w-3/4 rounded-full bg-white/20" />
              <span className="home-evidence-breathe block h-3 w-[88%] rounded-full bg-blue-400/40" />
              <span className="block h-3 w-2/3 rounded-full bg-white/20" />
              <span className="block h-3 w-5/6 rounded-full bg-white/20" />
            </div>
            <div className="mt-8 flex flex-wrap gap-2">
              {['文献 1', '文献 2', '记录 3'].map((item, index) => (
                <span
                  key={item}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold ${index === 1 ? 'home-evidence-chip bg-emerald-500/80 text-white' : 'bg-white/10 text-white/60'}`}
                >
                  {item}
                </span>
              ))}
            </div>
          </motion.div>

          <motion.div
            className="absolute bottom-8 right-8 hidden max-w-xs items-center gap-3 rounded-3xl border border-white/20 bg-black/40 px-4 py-3 shadow-[0_18px_46px_rgba(37,99,235,0.13)] backdrop-blur-xl md:flex"
            animate={shouldReduceMotion ? undefined : { y: [0, -7, 0] }}
            transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut', delay: -2.4 }}
          >
            <BrandMark compact className="h-10 w-10 border-white/20 shadow-none" />
            <div>
              <div className="text-sm font-semibold text-white">KnowTrail</div>
              <div className="text-xs text-white/60"><UiText>问题、回答和引用依据保存在一起。</UiText></div>
            </div>
          </motion.div>
        </div>
      </MotionReveal>
    </section>
  );
}

export function LandingPage({ accountSession, onOpenNotebookHome }: LandingPageProps) {
  const opensNotebookDirectly = Boolean(accountSession);
  const accountUrl = opensNotebookDirectly ? NOTEBOOK_HOME_HREF : `/account?next=${ACCOUNT_NOTEBOOK_NEXT}`;
  const openNotebookHomeFromLink = (event: React.MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    onOpenNotebookHome();
  };
  const accountLinkClick = openNotebookHomeFromLink;

  return (
    <div className="landing-page-root relative isolate min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 text-white">
      <nav className="sticky top-0 z-50 border-b border-white/10 bg-black/20 px-5 py-4 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-3">
            <BrandMark compact />
            <span className="whitespace-nowrap text-2xl font-semibold tracking-tight text-white">KnowTrail</span>
          </Link>
          <ThemeToggle />
        </div>
      </nav>

      <main className="relative" id="overview">
        <section className="px-5 pb-12 pt-8 md:pt-14">
          <div className="research-sky-hero liquid-glass-card mx-auto max-w-[1560px] rounded-[34px] px-5 pb-6 pt-16 md:px-8 md:pt-28">
            <ResearchSky />
            <div className="relative mx-auto max-w-5xl text-center">
              <h1 className="text-5xl font-normal leading-[1.08] tracking-[-0.03em] text-white md:text-7xl"><UiText>
                读懂</UiText><span className="bg-gradient-to-r from-blue-400 via-purple-400 to-emerald-400 bg-clip-text text-transparent"><UiText>每篇文献</UiText></span>
              </h1>
              <p className="mx-auto mt-7 max-w-3xl text-xl leading-8 text-white/70"><UiText>
                以你信任的来源为基础，把论文 PDF、网页、音频和研究笔记放进一个文献本，用提问、引用和组会材料继续研究。
              </UiText></p>
              <div className="mt-8 flex justify-center">
                <Link
                  href={accountUrl}
                  onClick={accountLinkClick}
                  className="liquid-glass-btn-primary inline-flex h-14 items-center justify-center gap-2 rounded-full px-8 text-lg font-semibold"
                  style={{ background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.95) 0%, rgba(139, 92, 246, 0.95) 100%)', border: '1px solid rgba(255,255,255,0.3)' }}
                  data-testid="hero-login-account"
                ><UiText>
                  开启科研模式
                </UiText></Link>
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
        <ResearchRoadmapSection />

        <section className="mx-auto max-w-7xl px-5 pb-24">
          <div className="liquid-glass-card flex flex-col items-center justify-between gap-5 rounded-[28px] p-7 md:flex-row">
            <div className="flex items-center gap-4">
              <span className="flex h-12 w-12 items-center justify-center rounded-full text-blue-300" style={{ background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.2) 0%, rgba(139, 92, 246, 0.2) 100%)' }}>
                <Sparkles className="h-5 w-5" />
              </span>
              <div>
                <h2 className="text-2xl font-normal tracking-tight text-white"><UiText>从一个文献本开始</UiText></h2>
                <p className="mt-1 text-sm text-white/70"><UiText>上传文献、提出研究问题、保存可追溯结果。</UiText></p>
              </div>
            </div>
            <Link
              href={accountUrl}
              onClick={accountLinkClick}
              className="liquid-glass-btn-primary inline-flex h-12 items-center justify-center gap-2 rounded-full px-6 text-sm font-semibold"
              style={{ background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.95) 0%, rgba(139, 92, 246, 0.95) 100%)', border: '1px solid rgba(255,255,255,0.3)' }}
              data-testid="hero-open-notebooks"
            ><UiText>
              进入文献本
              </UiText><BookOpen className="h-4 w-4" />
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
