import { PlatformError, type BlobSource, type Platform, type SqlRow, type SqlStatement } from '@tpr/platform';
import {
  parseRawDatabase,
  type ArticleFile,
  type ArticleType,
  type Author,
  type CreditsEntry,
  type FeaturedEntry,
  type ImageAsset,
  type Manifest,
  type RawDatabase,
  type Series,
  type Tag,
  type TagCategory,
} from '@tpr/schema';
import { articleMd, LAYOUT } from '../layout.js';
import {
  canonicalDatabase,
  mimeOf,
  rowBool,
  rowInt,
  rowNullableText,
  rowText,
  stableStringify,
} from './codec.js';
import { SQL_SCHEMA_STATEMENTS, SQL_SCHEMA_VERSION } from './schema.js';

const INSERT_IMAGE_WITH_DATA =
  'INSERT OR REPLACE INTO images(position,id,file,kind,caption,mime,byte_size,data) VALUES (?,?,?,?,?,?,?,?)';
const INSERT_IMAGE_WITHOUT_DATA =
  'INSERT OR REPLACE INTO images(position,id,file,kind,caption,mime,byte_size,data) VALUES (?,?,?,?,?,?,NULL,NULL)';
const UPSERT_IMAGE =
  'INSERT INTO images(position,id,file,kind,caption,mime,byte_size,data) VALUES (?,?,?,?,?,?,NULL,NULL) ' +
  'ON CONFLICT(id) DO UPDATE SET position=excluded.position, file=excluded.file, kind=excluded.kind, caption=excluded.caption, mime=excluded.mime';

const dbPathOf = (platform: Platform, dir: string): string =>
  platform.paths.join(dir, LAYOUT.database);

export function databasePathOf(platform: Platform, dir: string): string {
  return dbPathOf(platform, dir);
}

/** 按 parent id 分组；调用方已按 (parent, position) 排序。 */
function groupText(rows: readonly { parent: string; value: string }[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const row of rows) {
    const values = out.get(row.parent);
    if (values) values.push(row.value);
    else out.set(row.parent, [row.value]);
  }
  return out;
}

/** 读取 SQLite 元数据（不加载正文和图片 BLOB）。 */
export async function readSqliteFromFile(platform: Platform, dbPath: string): Promise<RawDatabase> {
  let versionRows: SqlRow[];
  try {
    versionRows = await platform.sql.query(dbPath, 'PRAGMA user_version');
  } catch (error) {
    throw new PlatformError('EIO', '无法读取 database.sqlite：' + String(error), error);
  }
  const version = versionRows[0] ? rowInt(versionRows[0], 'user_version') : 0;
  if (version !== SQL_SCHEMA_VERSION) {
    throw new PlatformError('EIO', '不支持的本地数据库版本：' + String(version));
  }

  const manifestRows = await platform.sql.query(
    dbPath,
    'SELECT id, schema_version, database_id, name, version, updated_at, source_url, description, counts_json FROM manifest WHERE id = 1',
  );
  const manifestRow = manifestRows[0];
  if (!manifestRow) throw new PlatformError('EIO', 'database.sqlite 缺少 manifest 行');

  let counts: Record<string, number> = {};
  try {
    const parsed = JSON.parse(rowText(manifestRow, 'counts_json')) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      counts = parsed as Record<string, number>;
    }
  } catch {
    counts = {};
  }
  const sourceUrl = rowNullableText(manifestRow, 'source_url');
  const description = rowNullableText(manifestRow, 'description');
  const manifest: Manifest = {
    schemaVersion: rowInt(manifestRow, 'schema_version'),
    databaseId: rowText(manifestRow, 'database_id'),
    name: rowText(manifestRow, 'name'),
    version: rowText(manifestRow, 'version'),
    updatedAt: rowText(manifestRow, 'updated_at'),
    counts,
    ...(sourceUrl !== undefined ? { sourceUrl } : {}),
    ...(description !== undefined ? { description } : {}),
  };

  const authorRows = await platform.sql.query(
    dbPath,
    'SELECT position, id, canonical_name, notes, source_url FROM authors ORDER BY position',
  );
  const authorAliasRows = await platform.sql.query(
    dbPath,
    'SELECT author_id AS parent, alias AS value FROM author_aliases ORDER BY author_id, position',
  );
  const authorAliases = groupText(authorAliasRows as unknown as { parent: string; value: string }[]);
  const authors: Author[] = authorRows.map((row) => {
    const id = rowText(row, 'id');
    const notes = rowNullableText(row, 'notes');
    const url = rowNullableText(row, 'source_url');
    return {
      id,
      canonicalName: rowText(row, 'canonical_name'),
      aliases: authorAliases.get(id) ?? [],
      ...(notes !== undefined ? { notes } : {}),
      ...(url !== undefined ? { sourceUrl: url } : {}),
    };
  });

  const tagRows = await platform.sql.query(
    dbPath,
    'SELECT position, id, category, name, aliases_present FROM tags ORDER BY position',
  );
  const tagAliasRows = await platform.sql.query(
    dbPath,
    'SELECT tag_id AS parent, alias AS value FROM tag_aliases ORDER BY tag_id, position',
  );
  const tagAliases = groupText(tagAliasRows as unknown as { parent: string; value: string }[]);
  const tags: Tag[] = tagRows.map((row) => {
    const id = rowText(row, 'id');
    const aliases = tagAliases.get(id);
    const present = rowBool(row, 'aliases_present') || aliases !== undefined;
    return {
      id,
      category: rowText(row, 'category') as TagCategory,
      name: rowText(row, 'name'),
      ...(present ? { aliases: aliases ?? [] } : {}),
    };
  });

  const imageRows = await platform.sql.query(
    dbPath,
    'SELECT position, id, file, kind, caption FROM images ORDER BY position',
  );
  const images: ImageAsset[] = imageRows.map((row) => {
    const caption = rowNullableText(row, 'caption');
    return {
      id: rowText(row, 'id'),
      file: rowText(row, 'file'),
      kind: rowText(row, 'kind') as ImageAsset['kind'],
      ...(caption !== undefined ? { caption } : {}),
    };
  });

  const articleRows = await platform.sql.query(
    dbPath,
    'SELECT position, id, type, title, summary, series_id, cover_image_id, source_url, created_at, updated_at, illustration_ids_present FROM articles ORDER BY position',
  );
  const articleAuthorRows = await platform.sql.query(
    dbPath,
    'SELECT article_id AS parent, author_id AS id, role AS role FROM article_authors ORDER BY article_id, role, position',
  );
  const articleTagRows = await platform.sql.query(
    dbPath,
    'SELECT article_id AS parent, tag_id AS id, category AS category FROM article_tags ORDER BY article_id, category, position',
  );
  const articleIllustrationRows = await platform.sql.query(
    dbPath,
    'SELECT article_id AS parent, image_id AS id FROM article_illustrations ORDER BY article_id, position',
  );

  const articleAuthors = new Map<string, { author: string[]; translator: string[] }>();
  for (const row of articleAuthorRows) {
    const parent = rowText(row, 'parent');
    const role = rowText(row, 'role');
    const entry = articleAuthors.get(parent) ?? { author: [], translator: [] };
    if (role === 'author') entry.author.push(rowText(row, 'id'));
    else if (role === 'translator') entry.translator.push(rowText(row, 'id'));
    articleAuthors.set(parent, entry);
  }
  const articleTags = new Map<string, { character: string[]; plot: string[] }>();
  for (const row of articleTagRows) {
    const parent = rowText(row, 'parent');
    const category = rowText(row, 'category');
    const entry = articleTags.get(parent) ?? { character: [], plot: [] };
    if (category === 'character') entry.character.push(rowText(row, 'id'));
    else if (category === 'plot') entry.plot.push(rowText(row, 'id'));
    articleTags.set(parent, entry);
  }
  const articleIllustrations = groupText(
    articleIllustrationRows.map((row) => ({ parent: rowText(row, 'parent'), value: rowText(row, 'id') })),
  );

  const articles: ArticleFile[] = articleRows.map((row) => {
    const id = rowText(row, 'id');
    const seriesId = rowNullableText(row, 'series_id');
    const coverImageId = rowNullableText(row, 'cover_image_id');
    const url = rowNullableText(row, 'source_url');
    const authorsForArticle = articleAuthors.get(id) ?? { author: [], translator: [] };
    const tagsForArticle = articleTags.get(id) ?? { character: [], plot: [] };
    const illustrations = articleIllustrations.get(id);
    const present = rowBool(row, 'illustration_ids_present') || illustrations !== undefined;
    return {
      id,
      type: rowText(row, 'type') as ArticleType,
      title: rowText(row, 'title'),
      summary: rowText(row, 'summary'),
      content: { file: articleMd(id) },
      authorIds: authorsForArticle.author,
      translatorIds: authorsForArticle.translator,
      characterTagIds: tagsForArticle.character,
      plotTagIds: tagsForArticle.plot,
      ...(seriesId !== undefined ? { seriesId } : {}),
      ...(coverImageId !== undefined ? { coverImageId } : {}),
      ...(present ? { illustrationImageIds: illustrations ?? [] } : {}),
      ...(url !== undefined ? { sourceUrl: url } : {}),
      createdAt: rowText(row, 'created_at'),
      updatedAt: rowText(row, 'updated_at'),
    };
  });

  const seriesRows = await platform.sql.query(
    dbPath,
    'SELECT position, id, title, summary, status, cover_image_id, source_url, created_at, updated_at FROM series ORDER BY position',
  );
  const seriesArticleRows = await platform.sql.query(
    dbPath,
    'SELECT series_id AS parent, article_id AS value FROM series_articles ORDER BY series_id, position',
  );
  const seriesAuthorRows = await platform.sql.query(
    dbPath,
    'SELECT series_id AS parent, author_id AS id, role AS role FROM series_authors ORDER BY series_id, role, position',
  );
  const seriesTagRows = await platform.sql.query(
    dbPath,
    'SELECT series_id AS parent, tag_id AS id, category AS category FROM series_tags ORDER BY series_id, category, position',
  );
  const seriesArticles = groupText(
    seriesArticleRows.map((row) => ({
      parent: rowText(row, 'parent'),
      value: rowText(row, 'value'),
    })),
  );
  const seriesAuthors = new Map<string, { author: string[]; translator: string[] }>();
  for (const row of seriesAuthorRows) {
    const parent = rowText(row, 'parent');
    const role = rowText(row, 'role');
    const entry = seriesAuthors.get(parent) ?? { author: [], translator: [] };
    if (role === 'author') entry.author.push(rowText(row, 'id'));
    else if (role === 'translator') entry.translator.push(rowText(row, 'id'));
    seriesAuthors.set(parent, entry);
  }
  const seriesTags = new Map<string, { character: string[]; plot: string[] }>();
  for (const row of seriesTagRows) {
    const parent = rowText(row, 'parent');
    const category = rowText(row, 'category');
    const entry = seriesTags.get(parent) ?? { character: [], plot: [] };
    if (category === 'character') entry.character.push(rowText(row, 'id'));
    else if (category === 'plot') entry.plot.push(rowText(row, 'id'));
    seriesTags.set(parent, entry);
  }

  const series: Series[] = seriesRows.map((row) => {
    const id = rowText(row, 'id');
    const coverImageId = rowNullableText(row, 'cover_image_id');
    const url = rowNullableText(row, 'source_url');
    const authorsForSeries = seriesAuthors.get(id) ?? { author: [], translator: [] };
    const tagsForSeries = seriesTags.get(id) ?? { character: [], plot: [] };
    return {
      id,
      title: rowText(row, 'title'),
      summary: rowText(row, 'summary'),
      status: rowText(row, 'status') as Series['status'],
      articleIds: seriesArticles.get(id) ?? [],
      authorIds: authorsForSeries.author,
      translatorIds: authorsForSeries.translator,
      characterTagIds: tagsForSeries.character,
      plotTagIds: tagsForSeries.plot,
      ...(coverImageId !== undefined ? { coverImageId } : {}),
      ...(url !== undefined ? { sourceUrl: url } : {}),
      createdAt: rowText(row, 'created_at'),
      updatedAt: rowText(row, 'updated_at'),
    };
  });

  const featuredRows = await platform.sql.query(
    dbPath,
    'SELECT position, target_type, target_id FROM featured ORDER BY position',
  );
  const recommendationRows = await platform.sql.query(
    dbPath,
    'SELECT target_type, target_id, position, author, text FROM featured_recommendations ORDER BY target_type, target_id, position',
  );
  const recommendations = new Map<string, { author?: string; text: string }[]>();
  for (const row of recommendationRows) {
    const key = rowText(row, 'target_type') + '\u0000' + rowText(row, 'target_id');
    const author = rowNullableText(row, 'author');
    const list = recommendations.get(key) ?? [];
    list.push({ ...(author !== undefined ? { author } : {}), text: rowText(row, 'text') });
    recommendations.set(key, list);
  }
  const featured: FeaturedEntry[] = featuredRows.map((row) => {
    const targetType = rowText(row, 'target_type') as FeaturedEntry['targetType'];
    const targetId = rowText(row, 'target_id');
    return {
      targetType,
      targetId,
      recommendations: recommendations.get(targetType + '\u0000' + targetId) ?? [],
    };
  });

  const creditRows = await platform.sql.query(
    dbPath,
    'SELECT position, name, role, link, note FROM credits ORDER BY position',
  );
  const credits: CreditsEntry[] = creditRows.map((row) => {
    const role = rowNullableText(row, 'role');
    const link = rowNullableText(row, 'link');
    const note = rowNullableText(row, 'note');
    return {
      name: rowText(row, 'name'),
      ...(role !== undefined ? { role } : {}),
      ...(link !== undefined ? { link } : {}),
      ...(note !== undefined ? { note } : {}),
    };
  });

  const filePaths = new Set<string>();
  for (const article of articles) filePaths.add(articleMd(article.id));
  for (const image of images) filePaths.add(image.file);

  const parsed = parseRawDatabase({
    manifest,
    authors,
    tags,
    images,
    articles,
    series,
    featured,
    credits,
  });
  return { ...parsed, filePaths };
}

export async function readSqliteDatabase(platform: Platform, dir: string): Promise<RawDatabase> {
  try {
    return await readSqliteFromFile(platform, dbPathOf(platform, dir));
  } catch (error) {
    if (error instanceof PlatformError) throw error;
    throw new PlatformError('EIO', 'database.sqlite 读取失败：' + String(error), error);
  }
}

async function imageSourceInfo(
  platform: Platform,
  source: BlobSource | undefined,
): Promise<{ source: BlobSource; size: number } | null> {
  if (!source) return null;
  if (source instanceof Uint8Array) return { source, size: source.byteLength };
  try {
    const stat = await platform.fs.stat(source.file);
    if (!stat.isFile) return null;
    return { source, size: stat.size };
  } catch {
    return null;
  }
}

async function verifySqlite(
  platform: Platform,
  dbPath: string,
  expected: RawDatabase,
  markdown: Map<string, string>,
  imageSources: Map<string, BlobSource>,
): Promise<void> {
  const actual = await readSqliteFromFile(platform, dbPath);
  if (canonicalDatabase(actual) !== canonicalDatabase(expected)) {
    throw new PlatformError('EIO', 'SQLite 读回校验失败：实体数据与写入输入不一致');
  }

  const quick = await platform.sql.query(dbPath, 'PRAGMA quick_check');
  if (quick[0]?.['quick_check'] !== 'ok') {
    throw new PlatformError('EIO', 'SQLite quick_check 未通过');
  }

  const contentStats = await platform.sql.query(
    dbPath,
    'SELECT COUNT(*) AS n, COALESCE(SUM(length(CAST(markdown AS BLOB))),0) AS bytes FROM article_contents',
  );
  const contentRow = contentStats[0];
  const expectedContentBytes = [...markdown.values()].reduce(
    (total, text) => total + new TextEncoder().encode(text).byteLength,
    0,
  );
  if (
    !contentRow ||
    rowInt(contentRow, 'n') !== markdown.size ||
    rowInt(contentRow, 'bytes') !== expectedContentBytes
  ) {
    throw new PlatformError('EIO', 'SQLite 读回校验失败：正文数量或长度不一致');
  }

  let expectedImages = 0;
  let expectedImageBytes = 0;
  for (const image of expected.images) {
    const info = await imageSourceInfo(platform, imageSources.get(image.id));
    if (info) {
      expectedImages += 1;
      expectedImageBytes += info.size;
    }
  }
  const imageStats = await platform.sql.query(
    dbPath,
    'SELECT COUNT(data) AS n, COALESCE(SUM(length(data)),0) AS bytes FROM images',
  );
  const imageRow = imageStats[0];
  if (
    !imageRow ||
    rowInt(imageRow, 'n') !== expectedImages ||
    rowInt(imageRow, 'bytes') !== expectedImageBytes
  ) {
    throw new PlatformError('EIO', 'SQLite 读回校验失败：图片数量或字节数不一致');
  }
}

/**
 * 全量写入（仅导入/迁移使用）。目标通常是临时文件或 staging。
 * 图片按 source 走平台 BLOB 写入；大批图片不会经过 JS 内存。
 */
export async function writeSqliteDatabase(
  platform: Platform,
  targetPath: string,
  db: RawDatabase,
  markdown: Map<string, string>,
  imageSources: Map<string, BlobSource> = new Map(),
): Promise<void> {
  if (await platform.fs.exists(targetPath)) await platform.fs.remove(targetPath);
  try {
    await platform.sql.batch(targetPath, [...SQL_SCHEMA_STATEMENTS]);

    const pending: SqlStatement[] = [];
    const flush = async (): Promise<void> => {
      if (pending.length === 0) return;
      const chunk = pending.splice(0, pending.length);
      await platform.sql.batch(targetPath, chunk);
    };
    const add = (sql: string, params?: SqlValueLike[]): void => {
      pending.push(params ? { sql, params } : { sql });
    };
    const addAsync = async (sql: string, params?: SqlValueLike[]): Promise<void> => {
      add(sql, params);
      if (pending.length >= 200) await flush();
    };

    await addAsync(
      'INSERT INTO manifest(id,schema_version,database_id,name,version,updated_at,source_url,description,counts_json) VALUES (1,?,?,?,?,?,?,?,?)',
      [
        db.manifest.schemaVersion,
        db.manifest.databaseId,
        db.manifest.name,
        db.manifest.version,
        db.manifest.updatedAt,
        db.manifest.sourceUrl ?? null,
        db.manifest.description ?? null,
        JSON.stringify(db.manifest.counts),
      ],
    );

    for (const [position, author] of db.authors.entries()) {
      await addAsync('INSERT INTO authors(position,id,canonical_name,notes,source_url) VALUES (?,?,?,?,?)', [
        position,
        author.id,
        author.canonicalName,
        author.notes ?? null,
        author.sourceUrl ?? null,
      ]);
      for (const [index, alias] of author.aliases.entries()) {
        await addAsync('INSERT INTO author_aliases(author_id,position,alias) VALUES (?,?,?)', [author.id, index, alias]);
      }
    }

    for (const [position, tag] of db.tags.entries()) {
      await addAsync('INSERT INTO tags(position,id,category,name,aliases_present) VALUES (?,?,?,?,?)', [
        position,
        tag.id,
        tag.category,
        tag.name,
        tag.aliases !== undefined ? 1 : 0,
      ]);
      for (const [index, alias] of (tag.aliases ?? []).entries()) {
        await addAsync('INSERT INTO tag_aliases(tag_id,position,alias) VALUES (?,?,?)', [tag.id, index, alias]);
      }
    }

    for (const [position, article] of db.articles.entries()) {
      await addAsync(
        'INSERT INTO articles(position,id,type,title,summary,series_id,cover_image_id,source_url,created_at,updated_at,illustration_ids_present) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        [
          position,
          article.id,
          article.type,
          article.title,
          article.summary,
          article.seriesId ?? null,
          article.coverImageId ?? null,
          article.sourceUrl ?? null,
          article.createdAt,
          article.updatedAt,
          article.illustrationImageIds !== undefined ? 1 : 0,
        ],
      );
      const body = markdown.get(article.id);
      if (body !== undefined) {
        await addAsync('INSERT INTO article_contents(article_id,markdown) VALUES (?,?)', [article.id, body]);
      }
      for (const [index, id] of article.authorIds.entries()) {
        await addAsync('INSERT INTO article_authors(article_id,author_id,role,position) VALUES (?,?,?,?)', [
          article.id,
          id,
          'author',
          index,
        ]);
      }
      for (const [index, id] of article.translatorIds.entries()) {
        await addAsync('INSERT INTO article_authors(article_id,author_id,role,position) VALUES (?,?,?,?)', [
          article.id,
          id,
          'translator',
          index,
        ]);
      }
      for (const [index, id] of article.characterTagIds.entries()) {
        await addAsync('INSERT INTO article_tags(article_id,tag_id,category,position) VALUES (?,?,?,?)', [
          article.id,
          id,
          'character',
          index,
        ]);
      }
      for (const [index, id] of article.plotTagIds.entries()) {
        await addAsync('INSERT INTO article_tags(article_id,tag_id,category,position) VALUES (?,?,?,?)', [
          article.id,
          id,
          'plot',
          index,
        ]);
      }
      for (const [index, id] of (article.illustrationImageIds ?? []).entries()) {
        await addAsync('INSERT INTO article_illustrations(article_id,image_id,position) VALUES (?,?,?)', [
          article.id,
          id,
          index,
        ]);
      }
    }

    for (const [position, series] of db.series.entries()) {
      await addAsync(
        'INSERT INTO series(position,id,title,summary,status,cover_image_id,source_url,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)',
        [
          position,
          series.id,
          series.title,
          series.summary,
          series.status,
          series.coverImageId ?? null,
          series.sourceUrl ?? null,
          series.createdAt,
          series.updatedAt,
        ],
      );
      for (const [index, id] of series.articleIds.entries()) {
        await addAsync('INSERT INTO series_articles(series_id,article_id,position) VALUES (?,?,?)', [series.id, id, index]);
      }
      for (const [index, id] of series.authorIds.entries()) {
        await addAsync('INSERT INTO series_authors(series_id,author_id,role,position) VALUES (?,?,?,?)', [
          series.id,
          id,
          'author',
          index,
        ]);
      }
      for (const [index, id] of series.translatorIds.entries()) {
        await addAsync('INSERT INTO series_authors(series_id,author_id,role,position) VALUES (?,?,?,?)', [
          series.id,
          id,
          'translator',
          index,
        ]);
      }
      for (const [index, id] of series.characterTagIds.entries()) {
        await addAsync('INSERT INTO series_tags(series_id,tag_id,category,position) VALUES (?,?,?,?)', [
          series.id,
          id,
          'character',
          index,
        ]);
      }
      for (const [index, id] of series.plotTagIds.entries()) {
        await addAsync('INSERT INTO series_tags(series_id,tag_id,category,position) VALUES (?,?,?,?)', [
          series.id,
          id,
          'plot',
          index,
        ]);
      }
    }

    for (const [position, entry] of db.featured.entries()) {
      await addAsync('INSERT INTO featured(position,target_type,target_id) VALUES (?,?,?)', [
        position,
        entry.targetType,
        entry.targetId,
      ]);
      for (const [index, recommendation] of entry.recommendations.entries()) {
        await addAsync(
          'INSERT INTO featured_recommendations(target_type,target_id,position,author,text) VALUES (?,?,?,?,?)',
          [entry.targetType, entry.targetId, index, recommendation.author ?? null, recommendation.text],
        );
      }
    }

    for (const [position, entry] of db.credits.entries()) {
      await addAsync('INSERT INTO credits(position,name,role,link,note) VALUES (?,?,?,?,?)', [
        position,
        entry.name,
        entry.role ?? null,
        entry.link ?? null,
        entry.note ?? null,
      ]);
    }

    for (const [position, image] of db.images.entries()) {
      const source = imageSources.get(image.id);
      const info = await imageSourceInfo(platform, source);
      if (source !== undefined && !info) {
        // 调用方明确给了来源却读不到：宁可让整次导入/迁移失败，也不能静默丢图。
        throw new PlatformError('EIO', `图片文件缺失：${image.file}`);
      }
      if (!info) {
        await addAsync(INSERT_IMAGE_WITHOUT_DATA, [
          position,
          image.id,
          image.file,
          image.kind,
          image.caption ?? null,
          mimeOf(image.file),
        ]);
        continue;
      }
      await flush();
      await platform.sql.writeBlob(
        targetPath,
        INSERT_IMAGE_WITH_DATA,
        [
          position,
          image.id,
          image.file,
          image.kind,
          image.caption ?? null,
          mimeOf(image.file),
          info.size,
        ],
        info.source,
      );
    }

    await flush();
    await verifySqlite(platform, targetPath, db, markdown, imageSources);
  } catch (error) {
    await platform.fs.remove(targetPath).catch(() => undefined);
    if (error instanceof PlatformError) throw error;
    throw new PlatformError('EIO', '写入 database.sqlite 失败：' + String(error), error);
  }
}

type SqlValueLike = string | number | null;

function idsChangedOrder<T extends { id: string }>(previous: readonly T[], next: readonly T[]): boolean {
  const nextIds = new Set(next.map((item) => item.id));
  const prevIds = new Set(previous.map((item) => item.id));
  const before = previous.filter((item) => nextIds.has(item.id)).map((item) => item.id);
  const after = next.filter((item) => prevIds.has(item.id)).map((item) => item.id);
  return stableStringify(before) !== stableStringify(after);
}

function addDeleteChildren(
  statements: SqlStatement[],
  table: string,
  column: string,
  id: string,
): void {
  statements.push({ sql: 'DELETE FROM ' + table + ' WHERE ' + column + ' = ?', params: [id] });
}

/**
 * 写入一次编辑的差异。整个调用是一个事务；图片 data 和正文由各自的
 * 专用路径维护，这里只处理实体/关系元数据。
 */
export async function saveDatabase(
  platform: Platform,
  dir: string,
  previous: RawDatabase,
  next: RawDatabase,
): Promise<void> {
  const dbPath = dbPathOf(platform, dir);
  const statements: SqlStatement[] = [];

  const prevAuthors = new Map(previous.authors.map((item) => [item.id, item]));
  const nextAuthors = new Map(next.authors.map((item) => [item.id, item]));
  for (const old of previous.authors) {
    if (nextAuthors.has(old.id)) continue;
    addDeleteChildren(statements, 'author_aliases', 'author_id', old.id);
    statements.push({ sql: 'DELETE FROM authors WHERE id = ?', params: [old.id] });
  }
  for (const [position, author] of next.authors.entries()) {
    const before = prevAuthors.get(author.id);
    if (before && stableStringify(before) === stableStringify(author)) continue;
    statements.push({
      sql: 'INSERT INTO authors(position,id,canonical_name,notes,source_url) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET position=excluded.position, canonical_name=excluded.canonical_name, notes=excluded.notes, source_url=excluded.source_url',
      params: [position, author.id, author.canonicalName, author.notes ?? null, author.sourceUrl ?? null],
    });
    addDeleteChildren(statements, 'author_aliases', 'author_id', author.id);
    for (const [index, alias] of author.aliases.entries()) {
      statements.push({
        sql: 'INSERT INTO author_aliases(author_id,position,alias) VALUES (?,?,?)',
        params: [author.id, index, alias],
      });
    }
  }
  if (idsChangedOrder(previous.authors, next.authors)) {
    for (const [position, author] of next.authors.entries()) {
      statements.push({ sql: 'UPDATE authors SET position = ? WHERE id = ?', params: [position, author.id] });
    }
  }

  const prevTags = new Map(previous.tags.map((item) => [item.id, item]));
  const nextTags = new Map(next.tags.map((item) => [item.id, item]));
  for (const old of previous.tags) {
    if (nextTags.has(old.id)) continue;
    addDeleteChildren(statements, 'tag_aliases', 'tag_id', old.id);
    statements.push({ sql: 'DELETE FROM tags WHERE id = ?', params: [old.id] });
  }
  for (const [position, tag] of next.tags.entries()) {
    const before = prevTags.get(tag.id);
    if (before && stableStringify(before) === stableStringify(tag)) continue;
    statements.push({
      sql: 'INSERT INTO tags(position,id,category,name,aliases_present) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET position=excluded.position, category=excluded.category, name=excluded.name, aliases_present=excluded.aliases_present',
      params: [position, tag.id, tag.category, tag.name, tag.aliases !== undefined ? 1 : 0],
    });
    addDeleteChildren(statements, 'tag_aliases', 'tag_id', tag.id);
    for (const [index, alias] of (tag.aliases ?? []).entries()) {
      statements.push({
        sql: 'INSERT INTO tag_aliases(tag_id,position,alias) VALUES (?,?,?)',
        params: [tag.id, index, alias],
      });
    }
  }
  if (idsChangedOrder(previous.tags, next.tags)) {
    for (const [position, tag] of next.tags.entries()) {
      statements.push({ sql: 'UPDATE tags SET position = ? WHERE id = ?', params: [position, tag.id] });
    }
  }

  const prevImages = new Map(previous.images.map((item) => [item.id, item]));
  const nextImages = new Map(next.images.map((item) => [item.id, item]));
  for (const old of previous.images) {
    if (!nextImages.has(old.id)) statements.push({ sql: 'DELETE FROM images WHERE id = ?', params: [old.id] });
  }
  for (const [position, image] of next.images.entries()) {
    const before = prevImages.get(image.id);
    if (before && stableStringify(before) === stableStringify(image)) continue;
    statements.push({
      sql: UPSERT_IMAGE,
      params: [position, image.id, image.file, image.kind, image.caption ?? null, mimeOf(image.file)],
    });
  }
  if (idsChangedOrder(previous.images, next.images)) {
    for (const [position, image] of next.images.entries()) {
      statements.push({ sql: 'UPDATE images SET position = ? WHERE id = ?', params: [position, image.id] });
    }
  }

  const prevArticles = new Map(previous.articles.map((item) => [item.id, item]));
  const nextArticles = new Map(next.articles.map((item) => [item.id, item]));
  for (const old of previous.articles) {
    if (nextArticles.has(old.id)) continue;
    statements.push({ sql: 'DELETE FROM article_contents WHERE article_id = ?', params: [old.id] });
    addDeleteChildren(statements, 'article_authors', 'article_id', old.id);
    addDeleteChildren(statements, 'article_tags', 'article_id', old.id);
    addDeleteChildren(statements, 'article_illustrations', 'article_id', old.id);
    statements.push({ sql: 'DELETE FROM articles WHERE id = ?', params: [old.id] });
  }
  for (const [position, article] of next.articles.entries()) {
    const before = prevArticles.get(article.id);
    if (before && stableStringify(before) === stableStringify(article)) continue;
    statements.push({
      sql: 'INSERT INTO articles(position,id,type,title,summary,series_id,cover_image_id,source_url,created_at,updated_at,illustration_ids_present) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET position=excluded.position, type=excluded.type, title=excluded.title, summary=excluded.summary, series_id=excluded.series_id, cover_image_id=excluded.cover_image_id, source_url=excluded.source_url, created_at=excluded.created_at, updated_at=excluded.updated_at, illustration_ids_present=excluded.illustration_ids_present',
      params: [
        position,
        article.id,
        article.type,
        article.title,
        article.summary,
        article.seriesId ?? null,
        article.coverImageId ?? null,
        article.sourceUrl ?? null,
        article.createdAt,
        article.updatedAt,
        article.illustrationImageIds !== undefined ? 1 : 0,
      ],
    });
    addDeleteChildren(statements, 'article_authors', 'article_id', article.id);
    addDeleteChildren(statements, 'article_tags', 'article_id', article.id);
    addDeleteChildren(statements, 'article_illustrations', 'article_id', article.id);
    for (const [index, id] of article.authorIds.entries()) {
      statements.push({
        sql: 'INSERT INTO article_authors(article_id,author_id,role,position) VALUES (?,?,?,?)',
        params: [article.id, id, 'author', index],
      });
    }
    for (const [index, id] of article.translatorIds.entries()) {
      statements.push({
        sql: 'INSERT INTO article_authors(article_id,author_id,role,position) VALUES (?,?,?,?)',
        params: [article.id, id, 'translator', index],
      });
    }
    for (const [index, id] of article.characterTagIds.entries()) {
      statements.push({
        sql: 'INSERT INTO article_tags(article_id,tag_id,category,position) VALUES (?,?,?,?)',
        params: [article.id, id, 'character', index],
      });
    }
    for (const [index, id] of article.plotTagIds.entries()) {
      statements.push({
        sql: 'INSERT INTO article_tags(article_id,tag_id,category,position) VALUES (?,?,?,?)',
        params: [article.id, id, 'plot', index],
      });
    }
    for (const [index, id] of (article.illustrationImageIds ?? []).entries()) {
      statements.push({
        sql: 'INSERT INTO article_illustrations(article_id,image_id,position) VALUES (?,?,?)',
        params: [article.id, id, index],
      });
    }
  }
  if (idsChangedOrder(previous.articles, next.articles)) {
    for (const [position, article] of next.articles.entries()) {
      statements.push({ sql: 'UPDATE articles SET position = ? WHERE id = ?', params: [position, article.id] });
    }
  }

  const prevSeries = new Map(previous.series.map((item) => [item.id, item]));
  const nextSeries = new Map(next.series.map((item) => [item.id, item]));
  for (const old of previous.series) {
    if (nextSeries.has(old.id)) continue;
    addDeleteChildren(statements, 'series_articles', 'series_id', old.id);
    addDeleteChildren(statements, 'series_authors', 'series_id', old.id);
    addDeleteChildren(statements, 'series_tags', 'series_id', old.id);
    statements.push({ sql: 'DELETE FROM series WHERE id = ?', params: [old.id] });
  }
  for (const [position, series] of next.series.entries()) {
    const before = prevSeries.get(series.id);
    if (before && stableStringify(before) === stableStringify(series)) continue;
    statements.push({
      sql: 'INSERT INTO series(position,id,title,summary,status,cover_image_id,source_url,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET position=excluded.position, title=excluded.title, summary=excluded.summary, status=excluded.status, cover_image_id=excluded.cover_image_id, source_url=excluded.source_url, created_at=excluded.created_at, updated_at=excluded.updated_at',
      params: [
        position,
        series.id,
        series.title,
        series.summary,
        series.status,
        series.coverImageId ?? null,
        series.sourceUrl ?? null,
        series.createdAt,
        series.updatedAt,
      ],
    });
    addDeleteChildren(statements, 'series_articles', 'series_id', series.id);
    addDeleteChildren(statements, 'series_authors', 'series_id', series.id);
    addDeleteChildren(statements, 'series_tags', 'series_id', series.id);
    for (const [index, id] of series.articleIds.entries()) {
      statements.push({
        sql: 'INSERT INTO series_articles(series_id,article_id,position) VALUES (?,?,?)',
        params: [series.id, id, index],
      });
    }
    for (const [index, id] of series.authorIds.entries()) {
      statements.push({
        sql: 'INSERT INTO series_authors(series_id,author_id,role,position) VALUES (?,?,?,?)',
        params: [series.id, id, 'author', index],
      });
    }
    for (const [index, id] of series.translatorIds.entries()) {
      statements.push({
        sql: 'INSERT INTO series_authors(series_id,author_id,role,position) VALUES (?,?,?,?)',
        params: [series.id, id, 'translator', index],
      });
    }
    for (const [index, id] of series.characterTagIds.entries()) {
      statements.push({
        sql: 'INSERT INTO series_tags(series_id,tag_id,category,position) VALUES (?,?,?,?)',
        params: [series.id, id, 'character', index],
      });
    }
    for (const [index, id] of series.plotTagIds.entries()) {
      statements.push({
        sql: 'INSERT INTO series_tags(series_id,tag_id,category,position) VALUES (?,?,?,?)',
        params: [series.id, id, 'plot', index],
      });
    }
  }
  if (idsChangedOrder(previous.series, next.series)) {
    for (const [position, series] of next.series.entries()) {
      statements.push({ sql: 'UPDATE series SET position = ? WHERE id = ?', params: [position, series.id] });
    }
  }

  if (stableStringify(previous.featured) !== stableStringify(next.featured)) {
    statements.push({ sql: 'DELETE FROM featured_recommendations' });
    statements.push({ sql: 'DELETE FROM featured' });
    for (const [position, entry] of next.featured.entries()) {
      statements.push({
        sql: 'INSERT INTO featured(position,target_type,target_id) VALUES (?,?,?)',
        params: [position, entry.targetType, entry.targetId],
      });
      for (const [index, recommendation] of entry.recommendations.entries()) {
        statements.push({
          sql: 'INSERT INTO featured_recommendations(target_type,target_id,position,author,text) VALUES (?,?,?,?,?)',
          params: [entry.targetType, entry.targetId, index, recommendation.author ?? null, recommendation.text],
        });
      }
    }
  }

  if (stableStringify(previous.credits) !== stableStringify(next.credits)) {
    statements.push({ sql: 'DELETE FROM credits' });
    for (const [position, entry] of next.credits.entries()) {
      statements.push({
        sql: 'INSERT INTO credits(position,name,role,link,note) VALUES (?,?,?,?,?)',
        params: [position, entry.name, entry.role ?? null, entry.link ?? null, entry.note ?? null],
      });
    }
  }

  statements.push({
    sql: 'UPDATE manifest SET schema_version=?, database_id=?, name=?, version=?, updated_at=?, source_url=?, description=?, counts_json=? WHERE id=1',
    params: [
      next.manifest.schemaVersion,
      next.manifest.databaseId,
      next.manifest.name,
      next.manifest.version,
      next.manifest.updatedAt,
      next.manifest.sourceUrl ?? null,
      next.manifest.description ?? null,
      JSON.stringify(next.manifest.counts),
    ],
  });

  await platform.sql.batch(dbPath, statements);
}

const INSERT_IMAGE_BLOB =
  'INSERT INTO images(position,id,file,kind,caption,mime,byte_size,data) ' +
  'VALUES ((SELECT COALESCE(MAX(position), -1) + 1 FROM images),?,?,?,?,?,?,?) ' +
  'ON CONFLICT(id) DO UPDATE SET file=excluded.file, kind=excluded.kind, caption=excluded.caption, ' +
  'mime=excluded.mime, byte_size=excluded.byte_size, data=excluded.data';

/** 编辑器写入图片 BLOB；元数据随后由 saveDatabase 的差异事务补齐。 */
export async function writeImageBlob(
  platform: Platform,
  dir: string,
  image: ImageAsset,
  bytes: Uint8Array,
): Promise<void> {
  await platform.sql.writeBlob(
    dbPathOf(platform, dir),
    INSERT_IMAGE_BLOB,
    [image.id, image.file, image.kind, image.caption ?? null, mimeOf(image.file), bytes.byteLength],
    bytes,
  );
}

/** 导出/合并读取图片 BLOB；不存在时返回 null。 */
export async function readImageBlob(
  platform: Platform,
  dir: string,
  imageId: string,
): Promise<Uint8Array | null> {
  return platform.sql.readBlob(dbPathOf(platform, dir), 'SELECT data FROM images WHERE id = ?', [imageId]);
}

/** 导出时把图片 BLOB 直接落成 .tpr 里的文件，避免大图经过 JS。 */
export async function readImageBlobToFile(
  platform: Platform,
  dir: string,
  imageId: string,
  targetPath: string,
): Promise<boolean> {
  return platform.sql.readBlobToFile(
    dbPathOf(platform, dir),
    'SELECT data FROM images WHERE id = ? AND data IS NOT NULL',
    [imageId],
    targetPath,
  );
}

