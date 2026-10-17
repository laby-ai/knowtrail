'use client';

import { ChevronDown, FolderPlus } from 'lucide-react';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuCheckboxItem } from '@/components/ui/dropdown-menu';
import { useApp } from '@/contexts/AppContext';

export function NotebookSourceSelector({ disabled = false, compact = false }: { disabled?: boolean; compact?: boolean }) {
  const { folders, selectedPapers, togglePaperSelection, clearSelection } = useApp();
  const papers = folders.flatMap(folder => folder.papers);
  return <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <button type="button" className={compact ? 'studio-source-picker' : 'quiet-chat-sources'} data-testid={compact ? 'studio-source-menu' : 'chat-source-menu'} disabled={disabled}>
        <FolderPlus size={compact ? 16 : 19} /><span>{compact ? `资料 ${selectedPapers.length}` : `已选 ${selectedPapers.length} 份资料`}</span><ChevronDown size={14} />
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent side={compact ? 'bottom' : 'top'} align={compact ? 'end' : 'start'} className="notebook-source-menu max-h-80 w-72 overflow-y-auto">
      {papers.map(paper => <DropdownMenuCheckboxItem key={paper.id} checked={selectedPapers.includes(paper.id)} onSelect={event => event.preventDefault()} onCheckedChange={() => togglePaperSelection(paper.id)}><span className="truncate">{paper.title}</span></DropdownMenuCheckboxItem>)}
      {!papers.length && <DropdownMenuItem disabled>请先添加资料</DropdownMenuItem>}
      {selectedPapers.length > 0 && <DropdownMenuItem onSelect={clearSelection}>清除选择</DropdownMenuItem>}
    </DropdownMenuContent>
  </DropdownMenu>;
}
