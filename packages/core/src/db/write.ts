import type { RawDatabase } from '@tpr/schema';
import { articleJson, articleMd, LAYOUT, seriesJson } from './layout.js';
import type { DbIo } from './layout.js';

export interface TextFile {
  /** 包内相对路径，`/` 分隔 */
  path: string;
  text: string;
}

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

/**
 * 把整库序列化成"相对路径 + 文本"的扁平列表（manifest.json 放最后）。
 * 纯函数：不碰文件系统，便于单测与导出闭包筛选。
 */
export function serializeDatabase(db: RawDatabase, markdown: Map<string, string> = new Map()): TextFile[] {
  const files: TextFile[] = [
    { path: LAYOUT.authors, text: json(db.authors) },
    { path: LAYOUT.tags, text: json(db.tags) },
    { path: LAYOUT.images, text: json(db.images) },
    { path: LAYOUT.featured, text: json(db.featured) },
    { path: LAYOUT.credits, text: json(db.credits) },
  ];

  for (const article of db.articles) {
    files.push({ path: articleJson(article.id), text: json(article) });
    const body = markdown.get(article.id);
    if (body !== undefined) files.push({ path: articleMd(article.id), text: body });
  }
  for (const series of db.series) {
    files.push({ path: seriesJson(series.id), text: json(series) });
  }

  // manifest 最后写：中途失败 → 包不完整 → 导入端一眼发现（§7.1）
  files.push({ path: LAYOUT.manifest, text: json(db.manifest) });
  return files;
}

/** 原子写：先写 `.tmp` 再 rename；NTFS 同卷 rename 是原子的（§9.2）。 */
export async function atomicWriteText(io: DbIo, path: string, text: string): Promise<void> {
  const tmp = `${path}.tmp`;
  await io.fs.writeText(tmp, text);
  await io.fs.rename(tmp, path);
}

/** 在文件系统里物化整库（目录由实现自建；内存实现是隐式的）。 */
export async function writeDatabaseDir(io: DbIo, dir: string, files: TextFile[]): Promise<void> {
  await io.fs.mkdir(dir);
  for (const file of files) {
    await atomicWriteText(io, io.join(dir, file.path), file.text);
  }
}

/**
 * 删除目标目录里已不在本次序列化结果中的实体文件。
 *
 * 写入是"覆盖式"的：删掉的文章/系列/图片如果不清理，重启后 `readDatabaseDir`
 * 会把旧文件读回来（表现为"删了又出现"、计数回退）。
 */
export async function pruneDatabaseDir(
  io: DbIo,
  dir: string,
  keep: ReadonlySet<string>,
): Promise<void> {
  const roots: string[] = [LAYOUT.articlesDir, LAYOUT.seriesDir];
  const imagesRoot = io.join(dir, LAYOUT.imagesDir);
  if (await io.fs.exists(imagesRoot)) {
    for (const entry of await io.fs.listDir(imagesRoot)) {
      if (entry.isDirectory) roots.push(`${LAYOUT.imagesDir}/${entry.name}`);
    }
  }

  for (const root of roots) {
    const full = io.join(dir, root);
    if (!(await io.fs.exists(full))) continue;
    for (const entry of await io.fs.listDir(full)) {
      if (entry.isDirectory) continue;
      const relative = `${root}/${entry.name}`;
      if (!keep.has(relative)) await io.fs.remove(io.join(full, entry.name));
    }
  }
}
