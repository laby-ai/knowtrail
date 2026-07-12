#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const strict = process.env.ARCH_GUARD_STRICT === 'true';

const watchedFiles = [
  { file: 'src/app/api/ai/ppt-v2/route.ts', maxLines: 2600, target: 'split ppt-v2 into ppt-v2 pipeline, mineru adapter, and pptx renderer' },
  { file: 'src/app/api/ai/ppt/route.ts', maxLines: 1100, target: 'split image PPT provider, outline builder, and SSE route shell' },
  { file: 'src/components/studio/StudioPanel.tsx', maxLines: 180, target: 'keep StudioPanel as a thin tool shell; move product logic into dedicated panels' },
  { file: 'src/components/studio/PresentationPanels.tsx', maxLines: 830, target: 'keep this as the image PPT panel and mode shell; move structured generation elsewhere' },
  { file: 'src/components/studio/StructuredPresentationPanel.tsx', maxLines: 520, target: 'keep structured PPT isolated; next add editable outline without bloating PresentationPanels' },
  { file: 'src/components/studio/StructuredPresentationOutlineDraft.tsx', maxLines: 220, target: 'keep editable outline UX focused; move shared outline contracts to lib if it grows' },
  { file: 'src/components/studio/PresentationModeSelector.tsx', maxLines: 140, target: 'keep PPT mode selection presentational; do not add generation side effects here' },
  { file: 'src/lib/ai-service.ts', maxLines: 1150, target: 'split providers into text, embedding, image, podcast, and tts modules' },
  { file: 'src/lib/grounded-task-lifecycle.ts', maxLines: 140, target: 'keep SSE, cancellation, and reservation finalization independent from product contracts' },
  { file: 'src/app/api/ai/deep-research/route.ts', maxLines: 290, target: 'keep route focused on evidence, report repair, and citation audit' },
  { file: 'src/app/api/ai/hypothesis-generation/route.ts', maxLines: 240, target: 'keep route focused on hypothesis parsing and evidence validation' },
  { file: 'src/app/api/ai/experiment-design/route.ts', maxLines: 280, target: 'keep route focused on protocol and preregistration validation' },
  { file: 'src/app/api/ai/academic-writing/route.ts', maxLines: 225, target: 'keep route focused on draft and claim-evidence validation' },
  { file: 'src/app/api/ai/peer-review/route.ts', maxLines: 235, target: 'keep route focused on manuscript locations and review safety audit' },
  { file: 'src/app/globals.css', maxLines: 2500, target: 'split theme tokens and workbench/studio styles' },
];

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (['node_modules', '.next', '.git', '.references', '.deploy', '.data'].includes(name)) continue;
      walk(full, acc);
    } else {
      acc.push(full);
    }
  }
  return acc;
}

function lineCount(file) {
  return readFileSync(path.join(root, file), 'utf8').split(/\r?\n/).length;
}

const findings = [];

for (const entry of watchedFiles) {
  const full = path.join(root, entry.file);
  try {
    const lines = lineCount(entry.file);
    if (lines > entry.maxLines) {
      findings.push({
        severity: 'warn',
        kind: 'large-file-growth',
        file: entry.file,
        lines,
        maxLines: entry.maxLines,
        target: entry.target,
      });
    }
  } catch {
    findings.push({
      severity: 'warn',
      kind: 'watched-file-missing',
      file: entry.file,
      target: 'remove from architecture guard if intentionally deleted',
    });
  }
}

for (const full of walk(path.join(root, 'src'))) {
  if (/\.(bak|old|orig|tmp)$/i.test(full)) {
    findings.push({
      severity: 'warn',
      kind: 'backup-file-in-src',
      file: path.relative(root, full).replaceAll(path.sep, '/'),
      target: 'move historical backup outside src or delete after confirming it is not needed',
    });
  }
}

const legacyProviderPattern = new RegExp([
  '\\bCO' + 'ZE_',
  'co' + 'ze-coding-dev-sdk',
  'co' + 'ze-plugin-runner',
  'CO' + 'ZE_API_BASE_URL',
  'CO' + 'ZE_WORKLOAD_API_TOKEN',
].join('|'), 'g');

const legacyProviderHits = walk(path.join(root, 'src'))
  .filter((full) => /\.(ts|tsx|js|mjs)$/i.test(full))
  .flatMap((full) => {
    const rel = path.relative(root, full).replaceAll(path.sep, '/');
    const text = readFileSync(full, 'utf8');
    return [...text.matchAll(legacyProviderPattern)]
      .map((match) => ({ file: rel, token: match[0] }));
  });

const legacyProviderFiles = [...new Set(legacyProviderHits.map((hit) => hit.file))];
for (const file of legacyProviderFiles) {
  findings.push({
    severity: 'info',
    kind: 'legacy-provider-reference',
    file,
    target: 'remove historical provider aliases from product paths',
  });
}

const result = {
  ok: strict ? findings.every((finding) => finding.severity !== 'warn') : true,
  strict,
  checkedAt: new Date().toISOString(),
  watchedFiles: watchedFiles.length,
  findings,
};

console.log(JSON.stringify(result, null, 2));

if (!result.ok) {
  process.exitCode = 1;
}
