import { z } from 'zod';
export const ANALYSIS_METHODS = ['auto', 'descriptive', 'welch-t', 'welch-anova', 'linear-regression'] as const;
export type DataAnalysisMethod = typeof ANALYSIS_METHODS[number];
export const dataAnalysisRequestSchema = z.object({
  sourceId: z.string().min(1).max(160), notebookId: z.string().min(1).max(96),
  question: z.string().trim().min(1).max(1200), sampleUnit: z.string().trim().min(1).max(160),
  method: z.enum(ANALYSIS_METHODS).default('auto'), targetColumn: z.string().trim().min(1).max(200),
  groupColumn: z.string().trim().max(200).optional(), sheetName: z.string().trim().max(200).optional(),
  independentObservations: z.boolean().default(false),
}).strict();
export type DataAnalysisRequest = z.infer<typeof dataAnalysisRequestSchema>;
export interface DataAnalysisResult {
  method: DataAnalysisMethod; sourceRows: number; usedRows: number; removedRows: number;
  targetColumn: string; groupColumn?: string; columns: string[];
  summaries: Array<{ group: string; n: number; mean: number; sd: number | null; ciLow: number | null; ciHigh: number | null; min: number; max: number }>;
  test: { name: string; statistic: number | null; pValue: number; df?: number; dfNumerator?: number; dfDenominator?: number; effect?: number; effectLabel?: string; ciLow?: number; ciHigh?: number; intercept?: number; rSquared?: number } | null;
  notes: string[]; chartSvg: string; resultsDraft: string; summaryCsv: string; versions: Record<string, string>;
}
export interface StoredDataAnalysis extends DataAnalysisResult {
  id: string; createdAt: string; ownerMemberId: string; notebookId: string;
  sourceId: string; sourceFileName: string; sourceFileSha256: string;
  engineImage: string; reproduceScript: string; reproduceRequirements: string;
  request: Omit<DataAnalysisRequest, 'sourceId' | 'notebookId'> & { fileType: 'csv' | 'xlsx' };
}
