'use client';
import { useEffect, useState, useRef } from 'react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import type { ConfirmationEvent } from '@/lib/commerce/client-confirmation';
export function CommerceConfirmationHost() {
  const queue = useRef<ConfirmationEvent[]>([]);
  const [pending, setPending] = useState<ConfirmationEvent | null>(null);
  useEffect(() => {
    const receive = (event: Event) => { const item = (event as CustomEvent<ConfirmationEvent>).detail; queue.current.push(item); setPending(current => current || queue.current.shift() || null); };
    window.addEventListener('lingbi-commerce-confirm', receive);
    return () => { window.removeEventListener('lingbi-commerce-confirm', receive); queue.current.splice(0).forEach(item => item.resolve(false)); };
  }, []);
  function finish(approved: boolean) { pending?.resolve(approved); setPending(queue.current.shift() || null); }
  return <Dialog open={Boolean(pending)} onOpenChange={open => { if (!open) finish(false); }}><DialogContent className="grid gap-5" style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)' }}><DialogTitle>确认本次科研任务费用</DialogTitle><DialogDescription>完成后按实际用量结算，未使用的预占点数会释放。</DialogDescription>{pending && <div className="space-y-3 text-sm leading-6"><p className="break-all">付款账户：{pending.quote.accountId}</p><p>模型来源：{pending.quote.source === 'byok' ? '自带百炼密钥，模型费用由百炼直接收取' : '平台模型'}</p><p className="text-lg font-semibold">本次最多 {pending.quote.maxPoints} 点</p><p>本次授权不会超额扣费，也不会自动改用其他付款账户。</p></div>}<div className="flex flex-wrap justify-end gap-3"><button className="liquid-glass-btn" onClick={() => finish(false)}>取消</button><button className="liquid-glass-btn liquid-glass-btn-primary" onClick={() => finish(true)}>确认并开始</button></div></DialogContent></Dialog>;
}
