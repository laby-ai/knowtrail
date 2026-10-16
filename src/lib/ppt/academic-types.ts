import type { RuntimeAIConfig } from '@/types';
import type { MinerUFigureInput } from '@/lib/ppt/mineru-figures';
import type { PptOutlineDraftItem } from '@/lib/ppt/outline-draft';

export interface PaperInput {
  id?: string;
  title: string;
  authors: string[];
  year: number;
  abstract?: string;
  content?: string;
  rawContent?: string;
  shortName?: string;
  journal?: string;
  doi?: string;
  fileUrl?: string;
  fileKey?: string;
  fileType?: string;
  fileName?: string;
  mineruFigures?: MinerUFigureInput[];
  mineruStatus?: string;
}

export interface SlideSpec {
  type: 'cover' | 'author' | 'toc' | 'background' | 'gap' | 'roadmap' |
        'method' | 'result' | 'discussion' | 'conclusion' |
        'figure_overview' | 'figure_detail' | 'figure_evidence' |
        'mechanism' | 'synthesis' | 'citation' | 'closing';
  title: string;
  bullets: string[];
  note?: string;
  figureLabel?: string;
  emphasisIndices?: number[];
  table?: { headers: string[]; rows: string[][]; sourceText: string };
  flow?: { steps: string[]; sourceText: string };
}

export interface PptOptions {
  institution?: 'ustc' | 'ustc-suzhou' | 'ucas' | 'ipc' | 'generic';
  closingStyle?: 'blue' | 'campus' | 'emblem' | 'calligraphy';
  presenterName?: string;
  advisorName?: string;
  mineruFigures?: MinerUFigureInput[];
  duration?: number;
  audience?: 'researchers' | 'students' | 'industry' | 'general';
  speakerNotes?: boolean;
  runtimeConfig?: Partial<RuntimeAIConfig>;
  outlineDraft?: PptOutlineDraftItem[];
  outlineDraftPrompt?: string;
}

export type LayoutType =
  | 'full_text'
  | 'text_right_figure_left'
  | 'text_left_figure_right'
  | 'figure_centered'
  | 'two_column'
  | 'title_only'
  | 'bullet_heavy'
  | 'quote_highlight';

export interface EnhancedSlideSpec extends SlideSpec {
  layout?: LayoutType;
  discourseRef?: string;
  commitmentCheck?: 'pass' | 'warning' | 'fail';
  commitmentNote?: string;
}

export type SpeakerNotesGenerator = (
  papers: PaperInput[],
  slides: SlideSpec[],
  runtimeConfig?: Partial<RuntimeAIConfig>,
) => Promise<string[]>;
