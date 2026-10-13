import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { executeResearchTool, researchCatalog, researchScope, uploadCitationFile, ResearchMcpError } from '../src/lib/mcp/research-client';

async function main() {
  const scope = researchScope('isolated-qa-tenant', 'isolated-qa-member', `test-${randomUUID()}`);
  assert.notEqual(scope, researchScope('other-tenant', 'isolated-qa-member', 'test'));
  assert.notEqual(researchScope('tenant', 'member', 'book-a'), researchScope('tenant', 'member', 'book-b'));
  assert.notEqual(researchScope('tenant', 'member-a', 'book'), researchScope('tenant', 'member-b', 'book'));
  const catalog = await researchCatalog();
  assert.equal(catalog.length, 5);
  for (const connection of catalog) {
    assert.equal(connection.available, true, connection.id);
    assert(connection.tools.length > 0);
    assert(!connection.tools.some(tool => ['run_skill_script', 'read_workspace_file', 'upload_workspace_file'].includes(tool.name)));
  }
  const calculated = await executeResearchTool('labmate', 'calculate_molarity', { moles: 0.01, volume_ml: 100 }, scope);
  assert.match(JSON.stringify(calculated), /molarity M: 0\.1/);
  await assert.rejects(() => executeResearchTool('labmate', 'run_skill_script', {}, scope), error => error instanceof ResearchMcpError && error.status === 400);
  await assert.rejects(() => executeResearchTool('labmate', 'calculate_molarity', { arbitrary_parameter: 'bad' }, scope), error => error instanceof ResearchMcpError && error.status === 400);
  await assert.rejects(() => executeResearchTool('pubcrawl', 'search_europepmc', { query: 'test', max_results: 100 }, scope), error => error instanceof ResearchMcpError && error.status === 400);
  const uploaded = await uploadCitationFile(scope, new File(['Isolated upload transport verification.'], 'verification.txt'));
  assert.match(uploaded.path, /^inputs\/[a-f0-9-]+\.txt$/);
  await assert.rejects(() => uploadCitationFile(scope, new File(['x'], 'unauthorized.exe')), error => error instanceof ResearchMcpError && error.status === 400);
  const mode = process.env.LINGBI_COMMERCE_MODE;
  process.env.LINGBI_COMMERCE_MODE = 'enforced';
  try { await assert.rejects(() => executeResearchTool('giiisp', 'search_papers', { mode: 'arxiv-id', query: '1706.03762' }, scope), error => error instanceof ResearchMcpError && error.status === 503); }
  finally { process.env.LINGBI_COMMERCE_MODE = mode; }
  console.log('PASS: five live MCP catalogs, exact calculator result, isolated scopes, dangerous-tool/argument limits, bounded upload and unpriced-service gate.');
}
void main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : 'MCP verification failed'); process.exitCode = 1; });
