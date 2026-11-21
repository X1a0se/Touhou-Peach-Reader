import { createMemoryPlatform } from '@tpr/platform/memory';
import type { RawDatabase } from '@tpr/schema';
import { makeDatabase } from '@tpr/schema/testing';
import { describe, expect, it } from 'vitest';
import { createLibrary } from '../src/db/library.js';
import { ioFor } from '../src/db/workspace.js';
import { serializeDatabase, writeDatabaseDir } from '../src/db/write.js';
import { describeEta, type ProgressPhase, ProgressRun, type ProgressUpdate } from '../src/progress.js';

const PHASES: readonly ProgressPhase[] = [
  { key: 'extract', label: '解压', weight: 0.5 },
  { key: 'write', label: '写库', weight: 0.3 },
  { key: 'commit', label: '收尾', weight: 0.2 },
];

describe('progress: 阶段权重 / ETA / 单调性', () => {
  it('weights: 阶段起点落在累计权重上，set 只在阶段内推进', () => {
    const run = new ProgressRun('import', PHASES, undefined);
    expect(run.fraction).toBe(0);
    run.set(0.5);
    expect(run.fraction).toBeCloseTo(0.25, 6);
    run.begin('write');
    expect(run.fraction).toBeCloseTo(0.5, 6);
    run.progress(1, 2);
    expect(run.fraction).toBeCloseTo(0.65, 6);
    run.begin('commit');
    expect(run.fraction).toBeCloseTo(0.8, 6);
  });

  it('monotonic: 同一阶段里进度回退不会让总进度倒退', () => {
    const run = new ProgressRun('export', PHASES, undefined);
    run.begin('extract');
    run.set(0.8);
    const high = run.fraction;
    run.set(0.1);
    expect(run.fraction).toBeCloseTo(high, 6);
  });

  it('finish: 收尾强制 100%、剩余时间归零，并且只推一次完成事件', () => {
    const updates: ProgressUpdate[] = [];
    const run = new ProgressRun('merge', PHASES, (update) => updates.push(update));
    run.begin('extract');
    run.set(0.3);
    run.finish();
    run.finish();
    const last = updates.at(-1);
    expect(last?.fraction).toBe(1);
    expect(last?.etaMs).toBe(0);
    expect(updates.filter((update) => update.fraction === 1)).toHaveLength(1);
  });

  it('eta: 样本不足时不给剩余时间，避免早期给出假数字', () => {
    const updates: ProgressUpdate[] = [];
    const run = new ProgressRun('import', PHASES, (update) => updates.push(update));
    run.begin('extract');
    run.set(0.4);
    // 立刻读快照：耗时不足 MIN_ELAPSED_FOR_ETA_MS，ETA 必须是 null
    expect(run.snapshot().etaMs).toBeNull();
    expect(updates.at(-1)?.label).toBe('解压');
  });

  it('describeEta: 把毫秒折成中文表述', () => {
    expect(describeEta(null)).toBe('估算中…');
    expect(describeEta(60000)).toBe('约 1 分钟');
    expect(describeEta(125000)).toBe('约 2 分 5 秒');
    expect(describeEta(300)).toBe('马上就好');
  });
});

describe('progress: 导入真实上报', () => {
  it('import: 进度单调递增、覆盖全部阶段、最后一次是 100%', async () => {
    const db: RawDatabase = makeDatabase(undefined, { withFiles: true });
    const seed = createMemoryPlatform({ dataDir: '/seed' });
    const io = ioFor(seed);
    const markdown = new Map(db.articles.map((article) => [article.id, `# ${article.title}\n\n正文\n`]));
    await writeDatabaseDir(io, '/seed', serializeDatabase(db, markdown));
    await seed.zip.createFromDir('/seed', '/seed/out.tpr', { order: ['manifest.json'] });
    const bytes = await seed.fs.readBytes('/seed/out.tpr');

    const platform = createMemoryPlatform({ dataDir: '/app' });
    const library = createLibrary(platform);
    const updates: ProgressUpdate[] = [];
    await library.importBytes(bytes, { onProgress: (update) => updates.push(update) });

    expect(updates.length).toBeGreaterThan(2);
    expect(updates.at(-1)?.fraction).toBe(1);
    for (let i = 1; i < updates.length; i += 1) {
      expect(updates[i]!.fraction).toBeGreaterThanOrEqual(updates[i - 1]!.fraction - 1e-9);
    }
    const labels = new Set(updates.map((update) => update.label));
    expect(labels.has('正在解压数据包')).toBe(true);
    expect(labels.has('正在写入本地数据库')).toBe(true);
  });

  it('export: 导出也上报进度并以 100% 收尾', async () => {
    const db = makeDatabase(undefined, { withFiles: true });
    const seed = createMemoryPlatform({ dataDir: '/seed2' });
    const io = ioFor(seed);
    const markdown = new Map(db.articles.map((article) => [article.id, '# 标题\n\n正文\n']));
    await writeDatabaseDir(io, '/seed2', serializeDatabase(db, markdown));
    await seed.zip.createFromDir('/seed2', '/seed2/out.tpr', { order: ['manifest.json'] });
    const bytes = await seed.fs.readBytes('/seed2/out.tpr');

    const platform = createMemoryPlatform({ dataDir: '/app2' });
    const library = createLibrary(platform);
    await library.importBytes(bytes);

    const updates: ProgressUpdate[] = [];
    await library.export({ all: true }, { onProgress: (update) => updates.push(update) });
    expect(updates.length).toBeGreaterThan(1);
    expect(updates.at(-1)?.fraction).toBe(1);
    expect(new Set(updates.map((u) => u.label))).toContain('正在打包 .tpr');
  });
});
