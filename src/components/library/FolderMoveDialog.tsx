'use client';
import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { canMoveFolder, folderRows } from '@/lib/folder-hierarchy';
import type { ProjectFolder } from '@/types';

export function FolderMoveDialog({ folderId, folders, onClose, onMove }: { folderId: string; folders: ProjectFolder[]; onClose: () => void; onMove: (parentId: string | null) => boolean }) {
  const folder = folders.find(item => item.id === folderId);
  const [parentId, setParentId] = useState(folder?.parentId || '');
  const [error, setError] = useState('');
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)' }} className="sm:max-w-md" data-testid="folder-move-dialog">
      <DialogHeader><DialogTitle>移动分组</DialogTitle><DialogDescription>为“{folder?.name}”选择上级分组。分组中的资料和子分组会一起保留。</DialogDescription></DialogHeader>
      <label className="space-y-2 text-sm"><span>上级分组</span><select aria-label="上级分组" className="liquid-glass-input block w-full min-h-11 px-3" value={parentId} onChange={event => { setParentId(event.target.value); setError(''); }}>
        <option value="">顶层（一级分组）</option>
        {folderRows(folders).filter(row => canMoveFolder(folders, folderId, row.folder.id)).map(row => <option key={row.folder.id} value={row.folder.id}>{row.path}</option>)}
      </select></label>
      {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
      <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>取消</Button><Button disabled={!folder} onClick={() => { if (onMove(parentId || null)) onClose(); else setError('分组已变化，请重新选择有效的上级分组。'); }}>确认移动</Button></div>
    </DialogContent>
  </Dialog>;
}
