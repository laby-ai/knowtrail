'use client';

import { useState, useEffect } from 'react';

interface ExternalMcp {
  id: string;
  name: string;
  description: string;
  source: string;
  transport: string;
  tools: Array<{ name: string; description: string }>;
  providerMapping: string[];
  verified: boolean;
  verifiedAt?: string;
  notes?: string;
}

export function ExternalMcpPanel() {
  const [mcps, setMcps] = useState<ExternalMcp[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/mcp/external')
      .then(res => res.json())
      .then(data => {
        setMcps(data.mcps || []);
        setLoading(false);
      })
      .catch(err => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return <div className="p-4 text-center text-gray-500">加载中...</div>;
  }

  if (error) {
    return <div className="p-4 text-center text-red-500">加载失败: {error}</div>;
  }

  return (
    <div className="p-4">
      <h2 className="text-xl font-semibold mb-4">已验证的外部 MCP 服务器</h2>
      <p className="text-sm text-gray-600 mb-4">
        以下 {mcps.length} 个 MCP 服务器已通过测试，可作为文献检索的替代数据源。
      </p>

      <div className="space-y-4">
        {mcps.map(mcp => (
          <div key={mcp.id} className="border rounded-lg p-4 bg-white">
            <div className="flex items-start justify-between mb-2">
              <div>
                <h3 className="font-semibold text-lg">{mcp.name}</h3>
                <p className="text-sm text-gray-500">{mcp.id}</p>
              </div>
              <div className="flex gap-2">
                {mcp.verified && (
                  <span className="px-2 py-1 text-xs bg-green-100 text-green-700 rounded">
                    已验证 {mcp.verifiedAt}
                  </span>
                )}
                <span className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded">
                  {mcp.transport}
                </span>
              </div>
            </div>

            <p className="text-sm text-gray-700 mb-3">{mcp.description}</p>

            <div className="mb-3">
              <span className="text-xs font-medium text-gray-500">数据源: </span>
              {mcp.providerMapping.map(p => (
                <span key={p} className="inline-block px-2 py-0.5 text-xs bg-gray-100 text-gray-700 rounded mr-1">
                  {p}
                </span>
              ))}
            </div>

            <div className="mb-3">
              <span className="text-xs font-medium text-gray-500">工具: </span>
              <div className="mt-1 space-y-1">
                {mcp.tools.map(tool => (
                  <div key={tool.name} className="text-xs">
                    <code className="bg-gray-100 px-1.5 py-0.5 rounded">{tool.name}</code>
                    <span className="text-gray-600 ml-2">{tool.description}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="text-xs text-gray-500">
              <a href={mcp.source} target="_blank" rel="noopener noreferrer" className="hover:text-blue-600">
                {mcp.source}
              </a>
              {mcp.notes && <span className="ml-2">· {mcp.notes}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
