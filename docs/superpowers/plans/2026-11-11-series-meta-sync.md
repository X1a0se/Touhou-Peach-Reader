# 系列元数据向下同步 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在编辑器「系列」页改封面/作者/译者/原出处并保存时，先问用户要不要把这些值同步给系列内已有的文章（补空字段 / 替换不同值），并把「以后加入本系列的文章自动填上」记成系列自己的持久策略。

**Architecture:** 策略是 `Series.autoFillFields`（四个枚举值的数组），存进 SQLite `series.auto_fill_fields`（JSON 文本，v3→v4 迁移）。「新文章进系列时静默填空」写在 core 的 `saveArticle`/`saveSeries` 里，与目录双向同步同一个 `applyEdit` 闭包；「同步给已有文章」是 core 的显式清单方法 `applySeriesMetaSync`。界面在 `SeriesForm` 提交时算候选、开弹窗，确认后先 `saveSeries` 再 `applySeriesMetaSync`。

**Tech Stack:** TypeScript 7 + React 19 + zod 4（schema 即类型）+ SQLite（`@tpr/platform` 的 `ISql`）+ vitest 5 + pnpm workspace。

**Spec:** `docs/superpowers/specs/2026-11-11-series-meta-sync-design.md`

## Global Constraints

- 加法式可选字段**不升** `manifest.schemaVersion`（保持 1）；只升 SQLite 的 `SQL_SCHEMA_VERSION`（3 → 4）。
- 同步范围只有四项：`cover` / `author` / `translator` / `sourceUrl`。标签与插图不参与。
- 继承只填空、不覆盖；只对「新进入系列」的文章生效。
- 不做 undo、不追踪来源（不加 provenance 字段）、不做反向同步。
- 不引入新依赖；桌面端不新增组件测试库（界面靠 `typecheck` 顶住）。
- 代码风格：biome，2 空格缩进、单引号、分号、行宽 100。注释与界面文案用中文。
- 五项校验必须全绿：`corepack pnpm typecheck`、`corepack pnpm test`、`corepack pnpm check`、`node scripts/check-boundaries.mjs`、`node scripts/check-no-tauri.mjs`。
- `apps/desktop/tsconfig.json` 的 `include` 只有 `["src", "vite.config.ts"]`，**不覆盖 `apps/desktop/test/`** —— 桌面端测试文件的类型错误不会出现在 `typecheck` 里，只能靠 vitest 真跑出来。`packages/core/tsconfig.json` 的 `include` 含 `test`，core 的测试文件是会被 typecheck 检查的。

## Review Focus

- **有触发字段但候选为空**（系列一篇都没有、或每篇都已一致、或新值为空）：必须直接保存，不弹只有按钮的空窗。
- **本次新加入的篇目**同时被 `saveSeries` 的继承填空与弹窗清单覆盖：只能走继承一次，弹窗清单里不能出现它们（否则篇数会重复计）。
- **旧草稿**（localStorage 里本次改动前存的系列草稿）没有 `autoFillFields` 键：读回来不能崩，且不能把已有策略静默清空。
- **作者顺序不同但集合相同**：不算「替换」，不能出现在替换区。
- **清空字段**（有值 → 空）与**只改简介**：都不触发弹窗。

---

### Task 1: schema 加 `autoFillFields` 与夹具

**Files:**
- Modify: `packages/schema/src/entities.ts:90-108`（`seriesStatusSchema` 上方加常量，`seriesSchema` 内加字段）
- Modify: `packages/schema/src/testing/factory.ts:71-86`（`makeSeries()`）
- Test: `packages/schema/test/database.test.ts`（追加一个 `describe`）

**Interfaces:**
- Consumes: 无
- Produces:
  - `export const SERIES_AUTO_FILL_FIELDS = ['cover', 'author', 'translator', 'sourceUrl'] as const;`
  - `export const seriesAutoFillFieldSchema = z.enum(SERIES_AUTO_FILL_FIELDS);`
  - `export type SeriesAutoFillField = z.infer<typeof seriesAutoFillFieldSchema>;`
  - `seriesSchema` 输出类型新增必填 `autoFillFields: SeriesAutoFillField[]`（缺省 `[]`）

- [ ] **Step 1: 写失败测试**

在 `packages/schema/test/database.test.ts` 末尾追加：

```ts
describe('series.autoFillFields', () => {
  it('缺省解析为空数组', () => {
    const db = makeDatabase();
    const series = { ...db.series[0]! } as Record<string, unknown>;
    delete series.autoFillFields;
    const parsed = parseRawDatabase({ ...db, series: [series] });
    expect(parsed.series[0]?.autoFillFields).toEqual([]);
  });

  it('保留已知值、丢弃未知键', () => {
    const db = makeDatabase();
    const series = { ...db.series[0]!, autoFillFields: ['author', 'cover'], 未知键: 1 };
    const parsed = parseRawDatabase({ ...db, series: [series] });
    expect(parsed.series[0]?.autoFillFields).toEqual(['author', 'cover']);
    expect(parsed.series[0]).not.toHaveProperty('未知键');
  });

  it('不认识的字段名报错', () => {
    const db = makeDatabase();
    const series = { ...db.series[0]!, autoFillFields: ['tag'] };
    expect(() => parseRawDatabase({ ...db, series: [series] })).toThrowError();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `corepack pnpm --filter @tpr/schema exec vitest run test/database.test.ts`
Expected: FAIL —— 第一条断言实际拿到 `undefined`，第三条不抛错（未知值被丢弃而不是报错）。

- [ ] **Step 3: 加 schema 字段**

`packages/schema/src/entities.ts`，在 `/** —— 系列 —— */` 那行之后、`seriesStatusSchema` 之前：

```ts
/** 系列的「未来加入本系列的文章自动填上」策略，四个可独立开关的部分。 */
export const SERIES_AUTO_FILL_FIELDS = ['cover', 'author', 'translator', 'sourceUrl'] as const;
export const seriesAutoFillFieldSchema = z.enum(SERIES_AUTO_FILL_FIELDS);
export type SeriesAutoFillField = z.infer<typeof seriesAutoFillFieldSchema>;
```

`seriesSchema` 里，放在 `sourceUrl: urlText.optional(),` 之前（紧跟 `plotTagIds` 之后）：

```ts
  /** 新文章进入本系列时按此策略补空字段；空数组表示不自动填 */
  autoFillFields: z.array(seriesAutoFillFieldSchema).default([]),
```

- [ ] **Step 4: 夹具补默认值**

`packages/schema/src/testing/factory.ts` 的 `makeSeries()` 里，`plotTagIds: [],` 之后加 `autoFillFields: [],`。

原因：`Series` 的输出类型因此变成必填字段，`packages/core/test/migrate.test.ts` 第一条用 `canonicalDatabase` 逐字段比对，缺这一项必挂。

- [ ] **Step 5: 跑测试确认通过**

Run: `corepack pnpm --filter @tpr/schema test && corepack pnpm --filter @tpr/schema typecheck`
Expected: PASS（schema 原有 28 例 + 新增 3 例），typecheck 无错。

- [ ] **Step 6: Commit**

```bash
git add packages/schema/src/entities.ts packages/schema/src/testing/factory.ts packages/schema/test/database.test.ts
git commit -m "feat(schema): 系列新增 autoFillFields 策略字段"
```

---

### Task 2: SQLite v3 → v4

**Files:**
- Modify: `packages/core/src/db/sql/schema.ts:4`（版本号）、`:122-135`（series DDL）
- Modify: `packages/core/src/db/sql/migrate.ts:25`（注释）、`:47-58` 之后加 `if (version < 4)`
- Modify: `packages/core/src/db/sql/store.ts:2-15`（导入）、`:228`（SELECT）、`:277-301`（映射 + `parseAutoFillFields`）、`:580`（整体写）、`:898`（差异写）
- Test: `packages/core/test/migrate.test.ts`

**Interfaces:**
- Consumes: `SERIES_AUTO_FILL_FIELDS`、`SeriesAutoFillField`（Task 1）
- Produces: 读出的 `Series` 永远带 `autoFillFields: SeriesAutoFillField[]`；SQL 列 `auto_fill_fields TEXT`（JSON 数组，NULL 与 `'[]'` 同义）

- [ ] **Step 1: 写失败测试**

在 `packages/core/test/migrate.test.ts` 里插入到**外层 `describe` 内部**：放在 `migrate-sql-unsupported` 那条 `it` 之后、文件末尾那个收尾 `});`（`:208`）之前（照 `migrate-sql-v2-v3` 的写法）：

```ts
  it('migrate-sql-v3-v4: 给旧 SQLite 补 auto_fill_fields 列且读回空数组', async () => {
    const db = makeDatabase();
    const platform = createMemoryPlatform({ dataDir: '/app' });
    const dir = await seedLegacy(platform, db);
    await createLibrary(platform).restore();
    const dbPath = databasePathOf(platform, dir);

    await platform.sql.batch(dbPath, [
      { sql: 'ALTER TABLE series DROP COLUMN auto_fill_fields' },
      { sql: 'PRAGMA user_version = 3' },
    ]);

    await ensureLocalDatabase(platform, dir);

    const columns = await platform.sql.query(dbPath, "SELECT name FROM pragma_table_info('series')");
    expect(columns.map((row) => String(row.name))).toContain('auto_fill_fields');
    const upgradedRows = await platform.sql.query(dbPath, 'PRAGMA user_version');
    expect(Number(upgradedRows[0]?.user_version)).toBe(SQL_SCHEMA_VERSION);
    const actual = await readSqliteFromFile(platform, dbPath);
    expect(actual.series.every((series) => series.autoFillFields.length === 0)).toBe(true);

    // 幂等：再次打开不会重复加列。
    await expect(ensureLocalDatabase(platform, dir)).resolves.toBeUndefined();
  });
```

同时改掉三处硬编码版本号（否则升版后必挂）：

- `:160` `expect(Number(upgradedRows[0]?.user_version)).toBe(3);` → `.toBe(SQL_SCHEMA_VERSION);`
- `:192` 同一句 → `.toBe(SQL_SCHEMA_VERSION);`
- `:204-206` `{ sql: 'PRAGMA user_version = 4' }` 与 `/不支持的本地数据库版本：4/` → 改成 `PRAGMA user_version = 5` 与 `/不支持的本地数据库版本：5/`
- 两条测试标题里的 `v1-v3` / `v2-v3` 改成 `v1-v4` / `v2-v4`
- 顶部导入补 `import { SQL_SCHEMA_VERSION } from '../src/db/sql/schema.js';`

- [ ] **Step 2: 跑测试确认失败**

Run: `corepack pnpm --filter @tpr/core exec vitest run test/migrate.test.ts`
Expected: FAIL —— `no such column: auto_fill_fields`（DROP 失败）或读回 `autoFillFields` 为 `undefined`。

- [ ] **Step 3: 建表 DDL 与版本号**

`packages/core/src/db/sql/schema.ts:4`：`export const SQL_SCHEMA_VERSION = 4;`

同文件 series 建表语句，在 `illustration_ids_present INTEGER NOT NULL DEFAULT 0` 之后加一行（注意前一行补逗号）：

```
      illustration_ids_present INTEGER NOT NULL DEFAULT 0,
      auto_fill_fields TEXT
```

- [ ] **Step 4: 迁移段**

`packages/core/src/db/sql/migrate.ts`，在 `if (version < 3) { … }` 块之后、`statements.push({ sql: \`PRAGMA user_version = ${SQL_SCHEMA_VERSION}\` });` 之前：

```ts
  if (version < 4) {
    const seriesColumns = await columnNames(platform, dbPath, 'series');
    if (!seriesColumns.has('auto_fill_fields')) {
      statements.push({ sql: 'ALTER TABLE series ADD COLUMN auto_fill_fields TEXT' });
    }
  }
```

`:25` 的注释改成「user_version 是唯一权威：新库直接是 4，v1 旧库补 updated_at，v2 旧库补系列插图，v3 旧库补 auto_fill_fields」。

- [ ] **Step 5: store 读写三处**

`packages/core/src/db/sql/store.ts`：

1. `:2-15` 的 `@tpr/schema` 导入清单加 `SERIES_AUTO_FILL_FIELDS,` 与 `type SeriesAutoFillField,`。
2. 在 `counts_json` 那段（`:74-82`）之后加解析函数：

```ts
/** auto_fill_fields 是 JSON 数组文本；NULL、坏 JSON、未知值一律当空。 */
function parseAutoFillFields(row: SqlRow): SeriesAutoFillField[] {
  const text = rowNullableText(row, 'auto_fill_fields');
  if (!text) return [];
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!Array.isArray(parsed)) return [];
    const known = SERIES_AUTO_FILL_FIELDS as readonly string[];
    return [...new Set(parsed.filter((item): item is SeriesAutoFillField =>
      typeof item === 'string' && known.includes(item)))];
  } catch {
    return [];
  }
}
```

3. `:228` 的 SELECT 列尾加 `, auto_fill_fields`。
4. `:295-297` 条件展开之前，映射里加一行 `autoFillFields: parseAutoFillFields(row),`。
5. `:580` 整体写：列清单与 `VALUES` 占位各加一项（10 → 11），参数数组末尾加 `JSON.stringify(series.autoFillFields),`。
6. `:898` 差异写：同一条 SQL 加 `auto_fill_fields` 列与第 11 个 `?`，`DO UPDATE SET` 末尾加 `, auto_fill_fields=excluded.auto_fill_fields`，参数末尾同样加 `JSON.stringify(series.autoFillFields),`。

`DO UPDATE SET` 那一项不能漏 —— 漏了旧行永远不会更新策略，而 `stableStringify` 短路会让"只改了策略"的保存悄悄丢数据。

- [ ] **Step 6: 跑测试确认通过**

Run: `corepack pnpm --filter @tpr/core exec vitest run test/migrate.test.ts && corepack pnpm --filter @tpr/core test && corepack pnpm --filter @tpr/core typecheck`
Expected: PASS。core 全量 223 例（原 222 + 新增 1 例）全绿。

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/db/sql packages/core/test/migrate.test.ts
git commit -m "feat(core): SQLite v3→v4 存系列的自动填策略"
```

---

### Task 3: core 的继承填空

**Files:**
- Modify: `packages/core/src/editor/index.ts:6-21`（导入）、`:44-57`（`SeriesDraft`）、`:102-110` 之后（`fillFromSeries`）、`:151-204`（`saveArticle`）、`:219-263`（`saveSeries`）
- Test: `packages/core/test/series-meta-sync.test.ts`（新建）

**Interfaces:**
- Consumes: `Series.autoFillFields`（Task 1）
- Produces:
  - `SeriesDraft.autoFillFields?: SeriesAutoFillField[]`
  - `saveSeries` 返回的系列带 `autoFillFields`（未传则保留原值，传 `[]` 则清空）
  - 内部 `fillFromSeries(article: ArticleFile, series: Series): boolean`

- [ ] **Step 1: 写失败测试**

新建 `packages/core/test/series-meta-sync.test.ts`，前半部分（harness 照抄 `packages/core/test/edit.test.ts:14-37`）：

```ts
import { createMemoryPlatform } from '@tpr/platform/memory';
import type { RawDatabase } from '@tpr/schema';
import { makeDatabase } from '@tpr/schema/testing';
import { describe, expect, it } from 'vitest';
import { createLibrary, type Library } from '../src/db/library.js';
import { ioFor } from '../src/db/workspace.js';
import { serializeDatabase, writeDatabaseDir } from '../src/db/write.js';
import { createEditor, type Editor } from '../src/editor/index.js';

async function openDatabase(source: RawDatabase = makeDatabase()): Promise<{
  library: Library;
  editor: Editor;
  db: RawDatabase;
}> {
  const db = source;
  const seed = createMemoryPlatform({ dataDir: '/seed' });
  const io = ioFor(seed);
  const markdown = new Map(db.articles.map((article) => [article.id, `# ${article.title}\n\n正文：${article.id}\n`]));
  await writeDatabaseDir(io, '/seed', serializeDatabase(db, markdown));
  for (const image of db.images) {
    const path = seed.paths.join('/seed', image.file);
    await seed.fs.mkdir(seed.paths.dirname(path));
    await seed.fs.writeBytes(path, new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 1]));
  }
  await seed.zip.createFromDir('/seed', '/seed/out.tpr', { order: ['manifest.json'] });
  const bytes = await seed.fs.readBytes('/seed/out.tpr');

  const platform = createMemoryPlatform({ dataDir: '/app' });
  const library = createLibrary(platform);
  await library.importBytes(bytes);
  return { library, editor: createEditor(platform, library), db };
}

/** 打开 makeDatabase() 那个库（1 作者 / 1 封面 / 系列 2 篇 / 1 短篇），并给出常用 id。 */
async function openFixture() {
  const db = makeDatabase();
  const opened = await openDatabase(db);
  return { ...opened, authorId: db.authors[0]!.id, imageId: db.images[0]!.id };
}

describe('series meta sync: 继承填空', () => {
  it('saveSeries 保存并读回 autoFillFields；未传时保留原值；传空数组时清空', async () => {
    const { library, editor } = await openDatabase();
    const draft = {
      title: '带策略的系列',
      summary: '',
      status: 'ongoing' as const,
      articleIds: [],
      authorIds: [],
      translatorIds: [],
      characterTagIds: [],
      plotTagIds: [],
    };
    const readBack = (id: string) =>
      library.snapshot()?.series.find((series) => series.id === id)?.autoFillFields;

    const id = await editor.saveSeries({ ...draft, autoFillFields: ['author', 'cover'] });
    expect(readBack(id)).toEqual(['author', 'cover']);

    // 不传这个键：保留原值（不能因为表单没带就把策略清空）。
    await editor.saveSeries({ ...draft, id });
    expect(readBack(id)).toEqual(['author', 'cover']);

    await editor.saveSeries({ ...draft, id, autoFillFields: [] });
    expect(readBack(id)).toEqual([]);
  });

  it('文章新进入系列时按策略补空字段，不覆盖已有值，策略外的字段不动', async () => {
    const { db, library, editor, authorId, imageId } = await openFixture();
    const shortArticle = db.articles.find((article) => article.type === 'short')!;
    const seriesId = await editor.saveSeries({
      title: '策略系列',
      summary: '',
      status: 'ongoing',
      articleIds: [],
      authorIds: [authorId],
      translatorIds: [authorId],
      characterTagIds: [],
      plotTagIds: [],
      coverImageId: imageId,
      autoFillFields: ['author', 'cover'],
    });

    // 短篇原本有作者（同一个），作者保持不变；封面为空 → 补上；译者不在策略里 → 不动。
    await editor.saveArticle({
      id: shortArticle.id,
      type: 'short',
      title: shortArticle.title,
      summary: '',
      authorIds: [authorId],
      translatorIds: [],
      characterTagIds: [],
      plotTagIds: [],
      illustrationImageIds: [],
      seriesId,
    });

    const saved = library.snapshot()?.articles.find((article) => article.id === shortArticle.id);
    expect(saved?.authorIds).toEqual([authorId]);
    expect(saved?.coverImageId).toBe(imageId);
    expect(saved?.translatorIds).toEqual([]);
    expect(saved?.type).toBe('series-entry');
  });

  it('已在系列里的老文章不会因为再次保存系列而被自动改', async () => {
    const { db, library, editor, authorId } = await openFixture();
    const series = db.series[0]!;
    const entry = db.articles.find((article) => article.seriesId === series.id)!;
    await editor.saveSeries({
      id: series.id,
      title: series.title,
      summary: series.summary,
      status: series.status,
      articleIds: series.articleIds,
      authorIds: series.authorIds,
      translatorIds: [authorId],
      characterTagIds: [],
      plotTagIds: [],
      autoFillFields: ['translator'],
    });

    const saved = library.snapshot()?.articles.find((article) => article.id === entry.id);
    expect(saved?.translatorIds).toEqual(entry.translatorIds);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `corepack pnpm --filter @tpr/core exec vitest run test/series-meta-sync.test.ts`
Expected: FAIL —— `autoFillFields` 不在 `SeriesDraft` 类型里（typecheck 层面）/ 读回为 `undefined`。

- [ ] **Step 3: 实现**

`packages/core/src/editor/index.ts`：

1. `:6-21` 导入清单加 `type ArticleFile,`、`type SeriesAutoFillField,`。
2. `SeriesDraft`（`:44-57`）末尾加 `autoFillFields?: SeriesAutoFillField[];`，注释「不传表示保留原值，传 `[]` 表示清空」。
3. `clean()` 附近（`:110` 之后）加两个内部函数：

```ts
/** 两个 id 数组是否表示同一个集合（顺序不算差异）。 */
function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id) => b.includes(id));
}

/**
 * 把系列的某个字段写到文章上。系列该字段为空、或文章已是该值时返回 false。
 * 只负责复制，不判断「该不该填」—— 那由调用方按策略或清单决定。
 */
function copyField(article: ArticleFile, series: Series, field: SeriesAutoFillField): boolean {
  switch (field) {
    case 'author':
      if (series.authorIds.length === 0 || sameIds(article.authorIds, series.authorIds)) return false;
      article.authorIds = [...series.authorIds];
      return true;
    case 'translator':
      if (series.translatorIds.length === 0 || sameIds(article.translatorIds, series.translatorIds)) return false;
      article.translatorIds = [...series.translatorIds];
      return true;
    case 'cover':
      if (!series.coverImageId || article.coverImageId === series.coverImageId) return false;
      article.coverImageId = series.coverImageId;
      return true;
    case 'sourceUrl':
      if (!series.sourceUrl?.trim() || article.sourceUrl === series.sourceUrl) return false;
      article.sourceUrl = series.sourceUrl;
      return true;
  }
}

/** 文章的这个字段是否算「未填写」。 */
function isFieldEmpty(article: ArticleFile, field: SeriesAutoFillField): boolean {
  switch (field) {
    case 'author':
      return article.authorIds.length === 0;
    case 'translator':
      return article.translatorIds.length === 0;
    case 'cover':
      return !article.coverImageId;
    case 'sourceUrl':
      return !article.sourceUrl?.trim();
  }
}

/** 文章新进入系列时按策略补空字段：只填空，不覆盖。返回是否有改动。 */
function fillFromSeries(article: ArticleFile, series: Series): boolean {
  let changed = false;
  for (const field of series.autoFillFields) {
    if (!isFieldEmpty(article, field)) continue;
    if (copyField(article, series, field)) changed = true;
  }
  if (changed) article.updatedAt = now();
  return changed;
}
```

`copyField` 里那两个赋值必须紧跟在守卫之后写（`article.coverImageId = series.coverImageId;`），不要先 `const value = series.coverImageId` 再赋 —— 仓库开了 `exactOptionalPropertyTypes`，只有紧跟 `if (!series.coverImageId …) return false;` 的这次属性访问才会被窄化成 `string`；先取到局部变量会变成 `string | undefined`，赋给可选属性直接报错。

`series.autoFillFields` 不用写 `?? []`：Task 1 的 `.default([])` 让它成为输出类型里的必填数组。

`cover` 判定用 `!article.coverImageId` 而不是 `=== undefined`：`saveArticle` 里的 `next` 是条件展开构造的，键可能根本不存在。

4. `saveArticle`：`entering` 必须写在 `applyEdit` 闭包**内部**（`existing` 是在 `:162` 的闭包里查出来的，闭包外没有这个变量）：在 `const existing = db.articles.find(…)` 之后、`const next = { … } satisfies …` 之前加 `const entering = (existing?.seriesId ?? '') !== targetSeriesId;`。必须在 `:181` 的 `Object.assign` 之前抓，之后 `existing` 已被覆盖。然后在 `next` 构造之后、`if (existing) Object.assign(existing, next);` 之前插：

```ts
        if (entering && targetSeriesId) {
          const host = db.series.find((series) => series.id === targetSeriesId);
          if (host) fillFromSeries(next, host);
        }
```

5. `saveSeries`：同样在闭包内部、`const existing = …` 之后加 `const beforeIds = new Set(existing?.articleIds ?? []);`（必须在 `:245` 的 `Object.assign` 之前）。`next` 里加：

```ts
          autoFillFields: [...new Set(draft.autoFillFields ?? existing?.autoFillFields ?? [])],
```

放在 `plotTagIds` 之后、`...(draft.coverImageId …)` 之前。`:251` 的 `if (articleIds.includes(article.id))` 分支内、`article.updatedAt = now();` 之后加：

```ts
            if (!beforeIds.has(article.id)) fillFromSeries(article, next);
```

6. `:249-260` 的循环末尾结构不变。

- [ ] **Step 4: 跑测试确认通过**

Run: `corepack pnpm --filter @tpr/core exec vitest run test/series-meta-sync.test.ts && corepack pnpm --filter @tpr/core typecheck`
Expected: PASS（3 例）。

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/editor/index.ts packages/core/test/series-meta-sync.test.ts
git commit -m "feat(core): 新文章进系列时按策略补空字段"
```

---

### Task 4: core 的 `applySeriesMetaSync`

**Files:**
- Modify: `packages/core/src/editor/index.ts:83-100`（`Editor` 接口）、`:263` 之后（新方法）
- Test: `packages/core/test/series-meta-sync.test.ts`（追加）

**Interfaces:**
- Consumes: `copyField`（Task 3）
- Produces:
  - `export interface SeriesMetaSyncItem { articleId: string; field: SeriesAutoFillField; }`
  - `applySeriesMetaSync(seriesId: string, items: readonly SeriesMetaSyncItem[]): Promise<number>`（返回实际改动条数）

- [ ] **Step 1: 写失败测试**

追加到同一文件的 `describe` 之外，新建一个 `describe('series meta sync: 显式清单同步', …)`。**注意用 `translator` 而不是 `author`**：`makeDatabase()` 里系列与两篇文章的 `authorIds` 本来就是同一个作者，拿 `author` 做断言会得到 0 而不是 1。

```ts
describe('series meta sync: 显式清单同步', () => {
  it('只改清单里的文章×字段，未列入的不动', async () => {
    const { db, library, editor, authorId } = await openFixture();
    const series = db.series[0]!;
    const target = series.articleIds[0]!;
    const other = series.articleIds[1]!;
    await editor.saveSeries({
      id: series.id,
      title: series.title,
      summary: series.summary,
      status: series.status,
      articleIds: series.articleIds,
      authorIds: series.authorIds,
      translatorIds: [authorId],
      characterTagIds: [],
      plotTagIds: [],
    });

    const changed = await editor.applySeriesMetaSync(series.id, [
      { articleId: target, field: 'translator' },
    ]);

    expect(changed).toBe(1);
    const snapshot = library.snapshot();
    expect(snapshot?.articles.find((a) => a.id === target)?.translatorIds).toEqual([authorId]);
    expect(snapshot?.articles.find((a) => a.id === other)?.translatorIds).toEqual([]);
  });

  it('不在系列内的文章、不存在的文章、系列该字段为空都跳过且不抛错', async () => {
    const { db, library, editor } = await openFixture();
    const series = db.series[0]!;
    // 系列译者留空：这一项要覆盖「系列该字段为空」。
    await editor.saveSeries({
      id: series.id,
      title: series.title,
      summary: series.summary,
      status: series.status,
      articleIds: series.articleIds,
      authorIds: series.authorIds,
      translatorIds: [],
      characterTagIds: [],
      plotTagIds: [],
    });
    const outsider = db.articles.find((article) => article.type === 'short')!;

    const changed = await editor.applySeriesMetaSync(series.id, [
      { articleId: outsider.id, field: 'translator' },
      { articleId: 'a_doesnotexist0000', field: 'translator' },
      { articleId: series.articleIds[0]!, field: 'translator' },
    ]);

    expect(changed).toBe(0);
    expect(library.snapshot()?.articles.find((a) => a.id === outsider.id)?.translatorIds).toEqual([]);
  });

  it('已一致的项不计入返回值，同一份清单重放返回 0', async () => {
    const { db, editor, authorId } = await openFixture();
    const series = db.series[0]!;
    await editor.saveSeries({
      id: series.id,
      title: series.title,
      summary: series.summary,
      status: series.status,
      articleIds: series.articleIds,
      authorIds: series.authorIds,
      translatorIds: [authorId],
      characterTagIds: [],
      plotTagIds: [],
    });
    const items = series.articleIds.map((articleId) => ({
      articleId,
      field: 'translator' as const,
    }));

    expect(await editor.applySeriesMetaSync(series.id, items)).toBe(2);
    expect(await editor.applySeriesMetaSync(series.id, items)).toBe(0);
    expect(await editor.applySeriesMetaSync(series.id, [])).toBe(0);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `corepack pnpm --filter @tpr/core exec vitest run test/series-meta-sync.test.ts`
Expected: FAIL —— `editor.applySeriesMetaSync is not a function`。

- [ ] **Step 3: 实现**

`packages/core/src/editor/index.ts`：

1. `SeriesDraft` 之后加：

```ts
/** 一次同步操作：把系列的某个字段写到某篇文章上。 */
export interface SeriesMetaSyncItem {
  articleId: string;
  field: SeriesAutoFillField;
}
```

2. `Editor` 接口（`:83-100`）在 `deleteSeries` 之后加：

```ts
  /** 按显式清单把系列当前值写到文章上；返回实际改动条数。 */
  applySeriesMetaSync(seriesId: string, items: readonly SeriesMetaSyncItem[]): Promise<number>;
```

3. `deleteSeries` 之后（`saveSeries` 与 `deleteSeries` 之间即可）加实现：

```ts
    async applySeriesMetaSync(seriesId, items) {
      if (items.length === 0) return 0;
      let changed = 0;
      await library.applyEdit((db) => {
        const series = db.series.find((item) => item.id === seriesId);
        if (!series) return;
        const touched = new Set<string>();
        for (const item of items) {
          if (!series.articleIds.includes(item.articleId)) continue;
          const article = db.articles.find((entry) => entry.id === item.articleId);
          if (!article) continue;
          if (!copyField(article, series, item.field)) continue;
          changed += 1;
          touched.add(article.id);
        }
        const stamp = now();
        for (const article of db.articles) {
          if (touched.has(article.id)) article.updatedAt = stamp;
        }
      });
      return changed;
    },
```

`items` 为空时直接返回 0、不进 `applyEdit`：否则会白改一次 `manifest.updatedAt`、白加一次 `revision`、白刷一次界面。

- [ ] **Step 4: 跑测试确认通过**

Run: `corepack pnpm --filter @tpr/core test && corepack pnpm --filter @tpr/core typecheck`
Expected: PASS（core 全量 229 例：222 + 1 迁移 + 3 继承 + 3 清单同步）。

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/editor/index.ts packages/core/test/series-meta-sync.test.ts
git commit -m "feat(core): 按显式清单把系列元数据同步到文章"
```

---

### Task 5: 桌面端候选计算（纯逻辑）

**Files:**
- Create: `apps/desktop/src/editor/meta-sync.ts`
- Test: `apps/desktop/test/meta-sync.test.ts`

**Interfaces:**
- Consumes: `SERIES_AUTO_FILL_FIELDS`、`SeriesAutoFillField`、`Series`、`ArticleMeta`（均来自 `@tpr/schema`）；`DBSnapshot`（`@tpr/core`）；`SeriesMetaSyncItem`（`@tpr/core`，Task 4）
- Produces:
  - `interface MetaSyncValues { authorIds: string[]; translatorIds: string[]; coverImageId: string; sourceUrl: string }`
  - `interface MetaSyncBefore extends MetaSyncValues { articleIds: string[] }`
  - `interface MetaSyncCandidate { articleId: string; field: SeriesAutoFillField; kind: 'fill' | 'replace' }`
  - `interface MetaSyncGroup { key: string; field: SeriesAutoFillField; kind: 'fill' | 'replace'; fromLabel: string; toLabel: string; items: MetaSyncCandidate[] }`
  - `META_SYNC_FIELD_LABEL: Record<SeriesAutoFillField, string>`
  - `valuesOfSeries(series: Series): MetaSyncValues`
  - `valuesOfArticle(article: ArticleMeta): MetaSyncValues`
  - `triggeredMetaSyncFields(before: MetaSyncBefore, after: MetaSyncBefore): SeriesAutoFillField[]`
  - `computeMetaSyncCandidates(snapshot: DBSnapshot, before: MetaSyncBefore | null, after: MetaSyncBefore, triggered: readonly SeriesAutoFillField[]): MetaSyncCandidate[]`
  - `groupMetaSyncCandidates(snapshot: DBSnapshot, candidates: readonly MetaSyncCandidate[], before: MetaSyncBefore, after: MetaSyncBefore): MetaSyncGroup[]`
  - `metaSyncKey(articleId: string, field: SeriesAutoFillField): string`

- [ ] **Step 1: 写失败测试**

新建 `apps/desktop/test/meta-sync.test.ts`：

```ts
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
    expect(triggeredMetaSyncFields({ ...base, authorIds: ['p_1'] }, { ...base, authorIds: ['p_2'] }))
      .toEqual(['author']);
    expect(triggeredMetaSyncFields({ ...base, authorIds: ['p_1'] }, base)).toEqual([]);
    expect(triggeredMetaSyncFields(base, base)).toEqual([]);
  });

  it('同一集合换个顺序不算变化', () => {
    const before: MetaSyncBefore = { articleIds: [], ...EMPTY_VALUES, authorIds: ['p_1', 'p_2'] };
    expect(triggeredMetaSyncFields(before, { ...before, authorIds: ['p_2', 'p_1'] })).toEqual([]);
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
    expect(triggeredMetaSyncFields(base, after)).toEqual(['cover', 'author', 'translator', 'sourceUrl']);
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
    expect(candidates.some((item) => item.articleId === f.shortId)).toBe(false);
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `corepack pnpm --filter @tpr/desktop exec vitest run test/meta-sync.test.ts`
Expected: FAIL —— 找不到模块 `../src/editor/meta-sync.js`。

- [ ] **Step 3: 实现 `apps/desktop/src/editor/meta-sync.ts`**

签名固定如上。要点：

- 比较 id 数组按集合比（长度相同且互相包含），顺序不同不算差异。
- `triggeredMetaSyncFields` 按 `SERIES_AUTO_FILL_FIELDS` 的声明顺序返回，保证弹窗与表单里复选框顺序稳定。
- 触发口径：`after` 该字段非空，且与 `before` 不同。`after` 为空（清除）不触发。
- `computeMetaSyncCandidates`：外层遍历 `before.articleIds`（**文章顺序就是系列顺序**）、内层遍历 `triggered`（字段声明顺序），所以返回顺序是「按篇目，再按字段」；`snapshot.maps.articles.get(id)` 取不到就跳过；`after` 该字段为空则跳过（没有值可写）；文章空 → `'fill'`，文章非空且不同 → `'replace'`，相同 → 不列。`before` 为 `null`（新建系列）直接返回 `[]`。
- `metaSyncValueLabel` 内部函数：`author`/`translator` 把 id 映射成 `snapshot.maps.authors` 的 `canonicalName`，用 `、` 连接；映射不到时用 id。`cover` 映射成 `snapshot.maps.images` 的 `caption ?? id`。`sourceUrl` 原样。空值返回 `''`。
- `sourceUrl` 一律按 `trim()` 后比较、按 `trim()` 后显示：表单里允许用户带空格输入，而 `saveSeries` 落盘前会 `trim`，两边不归一就会出现「只加了个空格也算替换」的假候选。
- `groupMetaSyncCandidates` 的组键 = `field + '\u0000' + kind + '\u0000' + fromLabel`；`fromLabel` 对 `fill` 固定为 `'（未填写）'`；输出先所有 `fill` 组（按字段声明顺序）、再所有 `replace` 组（按字段声明顺序），同字段同种类内按 `fromLabel` 首次出现顺序。

- [ ] **Step 4: 跑测试确认通过**

Run: `corepack pnpm --filter @tpr/desktop exec vitest run test/meta-sync.test.ts && corepack pnpm --filter @tpr/desktop typecheck`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/editor/meta-sync.ts apps/desktop/test/meta-sync.test.ts
git commit -m "feat(desktop): 系列元数据同步的候选计算"
```

---

### Task 6: 弹窗组件与策略复选框

**Files:**
- Create: `apps/desktop/src/components/SeriesMetaSyncDialog.tsx`

**Interfaces:**
- Consumes: `MetaSyncGroup`、`META_SYNC_FIELD_LABEL`（Task 5）；`SeriesMetaSyncItem`（Task 4）；`SeriesAutoFillField`、`SERIES_AUTO_FILL_FIELDS`（Task 1）
- Produces:
  - `SeriesAutoFillFieldPicker({ value, onChange, idPrefix }: { value: SeriesAutoFillField[]; onChange(next: SeriesAutoFillField[]): void; idPrefix: string })`
  - `SeriesMetaSyncDialog({ seriesTitle, memberCount, newMemberCount, groups, articleTitles, autoFillFields, onAutoFillFieldsChange, onConfirm, onSkip, onCancel })`，其中 `articleTitles: ReadonlyMap<string, string>`、`onConfirm(items: SeriesMetaSyncItem[]): void`

- [ ] **Step 1: 实现 `SeriesAutoFillFieldPicker`**

一组四个复选框，标签取自 `META_SYNC_FIELD_LABEL`，顺序取 `SERIES_AUTO_FILL_FIELDS`。样式照 `apps/desktop/src/components/R18Field.tsx:51-62` 的写法（`<label className="flex items-center gap-2 text-sm">` + `<input type="checkbox" className="h-4 w-4 accent-accent">`）。`idPrefix` 只用来拼 `id`/`htmlFor`，避免表单与弹窗里出现重复 id。

- [ ] **Step 2: 实现 `SeriesMetaSyncDialog`**

- 结构：固定遮罩 `<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">` 内一个 `role="dialog" aria-modal="true" aria-labelledby` 的卡片，最大高度 `max-h-[80vh]`、内部滚动。
- 标题：`同步到《{seriesTitle}》内 {memberCount} 篇文章`。
- 两个区块：「补全空字段」与「替换已有值」。每组用原生 `<details open>`（补全默认展开）/ `<details>`（替换默认折叠）+ `<summary>` 显示 `{字段名} {fromLabel} → {toLabel} {n} 篇`，组内逐条一个复选框 + 文章标题。标题来自 `articleTitles: ReadonlyMap<string, string>` 道具（由 `EditorPage` 用 `snapshot.maps.articles` 构造，弹窗自己不碰快照）；取不到时回落到文章 id。
- 每个区块有「全选 / 全不选」两个文字按钮，只作用于本区块。
- 默认选中：`kind === 'fill'` 的组全选，`kind === 'replace'` 的组全不选。用 `useState<Set<string>>` 存 `metaSyncKey(articleId, field)`。
- 组级复选框 = 三态（全选/部分/未选），点击时全选或全不选该组。
- 「未来加入本系列的文章自动填上」区块：复用 `SeriesAutoFillFieldPicker`，`value`/`onChange` 走道具。
- `newMemberCount > 0` 时底部一行小字：「另有 N 篇是本次新加入的，已按「未来自动填上」的策略填了空字段。」
- 按钮行：`[同步并保存]`（`Button variant="primary"`，`onConfirm(选中的 items)`）、`[仅保存系列]`（`onSkip()`）、`[取消]`（`onCancel()`）。
- Esc 关闭：`useEffect` 里监听 `keydown`，`Escape` 调 `onCancel`。
- 不做焦点陷阱（项目无先例，且遮罩覆盖全页）；初始焦点给容器（`tabIndex={-1}` + `ref` + `useEffect` 里 `focus()`）。

- [ ] **Step 3: typecheck**

Run: `corepack pnpm --filter @tpr/desktop typecheck`
Expected: 通过（此时组件还没被引用，只验证自身类型）。

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/components/SeriesMetaSyncDialog.tsx
git commit -m "feat(desktop): 系列元数据同步弹窗"
```

---

### Task 7: 接到系列表单上

**Files:**
- Modify: `apps/desktop/src/pages/EditorPage.tsx:1413-1439`（`SeriesDraftPayload` / `EMPTY_SERIES_PAYLOAD`）、`:1573-1582`（`SeriesPanel.onSubmit`）、`:1608-1770`（`SeriesForm` 状态与提交）、`:1865` 之后（复选框组）、`:1895` 之前（弹窗）

**Interfaces:**
- Consumes: Task 1–6 的全部产出
- Produces: `SeriesForm` 的 `onSubmit(draft, items: SeriesMetaSyncItem[]) => Promise<void>`

- [ ] **Step 1: 类型与默认值**

`SeriesDraftPayload` 加 `autoFillFields: SeriesAutoFillField[];`（放 `sourceUrl` 之后）；`EMPTY_SERIES_PAYLOAD` 加 `autoFillFields: [],`。

`EditorPage.tsx` 顶部导入补：`type SeriesAutoFillField`（来自 `@tpr/schema`）、`type SeriesMetaSyncItem`（来自 `@tpr/core`）、`computeMetaSyncCandidates, groupMetaSyncCandidates, triggeredMetaSyncFields, type MetaSyncBefore, type MetaSyncGroup`（来自 `../editor/meta-sync.js`）、`SeriesAutoFillFieldPicker, SeriesMetaSyncDialog`（来自 `../components/SeriesMetaSyncDialog.js`）。

不要顺手导入 `valuesOfSeries` / `valuesOfArticle`：Step 3 里的 `after` 是直接手写的，这两个函数在页面里用不上，导进来会被 biome 判成未使用。

- [ ] **Step 2: 表单状态**

`SeriesForm` 里加：

```ts
  const [autoFillFields, setAutoFillFields] = useState<SeriesAutoFillField[]>(
    draft?.autoFillFields ?? initial?.autoFillFields ?? [],
  );
```

同时加弹窗状态：

```ts
  const [pending, setPending] = useState<PendingSync | null>(null);
```

`draftPayload` 的 `useMemo` 对象与依赖数组各加 `autoFillFields`；`baselinePayload` 里加 `autoFillFields: initial.autoFillFields`（`EMPTY_SERIES_PAYLOAD` 已含 `[]`）。

顺手把 `baselinePayload` 的泛型从 `SeriesDraftPayload | null` 改成 `SeriesDraftPayload` —— 它内部 `if (!initial) return EMPTY_SERIES_PAYLOAD;` 从不返回 `null`，改掉之后 Step 3 里 `const before: MetaSyncBefore = baselinePayload;` 才能直接赋值（`useDraftAutosave` 的 `baseline` 是 `unknown`，不受影响）。

`draft?.autoFillFields ?? …` 这一层不能省：草稿是从 localStorage `as SeriesDraftPayload` 强转回来的，本次改动之前存的草稿没有这个键。

- [ ] **Step 3: 提交处理器**

`onSubmit` 道具签名改为 `onSubmit(draft: Parameters<Editor['saveSeries']>[0], items: SeriesMetaSyncItem[]): Promise<void>`。

表单 `onSubmit` 改为（`setBusy` 只在真的要保存时设，弹窗等待期间不设）：

```tsx
      onSubmit={(event) => {
        event.preventDefault();
        if (pending) return;
        const draft = {
          ...(initial ? { id: initial.id } : {}),
          title, summary, status, articleIds, authorIds, translatorIds,
          characterTagIds, plotTagIds,
          ...(coverImageId ? { coverImageId } : {}),
          illustrationImageIds,
          ...(sourceUrl.trim() ? { sourceUrl: sourceUrl.trim() } : {}),
          autoFillFields,
        };
        const before: MetaSyncBefore = baselinePayload;
        const after: MetaSyncBefore = { articleIds, authorIds, translatorIds, coverImageId, sourceUrl };
        const triggered = triggeredMetaSyncFields(before, after);
        const candidates = computeMetaSyncCandidates(snapshot, before, after, triggered);
        if (candidates.length === 0) {
          setBusy(true);
          void onSubmit(draft, []).finally(() => setBusy(false));
          return;
        }
        setPending({
          draft,
          autoFillFields,
          groups: groupMetaSyncCandidates(snapshot, candidates, before, after),
          newMemberCount: articleIds.filter((id) => !before.articleIds.includes(id)).length,
          titles: new Map(articleIds.map((id) => [id, snapshot.maps.articles.get(id)?.title ?? id])),
        });
      }}
```

`pending` 的类型（放在 `SeriesForm` 上方的模块级，别写在组件体内）：

```ts
type PendingSync = {
  draft: Parameters<Editor['saveSeries']>[0];
  autoFillFields: SeriesAutoFillField[];
  groups: MetaSyncGroup[];
  newMemberCount: number;
  titles: ReadonlyMap<string, string>;
};
```

- [ ] **Step 4: 渲染**

1. 原出处那一行所在的 `<div className="grid gap-4 sm:grid-cols-2">`（`:1856-1865`）之后、`<PickerRow title="系列插图（可多选）" …>` 之前插：

```tsx
      <div className="flex flex-col gap-1.5 rounded-lg border border-border px-3 py-2">
        <span className={labelClass}>未来加入本系列的文章自动填上</span>
        <SeriesAutoFillFieldPicker
          idPrefix="series-form"
          value={autoFillFields}
          onChange={setAutoFillFields}
        />
        <p className="text-xs text-muted-foreground">
          只填空字段，不会覆盖文章里已有的值。改动系列字段并保存时会问你现有文章怎么处理。
        </p>
      </div>
```

2. `</form>` 之前渲染弹窗：

```tsx
      {pending ? (
        <SeriesMetaSyncDialog
          seriesTitle={title.trim() || '未命名系列'}
          memberCount={pending.draft.articleIds.length}
          newMemberCount={pending.newMemberCount}
          groups={pending.groups}
          articleTitles={pending.titles}
          autoFillFields={pending.autoFillFields}
          onAutoFillFieldsChange={(next) => setPending({ ...pending, autoFillFields: next })}
          onConfirm={(items) => {
            const draft = { ...pending.draft, autoFillFields: pending.autoFillFields };
            setPending(null);
            setBusy(true);
            void onSubmit(draft, items).finally(() => setBusy(false));
          }}
          onSkip={() => {
            const draft = { ...pending.draft, autoFillFields: pending.autoFillFields };
            setPending(null);
            setBusy(true);
            void onSubmit(draft, []).finally(() => setBusy(false));
          }}
          onCancel={() => setPending(null)}
        />
      ) : null}
```

弹窗里的复选框是权威值：`saveSeries` 拿到的是弹窗改过之后的 `autoFillFields`，不是表单里那一份。

- [ ] **Step 5: 面板接线**

`SeriesPanel` 的 `onSubmit` 改成两次 `run`，中间先关表单：

```tsx
          onSubmit={async (draft, items) => {
            let seriesId = '';
            const ok = await run(async () => {
              seriesId = await editor.saveSeries(draft);
              recent.touchUsage(seriesUsage(draft));
            }, '系列已保存');
            if (!ok) return;
            if (box.draftId) box.discard(box.draftId);
            closeForm();
            if (items.length === 0) return;
            let synced = 0;
            await run(
              async () => {
                try {
                  synced = await editor.applySeriesMetaSync(seriesId, items);
                } catch (cause) {
                  throw new Error(`系列已保存，但同步文章失败：${errorText(cause)}`);
                }
              },
              () => `系列已保存，同步了 ${synced} 处`,
            );
          }}
```

`seriesUsage(draft)` 不认 `autoFillFields`（它的参数类型里没有这个键），无需改。

- [ ] **Step 6: typecheck 与全量测试**

Run: `corepack pnpm typecheck && corepack pnpm test`
Expected: 全绿。桌面端 90 例（原 80 + Task 5 新增 10）通过，core 229 例通过，schema 31 例通过。

- [ ] **Step 7: 手工验收（开发模式）**

Run: `corepack pnpm dev:web`
按 Spec「验收标准」1–10 条逐条点一遍，重点看：改作者弹一次窗；「仅保存系列」文章不变；「取消」后表单还开着；清空封面不弹窗；只改简介不弹窗。

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/pages/EditorPage.tsx
git commit -m "feat(desktop): 系列页保存时询问是否同步元数据"
```

---

### Task 8: 设计文档追加记录

**Files:**
- Modify: `TohoPR_design.md:2299` 之后（新增 `## Goal 27 追加记录：系列元数据向下同步`）、`:2312`（自检表那行改成 27）

**Interfaces:**
- Consumes: Task 1–7 的实现
- Produces: 无

- [ ] **Step 1: 追加 Goal 27 小节**

在 `## 追加记录：编辑器「最近使用」排序` 那节末尾的 `---`（`:2299`）之后、`## 附：文档自检`（`:2301`）之前插入一节，按现有 Goal 条目的写法（粗体小标题 + 冒号 + 说明）覆盖：

- **策略字段**：`Series.autoFillFields`（`cover`/`author`/`translator`/`sourceUrl`），zod `.default([])`，作为加法变更不升 `manifest.schemaVersion`，旧包缺字段按空数组处理，导出照常写出。
- **SQLite v3 → v4**：`series.auto_fill_fields TEXT` 存 JSON 数组，NULL 与 `'[]'` 同义；`SQL_SCHEMA_VERSION = 4`；迁移照 v2 → v3 的写法（`columnNames()` 先探测、与版本写入同一个 batch），读时容错。
- **继承填空**：`fillFromSeries(article, series)` 只在「文章新进入系列」时生效（`saveArticle` 判 `existing.seriesId !== targetSeriesId`，`saveSeries` 判该 id 不在保存前的 `articleIds` 里），只填空不覆盖，与目录双向同步同一个 `applyEdit` 闭包。
- **显式清单同步**：`applySeriesMetaSync(seriesId, items)` 返回改动条数，跳过系列/文章不存在、不在目录、系列该字段为空、文章已一致；清单为空直接返回 0 不进 `applyEdit`。
- **界面**：`SeriesForm` 提交时算触发字段与候选 → 弹窗（`SeriesMetaSyncDialog`，补全默认全选、替换默认全不选、组内可折叠、组级与单篇级可取消）→ 确认后先 `saveSeries` 再 `applySeriesMetaSync`；两次写库不在一个事务，同步失败只报错不回滚；弹窗里的「未来自动填上」复选框是权威值。本次新加入的篇目走继承、不进候选；新建系列不弹窗；从文章表单进系列不弹窗。
- **测试与验证**：列出五项命令与实际例数（基线 schema 28 → 31、core 222 → 229、desktop 80 → 90，按实际填写），说明桌面端仍无组件测试、界面靠 typecheck + 手工验收。
- **取舍**：不加 provenance（追踪来源要在编辑表单/导入/导出/合并/标签合并每条路径维护，成本三到四倍）；不做反向同步；不在标签与插图上做。

- [ ] **Step 2: 更新自检表**

`TohoPR_design.md:2312` 那行「Goal 1–26 的实现均已回填 §18.1」→「Goal 1–27 …」。

- [ ] **Step 3: Commit**

```bash
git add TohoPR_design.md
git commit -m "docs: 记录系列元数据向下同步"
```

---

## 自检

**1. Spec 覆盖**：数据模型 → Task 1；SQLite 布局与迁移 → Task 2；编辑器（`SeriesDraft`、继承、`applySeriesMetaSync`）→ Task 3/4；界面与弹窗 → Task 5/6/7；测试章节 → Task 1/2/3/4/5 各自的 Step 1；验收标准 11/12 → Task 7 Step 6/7 与 Task 2；「从文章表单进入系列时不弹窗」→ Task 3（继承只发生在 core，界面不介入）；改动清单 11 项 → Task 1–8 全覆盖；「不做的事与理由」「风险」→ Task 8 的取舍条目。

**2. 步骤扫描**：每个 Step 只让实现者做一件事；代码块只在签名定不住的地方给（`copyField` 的分支、`applySeriesMetaSync` 的跳过规则、弹窗的选中模型）。测试步骤给断言而非整份文件（Task 3 的 harness 例外，因为它要照抄另一份文件）。

**3. 类型一致性**：`SeriesAutoFillField`（Task 1）在 Task 2/3/4/5/6/7 里同名同义；`SeriesMetaSyncItem` 在 Task 4 定义、Task 6/7 消费；`MetaSyncGroup`/`MetaSyncBefore`/`MetaSyncCandidate` 在 Task 5 定义、Task 6/7 消费；`onSubmit(draft, items)` 在 Task 7 内部两处（`SeriesPanel` 与 `SeriesForm`）签名一致。

**4. Review Focus 落地**：空候选不弹窗 → Task 7 Step 3 的 `candidates.length === 0` 分支；新加入篇目只走继承 → Task 3 Step 1 第三条测试 + Task 5 Step 1 的「新加入不进清单」；旧草稿缺键 → Task 7 Step 2 的 `?? []`；顺序不同不算替换 → Task 5 的 `triggered: 同一集合换个顺序不算变化`；清空/只改简介不触发 → Task 5 的第一条测试。

**5. 篇幅比例**：本计划约为 Spec 的 0.9 倍；代码块集中在签名与分支决策，没有整份实现转录。
