# Touhou Peach Reader

东方同人阅读客户端。阅读器与数据库分离：客户端只负责呈现、搜索、收藏、编辑、同步，所有内容来自可独立分发的 `.tpr` 数据库包。

## 功能

- **导入 / 导出**：拖入或选择 `.tpr`；导出全库、单篇、选中若干篇；导入即落盘，重启保留。
- **阅读**：文章详情（封面、正文 Markdown、插图与配文、作者别名、标签、原出处外链）、系列详情（按序目录）。
- **搜索**：中文分词（CJK 二元组 + `Intl.Segmenter`）、标题/摘要/正文/作者别名/标签联合检索、`#已完结`/`#连载中`/`#短篇`/`#系列` 虚拟标签、按全部/短篇/系列/作者/角色/情节筛选、命中片段高亮。
- **精选**：精选短文 / 精选系列，完整渲染每条推荐语（含推荐人）；目标被删时显示「条目已失效」。
- **收藏**：文章与系列收藏，保存到 `user/{databaseId}.json`，目标被删后标记失效。
- **随机**：随机一篇；十连抽（同一系列最多一篇，池子不足时提示）。
- **编辑器**：文章 / 系列 / 作者 / 标签 / 图片 / 推荐语 / 鸣谢 全量 CRUD，每次保存先校验再落盘。
- **合并**：选另一个 `.tpr`，按 id + 更新时间归并，同一时刻内容不同才需要人工裁决，附疑似重复与悬空引用报告。
- **在线下载**：`/import` 支持 GitHub 仓库 / release / 资产直链，可配置镜像前缀。
- **设置**：默认数据库源、镜像前缀、主题（浅色 / 深色 / 跟随系统）。
- **桌面打包**：`tauri build` 产出 NSIS 安装包。

## 文档

| 文档 | 内容 |
|---|---|
| [TohoPR_plan.md](TohoPR_plan.md) | 架构意图：分层、数据模型、包格式、页面路由 |
| [TohoPR_design.md](TohoPR_design.md) | 技术设计：版本锁定、接口签名、算法、Tauri 配置、验收矩阵 |
| [TohoPR_goal.md](TohoPR_goal.md) | 12 个验收单元 |
| [packages/platform/docs/mobile-adaptation.md](packages/platform/docs/mobile-adaptation.md) | 移动端适配说明 |

## 环境

- Node.js ≥ 22.12（本项目在 24.21 上开发）
- pnpm 12.14（通过 corepack，无需全局安装）
- Rust stable（`stable-x86_64-pc-windows-msvc`）+ WebView2（仅桌面壳需要）

```bash
corepack pnpm install
```

## 命令

```bash
corepack pnpm dev          # Tauri 桌面窗口
corepack pnpm dev:web      # 仅前端（浏览器预览，使用内存平台实现）
corepack pnpm build        # 打包桌面安装包（NSIS）
corepack pnpm typecheck    # 全包类型检查
corepack pnpm test         # 全包单测
corepack pnpm check        # typecheck + test + 依赖边界 + Tauri 泄漏检查
```

> Windows 上若 `corepack enable` 因权限失败，直接用 `corepack pnpm <script>` 即可；`tauri.conf.json` 的 `before*Command` 也已写成这种形式。

## 结构

```
packages/
  schema/    数据模型、校验、迁移（纯 TS，零 IO）
  platform/  平台接口 + 内存实现（零 Tauri 依赖）
  core/      业务逻辑（导入导出、搜索、抽卡、合并、编辑、设置、GitHub）
  ui/        跨平台 React 组件 + Tailwind v4 主题
apps/
  desktop/   Tauri 2 壳 + 路由 + 页面组装
             src-tauri/src/commands/  fs / zip / save_export（Rust）
scripts/     依赖边界检查、Tauri 泄漏检查、图标生成
```

## 数据位置

- Windows：`%APPDATA%\com.touhou.peachreader\`
  - `workspace/{databaseId}/`：当前库（与 `.tpr` 同构的目录）
  - `imports/`、`exports/`：临时导入/导出
  - `user/{databaseId}.json`：收藏
  - `settings.json`：设置
