/**
 * 系列元数据同步（Task 5）：把「系列页保存时改动的字段」换算成「哪些文章的哪些字段要跟着改」。
 *
 * 纯逻辑：只读内存快照，不碰 React / DOM / Tauri / 磁盘，弹窗与页面共用同一份计算。
 */
import type { DBSnapshot } from '@tpr/core';
import {
  SERIES_AUTO_FILL_FIELDS,
  type ArticleMeta,
  type Series,
  type SeriesAutoFillField,
} from '@tpr/schema';

/** 四个可同步字段的「系列值 / 文章值」，可选字段已归一成空串。 */
export interface MetaSyncValues {
  authorIds: string[];
  translatorIds: string[];
  coverImageId: string;
  sourceUrl: string;
}

/** 保存前的系列值；`articleIds` 用来确定「已经在系列里的文章」。 */
export interface MetaSyncBefore extends MetaSyncValues {
  articleIds: string[];
}

/** 一条待确认的改动：把系列该字段写到这篇文章上。 */
export interface MetaSyncCandidate {
  articleId: string;
  field: SeriesAutoFillField;
  kind: 'fill' | 'replace';
}

/** 弹窗里的一组：同字段、同种类、同「文章原值」的候选。 */
export interface MetaSyncGroup {
  key: string;
  field: SeriesAutoFillField;
  kind: 'fill' | 'replace';
  fromLabel: string;
  toLabel: string;
  items: MetaSyncCandidate[];
}

/** 字段在表单复选框与弹窗分组标题里的显示名。 */
export const META_SYNC_FIELD_LABEL: Record<SeriesAutoFillField, string> = {
  cover: '封面',
  author: '作者',
  translator: '译者',
  sourceUrl: '原出处',
};

/** 未填写时弹窗里显示的占位文案。 */
const EMPTY_LABEL = '（未填写）';

/** 清除、归一：`sourceUrl` 允许用户带空格输入，落盘前会 trim，比较与显示都按 trim 后算。 */
function text(value: string): string {
  return value.trim();
}

/** 两个 id 数组是否表示同一个集合（顺序不算差异）。 */
function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id) => b.includes(id));
}

/** 该字段是否为空（空 = 没有值可写）。 */
function isEmptyField(values: MetaSyncValues, field: SeriesAutoFillField): boolean {
  switch (field) {
    case 'cover':
      return text(values.coverImageId) === '';
    case 'author':
      return values.authorIds.length === 0;
    case 'translator':
      return values.translatorIds.length === 0;
    case 'sourceUrl':
      return text(values.sourceUrl) === '';
  }
}

/** 两边的该字段是否等价；id 数组按集合比，URL 按 trim 后比。 */
function sameField(a: MetaSyncValues, b: MetaSyncValues, field: SeriesAutoFillField): boolean {
  switch (field) {
    case 'cover':
      return text(a.coverImageId) === text(b.coverImageId);
    case 'author':
      return sameIds(a.authorIds, b.authorIds);
    case 'translator':
      return sameIds(a.translatorIds, b.translatorIds);
    case 'sourceUrl':
      return text(a.sourceUrl) === text(b.sourceUrl);
  }
}

/** 系列的四个字段；没有封面 / 原出处时归一成空串。 */
export function valuesOfSeries(series: Series): MetaSyncValues {
  return {
    authorIds: [...series.authorIds],
    translatorIds: [...series.translatorIds],
    coverImageId: series.coverImageId ?? '',
    sourceUrl: text(series.sourceUrl ?? ''),
  };
}

/** 文章的四个字段；与系列同口径归一。 */
export function valuesOfArticle(article: ArticleMeta): MetaSyncValues {
  return {
    authorIds: [...article.authorIds],
    translatorIds: [...article.translatorIds],
    coverImageId: article.coverImageId ?? '',
    sourceUrl: text(article.sourceUrl ?? ''),
  };
}

/**
 * 哪些字段值得同步：新值非空、且与旧值不同。
 *
 * 按 `SERIES_AUTO_FILL_FIELDS` 的声明顺序返回，弹窗与表单里的复选框顺序因此稳定。
 * `after` 为空表示用户在清空该字段，没有值可写，不算触发。
 */
export function triggeredMetaSyncFields(
  before: MetaSyncBefore,
  after: MetaSyncBefore,
): SeriesAutoFillField[] {
  return SERIES_AUTO_FILL_FIELDS.filter(
    (field) => !isEmptyField(after, field) && !sameField(before, after, field),
  );
}

/**
 * 逐篇、逐字段算出待确认的改动。
 *
 * 外层遍历 `before.articleIds`（顺序即系列顺序）、内层遍历 `triggered`（字段声明顺序），
 * 所以返回顺序是「按篇目，再按字段」。本次新加入的篇目不在 `before.articleIds` 里，自然不进清单；
 * 悬空 id 与「文章已是该值」都跳过。`before` 为 null（新建系列）没有可问的对象，返回空数组。
 */
export function computeMetaSyncCandidates(
  snapshot: DBSnapshot,
  before: MetaSyncBefore | null,
  after: MetaSyncBefore,
  triggered: readonly SeriesAutoFillField[],
): MetaSyncCandidate[] {
  if (!before) return [];

  const candidates: MetaSyncCandidate[] = [];
  for (const articleId of before.articleIds) {
    const article = snapshot.maps.articles.get(articleId);
    if (!article) continue;
    const articleValues = valuesOfArticle(article);
    for (const field of triggered) {
      if (isEmptyField(after, field) || sameField(articleValues, after, field)) continue;
      candidates.push({
        articleId,
        field,
        kind: isEmptyField(articleValues, field) ? 'fill' : 'replace',
      });
    }
  }
  return candidates;
}

/** 字段值的展示串：作者 / 译者取显示名，封面取说明，原出处原样。空值返回空串。 */
function metaSyncValueLabel(
  snapshot: DBSnapshot,
  values: MetaSyncValues,
  field: SeriesAutoFillField,
): string {
  switch (field) {
    case 'author':
      return personLabel(snapshot, values.authorIds);
    case 'translator':
      return personLabel(snapshot, values.translatorIds);
    case 'cover': {
      const imageId = text(values.coverImageId);
      if (!imageId) return '';
      return snapshot.maps.images.get(imageId)?.caption ?? imageId;
    }
    case 'sourceUrl':
      return text(values.sourceUrl);
  }
}

/** 作者 / 译者 id 列表 → 显示名，用顿号连接；映射不到时退回 id。 */
function personLabel(snapshot: DBSnapshot, personIds: readonly string[]): string {
  return personIds
    .map((personId) => snapshot.maps.authors.get(personId)?.canonicalName ?? personId)
    .join('、');
}

/**
 * 把候选按「字段 + 种类 + 文章原值」分组，供弹窗分块展示。
 *
 * 组键 = `field + '\u0000' + kind + '\u0000' + fromLabel`；补全组的 `fromLabel` 固定为
 * 「（未填写）」。输出先所有补全组、再所有替换组，各自按字段声明顺序；同字段同种类内
 * 按 `fromLabel` 首次出现的顺序（也就是系列顺序）。
 */
export function groupMetaSyncCandidates(
  snapshot: DBSnapshot,
  candidates: readonly MetaSyncCandidate[],
  before: MetaSyncBefore,
  after: MetaSyncBefore,
): MetaSyncGroup[] {
  const members = new Set(before.articleIds);
  const groups = new Map<string, MetaSyncGroup>();

  for (const candidate of candidates) {
    if (!members.has(candidate.articleId)) continue;
    const article = snapshot.maps.articles.get(candidate.articleId);
    if (!article) continue;
    const fromLabel =
      candidate.kind === 'fill'
        ? EMPTY_LABEL
        : metaSyncValueLabel(snapshot, valuesOfArticle(article), candidate.field);
    const key = `${candidate.field}\u0000${candidate.kind}\u0000${fromLabel}`;
    const group = groups.get(key);
    if (group) {
      group.items.push(candidate);
      continue;
    }
    groups.set(key, {
      key,
      field: candidate.field,
      kind: candidate.kind,
      fromLabel,
      toLabel: metaSyncValueLabel(snapshot, after, candidate.field),
      items: [candidate],
    });
  }

  const kindOrder: Record<MetaSyncGroup['kind'], number> = { fill: 0, replace: 1 };
  const fieldOrder = new Map(SERIES_AUTO_FILL_FIELDS.map((field, index) => [field, index]));
  return [...groups.values()].sort(
    (a, b) =>
      kindOrder[a.kind] - kindOrder[b.kind] ||
      (fieldOrder.get(a.field) ?? 0) - (fieldOrder.get(b.field) ?? 0),
  );
}

/** 弹窗里单个复选框的键（存进 `Set` 用），文章与字段用 NUL 拼接。 */
export function metaSyncKey(articleId: string, field: SeriesAutoFillField): string {
  return `${articleId}\u0000${field}`;
}
