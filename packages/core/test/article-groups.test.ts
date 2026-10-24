import { makeArticle, makeDatabase, makeSeries } from '@tpr/schema/testing';
import { describe, expect, it } from 'vitest';
import { groupArticlesBySeries } from '../src/db/article-groups.js';
import { toSnapshot } from '../src/db/snapshot.js';

describe('groupArticlesBySeries（文章库同系列折叠）', () => {
  it('同一系列 >=2 篇时在首个成员位置成组，组内保持入参顺序与系列序号', () => {
    const db = makeDatabase();
    const snapshot = toSnapshot(db);
    const short = snapshot.articles.find((article) => article.type === 'short');
    const first = snapshot.articles.find((article) => article.title === '系列第一篇');
    const second = snapshot.articles.find((article) => article.title === '系列第二篇');
    expect(short && first && second).toBeTruthy();
    if (!short || !first || !second) return;

    const rows = groupArticlesBySeries(snapshot, [second, short, first]);
    expect(rows.map((row) => row.kind)).toEqual(['group', 'article']);

    const group = rows[0];
    if (group?.kind !== 'group') throw new Error('expected group');
    expect(group.series.id).toBe(db.series[0]?.id);
    expect(group.items.map((item) => item.article.id)).toEqual([second.id, first.id]);
    expect(group.items.map((item) => item.position)).toEqual([2, 1]);

    expect(rows[1]).toEqual({ kind: 'article', item: { article: short, position: null } });
  });

  it('当前结果集里只有 1 篇同系列文章时不成组', () => {
    const snapshot = toSnapshot(makeDatabase());
    const short = snapshot.articles.find((article) => article.type === 'short');
    const first = snapshot.articles.find((article) => article.title === '系列第一篇');
    expect(short && first).toBeTruthy();
    if (!short || !first) return;

    const rows = groupArticlesBySeries(snapshot, [first, short]);
    expect(rows.map((row) => row.kind)).toEqual(['article', 'article']);
    expect(rows[0]).toEqual({ kind: 'article', item: { article: first, position: 1 } });
    expect(rows[1]).toEqual({ kind: 'article', item: { article: short, position: null } });
  });

  it('悬空 seriesId 不参与分组，按单篇保留', () => {
    const db = makeDatabase();
    const orphan = makeArticle({
      id: 'a_0000000000000099',
      type: 'series-entry',
      title: '悬空系列文章',
      seriesId: 's_ffffffffffffffff',
    });
    const snapshot = toSnapshot({ ...db, articles: [...db.articles, orphan] });

    const rows = groupArticlesBySeries(snapshot, [orphan]);
    expect(rows).toEqual([{ kind: 'article', item: { article: orphan, position: null } }]);
  });

  it('文章不在 series.articleIds 里时仍随系列成组，但 position 为 null', () => {
    const db = makeDatabase();
    const series = db.series[0];
    expect(series).toBeTruthy();
    if (!series) return;
    const firstId = series.articleIds[0];
    expect(firstId).toBeTruthy();
    if (!firstId) return;
    db.series = [{ ...series, articleIds: [firstId] }];
    const snapshot = toSnapshot(db);

    const first = snapshot.articles.find((article) => article.id === firstId);
    const second = snapshot.articles.find((article) => article.title === '系列第二篇');
    expect(first && second).toBeTruthy();
    if (!first || !second) return;

    const rows = groupArticlesBySeries(snapshot, [first, second]);
    const group = rows[0];
    if (group?.kind !== 'group') throw new Error('expected group');
    expect(group.items.map((item) => item.position)).toEqual([1, null]);
  });

  it('不同系列各自成组，组位置取各自首个成员的位置', () => {
    const db = makeDatabase();
    const seriesB = makeSeries({ id: 's_0000000000000099', title: '另一个系列' });
    const b1 = makeArticle({
      id: 'a_0000000000000091',
      type: 'series-entry',
      title: 'B 第一篇',
      seriesId: seriesB.id,
    });
    const b2 = makeArticle({
      id: 'a_0000000000000092',
      type: 'series-entry',
      title: 'B 第二篇',
      seriesId: seriesB.id,
    });
    db.series = [...db.series, { ...seriesB, articleIds: [b1.id, b2.id] }];
    db.articles = [...db.articles, b1, b2];
    const snapshot = toSnapshot(db);

    const seriesA = db.series[0];
    expect(seriesA).toBeTruthy();
    if (!seriesA) return;
    const a1 = snapshot.articles.find((article) => article.id === seriesA.articleIds[0]);
    const a2 = snapshot.articles.find((article) => article.id === seriesA.articleIds[1]);
    expect(a1 && a2).toBeTruthy();
    if (!a1 || !a2) return;

    const rows = groupArticlesBySeries(snapshot, [b1, a1, b2, a2]);
    expect(rows.map((row) => (row.kind === 'group' ? row.series.id : 'article'))).toEqual([
      seriesB.id,
      seriesA.id,
    ]);
  });

  it('空输入返回空数组，且不修改入参', () => {
    const snapshot = toSnapshot(makeDatabase());
    const input = snapshot.articles.slice(0, 2);
    const copy = [...input];

    expect(groupArticlesBySeries(snapshot, [])).toEqual([]);
    groupArticlesBySeries(snapshot, input);
    expect(input).toEqual(copy);
  });
});
