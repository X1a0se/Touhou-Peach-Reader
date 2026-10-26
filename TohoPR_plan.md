# Touhou Peach Reader — /plan

## 一、项目定位

`Touhou Peach Reader` 是一个**阅读器与数据库分离**的东方同人阅读客户端。

阅读器本体只负责「呈现、搜索、收藏、编辑、同步」；所有文章/系列/作者/图片/精选推荐语/鸣谢信息都来自一个**可独立分发的数据库包**（ZIP，可放 GitHub）。

未来要在手机端复用相同数据库与相同功能，因此**核心业务逻辑必须与 UI 层、平台层彻底解耦**。

---

## 二、技术选型（为移动端预留）

| 层 | 桌面端 | 未来移动端 | 说明 |
|---|---|---|---|
| 壳 | **Tauri 2** | Tauri 2 Mobile / RN（二选一） | Tauri 2 已支持 iOS/Android，若后续迁移成本高再换 RN，因此核心逻辑不依赖 Tauri API |
| 语言 | TypeScript | TypeScript | 统一 |
| UI | React 18 + Vite + Tailwind + shadcn/ui | 复用 `@app/ui` 包 | 组件库不绑定 DOM 特有 API 的放 core |
| 状态 | Zustand | 复用 | 状态管理纯 TS |
| 搜索 | FlexSearch（内存索引） | 复用 | 支持中文分词可后续替换 |
| 本地存储 | SQLite（自研 rusqlite 命令，图片/正文以 BLOB 存储；`.tpr` 仍是 JSON+文件交换格式） | 复用同一 schema | 插件走 JSON IPC 会整图进 JS 内存，单库 225 MB 图片改用自定义协议读取 |
| 打包 | `tauri build` | — | — |
| 数据库包 | ZIP（JSON + 图片资源） | 复用同一格式 | 见下 |

**目录结构（monorepo，pnpm workspace）**

```
touhou-peach-reader/
├─ packages/
│  ├─ core/            # 数据模型、搜索、抽卡、合并、导入导出逻辑（纯 TS，无平台 API）
│  ├─ ui/              # 跨平台可复用组件（纯 React，不直接调用 Tauri）
│  ├─ platform/        # 平台适配层接口（IFileSystem / INetwork / IZip / IImage）
│  └─ schema/          # 数据库包 JSON Schema + 版本迁移器
└─ apps/
   └─ desktop/         # Tauri 桌面壳 + 路由 + 页面组装
```

平台差异一律通过 `platform` 包的**接口**注入实现，桌面端注入 Tauri 实现，未来移动端注入对应实现即可，`core` 与 `ui` 完全不改。

---

## 三、数据模型（核心）

```ts
// —— 数据库包 manifest ——
interface Manifest {
  schemaVersion: number;        // 用于迁移
  databaseId: string;           // 数据库唯一标识（合并用）
  name: string;                 // 例如「东方桃图吧大书库」
  version: string;
  updatedAt: string;            // ISO
  sourceUrl?: string;           // 该库的 GitHub 仓库
  description?: string;
  counts: Record<string, number>;
}

// —— 作者（支持多别名）——
interface Author {
  id: string;
  canonicalName: string;
  aliases: string[];            // 同一作者的不同名称
  notes?: string;
  sourceUrl?: string;
}

// —— 标签（角色 / 情节 / 系列 / 通用）——
type TagCategory = 'character' | 'plot' | 'series' | 'general';
interface Tag {
  id: string;
  category: TagCategory;
  name: string;
  aliases?: string[];
}

// —— 图片（封面 / 插图 / 配文图）——
interface ImageAsset {
  id: string;
  file: string;                 // zip 内相对路径，如 images/cover/abc.webp
  caption?: string;             // 配文
  kind: 'cover' | 'illustration' | 'captioned' | 'other';
}

// —— 文章（短篇 或 系列中的一篇）——
interface Article {
  id: string;
  type: 'short' | 'series-entry';   // 系列内文章或独立短篇
  title: string;
  summary: string;                  // 简介
  content: string | { file: string };
  authorIds: string[];
  translatorIds: string[];
  characterTagIds: string[];
  plotTagIds: string[];
  seriesId?: string;                // 若属于某系列
  coverImageId?: string;
  illustrationImageIds?: string[];
  sourceUrl?: string;               // 原出处链接（必填项之一）
  createdAt: string;
  updatedAt: string;
}

// —— 系列 ——
interface Series {
  id: string;
  title: string;
  summary: string;
  status: 'ongoing' | 'completed';  // 未完结 / 已完结（特殊 tag 由该字段派生）
  articleIds: string[];             // 有序
  authorIds: string[];
  characterTagIds: string[];
  plotTagIds: string[];
  coverImageId?: string;
  sourceUrl?: string;
  createdAt: string;
  updatedAt: string;
}

// —— 精选推荐（同一篇可有多条推荐语）——
interface FeaturedEntry {
  targetType: 'article' | 'series';
  targetId: string;
  recommendations: { author?: string; text: string }[];
}

// —— 特别鸣谢 ——
interface CreditsEntry {
  name: string;
  role?: string;
  link?: string;
  note?: string;
}
```

**「系列文 / 短篇文」特殊 tag 的实现方式**：不落库为物理 tag，而是由 `Article.type` / `Series.status` 派生出虚拟 tag（`#系列文`、`#短篇文`、`#连载中`、`#已完结`），在搜索、筛选、导出时统一处理。

---

## 四、数据库包格式（`.tpr` = ZIP）

```
database.zip
├─ manifest.json
├─ authors.json
├─ tags.json
├─ articles/
│  └─ {articleId}.json        # 每篇一文件，便于 diff / 合并
├─ series/
│  └─ {seriesId}.json
├─ featured.json
├─ credits.json
└─ images/
   ├─ cover/
   ├─ illustration/
   └─ captioned/
```

- **单文件 + 图片目录** 的分层结构，兼顾「可人工编辑」与「GitHub 直接托管可 diff」。
- 导入 = 解压到本地用户数据目录 + 建索引；
- 导出 = 从当前状态重新生成 JSON + 打包图片；
- 合并 = 按 `id` 归并，冲突时按 `updatedAt` 新者胜出并留冲突日志供用户确认。

---

## 五、核心模块（`packages/core`）

1. **`db-loader`**：从 ZIP / 目录加载数据库 → 生成 `DBSnapshot`（含所有实体、索引）。
2. **`search`**：标题 / 内容 / 简介 / 标签（含角色、情节、作者别名）/ 虚拟 tag 的联合搜索；返回命中项+高亮片段。
3. **`random`**：`randomOne()` 单抽；`tenPull()` 十连抽（同一 `seriesId` 最多出现一篇；无 `seriesId` 的短篇各自独立）。
4. **`merge`**：合并多个 `DBSnapshot`，带冲突策略与预览。
5. **`export`**：从编辑态生成可识别 ZIP，支持「单篇/单系列导出」与「多篇/全库导出」。
6. **`validate`**：基于 JSON Schema 校验，附 `schemaVersion` 迁移器。
7. **`featured`**：精选查询 + 推荐语管理。
8. **`credits`**：鸣谢数据读取。
9. **`edit`**：对实体做增删改的纯函数（编辑器保存时调用）。

`packages/platform` 定义接口：

```ts
interface IFileSystem { readFile / writeFile / listDir / exists / copy / delete }
interface IZip { pack / unpack }
interface INetwork { fetchGithubRelease / downloadZip }
interface IOpener { openExternal(url) }   // 用于「原出处」跳转
```

---

## 六、页面与路由（`apps/desktop`）

| 路由 | 页面 | 说明 |
|---|---|---|
| `/` | 首页 | 入口 + 随机 + 十连抽 |
| `/search` | 搜索 | 标题/内容/标签联合搜索 |
| `/article/:id` | 文章详情 | 简介、正文、图、标签、原出处；若属系列 → 顶部「跳转到系列介绍」 |
| `/series/:id` | 系列详情 | 系列简介、状态、完整文章列表（可直达任一篇） |
| `/featured/short` | 精选短文 | 每条带多条推荐语 |
| `/featured/series` | 精选系列 | 同上 |
| `/favorites` | 收藏夹 | 文章 + 系列均支持收藏 |
| `/editor` | 编辑器 | 新建/编辑短篇、系列、作者、标签、图片、推荐语、鸣谢 |
| `/editor/export` | 导出 | 单篇/多篇/全库导出 |
| `/import` | 导入 | GitHub 下载 / ZIP 拖入 |
| `/merge` | 合并 | 多库合并 + 冲突确认 |
| `/credits` | 特别鸣谢 | |
| `/settings` | 设置 | 数据库源、主题、语言 |

---

## 七、关键流程

- **导入**：拖入 ZIP 或填入 GitHub release URL → 校验 manifest → 迁移 schema → 解压 → 建 FlexSearch 索引 → 写入本地 SQLite。
- **编辑 → 导出 → 发布**：编辑器纯函数修改内存快照 → 写回 SQLite → 导出 ZIP → 用户手动上传 GitHub（或未来集成 API）。
- **合并**：两个快照 → 按 id 归并 → 冲突列表 → 用户确认 → 产出新快照 → 用户导出。
- **十连抽**：把所有文章按 `seriesId`（无则自身 id）分组 → 随机洗牌 → 每组最多取一篇 → 取满 10 篇或耗尽。
- **移动端预留**：`core` / `ui` / `schema` 三个包被所有平台复用；`platform` 接口是唯一需要重写的部分；路由与状态管理不依赖 Tauri。

---

## 八、开发阶段（对应 /goal）

1. Monorepo + 骨架 + Tauri 桌面壳跑通
2. 数据模型 + Schema + 校验 + 迁移器
3. 数据库包导入/导出（ZIP）
4. 搜索索引 + 搜索页
5. 文章/系列详情页 + 系列跳转
6. 精选短文/系列页（多推荐语）
7. 收藏夹
8. 随机 + 十连抽
9. 编辑器（实体 CRUD + 图片上传 + 推荐语）
10. 导出单篇/多篇 + 合并数据库
11. GitHub 下载 + 特别鸣谢 + 原出处外链
12. 打包发布 + 移动端适配说明