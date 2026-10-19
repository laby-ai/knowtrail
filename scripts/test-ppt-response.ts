import assert from 'node:assert/strict';
import { readApiJson, verifyPptxResponse } from '../src/lib/api-response';

async function main() {
  for (const status of [413, 502, 504]) {
    await assert.rejects(readApiJson(new Response('<html><h1>Gateway failure</h1></html>', { status }), 'PPT 生成'), new RegExp(`HTTP ${status}`));
  }
  await assert.rejects(readApiJson(new Response('{"error":"模型不可用"}', { status: 503 }), 'PPT 生成'), /模型不可用/);
  assert.equal((await readApiJson(new Response('{"requiresConfirmation":false}'), '费用预检查')).requiresConfirmation, false);
  await assert.rejects(verifyPptxResponse(new Response('<html>login</html>', { headers: { 'Content-Type': 'text/html' } })), /未返回演示文稿/);
  await assert.rejects(verifyPptxResponse(new Response('not a file', { headers: { 'Content-Type': 'application/octet-stream' } })), /文件不完整/);
  const file = await verifyPptxResponse(new Response(new Uint8Array([0x50, 0x4b, 3, 4]), { headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation' } }));
  assert.equal(file.size, 4);
  console.log('PASS: HTML gateway errors, JSON errors, observe quote, login HTML and invalid file rejected, ZIP signature accepted');
}
void main();
