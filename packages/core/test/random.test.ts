import { makeArticle, makeDatabase, makeSeries } from '@tpr/schema/testing';
import { describe, expect, it } from 'vitest';
import { toSnapshot } from '../src/db/snapshot.js';
import { randomOne, tenPull, type Rng } from '../src/random/index.js';

/** 固定序列 rng，循环使用。 */
const seq = (values: number[]): Rng => {
  let index = 0;
  return () => {
    const value = values[index % values.length] ?? 0;
    index += 1;
    return value;
  };
};

function seriesDb(seriesCount: number, each: number, shorts: number) {
  const articles = [];
  const series = [];
  for (let s = 0; s < seriesCount; s += 1) {
    const id = `s_${String(s).padStart(16, '0')}`;
    const ids = [];
    for (let a = 0; a < each; a += 1) {
      const article = makeArticle({ id: `a_${s}${String(a).padStart(15, '0')}`, type: 'series-entry', seriesId: id });
      articles.push(article);
      ids.push(article.id);
    }
    series.push(makeSeries({ id, title: `系列 ${s}`, articleIds: ids }));
  }
  for (let i = 0; i < shorts; i += 1) {
    articles.push(makeArticle({ id: `a_short${String(i).padStart(11, '0')}` }));
  }
  return toSnapshot(makeDatabase({ articles, series }));
}

describe('randomOne', () => {
  it('从全部文章里抽，空库返回 null', () => {
    const empty = toSnapshot(makeDatabase({ articles: [] }));
    expect(randomOne(empty)).toBeNull();

    const single = toSnapshot(makeDatabase({ articles: [makeArticle({ id: 'a_0000000000000001' })] }));
    expect(randomOne(single)?.id).toBe('a_0000000000000001');

    const many = seriesDb(2, 2, 3);
    const seen = new Set<string>();
    for (let i = 0; i < 200; i += 1) seen.add(randomOne(many)?.id ?? '');
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe('tenPull', () => {
  it('1000 次抽取中同 seriesId 不重复', () => {
    const snapshot = seriesDb(6, 3, 4);
    const rng = Math.random;
    for (let i = 0; i < 1000; i += 1) {
      const { picks } = tenPull(snapshot, rng, 10);
      const seriesIds = picks.map((article) => article.seriesId).filter((id): id is string => Boolean(id));
      expect(new Set(seriesIds).size).toBe(seriesIds.length);
      const ids = picks.map((article) => article.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('组数不足时按实际数量返回并标记 depleted', () => {
    const snapshot = seriesDb(2, 2, 1);
    const { picks, depleted, groupCount } = tenPull(snapshot, seq([0, 0.5, 0.999]), 10);
    expect(picks).toHaveLength(3);
    expect(groupCount).toBe(3);
    expect(depleted).toBe(true);
  });

  it('同一 rng 序列结果可重现', () => {
    const snapshot = seriesDb(4, 2, 6);
    const a = tenPull(snapshot, seq([0.1, 0.7, 0.3, 0.9]), 10);
    const b = tenPull(snapshot, seq([0.1, 0.7, 0.3, 0.9]), 10);
    expect(a.picks.map((article) => article.id)).toEqual(b.picks.map((article) => article.id));
    expect(a.depleted).toBe(b.depleted);
  });

  it('刚好够 10 组时不 depleted，短篇各占一组', () => {
    const snapshot = seriesDb(0, 0, 10);
    const result = tenPull(snapshot, seq([0.5]), 10);
    expect(result.picks).toHaveLength(10);
    expect(result.groupCount).toBe(10);
    expect(result.depleted).toBe(false);
  });

  it('空库返回空结果', () => {
    const snapshot = toSnapshot(makeDatabase({ articles: [] }));
    expect(tenPull(snapshot)).toEqual({ picks: [], depleted: true, groupCount: 0 });
  });

  it('2 万篇性能 ≤ 20ms', () => {
    const articles = Array.from({ length: 20000 }, (_, i) =>
      makeArticle({
        id: `a_${String(i).padStart(16, '0')}`,
        type: i % 4 === 0 ? 'short' : 'series-entry',
        ...(i % 4 === 0 ? {} : { seriesId: `s_${String(Math.floor(i / 4)).padStart(16, '0')}` }),
      }),
    );
    const series = Array.from({ length: 5000 }, (_, s) =>
      makeSeries({
        id: `s_${String(s).padStart(16, '0')}`,
        articleIds: [0, 1, 2, 3].map((k) => `a_${String(s * 4 + k).padStart(16, '0')}`),
      }),
    );
    const snapshot = toSnapshot(makeDatabase({ articles, series }));
    // 并行跑测试时 CPU 会被抢，取 3 次里最快的一次（设计目标 ≤ 20ms）
    let best = Number.POSITIVE_INFINITY;
    let result = tenPull(snapshot);
    for (let i = 0; i < 3; i += 1) {
      const start = performance.now();
      result = tenPull(snapshot);
      best = Math.min(best, performance.now() - start);
    }
    expect(result.picks).toHaveLength(10);
    expect(best).toBeLessThan(20);
  });
});
