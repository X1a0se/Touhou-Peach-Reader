/**
 * 编辑器（Goal 9）：所有写操作都走 `library.applyEdit`，先克隆草稿、校验、再整体落盘。
 * 图片二进制单独写文件，元数据进入 `images.json`。
 */
import type { Platform } from '@tpr/platform';
import {
  type Author,
  type CreditsEntry,
  type ImageAsset,
  type ImageKind,
  type Recommendation,
  type Series,
  type Tag,
  type TagCategory,
  authorIdFor,
  newArticleId,
  newImageId,
  newSeriesId,
  normalizeName,
  tagIdFor,
} from '@tpr/schema';
import type { Library } from '../db/library.js';

export interface ArticleDraft {
  id?: string;
  type: 'short' | 'series-entry';
  title: string;
  summary: string;
  /** 不传表示保留现有正文（编辑元数据时不必重写正文） */
  content?: string;
  authorIds: string[];
  translatorIds: string[];
  characterTagIds: string[];
  plotTagIds: string[];
  seriesId?: string | null;
  coverImageId?: string | null;
  illustrationImageIds: string[];
  sourceUrl?: string | null;
}

export interface SeriesDraft {
  id?: string;
  title: string;
  summary: string;
  status: 'ongoing' | 'completed';
  articleIds: string[];
  authorIds: string[];
  translatorIds: string[];
  characterTagIds: string[];
  plotTagIds: string[];
  coverImageId?: string | null;
  sourceUrl?: string | null;
}

export interface AuthorDraft {
  id?: string;
  canonicalName: string;
  aliases: string[];
  notes?: string;
  sourceUrl?: string;
}

export interface TagDraft {
  id?: string;
  category: TagCategory;
  name: string;
  aliases?: string[];
}

export interface ImageDraft {
  id?: string;
  bytes: Uint8Array;
  /** 不带点，例如 png / jpg / webp */
  ext: string;
  kind: ImageKind;
  caption?: string;
}

export interface Editor {
  saveArticle(draft: ArticleDraft): Promise<string>;
  deleteArticle(id: string): Promise<void>;
  saveSeries(draft: SeriesDraft): Promise<string>;
  deleteSeries(id: string): Promise<void>;
  saveAuthor(draft: AuthorDraft): Promise<string>;
  deleteAuthor(id: string): Promise<void>;
  saveTag(draft: TagDraft): Promise<string>;
  deleteTag(id: string): Promise<void>;
  saveImage(draft: ImageDraft): Promise<string>;
  updateImage(id: string, patch: { kind?: ImageKind; caption?: string }): Promise<void>;
  deleteImage(id: string): Promise<void>;
  saveFeatured(targetType: 'article' | 'series', targetId: string, recommendations: Recommendation[]): Promise<void>;
  deleteFeatured(targetType: 'article' | 'series', targetId: string): Promise<void>;
  saveCredits(entries: CreditsEntry[]): Promise<void>;
}

const now = (): string => new Date().toISOString();
const trim = (value: string): string => value.trim();
const clean = (items: string[] | undefined): string[] => [...new Set((items ?? []).map(trim).filter(Boolean))];

function requireTitle(title: string, label: string): string {
  const value = trim(title);
  if (!value) throw new Error(`${label}标题不能为空`);
  return value;
}

export function createEditor(platform: Platform, library: Library): Editor {
  const current = (): NonNullable<ReturnType<Library['current']>> => {
    const loaded = library.current();
    if (!loaded) throw new Error('尚未打开数据库，无法编辑');
    return loaded;
  };

  return {
    async saveArticle(draft) {
      const title = requireTitle(draft.title, '文章');
      const id = draft.id ?? newArticleId();
      const targetSeriesId = draft.seriesId ?? '';
      // 类型由系列决定（design §13.3）：要么在某个系列里，要么是短篇。
      if (draft.type === 'series-entry' && !targetSeriesId) {
        throw new Error('系列条目必须放在一个系列里');
      }
      if (draft.content !== undefined) await library.saveContent(id, draft.content);

      await library.applyEdit((db) => {
        const existing = db.articles.find((article) => article.id === id);
        const next = {
          id,
          type: targetSeriesId ? ('series-entry' as const) : ('short' as const),
          title,
          content: existing?.content ?? { file: `articles/${id}.md` },
          summary: trim(draft.summary),
          authorIds: clean(draft.authorIds),
          translatorIds: clean(draft.translatorIds),
          characterTagIds: clean(draft.characterTagIds),
          plotTagIds: clean(draft.plotTagIds),
          ...(targetSeriesId ? { seriesId: targetSeriesId } : {}),
          ...(draft.coverImageId ? { coverImageId: draft.coverImageId } : {}),
          illustrationImageIds: clean(draft.illustrationImageIds),
          ...(draft.sourceUrl?.trim() ? { sourceUrl: draft.sourceUrl.trim() } : {}),
          createdAt: existing?.createdAt ?? now(),
          updatedAt: now(),
        } satisfies (typeof db.articles)[number];
        if (existing) {
          Object.assign(existing, next);
          // 清空系列时必须删掉旧 seriesId，否则 Object.assign 会把它留下
          if (!targetSeriesId) delete existing.seriesId;
        } else {
          db.articles.push(next);
        }

        // 从属双向自洽：目标系列把文章追加到目录末尾；其它系列把文章移出。
        for (const series of db.series) {
          const listed = series.articleIds.includes(id);
          if (series.id === targetSeriesId) {
            // 已在目录里就保持原位置，避免改标题时把顺序打乱
            if (!listed) {
              series.articleIds = [...series.articleIds, id];
              series.updatedAt = now();
            }
          } else if (listed) {
            series.articleIds = series.articleIds.filter((articleId) => articleId !== id);
            series.updatedAt = now();
          }
        }
      });
      return id;
    },

    async deleteArticle(id) {
      await library.applyEdit((db) => {
        db.articles = db.articles.filter((article) => article.id !== id);
        for (const series of db.series) series.articleIds = series.articleIds.filter((articleId) => articleId !== id);
        db.featured = db.featured.filter((entry) => !(entry.targetType === 'article' && entry.targetId === id));
      });
    },

    async saveSeries(draft) {
      const title = requireTitle(draft.title, '系列');
      const id = draft.id ?? newSeriesId();
      await library.applyEdit((db) => {
        const existing = db.series.find((series) => series.id === id);
        const articleIds = clean(draft.articleIds);
        const next = {
          id,
          title,
          summary: trim(draft.summary),
          status: draft.status,
          articleIds,
          authorIds: clean(draft.authorIds),
          translatorIds: clean(draft.translatorIds),
          characterTagIds: clean(draft.characterTagIds),
          plotTagIds: clean(draft.plotTagIds),
          ...(draft.coverImageId ? { coverImageId: draft.coverImageId } : {}),
          ...(draft.sourceUrl?.trim() ? { sourceUrl: draft.sourceUrl.trim() } : {}),
          createdAt: existing?.createdAt ?? now(),
          updatedAt: now(),
        } satisfies Series;
        if (existing) Object.assign(existing, next);
        else db.series.push(next);

        // 文章的 seriesId 必须与系列 articleIds 双向一致
        for (const article of db.articles) {
          if (article.id === id) continue;
          if (articleIds.includes(article.id)) {
            article.type = 'series-entry';
            article.seriesId = id;
            article.updatedAt = now();
          } else if (article.seriesId === id) {
            article.type = 'short';
            delete article.seriesId;
            article.updatedAt = now();
          }
        }
      });
      return id;
    },

    async deleteSeries(id) {
      await library.applyEdit((db) => {
        db.series = db.series.filter((series) => series.id !== id);
        for (const article of db.articles) {
          if (article.seriesId === id) {
            article.type = 'short';
            delete article.seriesId;
            article.updatedAt = now();
          }
        }
        db.featured = db.featured.filter((entry) => !(entry.targetType === 'series' && entry.targetId === id));
      });
    },

    async saveAuthor(draft) {
      const canonicalName = trim(draft.canonicalName);
      if (!canonicalName) throw new Error('作者名不能为空');
      const aliases = clean(draft.aliases).filter((alias) => normalizeName(alias) !== normalizeName(canonicalName));

      let id = draft.id ?? '';
      if (!id) {
        // 别名已存在时复用原作者，不新建（/goal 9 明确要求）
        const key = normalizeName(canonicalName);
        const found = library
          .snapshot()
          ?.authors.find(
            (author) =>
              normalizeName(author.canonicalName) === key || author.aliases.some((alias) => normalizeName(alias) === key),
          );
        id = found?.id ?? (await authorIdFor(canonicalName));
      }

      await library.applyEdit((db) => {
        const existing = db.authors.find((author) => author.id === id);
        const next: Author = {
          id,
          canonicalName,
          aliases,
          ...(draft.notes?.trim() ? { notes: draft.notes.trim() } : {}),
          ...(draft.sourceUrl?.trim() ? { sourceUrl: draft.sourceUrl.trim() } : {}),
        };
        if (existing) Object.assign(existing, next);
        else db.authors.push(next);
      });
      return id;
    },

    async deleteAuthor(id) {
      await library.applyEdit((db) => {
        db.authors = db.authors.filter((author) => author.id !== id);
        for (const article of db.articles) {
          article.authorIds = article.authorIds.filter((authorId) => authorId !== id);
          article.translatorIds = article.translatorIds.filter((authorId) => authorId !== id);
        }
        for (const series of db.series) {
          series.authorIds = series.authorIds.filter((authorId) => authorId !== id);
        }
      });
    },

    async saveTag(draft) {
      const name = trim(draft.name);
      if (!name) throw new Error('标签名不能为空');
      let id = draft.id ?? '';
      if (!id) {
        const key = normalizeName(name);
        const found = library
          .snapshot()
          ?.tags.find(
            (tag) =>
              tag.category === draft.category &&
              (normalizeName(tag.name) === key || (tag.aliases ?? []).some((alias) => normalizeName(alias) === key)),
          );
        id = found?.id ?? (await tagIdFor(draft.category, name));
      }
      await library.applyEdit((db) => {
        const existing = db.tags.find((tag) => tag.id === id);
        const next: Tag = {
          id,
          category: draft.category,
          name,
          ...(clean(draft.aliases).length > 0 ? { aliases: clean(draft.aliases) } : {}),
        };
        if (existing) Object.assign(existing, next);
        else db.tags.push(next);
      });
      return id;
    },

    async deleteTag(id) {
      await library.applyEdit((db) => {
        db.tags = db.tags.filter((tag) => tag.id !== id);
        for (const article of db.articles) {
          article.characterTagIds = article.characterTagIds.filter((tagId) => tagId !== id);
          article.plotTagIds = article.plotTagIds.filter((tagId) => tagId !== id);
        }
        for (const series of db.series) {
          series.characterTagIds = series.characterTagIds.filter((tagId) => tagId !== id);
          series.plotTagIds = series.plotTagIds.filter((tagId) => tagId !== id);
        }
      });
    },

    async saveImage(draft) {
      const id = draft.id ?? newImageId();
      const ext = draft.ext.replace(/^\./, '').toLowerCase();
      if (!/^[a-z0-9]+$/.test(ext)) throw new Error('图片扩展名不合法');
      const loaded = current();
      const file = `images/${draft.kind}/${id}.${ext}`;
      const absolute = platform.paths.join(loaded.dir, file);
      await platform.fs.mkdir(platform.paths.dirname(absolute));
      await platform.fs.writeBytes(absolute, draft.bytes);

      await library.applyEdit((db) => {
        const existing = db.images.find((image) => image.id === id);
        const next: ImageAsset = {
          id,
          file,
          kind: draft.kind,
          ...(draft.caption?.trim() ? { caption: draft.caption.trim() } : {}),
        };
        if (existing) Object.assign(existing, next);
        else db.images.push(next);
      });
      return id;
    },

    async updateImage(id, patch) {
      const loaded = current();
      const existing = library.snapshot()?.images.find((image) => image.id === id);
      if (!existing) throw new Error(`图片 ${id} 不存在`);
      let file = existing.file;
      if (patch.kind && patch.kind !== existing.kind) {
        const ext = existing.file.split('.').pop() ?? 'bin';
        file = `images/${patch.kind}/${id}.${ext}`;
        const from = platform.paths.join(loaded.dir, existing.file);
        const to = platform.paths.join(loaded.dir, file);
        await platform.fs.mkdir(platform.paths.dirname(to));
        await platform.fs.copy(from, to);
        await platform.fs.remove(from);
      }
      await library.applyEdit((db) => {
        const image = db.images.find((item) => item.id === id);
        if (!image) return;
        image.file = file;
        if (patch.kind) image.kind = patch.kind;
        if (patch.caption !== undefined) {
          if (patch.caption.trim()) image.caption = patch.caption.trim();
          else delete image.caption;
        }
      });
    },

    async deleteImage(id) {
      const loaded = current();
      const existing = library.snapshot()?.images.find((image) => image.id === id);
      await library.applyEdit((db) => {
        db.images = db.images.filter((image) => image.id !== id);
        for (const article of db.articles) {
          if (article.coverImageId === id) delete article.coverImageId;
          article.illustrationImageIds = (article.illustrationImageIds ?? []).filter((imageId) => imageId !== id);
        }
        for (const series of db.series) {
          if (series.coverImageId === id) delete series.coverImageId;
        }
      });
      if (existing) {
        const absolute = platform.paths.join(loaded.dir, existing.file);
        if (await platform.fs.exists(absolute)) await platform.fs.remove(absolute);
      }
    },

    async saveFeatured(targetType, targetId, recommendations) {
      await library.applyEdit((db) => {
        const entry = db.featured.find((item) => item.targetType === targetType && item.targetId === targetId);
        if (entry) entry.recommendations = recommendations;
        else db.featured.push({ targetType, targetId, recommendations });
      });
    },

    async deleteFeatured(targetType, targetId) {
      await library.applyEdit((db) => {
        db.featured = db.featured.filter(
          (entry) => !(entry.targetType === targetType && entry.targetId === targetId),
        );
      });
    },

    async saveCredits(entries) {
      await library.applyEdit((db) => {
        db.credits = entries;
      });
    },
  };
}

export type { TagCategory };
