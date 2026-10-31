import { normalizeName, type RawDatabase, type Tag, type TagCategory } from '@tpr/schema';

export interface MergedTagGroup {
  name: string;
  category: TagCategory;
  targetId: string;
  removedIds: string[];
}

export interface TagMergeResult {
  db: RawDatabase;
  groups: MergedTagGroup[];
}

/**
 * 导入前清理同类别、归一化名称相同的标签。
 *
 * 保留每组第一个标签作为目标；其余标签的名称与别名并入目标 aliases，
 * 再把文章/系列的标签引用改写到目标并去重。跨类别同名不合并。
 * 纯函数：不修改入参。
 */
export function mergeDuplicateTags(db: RawDatabase): TagMergeResult {
  // 同 id 的重复条目先按 id 去重，保留第一次出现的对象。
  const byId = new Map<string, Tag>();
  for (const tag of db.tags) {
    if (!byId.has(tag.id)) byId.set(tag.id, tag);
  }
  const uniqueTags = [...byId.values()];

  const byName = new Map<string, Tag[]>();
  for (const tag of uniqueTags) {
    const key = `${tag.category}\0${normalizeName(tag.name)}`;
    const list = byName.get(key);
    if (list) list.push(tag);
    else byName.set(key, [tag]);
  }

  const removedToTarget = new Map<string, string>();
  const groups: MergedTagGroup[] = [];
  const nextTags: Tag[] = [];

  for (const tag of uniqueTags) {
    const siblings = byName.get(`${tag.category}\0${normalizeName(tag.name)}`) ?? [tag];
    if (siblings[0] !== tag) continue; // 这一组的非首个标签会被移除

    const aliasSeen = new Set<string>([normalizeName(tag.name)]);
    const aliases: string[] = [];
    const addAlias = (raw: string): void => {
      const normalized = normalizeName(raw);
      if (!normalized || aliasSeen.has(normalized)) return;
      aliasSeen.add(normalized);
      aliases.push(raw);
    };

    for (const alias of tag.aliases ?? []) addAlias(alias);
    for (const sibling of siblings.slice(1)) {
      addAlias(sibling.name);
      for (const alias of sibling.aliases ?? []) addAlias(alias);
      removedToTarget.set(sibling.id, tag.id);
    }

    nextTags.push(aliases.length > 0 ? { ...tag, aliases } : { ...tag });
    if (siblings.length > 1) {
      groups.push({
        name: tag.name,
        category: tag.category,
        targetId: tag.id,
        removedIds: siblings.slice(1).map((sibling) => sibling.id),
      });
    }
  }

  if (removedToTarget.size === 0) {
    return { db: { ...db, tags: nextTags }, groups };
  }

  const rewrite = (ids: readonly string[]): string[] => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const id of ids) {
      const target = removedToTarget.get(id) ?? id;
      if (seen.has(target)) continue;
      seen.add(target);
      out.push(target);
    }
    return out;
  };

  return {
    db: {
      ...db,
      tags: nextTags,
      articles: db.articles.map((article) => ({
        ...article,
        characterTagIds: rewrite(article.characterTagIds),
        plotTagIds: rewrite(article.plotTagIds),
      })),
      series: db.series.map((series) => ({
        ...series,
        characterTagIds: rewrite(series.characterTagIds),
        plotTagIds: rewrite(series.plotTagIds),
      })),
    },
    groups,
  };
}
