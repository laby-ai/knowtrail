'use client';

import { useEffect, useState } from 'react';
import JSZip from 'jszip';

type Box = { x: number; y: number; w: number; h: number };
type Item = Box & { text?: string; image?: string; fill?: string; color?: string; size?: number; bold?: boolean; align?: 'left' | 'center' | 'right'; ellipse?: boolean };
type Slide = { items: Item[]; background: string };
const nodes = (el: Document | Element, name: string) => Array.from(el.getElementsByTagNameNS('*', name));
const first = (el: Document | Element, name: string) => nodes(el, name)[0];
function xml(value: string): Document {
  const document = new DOMParser().parseFromString(value, 'application/xml');
  if (document.getElementsByTagName('parsererror').length) throw new Error('PPT 页面数据无法读取');
  return document;
}
function color(el?: Element): string | undefined {
  const value = el && first(el, 'srgbClr')?.getAttribute('val');
  return value && /^[a-f\d]{6}$/i.test(value) ? `#${value}` : undefined;
}

export default function PptxPreview({ fileUrl }: { fileUrl: string }) {
  const [slides, setSlides] = useState<Slide[]>([]);
  const [dimensions, setDimensions] = useState({ width: 12192000, height: 6858000 });
  const [index, setIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setSlides([]); setError(null); setIndex(0);
    void (async () => {
      const response = await fetch(fileUrl, { signal: controller.signal });
      if (!response.ok) throw new Error('无法读取生成文件');
      const zip = await JSZip.loadAsync(await response.arrayBuffer());
      const presentation = zip.file('ppt/presentation.xml');
      if (!presentation) throw new Error('生成文件不是有效 PPTX');
      const size = first(xml(await presentation.async('string')), 'sldSz');
      const width = Number(size?.getAttribute('cx'));
      const height = Number(size?.getAttribute('cy'));
      if (!(width > 0 && height > 0)) throw new Error('PPT 页面尺寸无效');
      const pages = Object.keys(zip.files).filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name))
        .sort((a, b) => Number(a.match(/slide(\d+)/)?.[1]) - Number(b.match(/slide(\d+)/)?.[1]));
      const results: Slide[] = [];
      for (const name of pages) {
        if (!active) return;
        const document = xml(await zip.file(name)!.async('string'));
        const relFile = zip.file(name.replace('/slides/', '/slides/_rels/') + '.rels');
        const relationships = relFile ? nodes(xml(await relFile.async('string')), 'Relationship') : [];
        const tree = first(document, 'spTree');
        const items: Item[] = [];
        for (const shape of Array.from(tree?.children || [])) {
          if (!['sp', 'pic'].includes(shape.localName)) continue;
          const transform = first(shape, 'xfrm');
          if (!transform) continue;
          const offset = first(transform, 'off'); const extent = first(transform, 'ext');
          const item: Item = { x: Number(offset?.getAttribute('x')), y: Number(offset?.getAttribute('y')), w: Number(extent?.getAttribute('cx')), h: Number(extent?.getAttribute('cy')) };
          if (![item.x, item.y, item.w, item.h].every(Number.isFinite) || item.w <= 0 || item.h <= 0) continue;
          if (shape.localName === 'pic') {
            const blip = first(shape, 'blip');
            const id = blip?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'embed');
            const relation = relationships.find(rel => rel.getAttribute('Id') === id && rel.getAttribute('TargetMode') !== 'External');
            const target = relation?.getAttribute('Target');
            if (target) {
              const path = new URL(target, `https://preview.invalid/${name}`).pathname.slice(1);
              const image = zip.file(path);
              const extension = path.split('.').pop()?.toLowerCase();
              const mime = extension === 'png' ? 'image/png' : ['jpg', 'jpeg'].includes(extension || '') ? 'image/jpeg' : undefined;
              if (image && mime) item.image = `data:${mime};base64,${await image.async('base64')}`;
            }
          } else {
            const properties = first(shape, 'spPr');
            item.fill = properties && color(first(properties, 'solidFill'));
            item.ellipse = first(shape, 'prstGeom')?.getAttribute('prst') === 'ellipse';
            const body = first(shape, 'txBody');
            if (body) {
              item.text = nodes(body, 'p').map(p => nodes(p, 't').map(t => t.textContent || '').join('')).join('\n');
              const run = first(body, 'rPr') || first(body, 'defRPr');
              item.size = Number(run?.getAttribute('sz') || 1800) / 100;
              item.color = run && color(first(run, 'solidFill'));
              item.bold = run?.getAttribute('b') === '1';
              const alignment = first(body, 'pPr')?.getAttribute('algn');
              item.align = alignment === 'ctr' ? 'center' : alignment === 'r' ? 'right' : 'left';
            }
          }
          items.push(item);
        }
        results.push({ items, background: color(first(document, 'bg')) || '#ffffff' });
      }
      if (!results.length) throw new Error('生成文件中没有幻灯片');
      if (active) { setDimensions({ width, height }); setSlides(results); }
    })().catch((caught: unknown) => { if (active) setError(caught instanceof Error ? caught.message : '预览加载失败'); });
    return () => { active = false; controller.abort(); };
  }, [fileUrl]);
  if (error) return <p role="alert" className="text-sm text-amber-600">预览暂不可用：{error}。可下载 PPT 查看。</p>;
  if (!slides.length) return <p role="status" className="text-sm text-[var(--text-secondary)]">正在加载 PPT 预览…</p>;
  const slide = slides[index];
  return <section className="w-full space-y-3" aria-label="PPT 逐页预览" data-testid="academic-ppt-preview">
    <div className="flex items-center justify-between gap-3 text-sm">
      <button className="liquid-glass-btn px-3 py-2 disabled:opacity-40" disabled={index === 0} onClick={() => setIndex(index - 1)}>上一页</button>
      <span aria-live="polite">第 {index + 1} / {slides.length} 页</span>
      <button className="liquid-glass-btn px-3 py-2 disabled:opacity-40" disabled={index === slides.length - 1} onClick={() => setIndex(index + 1)}>下一页</button>
    </div>
    <div className="relative w-full overflow-hidden rounded-lg border shadow-sm" style={{ aspectRatio: `${dimensions.width} / ${dimensions.height}`, containerType: 'inline-size', background: slide.background }}>
      {slide.items.map((item, i) => <div key={i} style={{ position: 'absolute', left: `${item.x / dimensions.width * 100}%`, top: `${item.y / dimensions.height * 100}%`, width: `${item.w / dimensions.width * 100}%`, height: `${item.h / dimensions.height * 100}%`, background: item.fill, borderRadius: item.ellipse ? '50%' : undefined, color: item.color || '#111111', fontSize: `${(item.size || 18) * 12700 / dimensions.width * 100}cqw`, fontWeight: item.bold ? 700 : 400, textAlign: item.align, whiteSpace: 'pre-wrap', lineHeight: 1.2, overflow: 'hidden', fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif' }}>
        {item.image ? <img src={item.image} alt={`第 ${index + 1} 页图表`} className="h-full w-full object-contain" /> : item.text}
      </div>)}
    </div>
    <p className="text-xs text-[var(--text-secondary)]">预览读取生成文件的文字、图表和布局；字体与换行可能略有差异，请以下载的 PPT 为准。</p>
  </section>;
}
