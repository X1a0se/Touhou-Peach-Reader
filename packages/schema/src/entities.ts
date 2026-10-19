import { z } from 'zod';

/**
 * 全部实体定义。字段顺序与 `/plan` 三、数据模型一致，也是 JSON 序列化顺序。
 * 单一来源：zod schema 即类型（`z.infer`），避免"类型与校验两份定义"漂移。
 */

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
/** 确定性 ID：作者 / 标签（sha256 前 12 位十六进制） */
export const ID_DETERMINISTIC = /^[pt]_[0-9a-f]{12}$/;
/** 随机 ID：文章 / 系列 / 图片（nanoid 16 位） */
export const ID_RANDOM = /^[asi]_[A-Za-z0-9]{16}$/;

const iso = z.string().regex(ISO_DATE, '必须是 ISO 8601 毫秒精度 UTC 时间，如 2026-01-02T03:04:05.000Z');
/**
 * URL 只做长度约束；协议是否为 http(s) 交给语义校验（W_URL_SCHEME）提示。
 * 理由：第三方包里的 ftp://、缺协议链接不应让整包导入直接失败。
 */
const urlText = z.string().max(2000);

const authorId = z.string().regex(ID_DETERMINISTIC, '作者 id 必须是 p_ + 12 位十六进制');
const tagId = z.string().regex(ID_DETERMINISTIC, '标签 id 必须是 t_ + 12 位十六进制');
const articleId = z.string().regex(ID_RANDOM, '文章 id 必须是 a_ + 16 位');
const seriesId = z.string().regex(ID_RANDOM, '系列 id 必须是 s_ + 16 位');
const imageId = z.string().regex(ID_RANDOM, '图片 id 必须是 i_ + 16 位');

/** —— 数据库包 manifest —— */
export const manifestSchema = z.object({
  schemaVersion: z.number().int().positive(),
  databaseId: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  version: z.string().min(1).max(64),
  updatedAt: iso,
  sourceUrl: urlText.optional(),
  description: z.string().max(4000).optional(),
  counts: z.record(z.string(), z.number().int().nonnegative()).default({}),
});

/** —— 作者（支持多别名）—— */
export const authorSchema = z.object({
  id: authorId,
  canonicalName: z.string().min(1).max(200),
  aliases: z.array(z.string().min(1).max(200)).default([]),
  notes: z.string().max(4000).optional(),
  sourceUrl: urlText.optional(),
});

/** —— 标签（角色 / 情节 / 系列 / 通用）—— */
export const tagCategorySchema = z.enum(['character', 'plot', 'series', 'general']);
export const tagSchema = z.object({
  id: tagId,
  category: tagCategorySchema,
  name: z.string().min(1).max(200),
  aliases: z.array(z.string().min(1).max(200)).optional(),
});

/** —— 图片（封面 / 插图 / 配文图）—— */
export const imageKindSchema = z.enum(['cover', 'illustration', 'captioned', 'other']);
export const imageAssetSchema = z.object({
  id: imageId,
  file: z.string().min(1).max(400),
  caption: z.string().max(2000).optional(),
  kind: imageKindSchema,
});

/** —— 文章（短篇 或 系列中的一篇）—— */
export const articleTypeSchema = z.enum(['short', 'series-entry']);
export const articleFileSchema = z.object({
  id: articleId,
  type: articleTypeSchema,
  title: z.string().min(1).max(300),
  summary: z.string().max(4000),
  /** 导入时两种都收；落盘一律 { file }（见 design §6.3） */
  content: z.union([z.string(), z.object({ file: z.string().min(1).max(400) })]),
  authorIds: z.array(authorId).default([]),
  translatorIds: z.array(authorId).default([]),
  characterTagIds: z.array(tagId).default([]),
  plotTagIds: z.array(tagId).default([]),
  seriesId: seriesId.optional(),
  coverImageId: imageId.optional(),
  illustrationImageIds: z.array(imageId).optional(),
  sourceUrl: urlText.optional(),
  createdAt: iso,
  updatedAt: iso,
});

/** —— 系列 —— */
export const seriesStatusSchema = z.enum(['ongoing', 'completed']);
export const seriesSchema = z.object({
  id: seriesId,
  title: z.string().min(1).max(300),
  summary: z.string().max(4000),
  status: seriesStatusSchema,
  articleIds: z.array(articleId).default([]),
  authorIds: z.array(authorId).default([]),
  characterTagIds: z.array(tagId).default([]),
  plotTagIds: z.array(tagId).default([]),
  coverImageId: imageId.optional(),
  sourceUrl: urlText.optional(),
  createdAt: iso,
  updatedAt: iso,
});

/** —— 精选推荐（同一篇可有多条推荐语）—— */
export const featuredTargetTypeSchema = z.enum(['article', 'series']);
export const recommendationSchema = z.object({
  author: z.string().max(200).optional(),
  text: z.string().min(1).max(4000),
});
export const featuredEntrySchema = z.object({
  targetType: featuredTargetTypeSchema,
  targetId: z.string().min(1),
  recommendations: z.array(recommendationSchema).default([]),
});

/** —— 特别鸣谢 —— */
export const creditsEntrySchema = z.object({
  name: z.string().min(1).max(200),
  role: z.string().max(200).optional(),
  link: urlText.optional(),
  note: z.string().max(2000).optional(),
});

/** —— 数据类型 —— */
export type Manifest = z.infer<typeof manifestSchema>;
export type Author = z.infer<typeof authorSchema>;
export type TagCategory = z.infer<typeof tagCategorySchema>;
export type Tag = z.infer<typeof tagSchema>;
export type ImageKind = z.infer<typeof imageKindSchema>;
export type ImageAsset = z.infer<typeof imageAssetSchema>;
export type ArticleType = z.infer<typeof articleTypeSchema>;
export type ArticleFile = z.infer<typeof articleFileSchema>;
export type SeriesStatus = z.infer<typeof seriesStatusSchema>;
export type Series = z.infer<typeof seriesSchema>;
export type FeaturedTargetType = z.infer<typeof featuredTargetTypeSchema>;
export type Recommendation = z.infer<typeof recommendationSchema>;
export type FeaturedEntry = z.infer<typeof featuredEntrySchema>;
export type CreditsEntry = z.infer<typeof creditsEntrySchema>;

/** 内存形态：正文被抽到 ContentStore，实体里不再携带 */
export type ArticleMeta = Omit<ArticleFile, 'content'>;

export type Counts = Record<string, number>;
