#!/usr/bin/env node
/**
 * 包依赖边界校验（design §3.2）。
 * 规则是"禁止清单"而不是"允许清单"：新增合法依赖不会被误报，越界一定被抓到。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const RULES = [
  { dir: 'packages/schema/src', forbidden: [/^@tauri-apps\//, /^node:/, /^react/] },
  { dir: 'packages/platform/src', forbidden: [/^@tauri-apps\//, /^react/, /^@tpr\/core/] },
  { dir: 'packages/core/src', forbidden: [/^@tauri-apps\//, /^node:/, /^react/, /^react-dom/] },
  { dir: 'packages/ui/src', forbidden: [/^@tauri-apps\//, /^node:/, /^@tpr\/core/] },
];

const IMPORT_RE = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"]([^'"]+)['"]/g;

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx|mts|cts)$/.test(name)) out.push(full);
  }
  return out;
}

let failures = 0;

for (const rule of RULES) {
  let files;
  try {
    files = walk(rule.dir);
  } catch {
    console.log(`跳过不存在的目录：${rule.dir}`);
    continue;
  }
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(IMPORT_RE)) {
      const specifier = match[1];
      if (!specifier) continue;
      for (const pattern of rule.forbidden) {
        if (pattern.test(specifier)) {
          const line = text.slice(0, match.index).split('\n').length;
          console.error(`${relative(process.cwd(), file)}:${line} 越界依赖 ${specifier}`);
          failures += 1;
        }
      }
    }
  }
}

if (failures > 0) {
  console.error(`\n✗ 依赖边界检查失败：${failures} 处`);
  process.exit(1);
}
console.log('✓ 依赖边界检查通过');
