import { makeSeries } from '@tpr/schema/testing';
import { describe, expect, it } from 'vitest';
import { prefillFromSeries, type SeriesPrefillValues } from '../src/editor/series-prefill.js';

/** 新建文章时的空表单。 */
const EMPTY: SeriesPrefillValues = {
  authorIds: [],
  translatorIds: [],
  coverImageId: '',
  sourceUrl: '',
};

describe('series-prefill: 按系列策略预填表单', () => {
  it('空表单选中带策略的系列时，把作者与封面填进表单', () => {
    const host = makeSeries({
      autoFillFields: ['author', 'cover'],
      authorIds: ['p_author000001'],
      coverImageId: 'i_cover000000001',
    });

    const result = prefillFromSeries(host, EMPTY, {});

    expect(result.values).toEqual({
      authorIds: ['p_author000001'],
      translatorIds: [],
      coverImageId: 'i_cover000000001',
      sourceUrl: '',
    });
    // 顺序固定为 SERIES_AUTO_FILL_FIELDS 的声明顺序
    expect(result.filled).toEqual(['cover', 'author']);
    expect(result.reverted).toEqual([]);
    expect(result.trace).toEqual({
      coverImageId: 'i_cover000000001',
      authorIds: ['p_author000001'],
    });
  });

  it('表单里已有值的字段不被覆盖，其余空字段照填', () => {
    const host = makeSeries({
      autoFillFields: ['author', 'translator', 'cover'],
      authorIds: ['p_series000001'],
      translatorIds: ['p_series000002'],
      coverImageId: 'i_series00000001',
    });

    const result = prefillFromSeries(host, { ...EMPTY, authorIds: ['p_mine000000001'] }, {});

    expect(result.values.authorIds).toEqual(['p_mine000000001']);
    expect(result.values.translatorIds).toEqual(['p_series000002']);
    expect(result.values.coverImageId).toEqual('i_series00000001');
    expect(result.filled).toEqual(['cover', 'translator']);
    expect(result.trace).toEqual({
      coverImageId: 'i_series00000001',
      translatorIds: ['p_series000002'],
    });
  });

  it('系列没开自动填策略时什么都不做', () => {
    const host = makeSeries({ autoFillFields: [], authorIds: ['p_series000001'] });

    const result = prefillFromSeries(host, EMPTY, {});

    expect(result.values).toEqual(EMPTY);
    expect(result.filled).toEqual([]);
    expect(result.trace).toEqual({});
  });

  it('策略里有该字段但系列本身没值时不填', () => {
    const host = makeSeries({ autoFillFields: ['cover', 'sourceUrl'] });

    const result = prefillFromSeries(host, EMPTY, {});

    expect(result.values).toEqual(EMPTY);
    expect(result.filled).toEqual([]);
    expect(result.trace).toEqual({});
  });

  it('换到不开该策略的系列时，把上一次预填的值撤回', () => {
    const a = makeSeries({ autoFillFields: ['author'], authorIds: ['p_a00000000001'] });
    const b = makeSeries({ autoFillFields: ['cover'], coverImageId: 'i_b00000000001' });

    const first = prefillFromSeries(a, EMPTY, {});
    expect(first.values.authorIds).toEqual(['p_a00000000001']);

    const second = prefillFromSeries(b, first.values, first.trace);

    expect(second.values.authorIds).toEqual([]);
    expect(second.values.coverImageId).toEqual('i_b00000000001');
    expect(second.reverted).toEqual(['author']);
    expect(second.filled).toEqual(['cover']);
    expect(second.trace).toEqual({ coverImageId: 'i_b00000000001' });
  });

  it('用户手动改过的字段既不撤回也不覆盖', () => {
    const a = makeSeries({ autoFillFields: ['author'], authorIds: ['p_a00000000001'] });
    const b = makeSeries({ autoFillFields: [], authorIds: ['p_b00000000002'] });

    const first = prefillFromSeries(a, EMPTY, {});
    const edited = { ...first.values, authorIds: ['p_mine000000001'] };

    const second = prefillFromSeries(b, edited, first.trace);

    expect(second.values.authorIds).toEqual(['p_mine000000001']);
    expect(second.reverted).toEqual([]);
  });

  it('选回「不属于系列」时撤回全部预填', () => {
    const host = makeSeries({
      autoFillFields: ['author', 'cover', 'sourceUrl'],
      authorIds: ['p_a00000000001'],
      coverImageId: 'i_a00000000001',
      sourceUrl: 'https://example.com/a',
    });

    const first = prefillFromSeries(host, EMPTY, {});
    const second = prefillFromSeries(null, first.values, first.trace);

    expect(second.values).toEqual(EMPTY);
    expect(second.reverted).toEqual(['cover', 'author', 'sourceUrl']);
    expect(second.trace).toEqual({});
  });

  it('数组按集合比较：换序后仍认作「我写的」，可以撤回', () => {
    const a = makeSeries({
      autoFillFields: ['author'],
      authorIds: ['p_a00000000001', 'p_b00000000002'],
    });

    const first = prefillFromSeries(a, EMPTY, {});
    const reordered = { ...first.values, authorIds: ['p_b00000000002', 'p_a00000000001'] };

    const second = prefillFromSeries(null, reordered, first.trace);

    expect(second.values.authorIds).toEqual([]);
    expect(second.reverted).toEqual(['author']);
  });

  it('原出处按 trim 后比较：只多打了空格不算用户改动', () => {
    const host = makeSeries({
      autoFillFields: ['sourceUrl'],
      sourceUrl: 'https://example.com/src',
    });

    const first = prefillFromSeries(host, EMPTY, {});
    const padded = { ...first.values, sourceUrl: '  https://example.com/src  ' };

    const second = prefillFromSeries(null, padded, first.trace);

    expect(second.values.sourceUrl).toEqual('');
    expect(second.reverted).toEqual(['sourceUrl']);
  });

  it('不改动入参', () => {
    const host = makeSeries({ autoFillFields: ['author'], authorIds: ['p_a00000000001'] });
    const current: SeriesPrefillValues = { ...EMPTY, authorIds: [] };
    const trace = {};

    prefillFromSeries(host, current, trace);

    expect(current).toEqual(EMPTY);
    expect(trace).toEqual({});
  });
});
