import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  isObjectStorageConfigured,
  retrieveFileBuffer,
  resolveFileUrl,
  sanitizeStoredFileName,
  storeFile,
} from '../src/lib/storage';

const objectStorageEnvNames = [
  'S3_ENDPOINT_URL',
  'S3_REGION',
  'S3_BUCKET',
  'S3_BUCKET_NAME',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
  'OBJECT_STORAGE_ENDPOINT_URL',
  'OBJECT_STORAGE_REGION',
  'OBJECT_STORAGE_BUCKET',
  'OBJECT_STORAGE_BUCKET_NAME',
  'OBJECT_STORAGE_ACCESS_KEY_ID',
  'OBJECT_STORAGE_SECRET_ACCESS_KEY',
] as const;

const originalEnv = Object.fromEntries(
  objectStorageEnvNames.map(name => [name, process.env[name]]),
);
const mutableEnv = process.env as Record<string, string | undefined>;

function restoreEnv() {
  for (const name of objectStorageEnvNames) {
    if (originalEnv[name] === undefined) delete mutableEnv[name];
    else mutableEnv[name] = originalEnv[name];
  }
}

function clearObjectStorageEnv() {
  for (const name of objectStorageEnvNames) {
    delete mutableEnv[name];
  }
}

async function main() {
  const storageSource = await readFile('src/lib/storage.ts', 'utf-8');
  assert.equal(storageSource.includes('S3Storage'), false);

  assert.equal(sanitizeStoredFileName('../../secret.pdf'), 'secret.pdf');
  assert.equal(sanitizeStoredFileName('  report   draft?.pdf  '), 'report draft_.pdf');
  assert.equal(sanitizeStoredFileName('...'), 'upload');

  const stored = await storeFile(Buffer.from('lingbi local storage evidence', 'utf-8'), '../storage-test?.txt', 'text/plain');
  assert.ok(stored.key.startsWith('/uploads/'), `unexpected local key: ${stored.key}`);
  assert.ok(stored.localPath, 'local storage should return localPath');
  assert.ok(existsSync(stored.localPath), `expected stored file to exist: ${stored.localPath}`);
  assert.ok(statSync(stored.localPath).size > 0, 'expected stored file to be non-empty');
  assert.equal((await retrieveFileBuffer(stored.key)).toString('utf-8'), 'lingbi local storage evidence');
  assert.equal(await resolveFileUrl(stored.key), stored.key);
  assert.equal(path.basename(stored.localPath).includes('storage-test_.txt'), true);

  clearObjectStorageEnv();
  assert.equal(isObjectStorageConfigured(), false);

  mutableEnv.S3_ENDPOINT_URL = 'https://s3.example.com';
  mutableEnv.S3_REGION = 'cn-beijing';
  mutableEnv.S3_BUCKET = 'lingbi';
  mutableEnv.S3_ACCESS_KEY_ID = 'ak';
  mutableEnv.S3_SECRET_ACCESS_KEY = 'test-secret';
  assert.equal(isObjectStorageConfigured(), true);

  console.log(JSON.stringify({
    ok: true,
    checked: [
      'stored file name sanitization',
      'local file store/retrieve/url contract',
      'S3 object storage env contract',
      'legacy platform bucket aliases are not part of the storage contract',
    ],
  }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  restoreEnv();
});
