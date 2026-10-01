import { spawn, type ChildProcess } from 'child_process';
import type { ExternalMcpConfig } from './external-mcp-registry';

export interface McpJsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

export interface McpJsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export interface McpToolResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

export class ExternalMcpClient {
  private process: ChildProcess | null = null;
  private requestId = 0;
  private pendingRequests = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }>();
  private buffer = '';
  private initialized = false;

  constructor(private config: ExternalMcpConfig) {}

  async connect(): Promise<void> {
    if (this.config.transport !== 'stdio') {
      throw new Error(`Transport ${this.config.transport} not yet supported for external MCP`);
    }

    if (!this.config.command) {
      throw new Error('Command is required for stdio transport');
    }

    return new Promise((resolve, reject) => {
      this.process = spawn(this.config.command!, this.config.args || [], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, ...this.config.env },
      });

      this.process.stdout?.on('data', (data: Buffer) => {
        this.handleData(data.toString());
      });

      this.process.stderr?.on('data', (data: Buffer) => {
        console.error(`[ExternalMcp:${this.config.id}]`, data.toString());
      });

      this.process.on('error', (err) => {
        reject(new Error(`Failed to start MCP server: ${err.message}`));
      });

      this.process.on('exit', (code) => {
        if (code !== 0 && code !== null) {
          console.error(`[ExternalMcp:${this.config.id}] Process exited with code ${code}`);
        }
        this.cleanup();
      });

      this.initialize().then(() => {
        this.initialized = true;
        resolve();
      }).catch(reject);
    });
  }

  private handleData(data: string): void {
    this.buffer += data;
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const response = JSON.parse(line) as McpJsonRpcResponse;
        const pending = this.pendingRequests.get(response.id);
        if (pending) {
          this.pendingRequests.delete(response.id);
          if (response.error) {
            pending.reject(new Error(response.error.message));
          } else {
            pending.resolve(response.result);
          }
        }
      } catch (err) {
        console.error(`[ExternalMcp:${this.config.id}] Failed to parse response:`, line);
      }
    }
  }

  private async initialize(): Promise<void> {
    const result = await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'knowtrail-external-mcp-client', version: '1.0.0' },
    });

    const serverInfo = (result as { serverInfo?: { name: string; version: string } }).serverInfo;
    if (serverInfo) {
      console.log(`[ExternalMcp:${this.config.id}] Connected to ${serverInfo.name} v${serverInfo.version}`);
    }
  }

  private request(method: string, params?: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.process?.stdin) {
        reject(new Error('MCP server not connected'));
        return;
      }

      const id = ++this.requestId;
      const request: McpJsonRpcRequest = {
        jsonrpc: '2.0',
        id,
        method,
        params,
      };

      this.pendingRequests.set(id, { resolve, reject });
      this.process.stdin.write(JSON.stringify(request) + '\n');
    });
  }

  async listTools(): Promise<unknown> {
    return this.request('tools/list');
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
    const result = await this.request('tools/call', { name, arguments: args });
    return result as McpToolResult;
  }

  async disconnect(): Promise<void> {
    if (this.process) {
      this.process.stdin?.end();
      this.process.kill();
      this.cleanup();
    }
  }

  private cleanup(): void {
    this.process = null;
    this.initialized = false;
    for (const [, pending] of this.pendingRequests) {
      pending.reject(new Error('MCP server disconnected'));
    }
    this.pendingRequests.clear();
  }

  isInitialized(): boolean {
    return this.initialized;
  }
}

const clientCache = new Map<string, ExternalMcpClient>();

export async function getExternalMcpClient(config: ExternalMcpConfig): Promise<ExternalMcpClient> {
  let client = clientCache.get(config.id);
  if (client && client.isInitialized()) {
    return client;
  }

  client = new ExternalMcpClient(config);
  await client.connect();
  clientCache.set(config.id, client);
  return client;
}

export async function callExternalMcpTool(
  config: ExternalMcpConfig,
  toolName: string,
  args: Record<string, unknown>
): Promise<McpToolResult> {
  const client = await getExternalMcpClient(config);
  return client.callTool(toolName, args);
}

export async function disconnectAllExternalMcps(): Promise<void> {
  for (const [id, client] of clientCache) {
    try {
      await client.disconnect();
    } catch (err) {
      console.error(`[ExternalMcp:${id}] Disconnect error:`, err);
    }
  }
  clientCache.clear();
}
