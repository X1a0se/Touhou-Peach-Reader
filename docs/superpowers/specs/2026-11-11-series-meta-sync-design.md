# 系列元数据向下同步

日期：2026-11-11
状态：待批准

## 意图与缘由

一个系列有几十篇，封面、作者、译者、原出处通常全系列一致。现在这些值要在每篇文章上各填一遍：建系列时填一次，再把几十篇的对应字段逐个补上，等于同一份信息维护几十份。漏一篇就是一处不一致，而且要等有人翻到才发现。

想要的效果是：在系列页把系列自身的封面 / 作者 / 译者 / 原出处填好（或改掉），系统顺势问一句"系列里的文章要不要跟着改"，用户勾一下，几十篇一起到位；并且能记住"以后加进这个系列的文章也自动填上"，让这件事只做一次。

谁用：维护书库的人，也就是本项目作者自己。

## 目标

- 系列页保存时，若系列的封面 / 作者 / 译者 / 原出处**新填了值**或**换了值**，弹一次窗口，让用户决定：
  - 系列内文章**空着的**这些字段要不要补上；
  - 系列内文章**已有不同值**的这些字段要不要替换。
- 弹窗能预览影响范围：按「字段 + 旧值 → 新值」分组，可折叠，可一键全选/全不选，组级与单篇级都能单独取消。
- 能把「未来加入本系列的文章自动填上这些字段」记进数据库，按字段勾选。
- 文章新进入系列的两条路径都按这个策略填空：文章表单改系列、系列表单改目录。
- 逻辑落在 `packages/core`，可单测，UI 只负责问和展示。

## 非目标

- 不做撤销。全库没有 undo，标签合并的文案已经写明「操作不可撤销」，本功能沿用这个约定。
- 不追踪继承来源。不做「这个值是从系列抄来的」这类标记，也不做反向同步或取消继承。
- 不覆盖标签、插图。它们是多项集合而非单一来源，塞进同一个弹窗会让确认界面变成网格。
- 不改导出格式的版本号。新字段是加法式可选字段（`Series.translatorIds` 已有同样先例）。
- 不在文章页做询问。那里没有"刚改过系列的某个字段"这个前提，只在文章进入系列时按已存策略静默填空（见下文「从文章表单进入系列时不弹窗」）。

## 反目标

- **把系列的值无条件刷到所有文章上**。系列的作者是「系列署名」，不代表每篇都一样；用户必须能逐字段、逐篇拒绝。
- **弹窗在缩略图上说不清影响了什么**。只说"12 篇将被修改"而不给旧值 → 新值的分组，等于让用户盲签。
- **同一字段改一次弹一次**。改封面 + 作者 + 出处应当只弹一次。

## 约束

- 数据库是 SQLite，`PRAGMA user_version` 是唯一权威，现有 `SQL_SCHEMA_VERSION = 3`。新增列必须走 v3 → v4 迁移，照 `packages/core/src/db/sql/migrate.ts` 现有模式：`columnNames()` 先探测、ALTER 与版本写入同一个 `platform.sql.batch` 单事务、中断后从旧版本重试天然幂等。
- 磁盘 JSON 的 `manifest.schemaVersion` **不升**。`packages/schema/src/entities.ts` 的 zod object 默认非 strict，旧客户端读新库会丢弃未知键；项目已有 `Series.translatorIds` 的同款先例（TohoPR_design.md:547）。
- 所有写操作必须走 `library.applyEdit`，不能绕过校验与事务。
- 桌面端没有现成的模态组件，全站确认一律 `window.confirm`。做复选框 + 折叠 + 全选必须新建一个组件。
- 不允许"系列存了、文章没填"这种状态**悄悄发生**：两步不在一个事务里（系列实体与文章是两个不同的写路径），所以任何一步失败都必须有可见的提示，不能一句"保存成功"盖过去。

## 方案

### 方案一：系列上加字段，逻辑放 core（选中）

`Series` 新增可选字段记录"未来自动填哪些字段"，core 在文章进入系列时读它。系列内既有文章的同步由一个独立的核心方法按显式的「文章 × 字段」清单执行。

- 优点：策略随数据库走，导出、换机、别人导入都还在；逻辑在 core，两条进入路径天然都覆盖，可单测；与项目现有分层一致。
- 代价：动 schema、SQL 迁移、读写编解码、编辑器、界面，约 7 个文件；需要一次 v3 → v4 迁移。

### 方案二：策略存本机设置（settings.json，按系列 id 记）

- 优点：不动 schema、不写迁移。
- 代价：导出数据库包时不带走，换台电脑静默失效；概念上也不对 —— 这是数据库内容，不是本机偏好。项目里 `settings.json` 明确不进数据库包。

### 方案三：不存，每次有文章加入系列时再问

- 优点：零迁移、零新字段。
- 代价：每加一篇问一次，系列长起来极其烦人；且与要求的交互点（在系列页问一次）不是同一处。

### 选方案一的理由

用户明确要求"询问一次、之后自动"，这就必须有持久化的地方。方案二的失效是静默的 —— 用户不会发现策略丢了，只会在几个月后发现新文章没被填上。方案三把一次决策摊成 N 次打断。方案一多改的文件是一次性的，换来的是概念正确、可测、可导出。

## 已定的做法

### 1. 数据模型（`packages/schema/src/entities.ts`）

```ts
export const seriesAutoFillFieldSchema = z.enum(['cover', 'author', 'translator', 'sourceUrl']);
export type SeriesAutoFillField = z.infer<typeof seriesAutoFillFieldSchema>;

// seriesSchema 新增
autoFillFields: z.array(seriesAutoFillFieldSchema).default([]),
```

用 `.default([])` 与 `translatorIds` 一致：旧包缺字段时按空数组处理，写出时总是带上。

### 2. SQLite 布局（v3 → v4）

`series` 表新增一列：

```sql
ALTER TABLE series ADD COLUMN auto_fill_fields TEXT
```

存 JSON 数组（如 `["cover","author"]`），`NULL` 与 `'[]'` 都表示"不自动填"。选 JSON 列而不是子表 `series_auto_fill`，因为 `manifest.counts_json` 已有同款先例，且子表要额外承担建表、索引、读分组、整写循环、差异写删重插五处改动 —— 为最多 4 个值不值得。

`packages/core/src/db/sql/migrate.ts` 里照 v2 → v3 那段的样子加一段（放在 `if (version < 3) {…}` 之后、`statements.push({ sql: \`PRAGMA user_version = ${SQL_SCHEMA_VERSION}\` })` 之前）：

```ts
if (version < 4) {
  const seriesColumns = await columnNames(platform, dbPath, 'series');
  if (!seriesColumns.has('auto_fill_fields')) {
    statements.push({ sql: 'ALTER TABLE series ADD COLUMN auto_fill_fields TEXT' });
  }
}
```

同文件 `:25` 的注释也写着「user_version 是唯一权威：新库直接是 3，v1 旧库补 updated_at，v2 旧库补系列插图」，要补上 v3 → v4 这一句，否则注释立刻过期。

读数时 `JSON.parse` 必须容错：解析失败或不是字符串数组一律当空数组，不抛错（与 `counts_json` 的悲观读取一致）。

`store.ts` 三处跟着改：

- 读（`:226-229` 的 SELECT、`:277-301` 的映射）：查询列尾加 `auto_fill_fields`，映射里解析成数组后无条件写入 `autoFillFields`；
- 整体写（`:578-593` 的 `INSERT INTO series(...)`）：现有 10 个列与 10 个占位扩成 11，参数数组末尾加 `JSON.stringify(series.autoFillFields)`；
- 差异写（`:894-911` 的 `INSERT … ON CONFLICT(id) DO UPDATE SET …`）：同样各加一项，`DO UPDATE SET` 里也要加 `auto_fill_fields=excluded.auto_fill_fields`，否则旧行永不被更新。注意 `:896` 的 `stableStringify(before) === stableStringify(series)` 短路：新字段参与比对，策略一改就会触发重写，正是想要的。

`illustration_ids_present` 那套"区分 undefined 与空数组"的写法这里不需要：语义上"没有策略"和"策略为空"是一回事。于是定死为：**读出来的 `Series` 永远带 `autoFillFields`，没有策略时是 `[]`**，与 `authorIds` 同款。

解析的写法照抄 `counts_json`（`:74-82`）的悲观风格，但要多一步元素过滤，因为 zod 只在整库校验时才跑，store 里得自己保证类型：

```ts
// store.ts 顶部
import { seriesAutoFillFieldSchema, type SeriesAutoFillField } from '@tpr/schema';
const AUTO_FILL_FIELDS = seriesAutoFillFieldSchema.options; // ['cover','author','translator','sourceUrl']

function parseAutoFillFields(row: SqlRow): SeriesAutoFillField[] {
  try {
    const parsed = JSON.parse(rowNullableText(row, 'auto_fill_fields') ?? '[]') as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is SeriesAutoFillField =>
      AUTO_FILL_FIELDS.includes(item as SeriesAutoFillField),
    );
  } catch {
    return [];
  }
}
```

（`SqlRow` 已从 `@tpr/platform` 导入；`@tpr/schema` 也已在 `store.ts` 的导入清单里。）

`packages/core/src/db/sql/schema.ts` 的建表 DDL（`:123-135`）也要加同名列，否则**新建**的库缺列、`SELECT` 直接报错。加在 `illustration_ids_present` 之后：`auto_fill_fields TEXT`。

这条"永远带"必须同步到测试夹具：`packages/schema/src/testing/factory.ts` 的 `makeSeries()` 要加 `autoFillFields: []`。否则 `packages/core/test/migrate.test.ts` 第一条测试用 `canonicalDatabase(actual) === canonicalDatabase(db)` 逐字段比对，读回的对象多了这个键就会挂。

### 3. 编辑器（`packages/core/src/editor/index.ts`）

`SeriesDraft` 新增可选 `autoFillFields?: SeriesAutoFillField[]`。`saveSeries` 里：

```ts
autoFillFields: [...new Set(draft.autoFillFields ?? existing?.autoFillFields ?? [])],
```

不用现成的 `clean()`（`:104`，签名是 `string[] → string[]`）会丢字面量类型，得再断言一次；一行 `new Set` 更直接。`satisfies Series` 那条会因此强制这个地方必须给出值 —— 正好防漏。

未传 `autoFillFields` 时保留原值（与 `illustrationImageIds` 的三段式保留同理），显式传空数组时清空。

新增一个方法，按**显式清单**执行同步：

```ts
export interface SeriesMetaSyncItem {
  articleId: string;
  field: SeriesAutoFillField;
}

/** 把系列当前的值写到指定文章的指定字段上；一个事务，一条 revision */
applySeriesMetaSync(seriesId: string, items: readonly SeriesMetaSyncItem[]): Promise<number>
```

返回实际改动的条数。行为：

- 逐项在 `db.series` / `db.articles` 里查；系列不存在、文章不存在、文章不在 `series.articleIds` 里 → 跳过该项，不抛错。
- 取值一律读**数据库里此刻的**系列值，不接受调用方传值 —— 保证预览看到的就是写进去的。
- 系列该字段为空 → 跳过。
- 文章字段已与系列值相同 → 跳过，不计入返回值。
- 写入后更新 `article.updatedAt`（只对真改了的文章）。
- 整个调用一次 `applyEdit`：一个事务、一次 `revision` 自增、一次界面刷新。

用显式清单而不是"传几个布尔位让 core 自己算"，是因为弹窗允许逐篇取消；清单即所见即所得，不会出现"预览说 12 篇、实际改了 13 篇"。

新方法要加进 `Editor` 接口（`packages/core/src/editor/index.ts:83-100`，`saveSeries` 与 `deleteSeries` 之间）与 `createEditor` 返回的对象字面量，否则界面拿不到。`packages/core/src/index.ts` 是 `export * from './editor/index.js'`，新类型自动对外可见。

`saveArticle` 与 `saveSeries` 各加一处**继承**：文章**新进入**某个系列的那一刻，按系列的 `autoFillFields` 把文章里**空着的**字段填上。

- 只填空，不覆盖。新加入的文章自己填了作者，就保留它自己的。判定口径就是"draft 里这一项为空 / 文章现有的这一项为空"。
- 只对"新进入"生效：`saveArticle` 判 `existing?.seriesId !== targetSeriesId`；`saveSeries` 判该 `articleId` 不在保存前的 `articleIds` 里。已经在系列里的文章走弹窗那条路，不会因为下次保存系列就被悄悄改掉 —— 否则用户在弹窗里拒绝过的补全会自己回来。
- **必须写在同一个 `applyEdit` 闭包内**，不能保存完再补一次写：同一事务才能保证"文章进了系列"和"字段被填上"要么都发生要么都不发生。`saveArticle` 里落在 `next`/`existing` 上（`:161-186` 的 `applyEdit` 内），`saveSeries` 里落在 `:249-260` 那个遍历文章的双向同步循环里 —— 那里已经在遍历所有文章并判"是否在目录里"，顺手填字段不增加一次扫描。
- `saveArticle` 用**目标系列此刻在库里**的值；`saveSeries` 用**本次要写入的新值**（`next` 上的 `authorIds` 等），因为系列本来就要被这次保存改掉。
- 两处都必须**在 `Object.assign` 之前**把"保存前的状态"抓成局部变量，否则读到的是已经被改过的对象：
  - `saveArticle`：`const entering = (existing?.seriesId ?? '') !== targetSeriesId;`（`existing` 在 `:181` 被 `Object.assign` 覆盖）
  - `saveSeries`：`const beforeIds = new Set(existing?.articleIds ?? []);`（`existing` 在 `:245` 被覆盖，之后 `existing.articleIds` 已是新数组）

填空的共用逻辑抽成一个小函数，放在 `packages/core/src/editor/index.ts` 里 `clean()` 附近：

```ts
/** 文章新进入系列时按策略补空字段：只填空，不覆盖。返回是否有改动。 */
function fillFromSeries(article: ArticleFile, series: Series): boolean {
  const fields = series.autoFillFields ?? [];
  let changed = false;
  if (fields.includes('author') && article.authorIds.length === 0 && series.authorIds.length > 0) {
    article.authorIds = [...series.authorIds];
    changed = true;
  }
  if (fields.includes('translator') && article.translatorIds.length === 0 && series.translatorIds.length > 0) {
    article.translatorIds = [...series.translatorIds];
    changed = true;
  }
  if (fields.includes('cover') && !article.coverImageId && series.coverImageId) {
    article.coverImageId = series.coverImageId;
    changed = true;
  }
  if (fields.includes('sourceUrl') && !article.sourceUrl?.trim() && series.sourceUrl?.trim()) {
    article.sourceUrl = series.sourceUrl;
    changed = true;
  }
  if (changed) article.updatedAt = now();
  return changed;
}
```

两处调用：

- `saveArticle`：在 `const next = {...} satisfies …` 之后、`if (existing) Object.assign(existing, next)` 之前，`if (entering) { const host = db.series.find((s) => s.id === targetSeriesId); if (host) fillFromSeries(next, host); }`。
- `saveSeries`：在 `:249-260` 的循环里，`if (articleIds.includes(article.id))` 分支内、`article.type = 'series-entry'` 之后，加 `if (!beforeIds.has(article.id)) fillFromSeries(article, next);`。

`Series` 已在 `editor/index.ts:12` 的导入清单里；`ArticleFile` **没有**，要在 `:6-21` 那段加一项 `type ArticleFile,`。`SeriesAutoFillField` 也要加进去。

注意 `next` 上的 `coverImageId` 是条件展开的（`:174`），字段可能根本不存在，所以判定写 `!article.coverImageId` 而不是 `article.coverImageId === undefined`，两种都覆盖。`fillFromSeries` 直接改对象，`next` 此时还没进 `db.articles`，改完随 `Object.assign`/`push` 一起生效。


`applySeriesMetaSync` 在 `items` 为空时直接返回 0，不进 `applyEdit` —— 否则会白改一次 `manifest.updatedAt`、白加一次 `revision`、白触发一次界面刷新。

### 4. 界面

`SeriesDraftPayload` 加 `autoFillFields: SeriesAutoFillField[]`。

`SeriesForm` 在原出处那一行下方新增一组复选框「未来加入本系列的文章自动填上：封面 / 作者 / 译者 / 原出处」，用 `EMPTY_SERIES_PAYLOAD` 与 `baselinePayload` 同步，接入现有草稿自动保存。它是这个策略的常驻编辑入口 —— 弹窗只在字段变化时出现，平时得有别的地方能关掉。

`EMPTY_SERIES_PAYLOAD` 也要加 `autoFillFields: []`。草稿是从 localStorage 里 `as SeriesDraftPayload` 强转回来的（`EditorPage.tsx:1472/1488/1494`），本次改动之前存的草稿没有这个键，所以 state 初始化必须写成 `draft?.autoFillFields ?? initial?.autoFillFields ?? []`，不能假设它存在。旧草稿因此会被 `useDraftAutosave` 判为"与 baseline 不同"（`stableSerialize` 比对新键），表现为照常提示「已恢复未保存的草稿」—— 这正是期望行为。

新建 `apps/desktop/src/components/SeriesMetaSyncDialog.tsx`。它不碰数据库，只接收已解析好的候选、显示串和一个回调。

**弹窗挂在 `SeriesForm` 里，不挂在 `SeriesPanel` 里。** 因为表单自己拿着全部字段 state 与 `initial`/`snapshot`，而 `SeriesForm` 的提交处理器现在是「`setBusy(true)` → 立刻 `onSubmit(draft)`」，`busy` 一开始就会把按钮变成「保存中…」—— 弹窗在等用户勾选时显示"保存中"是错的。改为：

1. 表单的提交处理器先算**触发字段**：`after`（表单当前值）非空，且与 `before`（**`baselinePayload`**，即打开表单那一刻的值，见下）不同（`authorIds`/`translatorIds` 按集合比，顺序变化不算）。一个都没有 → 照旧 `setBusy(true)` 直接 `onSubmit(draft, [])`。
   也要处理**有触发字段但候选为空**的情形：系列里一篇都没有、或每篇要么已一致要么新值为空。这时不弹空窗，直接 `onSubmit(draft, [])` 保存；让用户对着一个只有按钮的空窗口点两下是纯噪音。
2. 有触发字段 → 对**保存前就在系列里**的文章（`before.articleIds`，同样来自 `baselinePayload`）逐篇逐字段比较：文章空 → 「补全」候选；有值且不同 → 「替换」候选。用 `setPending({ draft, candidates })` 打开弹窗，**不设 busy、不写库**。
3. 用户确认 → `setBusy(true)` 后 `onSubmit(draftWithDialogAutoFill, selectedItems)`；点「仅保存系列」→ `onSubmit(draftWithDialogAutoFill, [])`；点「取消」→ 关弹窗，什么都不做。

`onSubmit` 的签名因此变成 `(draft, items: SeriesMetaSyncItem[]) => Promise<void>`。

**候选计算放在 `SeriesForm` 里，弹窗作为表单的子组件渲染。** 表单已经有 `snapshot`（`SeriesForm` 的 props 第一个就是），能直接读 `snapshot.maps.articles` / `snapshot.maps.authors` / `snapshot.maps.images`，不需要向 `SeriesPanel` 再要一趟。这样 `SeriesPanel` 只管"收到 `(draft, items)` 就写库"，弹窗与表单的 `busy`/`initial` 都在同一个组件里，不会有"面板开窗、表单关掉了"这种错位。

计算用纯函数，写成 `EditorPage.tsx` 顶层的导出（不给组件加 state）：

```ts
export interface MetaSyncCandidate {
  articleId: string;
  field: SeriesAutoFillField;
  kind: 'fill' | 'replace';   // 空字段补全 / 已有不同值替换
}

/** 只需要"保存前"的几个字段，`SeriesDraftPayload` 与 `Series` 都满足。 */
export interface MetaSyncBefore {
  articleIds: string[];
  authorIds: string[];
  translatorIds: string[];
  coverImageId: string;   // '' 表示没有
  sourceUrl: string;      // '' 表示没有
}

export function computeMetaSyncCandidates(
  snapshot: DBSnapshot,
  before: MetaSyncBefore | null,   // 保存前的系列（新建时为 null）
  after: MetaSyncBefore,           // 表单当前值
  triggered: readonly SeriesAutoFillField[],
): MetaSyncCandidate[]
```

**「保存前」的取值一律用 `baselinePayload`，不要用 `initial`。** 两个理由：`initial` 上 `coverImageId`/`sourceUrl` 是 `string | undefined`（`Series` 里二者可选），而表单值是 `''`；`baselinePayload`（`EditorPage.tsx:1705-1720`）已经把缺省值归一成 `''`，直接比不必到处写 `?? ''`。另外 `baselinePayload` 的 `useMemo` 依赖是 `[initial]`（引用不变就不重算），整场保存流程里都冻在打开表单那一刻的值。新建系列时 `baselinePayload` 是 `EMPTY_SERIES_PAYLOAD`，`articleIds` 为空，候选自然为空。

（`initial` 本身不会被 `saveSeries` 改坏：`packages/core/src/db/library.ts:144` 先 `structuredClone(current.db)` 再 build，`Object.assign(existing, next)` 改的是克隆里的对象。)

遍历 `before.articleIds`，对每个 `triggered` 字段与 `snapshot.maps.articles.get(articleId)` 的当前值比较：文章该字段为空 → `'fill'`；非空且与系列新值不同 → `'replace'`；相同 → 不列入。文章 id 在 `snapshot` 里找不到（悬空引用）时跳过。

**本次新加入的文章不进候选清单。** 它们在 `saveSeries` 里由继承逻辑按策略静默填空，若同时列进弹窗就会有一篇被两条路径各写一次，预览的篇数也就不准了。弹窗底部用一行小字交代它们：「另有 3 篇是本次新加入的，已按「未来自动填上」的策略填了空字段」。想要替换这类新成员已有的值，去文章表单改 —— 这次不做。

**弹窗里的「未来自动填上」复选框是权威值。** 用户在弹窗里改了勾选，`saveSeries` 必须写改后的值，不是表单里那一份。所以 `onSubmit` 拿到的 `draft` 覆盖成 `{ ...draft, autoFillFields: dialogResult.autoFillFields }`；`SeriesForm` 的 state 不用回写（表单随即关闭）。

新建系列时 `baselinePayload` 是 `EMPTY_SERIES_PAYLOAD`，`before.articleIds` 为空 —— 按上一条"新加入的不进候选"，候选自然是空的，**所以新建系列不弹窗**。用户新挑进目录的那 8 篇全部走继承逻辑按策略填空；"以后加进来的也自动填"由表单里那组常驻复选框决定。这不是妥协：用户说的"添加或替换封面"本来就是编辑既有系列的场景，新建时还没有"已经在系列内的文章"可问。

两次写库的顺序固定为**系列先写、文章后写** —— `applySeriesMetaSync` 读库里此刻的系列值，系列没落库它只能读到旧的：

```ts
// SeriesPanel 的 onSubmit(draft, items)
let seriesId = '';
const ok = await run(async () => {
  seriesId = await editor.saveSeries(draft);
  // 保存成功才算「用过」：作者/译者/标签/图片提到各列表最前
  recent.touchUsage(seriesUsage(draft));
}, '系列已保存');
if (!ok) return; // 系列没存成：表单与草稿都留着，让用户改
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
```

要点是**两次 `run` 分开，中间先把表单关掉**：

- 系列没存成 → 表单和草稿都留着，与现在行为一致。
- 系列存成了 → 立刻 `box.discard` + `closeForm`，再做同步。这样同步失败时用户看到的是页面顶部的一条红色提示「系列已保存，但同步文章失败：…」，而不是一个还开着的表单 —— 后者会诱导用户重按保存，而对着一个 `initial` 已经过期的表单重存是另一类麻烦。
- 同步失败同样走 `run` 的 catch（`ok` 变 false，这一次没人再看它），所以 `SeriesPanel` 不需要自己去碰 `setError` —— 它手上只有 `run` 这个道具，没有 setter。
- `applySeriesMetaSync` 对同一份清单重放是幂等的（已一致就跳过），用户想补上可以重开系列再触发一次。

`run` 的 `done` 支持函数形式（`type Run` 在 `EditorPage.tsx:620` 已声明 `string | (() => string)`），所以能拿到 `synced` 之后再生成文案。


### 5. 弹窗内容

```
┌─ 同步到《系列名》内 37 篇文章 ─────────────────────────┐
│ 系列的封面 / 作者 / 译者 / 原出处已更新。              │
│                                                       │
│ ☑ 补全空字段                              12 篇        │
│   全选 · 全不选                                       │
│   ▼ 作者    （未填写）→ 张三                    7 篇 ☑ │
│        ☑ 第一篇  ☑ 第二篇  ☑ 第三篇  …               │
│   ▶ 原出处  （未填写）→ https://tieba.baidu.com/… 5 篇 ☑│
│                                                       │
│ ☐ 替换已有值  ⚠ 覆盖后无法撤销             3 组 / 9 篇 │
│   全选 · 全不选                                       │
│   ▶ 作者    王五 → 张三                         2 篇 ☐ │
│   ▶ 封面    cover-02 → cover-07                 4 篇 ☐ │
│   ▶ 原出处  …/p/8 → …/p/123                     3 篇 ☐ │
│                                                       │
│ 未来加入本系列的文章自动填上：                         │
│   ☑ 封面  ☑ 作者  ☐ 译者  ☑ 原出处                     │
│                                                       │
│        [同步并保存]  [仅保存系列]  [取消]              │
└───────────────────────────────────────────────────────┘
```

- 折叠用原生 `<details>/<summary>`，不引入状态。
- 选中集合的键是 `articleId + '\u0000' + field` —— 每个「文章 × 字段」只会落进一个分组，不存在歧义。
- **「补全空字段」默认全选；「替换已有值」默认全不选。** 这是我的判断：补全是加法，替换会覆盖别人已经填过的值，默认不该替用户做这个决定；要替换有现成的「全选」一键。用户如果每次都想要替换，改默认值即可。
- 「未来…自动填上」默认勾选本次的触发字段，可改。

### 6. 判定口径

| 说法 | 口径 |
|---|---|
| 「未填写」 | `authorIds`/`translatorIds` 长度为 0；`coverImageId` 为空串或未设置；`sourceUrl` 去空白后为空 |
| 「添加或替换」 | 系列字段 `after` 非空，且与 `before` 不同（`authorIds`/`translatorIds` 按集合比，顺序变化不算） |
| 清除 | `before` 非空、`after` 为空 —— 不触发弹窗 |
| 已一致 | 文章字段与系列值相同 —— 不列入候选 |

填了「佚名」这类真实作者记录不算未填写。

### 7. 测试

`packages/core/test/series-meta-sync.test.ts`（新建，沿用 `edit.test.ts` 的 `createMemoryPlatform` + `makeDatabase()` 夹具）：

- `saveSeries` 保存 `autoFillFields`，经 SQLite 往返后读回一致；未传时保留原值；传空数组时清空。
- `applySeriesMetaSync` 只改清单里的「文章 × 字段」，未列入的不动。
- 清单里含不在系列内的文章 / 不存在的文章 / 系列该字段为空 → 跳过且不抛错，返回值不计。
- 文章值已与系列相同的项不计入返回值；同一份清单重放返回 0。
- `saveArticle` 把文章移进系列时，按策略补空格、不覆盖已有值；策略未包含的字段不动。
- `saveSeries` 把文章加进目录时同上；已在系列里的老文章**不**被自动改。
- 拒绝过的补全不会因为下次保存系列而回流。

`packages/core/test/migrate.test.ts` 补一例（照现有 v2 → v3 那条的写法：先在内存库上 `ALTER TABLE series DROP COLUMN auto_fill_fields` + `PRAGMA user_version = 3`，再调 `ensureLocalDatabase`）：升到 v4 后 `auto_fill_fields` 列存在，`PRAGMA user_version = 4`，且读出的系列 `autoFillFields` 为 `[]`。

同文件还有三处硬编码的版本号必须一起改，否则升版后必然挂：

- `:160`（v1 → v3 那条的收尾断言）`expect(Number(upgradedRows[0]?.user_version)).toBe(3)` → 改成 `toBe(SQL_SCHEMA_VERSION)`；
- `:192`（v2 → v3 那条）同样一句 `toBe(3)` → 改成 `toBe(SQL_SCHEMA_VERSION)`；
- `:204-206`（「版本高于当前 schema 时拒绝打开」）`PRAGMA user_version = 4` + 断言 `/不支持的本地数据库版本：4/` → 改成 `PRAGMA user_version = 5` 与 `/不支持的本地数据库版本：5/`（或统一用 `SQL_SCHEMA_VERSION + 1` 拼字符串）。不改的话，这条会变成"用当前版本号打开当前库"，测的是不存在的情形。

`:161` 与 `canonicalDatabase` 的逐字段比对那条（v1 → v3）也覆盖了新列：迁移后读出的系列必须带 `autoFillFields: []`，与 `makeSeries()` 加的那一项对齐。


`packages/schema/test/database.test.ts` 补一例（该文件已有整库解析的测试）：系列的 `autoFillFields` 缺省时解析为 `[]`，带未知键时被丢弃而不抛错，带不认识的字段名（如 `'tag'`）时报错。`packages/schema/src/index.ts` 是 `export * from './entities.js'`，新类型与 schema 自动对外可见，不需要额外导出。

界面层不写自动化测试（项目现状：桌面端无组件测试），靠 `corepack pnpm typecheck` 顶住类型。

## 验收标准

实现完成的判据，逐条能在界面上验：

1. 打开一个已有 20 篇的系列，只改「作者」，点保存 → 弹出一次窗口；「补全空字段」区列出作者为空的篇目；没改封面/译者/出处时这三个字段不出现任何分组。
2. 点「同步并保存」→ 系列与勾中的文章都更新，提示里带具体条数；重开这些文章，作者已是新值。
3. 同上但点「仅保存系列」→ 文章一个都没变。
4. 同上但点「取消」→ 系列也没保存，表单仍然开着，草稿还在。
5. 标题都不改、只改一个字的简介，然后保存 → 不弹窗，直接保存。
6. 把系列的封面清空（选回「无」）→ 不弹窗。
7. 弹窗里「替换已有值」默认一个都不勾；点「全选」后立刻全勾；单个组的勾去掉不影响其它组。
8. 勾上「未来自动填上 → 作者」，保存；随后去文章页把一篇短篇的系列改成这个系列并保存 → 那篇的作者自动变成系列作者（它原本为空），且没有再弹窗。
9. 同 8，但那篇本来就填了别的作者 → 保持它自己的作者不变。
10. 回到系列页，不动任何字段直接保存 → 不弹窗，之前拒绝过的补全没有自己回来。
11. `corepack pnpm typecheck`、`corepack pnpm test`、`corepack pnpm check`、`node scripts/check-boundaries.mjs`、`node scripts/check-no-tauri.mjs` 全绿。
12. 用改动前导出的一个 `.tpr` 包装回库（或直接用旧库文件打开）→ 正常打开，v3 → v4 迁移完成，系列列表、文章、导出内容都正常。

## 从文章表单进入系列时不弹窗

在 `ArticleForm` 里改系列、保存，文章会成为系列成员。这条路径**只按已存的 `autoFillFields` 静默填空，不问任何问题** —— 那里没有人刚改过系列的封面/作者，没有"要不要同步给其他篇"这个问题可问。用户说的"询问"发生在系列页改字段时；"未来加入自动填"是一次性存下来的策略。

所以两条路径的分工是：系列页 = 改字段时问现有成员怎么处理 + 顺手记策略；文章页 = 按策略默默填空。

## 改动清单

| 文件 | 改什么 |
|---|---|
| `packages/schema/src/entities.ts` | `seriesAutoFillFieldSchema` + `seriesSchema.autoFillFields` |
| `packages/schema/src/testing/factory.ts` | `makeSeries()` 补 `autoFillFields: []` |
| `packages/core/src/db/sql/schema.ts` | `SQL_SCHEMA_VERSION = 4`；series DDL 加列 |
| `packages/core/src/db/sql/migrate.ts` | v3 → v4：`ALTER TABLE series ADD COLUMN auto_fill_fields TEXT` |
| `packages/core/src/db/sql/store.ts` | series 读/整写/差异写三处带上该列 |
| `packages/core/src/editor/index.ts` | `SeriesDraft.autoFillFields`；`applySeriesMetaSync`；`saveArticle`/`saveSeries` 的继承填空 |
| `apps/desktop/src/pages/EditorPage.tsx` | `SeriesDraftPayload`、`SeriesForm` 复选框与弹窗接线、`SeriesPanel` 的 `onSubmit` |
| `apps/desktop/src/components/SeriesMetaSyncDialog.tsx` | 新建 |
| `packages/core/test/series-meta-sync.test.ts` | 新建 |
| `packages/core/test/migrate.test.ts` | 补 v3 → v4；改「不支持版本」那条 |
| `TohoPR_design.md` | 追加 `## Goal 27 追加记录：系列元数据向下同步`（放在 `## 追加记录：编辑器「最近使用」排序` 之后、`## 附：文档自检` 之前）；文末自检表里那行「Goal 1–26 的实现均已回填」随之改成 27 |

## 留给实现者

这些不影响"做成什么样"，实现时自行定：

- 弹窗用 `<div role="dialog">` + 遮罩还是原生 `<dialog>`；项目没有先例，选能正确锁焦点、Esc 可关的那个。
- 分组内的篇目列出多少条后折叠成「展开全部」。
- 触发字段判定（哪几个字段被添加/替换）是否需要也提成顶层导出。候选计算已定为 `computeMetaSyncCandidates` 顶层导出（见 §4），触发字段判定目前只在 `SeriesForm` 内用一次。
- 作者名、图片名、URL 的显示串怎么截断。
- 弹窗按钮文字的最终措辞（上面写的是我的建议）。

## 不做的事与理由

- **不给 `Article` 加 provenance 字段**（记录"这个作者是从系列抄来的"）。追踪来源要在编辑表单、导入、导出、合并、标签合并每条路径上维护，成本是当前方案的三到四倍，而它买到的只是"能不能自动取消"。库的规模是每个系列几十篇，预览清单撑得住让用户自己看。
- **不做反向同步**（改文章的字段回写系列）。系列的字段是"系列署名"，不是成员的交集，反推没有意义。
- **不在标签、插图上做**。它们是集合而非单一来源，"替换"的语义会对不上（合并还是覆盖？），而且弹窗会膨胀成网格。

## 风险

- **v3 → v4 迁移写错会让老库打不开。** 缓解：照抄现有 v2 → v3 的写法，`columnNames()` 先探测，单事务，补一条从 v3 升上来的测试。
- **负向移除策略**：用户想彻底关掉自动填，得回到系列表单取消勾选。已提供常驻复选框，但不能通过弹窗一次性清空 —— 可接受。
- **旧版本客户端**读到新库会丢弃 `autoFillFields`，再导出就丢了策略。与 `translatorIds` 先例同等，不额外处理。
- **两个写操作不是一个事务**：系列落库成功、文章同步失败时，库里会留下"系列新值 + 部分文章还是旧值"的状态。已明确报错，且重放幂等，但不做补偿回滚 —— 回滚系列会把用户明确要保存的东西也丢掉，代价更大。
