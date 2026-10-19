# Touhou Peach Reader — /goal

每个 goal 都是**可独立 vibe coding 一轮完成**的验收单元。建议按序执行。

---

## Goal 1 — 项目骨架与跨平台分层

**目标**：初始化 pnpm monorepo，建立 `packages/core`、`packages/ui`、`packages/platform`、`packages/schema`、`apps/desktop`。桌面端用 Tauri 2 + React + Vite + Tailwind + shadcn/ui 跑通一个显示「Touhou Peach Reader」的空窗口。

**验收**：
- `pnpm dev` 启动桌面应用，窗口标题为 `Touhou Peach Reader`。
- `packages/core` 可以被 `apps/desktop` 引用并成功调用一个 `getVersion()` 函数显示版本号。
- `packages/platform` 已定义 `IFileSystem`、`IZip`、`INetwork`、`IOpener` 接口；桌面端有实现文件（哪怕是桩）。
- 无任何业务逻辑写入 `apps/desktop`，全部在 `packages/core`。

---

## Goal 2 — 数据模型与 Schema

**目标**：在 `packages/schema` 中实现「/plan 三、数据模型」里的全部 TS 类型 + JSON Schema + `validateDatabase(snapshot)` + `migrate(snapshot, fromVersion)` 迁移器（占位 v1 即可）。

**验收**：
- 有覆盖 `Manifest / Author / Tag / ImageAsset / Article / Series / FeaturedEntry / CreditsEntry` 的 TS 类型与 JSON Schema。
- `migrate()` 至少实现 v1 恒等迁移，为未来版本预留接口。
- 用一个示例 fixture 跑通 `validateDatabase` 并返回通过。

---

## Goal 3 — 数据库包导入/导出（ZIP）

**目标**：实现「/plan 四、数据库包格式」的打包与解包。导入支持 ZIP 拖入或路径选择；导出生成 `.tpr`（=zip）文件。

**验收**：
- `packages/core` 提供 `importDatabase(zipBytes) → DBSnapshot` 与 `exportDatabase(snapshot) → zipBytes`。
- `packages/ui` 提供 `<DropZone onFile={...} />` 组件，把 ZIP 拖到窗口即触发导入。
- 导入的数据库写入本地存储（SQLite 或文件），下次启动自动加载。
- 导出后重新导入，所有实体字段逐项相等（round-trip 测试通过）。

---

## Goal 4 — 搜索与搜索页

**目标**：为 `DBSnapshot` 构建 FlexSearch 索引，覆盖标题、简介、内容、作者名及别名、角色 tag、情节 tag、虚拟 tag（`#系列文 / #短篇文 / #连载中 / #已完结`）。搜索页提供关键词输入 + 类别筛选（全部 / 短篇 / 系列 / 作者 / 角色 / 情节）。

**验收**：
- `search(snapshot, query, filters)` 返回命中的文章与系列，并包含高亮片段。
- 搜索页输入关键词后实时显示结果（防抖 200ms），点结果跳转对应详情页。
- 按作者别名搜索「同一作者的另一名字」能命中其所有作品。
- 输入 `#已完结` 能筛选出所有已完结系列。

---

## Goal 5 — 文章详情页与系列跳转

**目标**：实现 `/article/:id` 与 `/series/:id`。

**验收**：
- 文章详情页显示：标题、简介、正文、封面、插图（含配文）、作者（主名 + 可展开别名）、角色/情节 tag、原出处外链按钮。
- 若文章属于某系列，页面顶部有「查看所属系列」按钮跳转 `/series/:id`。
- 系列详情页显示：系列简介、状态 tag（连载中/已完结）、按序的文章列表，点任意一篇文章即跳转其详情页。
- 所有「原出处」链接通过 `IOpener.openExternal()` 打开外部浏览器。

---

## Goal 6 — 精选短文与精选系列页面

**目标**：实现 `/featured/short` 与 `/featured/series`。

**验收**：
- 精选条目来自 `FeaturedEntry`，每条可**承载多条推荐语**并全部渲染（含推荐人）。
- 精选短文页每条展示：封面、标题、简介 + 全部推荐语，点击进入文章详情。
- 精选系列页每条展示：封面、标题、简介 + 全部推荐语，点击进入系列详情。
- 若目标被删除，前端优雅降级为「条目已失效」提示而非崩溃。

---

## Goal 7 — 收藏夹

**目标**：实现 `/favorites`，文章与系列均可收藏/取消收藏，收藏数据持久化。

**验收**：
- 详情页有收藏按钮，状态在重启应用后保留。
- 收藏夹页分「文章」「系列」两个 tab，支持取消收藏。
- 收藏实体被删除时自动清理失效收藏（或标记为失效）。

---

## Goal 8 — 随机浏览与十连抽

**目标**：实现 `/` 首页上的「随机一篇」与「十连抽」。

**验收**：
- 随机按钮从**所有文章**（含系列内文章与独立短篇）随机抽一篇并跳转详情页。
- 十连抽从池中抽 10 篇，**同一 `seriesId` 最多出现一篇**；无 `seriesId` 的短篇各自独立成组。
- 十连抽结果以卡片网格展示，每张卡片可点击跳详情；提供「重新抽取」。
- 池子不足 10 组时按实际数量返回并给出提示。

---

## Goal 9 — 编辑器

**目标**：实现 `/editor`，对短篇/系列/作者/标签/图片/推荐语/鸣谢做完整 CRUD。

**验收**：
- 可新建/编辑短篇（标题、简介、正文、作者、译者、角色 tag、情节 tag、封面、插图、原出处 URL）。
- 可新建/编辑系列（含 `status` 字段即未完结/已完结、有序文章列表、简介、原出处 URL）。
- 作者编辑支持新增别名；已存在别名不会被误当成新作者。
- 图片上传后作为 `ImageAsset` 存入，可设置 `caption` 与 `kind`。
- 推荐语编辑：可对任意精选文章/系列添加多条推荐语（推荐人 + 文本）。
- 鸣谢编辑：可新增/排序/删除鸣谢条目。
- 所有编辑立即写入本地存储，重启后保留。

---

## Goal 10 — 导出与数据库合并

**目标**：编辑器内提供「导出单篇 / 导出选中 / 导出全库」；`/merge` 支持多库合并。

**验收**：
- 导出选中项生成可被本程序识别的 ZIP（含图片）。
- 合并两个 ZIP 时，按 `id` 归并；冲突（同 id 不同 `updatedAt`）按新者胜出，并列出冲突清单让用户确认/取消。
- 合并后导出的 ZIP 可以被干净导入且不含重复实体。

---

## Goal 11 — GitHub 下载、鸣谢页、设置

**目标**：导入页支持「从 GitHub 下载数据库」；`/credits` 展示鸣谢；`/settings` 管理数据库源。

**验收**：
- 在 `/import` 输入 GitHub release URL（或仓库 URL），通过 `INetwork` 下载 ZIP 并走正常导入流程。
- `/settings` 可保存默认数据库源地址、检查更新（比对 manifest 版本）、触发重新下载。
- `/credits` 从 `credits.json` 渲染特别鸣谢，支持链接跳转。

---

## Goal 12 — 打包发布与移动端预留验证

**目标**：完成 `tauri build` 桌面安装包；出具移动端适配说明（架构层面）。

**验收**：
- 生成 macOS/Windows 可安装产物，双击后能正常导入示例数据库并浏览。
- 在 `packages/core`、`packages/ui`、`packages/schema` 中**搜索不到任何 Tauri 专有 API 引用**（可用 grep 脚本校验）。
- `packages/platform` 提供一份 `docs/mobile-adaptation.md`，说明未来接入 Tauri Mobile 或 React Native 时需要实现哪些接口、路由如何迁移。

---

## 执行建议

- 每个 Goal 开始前，让 AI 先 `tree` 一次当前结构，确认它读到的是最新代码；
- 每个 Goal 完成后**先跑 Goal 自带的验收清单**再进入下一个；
- Goal 2、3、10 涉及 schema 与合并，最容易出现「越写越乱」，务必在合并逻辑稳定前不要动编辑器的持久化格式；
- 若中途要插入「多语言」「主题」「快捷键」等需求，作为独立的 Goal 13+ 追加，不塞进已有 Goal。