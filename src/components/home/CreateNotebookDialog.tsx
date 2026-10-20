'use client';
import { UiText } from '@/components/account/UiText';
import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
export function CreateNotebookDialog({ open, onOpenChange, onCreate }: {
  open: boolean; onOpenChange: (open: boolean) => void; onCreate: (name: string) => void | Promise<void>;
}) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const changeOpen = (next: boolean) => { if (busy) return; setName(''); setError(''); onOpenChange(next); };
  return <Dialog open={open} onOpenChange={changeOpen}>
    <DialogContent>
      <DialogHeader><DialogTitle><UiText>新建文献本</UiText></DialogTitle><DialogDescription><UiText>为研究主题命名，资料与对话将单独保存。</UiText></DialogDescription></DialogHeader>
      <form onSubmit={async event => { event.preventDefault(); if (!name.trim() || busy) return; setBusy(true); setError(''); try { await onCreate(name.trim()); setName(''); } catch (failure) { setError(failure instanceof Error ? failure.message : '创建失败'); } finally { setBusy(false); } }}>
        <label htmlFor="notebook-name" className="mb-2 block text-sm"><UiText>文献本名称</UiText></label>
        <Input id="notebook-name" autoFocus required maxLength={80} value={name} onChange={event => setName(event.target.value)} placeholder="例如：肿瘤免疫文献综述" />
        {error && <p role="alert" className="mt-3 text-red-600">{error}</p>}<DialogFooter className="mt-4"><Button type="button" variant="outline" onClick={() => changeOpen(false)}><UiText>取消</UiText></Button><Button type="submit" disabled={busy || !name.trim()}>{busy ? '正在创建…' : '创建'}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
