/**
 * 精选页的数据准备（Goal 6）：每条 `FeaturedEntry` 解析成可直接渲染的卡片。
 * 目标丢失时**不丢条目**，而是标成 `missing` 并给出原因（design §15.2 Goal 6）。
 */
import type { FeaturedTargetType, Recommendation } from '@tpr/schema';
import type { DBSnapshot } from './snapshot.js';
import type { ImageRef } from './view.js';
import { resolveImageRef, type ViewOptions } from './view.js';

export type FeaturedPage = 'short' | 'series';

export interface FeaturedCard {
  /** `${targetType}:${targetId}`，列表 key */
  key: string;
  targetType: FeaturedTargetType;
  targetId: string;
  recommendations: Recommendation[];
  status: 'ok' | 'missing';
  /** status === 'missing' 时的中文原因 */
  reason: string | null;
  title: string;
  summary: string;
  cover: ImageRef | null;
  /** 可点进的哈希路由；失效时为 null */
  to: string | null;
  kindLabel: string | null;
}

export function getFeaturedCards(snapshot: DBSnapshot, opts: ViewOptions, page: FeaturedPage): FeaturedCard[] {
  const cards: FeaturedCard[] = [];

  for (const entry of snapshot.featured) {
    if (page === 'short' && entry.targetType !== 'article') continue;
    if (page === 'series' && entry.targetType !== 'series') continue;

    const key = `${entry.targetType}:${entry.targetId}`;

    if (entry.targetType === 'article') {
      const article = snapshot.maps.articles.get(entry.targetId);
      if (!article) {
        cards.push({
          key,
          targetType: entry.targetType,
          targetId: entry.targetId,
          recommendations: entry.recommendations,
          status: 'missing',
          reason: '目标文章不存在，可能已被删除或改名',
          title: entry.targetId,
          summary: '',
          cover: null,
          to: null,
          kindLabel: null,
        });
        continue;
      }
      if (article.type === 'series-entry') {
        cards.push({
          key,
          targetType: entry.targetType,
          targetId: entry.targetId,
          recommendations: entry.recommendations,
          status: 'missing',
          reason: '这篇文章属于某个系列，请到精选系列中查看',
          title: article.title,
          summary: article.summary,
          cover: article.coverImageId ? resolveImageRef(snapshot, opts, article.coverImageId) : null,
          to: `/article/${article.id}`,
          kindLabel: '系列条目',
        });
        continue;
      }
      cards.push({
        key,
        targetType: entry.targetType,
        targetId: entry.targetId,
        recommendations: entry.recommendations,
        status: 'ok',
        reason: null,
        title: article.title,
        summary: article.summary,
        cover: article.coverImageId ? resolveImageRef(snapshot, opts, article.coverImageId) : null,
        to: `/article/${article.id}`,
        kindLabel: '短篇',
      });
      continue;
    }

    const series = snapshot.maps.series.get(entry.targetId);
    if (!series) {
      cards.push({
        key,
        targetType: entry.targetType,
        targetId: entry.targetId,
        recommendations: entry.recommendations,
        status: 'missing',
        reason: '目标系列不存在，可能已被删除或改名',
        title: entry.targetId,
        summary: '',
        cover: null,
        to: null,
        kindLabel: null,
      });
      continue;
    }
    cards.push({
      key,
      targetType: entry.targetType,
      targetId: entry.targetId,
      recommendations: entry.recommendations,
      status: 'ok',
      reason: null,
      title: series.title,
      summary: series.summary,
      cover: series.coverImageId ? resolveImageRef(snapshot, opts, series.coverImageId) : null,
      to: `/series/${series.id}`,
      kindLabel: series.status === 'completed' ? '系列 · 已完结' : '系列 · 连载中',
    });
  }

  return cards;
}
