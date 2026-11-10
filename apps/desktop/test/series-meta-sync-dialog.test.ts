/**
 * 弹窗的渲染冒烟测试。
 *
 * 本仓库的桌面端测试历来只测纯逻辑（没有 jsdom / @testing-library），这里用
 * `react-dom/server` 的 `renderToStaticMarkup` 把组件渲染成静态 HTML —— 不需要 DOM，
 * 足以证明「真实形状的候选能渲染出来、文案与分组都在」。不校验样式与交互。
 */
import { toSnapshot, type DBSnapshot } from '@tpr/core';
import { makeDatabase, makeImage } from '@tpr/schema/testing';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SeriesMetaSyncDialog } from '../src/components/SeriesMetaSyncDialog.js';
import {
  computeMetaSyncCandidates,
  groupMetaSyncCandidates,
  type MetaSyncBefore,
} from '../src/editor/meta-sync.js';

const EMPTY_VALUES = { authorIds: [], translatorIds: [], coverImageId: '', sourceUrl: '' };

/** 系列 2 篇：第 1 篇换一张带 caption 的旧封面，再备一张新封面，用来区分补全与替换两组。 */
function build(): { snapshot: DBSnapshot; entry1Id: string; entry2Id: string; newCoverId: string } {
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
  return { snapshot: toSnapshot(raw), entry1Id, entry2Id, newCoverId: newCover.id };
}

function render(snapshot: DBSnapshot, before: MetaSyncBefore, after: MetaSyncBefore): string {
  const candidates = computeMetaSyncCandidates(snapshot, before, after, ['cover']);
  const groups = groupMetaSyncCandidates(snapshot, candidates, before, after);
  const articleTitles = new Map(
    [...snapshot.maps.articles].map(([id, article]) => [id, article.title]),
  );
  return renderToStaticMarkup(
    createElement(SeriesMetaSyncDialog, {
      seriesTitle: '示例系列',
      memberCount: 2,
      newMemberCount: 1,
      groups,
      articleTitles,
      autoFillFields: ['author'],
      onAutoFillFieldsChange: () => {},
      onConfirm: () => {},
      onSkip: () => {},
      onCancel: () => {},
    }),
  );
}

describe('SeriesMetaSyncDialog', () => {
  it('按候选渲染出补全与替换两个区块、显示名与三个按钮', () => {
    const f = build();
    const before: MetaSyncBefore = { articleIds: [f.entry1Id, f.entry2Id], ...EMPTY_VALUES };
    const after: MetaSyncBefore = { ...before, coverImageId: f.newCoverId };
    const html = render(f.snapshot, before, after);

    expect(html).toContain('补全空字段');
    expect(html).toContain('替换已有值');
    expect(html).toContain('旧封面');
    expect(html).toContain('新封面');
    expect(html).toContain('同步并保存');
    expect(html).toContain('仅保存系列');
    expect(html).toContain('取消');
  });

  it('交代本次新加入的篇数，并带上「未来自动填上」的四个复选框', () => {
    const f = build();
    const before: MetaSyncBefore = { articleIds: [f.entry1Id, f.entry2Id], ...EMPTY_VALUES };
    const after: MetaSyncBefore = { ...before, coverImageId: f.newCoverId };
    const html = render(f.snapshot, before, after);

    expect(html).toContain('另有 1 篇');
    expect(html).toContain('未来加入本系列的文章自动填上');
    for (const label of ['封面', '作者', '译者', '原出处']) expect(html).toContain(label);
    // 勾选状态由 autoFillFields 决定：传的是 ['author']，所以只有作者那个框是勾上的
    expect(html).toMatch(/id="series-meta-sync-dialog-author"[^>]*checked=""/);
    expect(html).not.toMatch(/id="series-meta-sync-dialog-cover"[^>]*checked=""/);
  });
});
