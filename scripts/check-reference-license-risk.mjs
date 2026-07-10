import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function read(relativePath) {
  const fullPath = path.join(root, relativePath);
  if (!existsSync(fullPath)) {
    return { ok: false, text: '', error: `missing ${relativePath}` };
  }
  return { ok: true, text: readFileSync(fullPath, 'utf8'), error: null };
}

function readJson(relativePath) {
  const file = read(relativePath);
  if (!file.ok) return { ok: false, json: null, error: file.error };
  try {
    return { ok: true, json: JSON.parse(file.text), error: null };
  } catch (error) {
    return { ok: false, json: null, error: `invalid json ${relativePath}: ${error.message}` };
  }
}

const checks = [];

function includesCheck(name, relativePath, patterns) {
  const file = read(relativePath);
  const missing = [];
  if (!file.ok) {
    checks.push({ name, ok: false, missing: [file.error] });
    return;
  }
  for (const pattern of patterns) {
    if (!pattern.test(file.text)) missing.push(pattern.toString());
  }
  checks.push({ name, ok: missing.length === 0, missing });
}

function packageLicenseCheck(name, relativePath, expectedLicense) {
  const file = readJson(relativePath);
  if (!file.ok) {
    checks.push({ name, ok: false, missing: [file.error] });
    return;
  }
  const actual = file.json?.license;
  checks.push({
    name,
    ok: actual === expectedLicense,
    missing: actual === expectedLicense ? [] : [`license ${actual ?? 'missing'} != ${expectedLicense}`],
  });
}

function optionalReferenceCheck(referenceRoot, run) {
  if (existsSync(path.join(root, referenceRoot))) {
    run();
    return;
  }
  checks.push({
    name: `${referenceRoot.replace(/[/.\\]+/g, '-')}-local-reference`,
    ok: true,
    skipped: true,
    missing: [`${referenceRoot} not present in this checkout`],
  });
}

optionalReferenceCheck('.references/OpenMAIC', () => {
includesCheck('openmaic-root-license', '.references/OpenMAIC/LICENSE', [
  /MIT License/i,
  /THU-MAIC/i,
]);

packageLicenseCheck('openmaic-root-package-license', '.references/OpenMAIC/package.json', 'MIT');
packageLicenseCheck(
  'openmaic-mathml2omml-license-exception',
  '.references/OpenMAIC/packages/mathml2omml/package.json',
  'LGPL-3.0-or-later',
);
packageLicenseCheck('openmaic-renderer-package-license', '.references/OpenMAIC/packages/@openmaic/renderer/package.json', 'MIT');

includesCheck('openmaic-readme-third-party-disclosure', '.references/OpenMAIC/README.md', [
  /Third-Party Components/i,
  /packages\/mathml2omml/i,
  /LGPL-3\.0-or-later/i,
  /packages\/pptxgenjs/i,
]);
});

includesCheck('risk-register-openmaic-boundary', 'docs/reference-license-risk-register.md', [
  /OpenMAIC/i,
  /根项目 MIT/i,
  /LGPL-3\.0-or-later/i,
  /renderer 字体/i,
  /本地 sidecar 课堂运行时/i,
  /OpenMAIC\/MAIC 名称/i,
]);

includesCheck('virtual-classroom-reference-boundary', 'docs/openmaic-reference-boundary.md', [
  /本地 sidecar 的课堂运行时 iframe/i,
  /灵笔中间工作区/i,
  /原项目品牌名/i,
  /check:reference-boundaries/i,
  /无内部参考名泄漏/i,
]);

optionalReferenceCheck('.references/Hyper-Extract', () => {
includesCheck('hyperextract-root-license', '.references/Hyper-Extract/LICENSE', [
  /Apache License/i,
  /Version 2\.0/i,
]);

includesCheck('hyperextract-package-license', '.references/Hyper-Extract/pyproject.toml', [
  /name = "hyperextract"/i,
  /license = \{ text = "Apache-2\.0" \}/i,
]);
});

includesCheck('risk-register-hyperextract-boundary', 'docs/reference-license-risk-register.md', [
  /Hyper-Extract/i,
  /Apache-2\.0/i,
  /实体\/关系抽取契约/i,
  /节点与边的去重/i,
  /不把项目名、仓库名或文档路径暴露给最终用户/i,
]);

optionalReferenceCheck('.references/graphify', () => {
includesCheck('graphify-root-license', '.references/graphify/LICENSE', [
  /MIT License/i,
  /Safi Shamsi/i,
]);
});

includesCheck('risk-register-graphify-boundary', 'docs/reference-license-risk-register.md', [
  /Graphify/i,
  /MIT/i,
  /节点\/边 schema/i,
  /EXTRACTED\/INFERRED\/AMBIGUOUS/i,
  /原 HTML\/CSS\/JS 可视化实现整体搬入/i,
]);

const failed = checks.filter(check => !check.ok);
const result = {
  ok: failed.length === 0,
  checks,
  failed,
};

console.log(JSON.stringify(result, null, 2));

if (!result.ok) process.exit(1);
