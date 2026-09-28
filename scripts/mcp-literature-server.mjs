#!/usr/bin/env node

import { searchLiterature, SOURCE_DISPLAY_NAMES } from './lib/literature-providers.mjs';

const SOURCES = [
  { id: 'crossref', title: 'Crossref 文献检索' },
  { id: 'europepmc', title: 'Europe PMC 文献检索' },
  { id: 'semantic-scholar', title: 'Semantic Scholar 文献检索' },
  { id: 'openalex', title: 'OpenAlex 文献检索' },
  { id: 'arxiv', title: 'arXiv 文献检索' },
  { id: 'pubmed', title: 'PubMed 文献检索' },
  { id: 'scite', title: 'Scite 文献检索' },
];

const tools = SOURCES.map(s => ({
  name: `search_${s.id.replace(/-/g, '_')}`,
  description: `${s.title}。参数: query (搜索关键词), limit (最大结果数, 默认10)`,
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '搜索关键词' },
      limit: { type: 'integer', description: '最大结果数', default: 10 },
    },
    required: ['query'],
  },
}));

async function handleToolCall(name, args) {
  const sourceId = SOURCES.find(s => `search_${s.id.replace(/-/g, '_')}` === name)?.id;
  if (!sourceId) {
    throw new Error(`Unknown tool: ${name}`);
  }

  const { query, limit = 10 } = args;
  const results = await searchLiterature(sourceId, query, limit);

  return {
    content: [{ type: 'text', text: JSON.stringify(results, null, 2) }],
  };
}

// Simple stdio MCP server
const readline = await import('readline');
const rl = readline.createInterface({ input: process.stdin });

for await (const line of rl) {
  try {
    const msg = JSON.parse(line);

    if (msg.method === 'initialize') {
      process.stdout.write(JSON.stringify({
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'literature-mcp', version: '1.0.0' },
        },
      }) + '\n');
    } else if (msg.method === 'tools/list') {
      process.stdout.write(JSON.stringify({
        jsonrpc: '2.0',
        id: msg.id,
        result: { tools },
      }) + '\n');
    } else if (msg.method === 'tools/call') {
      try {
        const result = await handleToolCall(msg.params.name, msg.params.arguments || {});
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: msg.id,
          result,
        }) + '\n');
      } catch (toolErr) {
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: msg.id,
          error: {
            code: -32000,
            message: toolErr.message || 'Tool call failed',
          },
        }) + '\n');
      }
    }
  } catch (err) {
    console.error('[MCP Server] Error:', err.message);
  }
}
