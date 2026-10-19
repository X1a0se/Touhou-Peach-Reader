import { PlatformError } from '@tpr/platform';
import type { ArticleFile } from '@tpr/schema';
import { articleMd, type DbIo } from './layout.js';

export interface ContentStore {
  read(articleId: string): Promise<string>;
  write(articleId: string, markdown: string): Promise<void>;
  invalidate(articleId: string): void;
}

/** 正文按需读取 + 小 LRU（design §6.3：最多 32 篇常驻）。 */
export function createContentStore(io: DbIo, root: string, capacity = 32): ContentStore {
  const cache = new Map<string, string>();

  return {
    async read(articleId: string): Promise<string> {
      const hit = cache.get(articleId);
      if (hit !== undefined) {
        cache.delete(articleId);
        cache.set(articleId, hit);
        return hit;
      }
      const path = io.join(root, articleMd(articleId));
      if (!(await io.fs.exists(path))) {
        throw new PlatformError('ENOENT', `正文文件缺失：articles/${articleId}.md`);
      }
      const text = await io.fs.readText(path);
      cache.set(articleId, text);
      if (cache.size > capacity) {
        const oldest = cache.keys().next();
        if (!oldest.done) cache.delete(oldest.value);
      }
      return text;
    },

    async write(articleId: string, markdown: string): Promise<void> {
      const path = io.join(root, articleMd(articleId));
      const tmp = `${path}.tmp`;
      await io.fs.writeText(tmp, markdown);
      await io.fs.rename(tmp, path);
      cache.delete(articleId);
      cache.set(articleId, markdown);
    },

    invalidate(articleId: string): void {
      cache.delete(articleId);
    },
  };
}

/** 正文的规范化落点（相对路径），供 editor 与 exporter 共用。 */
export function contentFileOf(article: ArticleFile): string {
  return typeof article.content === 'string' ? articleMd(article.id) : article.content.file;
}
