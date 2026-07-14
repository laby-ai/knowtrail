import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

process.env.NEXT_PUBLIC_BASE_PATH = '/research/';

async function main() {
  const { publicAssetPath } = await import('../src/lib/public-path');
  assert.equal(publicAssetPath('/assets/brand/lingbi-mark.svg'), '/research/assets/brand/lingbi-mark.svg');
  assert.equal(publicAssetPath('assets/home/lingbi-hero-loop.mp4'), '/research/assets/home/lingbi-hero-loop.mp4');

  const [brandMark, heroMedia, provider, layout] = await Promise.all([
    readFile('src/components/brand/BrandMark.tsx', 'utf8'),
    readFile('src/components/home/HomeHeroMedia.tsx', 'utf8'),
    readFile('src/components/ui/liquid-glass-provider.tsx', 'utf8'),
    readFile('src/app/layout.tsx', 'utf8'),
  ]);

  assert.match(brandMark, /publicAssetPath\('/);
  assert.match(heroMedia, /publicAssetPath\('/);
  assert.match(layout, /publicAssetPath\('/);
  assert.doesNotMatch(`${brandMark}\n${heroMedia}`, /(?:src|poster)=["']\/?assets\//);
  assert.doesNotMatch(provider, /ambient-blob/);

  console.log(JSON.stringify({
    ok: true,
    checked: [
      'public assets honor the hosted base path',
      'brand, hero media, and metadata use one public path helper',
      'ambient blobs no longer create mobile overflow',
    ],
  }, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
