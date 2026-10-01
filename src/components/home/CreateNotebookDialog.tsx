'use client';
import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
export function CreateNotebookDialog({ open, onOpenChange, onCreate }: {
  open: boolean; onOpenChange: (open: boolean) => void; onCreate: (name: string) => void;
}) {
  const [name, setName] = useState('');
  const changeOpen = (next: boolean) => { setName(''); onOpenChange(next); };
  return <Dialog open={open} onOpenChange={changeOpen}>
    <DialogContent>
      <DialogHeader><DialogTitle>新建文献本</DialogTitle><DialogDescription>为研究主题命名，资料与对话将单独保存。</DialogDescription></DialogHeader>
      <form onSubmit={event => { event.preventDefault(); if (name.trim()) { onCreate(name.trim()); setName(''); } }}>
        <label htmlFor="notebook-name" className="mb-2 block text-sm">文献本名称</label>
        <Input id="notebook-name" autoFocus required maxLength={80} value={name} onChange={event => setName(event.target.value)} placeholder="例如：肿瘤免疫文献综述" />
        <DialogFooter className="mt-4"><Button type="button" variant="outline" onClick={() => changeOpen(false)}>取消</Button><Button type="submit" disabled={!name.trim()}>创建</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
