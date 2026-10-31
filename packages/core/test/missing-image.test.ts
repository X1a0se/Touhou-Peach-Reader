import { createMemoryPlatform } from '@tpr/platform/memory';
import type { RawDatabase } from '@tpr/schema';
import { makeDatabase } from '@tpr/schema/testing';
import { describe, expect, it } from 'vitest';
import { createLibrary, type Library } from '../src/db/library.js';
import { databasePathOf } from '../src/db/sql/store.js';
import { ioFor } from '../src/db/workspace.js';
import { serializeDatabase, writeDatabaseDir } from '../src/db/write.js';

/**
 * 缺图片 BLOB 的导出/导入回归（0.1.8 用户现场：导出成功、重新导入报 1 个错误）。
 *
 * 根因：prepareExport 先写 images.json，再逐张从 SQLite 读 BLOB；行存在但 data 为 NULL
 * 时只记 W_EXPORT_SKIPPED，图片条目仍留在包内，导入端 E_IMAGE_FILE_MISSING 直接阻断。
 * 修复后：导出剔除不可用图片并重算 counts；导入旧坏包时跳过该元数据、记导入警告。
 */

type MemoryPlatform = ReturnType<typeof createMemoryPlatform>;

const IMAGE_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 1]);

async function makeSeedPackage(
  db: RawDatabase = makeDatabase(),
  omitImageId?: string,
): Promise<Uint8Array> {
  const seed = createMemoryPlatform({ dataDir: '/seed' });
  const io = ioFor(seed);
  const markdown = new Map(
    db.articles.map((article) => [article.id, `# ${article.title}\n\n正文：${article.id}\n`]),
  );
  await writeDatabaseDir(io, '/seed', serializeDatabase(db, markdown));
  for (const image of db.images) {
    if (image.id === omitImageId) continue;
    const path = seed.paths.join('/seed', image.file);
    await seed.fs.mkdir(seed.paths.dirname(path));
    await seed.fs.writeBytes(path, IMAGE_BYTES);
  }
  await seed.zip.createFromDir('/seed', '/seed/out.tpr', { order: ['manifest.json'] });
  return seed.fs.readBytes('/seed/out.tpr');
}

async function importPackage(bytes: Uint8Array): Promise<{
  platform: MemoryPlatform;
  library: Library;
  outcome: Awaited<ReturnType<Library['importBytes']>>;
}> {
  const platform = createMemoryPlatform({ dataDir: '/app' });
  const library = createLibrary(platform);
  const outcome = await library.importBytes(bytes);
  return { platform, library, outcome };
}

/** 解包导出的字节，返回「包内相对路径 → 文本」；二进制文件用 binary 占位。 */
async function unpack(
  platform: MemoryPlatform,
  bytes: Uint8Array,
  dir: string,
): Promise<Map<string, string>> {
  const zipPath = `${dir}.tpr`;
  await platform.fs.mkdir(dir);
  await platform.fs.writeBytes(zipPath, bytes);
  const result = await platform.zip.extractAll(zipPath, dir);
  expect(result.rejected).toEqual([]);

  const files = new Map<string, string>();
  const walk = async (current: string): Promise<void> => {
    for (const entry of await platform.fs.listDir(current)) {
      if (entry.isDirectory) {
        await walk(entry.path);
        continue;
      }
      const relative = entry.path.slice(dir.length + 1).replaceAll('\\', '/');
      const isText = /\.(json|md)$/.test(relative);
      files.set(relative, isText ? await platform.fs.readText(entry.path) : 'binary');
    }
  };
  await walk(dir);
  return files;
}

function parseJson<T>(files: Map<string, string>, path: string): T {
  const text = files.get(path);
  if (text === undefined) throw new Error(`导出包缺少 ${path}`);
  return JSON.parse(text) as T;
}

function firstImage(db: RawDatabase): RawDatabase['images'][number] {
  const image = db.images[0];
  if (!image) throw new Error('夹具缺少图片');
  return image;
}

describe('missing image BLOB: 缺图包必须仍可导入', () => {
  it('export: 缺 BLOB 的图片被剔除，counts 自洽且可重新导入', async () => {
    const seed = makeDatabase();
    const missing = firstImage(seed);
    const { platform, library } = await importPackage(await makeSeedPackage(seed));

    const loaded = library.current();
    if (!loaded) throw new Error('导入后未加载数据库');
    await platform.sql.batch(databasePathOf(platform, loaded.dir), [
      { sql: 'UPDATE images SET data = NULL WHERE id = ?', params: [missing.id] },
    ]);

    const exported = await library.export({ all: true });
    expect(exported.warnings).toContainEqual(
      expect.objectContaining({
        code: 'W_EXPORT_SKIPPED',
        entity: 'image',
        entityId: missing.id,
      }),
    );

    const files = await unpack(platform, exported.bytes, '/unpack/export-repair');
    const images = parseJson<{ id: string }[]>(files, 'images.json');
    expect(images.map((image) => image.id)).not.toContain(missing.id);
    expect(files.has(missing.file)).toBe(false);
    const manifest = parseJson<{ counts: Record<string, number> }>(files, 'manifest.json');
    expect(manifest.counts.images).toBe(images.length);

    const fresh = await importPackage(exported.bytes);
    expect(fresh.outcome.report.errors).toEqual([]);
    expect(fresh.outcome.report.warnings.some((item) => item.code === 'W_IMAGE_FILE_MISSING')).toBe(
      false,
    );
    expect(fresh.outcome.snapshot.images.map((image) => image.id)).not.toContain(missing.id);
  });

  it('import: 包内缺图片文件时跳过元数据、告警，且不写 NULL BLOB 行', async () => {
    const seed = makeDatabase();
    const missing = firstImage(seed);
    const { platform, library, outcome } = await importPackage(
      await makeSeedPackage(seed, missing.id),
    );

    expect(outcome.report.errors).toEqual([]);
    expect(outcome.report.warnings[0]).toMatchObject({
      code: 'W_IMAGE_FILE_MISSING',
      severity: 'warning',
      entity: 'image',
      entityId: missing.id,
    });
    expect(outcome.snapshot.images.map((image) => image.id)).not.toContain(missing.id);
    expect(outcome.snapshot.images).toHaveLength(seed.images.length - 1);

    const loaded = library.current();
    if (!loaded) throw new Error('导入后未加载数据库');
    const rows = await platform.sql.query(
      databasePathOf(platform, loaded.dir),
      'SELECT id FROM images WHERE id = ?',
      [missing.id],
    );
    expect(rows).toEqual([]);
  });

  it('import: 完整包不会产生缺图警告', async () => {
    const { outcome } = await importPackage(await makeSeedPackage());
    expect(outcome.report.errors).toEqual([]);
    expect(outcome.report.warnings.some((item) => item.code === 'W_IMAGE_FILE_MISSING')).toBe(
      false,
    );
  });
});
