import { PlatformError, type Platform } from '@tpr/platform';
import type { ArticleFile } from '@tpr/schema';
import { articleMd } from './layout.js';
import { rowText } from './sql/codec.js';

export interface ContentStore {
  read(articleId: string): Promise<string>;
  write(articleId: string, markdown: string): Promise<void>;
  has(articleId: string): Promise<boolean>;
  invalidate(articleId: string): void;
}

const SELECT_CONTENT = 'SELECT markdown FROM article_contents WHERE article_id = ?';
const UPSERT_CONTENT =
  'INSERT INTO article_contents(article_id,markdown) VALUES (?,?) ' +
  'ON CONFLICT(article_id) DO UPDATE SET markdown=excluded.markdown';

/** 正文按需读取 + 小 LRU（design §6.3：最多 32 篇常驻）。 */
export function createContentStore(platform: Platform, dbPath: string, capacity = 32): ContentStore {
  const cache = new Map<string, string>();

  return {
    async read(articleId: string): Promise<string> {
      const hit = cache.get(articleId);
      if (hit !== undefined) {
        cache.delete(articleId);
        cache.set(articleId, hit);
        return hit;
      }
      const rows = await platform.sql.query(dbPath, SELECT_CONTENT, [articleId]);
      const row = rows[0];
      if (!row) throw new PlatformError('ENOENT', `正文缺失：${articleId}`);
      const text = rowText(row, 'markdown');
      cache.set(articleId, text);
      if (cache.size > capacity) {
        const oldest = cache.keys().next();
        if (!oldest.done) cache.delete(oldest.value);
      }
      return text;
    },

    async write(articleId: string, markdown: string): Promise<void> {
      await platform.sql.batch(dbPath, [{ sql: UPSERT_CONTENT, params: [articleId, markdown] }]);
      cache.delete(articleId);
      cache.set(articleId, markdown);
      if (cache.size > capacity) {
        const oldest = cache.keys().next();
        if (!oldest.done) cache.delete(oldest.value);
      }
    },

    async has(articleId: string): Promise<boolean> {
      const rows = await platform.sql.query(dbPath, 'SELECT 1 AS present FROM article_contents WHERE article_id = ?', [
        articleId,
      ]);
      return rows.length > 0;
    },

    invalidate(articleId: string): void {
      cache.delete(articleId);
    },
  };
}

/** 正文的规范化落点（相对路径），供 .tpr 导出/旧文件迁移共用。 */
export function contentFileOf(article: ArticleFile): string {
  return typeof article.content === 'string' ? articleMd(article.id) : article.content.file;
}
