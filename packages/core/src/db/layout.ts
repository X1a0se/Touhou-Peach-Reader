import type { IFileSystem } from '@tpr/platform';

/** 读写数据库目录所需的最小依赖：文件系统 + 路径拼接（Windows 用反斜杠）。 */
export interface DbIo {
  readonly fs: IFileSystem;
  join(...parts: string[]): string;
}

export const LAYOUT = {
  manifest: 'manifest.json',
  authors: 'authors.json',
  tags: 'tags.json',
  images: 'images.json',
  featured: 'featured.json',
  credits: 'credits.json',
  articlesDir: 'articles',
  seriesDir: 'series',
  imagesDir: 'images',
} as const;

export const articleJson = (id: string): string => `${LAYOUT.articlesDir}/${id}.json`;
export const articleMd = (id: string): string => `${LAYOUT.articlesDir}/${id}.md`;
export const seriesJson = (id: string): string => `${LAYOUT.seriesDir}/${id}.json`;
export const imageFile = (kind: string, id: string, file: string): string =>
  `${LAYOUT.imagesDir}/${kind}/${file}`;

/** 导出时最后写入的条目：manifest.json 最后进包，半途失败即为可识别的不完整包。 */
export const MANIFEST_LAST = ['manifest.json'] as const;
