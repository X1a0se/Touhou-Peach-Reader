import { createMemoryPlatform } from '@tpr/platform/memory';
import { makeDatabase } from '@tpr/schema/testing';
import { describe, expect, it } from 'vitest';
import { createBlocklist } from '../src/blocklist.js';
import { toSnapshot } from '../src/db/snapshot.js';
import { userPath } from '../src/db/workspace.js';

const DATABASE_ID = 'db_test0001';

function setup() {
  const platform = createMemoryPlatform({ dataDir: '/app' });
  const db = makeDatabase();
  const snapshot = toSnapshot(db);
  const blocked = db.tags[0];
  if (!blocked) throw new Error('fixture missing tag');
  const blocklist = createBlocklist(platform, () => DATABASE_ID);
  const file = platform.paths.join(
    platform.paths.dirname(userPath(platform, DATABASE_ID)),
    `${DATABASE_ID}.blocklist.json`,
  );
  return { platform, snapshot, blocked, blocklist, file };
}

describe('blocklist: 标签屏蔽持久化', () => {
  it('blocklist-persist: 拉黑/取消写入 user/*.blocklist.json，重启后仍在', async () => {
    const { platform, blocked, blocklist, file } = setup();
    await blocklist.load();
    expect(await blocklist.toggle({ id: blocked.id, name: blocked.name })).toBe(true);
    expect(await blocklist.toggle({ id: 't_gone0000000000', name: '已删除标签' })).toBe(true);
    expect(await platform.fs.exists(file)).toBe(true);

    const onDisk = JSON.parse(await platform.fs.readText(file)) as {
      version: number;
      tags: { id: string; name: string }[];
    };
    expect(onDisk.version).toBe(1);
    expect(onDisk.tags.map((tag) => tag.id)).toEqual(['t_gone0000000000', blocked.id]);

    const restarted = createBlocklist(platform, () => DATABASE_ID);
    await restarted.load();
    expect(restarted.has(blocked.id)).toBe(true);
    expect(restarted.tags().map((tag) => tag.id)).toEqual(['t_gone0000000000', blocked.id]);

    expect(await restarted.toggle({ id: blocked.id, name: blocked.name })).toBe(false);
    await restarted.remove('t_gone0000000000');
    expect(restarted.tags()).toEqual([]);
    await restarted.clear();
  });

  it('blocklist-list: 库内标签显示最新名称/分类，缺失标签标记 stale', async () => {
    const { snapshot, blocked, blocklist } = setup();
    await blocklist.load();
    await blocklist.toggle({ id: blocked.id, name: '旧名称' });
    await blocklist.toggle({ id: 't_gone0000000000', name: '已删除标签' });

    const list = blocklist.list(snapshot);
    expect(list[1]).toMatchObject({
      id: blocked.id,
      name: blocked.name,
      category: blocked.category,
      stale: false,
    });
    expect(list[0]).toMatchObject({
      id: 't_gone0000000000',
      name: '已删除标签',
      category: null,
      stale: true,
    });
  });

  it('blocklist-no-database: 没有当前库时不写文件', async () => {
    const platform = createMemoryPlatform({ dataDir: '/app' });
    const blocklist = createBlocklist(platform, () => null);
    await blocklist.load();
    await blocklist.toggle({ id: 't_0000000000000001', name: '某个标签' });
    expect(await platform.fs.exists('/app/user/db_test0001.blocklist.json')).toBe(false);
  });
});
