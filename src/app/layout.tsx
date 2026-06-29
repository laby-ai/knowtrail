import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'KnowTrail',
    template: '%s | KnowTrail',
  },
  description:
    '把文档、网页和笔记放进一个工作本，围绕资料提问、核对来源，并整理成可以带走的内容。',
  keywords: [
    '资料工作台',
    '资料问答',
    'PPT生成',
    '语音合成',
    '资料理解',
    '知识管理',
    '知识卡片',
  ],
  authors: [{ name: 'KnowTrail' }],
  generator: 'KnowTrail',
  icons: {
    icon: [
      { url: '/assets/brand/favicon.png', sizes: '32x32', type: 'image/png' },
      { url: '/assets/brand/lingbi-icon-64.png', sizes: '64x64', type: 'image/png' },
    ],
    apple: [
      { url: '/assets/brand/apple-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  },
  openGraph: {
    title: 'KnowTrail',
    description:
      '围绕个人资料提问、查看来源，并整理成摘要、卡片和讲稿。',
    url: process.env.NEXT_PUBLIC_DOMAIN || 'https://knowtrail.example.com',
    siteName: 'KnowTrail',
    locale: 'zh_CN',
    type: 'website',
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" data-theme="light" suppressHydrationWarning>
      <body className="antialiased bg-[var(--bg-primary)] text-[var(--text-primary)]">
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var t=localStorage.getItem('theme');document.documentElement.setAttribute('data-theme',t==='dark'?'dark':'light')}catch(e){document.documentElement.setAttribute('data-theme','light')}})()` }} />
        {children}
      </body>
    </html>
  );
}
