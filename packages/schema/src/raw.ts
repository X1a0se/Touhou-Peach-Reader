import { z } from 'zod';
import {
  articleFileSchema,
  authorSchema,
  creditsEntrySchema,
  featuredEntrySchema,
  imageAssetSchema,
  manifestSchema,
  seriesSchema,
  tagSchema,
  type ArticleFile,
  type Author,
  type CreditsEntry,
  type FeaturedEntry,
  type ImageAsset,
  type Manifest,
  type Series,
  type Tag,
} from './entities.js';

/**
 * 磁盘 / 包格式的整库结构（裸数组，见 design §7.2）。
 * `filePaths` 不进 JSON：它是导入器扫描到的包内文件路径集合，用于引用校验。
 */
export const rawDatabaseSchema = z.object({
  manifest: manifestSchema,
  authors: z.array(authorSchema),
  tags: z.array(tagSchema),
  images: z.array(imageAssetSchema),
  articles: z.array(articleFileSchema),
  series: z.array(seriesSchema),
  featured: z.array(featuredEntrySchema),
  credits: z.array(creditsEntrySchema),
});

export interface RawDatabase {
  manifest: Manifest;
  authors: Author[];
  tags: Tag[];
  images: ImageAsset[];
  articles: ArticleFile[];
  series: Series[];
  featured: FeaturedEntry[];
  credits: CreditsEntry[];
  /** 包内实际存在的相对路径（含 `articles/*.md` 与 `images/*`）；缺省时跳过文件级校验 */
  filePaths?: ReadonlySet<string>;
}

export function parseRawDatabase(input: unknown): RawDatabase {
  return rawDatabaseSchema.parse(input) as RawDatabase;
}

export function emptyRawDatabase(over: Partial<Manifest> = {}): RawDatabase {
  return {
    manifest: {
      schemaVersion: 1,
      databaseId: 'db_000000000000',
      name: '空数据库',
      version: '0.0.0',
      updatedAt: '2026-01-01T00:00:00.000Z',
      counts: {},
      ...over,
    },
    authors: [],
    tags: [],
    images: [],
    articles: [],
    series: [],
    featured: [],
    credits: [],
  };
}
