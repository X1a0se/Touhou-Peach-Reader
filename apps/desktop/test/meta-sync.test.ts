import { toSnapshot, type DBSnapshot } from '@tpr/core';
import { makeDatabase, makeImage, makeSeries } from '@tpr/schema/testing';
import { describe, expect, it } from 'vitest';
import {
  computeMetaSyncCandidates,
  groupMetaSyncCandidates,
  metaSyncKey,
  triggeredMetaSyncFields,
  valuesOfArticle,
  valuesOfSeries,
  type MetaSyncBefore,
} from '../src/editor/meta-sync.js';

const EMPTY_VALUES = { authorIds: [], translatorIds: [], coverImageId: '', sourceUrl: '' };

/**
 * makeDatabase() 的系列有 2 篇（第 1 篇有封面，第 2 篇没有）+ 1 篇短篇。
 * 这里给第 1 篇换上一张带 caption 的旧封面，并多备一张新封面，方便断言显示名。
 */
function setup(): {
  snapshot: DBSnapshot;
  entry1Id: string;
  entry2Id: string;
  shortId: string;
  authorId: string;
  newCoverId: string;
} {
  const raw = makeDatabase();
  const series = raw.series[0]!;
  const entry1Id = series.articleIds[0]!;
  const entry2Id = series.articleIds[1]!;
  const oldCover = makeImage({ caption: '旧封面' });
  const newCover = makeImage({ caption: '新封面' });
  raw.images = [...raw.images, oldCover, newCover];
  raw.articles = raw.articles.map((article) =>
    article.id === entry1Id ? { ...article, coverImageId: oldCover.id } : article,
  );
  const shortId = raw.articles.find((article) => article.type === 'short')!.id;
  return {
    snapshot: toSnapshot(raw),
    entry1Id,
    entry2Id,
    shortId,
    authorId: raw.authors[0]!.id,
    newCoverId: newCover.id,
  };
}

describe('meta-sync: 触发字段', () => {
  it('空→有值、值不同都算触发；清除与只改简介不算', () => {
    const base: MetaSyncBefore = { articleIds: [], ...EMPTY_VALUES };
    expect(triggeredMetaSyncFields(base, { ...base, authorIds: ['p_1'] })).toEqual(['author']);
    expect(
      triggeredMetaSyncFields({ ...base, authorIds: ['p_1'] }, { ...base, authorIds: ['p_2'] }),
    ).toEqual(['author']);
    expect(triggeredMetaSyncFields({ ...base, authorIds: ['p_1'] }, base)).toEqual([]);
    expect(triggeredMetaSyncFields(base, base)).toEqual([]);
  });

  it('同一集合换个顺序不算变化', () => {
    const before: MetaSyncBefore = { articleIds: [], ...EMPTY_VALUES, authorIds: ['p_1', 'p_2'] };
    expect(triggeredMetaSyncFields(before, { ...before, authorIds: ['p_2', 'p_1'] })).toEqual([]);
  });

  it('同一集合里的重复项也不算变化', () => {
    const before: MetaSyncBefore = { articleIds: [], ...EMPTY_VALUES, authorIds: ['p_1'] };
    expect(triggeredMetaSyncFields(before, { ...before, authorIds: ['p_1', 'p_1'] })).toEqual([]);
  });

  it('按字段声明顺序返回，与表单里的复选框顺序一致', () => {
    const base: MetaSyncBefore = { articleIds: [], ...EMPTY_VALUES };
    const after: MetaSyncBefore = {
      ...base,
      sourceUrl: 'https://example.com/a',
      coverImageId: 'i_0123456789abcdef',
      translatorIds: ['p_1'],
      authorIds: ['p_2'],
    };
    expect(triggeredMetaSyncFields(base, after)).toEqual([
      'cover',
      'author',
      'translator',
      'sourceUrl',
    ]);
  });
});

describe('meta-sync: 候选', () => {
  it('空→fill，不同→replace，一致与未触发字段都不列', () => {
    const f = setup();
    const before: MetaSyncBefore = { articleIds: [f.entry1Id, f.entry2Id], ...EMPTY_VALUES };
    const after: MetaSyncBefore = {
      articleIds: [f.entry1Id, f.entry2Id],
      ...EMPTY_VALUES,
      authorIds: [f.authorId],
      coverImageId: f.newCoverId,
    };

    expect(computeMetaSyncCandidates(f.snapshot, before, after, ['author', 'cover'])).toEqual([
      { articleId: f.entry1Id, field: 'cover', kind: 'replace' },
      { articleId: f.entry2Id, field: 'cover', kind: 'fill' },
    ]);
  });

  it('本次新加入的篇目不进清单', () => {
    const f = setup();
    const before: MetaSyncBefore = { articleIds: [f.entry1Id, f.entry2Id], ...EMPTY_VALUES };
    const after: MetaSyncBefore = {
      articleIds: [f.entry1Id, f.entry2Id, f.shortId],
      ...EMPTY_VALUES,
      coverImageId: f.newCoverId,
    };
    const candidates = computeMetaSyncCandidates(f.snapshot, before, after, ['cover']);
    expect(candidates).toEqual([
      { articleId: f.entry1Id, field: 'cover', kind: 'replace' },
      { articleId: f.entry2Id, field: 'cover', kind: 'fill' },
    ]);
  });

  it('悬空的文章 id 跳过，新建系列（before 为 null）无候选', () => {
    const f = setup();
    const before: MetaSyncBefore = {
      articleIds: ['a_0000000000000000', f.entry1Id],
      ...EMPTY_VALUES,
    };
    const after: MetaSyncBefore = { ...before, ...EMPTY_VALUES, coverImageId: f.newCoverId };
    expect(computeMetaSyncCandidates(f.snapshot, before, after, ['cover'])).toEqual([
      { articleId: f.entry1Id, field: 'cover', kind: 'replace' },
    ]);
    expect(computeMetaSyncCandidates(f.snapshot, null, after, ['cover'])).toEqual([]);
  });

  it('新值为空时不产生候选', () => {
    const f = setup();
    const before: MetaSyncBefore = { articleIds: [f.entry1Id], ...EMPTY_VALUES };
    const after: MetaSyncBefore = { articleIds: [f.entry1Id], ...EMPTY_VALUES };
    expect(computeMetaSyncCandidates(f.snapshot, before, after, ['cover', 'author'])).toEqual([]);
  });
});

describe('meta-sync: 分组', () => {
  it('补全组在前、组内保持系列顺序，标签取显示名', () => {
    const f = setup();
    const before: MetaSyncBefore = { articleIds: [f.entry1Id, f.entry2Id], ...EMPTY_VALUES };
    const after: MetaSyncBefore = { ...before, ...EMPTY_VALUES, coverImageId: f.newCoverId };
    const candidates = computeMetaSyncCandidates(f.snapshot, before, after, ['cover']);
    const groups = groupMetaSyncCandidates(f.snapshot, candidates, before, after);

    expect(
      groups.map((group) => [
        group.kind,
        group.field,
        group.fromLabel,
        group.toLabel,
        group.items.map((item) => item.articleId),
      ]),
    ).toEqual([
      ['fill', 'cover', '（未填写）', '新封面', [f.entry2Id]],
      ['replace', 'cover', '旧封面', '新封面', [f.entry1Id]],
    ]);
  });
});

describe('meta-sync: 取值与键', () => {
  it('valuesOfSeries / valuesOfArticle 把可选字段归一成空串', () => {
    const f = setup();
    expect(valuesOfSeries(makeSeries({ authorIds: [f.authorId] }))).toEqual({
      authorIds: [f.authorId],
      translatorIds: [],
      coverImageId: '',
      sourceUrl: '',
    });
    const entry2 = f.snapshot.maps.articles.get(f.entry2Id)!;
    expect(valuesOfArticle(entry2).coverImageId).toBe('');
  });

  it('metaSyncKey 用 NUL 拼接文章与字段', () => {
    expect(metaSyncKey('a_1', 'author')).toBe('a_1\u0000author');
  });
});
