export type ScientificIllustrationKind = 'conceptual-framework' | 'workflow' | 'method-diagram' | 'mechanism-schematic';
export type ScientificIllustrationAspectRatio = '1:1' | '4:3' | '16:9';

export interface ScientificIllustrationSource {
  id: string;
  shortName: string;
  title: string;
  abstract: string;
  content: string;
}

export interface ScientificIllustrationRequest {
  purpose: string;
  figureKind: ScientificIllustrationKind;
  aspectRatio: ScientificIllustrationAspectRatio;
  requiredLabels: string[];
  notebookId?: string;
  papers: ScientificIllustrationSource[];
}

export interface GeneratedImageInfo {
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  extension: 'png' | 'jpg' | 'webp';
  width: number | null;
  height: number | null;
  bytes: number;
}

const FIGURE_KINDS = new Set<ScientificIllustrationKind>([
  'conceptual-framework',
  'workflow',
  'method-diagram',
  'mechanism-schematic',
]);
const ASPECT_RATIOS = new Set<ScientificIllustrationAspectRatio>(['1:1', '4:3', '16:9']);

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function cleanSource(value: unknown): ScientificIllustrationSource | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const id = cleanText(raw.id, 160);
  const title = cleanText(raw.title, 600);
  if (!id || !title) return null;
  return {
    id,
    shortName: cleanText(raw.shortName, 160) || title.slice(0, 80),
    title,
    abstract: cleanText(raw.abstract, 2_000),
    content: cleanText(raw.content ?? raw.rawContent, 4_000),
  };
}

export function parseScientificIllustrationRequest(value: unknown): ScientificIllustrationRequest {
  if (!value || typeof value !== 'object') throw new Error('科研示意图请求格式不正确。');
  const raw = value as Record<string, unknown>;
  const purpose = cleanText(raw.purpose, 1_200);
  if (purpose.length < 8) throw new Error('请说明至少 8 个字的图像目的。');

  const figureKind = cleanText(raw.figureKind, 40) as ScientificIllustrationKind;
  if (!FIGURE_KINDS.has(figureKind)) throw new Error('该图像类型不支持；当前只生成科研示意图。');

  const aspectRatio = cleanText(raw.aspectRatio, 10) as ScientificIllustrationAspectRatio;
  if (!ASPECT_RATIOS.has(aspectRatio)) throw new Error('画幅只支持 1:1、4:3 或 16:9。');

  const requiredLabels = Array.isArray(raw.requiredLabels)
    ? raw.requiredLabels.map(label => cleanText(label, 40)).filter(Boolean)
    : [];
  if (requiredLabels.length > 6) throw new Error('必须标签最多 6 个，避免图中文字拥挤。');

  const papers = Array.isArray(raw.papers)
    ? raw.papers.map(cleanSource).filter((paper): paper is ScientificIllustrationSource => Boolean(paper)).slice(0, 12)
    : [];
  if (papers.length === 0) throw new Error('请先选择至少一个真实来源。');

  const notebookId = cleanText(raw.notebookId, 160) || undefined;
  return { purpose, figureKind, aspectRatio, requiredLabels, notebookId, papers };
}

const KIND_LABELS: Record<ScientificIllustrationKind, string> = {
  'conceptual-framework': '概念框架图',
  workflow: '研究流程图',
  'method-diagram': '方法示意图',
  'mechanism-schematic': '机制示意图',
};

export function buildScientificIllustrationPrompt(input: ScientificIllustrationRequest): string {
  const sources = input.papers.map((paper, index) => [
    `[来源${index + 1}] ${paper.shortName} - ${paper.title}`,
    paper.abstract,
    paper.content,
  ].filter(Boolean).join('\n')).join('\n\n');
  const requiredLabels = input.requiredLabels.length > 0
    ? input.requiredLabels.map(label => `“${label}”`).join('、')
    : '无强制图内文字；优先使用简短、可读的中文标签';

  return [
    `请生成一张${KIND_LABELS[input.figureKind]}，用途：${input.purpose}。`,
    `画幅：${input.aspectRatio}。必须标签：${requiredLabels}。`,
    '这是科研示意图，不是数据图表。只表达来源支持的概念、步骤、方法或机制关系。',
    '不得绘制统计图、坐标轴、显著性星号、测量数值或貌似真实的数据点。',
    '不得虚构显著性、因果结论、实验结果、样本量或来源中没有的实体关系。',
    '采用白底、清晰层级、克制学术配色、足够留白；不要水印、广告感、伪论文截图、随机英文或密集小字。',
    '不要在图内添加标题；长解释留给图注。若来源不足以支持某个细节，省略该细节。',
    '',
    '仅可依据以下用户已选来源：',
    sources,
  ].join('\n');
}

function pngInfo(buffer: Buffer): GeneratedImageInfo | null {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(signature)) return null;
  return {
    mimeType: 'image/png',
    extension: 'png',
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    bytes: buffer.length,
  };
}

function jpegInfo(buffer: Buffer): GeneratedImageInfo | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 8 < buffer.length) {
    if (buffer[offset] !== 0xff) { offset += 1; continue; }
    const marker = buffer[offset + 1];
    if (marker === 0xd9 || marker === 0xda) break;
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > buffer.length) break;
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
      return {
        mimeType: 'image/jpeg',
        extension: 'jpg',
        width: buffer.readUInt16BE(offset + 7),
        height: buffer.readUInt16BE(offset + 5),
        bytes: buffer.length,
      };
    }
    offset += 2 + length;
  }
  return { mimeType: 'image/jpeg', extension: 'jpg', width: null, height: null, bytes: buffer.length };
}

function webpInfo(buffer: Buffer): GeneratedImageInfo | null {
  if (buffer.length < 30 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') return null;
  const chunk = buffer.toString('ascii', 12, 16);
  let width: number | null = null;
  let height: number | null = null;
  if (chunk === 'VP8X') {
    width = 1 + buffer.readUIntLE(24, 3);
    height = 1 + buffer.readUIntLE(27, 3);
  } else if (chunk === 'VP8L' && buffer[20] === 0x2f) {
    const bits = buffer.readUInt32LE(21);
    width = 1 + (bits & 0x3fff);
    height = 1 + ((bits >>> 14) & 0x3fff);
  } else if (chunk === 'VP8 ' && buffer[23] === 0x9d && buffer[24] === 0x01 && buffer[25] === 0x2a) {
    width = buffer.readUInt16LE(26) & 0x3fff;
    height = buffer.readUInt16LE(28) & 0x3fff;
  }
  return { mimeType: 'image/webp', extension: 'webp', width, height, bytes: buffer.length };
}

export function inspectGeneratedImage(buffer: Buffer): GeneratedImageInfo {
  if (buffer.length < 32 || buffer.length > 25 * 1024 * 1024) {
    throw new Error('图片格式或文件大小不符合要求。');
  }
  const info = pngInfo(buffer) || jpegInfo(buffer) || webpInfo(buffer);
  if (!info) throw new Error('图片格式无效；只接受 PNG、JPEG 或 WebP。');
  if ((info.width !== null && info.width < 1) || (info.height !== null && info.height < 1)) {
    throw new Error('图片尺寸无效。');
  }
  return info;
}
