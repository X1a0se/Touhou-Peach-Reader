# Touhou Peach Reader

东方同人阅读客户端。阅读器与数据库分离：客户端只负责呈现、搜索、收藏、编辑、同步，所有内容来自可独立分发的 `.tpr` 数据库包。

## 功能

- **导入 / 导出**：任意页面拖入或选择 `.tpr`（桌面/下载目录都可以，先暂存进应用数据再解压）；导出全库、单篇、选中若干篇；导入即落盘，重启保留。
- **阅读**：文章详情（封面、正文 Markdown、插图与配文、作者别名、标签、原出处外链）、系列详情（按序目录、系列译者）。
- **文章库**：`/articles` 封面卡片网格，按标题/简介/标签过滤、按短篇/系列切换；标签芯片点击即按该标签搜索；系列条目显示「第 N 篇」。
- **标签**：角色与情节标签按类别上色，详情页、列表、精选、收藏、搜索结果统一展示；编辑器内可直接输入新名称新建标签（按名称/别名判重复用）。
- **搜索**：中文分词（CJK 二元组 + `Intl.Segmenter`）、标题/摘要/正文/作者别名/标签联合检索、`#已完结`/`#连载中`/`#短篇`/`#系列` 虚拟标签、按全部/短篇/系列/作者/角色/情节筛选、命中片段高亮；输入 `#` 弹出标签联想（↑↓ 选择、Enter 采用）。
- **精选**：精选短文 / 精选系列，完整渲染每条推荐语（含推荐人）；目标被删时显示「条目已失效」。
- **收藏**：文章与系列收藏，保存到 `user/{databaseId}.json`，目标被删后标记失效。
- **随机**：随机一篇；十连抽（同一系列最多一篇，池子不足时提示）。
- **编辑器**：文章 / 系列 / 作者 / 标签 / 图片 / 推荐语 / 鸣谢 全量 CRUD，每次保存先校验再落盘；顶部全实体搜索（标题/简介/作者/标签/图片/推荐语/鸣谢，不含正文）可 ↑↓ 选择、Enter 跳转并定位到具体条目；文章表单里可直接新建系列、作者、译者与标签，系列目录用编号列表排序（上下移动/移除，保存即写回 `articleIds`）。
- **草稿箱**：新建文章 / 系列 / 作者 / 标签 / 推荐语 / 鸣谢时自动存草稿（按库隔离、写在 `localStorage`，600 ms 防抖 + 切页补写），关闭编辑器或重启后可从左侧草稿列表继续；保存实体成功后草稿自动清除。
- **合并**：选另一个 `.tpr`，按 id + 更新时间归并，同一时刻内容不同才需要人工裁决，附疑似重复与悬空引用报告。
- **在线下载**：`/import` 支持 GitHub 仓库 / release / 资产直链，可配置镜像前缀。
- **设置**：默认数据库源、镜像前缀、主题（浅色 / 深色 / 跟随系统）、5 套配色（桃夭 / 竹青 / 月白 / 绯红 / 墨染）、主界面与文章页各一张壁纸（可调不透明度与模糊）；「关于」显示当前 exe 版本、程序路径与数据目录（区分安装版 / 免安装版）。
- **界面**：粘性顶栏 + pill 导航、半透明磨砂面板、统一的按钮/空态/统计块组件、阅读排版（`.reading`）。
- **桌面打包**：`tauri build` 产出 NSIS 安装包；`pnpm release:*` 负责版本一致性与覆盖安装（见下）。

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
corepack pnpm release      # 一条命令更新安装版与 dist/portable 免安装版（也可双击 发布更新.cmd）
```

> Windows 上若 `corepack enable` 因权限失败，直接用 `corepack pnpm <script>` 即可；`tauri.conf.json` 的 `before*Command` 也已写成这种形式。

## 版本与升级（安装版 / 免安装版）

Tauri **没有增量更新**：`tauri build` 只会生成新的免安装 exe 与 NSIS 安装包，**不会**替换已经装到 `D:\Touhou Peach Reader`（注册表 `InstallLocation`）的那份副本。所以更新一律走**一个入口**：

```bash
corepack pnpm release            # 一条命令：check → build → 覆盖安装版 → 刷新 dist/portable → 核对
node scripts/release.mjs --set 0.1.2   # 需要升版本号时，先统一改 5 处，再 pnpm release
```

也可以直接**双击仓库根目录的 `发布更新.cmd`**（内部就是上面这条命令，结束会停住窗口）。

`pnpm release` 会依次做：

1. `check`（typecheck + 全部单测 + 依赖边界 + Tauri 泄漏检查）；
2. `tauri build`，产出 NSIS 安装包与新的 exe；
3. 按注册表里的 `InstallLocation` **静默覆盖安装版**（应用正在运行会先报错让你关闭）；
4. 把 exe + 安装包 + `README.txt` 收进 **`dist/portable/`**（固定的免安装目录，直接双击 `Touhou Peach Reader.exe`）；
5. 打印核对表：5 处版本号、构建产物、免安装目录、安装版版本；全部一致才算成功。

细粒度命令仍然保留：`release:status`（只读核对）、`release:build`、`release:install`、`release:portable`。

设置页的「关于」会显示**当前跑的是安装版还是免安装版**、当前版本、程序路径、数据目录，以及安装版的版本；两者不一致时会提示去双击「发布更新.cmd」。

> 更新只影响**程序**；已导入的数据库、收藏、壁纸、设置都在 `%APPDATA%` 里，安装版与免安装版共用同一份，升级不会动它们。
> 安装版与免安装 exe 的哈希天生不同（NSIS 打包会改写 bundle type 标记），版本号才是判断依据。

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
scripts/     依赖边界检查、Tauri 泄漏检查、图标生成、发布一致性（release.mjs）
dist/        发布产物（git 忽略）：portable/ 免安装目录、安装包
发布更新.cmd  双击更新两版（内部 corepack pnpm release）
```

## 数据位置

- Windows：`%APPDATA%\com.touhou.peachreader\`
  - `workspace/{databaseId}/`：当前库（与 `.tpr` 同构的目录）
  - `imports/`、`exports/`：临时导入/导出
  - `user/{databaseId}.json`：收藏
  - `settings.json`：设置
