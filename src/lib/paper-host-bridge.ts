'use client';

type HostBridgeRequest = {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
};

type HostBridgeResponse = {
  status: number;
  contentType: string;
  text: string;
  json?: unknown;
};

type PendingRequest = {
  resolve: (response: HostBridgeResponse) => void;
  reject: (error: Error) => void;
  timeoutId: number;
};

export type PaperHostContext = {
  enabled: boolean;
  workspaceKey: string;
  accountScope: string;
  embedAuthMode: string;
  hostBridgeVersion: string;
};

const REQUEST_TYPE = 'paper-web:api-request';
const RESPONSE_TYPE = 'paper-web:api-response';
const ERROR_TYPE = 'paper-web:api-error';
const DEFAULT_TIMEOUT_MS = 15000;

declare global {
  interface Window {
    paperHostBridge?: {
      context: PaperHostContext;
      request: (request: HostBridgeRequest, timeoutMs?: number) => Promise<HostBridgeResponse>;
    };
  }
}

function readSearchParams() {
  if (typeof window === 'undefined') return new URLSearchParams();
  return new URLSearchParams(window.location.search);
}

export function readPaperHostContext(): PaperHostContext {
  const params = readSearchParams();
  const enabled = params.get('host') === 'paper-web' && params.get('hostBridge') === 'postMessage';
  return {
    enabled,
    workspaceKey: params.get('workspaceKey') || '',
    accountScope: params.get('accountScope') || '',
    embedAuthMode: params.get('embedAuthMode') || params.get('authMode') || '',
    hostBridgeVersion: params.get('hostBridgeVersion') || '',
  };
}

export function paperHostScopePrefix(context = readPaperHostContext()) {
  if (!context.enabled || !context.workspaceKey) return '';
  return `paper-host:${context.workspaceKey}`;
}

export function installPaperHostBridge() {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const context = readPaperHostContext();
  const pending = new Map<string, PendingRequest>();

  const onMessage = (event: MessageEvent) => {
    if (event.source !== window.parent) return;
    const data = event.data || {};
    if (data.type !== RESPONSE_TYPE && data.type !== ERROR_TYPE) return;

    const id = String(data.id || '');
    const task = pending.get(id);
    if (!task) return;

    pending.delete(id);
    window.clearTimeout(task.timeoutId);

    if (data.type === ERROR_TYPE) {
      task.reject(new Error(String(data.message || '宿主接口调用失败')));
      return;
    }
    task.resolve(data.response as HostBridgeResponse);
  };

  const request = (bridgeRequest: HostBridgeRequest, timeoutMs = DEFAULT_TIMEOUT_MS) => {
    if (!context.enabled || window.parent === window) {
      return Promise.reject(new Error('当前不是 paper-web 嵌入环境'));
    }

    const id = `kh-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const promise = new Promise<HostBridgeResponse>((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        pending.delete(id);
        reject(new Error('宿主接口调用超时'));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timeoutId });
    });

    window.parent.postMessage({
      type: REQUEST_TYPE,
      id,
      request: bridgeRequest,
    }, '*');

    return promise;
  };

  window.addEventListener('message', onMessage);
  window.paperHostBridge = { context, request };

  return () => {
    pending.forEach(task => {
      window.clearTimeout(task.timeoutId);
      task.reject(new Error('宿主桥接已卸载'));
    });
    pending.clear();
    window.removeEventListener('message', onMessage);
    if (window.paperHostBridge?.context === context) {
      delete window.paperHostBridge;
    }
  };
}
