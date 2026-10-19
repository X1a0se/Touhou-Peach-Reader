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
} from './entities.js';
import { rawDatabaseSchema } from './raw.js';

/**
 * JSON Schema 输出（Goal 2 要求"有 JSON Schema"）。
 * 单一来源仍是 zod；需要给外部工具/编辑器用时调 `getJsonSchemas()`。
 */

export type JsonSchema = Record<string, unknown>;

export type JsonSchemaName =
  | 'manifest'
  | 'author'
  | 'tag'
  | 'imageAsset'
  | 'article'
  | 'series'
  | 'featuredEntry'
  | 'creditsEntry'
  | 'database';

interface ToJsonSchemaCapable {
  toJSONSchema?: (schema: unknown, params?: unknown) => unknown;
}

function convert(schema: unknown): JsonSchema {
  const api = z as unknown as ToJsonSchemaCapable;
  if (typeof api.toJSONSchema !== 'function') {
    throw new Error('E_SCHEMA_EXPORT: 当前 zod 版本不提供 z.toJSONSchema');
  }
  return api.toJSONSchema(schema) as JsonSchema;
}

export function getJsonSchemas(): Record<JsonSchemaName, JsonSchema> {
  return {
    manifest: convert(manifestSchema),
    author: convert(authorSchema),
    tag: convert(tagSchema),
    imageAsset: convert(imageAssetSchema),
    article: convert(articleFileSchema),
    series: convert(seriesSchema),
    featuredEntry: convert(featuredEntrySchema),
    creditsEntry: convert(creditsEntrySchema),
    database: convert(rawDatabaseSchema),
  };
}
