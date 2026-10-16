import type { PPTSlide } from '@/types';

export async function exportImageDeck(slides: PPTSlide[]) {
  const PptxGenJS = (await import('pptxgenjs')).default;
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_16x9';
  for (const slide of slides) {
    const pptSlide = pptx.addSlide();
    if (slide.imageUrl) pptSlide.addImage({ path: slide.imageUrl, x: 0, y: 0, w: '100%', h: '100%' });
    else {
      pptSlide.background = { color: '1a1a2e' };
      pptSlide.addText(slide.title, { x: 0.8, y: 0.6, w: '80%', h: 1.2, fontSize: 28, color: 'FFFFFF', bold: true });
      pptSlide.addText(slide.content, { x: 0.8, y: 2.0, w: '80%', h: 3.5, fontSize: 14, color: 'CCCCCC', lineSpacing: 22 });
    }
  }
  await pptx.writeFile({ fileName: `${slides[0]?.title || 'presentation'}.pptx` });
}
