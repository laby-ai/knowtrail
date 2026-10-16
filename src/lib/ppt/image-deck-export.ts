import type { PPTSlide } from '@/types';

export async function exportImageDeck(slides: PPTSlide[], aspectRatio = '16:9', onFile?: (blob: Blob) => Promise<void>) {
  const PptxGenJS = (await import('pptxgenjs')).default;
  const pptx = new PptxGenJS();
  pptx.layout = aspectRatio === '4:3' ? 'LAYOUT_4X3' : 'LAYOUT_16x9';
  for (const slide of slides) {
    const pptSlide = pptx.addSlide();
    if (slide.imageUrl) {
      const response = await fetch(slide.imageUrl, { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) throw new Error('图片暂时无法读取，请重新登录或重试。');
      const data = await new Promise<string>((resolve, reject) => {
        void response.blob().then(blob => {
          const reader = new FileReader(); reader.onerror = reject; reader.onload = () => resolve(String(reader.result)); reader.readAsDataURL(blob);
        }, reject);
      });
      pptSlide.addImage({ data, x: 0, y: 0, w: '100%', h: '100%' });
    }
    else {
      pptSlide.background = { color: '1a1a2e' };
      pptSlide.addText(slide.title, { x: 0.8, y: 0.6, w: '80%', h: 1.2, fontSize: 28, color: 'FFFFFF', bold: true });
      pptSlide.addText(slide.content, { x: 0.8, y: 2.0, w: '80%', h: 3.5, fontSize: 14, color: 'CCCCCC', lineSpacing: 22 });
    }
    if (slide.narration) pptSlide.addNotes(slide.narration);
  }
  if (onFile) {
    const blob = await pptx.write({ outputType: 'blob' });
    if (!(blob instanceof Blob)) throw new Error('PPT文件导出异常，请重试。');
    await onFile(blob);
  } else await pptx.writeFile({ fileName: `${slides[0]?.title || 'presentation'}.pptx` });
}
