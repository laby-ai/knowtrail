'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useApp } from '@/contexts/AppContext';
import { accountAuthHeaders } from '@/lib/account-session-browser';
import { clientApiDownloadBlob, clientApiPath, clientApiRequest } from '@/lib/client-api';
import { notebookIdFromStorageScopeKey } from '@/lib/notebook-scope';
import { describeStudioOutput, studioOutputUrl, type StudioSavedOutput } from '@/lib/studio-saved-outputs';
import { isResearchReportDocument, researchReportLengthWarning } from '@/lib/research-report-document';
import { isKnowledgeMapDocument } from '@/lib/knowledge-map-document';
import { isDataProcessingDocument } from '@/lib/data-processing-document';
import { isIllustrationDocument } from '@/lib/scientific-illustration-document';
import { isLearningMaterials, learningCardExtra } from '@/lib/learning-materials';
import { isHtmlDeckDocument, isImageDeckDocument } from '@/lib/ppt/deck-document';
import { useStructuredPresentationFile } from '@/hooks/use-structured-presentation-file';
import { KnowledgeMapGraph } from './KnowledgeMapGraph';
import { StudioEvidenceStatusPanel } from './StudioEvidenceStatusPanel';
import { ScaledSlideFrame } from './HtmlPresentationPanel';

function SavedImage({ url, alt, bytes }: { url: string; alt: string; bytes?: number }) {
  const [image, setImage] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); let objectUrl = '';
    setImage(null); setError('');
    void (async () => {
      try {
        // Saved assets are served by the existing authenticated local routes only.
        if (!/^\/(?:knowtrail\/)?api\/(?:studio\/artifacts\?|ai\/scientific-illustration\/)/.test(url)) throw new Error('图片地址不完整，请在工具中重新读取。');
        const blob = await clientApiDownloadBlob(url, { headers: accountAuthHeaders(), signal: controller.signal, redirectOnUnauthorized: false, cache: 'no-store' });
        controller.signal.throwIfAborted();
        if (!/^image\/(png|jpeg|webp)$/.test(blob.type) || bytes !== undefined && blob.size !== bytes) throw new Error('图片类型或大小不符，请重新读取。');
        objectUrl = URL.createObjectURL(blob); setImage(objectUrl);
      } catch (caught) { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : '图片读取失败。'); }
    })();
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [attempt, bytes, url]);
  return <>{image && <Image src={image} alt={alt} width={1280} height={720} unoptimized className="h-auto w-full object-contain" />}{!image && !error && <p role="status">正在读取图片…</p>}{error && <div role="alert"><p>{error}</p><button type="button" className="agent-plugin-open" onClick={() => setAttempt(value => value + 1)}>重新读取图片</button></div>}</>;
}

function SavedPpt({ output }: { output: StudioSavedOutput }) {
  const { storageScopeKey } = useApp();
  const [error, setError] = useState<string | null>(null);
  const file = useStructuredPresentationFile(storageScopeKey, notebookIdFromStorageScopeKey(storageScopeKey), setError, output.revision);
  return <div className="space-y-4" data-testid="studio-saved-ppt-viewer">
    {file.isRestoring && <p role="status">正在读取PPT…</p>}
    {(error || file.restoreError) && <div role="alert"><p>{error || file.restoreError}</p><button type="button" className="agent-plugin-open" onClick={file.retryRestore}>重新读取PPT</button></div>}
    {file.presentation && <><p>{file.presentation.fileName}</p><p>{file.presentation.slideCount} 页 · 可编辑 PPT</p><button type="button" className="agent-plugin-open" onClick={() => void file.handleDownload()} disabled={file.isDownloading}>{file.isDownloading ? '正在下载…' : '下载PPT'}</button></>}
  </div>;
}

export function StudioOutputViewer({ output }: { output: StudioSavedOutput }) {
  const { storageScopeKey } = useApp();
  const [loaded, setLoaded] = useState<{ key: string; data: unknown } | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const notebookId = notebookIdFromStorageScopeKey(storageScopeKey) || '';
  const key = `${storageScopeKey}:${output.kind}:${output.revision}`;
  const data = loaded?.key === key ? loaded.data : null;
  useEffect(() => {
    const controller = new AbortController(); setLoaded(null); setError('');
    if (output.kind === 'structured-ppt') return () => controller.abort();
    void (async () => {
      try {
        const response = await clientApiRequest(studioOutputUrl(output.kind, notebookId, output.revision), { headers: accountAuthHeaders(), signal: controller.signal, redirectOnUnauthorized: false, cache: 'no-store' });
        const payload = await response.json() as { document?: { data?: unknown }; error?: string };
        if (!response.ok) throw new Error(payload.error || '内容暂时无法读取，请重试。');
        const saved = describeStudioOutput(output.kind, payload);
        if (!saved || saved.revision !== output.revision) throw new Error('保存版本不一致，请重新读取。');
        if (!controller.signal.aborted) setLoaded({ key, data: payload.document!.data });
      } catch (caught) { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : '读取失败，请重试。'); }
    })();
    return () => controller.abort();
  }, [attempt, key, notebookId, output.kind, output.revision]);

  if (output.kind === 'structured-ppt') return <SavedPpt output={output} />;
  if (error) return <div role="alert"><p>{error}</p><button type="button" className="agent-plugin-open" onClick={() => setAttempt(value => value + 1)}>重新读取</button></div>;
  if (!data) return <p role="status">正在读取内容…</p>;
  if (output.kind === 'research-report' && isResearchReportDocument(data) && data.report) {
    const report = data.report;
    const warning = report.researchStatus?.outputConstraint?.warning || researchReportLengthWarning(report) || (report.status !== 'complete' ? '这是未完成草稿，请核对缺失章节和引用。' : '');
    return <div className="studio-output-prose space-y-5" data-testid="studio-saved-report-viewer">
      {warning && <p role="status" className="text-amber-700">{warning}</p>}
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{report.answer}</ReactMarkdown>
      <StudioEvidenceStatusPanel citations={report.citations} retrieval={report.retrieval} compact />
    </div>;
  }
  if (output.kind === 'knowledge-map' && isKnowledgeMapDocument(data) && data.session) {
    const session = data.session;
    const node = session.map.nodes.find(item => item.id === selectedNode) || session.map.nodes[0];
    return <div className="space-y-4"><div className="h-[440px] max-h-[55dvh]"><KnowledgeMapGraph map={session.map} selectedNodeId={node?.id || null} onSelectNode={setSelectedNode} /></div>{node && <p><strong>{node.label}：</strong>{node.summary}</p>}<StudioEvidenceStatusPanel citations={session.citations} retrieval={session.retrieval} compact /></div>;
  }
  if (output.kind === 'data-processing' && isDataProcessingDocument(data) && data.plan) return <div className="studio-output-prose space-y-4"><p>已完成数据诊断与方案，未执行统计检验或模型训练。</p><a className="agent-plugin-open" href={clientApiPath(studioOutputUrl(output.kind, notebookId, output.revision) + '&download=1')} download={data.plan.artifactFileName}>下载数据方案</a><ReactMarkdown remarkPlugins={[remarkGfm]}>{data.plan.artifactMarkdown}</ReactMarkdown></div>;
  if (output.kind === 'scientific-illustration' && isIllustrationDocument(data) && data.result) return <div className="space-y-4"><p>{data.result.boundary}</p><SavedImage url={data.result.imageUrl} alt={data.result.purpose} bytes={data.result.bytes} /><a className="agent-plugin-open" href={clientApiPath(data.result.downloadUrl)} download>下载图片</a></div>;
  if (output.kind === 'learning-materials' && isLearningMaterials(data)) return <div className="space-y-5"><p>已保存 {data.cards.length} 张学习卡。继续答题可打开测验工具。</p>{data.cards.map((card, index) => <article key={index} className="studio-output-learning-card"><h3>{card.title}</h3><p>{card.content}</p>{card.extra && <p>{learningCardExtra(card.extra)}</p>}</article>)}<StudioEvidenceStatusPanel citations={data.citations} retrieval={data.retrieval} compact /></div>;
  if (output.kind === 'image-deck' && isImageDeckDocument(data) && data.deck) return <div className="space-y-6"><p>{data.deck.slides.length} 页 · 图片 PPT，页内文字不可单独编辑。导出可在PPT工具中继续。</p>{data.deck.slides.map((slide, index) => <article key={slide.id}><h3 className="mb-2 font-semibold">{index + 1}. {slide.title}</h3><SavedImage url={slide.imageUrl!} alt={slide.title} /></article>)}<StudioEvidenceStatusPanel citations={data.deck.citations} retrieval={data.deck.retrieval} compact /></div>;
  if (output.kind === 'html-deck' && isHtmlDeckDocument(data) && data.deck) return <div className="space-y-6"><a className="agent-plugin-open" href={clientApiPath(studioOutputUrl(output.kind, notebookId, output.revision) + '&download=1')} download>下载HTML</a>{data.deck.qaNotice && <p role="status">{data.deck.qaNotice}</p>}{data.deck.slides.map((slide, index) => <article key={index}><h3 className="mb-2 font-semibold">{index + 1}. {slide.title}</h3><ScaledSlideFrame html={slide.html} title={`已保存幻灯片 ${index + 1}`} className="rounded-lg border" /></article>)}<StudioEvidenceStatusPanel citations={data.deck.citations} retrieval={data.deck.retrieval} compact /></div>;
  return <p role="alert">保存内容不完整，请在相应工具中重新读取。</p>;
}
