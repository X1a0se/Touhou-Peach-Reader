#!/usr/bin/env node
/**
 * /goal 12 的验收脚本：core / ui / schema 里不允许出现任何 Tauri 专有 API。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const TARGETS = ['packages/core/src', 'packages/ui/src', 'packages/schema/src'];
const FORBIDDEN = [/@tauri-apps\//, /window\.__TAURI__/, /\bconvertFileSrc\b/, /\binvoke\s*\(/];

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

let hits = 0;
for (const dir of TARGETS) {
  let files;
  try {
    files = walk(dir);
  } catch {
    continue;
  }
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const pattern of FORBIDDEN) {
      const match = pattern.exec(text);
      if (match) {
        const line = text.slice(0, match.index).split('\n').length;
        console.error(`${relative(process.cwd(), file)}:${line} 出现 Tauri 专有 API ${String(pattern)}`);
        hits += 1;
      }
    }
  }
}

if (hits > 0) {
  console.error(`\n✗ 发现 ${hits} 处 Tauri 泄漏`);
  process.exit(1);
}
console.log('✓ core / ui / schema 中没有任何 Tauri 专有 API');
