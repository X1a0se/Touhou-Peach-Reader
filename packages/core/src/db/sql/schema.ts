import type { SqlStatement } from '@tpr/platform';

/** SQLite 布局版本；与 .tpr 的 manifest.schemaVersion 相互独立。 */
export const SQL_SCHEMA_VERSION = 1;

/**
 * 本地数据库 DDL。
 *
 * 不启用外键：schema 的 validateDatabase 把悬空作者/标签/系列当 warning，
 * 导入必须保持宽松；补引用由编辑器负责。
 */
export const SQL_SCHEMA_STATEMENTS: readonly SqlStatement[] = [
  {
    sql: `CREATE TABLE manifest (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      schema_version INTEGER NOT NULL,
      database_id TEXT NOT NULL,
      name TEXT NOT NULL,
      version TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      source_url TEXT,
      description TEXT,
      counts_json TEXT NOT NULL
    )`,
  },
  {
    sql: `CREATE TABLE authors (
      position INTEGER NOT NULL,
      id TEXT PRIMARY KEY,
      canonical_name TEXT NOT NULL,
      notes TEXT,
      source_url TEXT
    )`,
  },
  {
    sql: `CREATE TABLE author_aliases (
      author_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      alias TEXT NOT NULL,
      PRIMARY KEY (author_id, position)
    )`,
  },
  {
    sql: `CREATE TABLE tags (
      position INTEGER NOT NULL,
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      name TEXT NOT NULL,
      aliases_present INTEGER NOT NULL DEFAULT 0
    )`,
  },
  {
    sql: `CREATE TABLE tag_aliases (
      tag_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      alias TEXT NOT NULL,
      PRIMARY KEY (tag_id, position)
    )`,
  },
  {
    sql: `CREATE TABLE images (
      position INTEGER NOT NULL,
      id TEXT PRIMARY KEY,
      file TEXT NOT NULL,
      kind TEXT NOT NULL,
      caption TEXT,
      mime TEXT,
      byte_size INTEGER,
      data BLOB
    )`,
  },
  {
    sql: `CREATE TABLE articles (
      position INTEGER NOT NULL,
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      series_id TEXT,
      cover_image_id TEXT,
      source_url TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      illustration_ids_present INTEGER NOT NULL DEFAULT 0
    )`,
  },
  {
    sql: `CREATE TABLE article_contents (
      article_id TEXT PRIMARY KEY,
      markdown TEXT NOT NULL
    )`,
  },
  {
    sql: `CREATE TABLE article_authors (
      article_id TEXT NOT NULL,
      author_id TEXT NOT NULL,
      role TEXT NOT NULL,
      position INTEGER NOT NULL,
      PRIMARY KEY (article_id, role, position)
    )`,
  },
  {
    sql: `CREATE TABLE article_tags (
      article_id TEXT NOT NULL,
      tag_id TEXT NOT NULL,
      category TEXT NOT NULL,
      position INTEGER NOT NULL,
      PRIMARY KEY (article_id, category, position)
    )`,
  },
  {
    sql: `CREATE TABLE article_illustrations (
      article_id TEXT NOT NULL,
      image_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      PRIMARY KEY (article_id, position)
    )`,
  },
  {
    sql: `CREATE TABLE series (
      position INTEGER NOT NULL,
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      status TEXT NOT NULL,
      cover_image_id TEXT,
      source_url TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
  },
  {
    sql: `CREATE TABLE series_articles (
      series_id TEXT NOT NULL,
      article_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      PRIMARY KEY (series_id, position)
    )`,
  },
  {
    sql: `CREATE TABLE series_authors (
      series_id TEXT NOT NULL,
      author_id TEXT NOT NULL,
      role TEXT NOT NULL,
      position INTEGER NOT NULL,
      PRIMARY KEY (series_id, role, position)
    )`,
  },
  {
    sql: `CREATE TABLE series_tags (
      series_id TEXT NOT NULL,
      tag_id TEXT NOT NULL,
      category TEXT NOT NULL,
      position INTEGER NOT NULL,
      PRIMARY KEY (series_id, category, position)
    )`,
  },
  {
    sql: `CREATE TABLE featured (
      position INTEGER NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      PRIMARY KEY (target_type, target_id)
    )`,
  },
  {
    sql: `CREATE TABLE featured_recommendations (
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      author TEXT,
      text TEXT NOT NULL,
      PRIMARY KEY (target_type, target_id, position)
    )`,
  },
  {
    sql: `CREATE TABLE credits (
      position INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT,
      link TEXT,
      note TEXT
    )`,
  },
  { sql: 'CREATE INDEX idx_articles_series ON articles(series_id)' },
  { sql: 'CREATE INDEX idx_article_authors_article ON article_authors(article_id)' },
  { sql: 'CREATE INDEX idx_article_tags_article ON article_tags(article_id)' },
  { sql: 'CREATE INDEX idx_series_articles_article ON series_articles(article_id)' },
  { sql: 'CREATE INDEX idx_images_file ON images(file)' },
  { sql: `PRAGMA user_version = ${SQL_SCHEMA_VERSION}` },
];
