import { makeArticle, makeDatabase, makeFeatured, makeImage, makeSeries } from '@tpr/schema/testing';
import { describe, expect, it } from 'vitest';
import { getFeaturedCards } from '../src/db/featured.js';
import { toSnapshot } from '../src/db/snapshot.js';

const join = (...parts: string[]): string => parts.join('/');
const opts = { dir: 'ws/db_0001', join };

function fixture() {
  const cover = makeImage({ id: 'i_0000000000000001', file: 'images/cover/c.webp' });
  const short = makeArticle({ id: 'a_0000000000000001', title: '精选短篇', coverImageId: cover.id });
  const entry = makeArticle({
    id: 'a_0000000000000002',
    title: '系列条目',
    type: 'series-entry',
    seriesId: 's_0000000000000001',
  });
  const series = makeSeries({ id: 's_0000000000000001', title: '精选系列', articleIds: [entry.id] });
  const db = makeDatabase(
    {
      images: [cover],
      articles: [short, entry],
      series: [series],
      featured: [
        makeFeatured({
          targetType: 'article',
          targetId: short.id,
          recommendations: [
            { author: '推荐人甲', text: '第一条推荐语' },
            { text: '没有署名的推荐语' },
          ],
        }),
        makeFeatured({ targetType: 'article', targetId: 'a_ffffffffffffffff', recommendations: [] }),
        makeFeatured({ targetType: 'article', targetId: entry.id, recommendations: [{ text: '条目推荐' }] }),
        makeFeatured({ targetType: 'series', targetId: series.id, recommendations: [{ text: '系列推荐' }] }),
        makeFeatured({ targetType: 'series', targetId: 's_ffffffffffffffff', recommendations: [] }),
      ],
    },
    { withFiles: true },
  );
  return { db, cover, short, series };
}

describe('getFeaturedCards · 短篇页', () => {
  it('只取 article 目标，保留全部推荐语与封面', () => {
    const { db, cover, short } = fixture();
    const cards = getFeaturedCards(toSnapshot(db), opts, 'short');
    expect(cards).toHaveLength(3);

    const ok = cards.find((card) => card.targetId === short.id);
    expect(ok?.status).toBe('ok');
    expect(ok?.to).toBe(`/article/${short.id}`);
    expect(ok?.recommendations.map((r) => r.text)).toEqual(['第一条推荐语', '没有署名的推荐语']);
    expect(ok?.recommendations[0]?.author).toBe('推荐人甲');
    expect(ok?.cover?.path).toBe(`${opts.dir}/images/cover/c.webp`);
    expect(ok?.cover?.id).toBe(cover.id);
  });

  it('目标丢失：保留卡片并给出原因，不抛错', () => {
    const { db } = fixture();
    const cards = getFeaturedCards(toSnapshot(db), opts, 'short');
    const missing = cards.find((card) => card.targetId === 'a_ffffffffffffffff');
    expect(missing?.status).toBe('missing');
    expect(missing?.to).toBeNull();
    expect(missing?.reason).toContain('不存在');
  });

  it('系列条目出现在短篇页时提示去系列页', () => {
    const { db } = fixture();
    const cards = getFeaturedCards(toSnapshot(db), opts, 'short');
    const entry = cards.find((card) => card.targetId === 'a_0000000000000002');
    expect(entry?.status).toBe('missing');
    expect(entry?.reason).toContain('精选系列');
    // 仍保留可点的文章链接，方便用户跳过去
    expect(entry?.to).toBe('/article/a_0000000000000002');
  });
});

describe('getFeaturedCards · 系列页', () => {
  it('解析系列卡片并跳过 article 目标', () => {
    const { db, series } = fixture();
    const cards = getFeaturedCards(toSnapshot(db), opts, 'series');
    expect(cards.map((card) => card.targetId)).toEqual([series.id, 's_ffffffffffffffff']);
    expect(cards[0]?.status).toBe('ok');
    expect(cards[0]?.to).toBe(`/series/${series.id}`);
    expect(cards[0]?.recommendations).toHaveLength(1);
    expect(cards[1]?.status).toBe('missing');
  });
});
