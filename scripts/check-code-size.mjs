#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const strict = process.env.CODE_SIZE_STRICT === 'true';
const maxRows = Number(process.env.CODE_SIZE_TOP || 30);
const warningLineLimit = Number(process.env.CODE_SIZE_WARN_LINES || 1000);

const includeExtensions = new Set(['.ts', '.tsx', '.js', '.mjs', '.css']);
const ignoredDirs = new Set([
  '.git',
  '.next',
  '.references',
  'dist',
  'node_modules',
  '.deploy',
  '.data',
]);

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (!ignoredDirs.has(name)) walk(full, acc);
      continue;
    }
    if (includeExtensions.has(path.extname(name))) acc.push(full);
  }
  return acc;
}

function countLines(file) {
  return readFileSync(file, 'utf8').split(/\r?\n/).length;
}

const files = walk(path.join(root, 'src'))
  .concat(walk(path.join(root, 'scripts')))
  .map(file => ({
    path: path.relative(root, file).replaceAll(path.sep, '/'),
    lines: countLines(file),
  }))
  .sort((a, b) => b.lines - a.lines);

const top = files.slice(0, maxRows);
const overLimit = files.filter(file => file.lines >= warningLineLimit);

const result = {
  ok: !strict || overLimit.length === 0,
  strict,
  warningLineLimit,
  filesChecked: files.length,
  overLimitCount: overLimit.length,
  top,
  overLimit: overLimit.map(file => ({
    ...file,
    target: 'split route/component/service responsibilities before adding more product logic here',
  })),
};

console.log(JSON.stringify(result, null, 2));

if (!result.ok) {
  process.exitCode = 1;
}
