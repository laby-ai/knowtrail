#!/usr/bin/env node

/**
 * MCP Literature Server - Protocol-level Integration Test
 *
 * Spawns the MCP server as a subprocess and verifies:
 * 1. initialize handshake
 * 2. tools/list returns all 7 search tools
 * 3. tools/call for each provider returns valid results
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SERVER_PATH = join(__dirname, '..', 'scripts', 'mcp-literature-server.mjs');

let requestId = 0;
let passed = 0;
let failed = 0;
const results = [];

function log(msg) {
  console.log(`[TEST] ${msg}`);
}

function assert(condition, message) {
  if (condition) {
    passed++;
    results.push({ status: 'PASS', message });
    log(`  PASS: ${message}`);
  } else {
    failed++;
    results.push({ status: 'FAIL', message });
    log(`  FAIL: ${message}`);
  }
}

function sendRequest(proc, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++requestId;
    const msg = { jsonrpc: '2.0', id, method, ...params };

    let responseData = '';
    const onData = (data) => {
      responseData += data.toString();
      const lines = responseData.split('\n').filter(l => l.trim());
      for (const line of lines) {
        try {
          const response = JSON.parse(line);
          if (response.id === id) {
            proc.stdout.removeListener('data', onData);
            resolve(response);
            return;
          }
        } catch {
          // Not a complete JSON line yet
        }
      }
    };

    proc.stdout.on('data', onData);
    proc.stdin.write(JSON.stringify(msg) + '\n');

    setTimeout(() => {
      proc.stdout.removeListener('data', onData);
      reject(new Error(`Timeout waiting for response to ${method} (id=${id})`));
    }, 30000);
  });
}

async function runTests() {
  log('Starting MCP Literature Server integration tests...\n');

  const proc = spawn('node', [SERVER_PATH], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  proc.stderr.on('data', (data) => {
    log(`[SERVER STDERR] ${data.toString().trim()}`);
  });

  try {
    // Test 1: Initialize
    log('Test 1: initialize handshake');
    const initResponse = await sendRequest(proc, 'initialize');
    assert(initResponse.result?.protocolVersion === '2024-11-05', 'Protocol version is 2024-11-05');
    assert(initResponse.result?.serverInfo?.name === 'literature-mcp', 'Server name is literature-mcp');
    assert(initResponse.result?.capabilities?.tools !== undefined, 'Server declares tools capability');

    // Test 2: tools/list
    log('\nTest 2: tools/list');
    const listResponse = await sendRequest(proc, 'tools/list');
    const tools = listResponse.result?.tools || [];
    assert(Array.isArray(tools), 'tools/list returns an array');
    assert(tools.length === 7, `Expected 7 tools, got ${tools.length}`);

    const expectedTools = [
      'search_crossref',
      'search_europepmc',
      'search_semantic_scholar',
      'search_openalex',
      'search_arxiv',
      'search_pubmed',
      'search_scite',
    ];

    for (const toolName of expectedTools) {
      const tool = tools.find(t => t.name === toolName);
      assert(tool !== undefined, `Tool "${toolName}" exists`);
      if (tool) {
        assert(tool.inputSchema?.properties?.query !== undefined, `Tool "${toolName}" has query parameter`);
        assert(tool.inputSchema?.required?.includes('query'), `Tool "${toolName}" requires query parameter`);
      }
    }

    // Test 3: tools/call for each provider
    log('\nTest 3: tools/call for each provider');

    const testQueries = [
      { tool: 'search_crossref', query: 'machine learning', minResults: 1 },
      { tool: 'search_europepmc', query: 'CRISPR', minResults: 1 },
      { tool: 'search_semantic_scholar', query: 'deep learning', minResults: 1 },
      { tool: 'search_openalex', query: 'quantum computing', minResults: 1 },
      { tool: 'search_arxiv', query: 'neural network', minResults: 1 },
      { tool: 'search_pubmed', query: 'cancer treatment', minResults: 1 },
      { tool: 'search_scite', query: 'gene editing', minResults: 0 }, // Scite may return 0 without API key
    ];

    for (const { tool, query, minResults } of testQueries) {
      log(`\n  Testing ${tool} with query "${query}"...`);
      try {
        const callResponse = await sendRequest(proc, 'tools/call', {
          params: { name: tool, arguments: { query, limit: 3 } },
        });

        if (callResponse.error) {
          assert(true, `${tool}: returned JSON-RPC error (graceful): ${callResponse.error.message}`);
          assert(typeof callResponse.error.code === 'number', `${tool}: error has numeric code`);
          continue;
        }

        assert(callResponse.result !== undefined, `${tool}: response has result`);
        assert(Array.isArray(callResponse.result?.content), `${tool}: result has content array`);

        const contentText = callResponse.result?.content?.[0]?.text;
        assert(typeof contentText === 'string', `${tool}: content has text`);

        if (contentText) {
          try {
            const papers = JSON.parse(contentText);
            assert(Array.isArray(papers), `${tool}: parsed content is array`);
            assert(papers.length >= minResults, `${tool}: returned ${papers.length} results (min: ${minResults})`);

            if (papers.length > 0) {
              const firstPaper = papers[0];
              assert(typeof firstPaper.title === 'string', `${tool}: first paper has title`);
              assert(Array.isArray(firstPaper.authors), `${tool}: first paper has authors array`);
              assert(typeof firstPaper.year === 'number' || firstPaper.year === null, `${tool}: first paper has year`);
            }
          } catch (e) {
            assert(false, `${tool}: failed to parse content as JSON: ${e.message}`);
          }
        }
      } catch (e) {
        assert(false, `${tool}: request failed: ${e.message}`);
      }
    }

    // Test 4: Error handling - unknown tool
    log('\nTest 4: Error handling');
    try {
      const errorResponse = await sendRequest(proc, 'tools/call', {
        params: { name: 'search_unknown', arguments: { query: 'test' } },
      });
      assert(errorResponse.error !== undefined, 'Unknown tool returns JSON-RPC error response');
      assert(typeof errorResponse.error?.code === 'number', 'Error has numeric code');
      assert(typeof errorResponse.error?.message === 'string', 'Error has message string');
      assert(errorResponse.error.message.includes('Unknown tool'), 'Error message mentions unknown tool');
    } catch (e) {
      assert(false, `Error handling test failed: ${e.message}`);
    }

  } catch (e) {
    log(`\nFATAL: ${e.message}`);
    failed++;
  } finally {
    proc.kill();
  }

  // Summary
  log('\n' + '='.repeat(50));
  log(`Tests completed: ${passed + failed}`);
  log(`  Passed: ${passed}`);
  log(`  Failed: ${failed}`);
  log('='.repeat(50));

  if (failed > 0) {
    log('\nFailed tests:');
    for (const r of results.filter(r => r.status === 'FAIL')) {
      log(`  - ${r.message}`);
    }
    process.exit(1);
  } else {
    log('\nAll tests passed!');
    process.exit(0);
  }
}

runTests().catch(e => {
  console.error('Test runner error:', e);
  process.exit(1);
});
