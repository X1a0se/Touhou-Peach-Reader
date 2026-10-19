export { buildSearchIndex, resolveHit, type BuildSearchOptions, type BuildSearchResult } from './build.js';
export {
  createSearchEngine,
  FIELD_NAMES,
  FIELD_WEIGHTS,
  type FieldName,
  type FilterKind,
  type HitKind,
  type SearchDoc,
  type SearchEngine,
  type SearchFieldTokens,
  type SearchHit,
  type SearchOptions,
} from './engine.js';
export {
  isEmptyQuery,
  normalizeTagName,
  parseQuery,
  type ParsedQuery,
} from './parse-query.js';
export {
  buildSnippets,
  flattenSnippet,
  type SnippetOptions,
  type SnippetPart,
} from './snippet.js';
export {
  createSearchService,
  type SearchItem,
  type SearchResponse,
  type SearchService,
} from './service.js';
export { bigramsOnly, toIndexText, tokenizeZh } from './tokenize.js';
