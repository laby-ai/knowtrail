import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SourceTextReader, sourceTextPages } from '../src/components/library/SourceTextReader';

const original = '  Original spacing\r\n' + '1234567890 '.repeat(1600) + '\nFinal sentence.  ';
const pages = sourceTextPages(original);
assert(pages.length > 2);
assert.equal(pages.join(''), original, 'Every saved character remains reachable without overlap or truncation');
assert(pages.every(page => page.length <= 6000));
assert.equal(pages.at(-1)?.endsWith('Final sentence.  '), true);
assert.deepEqual(sourceTextPages(''), []);
const unicode = 'x'.repeat(5999) + '😀' + 'y'.repeat(6000);
const unicodePages = sourceTextPages(unicode);
assert.equal(unicodePages.join(''), unicode);
assert(!unicodePages.some(page => /[\ud800-\udbff]$/.test(page) || /^[\udc00-\udfff]/.test(page)), 'A text page never cuts a surrogate pair');

const markup = renderToStaticMarkup(React.createElement(SourceTextReader, { rawContent: original, chunks: [{ text: 'Generated summary must not replace original text.' }] }));
assert(markup.includes('提取正文') && markup.includes('文本 1 / 3'));
assert(markup.includes('data-testid="source-text-body"'));
assert(markup.includes('Original spacing'));
assert(!markup.includes('Generated summary must not replace original text.'));
assert(markup.includes('data-testid="source-text-previous" disabled=""'));

const hostile = renderToStaticMarkup(React.createElement(SourceTextReader, { rawContent: '<img src="bad" onerror="alert(1)"><script>never execute</script>' }));
assert(hostile.includes('&lt;img') && hostile.includes('&lt;script&gt;'));
assert(!hostile.includes('<img') && !hostile.includes('<script>'));
const fallback = renderToStaticMarkup(React.createElement(SourceTextReader, { chunks: Array.from({ length: 14 }, (_, index) => ({ text: `Stored source chunk ${index + 1}` })) }));
assert(fallback.includes('已保存片段'));
assert(fallback.includes('Stored source chunk 14'), 'Missing raw text still exposes every stored chunk, including beyond the previous 12-chunk cap');
assert(!fallback.includes('>提取正文<'));
assert.equal(renderToStaticMarkup(React.createElement(SourceTextReader, {})), '');
console.log(JSON.stringify({ ok: true, actualReaderView: true, savedTextPreserved: true, allTextPagesAccessible: true, originalPreferredOverSummary: true, escapedSourceMarkup: true, explicitMissingOriginalFallback: true, modelOrPdfExtractionQualityAccepted: false }));
