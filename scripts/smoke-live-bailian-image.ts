import { generateSlideImage, resolveImageModelName } from '../src/lib/ppt/image-generation';

async function main() {
  if (!process.env.DASHSCOPE_API_KEY?.trim()) {
    throw new Error('DASHSCOPE_API_KEY is required for the live Bailian image smoke.');
  }
  const started = Date.now();
  const result = await generateSlideImage(
    '浅色科研信息图：论文、证据、问答三者形成清晰闭环，蓝绿色线条，简洁，无品牌标志',
    {
      aspectRatio: '16:9',
      negativePrompt: '二维码，水印，杂乱文字，低清晰度',
    },
  );
  if (!result) throw new Error('Bailian image provider returned no result.');

  const bytes = Buffer.from(result, 'base64');
  const isPng = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (!isPng) throw new Error('Bailian image provider result is not a PNG image.');

  console.log(JSON.stringify({
    ok: true,
    model: resolveImageModelName(),
    mime: 'image/png',
    bytes: bytes.length,
    elapsedMs: Date.now() - started,
  }, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
