export interface DiscoveredSourceFileInput {
  title: string;
  link: string;
  snippet: string;
  date?: string;
  authors?: string[];
  content?: string;
  provider?: 'metaso' | 'arxiv' | 'giiisp-paper' | 'dashscope-web';
  verificationStatus?: 'candidate' | 'open-source-candidate';
}

interface FetchedSource {
  title?: string;
  text: string;
}

export async function createDiscoveredSourceFile(
  item: DiscoveredSourceFileInput,
  fetchSource: (url: string) => Promise<FetchedSource>,
): Promise<File> {
  let sourceText = item.content?.trim() || '';
  let sourceTitle = item.title;
  if (sourceText.length < 80) {
    const fetched = await fetchSource(item.link);
    sourceText = fetched.text;
    sourceTitle = fetched.title || item.title;
  }

  const safeTitle = (sourceTitle || '网络文献线索').replace(/[\\/:*?"<>|]/g, '-').slice(0, 80);
  const sourceLabel = item.provider === 'arxiv'
    ? 'arXiv 开放元数据候选'
    : item.provider === 'giiisp-paper'
      ? '集思谱论文检索候选'
      : item.provider === 'dashscope-web'
        ? '科教平台联网检索候选'
        : '网络文献线索';
  const header = `来源类型:${sourceLabel}\n来源链接:${item.link}\n${item.date ? `发布时间:${item.date}\n` : ''}${item.authors?.length ? `作者:${item.authors.join('、')}\n` : ''}\n`;
  return new File([header + sourceText], `${safeTitle}.txt`, { type: 'text/plain' });
}
