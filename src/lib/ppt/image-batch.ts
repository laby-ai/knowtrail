export type ImageBatchResult = { imageBase64: string | null; error?: string };

// Image providers commonly enforce account-level request rates. Submit pages
// sequentially and retry only explicit rate limits, never authentication errors.
export async function generateImageBatch(
  prompts: string[],
  generate: (prompt: string) => Promise<string | null>,
  onProgress?: (completed: number, total: number) => void,
  wait: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms)),
): Promise<ImageBatchResult[]> {
  const results: ImageBatchResult[] = [];
  for (const prompt of prompts) {
    if (results.length) await wait(2_000);
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const imageBase64 = await generate(prompt);
        results.push({ imageBase64, ...(imageBase64 ? {} : { error: '图片模型未返回图片。' }) });
        break;
      } catch (caught) {
        const error = caught instanceof Error ? caught.message : String(caught);
        if (/(?:HTTP\s*429|Throttling\.RateQuota|TooManyRequests)/i.test(error) && attempt < 3) {
          await wait(15_000 * 2 ** attempt);
          continue;
        }
        results.push({ imageBase64: null, error });
        break;
      }
    }
    onProgress?.(results.length, prompts.length);
  }
  return results;
}
