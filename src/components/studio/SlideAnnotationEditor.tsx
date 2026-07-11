'use client';

import { clientApiRequest } from '@/lib/client-api';

// Cowart-style slide revision: draw annotations (strokes / arrows / text)
// on top of the current slide image, add an instruction, and let the image
// model regenerate a clean revised slide honoring the markup.

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Eraser, Loader2, Pencil, Send, Type, Undo2, X } from 'lucide-react';
import { accountAuthHeaders } from '@/lib/account-session-browser';
import type { RuntimeAIConfig } from '@/types';

type Tool = 'pen' | 'arrow' | 'text';

interface StrokeShape { kind: 'stroke'; points: Array<{ x: number; y: number }> }
interface ArrowShape { kind: 'arrow'; from: { x: number; y: number }; to: { x: number; y: number } }
interface TextShape { kind: 'text'; at: { x: number; y: number }; text: string }
type Shape = StrokeShape | ArrowShape | TextShape;

const ANNOTATION_COLOR = '#FF2D2D';

export function SlideAnnotationEditor({
  imageUrl,
  slideTitle,
  styleDescription,
  aspectRatio,
  aiConfig,
  notebookId,
  onClose,
  onRevised,
}: {
  imageUrl: string;
  slideTitle: string;
  styleDescription?: string;
  aspectRatio?: string;
  aiConfig?: Partial<RuntimeAIConfig>;
  notebookId?: string;
  onClose: () => void;
  onRevised: (newImageUrl: string) => void;
}) {
  const [tool, setTool] = useState<Tool>('pen');
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [instruction, setInstruction] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingText, setPendingText] = useState<{ x: number; y: number } | null>(null);
  const [textInput, setTextInput] = useState('');

  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const draftRef = useRef<Shape | null>(null);
  const drawingRef = useRef(false);

  // Convert pointer event to natural-image pixel coordinates.
  const toImageCoords = useCallback((e: { clientX: number; clientY: number }) => {
    const img = imgRef.current;
    if (!img) return { x: 0, y: 0 };
    const rect = img.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * img.naturalWidth,
      y: ((e.clientY - rect.top) / rect.height) * img.naturalHeight,
    };
  }, []);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img || !img.naturalWidth) return;
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const lineWidth = Math.max(3, img.naturalWidth / 320);
    const fontSize = Math.max(18, img.naturalWidth / 42);
    ctx.strokeStyle = ANNOTATION_COLOR;
    ctx.fillStyle = ANNOTATION_COLOR;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.font = `600 ${fontSize}px system-ui, sans-serif`;

    const all = draftRef.current ? [...shapes, draftRef.current] : shapes;
    for (const shape of all) {
      if (shape.kind === 'stroke' && shape.points.length > 1) {
        ctx.beginPath();
        ctx.moveTo(shape.points[0].x, shape.points[0].y);
        for (const p of shape.points.slice(1)) ctx.lineTo(p.x, p.y);
        ctx.stroke();
      } else if (shape.kind === 'arrow') {
        const { from, to } = shape;
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.stroke();
        const angle = Math.atan2(to.y - from.y, to.x - from.x);
        const head = lineWidth * 4;
        ctx.beginPath();
        ctx.moveTo(to.x, to.y);
        ctx.lineTo(to.x - head * Math.cos(angle - Math.PI / 6), to.y - head * Math.sin(angle - Math.PI / 6));
        ctx.moveTo(to.x, to.y);
        ctx.lineTo(to.x - head * Math.cos(angle + Math.PI / 6), to.y - head * Math.sin(angle + Math.PI / 6));
        ctx.stroke();
      } else if (shape.kind === 'text') {
        ctx.fillText(shape.text, shape.at.x, shape.at.y);
      }
    }
  }, [shapes]);

  useEffect(() => { redraw(); }, [redraw]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (isSubmitting) return;
    const pt = toImageCoords(e);
    if (tool === 'text') {
      setPendingText(pt);
      setTextInput('');
      return;
    }
    drawingRef.current = true;
    (e.target as Element).setPointerCapture(e.pointerId);
    draftRef.current = tool === 'pen'
      ? { kind: 'stroke', points: [pt] }
      : { kind: 'arrow', from: pt, to: pt };
    redraw();
  }, [tool, isSubmitting, toImageCoords, redraw]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!drawingRef.current || !draftRef.current) return;
    const pt = toImageCoords(e);
    if (draftRef.current.kind === 'stroke') draftRef.current.points.push(pt);
    else if (draftRef.current.kind === 'arrow') draftRef.current.to = pt;
    redraw();
  }, [toImageCoords, redraw]);

  const handlePointerUp = useCallback(() => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    const draft = draftRef.current;
    draftRef.current = null;
    if (draft) {
      const isMeaningful = draft.kind === 'stroke'
        ? draft.points.length > 2
        : draft.kind === 'arrow'
          ? Math.hypot(draft.to.x - draft.from.x, draft.to.y - draft.from.y) > 8
          : true;
      if (isMeaningful) setShapes(prev => [...prev, draft]);
      else redraw();
    }
  }, [redraw]);

  const commitText = useCallback(() => {
    if (pendingText && textInput.trim()) {
      setShapes(prev => [...prev, { kind: 'text', at: pendingText, text: textInput.trim() }]);
    }
    setPendingText(null);
    setTextInput('');
  }, [pendingText, textInput]);

  const buildAnnotatedImage = useCallback(async (): Promise<{ base64: string; hasAnnotations: boolean }> => {
    const img = imgRef.current;
    if (!img) throw new Error('图片未加载完成');
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('无法创建画布');
    ctx.drawImage(img, 0, 0);
    if (shapes.length > 0 && canvasRef.current) {
      ctx.drawImage(canvasRef.current, 0, 0);
    }
    const dataUrl = canvas.toDataURL('image/png');
    return { base64: dataUrl.replace(/^data:image\/\w+;base64,/, ''), hasAnnotations: shapes.length > 0 };
  }, [shapes]);

  const handleSubmit = useCallback(async () => {
    if (isSubmitting) return;
    if (!instruction.trim() && shapes.length === 0) {
      setError('请先在图上标注,或填写修改要求');
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      const { base64, hasAnnotations } = await buildAnnotatedImage();
      const res = await clientApiRequest('/api/ai/ppt-slide-revise', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...accountAuthHeaders() },
        body: JSON.stringify({
          imageBase64: base64,
          instruction: instruction.trim(),
          hasAnnotations,
          slideTitle,
          styleDescription,
          aspectRatio,
          aiConfig,
          notebookId,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.imageUrl) throw new Error(data.error || '修改失败');
      onRevised(data.imageUrl);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '修改失败,请重试');
    } finally {
      setIsSubmitting(false);
    }
  }, [isSubmitting, instruction, shapes.length, buildAnnotatedImage, slideTitle, styleDescription, aspectRatio, aiConfig, notebookId, onRevised, onClose]);

  const TOOLS: Array<{ id: Tool; label: string; icon: typeof Pencil }> = [
    { id: 'pen', label: '画笔', icon: Pencil },
    { id: 'arrow', label: '箭头', icon: ArrowUpRight },
    { id: 'text', label: '文字', icon: Type },
  ];

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" data-testid="slide-annotation-editor">
      <div className="flex max-h-[94vh] w-full max-w-5xl flex-col gap-3 rounded-2xl border border-white/10 bg-[var(--bg-primary)] p-4 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-[var(--text-primary)]">标注修改 · {slideTitle}</h3>
            <p className="text-[11px] text-[var(--text-tertiary)]">用画笔/箭头/文字在页面上圈出要改的地方,再描述修改要求,AI 将重新生成干净的成品页</p>
          </div>
          <button onClick={onClose} className="rounded-full p-2 text-[var(--text-tertiary)] hover:bg-[var(--glass-hover)]" aria-label="关闭">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-2">
          {TOOLS.map(t => (
            <button
              key={t.id}
              onClick={() => setTool(t.id)}
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${
                tool === t.id
                  ? 'border-red-400/60 bg-red-500/15 text-red-400'
                  : 'border-[var(--glass-border)] text-[var(--text-secondary)] hover:bg-[var(--glass-hover)]'
              }`}
            >
              <t.icon className="h-3.5 w-3.5" /> {t.label}
            </button>
          ))}
          <div className="mx-1 h-5 w-px bg-[var(--glass-border)]" />
          <button
            onClick={() => setShapes(prev => prev.slice(0, -1))}
            disabled={shapes.length === 0}
            className="flex items-center gap-1.5 rounded-lg border border-[var(--glass-border)] px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--glass-hover)] disabled:opacity-40"
          >
            <Undo2 className="h-3.5 w-3.5" /> 撤销
          </button>
          <button
            onClick={() => setShapes([])}
            disabled={shapes.length === 0}
            className="flex items-center gap-1.5 rounded-lg border border-[var(--glass-border)] px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--glass-hover)] disabled:opacity-40"
          >
            <Eraser className="h-3.5 w-3.5" /> 清空
          </button>
          <span className="ml-auto text-[11px] text-[var(--text-quaternary)]">{shapes.length} 处标注</span>
        </div>

        {/* Canvas area */}
        <div className="relative min-h-0 flex-1 overflow-auto rounded-xl bg-black/40">
          <div className="relative mx-auto w-fit">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              ref={imgRef}
              src={imageUrl}
              alt={slideTitle}
              className="block max-h-[52vh] w-auto select-none"
              draggable={false}
              onLoad={redraw}
            />
            <canvas
              ref={canvasRef}
              className="absolute left-0 top-0 h-full w-full touch-none"
              style={{ cursor: tool === 'text' ? 'text' : 'crosshair' }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
            />
          </div>

          {/* Inline text input */}
          {pendingText && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/40">
              <div className="w-72 space-y-2 rounded-xl border border-white/10 bg-[var(--bg-primary)] p-3 shadow-xl">
                <p className="text-xs font-medium text-[var(--text-secondary)]">批注文字</p>
                <input
                  autoFocus
                  value={textInput}
                  onChange={e => setTextInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') commitText(); if (e.key === 'Escape') setPendingText(null); }}
                  placeholder="例如:这里改成柱状图"
                  className="liquid-glass-input w-full px-3 py-2 text-xs"
                />
                <div className="flex justify-end gap-2">
                  <button onClick={() => setPendingText(null)} className="rounded-lg px-3 py-1.5 text-xs text-[var(--text-tertiary)] hover:bg-[var(--glass-hover)]">取消</button>
                  <button onClick={commitText} className="rounded-lg bg-red-500/85 px-3 py-1.5 text-xs font-medium text-white">添加</button>
                </div>
              </div>
            </div>
          )}
        </div>

        {error && <div className="rounded-lg px-3 py-2 text-xs text-red-400 liquid-glass-static !border-red-500/20">{error}</div>}

        {/* Instruction + submit */}
        <div className="flex items-end gap-2">
          <textarea
            value={instruction}
            onChange={e => setInstruction(e.target.value)}
            rows={2}
            placeholder="描述修改要求,例如:把右侧图表换成折线图;标题加大;整页配色改为深蓝..."
            className="liquid-glass-input min-h-[56px] flex-1 resize-none px-3 py-2.5 text-xs leading-relaxed"
          />
          <button
            onClick={handleSubmit}
            disabled={isSubmitting}
            data-testid="slide-annotation-submit"
            className="flex h-[56px] shrink-0 items-center gap-2 rounded-xl bg-gradient-to-r from-red-500 to-rose-600 px-5 text-sm font-semibold text-white transition-all hover:from-red-400 hover:to-rose-500 active:scale-[0.97] disabled:opacity-50"
          >
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {isSubmitting ? '重绘中...' : '按标注修改'}
          </button>
        </div>
      </div>
    </div>
  );
}
