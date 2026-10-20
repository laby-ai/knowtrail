import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { appPreferencesSchema, DEFAULT_APP_PREFERENCES, outputLanguageInstruction } from '../src/lib/app-preferences';
import { readAppPreferences, saveAppPreferences } from '../src/lib/app-preferences-store';

async function main() {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'lingbi-preferences-test-'));
  process.env.APP_PREFERENCES_STORE_DIR = temporary;
  try {
    assert.deepEqual(await readAppPreferences('test-owner-a'), DEFAULT_APP_PREFERENCES);
    const saved = { ...DEFAULT_APP_PREFERENCES, interfaceLanguage: 'en' as const, outputLanguage: 'zh-CN' as const, saveHistory: false, fontSize: 'larger' as const };
    await saveAppPreferences('test-owner-a', saved);
    assert.deepEqual(await readAppPreferences('test-owner-a'), saved);
    assert.deepEqual(await readAppPreferences('test-owner-b'), DEFAULT_APP_PREFERENCES);
    assert.throws(() => appPreferencesSchema.parse({ ...saved, memberId: 'another-owner' }));
    assert.throws(() => appPreferencesSchema.parse({ ...saved, fontSize: '300%' }));
    assert.equal(outputLanguageInstruction('auto'), '');
    assert.match(outputLanguageInstruction('en'), /English/);
    assert.match(outputLanguageInstruction('zh-CN'), /Simplified Chinese/);
    assert.match(outputLanguageInstruction('en'), /JSON keys/);
    console.log('PASS: preference persistence, owner isolation, strict schema and independent output-language instructions');
  } finally { await rm(temporary, { recursive: true, force: true }); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
