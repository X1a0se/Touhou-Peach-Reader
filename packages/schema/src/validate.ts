import type { RawDatabase } from './raw.js';
import { normalizeName } from './ids.js';

/**
 * 语义校验（design §6.5）。
 * zod 负责"形状/类型"，这里负责"引用与一致性"。error 阻断导入，warning 只提示。
 */

export type IssueSeverity = 'error' | 'warning';
export type IssueEntity =
  | 'manifest'
  | 'author'
  | 'tag'
  | 'article'
  | 'series'
  | 'image'
  | 'featured'
  | 'credits';

export interface Issue {
  code: string;
  severity: IssueSeverity;
  entity: IssueEntity;
  entityId?: string;
  field?: string;
  message: string;
  hint?: string;
}

export interface ValidateResult {
  ok: boolean;
  errors: Issue[];
  warnings: Issue[];
}

type Extra = { entityId?: string; field?: string; hint?: string };

const err = (code: string, entity: IssueEntity, message: string, extra: Extra = {}): Issue => ({
  code,
  severity: 'error',
  entity,
  message,
  ...extra,
});

const warn = (code: string, entity: IssueEntity, message: string, extra: Extra = {}): Issue => ({
  code,
  severity: 'warning',
  entity,
  message,
  ...extra,
});

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function duplicatesOf(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) dup.add(id);
    seen.add(id);
  }
  return [...dup];
}

const contentFileFor = (id: string): string => `articles/${id}.md`;

export function validateDatabase(db: RawDatabase): ValidateResult {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];

  const authors = new Map(db.authors.map((a) => [a.id, a]));
  const tags = new Map(db.tags.map((t) => [t.id, t]));
  const articles = new Map(db.articles.map((a) => [a.id, a]));
  const series = new Map(db.series.map((s) => [s.id, s]));
  const images = new Map(db.images.map((i) => [i.id, i]));

  // ---- 重复 id ----
  const collections: Array<[IssueEntity, string[]]> = [
    ['author', db.authors.map((a) => a.id)],
    ['tag', db.tags.map((t) => t.id)],
    ['article', db.articles.map((a) => a.id)],
    ['series', db.series.map((s) => s.id)],
    ['image', db.images.map((i) => i.id)],
  ];
  for (const [entity, ids] of collections) {
    for (const id of duplicatesOf(ids)) {
      errors.push(
        err('E_DUPLICATE_ID', entity, `id「${id}」在本集合中重复出现`, {
          entityId: id,
          hint: '每个实体的 id 必须唯一；请检查是否有复制粘贴导致的重复条目。',
        }),
      );
    }
  }

  // ---- 确定性 id 碰撞（不同名字算出同一 id）----
  const authorNamesById = new Map<string, string>();
  for (const a of db.authors) {
    const name = normalizeName(a.canonicalName);
    const prev = authorNamesById.get(a.id);
    if (prev !== undefined && prev !== name) {
      errors.push(
        err(
          'E_ID_COLLISION',
          'author',
          `作者 id「${a.id}」被两个不同的名称占用（「${prev}」与「${name}」）`,
          { entityId: a.id, hint: '请手工修改其中一个作者的 id。' },
        ),
      );
    }
    authorNamesById.set(a.id, name);
  }

  // ---- 图片文件 ----
  for (const img of db.images) {
    if (db.filePaths && !db.filePaths.has(img.file)) {
      errors.push(
        err('E_IMAGE_FILE_MISSING', 'image', `图片文件「${img.file}」在包内不存在`, {
          entityId: img.id,
          field: 'file',
        }),
      );
    }
  }

  // ---- 文章 ----
  const referencedImages = new Set<string>();
  for (const a of db.articles) {
    if (a.type === 'series-entry' && !a.seriesId) {
      errors.push(
        err('E_SERIES_TYPE_MISMATCH', 'article', `文章「${a.title}」标记为系列内文章，但缺少 seriesId`, {
          entityId: a.id,
          field: 'seriesId',
        }),
      );
    }
    if (a.type === 'short' && a.seriesId) {
      errors.push(
        err('E_SERIES_TYPE_MISMATCH', 'article', `文章「${a.title}」标记为短篇，却带有 seriesId`, {
          entityId: a.id,
          field: 'seriesId',
        }),
      );
    }

    if (typeof a.content === 'object' && a.content !== null) {
      const expected = contentFileFor(a.id);
      if (a.content.file !== expected) {
        errors.push(
          err(
            'E_INVALID_CONTENT_FILE',
            'article',
            `正文文件路径必须是「${expected}」，实际为「${a.content.file}」`,
            { entityId: a.id, field: 'content.file' },
          ),
        );
      }
      if (db.filePaths && !db.filePaths.has(a.content.file)) {
        errors.push(
          err('E_CONTENT_MISSING', 'article', `正文文件「${a.content.file}」在包内不存在`, {
            entityId: a.id,
            field: 'content.file',
          }),
        );
      }
    }

    for (const id of a.authorIds) {
      if (!authors.has(id)) {
        warnings.push(
          warn('W_DANGLING_AUTHOR', 'article', `作者引用「${id}」不存在`, {
            entityId: a.id,
            field: 'authorIds',
          }),
        );
      }
    }
    for (const id of a.translatorIds) {
      if (!authors.has(id)) {
        warnings.push(
          warn('W_DANGLING_AUTHOR', 'article', `译者引用「${id}」不存在`, {
            entityId: a.id,
            field: 'translatorIds',
          }),
        );
      }
    }
    for (const [field, ids] of [
      ['characterTagIds', a.characterTagIds],
      ['plotTagIds', a.plotTagIds],
    ] as const) {
      for (const id of ids) {
        if (!tags.has(id)) {
          warnings.push(
            warn('W_DANGLING_TAG', 'article', `标签引用「${id}」不存在`, {
              entityId: a.id,
              field,
            }),
          );
        }
      }
    }
    if (a.coverImageId) referencedImages.add(a.coverImageId);
    for (const id of a.illustrationImageIds ?? []) referencedImages.add(id);

    if (a.seriesId && !series.has(a.seriesId)) {
      warnings.push(
        warn('W_DANGLING_SERIES', 'article', `所属系列「${a.seriesId}」不存在`, {
          entityId: a.id,
          field: 'seriesId',
          hint: '单篇文章导出包会自然产生此提示，可忽略。',
        }),
      );
    } else if (a.seriesId) {
      // 反向检查：seriesId 指了系列，但系列目录里没有这篇（旧版本编辑器的已知不一致）
      const owner = series.get(a.seriesId);
      if (owner && !owner.articleIds.includes(a.id)) {
        warnings.push(
          warn('W_SERIES_MEMBERSHIP', 'article', `文章标了所属系列「${owner.title}」，但系列目录里没有它`, {
            entityId: a.id,
            field: 'seriesId',
            hint: '在编辑器里重新保存这篇文章（或系列目录）即可修复。',
          }),
        );
      }
    }
  }

  // ---- 系列 ----
  for (const s of db.series) {
    const seen = new Set<string>();
    for (const id of s.articleIds) {
      if (seen.has(id)) {
        errors.push(
          err('E_SERIES_ORDER', 'series', `系列文章列表里「${id}」重复出现`, {
            entityId: s.id,
            field: 'articleIds',
          }),
        );
      }
      seen.add(id);
      const article = articles.get(id);
      if (!article) {
        errors.push(
          err('E_SERIES_ORDER', 'series', `系列文章列表引用了不存在的文章「${id}」`, {
            entityId: s.id,
            field: 'articleIds',
          }),
        );
        continue;
      }
      if (article.seriesId !== s.id) {
        errors.push(
          err('E_SERIES_ORDER', 'series', `文章「${article.title}」的 seriesId 与所在系列不一致`, {
            entityId: s.id,
            field: 'articleIds',
          }),
        );
      }
    }
    for (const id of s.authorIds) {
      if (!authors.has(id)) {
        warnings.push(
          warn('W_DANGLING_AUTHOR', 'series', `作者引用「${id}」不存在`, {
            entityId: s.id,
            field: 'authorIds',
          }),
        );
      }
    }
    if (s.coverImageId) referencedImages.add(s.coverImageId);
  }

  // ---- 一篇文章只能属于一个系列 ----
  const membership = new Map<string, string[]>();
  for (const s of db.series) {
    for (const id of s.articleIds) {
      membership.set(id, [...(membership.get(id) ?? []), s.id]);
    }
  }
  for (const [articleId, seriesIds] of membership) {
    if (seriesIds.length > 1) {
      errors.push(
        err('E_ARTICLE_IN_MULTIPLE_SERIES', 'article', `文章「${articleId}」同时出现在多个系列中`, {
          entityId: articleId,
          hint: `涉及的系列：${seriesIds.join('、')}`,
        }),
      );
    }
  }

  // ---- 图片引用 ----
  for (const id of referencedImages) {
    if (!images.has(id)) {
      warnings.push(warn('W_DANGLING_IMAGE', 'image', `图片引用「${id}」不存在`, { entityId: id }));
    }
  }

  // ---- 精选 ----
  for (const f of db.featured) {
    const exists = f.targetType === 'article' ? articles.has(f.targetId) : series.has(f.targetId);
    if (!exists) {
      warnings.push(
        warn(
          'W_DANGLING_FEATURED',
          'featured',
          `精选条目指向的${f.targetType === 'article' ? '文章' : '系列'}「${f.targetId}」不存在`,
          { entityId: f.targetId, hint: '前端会降级显示「条目已失效」。' },
        ),
      );
    }
    if (f.recommendations.length === 0) {
      warnings.push(
        warn('W_EMPTY_RECOMMENDATIONS', 'featured', '精选条目没有任何推荐语', {
          entityId: f.targetId,
        }),
      );
    }
  }

  // ---- 计数 ----
  const actual: Record<string, number> = {
    authors: db.authors.length,
    tags: db.tags.length,
    articles: db.articles.length,
    series: db.series.length,
    images: db.images.length,
    featured: db.featured.length,
    credits: db.credits.length,
  };
  for (const [key, value] of Object.entries(actual)) {
    const declared = db.manifest.counts[key];
    if (declared !== undefined && declared !== value) {
      warnings.push(
        warn(
          'W_COUNT_MISMATCH',
          'manifest',
          `manifest.counts.${key} 声明 ${declared}，实际 ${value}`,
          { field: `counts.${key}` },
        ),
      );
    }
  }

  // ---- 疑似重复名称 ----
  const byAuthorName = new Map<string, string[]>();
  for (const a of db.authors) {
    const key = normalizeName(a.canonicalName);
    byAuthorName.set(key, [...(byAuthorName.get(key) ?? []), a.id]);
  }
  for (const [name, ids] of byAuthorName) {
    if (ids.length > 1) {
      warnings.push(
        warn('W_DUPLICATE_NAME', 'author', `作者「${name}」有 ${ids.length} 个不同 id，疑似重复`, {
          hint: `可在合并/编辑器里合并：${ids.join('、')}`,
        }),
      );
    }
  }

  const byTagName = new Map<string, string[]>();
  for (const t of db.tags) {
    const key = `${t.category}\u0000${normalizeName(t.name)}`;
    byTagName.set(key, [...(byTagName.get(key) ?? []), t.id]);
  }
  for (const [key, ids] of byTagName) {
    if (ids.length > 1) {
      const name = key.split('\u0000')[1] ?? key;
      warnings.push(
        warn('W_DUPLICATE_NAME', 'tag', `标签「${name}」有 ${ids.length} 个不同 id，疑似重复`, {
          hint: `可在合并/编辑器里合并：${ids.join('、')}`,
        }),
      );
    }
  }

  // ---- URL 协议（只提示，不阻断）----
  const checkUrl = (entity: IssueEntity, entityId: string | undefined, field: string, value: string | undefined): void => {
    if (value === undefined) return;
    if (isHttpUrl(value)) return;
    warnings.push(
      warn('W_URL_SCHEME', entity, `链接不是 http(s)，将无法直接打开：「${value}」`, {
        ...(entityId === undefined ? {} : { entityId }),
        field,
      }),
    );
  };
  checkUrl('manifest', undefined, 'sourceUrl', db.manifest.sourceUrl);
  for (const a of db.authors) checkUrl('author', a.id, 'sourceUrl', a.sourceUrl);
  for (const a of db.articles) checkUrl('article', a.id, 'sourceUrl', a.sourceUrl);
  for (const s of db.series) checkUrl('series', s.id, 'sourceUrl', s.sourceUrl);
  for (const c of db.credits) checkUrl('credits', c.name, 'link', c.link);

  return { ok: errors.length === 0, errors, warnings };
}

/** 导入前丢弃虚拟标签（`v:` 前缀），返回被丢弃的条目 */
export function stripVirtualTags<T extends { id: string }>(items: T[]): { kept: T[]; dropped: T[] } {
  const kept: T[] = [];
  const dropped: T[] = [];
  for (const item of items) {
    if (item.id.startsWith('v:')) dropped.push(item);
    else kept.push(item);
  }
  return { kept, dropped };
}
