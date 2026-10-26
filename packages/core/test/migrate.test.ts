import { createMemoryPlatform } from '@tpr/platform/memory';
import type { RawDatabase } from '@tpr/schema';
import { makeDatabase } from '@tpr/schema/testing';
import { describe, expect, it } from 'vitest';
import { LAYOUT, articleMd } from '../src/db/layout.js';
import { createLibrary } from '../src/db/library.js';
import { ensureLocalDatabase } from '../src/db/migrate.js';
import { databasePathOf, readImageBlob, readSqliteFromFile } from '../src/db/sql/store.js';
import { ioFor, workspacePath, writeActive } from '../src/db/workspace.js';
import { serializeDatabase, writeDatabaseDir } from '../src/db/write.js';
import { canonicalDatabase } from '../src/db/sql/codec.js';

const IMAGE_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

const markdownFor = (db: RawDatabase): Map<string, string> =>
  new Map(db.articles.map((article) => [article.id, `# ${article.title}\n\n旧格式正文：${article.id}\n`]));

/** 造一个旧格式 workspace：JSON + Markdown 文件 + 图片文件，并指向它。 */
async function seedLegacy(
  platform: ReturnType<typeof createMemoryPlatform>,
  db: RawDatabase,
  markdown: Map<string, string> = markdownFor(db),
): Promise<string> {
  const dir = workspacePath(platform, db.manifest.databaseId);
  const io = ioFor(platform);
  await writeDatabaseDir(io, dir, serializeDatabase(db, markdown));
  for (const image of db.images) {
    const path = platform.paths.join(dir, image.file);
    await platform.fs.mkdir(platform.paths.dirname(path));
    await platform.fs.writeBytes(path, IMAGE_BYTES);
  }
  await writeActive(platform, db.manifest.databaseId);
  return dir;
}

describe('migrate: 旧 JSON 文件库 -> database.sqlite', () => {
  it('migrate-basic: 首次打开时迁移实体、正文和图片，旧文件留在 legacy/', async () => {
    const db = makeDatabase();
    const markdown = markdownFor(db);
    const platform = createMemoryPlatform({ dataDir: '/app' });
    const dir = await seedLegacy(platform, db, markdown);

    const library = createLibrary(platform);
    const snapshot = await library.restore();
    expect(snapshot).not.toBeNull();
    expect(snapshot?.manifest.databaseId).toBe(db.manifest.databaseId);
    expect(snapshot?.manifest.counts).toEqual(db.manifest.counts);
    expect(snapshot?.articles.length).toBe(db.articles.length);
    expect(snapshot?.authors.length).toBe(db.authors.length);
    expect(snapshot?.images.length).toBe(db.images.length);

    // 读回 SQLite 后，实体与规范化后的输入逐字段一致；正文与图片按 ids 从库里取。
    const dbPath = databasePathOf(platform, dir);
    const actual = await readSqliteFromFile(platform, dbPath);
    expect(canonicalDatabase(actual)).toBe(canonicalDatabase(db));
    for (const article of db.articles) {
      await expect(library.readContent(article.id)).resolves.toBe(markdown.get(article.id));
      expect(await platform.fs.exists(platform.paths.join(dir, articleMd(article.id)))).toBe(false);
    }
    for (const image of db.images) {
      await expect(readImageBlob(platform, dir, image.id)).resolves.toEqual(IMAGE_BYTES);
    }

    expect(await platform.fs.exists(dbPath)).toBe(true);
    expect(await platform.fs.exists(platform.paths.join(dir, LAYOUT.manifest))).toBe(false);
    expect(await platform.fs.exists(platform.paths.join(dir, LAYOUT.articlesDir))).toBe(false);
    expect(await platform.fs.exists(platform.paths.join(dir, LAYOUT.imagesDir))).toBe(false);
    expect(await platform.fs.exists(platform.paths.join(dir, LAYOUT.legacyDir, LAYOUT.manifest))).toBe(true);
    expect(await platform.fs.exists(platform.paths.join(dir, LAYOUT.legacyDir, LAYOUT.articlesDir))).toBe(true);

    // 再次打开不重复迁移，也不破坏库。
    await expect(ensureLocalDatabase(platform, dir)).resolves.toBeUndefined();
    const reopened = await createLibrary(platform).restore();
    expect(reopened?.articles.length).toBe(db.articles.length);
  });

  it('migrate-inline: 旧 JSON 里内联的正文会写进文章正文表', async () => {
    const db = makeDatabase();
    const inline = '# 内联旧正文\n\n这段文字只存在于旧的 JSON 中。\n';
    const inlineArticle = { ...db.articles[0]!, content: inline };
    const legacyDb: RawDatabase = { ...db, articles: [inlineArticle, ...db.articles.slice(1)] };
    const markdown = new Map(
      legacyDb.articles
        .filter((article) => typeof article.content !== 'string')
        .map((article) => [article.id, `# ${article.title}\n\n文件正文\n`]),
    );
    const platform = createMemoryPlatform({ dataDir: '/app' });
    await seedLegacy(platform, legacyDb, markdown);

    const library = createLibrary(platform);
    await library.restore();
    await expect(library.readContent(inlineArticle.id)).resolves.toBe(inline);
    await expect(library.readContent(legacyDb.articles[1]!.id)).resolves.toContain('文件正文');
  });

  it('migrate-persist: 迁移后编辑不会把虚拟文件路径当成真实文件校验', async () => {
    const db = makeDatabase();
    const platform = createMemoryPlatform({ dataDir: '/app' });
    const dir = await seedLegacy(platform, db);
    const library = createLibrary(platform);
    await library.restore();
    const target = db.articles[0]!;

    await library.saveContent(target.id, '迁移后改过的正文');
    await library.applyEdit((draft) => {
      const article = draft.articles.find((item) => item.id === target.id);
      if (!article) throw new Error('测试文章不存在');
      article.title = '迁移后改过的标题';
    });

    const reopenedLibrary = createLibrary(platform);
    const reopened = await reopenedLibrary.restore();
    expect(reopened?.articles.find((item) => item.id === target.id)?.title).toBe('迁移后改过的标题');
    await expect(reopenedLibrary.readContent(target.id)).resolves.toBe('迁移后改过的正文');
    expect(await platform.fs.exists(databasePathOf(platform, dir))).toBe(true);
  });

  it('migrate-reject: 校验失败时不生成 database.sqlite，也不动旧文件', async () => {
    const broken = makeDatabase();
    broken.authors = [...broken.authors, { ...broken.authors[0]! }];
    const platform = createMemoryPlatform({ dataDir: '/app' });
    const dir = await seedLegacy(platform, broken);

    await expect(createLibrary(platform).restore()).rejects.toThrow(/旧数据库迁移失败/);
    expect(await platform.fs.exists(databasePathOf(platform, dir))).toBe(false);
    expect(await platform.fs.exists(platform.paths.join(dir, `${LAYOUT.database}.migrating`))).toBe(false);
    expect(await platform.fs.exists(platform.paths.join(dir, LAYOUT.manifest))).toBe(true);
    expect(await platform.fs.exists(platform.paths.join(dir, LAYOUT.legacyDir))).toBe(false);
  });
});
