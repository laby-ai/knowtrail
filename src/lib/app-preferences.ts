import { z } from 'zod';

export const appPreferencesSchema = z.object({
  interfaceLanguage: z.enum(['zh-CN', 'en']).default('zh-CN'),
  outputLanguage: z.enum(['auto', 'zh-CN', 'en']).default('auto'),
  fontSize: z.enum(['standard', 'large', 'larger']).default('standard'),
  saveHistory: z.boolean().default(true),
  reduceMotion: z.boolean().default(false),
}).strict();
export type AppPreferences = z.infer<typeof appPreferencesSchema>;
export const DEFAULT_APP_PREFERENCES = appPreferencesSchema.parse({});
export function outputLanguageInstruction(language: AppPreferences['outputLanguage']): string {
  if (language === 'auto') return '';
  return `\nUser output-language preference: ${language === 'en' ? 'English' : 'Simplified Chinese'}. Override earlier default-language instructions and use this language for reader-facing prose. Explicit language choices made by the user in the task still take priority. Preserve JSON keys, enum values, code, equations, citations, source quotations and proper names exactly. This preference does not change the required response format.`;
}
