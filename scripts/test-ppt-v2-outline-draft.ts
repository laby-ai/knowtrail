import assert from 'node:assert/strict';
import {
  buildPptOutlineDraft,
  formatPptOutlineDraftForPrompt,
  inferPptOutlineDraftSlideType,
  sanitizePptOutlineDraft,
} from '../src/lib/ppt/outline-draft';
import { FEATURED_NOTEBOOKS } from '../src/components/home/featured-notebooks';

const built = buildPptOutlineDraft([
  {
    id: 'source-1',
    title: '资料一',
    shortName: '资料一',
    authors: [],
    year: 2026,
    keywords: [],
    abstract: '这是一段用于生成结构化简报大纲的资料摘要，应该被压缩进页面重点。',
    content: '',
    fileName: 'source.txt',
    fileType: 'txt',
    fileSize: 128,
    uploadTime: '2026-06-18T00:00:00.000Z',
  },
], 12);

assert.equal(built[0].title, '封面与汇报目标');
assert.equal(built.at(-1)?.title, '综合判断与行动建议');
assert.ok(built.some(item => item.sourceLabel === '资料一'), 'draft should include selected source label');

const placeholderDraft = buildPptOutlineDraft([
  {
    id: 'unparsed-source',
    title: '2026：谱写高等教育数字化“十五五”新篇章-中国教育和科研计算机网CERNET',
    shortName: '未解析作者. 2026',
    authors: [],
    year: 2026,
    keywords: [],
    abstract: '标题：2026：谱写高等教育数字化“十五五”新篇章-中国教育和科研计算机网CERNET 摘要：该文件包含了关于2026：谱写高等教育数字化“十五五”新篇章-中国教育和科研计算机网CERNET的',
    content: '',
    fileName: 'cernet.txt',
    fileType: 'txt',
    fileSize: 256,
    uploadTime: '2026-09-01T00:00:00.000Z',
  },
], 12);
const placeholderSlide = placeholderDraft[1];

assert.doesNotMatch(placeholderSlide.title, /未解析作者/, 'generic parser labels must not become slide titles');
assert.doesNotMatch(placeholderSlide.sourceLabel, /未解析作者/, 'generic parser labels must not become source labels');
assert.doesNotMatch(placeholderSlide.focus, /该文件包含了/, 'placeholder extraction prose must not become slide focus');
assert.doesNotMatch(placeholderSlide.focus, /的$/, 'slide focus must not end on a dangling function word');

const learningNotebook = FEATURED_NOTEBOOKS.find(item => item.id === 'featured-ai-learning');
assert.ok(learningNotebook, 'AI learning featured notebook should exist');
const learningDraft = buildPptOutlineDraft(learningNotebook.papers, 12);
assert.doesNotMatch(
  learningDraft.map(item => `${item.title} ${item.focus}`).join('\n'),
  /灵笔/,
  'featured notebook PPT output must use the current research workbench name',
);

const sanitized = sanitizePptOutlineDraft([
  {
    id: '  first  ',
    title: '  资料背景  ',
    focus: '  使用   用户确认的重点  ',
    sourceLabel: '  来源 A  ',
  },
  null,
  {
    title: '',
    focus: '',
  },
  {
    title: 'x'.repeat(200),
    focus: 'y'.repeat(400),
    sourceLabel: 'z'.repeat(200),
  },
]);

assert.equal(sanitized.length, 2);
assert.deepEqual(sanitized[0], {
  id: 'first',
  title: '资料背景',
  focus: '使用 用户确认的重点',
  sourceLabel: '来源 A',
});
assert.equal(sanitized[1].title.length, 80, 'title should be length-limited');
assert.equal(sanitized[1].focus.length, 220, 'focus should be length-limited');
assert.equal(sanitized[1].sourceLabel.length, 80, 'source label should be length-limited');

const prompt = formatPptOutlineDraftForPrompt(sanitized);
assert.match(prompt, /1\. 资料背景 \| 来源: 来源 A/);
assert.match(prompt, /重点: 使用 用户确认的重点/);
assert.match(prompt, /2\. /);
assert.equal(inferPptOutlineDraftSlideType(sanitized[0], 1, 3), 'background');
assert.equal(inferPptOutlineDraftSlideType(sanitized[0], 0, 3), 'background', 'page position must not discard confirmed content');
assert.equal(inferPptOutlineDraftSlideType(built[0], 0, built.length), 'cover', 'the existing explicit cover remains supported');
assert.notEqual(inferPptOutlineDraftSlideType({ ...sanitized[0], focus: '直接讲研究方法，不要封面。' }, 0, 2), 'cover', 'mentioning a cover in focus must not create one');

console.log(JSON.stringify({
  ok: true,
  checked: 'ppt-v2 outline draft contract sanitizes user-edited page plans and formats a stable backend prompt section',
  sanitizedCount: sanitized.length,
}, null, 2));
