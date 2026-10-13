'use client';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { MCP_PARAMETER_LABELS, type ResearchMcpTool } from '@/lib/mcp/research-contracts';
const ENUM_LABELS: Record<string, string> = { oa: '开放论文', 'arxiv-title': 'arXiv 题名', 'arxiv-abstract': 'arXiv 摘要', 'arxiv-id': 'arXiv 编号', 'arxiv-multi': 'arXiv 多字段', include: '纳入', exclude: '排除', maybe: '待定', unscreened: '未筛选', all: '全部' };
export function defaultMcpFields(tool: ResearchMcpTool): Record<string, string> {
  return Object.fromEntries(Object.entries(tool.inputSchema.properties).map(([key, field]) => [key, field.default !== undefined ? String(field.default) : field.enum ? String(field.enum[0]) : '']));
}
export function mcpArguments(tool: ResearchMcpTool, fields: Record<string, string>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(tool.inputSchema.properties)) {
    const value = fields[key]; if (value === undefined || value === '') continue;
    result[key] = field.type === 'number' || field.type === 'integer' ? Number(value) : field.type === 'boolean' ? value === 'true' : value;
  }
  return result;
}
export function ResearchMcpFields({ tool, fields, onChange }: { tool: ResearchMcpTool; fields: Record<string, string>; onChange: (key: string, value: string) => void }) {
  return <div className="grid gap-4 sm:grid-cols-2">{Object.entries(tool.inputSchema.properties).filter(([key]) => key !== 'workspace_file').map(([key, field]) => {
    const required = tool.inputSchema.required?.includes(key); const label = MCP_PARAMETER_LABELS[key] || field.description || key;
    const long = ['claim', 'reason', 'decisions', 'include_keywords', 'exclude_keywords', 'query'].includes(key);
    return <label key={key} className={`block min-w-0 space-y-2 text-sm ${long ? 'sm:col-span-2' : ''}`}><span className="font-medium">{label}{required ? ' *' : ''}</span>
      {field.enum ? <select required={required} value={fields[key] || ''} onChange={event => onChange(key, event.target.value)} className="liquid-glass-input block min-h-11 w-full rounded-lg px-3">{field.enum.map(value => <option key={String(value)} value={String(value)}>{ENUM_LABELS[String(value)] || String(value)}</option>)}</select>
        : field.type === 'boolean' ? <select value={fields[key] || 'false'} onChange={event => onChange(key, event.target.value)} className="liquid-glass-input block min-h-11 w-full rounded-lg px-3"><option value="false">否</option><option value="true">是</option></select>
        : long ? <Textarea required={required} maxLength={30_000} value={fields[key] || ''} onChange={event => onChange(key, event.target.value)} className="liquid-glass-input min-h-24 leading-6" />
        : <Input required={required} value={fields[key] || ''} onChange={event => onChange(key, event.target.value)} type={field.type === 'number' || field.type === 'integer' ? 'number' : 'text'} step={field.type === 'integer' ? '1' : 'any'} className="liquid-glass-input min-h-11" />}
    </label>;
  })}</div>;
}
