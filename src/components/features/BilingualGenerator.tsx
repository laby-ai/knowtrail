'use client';

import { useState, useCallback } from 'react';
import {
  Subtitles, Volume2, Loader2, Sparkles,
  Send, Copy, CheckCircle2,
} from 'lucide-react';
import { useApp } from '@/contexts/AppContext';
import { clientApiRequest } from '@/lib/client-api';

interface BilingualPair {
  id: string;
  subtitle: string;
  audio: string;
  citation?: string;
}

export function BilingualGenerator() {
  const { getSelectedPapers } = useApp();
  const [inputText, setInputText] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [bilingualPairs, setBilingualPairs] = useState<BilingualPair[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'subtitle' | 'audio'>('subtitle');
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = useCallback(async () => {
    if (!inputText.trim()) return;
    const selectedPapers = getSelectedPapers();
    setIsGenerating(true);
    setError(null);

    try {
      const response = await clientApiRequest('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `请将以下学术文本同时生成两个版本：
1. 【字幕文本（书面版）】：严谨书面语，完整保留专业术语、希腊字母、公式编号、引用标注，与原文完全对应
2. 【音频文本（口语版）】：适配语音播报场景，将希腊字母转为口语读法（如α→"阿尔法"，HR→"风险比"），优化语句流畅度，增加口语化过渡词

要求：两个版本必须严格基于原文内容，不得添加原文没有的信息。每个版本单独用【字幕文本（书面版）】和【音频文本（口语版）】标记。

原文如下：
${inputText}`,
          paperIds: selectedPapers.map(p => p.id),
          papers: selectedPapers.map((p, i) => ({
            id: p.id,
            index: i + 1,
            shortName: p.shortName,
            title: p.title,
            abstract: p.abstract,
            content: (p.content || '').substring(0, 2000),
          })),
        }),
      });

      if (!response.ok) {
        throw new Error('生成失败');
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('无法读取响应');

      let fullText = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = new TextDecoder().decode(value);
        for (const line of chunk.split('\n')) {
          if (line.startsWith('0:')) {
            try {
              const content = JSON.parse(line.slice(2));
              if (typeof content === 'string') fullText += content;
            } catch { /* skip */ }
          }
        }
      }

      // Parse the two versions
      const subtitleMatch = fullText.match(/【字幕文本[（(]书面版[）)】】[：:\s]*([\s\S]*?)(?=【音频文本|$)/);
      const audioMatch = fullText.match(/【音频文本[（(]口语版[）)】】[：:\s]*([\s\S]*?)$/);

      const pairs: BilingualPair[] = [{
        id: `bp-${Date.now()}`,
        subtitle: subtitleMatch?.[1]?.trim() || fullText,
        audio: audioMatch?.[1]?.trim() || fullText,
        citation: selectedPapers.length > 0 ? selectedPapers.map(p => p.shortName).join(', ') : undefined,
      }];
      setBilingualPairs(prev => [...pairs, ...prev]);
      setInputText('');
    } catch (err) {
      setError(err instanceof Error ? err.message : '生成失败');
    } finally {
      setIsGenerating(false);
    }
  }, [inputText, getSelectedPapers]);

  const handleCopy = useCallback((text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }, []);

  const handleSendToAudio = useCallback(() => {
    // Send to Studio audio panel
  }, []);

  return (
    <div className="h-full flex flex-col bg-[var(--bg-primary)]">
      {/* Header */}
      <div className="px-5 pt-5 pb-4 border-b border-[var(--border-subtle)]">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-purple-500/10 flex items-center justify-center">
            <Subtitles className="h-4 w-4 text-purple-400" />
          </div>
          <div>
            <h2 className="text-base font-semibold tracking-tight text-[var(--text-primary)]">双语字幕生成</h2>
            <p className="text-[11px] text-[var(--text-muted)]">书面版 + 口语版双轨输出</p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
        {/* Input */}
        <div className="space-y-2">
          <p className="section-label">输入文本</p>
          <textarea
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="粘贴或输入需要转换的学术文本，系统将同时生成书面版字幕和口语版音频文本..."
            className="apple-textarea"
            rows={4}
          />
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-red-500/[0.08] border border-red-500/20 text-xs text-red-400">
            {error}
          </div>
        )}

        <button onClick={handleGenerate} disabled={isGenerating} className="btn-primary w-full py-3 text-xs">
          {isGenerating ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> AI 生成中...</> : <><Sparkles className="h-3.5 w-3.5" /> 生成双版本</>}
        </button>

        {/* Results */}
        {bilingualPairs.length > 0 && (
          <div className="space-y-4">
            {/* Tab switcher */}
            <div className="flex bg-[var(--bg-tertiary)] p-1 rounded-xl border border-[var(--border-subtle)]">
              <button
                onClick={() => setActiveTab('subtitle')}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[11px] font-medium transition-all ${
                  activeTab === 'subtitle' ? 'bg-[var(--glass-active)] text-[var(--text-primary)]' : 'text-[var(--text-tertiary)]'
                }`}
              >
                <Subtitles className="h-3 w-3" /> 字幕文本（书面版）
              </button>
              <button
                onClick={() => setActiveTab('audio')}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[11px] font-medium transition-all ${
                  activeTab === 'audio' ? 'bg-[var(--glass-active)] text-[var(--text-primary)]' : 'text-[var(--text-tertiary)]'
                }`}
              >
                <Volume2 className="h-3 w-3" /> 音频文本（口语版）
              </button>
            </div>

            {/* Pairs */}
            {bilingualPairs.map((pair, idx) => (
              <div key={pair.id} className="liquid-glass-card p-4 animate-fade-in-up" style={{ animationDelay: `${idx * 80}ms` }}>
                <div className="flex items-center justify-between mb-2">
                  <span className={`text-[10px] px-2 py-0.5 rounded-md font-semibold border ${
                    activeTab === 'subtitle'
                      ? 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                      : 'bg-purple-500/10 text-purple-400 border-purple-500/20'
                  }`}>
                    {activeTab === 'subtitle' ? '字幕文本（书面版）' : '音频文本（口语版）'}
                  </span>
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => handleCopy(activeTab === 'subtitle' ? pair.subtitle : pair.audio, pair.id + activeTab)}
                      className="btn-ghost text-[10px] text-[var(--text-muted)] hover:text-[var(--text-primary)] px-2 py-1"
                    >
                      {copiedId === pair.id + activeTab ? <CheckCircle2 className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                    </button>
                  </div>
                </div>
                <p className="text-[13px] leading-relaxed text-zinc-300 whitespace-pre-wrap">
                  {activeTab === 'subtitle' ? pair.subtitle : pair.audio}
                </p>
                {pair.citation && (
                  <p className="text-[10px] text-[var(--text-muted)] mt-2 font-mono">来源: [{pair.citation}]</p>
                )}
              </div>
            ))}

            {/* Send to Studio */}
            <button onClick={handleSendToAudio} className="btn-secondary w-full py-2.5 text-xs">
              <Send className="h-3 w-3" /> 发送到音频概览
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
