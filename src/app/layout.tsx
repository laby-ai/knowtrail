import type { Metadata } from 'next';
import { publicAssetPath } from '@/lib/public-path';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'KnowTrail',
    template: '%s | KnowTrail',
  },
  description:
    '把论文、网页和研究笔记放进一个文献本，围绕证据来源提问、核对引用线索，并整理成可复用的科研笔记。',
  keywords: [
    '文献问答',
    '证据溯源',
    '科研笔记',
    '文献速览',
    'PPT生成',
    '语音合成',
    '知识管理',
  ],
  authors: [{ name: 'KnowTrail' }],
  generator: 'KnowTrail',
  icons: {
    icon: [{ url: publicAssetPath('/assets/brand/lingbi-mark.svg'), type: 'image/svg+xml' }],
  },
  openGraph: {
    title: 'KnowTrail',
    description:
      '围绕文献和研究笔记提问、查看证据来源，并整理成摘要、卡片和组会材料。',
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
