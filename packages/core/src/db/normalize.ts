import type { RawDatabase } from '@tpr/schema';
import { articleMd } from './layout.js';

export interface NormalizedDatabase {
  /** 归一化后的库：所有 `content` 都是 `{ file }` 形态 */
  db: RawDatabase;
  /** 需要落盘的正文（id → markdown） */
  markdown: Map<string, string>;
}

/**
 * 导入兼容（design §6.3）：旧包可能直接把正文写成字符串。
 * 这里把它抽出来、换成 `{ file: 'articles/{id}.md' }`，并交给调用方落盘。
 */
export function normalizeDatabase(raw: RawDatabase): NormalizedDatabase {
  const markdown = new Map<string, string>();
  const articles = raw.articles.map((article) => {
    if (typeof article.content === 'string') {
      markdown.set(article.id, article.content);
      return { ...article, content: { file: articleMd(article.id) } };
    }
    return article;
  });
  return { db: { ...raw, articles }, markdown };
}

/** `counts` 永远由实体数量推导，不接受手写（design §7.6 B7）。 */
export function computeCounts(db: Pick<RawDatabase, 'authors' | 'tags' | 'articles' | 'series' | 'images' | 'featured' | 'credits'>): Record<string, number> {
  return {
    authors: db.authors.length,
    tags: db.tags.length,
    articles: db.articles.length,
    series: db.series.length,
    images: db.images.length,
    featured: db.featured.length,
    credits: db.credits.length,
  };
}
