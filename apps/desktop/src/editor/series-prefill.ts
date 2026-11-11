/**
 * 文章表单的系列预填（Goal 29）：新建文章选中系列时，立刻按该系列的
 * `autoFillFields` 策略把空字段填进表单，让用户在保存前就看见继承结果。
 *
 * 与 core 的 `fillFromSeries` 同一套口径——只填空、不覆盖。区别是这里还多记一份
 * 「这个值是我预填进去的」，换系列或取消系列时只撤回自己写过的值，用户手动改过的
 * 一律不动。
 *
 * 纯逻辑：不碰 React / DOM / 磁盘。
 */
import { SERIES_AUTO_FILL_FIELDS, type Series, type SeriesAutoFillField } from '@tpr/schema';
import { isEmptyField, type MetaSyncValues, valuesOfSeries } from './meta-sync.js';

/** 参与预填的四个字段的表单态；封面与原出处用空串表示「没填」，与表单 state 一致。 */
export type SeriesPrefillValues = MetaSyncValues;

/** 预填留下的痕迹：字段 → 当初写进去的值。 */
export type SeriesPrefillTrace = Partial<SeriesPrefillValues>;

export interface SeriesPrefillResult {
  values: SeriesPrefillValues;
  trace: SeriesPrefillTrace;
  /** 这一次实际写进表单的字段。 */
  filled: SeriesAutoFillField[];
  /** 这一次被撤回（还原成空）的字段。 */
  reverted: SeriesAutoFillField[];
}

/** 原出处可以带空格输入，比较时一律按 trim 后算（与 Goal 28 的落盘口径一致）。 */
function text(value: string): string {
  return value.trim();
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...left].every((id) => right.has(id));
}

/** 表单当前值是否仍然等于当初预填进去的那个值。 */
function sameValueAs(
  values: SeriesPrefillValues,
  written: SeriesPrefillTrace,
  field: SeriesAutoFillField,
): boolean {
  switch (field) {
    case 'cover':
      return written.coverImageId !== undefined &&
        text(values.coverImageId) === text(written.coverImageId);
    case 'author':
      return written.authorIds !== undefined && sameIds(values.authorIds, written.authorIds);
    case 'translator':
      return written.translatorIds !== undefined &&
        sameIds(values.translatorIds, written.translatorIds);
    case 'sourceUrl':
      return written.sourceUrl !== undefined && text(values.sourceUrl) === text(written.sourceUrl);
  }
}

/** 忘掉某个字段的预填痕迹。注意 trace 的键名是 `coverImageId` / `authorIds` 这套，不是字段名。 */
function forgetTrace(trace: SeriesPrefillTrace, field: SeriesAutoFillField): void {
  switch (field) {
    case 'cover':
      delete trace.coverImageId;
      return;
    case 'author':
      delete trace.authorIds;
      return;
    case 'translator':
      delete trace.translatorIds;
      return;
    case 'sourceUrl':
      delete trace.sourceUrl;
      return;
  }
}

/** 把某个字段还原成「没填」。 */
function clearField(values: SeriesPrefillValues, field: SeriesAutoFillField): void {
  switch (field) {
    case 'cover':
      values.coverImageId = '';
      return;
    case 'author':
      values.authorIds = [];
      return;
    case 'translator':
      values.translatorIds = [];
      return;
    case 'sourceUrl':
      values.sourceUrl = '';
      return;
  }
}

/** 把系列该字段的值写到表单上，并按写入值记账。 */
function applyField(
  values: SeriesPrefillValues,
  trace: SeriesPrefillTrace,
  series: MetaSyncValues,
  field: SeriesAutoFillField,
): void {
  switch (field) {
    case 'cover':
      values.coverImageId = series.coverImageId;
      trace.coverImageId = series.coverImageId;
      return;
    case 'author':
      values.authorIds = [...series.authorIds];
      trace.authorIds = [...series.authorIds];
      return;
    case 'translator':
      values.translatorIds = [...series.translatorIds];
      trace.translatorIds = [...series.translatorIds];
      return;
    case 'sourceUrl':
      values.sourceUrl = series.sourceUrl;
      trace.sourceUrl = series.sourceUrl;
      return;
  }
}

/**
 * 按系列策略预填表单。
 *
 * - `series` 为该系列；传 `null` 表示改选「不属于系列」，此时只撤回上一次的预填。
 * - `current` 是表单此刻的四个字段；`trace` 是上一次预填留下的痕迹。
 *
 * 顺序固定为 `SERIES_AUTO_FILL_FIELDS`：先把「仍是我写的」字段撤回，再按新系列重填，
 * 因此换系列时旧值不会残留。返回新对象，不改入参。
 */
export function prefillFromSeries(
  series: Series | null,
  current: SeriesPrefillValues,
  trace: SeriesPrefillTrace,
): SeriesPrefillResult {
  const values: SeriesPrefillValues = {
    authorIds: [...current.authorIds],
    translatorIds: [...current.translatorIds],
    coverImageId: current.coverImageId,
    sourceUrl: current.sourceUrl,
  };
  const nextTrace: SeriesPrefillTrace = { ...trace };
  const reverted: SeriesAutoFillField[] = [];
  const filled: SeriesAutoFillField[] = [];

  // 第一步：撤回上一次预填、且用户没改过的字段。
  for (const field of SERIES_AUTO_FILL_FIELDS) {
    if (!sameValueAs(values, nextTrace, field)) continue;
    clearField(values, field);
    reverted.push(field);
    forgetTrace(nextTrace, field);
  }

  // 第二步：按新系列的策略填空。
  if (series === null) return { values, trace: nextTrace, filled, reverted };
  const source = valuesOfSeries(series);
  for (const field of SERIES_AUTO_FILL_FIELDS) {
    if (!series.autoFillFields.includes(field)) continue;
    if (!isEmptyField(values, field)) continue;
    if (isEmptyField(source, field)) continue;
    applyField(values, nextTrace, source, field);
    filled.push(field);
  }

  return { values, trace: nextTrace, filled, reverted };
}
