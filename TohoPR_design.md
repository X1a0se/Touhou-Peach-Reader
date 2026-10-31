# Touhou Peach Reader — 技术设计文档

> 版本：design-v1 ｜ 日期：2026-10-19 ｜ 对应 `/goal` 1–12 ｜ 对应代码基线：空仓库（仅 `TohoPR_plan.md`、`TohoPR_goal.md`）
>
> **本文档的用途**：位于 `TohoPR_plan.md`（架构意图）与 `TohoPR_goal.md`（验收单元）之间，回答"**具体怎么实现**"。
> 读完本文档应当可以直接开始写 Goal 1 的代码，不需要再做任何技术选型。
>
> **阅读顺序建议**：先看 §0.4 决策索引，再按需跳读；§17 是与 `/plan` 的差异清单（有 4 处方向性改动）。

---

## 0. 文档定位与范围

### 0.1 三层文档的关系

| 文档 | 回答的问题 | 变更频率 |
|---|---|---|
| `TohoPR_plan.md` | 做什么、分几层、为什么这样分 | 低（架构变化时） |
| `TohoPR_design.md`（本文） | 用什么版本、什么接口、什么算法、什么格式 | 中（实现期迭代） |
| `TohoPR_goal.md` | 每轮做完的验收标准 | 低 |

### 0.2 五条硬原则

1. **业务逻辑只在 `@tpr/core`**：`apps/desktop` 只做页面组装与 Tauri 实现注入，任何跨页面复用的逻辑都必须下沉到 core。
2. **平台差异只经 6 个接口**：`@tpr/core`、`@tpr/ui`、`@tpr/schema` 中不允许出现 `@tauri-apps/*`、`node:*`、`process.*`、`window.__TAURI__`。由 `scripts/check-boundaries.mjs` 强制（Goal 1 建立，Goal 12 复用为验收脚本）。
3. **单一格式**：本地工作区目录与分发包 `.tpr` 同构（同一套 JSON + 图片布局）。导入 = 解包，导出 = 打包，中间没有"数据库表 ↔ 包格式"的翻译层。
4. **不静默合并、不静默丢数据**：任何冲突、悬空引用、疑似重复都产出结构化报告交用户裁决；导入失败不破坏已有工作区（原子换名）。
5. **一切外部输入可注入**：随机源 `rng`、时间源 `now`、文件系统、网络全部可替换，保证单测可重现。

### 0.3 未决项（显式留待后续 Goal，共 3 项）

| 编号 | 内容 | 为什么现在不定 | 何时定 |
|---|---|---|---|
| U1 | macOS / Linux 的打包、签名、公证 | 本机只有 Windows，无法验证 | Goal 12 |
| U2 | 多语言（i18n）方案 | `/goal` 执行建议已明确列为 Goal 13+，不塞进现有 Goal | Goal 13+ |
| U3 | GitHub 上传/发布自动化 | Goal 11 只要求"下载"；上传按 `/plan` 是用户手动 | Goal 12 之后 |

> 本文档其余部分**没有未决项**；出现"待定"字样即为缺陷。

### 0.4 决策索引（D1–D22）

| 编号 | 决策 | 章节 |
|---|---|---|
| D1 | 用 corepack 提供 pnpm 12.14.0，`packageManager` 锁定 | §2 |
| D2 | 全量锁定版本矩阵（React 19 / Vite 8 / TS 7 / Tailwind 4 / Tauri 2.12） | §2 |
| D3 | Rust 工具链走 rustup minimal + `stable-*-msvc` | §1.2 §2.3 |
| D4 | monorepo 布局：`packages/{schema,core,platform,ui}` + `apps/desktop` | §3 |
| D5 | 依赖方向硬约束 `ui→schema`、`core→schema+platform`、DESKTOP→ALL | §3.2 |
| D6 | 内部包**源码直连**，不产出 dist、不用 project references | §4 |
| D7 | `platform` 只放接口；`@tpr/platform/memory` 供测试与浏览器预览 | §5.1 |
| D8 | 平台接口共 6 个 + `Platform` 聚合，**构造注入**而非全局单例 | §5.2 |
| D9 | ZIP 桌面端用 Rust `zip` crate 自定义命令（流式）；测试用 fflate | §5.4 |
| D10 | 安全契约：zip-slip 拒绝、外链白名单、CSP、路径一律 `join` | §5.5 |
| D11 | 标签/作者用**内容确定性 ID**（可跨库合并），文章/系列/图片用 nanoid | §6.2 |
| D12 | 正文规范形态恒为 `articles/{id}.md` + `content:{file}` | §6.3 |
| D13 | 虚拟标签由 `type`/`status` 派生，不落库、不导出 | §6.4 |
| D14 | 本地持久化用**单文件 SQLite**（实体 + Markdown + 图片 BLOB），`.tpr` 保持 JSON+文件交换格式 | §9 |
| D15 | 合并按 id + `updatedAt`；同时间戳异内容 → 冲突报告 | §10 |
| D16 | 搜索用 `Intl.Segmenter` + CJK 二元组；高亮片段自建；FlexSearch 隔离在适配层 | §11 |
| D17 | shadcn/ui 的家在 `packages/ui`，Tailwind v4 CSS-first | §13.1 |
| D18 | 路由用 `createHashRouter` | §13.3 |
| D19 | 本地图片走 SQLite BLOB 自定义协议，其他图片经 `Platform.assets.toUrl()`；UI 不碰 Tauri | §13.4 §14.4 |
| D20 | Tauri 配置、capabilities 最小权限、CSP、Rust 命令签名 | §14 |
| D21 | vitest 5 + fixture 工厂 + 可注入 `rng`/`now` | §15.1 |
| D22 | Goal 验收矩阵：能自动化的自动化，剩下的人工 | §15.2 |

---

## 1. 环境基线与已核验事实

### 1.1 本机实测（2026-10-19，逐条命令验证过）

| 项 | 实测结果 | 判定 |
|---|---|---|
| Node.js | `v24.21.0` | ✅ 满足 Vite 8 要求（`^20.19` 或 `>=22.12`） |
| npm | `11.19.0` | ✅ |
| corepack | `0.36.0`，`corepack pnpm -v` → **12.14.0** | ✅ 免全局安装 pnpm |
| pnpm（PATH 中） | 不存在 | ⚠️ 必须用 corepack |
| Rust / cargo / rustup | **均不存在**（无 `~/.cargo`、`~/.rustup`） | ❌ **唯一缺口**，Tauri 编译前必须补 |
| Visual Studio | VS 2026 Community **18.10.12217.157** @ `D:\Program Files\Microsoft Visual Studio\18\Community` | ✅ |
| MSVC 工具集 | **14.51.36231** | ✅ Rust `-msvc` 目标可用 |
| Windows SDK | **10.0.26100.0** @ `D:\Windows Kits\10`（`um\x64` 下 481 个 lib，含 `kernel32.lib`） | ✅ 链接器依赖齐备 |
| WebView2 Runtime | 155.0.4283.62 | ✅ |
| 磁盘 | C: 105 GB / D: 253 GB 空闲 | ✅ |
| 仓库 | 无 `.git`，仅两份 .md | 见 §3.1 |

### 1.2 唯一的缺口：Rust

结论：**Tauri 的 C++ 侧前置条件全部就绪，只差 Rust 本体**。补法（Goal 1 的第 0 步，一次性）：

```bash
curl -fL -o rustup-init.exe https://static.rust-lang.org/rustup/dist/x86_64-pc-windows-msvc/rustup-init.exe
./rustup-init.exe -y --profile minimal --default-toolchain stable-x86_64-pc-windows-msvc
rustc -V && cargo -V
```

- 用 `minimal` profile（不装 docs/clippy 之外的组件），下载约 300–500 MB。
- 装完立刻在仓库写 `rust-toolchain.toml` 钉住实测版本号（`channel = "<实测版本>"`），避免以后 `stable` 漂移导致构建不可重现。
- 首次 `cargo build` 会编译 Tauri 依赖树（约 500 个 crate），**5–15 分钟**，属正常现象；`CARGO_TARGET_DIR` 保持默认（落在 `apps/desktop/src-tauri/target`，D 盘空间充足）。
- 失败兜底：`winget install --id Rustlang.Rustup`；两者都失败则 Goal 1 拆成两半（先 Web 层，Tauri 实跑延后），本设计其余部分不受影响。

> 状态记录：截至本文档定稿，Rust 尚未安装（安装动作未执行）。Goal 1 开工第一件事就是补这一步。

### 1.3 网络边界（决定 Goal 11 的实现方式）

| 域 | 实测 | 影响 |
|---|---|---|
| `registry.npmjs.org` | ✅ 200 / 877ms | 依赖安装正常 |
| `index.crates.io`、`static.rust-lang.org` | ✅ 200 | cargo 可用 |
| `github.com`、`api.github.com` | ✅ 200 | GitHub 元数据可用 |
| `raw.githubusercontent.com` | ❌ 连接被重置 | **禁止**用 raw 链接下载数据；一律走 `api.github.com` 拿 release asset 的 `browser_download_url` |
| `ui.shadcn.com` | ✅ 200 | shadcn CLI 可用 |

结论写入 §14/§16：网络实现只走直连，不内置任何第三方代理或镜像前缀（没有可用的镜像站）。

### 1.4 平台假设（若不成立需回到文档）

- 先跑通 **Windows 10/11 + WebView2**；macOS/Linux 只保证架构上不阻塞。
- 单库规模上限：**≤ 2 万篇文章、≤ 2 GB 图片**（D14 取舍的前提）。
- 不引入任何后端服务；同步/发布 = 导出 ZIP + 用户手动上传。

---

## 2. 版本矩阵与锁定策略

### 2.1 前端与运行时（2026-10-19 实查 npm 最新版）

| 包 | 版本 | 备注 |
|---|---|---|
| `node` | 24.21.0 | `engines.node: ">=22.12"` |
| `pnpm` | 12.14.0 | `packageManager` 字段锁定；`corepack enable pnpm` |
| `react` / `react-dom` | 19.3.1 | **`/plan` 写的是 React 18，此处升到 19**（见 §17） |
| `@types/react` / `@types/react-dom` | 19.3.0 / 19.3.0 | |
| `typescript` | 7.0.2 | 原生编译器；**降级预案 5.9.3** |
| `vite` | 8.3.4 | Rolldown + Oxc 内核 |
| `@vitejs/plugin-react` | 6.1.2 | |
| `tailwindcss` / `@tailwindcss/vite` | 4.3.3 / 4.3.3 | v4 CSS-first，无 `tailwind.config.js` |
| `shadcn`（CLI） | 4.22.1 | 用 `pnpm dlx shadcn@latest` |
| `zustand` | 5.0.15 | |
| `react-router` | 8.4.0 | ESM-only；API 与 v7 一致（数据路由） |
| `zod` | 4.6.7 | 类型 + JSON Schema 单一来源（`z.toJSONSchema()`） |
| `flexsearch` | 0.8.212 | 仅做召回，高亮自建 |
| `nanoid` | 6.0.2 | ID 生成 |
| `fflate` | 0.8.3 | 纯 JS zip，仅用于测试与浏览器预览 |
| `vitest` | 5.0.5 | |
| `@types/node` | 24.19.2 | 对齐 Node 24 运行时 |
| `@biomejs/biome` | 2.5.15 | 格式化 + lint（单工具） |

### 2.2 Tauri 与 Rust 侧（crates.io / npm 实查）

| 包 | 版本 |
|---|---|
| `tauri`（crate） | 2.12.4 |
| `@tauri-apps/cli` | 2.12.3 |
| `@tauri-apps/api` | 2.12.4 |
| `@tauri-apps/plugin-opener` | 2.7.2 |
| `@tauri-apps/plugin-dialog` | 2.8.3 |
| `@tauri-apps/plugin-fs` | 2.7.1 | 已评估，**不采用**（文件 IO 走自研命令，见 §14.3） |
| `zip`（Rust crate） | 9.0.5 |
| `walkdir`（Rust crate） | 2.x |
| `rustup` 默认工具链 | `stable-x86_64-pc-windows-msvc` |

### 2.3 锁定策略

1. **直接依赖一律精确锁定**（`"react": "19.3.1"`，不加 `^`/`~`），`pnpm-lock.yaml` 必须提交。理由：本项目是单机离线优先的桌面应用，"意外小版本升级导致打包后白屏"的代价远高于"手动升级一次"的成本。
2. **每完成一个 Goal 才允许升级一次**，升级必须附带 `pnpm -r typecheck && pnpm -r test && pnpm build:web` 全绿记录。
3. `typescript@7.0.2` 是原生编译器（Corsa）。我们的 tsconfig 只用现代选项（`moduleResolution: "bundler"`、`jsx: "react-jsx"`、`verbatimModuleSyntax`），不用 project references，因此 TS7 的兼容面很窄。**降级预案**：若 `tsc -p --noEmit` 报"未知/不支持的选项"，把 `typescript` 换成 `5.9.3`（已确认存在），其余配置不动——这是唯一允许的版本回退。
4. `vite@8` 使用 Rolldown/Oxc：不写 `build.rollupOptions.output.manualChunks`（对象形式已移除），需要分包时用 `build.rolldownOptions.codeSplitting`；不写 `esbuild.*` 选项。
5. **TS 7 已移除 `baseUrl`**（实测报 `TS5102: Option 'baseUrl' has been removed`）。工作区解析不要靠 `paths` 指回源码：包与包之间走 pnpm 的 `workspace:` 链接 + 各包 `exports`，类型检查时由 `moduleResolution: "bundler"` 顺着 `node_modules` 找到 `.ts` 源文件。`paths` 只留给应用内的 `@/*`，且必须不写 `baseUrl`（TS 7 下 `paths` 相对 tsconfig 解析）。
6. **`corepack enable` 可能没有写权限**（实测 `D:\nodejs` 不可写，`EPERM`）。因此根脚本与 `tauri.conf.json` 的 `beforeDevCommand`/`beforeBuildCommand` 一律写成 `corepack pnpm ...`，不依赖全局 `pnpm` shim。

---

## 3. 仓库布局与包边界

### 3.1 目录结构（最终形态，Goal 12 时应完全一致）

```
D:\Work of DSH\Touhou Peach Reader\        ← 仓库根（就地初始化，不再套一层）
├─ package.json                私有根包，只放脚本与 devDeps
├─ pnpm-workspace.yaml
├─ pnpm-lock.yaml              必须提交
├─ tsconfig.base.json
├─ biome.json
├─ .editorconfig / .gitignore / .npmrc
├─ rust-toolchain.toml         （Goal 1 安装 Rust 后生成）
├─ README.md
├─ TohoPR_plan.md              保留在原位，不改
├─ TohoPR_goal.md              保留在原位，不改
├─ TohoPR_design.md            本文档
├─ docs/                       仅放项目级文档（Goal 12 的移动端说明例外，见 platform 包）
├─ scripts/
│  ├─ check-boundaries.mjs     依赖方向校验（Goal 1）
│  └─ check-no-tauri.mjs       /goal 12 的 grep 验收脚本
├─ packages/
│  ├─ schema/                  @tpr/schema
│  │  ├─ src/{types,entities,manifest,validate,migrate,json-schema,index}.ts
│  │  ├─ src/testing/          fixture 工厂（供 core 测试复用）
│  │  └─ package.json / tsconfig.json
│  ├─ platform/                @tpr/platform
│  │  ├─ src/{types,errors,paths,security,index}.ts
│  │  ├─ src/memory/           @tpr/platform/memory（InMemoryFS + fflate zip + mock network）
│  │  └─ docs/mobile-adaptation.md   Goal 12 产出（/goal 明确要求放在 platform 包内）
│  ├─ core/                    @tpr/core
│  │  ├─ src/{create,workspace,db-loader,validate,merge,export,search,random,featured,credits,edit}/
│  │  └─ test/                 vitest 用例 + fixtures
│  └─ ui/                      @tpr/ui
│     ├─ components.json       shadcn 配置（就放在这里）
│     └─ src/{components/ui,components,lib,styles.css,index.ts}
└─ apps/
   └─ desktop/                 @tpr/desktop
      ├─ index.html
      ├─ vite.config.ts
      ├─ components.json        （若 shadcn 需要 app 级别名，可再放一份）
      ├─ src/
      │  ├─ main.tsx / App.tsx / router.tsx
      │  ├─ styles.css
      │  ├─ platform/tauri.ts   ← 唯一允许 import @tauri-apps/* 的文件
      │  ├─ pages/              与 /plan §六 路由表一一对应
      │  └─ stores/             zustand
      └─ src-tauri/
         ├─ Cargo.toml / tauri.conf.json / build.rs
         ├─ capabilities/default.json
         └─ src/{main.rs,lib.rs,commands/zip.rs}
```

### 3.2 依赖方向（硬约束）

```
desktop ─┬─▶ ui    ──▶ schema
         └─▶ core  ──▶ schema
                 └──▶ platform（只有接口，零依赖）

（箭头 = 依赖方向；ui 不依赖 core；desktop 可以依赖全部）
```

| 包 | 允许依赖 | 禁止 |
|---|---|---|
| `@tpr/schema` | `zod` | 其余一切 |
| `@tpr/platform` | 无（`src/memory` 允许 `fflate`） | `core`、`ui`、React、Tauri |
| `@tpr/core` | `@tpr/schema`、`@tpr/platform`、`flexsearch`、`nanoid` | React、DOM、Node API、Tauri |
| `@tpr/ui` | `@tpr/schema`、React、Tailwind 类名 | `core`（见下）、Tauri、Node |
| `@tpr/desktop` | 全部 | — |

> `ui` 不依赖 `core` 是有意为之：`ui` 只吃**数据结构**（`@tpr/schema` 的实体类型）与回调，不吃业务逻辑；这样 `ui` 可以被任何平台直接复用，也便于 Storybook 式单组件预览。

`scripts/check-boundaries.mjs` 的实现要求（Goal 1 落地）：

```js
// 伪代码：扫描各包 src/**/*.ts(x) 的 import 语句
const RULES = {
  'packages/schema': [/^@tauri-apps\//, /^node:/, /^react/],
  'packages/platform': [/^@tauri-apps\//, /^react/, /@tpr\/core/],
  'packages/core': [/^@tauri-apps\//, /^node:/, /^react/, /^react-dom/],
  'packages/ui': [/^@tauri-apps\//, /^node:/, /@tpr\/core/],
};
```
退出码非 0 即失败；`pnpm check:boundaries` 接进 `pnpm check`。

### 3.3 包名与脚本约定

| 包 | name | 关键脚本 |
|---|---|---|
| `packages/schema` | `@tpr/schema` | `typecheck`、`test` |
| `packages/platform` | `@tpr/platform` | `typecheck` |
| `packages/core` | `@tpr/core` | `typecheck`、`test` |
| `packages/ui` | `@tpr/ui` | `typecheck` |
| `apps/desktop` | `@tpr/desktop` | `dev`、`build`、`tauri`、`typecheck` |

根 `package.json` 脚本（`/goal` 里的 `pnpm dev` 特指 Tauri）：

```json
{
  "scripts": {
    "dev": "pnpm --filter @tpr/desktop tauri dev",
    "dev:web": "pnpm --filter @tpr/desktop dev",
    "build": "pnpm --filter @tpr/desktop tauri build",
    "build:web": "pnpm --filter @tpr/desktop build",
    "typecheck": "pnpm -r --parallel typecheck",
    "test": "pnpm -r test",
    "check:boundaries": "node scripts/check-boundaries.mjs",
    "check": "pnpm typecheck && pnpm test && pnpm check:boundaries",
    "format": "biome format --write .",
    "lint": "biome check ."
  }
}
```

---

## 4. 包消费与构建策略

### 4.1 源码直连（D6）

每个内部包**不产出 `dist`**，`package.json` 直接指向源码：

```json
{
  "name": "@tpr/core",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc -p tsconfig.json --noEmit", "test": "vitest run" },
  "dependencies": {
    "@tpr/schema": "workspace:*",
    "@tpr/platform": "workspace:*",
    "flexsearch": "0.8.212",
    "nanoid": "6.0.2"
  }
}
```

理由（对比备选的"每包 tsc/tsup 产出 d.ts + JS"）：

- 少一套 watch 构建，Goal 1 当天就能跑 `tauri dev`；
- 类型就是源码本身，不存在 d.ts 与实现漂移；
- Vite 直接处理 `.ts` 依赖，HMR 穿透到 `packages/ui`；
- 代价：未来若要发布到 npm，需要再加 tsup —— 本项目是私有应用，无此需求。

### 4.2 tsconfig 策略

`tsconfig.base.json`（各包 `extends` 它，只覆盖 `include`/`lib`）：

```jsonc
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "moduleDetection": "force",
    "verbatimModuleSyntax": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "types": []
  }
}
```

- `packages/ui` 额外 `"lib": ["ES2022","DOM","DOM.Iterable"]`、`"types": ["vite/client"]`；`core` 保持 `"lib": ["ES2022"]`（**没有 DOM**，从类型层面阻止误用 `window`/`document`）。
- `apps/desktop` 额外 `"lib": [...DOM]`、`"types": ["vite/client"]`、`"paths": {"@/*": ["./src/*"]}`。
- 不用 project references、不用 `tsc --build`：单包 `tsc -p --noEmit` 即可，包间引用由 TS 的模块解析直接跟进源码。

### 4.3 Vite 配置要点

```ts
// apps/desktop/vite.config.ts
export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: false,
    fs: { allow: [searchForWorkspaceRoot(process.cwd())] },
  },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  build: { target: 'esnext', sourcemap: !!process.env.TAURI_ENV_DEBUG },
});
```

- `strictPort: true`：端口被占时直接失败，而不是悄悄换端口让 Tauri 连不上。
- `server.fs.allow` 必须含 monorepo 根，否则 `packages/ui` 的源码会被 Vite 拒绝加载（pnpm workspace 软链到真实路径）。
- `envPrefix` 含 `TAURI_ENV_*`，Tauri CLI 注入的调试标记才能被前端读到。

---

## 5. 平台抽象层（`@tpr/platform`）

### 5.1 组成（D7）

| 入口 | 内容 | 依赖 |
|---|---|---|
| `@tpr/platform` | 6 个接口 + `Platform` 聚合 + `PlatformError` + 安全工具函数 | **零运行时依赖** |
| `@tpr/platform/memory` | `InMemoryFileSystem`、`FflateZip`、`MockNetwork`、`NoopOpener`、`BlobAssetUrls` | `fflate` |

`memory` 入口有三个用途：core 的单测、浏览器里 `pnpm dev:web` 的预览、未来 RN 端自测。桌面端**不**使用它。

### 5.2 接口签名（D8，实现时照抄）

```ts
// packages/platform/src/types.ts
export type IsoDate = string;

export interface DirEntry {
  readonly name: string;
  readonly path: string;
  readonly isDir: boolean;
  readonly size: number;
}

export interface IAppPaths {
  /** 应用私有数据目录，绝对路径，保证存在。桌面端 = $APPDATA/com.touhou.peachreader */
  readonly dataDir: string;
  /** 可随时清空的缓存目录，绝对路径，保证存在 */
  readonly cacheDir: string;
  /** 跨平台路径拼接（绝不用字符串加 '/' 拼接） */
  join(...parts: string[]): string;
}

export interface IFileSystem {
  readText(path: string): Promise<string>;
  readBytes(path: string): Promise<Uint8Array>;
  writeText(path: string, data: string): Promise<void>;
  writeBytes(path: string, data: Uint8Array): Promise<void>;
  exists(path: string): Promise<boolean>;
  stat(path: string): Promise<{ size: number; mtimeMs: number } | null>;
  listDir(path: string): Promise<DirEntry[]>;
  /** 递归创建，已存在不报错 */
  mkdir(path: string): Promise<void>;
  remove(path: string, options?: { recursive?: boolean }): Promise<void>;
  /** 原子改名；跨设备时实现内部退化为 copy+remove */
  rename(from: string, to: string): Promise<void>;
  copy(from: string, to: string): Promise<void>;
}

export interface ExtractResult {
  readonly entries: number;
  readonly bytes: number;
  /** 被安全策略拒绝的条目（相对路径 + 原因），不会导致整体失败 */
  readonly rejected: ReadonlyArray<{ entry: string; reason: string }>;
}

export interface IZip {
  /** 流式解压到目录；实现必须自己做 zip-slip 校验（双保险） */
  extractAll(zipPath: string, destDir: string): Promise<ExtractResult>;
  /** 打包目录为 zip；entries 为空表示全量 */
  createFromDir(srcDir: string, zipPath: string, entries?: readonly string[]): Promise<void>;
}

export interface DownloadProgress {
  readonly received: number;
  readonly total?: number;
}

export interface INetwork {
  fetchJson<T>(url: string, init?: { signal?: AbortSignal }): Promise<T>;
  download(
    url: string,
    destPath: string,
    onProgress?: (p: DownloadProgress) => void,
  ): Promise<void>;
}

export interface IOpener {
  /** 只允许 http/https；其他协议抛 EINVAL */
  openExternal(url: string): Promise<void>;
}

export interface IAssetUrls {
  /** 本地绝对路径 → 可放进 <img src> 的 URL */
  toUrl(absolutePath: string): string;
  readonly kind: 'asset-protocol' | 'blob' | 'none';
}

export interface Platform {
  readonly kind: 'tauri' | 'web' | 'memory';
  readonly paths: IAppPaths;
  readonly fs: IFileSystem;
  readonly zip: IZip;
  readonly network: INetwork;
  readonly opener: IOpener;
  readonly assets: IAssetUrls;
}
```

### 5.3 错误模型

```ts
export type PlatformErrorCode =
  | 'ENOENT' | 'EACCES' | 'EEXIST' | 'ENOSPC' | 'EIO'
  | 'ENETWORK' | 'EZIP' | 'EINVAL' | 'ECANCELED';

export class PlatformError extends Error {
  constructor(
    readonly code: PlatformErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) { super(message, options); this.name = 'PlatformError'; }
}
```

规则：**实现必须把原生错误翻译成带 code 的 `PlatformError`**；core **禁止**用正则去匹配原生错误文案（Windows 的中文错误信息会随系统语言变化）。

### 5.4 ZIP 的两套实现（D9）

| 实现 | 位置 | 手段 | 用途 |
|---|---|---|---|
| 桌面 | `apps/desktop/src-tauri/src/commands/zip.rs` | Rust `zip@9` + `walkdir`，`spawn_blocking` 流式 | 真实导入导出 |
| 内存 | `@tpr/platform/memory` | `fflate`（`unzipSync`/`zipSync`） | 单测、`dev:web` 预览 |

为什么不用 JSZip 之类的纯 JS 方案做桌面实现：2 GB 的图库包在 JS 里解压会把内存打满。Rust 侧按 64 KB 缓冲流式读写，峰值内存与包大小无关。

### 5.5 安全契约（D10，必须实现，不是建议）

1. `assertSafeRelativePath(p)`（`@tpr/platform` 导出，core 与 Rust 各实现一份）：
   - 拒绝绝对路径、盘符（`C:`）、UNC（`\\`）、以 `/` 开头、含 `..` 段、含 `\0`；
   - 拒绝 Windows 保留名（`CON`、`PRN`、`AUX`、`NUL`、`COM1-9`、`LPT1-9`）与结尾空格/点。
2. 解压限额（可在 settings 覆盖）：单条 ≤ 512 MB、总解压 ≤ 8 GB、条目数 ≤ 200 000；**符号链接条目一律拒绝**（记入 `rejected`，不失败）。
3. `openExternal` 只放行 `http:` / `https:`，其余抛 `EINVAL`。
4. Tauri CSP（§14.3）限制 `img-src` 到 `asset:` 与 `http://asset.localhost`，避免任意本地文件被渲染。
5. 所有拼接路径走 `paths.join()`；测试用例必须包含**含空格与中文的路径**（工作目录本身就是 `D:\Work of DSH\Touhou Peach Reader`）。

## 6. 数据模型细化

### 6.1 同一实体在系统中的三种形态

| 形态 | 类型名 | 住在哪 | 是否含正文 |
|---|---|---|---|
| 包格式（磁盘 JSON） | `ArticleFile` 等 `*File` 类型 | `.tpr` / workspace 目录 | `content` 可能是 `string`（旧包，导入时归一化） |
| 内存快照 | `DBSnapshot` + `ArticleMeta` 等 | `@tpr/core` | **不含**正文，正文按需读 |
| 编辑态 | 与包格式同构的纯对象 | 编辑器 → `edit` 纯函数 → 落盘 | 含正文（正在编辑） |

定义（`packages/schema/src/entities.ts`，字段顺序即序列化顺序）：

```ts
export type TagCategory = 'character' | 'plot' | 'series' | 'general';
export type ArticleType = 'short' | 'series-entry';
export type SeriesStatus = 'ongoing' | 'completed';
export type ImageKind = 'cover' | 'illustration' | 'captioned' | 'other';
export type FeaturedTargetType = 'article' | 'series';

/** 内存形态：正文被抽走，避免 2 万篇 × 数 KB 常驻内存 */
export type ArticleMeta = Omit<Article, 'content'>;

export interface ArticleFile {
  id: string; type: ArticleType; title: string; summary: string;
  content: string | { file: string };      // 导入时两种都收，落盘一律 { file }
  authorIds: string[]; translatorIds: string[];
  characterTagIds: string[]; plotTagIds: string[];
  seriesId?: string; coverImageId?: string; illustrationImageIds?: string[];
  sourceUrl?: string; createdAt: string; updatedAt: string;
}
```

`/plan` 里的 `Article` 字段一个都不增、一个都不减；`translatorIds` 与 `authorIds` 共用 `Author` 集合（译者也是人）。

**唯一的一处实体字段增补（Goal 16）**：`Series` 增加可选的 `translatorIds: string[]`（默认 `[]`）。理由：系列级译者信息在 `/plan` 里无处存放，而「系列由谁翻译」是策展数据里常见的一项；作为加法变更不升 `schemaVersion`，旧包缺字段时按空数组处理，导出时也会写出该字段。

### 6.2 ID 策略（D11）

| 实体 | 形态 | 规则 | 为什么 |
|---|---|---|---|
| Author | 确定性 | `p_` + `sha256(归一化名)[0..12]` | 两个库里"同一个作者"必须合并成一条 |
| Tag | 确定性 | `t_` + `sha256(category + '\u0000' + 归一化名)[0..12]` | 同上；把 category 并入哈希，避免「魔理沙」角色 tag 与同名情节 tag 撞 id |
| Article | 随机 | `a_` + nanoid(16, 小写字母数字) | 同名的两篇文章是两篇，确定性 id 会把它们误合并 |
| Series | 随机 | `s_` + nanoid(16) | 同上 |
| Image | 随机 | `i_` + nanoid(16) | 图片按字节内容去重会误合并同图不同裁切 |

归一化函数（确定性 id 的唯一输入）：

```ts
export function normalizeName(raw: string): string {
  return raw
    .normalize('NFKC')            // 全角→半角、兼容字符统一
    .toLowerCase()
    .replace(/[\s\u3000]+/gu, ' ') // 含全角空格
    .trim();
}
```

实现约束：

- 哈希用 `crypto.subtle.digest('SHA-256', utf8)`（WebView2 与 Node 24 都有；页面是 `tauri://localhost` 或 `localhost`，属安全上下文）。**不引第三方哈希库**。
- nanoid 使用**自定义小写 base36 字母表**，保证 Windows/macOS 大小写不敏感文件系统上路径唯一：
  ```ts
  import { customAlphabet } from 'nanoid';
  const nid = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 16);
  ```
- ID 正则（zod 与运行时 `is*Id()` 共用）：
  ```ts
  export const ID_DET = /^[pt]_[0-9a-f]{12}$/;           // author / tag
  export const ID_RND = /^[asi]_[a-z0-9]{16}$/;          // 生成：article / series / image
  export const ID_RND_LENIENT = /^[asi]_[A-Za-z0-9]{16}$/; // 校验：容忍外部包的大写
  ```
  生成器只产出小写 base36；**zod 校验用宽松版**（`ID_RND_LENIENT`），否则别的工具导出的合法 id 会被我们判死。文件系统不敏感问题由"生成端恒小写"保证，不靠校验端限制。
- **id 一旦生成永不重算**：作者改名、标签改名都不换 id；否则合并会退化成按名字匹配。
- 碰撞处理：加载时若两个不同归一化名产出同一 id（概率 2⁻⁴⁸ 量级），报 `E_ID_COLLISION` 并列出冲突双方，由用户手工改其中一方——不做静默加后缀。

### 6.3 正文存储（D12）

- 规范形态：`content = { "file": "articles/{id}.md" }`，与 `/plan` 的 `{ file: string }` 一致；`file` 必须是**包内相对路径**且**恰好等于** `articles/{articleId}.md`（`E_INVALID_CONTENT_FILE`）。
- 导入兼容：`content` 为 `string` 时，把它写成 `articles/{id}.md` 并改写成对象形态；整库只在"归一化落盘"阶段做一次。
- 内存中不持有正文：`ContentStore` 按需读取，LRU 32 篇。

```ts
// packages/core/src/library/content-store.ts
export interface ContentStore {
  read(articleId: string): Promise<string>;
  write(articleId: string, markdown: string): Promise<void>;   // 先 .tmp 再 rename
  invalidate(articleId: string): void;
}
```

- 编码：UTF-8 无 BOM；写入时把 CRLF 统一成 LF，但**不改动 Markdown 内容本身**（不格式化、不重排）。
- 正文缺失 = `E_CONTENT_MISSING`（error）：文章卡片能显示标题却没正文属于硬伤，导入时就报，不留到阅读时。
- 不引入 `wordCount` 字段（`/plan` 没有），需要字数时按需计算。

### 6.4 虚拟标签（D13）

`/plan` 的 `TagCategory` 保持 4 个值不动（`character` = 角色，`plot` = 情节，`series` = 题材/分支这类**主题**标签，`general` = 其他）；**虚拟标签是另一套概念**，用 `v:` 前缀隔离，永不写进 `tags.json`：

```ts
export type VirtualTagId = 'v:series' | 'v:oneshot' | 'v:ongoing' | 'v:completed';
export const VIRTUAL_TAG_LABEL: Record<VirtualTagId, string> = {
  'v:series': '系列文', 'v:oneshot': '短篇文',
  'v:ongoing': '连载中', 'v:completed': '已完结',
};

export function virtualTagsOfArticle(a: ArticleMeta, s?: Series): VirtualTagId[] {
  const out: VirtualTagId[] = [s ? 'v:series' : 'v:oneshot'];
  if (s) out.push(s.status === 'completed' ? 'v:completed' : 'v:ongoing');
  return out;
}
export function virtualTagsOfSeries(s: Series): VirtualTagId[] {
  return [s.status === 'completed' ? 'v:completed' : 'v:ongoing'];
}
```

- 导出：不写；导入：若包内出现 `v:` 开头的 tag，一律丢弃并记 `W_VIRTUAL_TAG_IN_FILE`。
- 搜索：`#已完结` 这类查询由查询解析器识别成 `v:completed`，命中索引里的 `virtual` 字段（§11）。
- 筛选：浏览页的「系列文 / 短篇文 / 连载中 / 已完结」chips 直接由 `type`/`status` 过滤，不查 tag 表。

### 6.5 引用完整性与校验码

`validateDatabase(snapshot)` 返回：

```ts
export interface Issue {
  code: string;
  severity: 'error' | 'warning';
  entity: 'manifest' | 'author' | 'tag' | 'article' | 'series' | 'image' | 'featured' | 'credits';
  entityId?: string;
  field?: string;
  message: string;      // 面向用户的中文
  hint?: string;        // 怎么修
}
export interface ValidateResult { ok: boolean; errors: Issue[]; warnings: Issue[] }
```

| 代码 | 级别 | 条件 |
|---|---|---|
| `E_MANIFEST_INVALID` | error | manifest 缺字段或类型不符 |
| `E_SCHEMA_VERSION_NEWER` | error | `schemaVersion > CURRENT_SCHEMA_VERSION` |
| `E_UNKNOWN_SCHEMA` | error | `schemaVersion < 1` 或非整数 |
| `E_DUPLICATE_ID` | error | 同集合内 id 重复（一次列全） |
| `E_ID_COLLISION` | error | 两个不同归一化名算出同一确定性 id |
| `E_ID_FORMAT` | error | id 不匹配 §6.2 正则 |
| `E_SERIES_TYPE_MISMATCH` | error | `type='series-entry'` 却无 `seriesId`，或 `type='short'` 却有 `seriesId` |
| `E_SERIES_ORDER` | error | `series.articleIds` 里某篇的 `seriesId` 不是该系列 |
| `E_ARTICLE_IN_MULTIPLE_SERIES` | error | 同一篇出现在两个 `articleIds` 列表里 |
| `W_SERIES_MEMBERSHIP` | warning | 文章标了 `seriesId`，但该系列的 `articleIds` 里没有它（Goal 15 新增：目录是顺序的唯一来源，这种不一致只告警，编辑器保存时自动修复） |
| `E_IMAGE_FILE_MISSING` | error | `image.file` 在包内不存在 |
| `E_IMAGE_FORMAT` | error | 图片字节魔数不在 `webp/png/jpeg/gif` 之内（§7.4 第 5 条） |
| `E_INVALID_CONTENT_FILE` | error | `content.file` 不等于 `articles/{id}.md` |
| `E_CONTENT_MISSING` | error | `articles/{id}.md` 不存在 |
| `W_DANGLING_SERIES` | warning | `seriesId` 指向不存在的系列（单篇导出包常见） |
| `W_DANGLING_AUTHOR` | warning | `authorIds` / `translatorIds` 指向不存在的作者 |
| `W_DANGLING_TAG` | warning | 三组 tag id 指向不存在的标签 |
| `W_DANGLING_IMAGE` | warning | `coverImageId` / `illustrationImageIds` 指向不存在的图片 |
| `W_DANGLING_FEATURED` | warning | `targetId` 不存在（前端降级为"条目已失效"，见 Goal 6） |
| `W_COUNT_MISMATCH` | warning | `manifest.counts` 与实体数不符 |
| `W_URL_SCHEME` | warning | `sourceUrl` / `link` 非 `http(s)` |
| `W_DUPLICATE_NAME` | warning | 两个作者或标签归一化名相同但 id 不同（疑似重复，交 §10 的 `possibleDuplicates`） |
| `W_VIRTUAL_TAG_IN_FILE` | warning | 包内出现 `v:` 开头的 tag，已丢弃 |

规则：**error 阻断导入**（不落盘、不留残余）；**warning 照常导入**并在导入结果页列出可折叠清单。

### 6.6 `counts` 的口径

`counts` 是给人和下载器看的"体检数字"，不是索引来源：

```ts
export type Counts = Record<
  'authors' | 'tags' | 'articles' | 'series' | 'images' | 'featured' | 'credits',
  number
>;
```

- 导出一律重算（`recount(snapshot)`）；导入只比对、不符记 `W_COUNT_MISMATCH`，以实际实体数为准。
- **写入也要回写**（Goal 21 修复）：`computeCounts` 返回新对象、不改入参，早先 `library.save*` 只调用不赋值，导致编辑器增删后 `manifest.counts` 仍是导入时的旧值。现在两处双保险：写盘前 `draft.manifest.counts = computeCounts(draft)`；读盘时 `toSnapshot` 再用 `{ ...raw.manifest, counts: computeCounts(raw) }` 兜底，旧库/手工改坏的库也能显示正确数字。UI 不直接信 `manifest.counts`，首页与统计一律数数组长度。

---

## 7. `.tpr` 包格式 v1

### 7.1 容器规则

| 项 | 规定 |
|---|---|
| 扩展名 | `.tpr`（本质是 ZIP，双击可由系统解压软件打开——这是刻意保留的可检查性） |
| 压缩 | DEFLATE（`zip` crate 的 `CompressionMethod::Deflated`），不加密，不 zip64（除非 >4 GB，届时由实现自动切） |
| 文件名编码 | UTF-8，必须设置通用标志位 bit 11（Rust `zip` 与 fflate 默认都会写） |
| 目录层级 | 全部在根，**不允许**外包一层 `database/`（导入端遇到单层包裹目录会自动下钻一层，记 `W_WRAPPED_ROOT`） |
| 文件顺序 | `manifest.json` 放在**最后一个**写入（写出中途失败 → 包不完整 → 导入端一眼发现） |

### 7.2 目录树

```
{name}-{version}.tpr
├─ manifest.json
├─ authors.json                 ← 裸数组
├─ tags.json                    ← 裸数组
├─ images.json                  ← 裸数组（图片元数据：caption / kind）
├─ articles/
│  ├─ {articleId}.json
│  └─ {articleId}.md
├─ series/
│  └─ {seriesId}.json
├─ featured.json                ← 裸数组
├─ credits.json                 ← 裸数组
└─ images/
   ├─ cover/{imageId}.{ext}
   ├─ illustration/{imageId}.{ext}
   ├─ captioned/{imageId}.{ext}
   └─ other/{imageId}.{ext}     ← 仅 kind='other' 时存在
```

> 集合用"裸数组 + 每实体一文件"：`authors.json`/`tags.json`/`images.json`/`featured.json`/`credits.json` 小到单文件即可；`articles/`、`series/` 一实体一文件，是为了 GitHub 上 diff 可读、合并冲突粒度小。
>
> `images.json` 是 `/plan` 四、的目录树漏掉的一环：`ImageAsset` 有 `caption`/`kind` 这类元数据，但图片文件本身（`images/cover/{id}.ext`）只承载字节，元数据必须另有落点。补一个裸数组文件，语义与 `authors.json` 完全相同。

### 7.3 逐文件示例

`manifest.json`

```json
{
  "schemaVersion": 1,
  "databaseId": "db_7c1f0a9e2b34",
  "name": "东方桃图吧大书库",
  "version": "2026.10.1",
  "updatedAt": "2026-10-19T04:00:00.000Z",
  "sourceUrl": "https://github.com/<owner>/<repo>",
  "description": "东方同人短篇与系列合集",
  "counts": { "authors": 128, "tags": 412, "articles": 1730, "series": 96, "images": 2104, "featured": 40, "credits": 12 }
}
```

`authors.json`

```json
[
  { "id": "p_9f2c1a7b3d05", "canonicalName": "示例作者", "aliases": ["旧名甲", "旧名乙"], "notes": "", "sourceUrl": "https://example.com/author" }
]
```

`tags.json`

```json
[
  { "id": "t_4b8e0c2f9a17", "category": "character", "name": "雾雨魔理沙", "aliases": ["魔理沙"] },
  { "id": "t_0d7a55e1c982", "category": "plot",      "name": "红魔馆",     "aliases": [] }
]
```

`articles/a_V1stgxr8z5jdhi6.json`

```json
{
  "id": "a_V1stgxr8z5jdhi6",
  "type": "series-entry",
  "title": "示例：雾雨宅的午后",
  "summary": "一句话简介",
  "content": { "file": "articles/a_V1stgxr8z5jdhi6.md" },
  "authorIds": ["p_9f2c1a7b3d05"],
  "translatorIds": [],
  "characterTagIds": ["t_4b8e0c2f9a17"],
  "plotTagIds": ["t_0d7a55e1c982"],
  "seriesId": "s_3k9m2p8q1w7e4r5t",
  "coverImageId": "i_8c2b7d1e5f9a3c6b",
  "illustrationImageIds": ["i_2d4e6f8a0b1c3d5e"],
  "sourceUrl": "https://example.com/p/123",
  "createdAt": "2026-01-02T03:04:05.000Z",
  "updatedAt": "2026-09-30T12:00:00.000Z"
}
```

`series/s_3k9m2p8q1w7e4r5t.json`

```json
{
  "id": "s_3k9m2p8q1w7e4r5t",
  "title": "示例系列",
  "summary": "系列简介",
  "status": "completed",
  "articleIds": ["a_V1stgxr8z5jdhi6", "a_0p9o8i7u6y5t4r3e"],
  "authorIds": ["p_9f2c1a7b3d05"],
  "characterTagIds": ["t_4b8e0c2f9a17"],
  "plotTagIds": [],
  "coverImageId": "i_8c2b7d1e5f9a3c6b",
  "sourceUrl": "https://example.com/series/9",
  "createdAt": "2026-01-02T03:04:05.000Z",
  "updatedAt": "2026-09-30T12:00:00.000Z"
}
```

`images.json`

```json
[
  { "id": "i_8c2b7d1e5f9a3c6b", "file": "images/cover/i_8c2b7d1e5f9a3c6b.webp", "kind": "cover", "caption": "封面" },
  { "id": "i_2d4e6f8a0b1c3d5e", "file": "images/illustration/i_2d4e6f8a0b1c3d5e.png", "kind": "illustration" }
]
```

`featured.json`（每条可承载**多条**推荐语）

```json
[
  {
    "targetType": "series",
    "targetId": "s_3k9m2p8q1w7e4r5t",
    "recommendations": [
      { "author": "推荐人甲", "text": "这篇的分镜太好了。" },
      { "text": "没有署名的推荐语也合法。" }
    ]
  }
]
```

`credits.json`

```json
[
  { "name": "某人", "role": "校对", "link": "https://example.com/u/1", "note": "第三章特别协助" }
]
```

### 7.4 序列化规范（保证 diff 可读、round-trip 相等）

1. JSON：`JSON.stringify(value, null, 2)`，UTF-8 无 BOM，**末尾一个换行**。
2. 键顺序：严格按 6.1 与 `/plan` 的字段声明顺序输出（用显式的 `serializeArticle()` 等函数构造对象，不依赖对象字面量的插入序偶然性——但也不排序，保持语义分组）。
3. 空值：`undefined`/缺省字段**不写**（`seriesId` 为空就不出现，不写 `null`）；空数组照写 `[]`（区分"没有"与"未知"）。
4. 时间：统一 `toISOString()`（毫秒 + `Z`）。
5. 图片文件名：`{id}.{ext}`，`ext` 由**字节魔数**决定（`RIFF....WEBP` / `\x89PNG` / `\xFF\xD8\xFF` / `GIF8`），不信上传时的扩展名；无法识别则拒绝并报 `E_IMAGE_FORMAT`。
6. 路径分隔符：包内一律 `/`；落盘时经 `paths.join()` 转换。

### 7.5 导入六步（`importZipPath`）

```ts
async function importZipPath(src: string, platform: Platform): Promise<ImportResult> {
  // 1) 预检：只读 manifest.json（zip 中央目录定位，不整包解压）
  const manifest = await readManifestOnly(src);              // E_MANIFEST_INVALID / unsupported
  assertVersion(manifest.schemaVersion);                     // E_SCHEMA_VERSION_NEWER / E_UNKNOWN_SCHEMA
  // 2) 校验路径安全 + 总量限额，边扫边解压到暂存区
  const staging = join(paths.dataDir, 'imports', `${Date.now()}`);
  const r = await zip.extractAll(src, staging);              // 拒绝 zip-slip / symlink / 超限，记 rejected
  // 3) 解析 + 归一化（字符串正文落成 .md，裸数组建 map）
  const raw = await readRawDatabase(staging, fs);
  // 4) 迁移到当前版本（在 zod parse 之前改形状）
  const { db, applied } = migrateDatabase(raw, manifest.schemaVersion);
  // 5) 结构校验（schema + 引用完整性），error 即中止并清理 staging
  //    校验前先剔除包内没有文件的图片条目（旧版本可能导出过 BLOB 缺失的包），记 W_IMAGE_FILE_MISSING
  const report = validateDatabase(toSnapshot(db));
  if (!report.ok) { await fs.remove(staging, { recursive: true }); throw new ImportError(report.errors); }
  // 6) 原子换名入库 + 写 active.json + 建索引
  await commitWorkspace(staging, manifest.databaseId, platform);  // 见 §9.3
  return { snapshot: await loadSnapshot(manifest.databaseId, platform), report, migrations: applied, rejected: r.rejected };
}
```

导入端的兼容约定：包内 `images.json` 有条目但对应图片文件不存在时，**不当作 error**——该条目会在校验前从内存库中剔除，并在 `report.warnings` 最前面记一条 `W_IMAGE_FILE_MISSING`（`entity: 'image'`），其余继续导入。这样 0.1.8 及更早版本曾导出的“缺 BLOB 包”仍然可恢复；`validateDatabase` 本身的 `E_IMAGE_FILE_MISSING` 契约保持不变，导出端必须保证清单与文件一致。

字节入口（`/goal` 3 的签名）在桌面端是**薄包装**：把 `Uint8Array` 写到 `imports/{ts}.tpr` 再走上面这条路，从而始终使用 Rust 流式解压；在 web/memory 端直接 `fflate.unzipSync`。

```ts
export interface ImportResult {
  snapshot: DBSnapshot;
  report: ValidateResult;
  migrations: number[];
  rejected: ReadonlyArray<{ entry: string; reason: string }>;
}
```

### 7.6 导出闭包规则（导出什么 = 谁能被独立打开）

| 编号 | 规则 |
|---|---|
| B0 | `all: true` 是**完整备份**：全部 authors/tags/images/articles/series/featured/credits 原样导出，只重算 `manifest.counts` 与 `updatedAt`，不做引用闭包裁剪（BLOB 不可读的图片按 B8 剔除） |
| B1 | 部分导出：文章集合 = 用户选中集；**作者与标签始终全量导出**（库级词表，未挂接的也带走）；图片按 B3；缺失的引用不补，记 `W_EXPORT_SKIPPED` 警告 |
| B2 | 系列**只在其全部文章都被包含时**才导出，且 `articleIds` 保持原顺序。只导出系列中一篇时，该篇保留 `seriesId`，导入端产生 `W_DANGLING_SERIES`（可接受的降级，避免造出"残缺系列"） |
| B3 | 部分导出时图片只打包被选中文章/系列直接引用的那些，未被引用的不导出（全库备份按 B0 全带） |
| B4 | `featured.json` 只导出 target 落在导出集内的条目（推荐语全带） |
| B5 | `credits.json` 默认全量导出（`includeCredits: false` 时清空并计入 counts） |
| B6 | 导出**不做** schema 降级，`schemaVersion` 恒为 `CURRENT_SCHEMA_VERSION` |
| B7 | `manifest.counts` 重算；`databaseId` 沿用当前库；`updatedAt` 取导出时刻 |
| B8 | 图片行存在但 SQLite `data` 为 NULL/空时，**不写入包**：从 `images` 数组和 `manifest.counts.images` 中一起移除，记 `W_EXPORT_SKIPPED`（message 注明“已从导出包移除”）；导出包中 `images.json`、实际文件、counts 三者必须一致。导入端对旧版本已产出的缺图包按 §7.5 的 `W_IMAGE_FILE_MISSING` 兼容处理 |

> 取舍：标签/作者是库级词表，体积小、跨库通用，用户新建后往往还没来得及挂文章，"导出即备份"的预期要求它们全量跟随；图片是大文件，部分导出按引用收窄，避免单篇导出变成整库拷贝。`all: true` 走独立分支，保证「导出全库」就是完整备份。

### 7.7 导出 API

```ts
export interface ExportSelection {
  articles?: string[];          // 省略 = 不导出文章
  series?: string[];            // 省略 = 仅按 B2 自动补齐
  all?: boolean;                // true = 全库完整备份（优先级最高，不走闭包）
  includeCredits?: boolean;     // 默认 true
}
export interface ExportSummary {
  counts: Counts;
  warnings: Issue[];            // 例如"3 个作者引用缺失，未打包"
  fileName: string;             // `{name}-{yyyyMMdd-HHmm}.tpr`（清理非法文件名字符）
}
export interface ExportResult extends ExportSummary {
  bytes: Uint8Array;
}

// 桌面端：先弹保存对话框，再由 Rust 直接把工作目录写成目标 .tpr（ZIP 字节不回传 JS）
export function suggestExportFileName(databaseName: string): string;
export function exportDatabaseToPath(
  platform: Platform,
  source: ExportSource,
  selection: ExportSelection,
  targetPath: string,
): Promise<ExportSummary>;
```

- `exportDatabase`（返回 bytes）保留给浏览器预览与测试；桌面端走 `Library.exportToPath`，避免 200 MB 级 ZIP 经 IPC 复制成 JS number 数组。
- 导出文件名统一为 `{name}-{yyyyMMdd-HHmm}.tpr`；保存对话框只决定目标路径，目标父目录必须已存在。

---

## 8. `schemaVersion` 与迁移

### 8.1 版本号语义

```ts
export const CURRENT_SCHEMA_VERSION = 1 as const;
```

- **整数、单调递增**；只在"旧包无法被新代码正确理解"时才 +1。
- 纯新增可选字段**不**升版本（zod 用 `.optional()` 收）。例：给 `Article` 加 `readingTime?` 不升版；把 `content` 从 string 改成对象、或改 `type` 的枚举值 → 必须升版。

### 8.2 迁移注册表

```ts
// packages/schema/src/migrate.ts
export type RawDatabase = {
  manifest: unknown; authors: unknown; tags: unknown;
  articles: Record<string, unknown>; series: Record<string, unknown>;
  featured: unknown; credits: unknown;
};
export type Migration = (raw: RawDatabase) => RawDatabase;

/** key = 迁移完成后到达的版本号 */
export const MIGRATIONS: Record<number, Migration> = {
  1: (raw) => raw,   // v1 恒等迁移：把机制跑通，未来只需追加 2、3……
};

export class UnsupportedSchemaError extends Error {
  constructor(readonly code: 'E_NEWER_SCHEMA' | 'E_UNKNOWN_SCHEMA', readonly version: number) {
    super(code === 'E_NEWER_SCHEMA'
      ? `该数据库由更新版本的 Touhou Peach Reader 创建（schemaVersion=${version}），请升级客户端。`
      : `无法识别的 schemaVersion=${version}。`);
  }
}

export function migrateDatabase(
  raw: RawDatabase,
  fromVersion: number,
  registry: Record<number, Migration> = MIGRATIONS,
): { db: RawDatabase; applied: number[] } {
  if (!Number.isInteger(fromVersion) || fromVersion < 1) throw new UnsupportedSchemaError('E_UNKNOWN_SCHEMA', fromVersion);
  if (fromVersion > CURRENT_SCHEMA_VERSION) throw new UnsupportedSchemaError('E_NEWER_SCHEMA', fromVersion);
  let db = raw; const applied: number[] = [];
  for (let v = fromVersion + 1; v <= CURRENT_SCHEMA_VERSION; v++) {
    const m = registry[v];
    if (!m) throw new UnsupportedSchemaError('E_UNKNOWN_SCHEMA', v);
    db = m(db); applied.push(v);
  }
  if (fromVersion === CURRENT_SCHEMA_VERSION) applied.push(CURRENT_SCHEMA_VERSION); // 恒等也记一笔，测试可断言
  return { db, applied };
}
```

`registry` 可注入，是为了 Goal 2 能**在不发布 v2 的前提下**测试迁移链（测试里塞一个假 `2: raw => …`）。

### 8.3 迁移与校验的顺序

```
读原始 JSON → migrateDatabase（改形状）→ zod 解析（类型）→ 引用完整性（语义）→ 归一化落盘
```

顺序不可换：形状变了之后 old zod schema 一定解析失败；先解析则永远进不了迁移。

### 8.4 迁移的测试要求（Goal 2 交付）

1. 当前版本 → `applied === [1]`、实体不变（深比较）。
2. `schemaVersion = CURRENT + 1` → 抛 `E_NEWER_SCHEMA`（含中文可读文案）。
3. 注入假 v2 迁移 → `applied === [2]`，且 v2 的字段能在结果里看到。
4. 迁移后仍跑一遍 `validateDatabase` → `ok === true`。

---

## 9. 本地持久化（D14）

### 9.1 目录与数据布局

```
$APPDATA/com.touhou.peachreader/          ← 桌面端 = %APPDATA%\com.touhou.peachreader
├─ settings.json          全局：主题、配色、壁纸、语言、默认源、解压限额
├─ active.json            当前库指针：{ "databaseId": "db_…", "openedAt": "ISO" }
├─ wallpapers/            壁纸图片（`wp-{epoch_ms}.{png|jpg|jpeg|webp}`，≤20 MB，由 Rust 命令复制进来）
├─ workspace/
│  └─ {databaseId}/
│     ├─ database.sqlite   当前库：实体 + 正文 + 图片 BLOB
│     └─ legacy/           旧 JSON workspace 的迁移备份（仅迁移后出现，可手工删除）
├─ user/
│  └─ {databaseId}.json   用户态：{ favorites: { articles: [], series: [] }, lastMergeAt, source }
├─ cache/
│  ├─ thumbs/             封面缩略图（可删）
│  └─ search/             v1 不做持久化索引；预留
└─ imports/
   └─ {timestamp}/        导入暂存区（失败即删）
```

本地库是**一个 SQLite 文件**，不再是"与 `.tpr` 同构的目录"：

| 表 | 内容 |
|---|---|
| `manifest` | 单行（`id = 1`）：原 `manifest.json` 字段 + `counts_json` |
| `authors` / `author_aliases` | 作者与别名，`position` 保序 |
| `tags` / `tag_aliases` | 标签与别名；`aliases_present` 区分"缺省"与"空数组" |
| `images` | 图片元数据 + `mime` / `byte_size` / `data BLOB` |
| `articles` / `article_contents` | 文章元数据与 Markdown 正文（按 `article_id` 一行） |
| `article_authors` / `article_tags` / `article_illustrations` | 文章关系与顺序 |
| `series` / `series_articles` / `series_authors` / `series_tags` | 系列与关系、顺序 |
| `featured` / `featured_recommendations` | 精选条目与多条推荐语 |
| `credits` | 鸣谢，`position` 保序 |

- `PRAGMA user_version` 是**本地库布局版本**，与 `.tpr` 的 `manifest.schemaVersion` 相互独立；打开时版本不匹配直接报"不支持的本地数据库版本"，不做隐式升级。
- 不启用外键：`validateDatabase` 把悬空作者/标签/系列当 warning，导入必须保持宽松；删除与级联由 `saveDatabase` 显式处理。
- `.tpr` **仍是** JSON + Markdown 文件 + 图片文件的交换格式（§7.2）；SQLite 只是本地运行时形态，导出时重新物化成文件，不把 `database.sqlite` 放进包。
- `settings.json`、`active.json`、`user/*.json` **不是**数据库包的一部分，导出时不带。
- **编辑器草稿箱（Goal 16）不在数据库里**：存在 WebView 的 `localStorage`，键为 `tpr:drafts:v1:{databaseId}`，值为 `DraftEnvelope[]`（`{v:1,id,kind,label,updatedAt,payload}`）。按库隔离；最多 50 条（超出丢最旧）、单条 payload 上限 1.5 M 字符；写入失败（配额/过大）在表单里显示"草稿未保存"横幅，但**不阻断保存实体**。草稿不随数据库导出，换机不迁移。
- 收藏（Goal 7）落在 `user/{databaseId}.json`：`favorites.articles` / `favorites.series` 为 id 数组，按加入时间倒序。数据库被重新导入导致某条消失时，读取时过滤并记 `stale`（保留 id，UI 显示灰色"已失效"）。
- 同一 `databaseId` 重复导入 = **覆盖**（先备份再换名）；不同 id = 新增一个库，可在 `/settings` 切换。
- **删除实体会同步删除数据库行**：`saveDatabase` 先删正文/关系子表再删主表，图片主表删除时 BLOB 一并删除；不再需要 `pruneDatabaseDir` 之类的目录清理。

### 9.2 写入协议：SQLite 事务 + 正文/图片专用路径

```ts
// 正文：按文章 id UPSERT 一行，编辑不重写整库
await contents.write(articleId, markdown);
// 图片：BLOB 单独写，避免大图进入 JSON IPC
await writeImageBlob(platform, dir, image, bytes);
// 元数据：一次编辑的差异在同一个事务里提交
await saveDatabase(platform, dir, previous, next);
```

- **正文**存 `article_contents`，由 `ContentStore` 懒加载/按需读取；编辑元数据不会重写正文。
- **图片**字节由 `Platform.sql.writeBlob` 写进 `images.data`；Rust 侧直接把 app data 内的文件绑定为 BLOB，或把 BLOB 直接落成导出文件，字节不经过 JS。
- **元数据**由 `saveDatabase` 做差异更新：只改动新增/修改/删除的实体，删除时先子表后主表；整个调用是一个事务，失败自动回滚。
- 全量导入/迁移用 `writeSqliteDatabase`：在临时文件里建表、写实体/正文/BLOB，读回校验（实体深比较、`PRAGMA quick_check`、正文数量/字节数、图片数量/BLOB 总字节数）通过后才换名。
- 因此不再有 `.dirty` 标记与 `serializeDatabase` 的逐文件写入；崩溃时 SQLite 的事务日志保证"要么旧状态、要么新状态"。

### 9.3 入库的原子换名

导入仍先解到 `imports/{timestamp}/`，在暂存目录里生成 `database.sqlite`，再整体换名：

```ts
async function commitWorkspace(platform: Platform, staging: string, databaseId: string) {
  const target = workspacePath(platform, databaseId);
  const backup = `${target}.bak-${Date.now()}`;
  const hadTarget = await platform.fs.exists(target);
  if (hadTarget) await withRetry(() => platform.fs.rename(target, backup)); // ① 旧库让位
  try {
    await withRetry(() => platform.fs.rename(staging, target));              // ② 新库就位
  } catch (error) {
    if (hadTarget && (await platform.fs.exists(backup))) {
      await platform.fs.rename(backup, target).catch(() => undefined);      // 回滚
    }
    throw new PlatformError('EIO', '导入失败：无法替换本地数据库目录（请关闭占用该目录的程序）', error);
  }
  if (hadTarget && (await platform.fs.exists(backup))) {
    await withRetry(() => platform.fs.remove(backup, { recursive: true })).catch(() => undefined); // ③ 清理
  }
  await writeActive(platform, databaseId);
}
```

Windows 的坑与对策：

| 坑 | 对策 |
|---|---|
| 目录被资源管理器/预览窗格占用导致 rename 失败（`EPERM`/`EACCES`） | 指数退避重试 5 次（50/100/200/400/800 ms），失败则提示"请关闭正在占用该目录的程序" |
| `rename` 跨盘（`imports` 与 `workspace` 不同卷） | 保证二者都在 `dataDir` 下，同卷；`IFileSystem.rename` 内部若检测到跨卷则退化为 `copy + remove` |
| 杀毒软件短暂锁文件 | 同上退避；SQLite 事务失败不覆盖原库 |
| 路径含空格/中文/超长 | 全程 `paths.join()`；单文件路径 ≤ 240 字符（Windows MAX_PATH 余量） |

### 9.4 损坏与恢复

| 症状 | 处理 |
|---|---|
| `database.sqlite` 不存在且没有旧 `manifest.json` | `ensureLocalDatabase` 抛 `EIO 不是有效的数据库目录：缺少 manifest.json`，UI 显示错误；不自动删用户数据，可重新导入同 id 覆盖 |
| `PRAGMA user_version` 不是当前版本 | 报 `EIO 不支持的本地数据库版本`，不尝试猜测结构；保留库文件供后续版本迁移 |
| `manifest` 行缺失 / 关键列不是预期类型 | 报 `EIO database.sqlite 缺少 manifest 行` 或 SQLite 读取错误；不做半读 |
| 某篇文章没有 `article_contents` 行 | 详情页明确提示"正文缺失：{id}"，列表仍可打开 |
| 图片行存在但 `data` 为 NULL | 自定义协议返回 404，页面显示图片占位；导出时跳过该图片、从 `images.json` 与 `manifest.counts` 中移除并记 `W_EXPORT_SKIPPED`，避免产出“有元数据、无文件”的坏包；导入缺图包时同样跳过该元数据并记 `W_IMAGE_FILE_MISSING`（warning），不阻断整库导入；合并时 base 的 NULL 图片按“无字节”参与哈希，incoming 包内缺文件的图片在 prepare 阶段剔除，不写入新行 |
| `active.json` 指向不存在的库 / 没有 `active.json` | `restore()` 返回 `null`，UI 进空状态引导导入；不自动猜测其它库 |
| 磁盘满（`ENOSPC`）/ SQLite 写失败 | 事务回滚，编辑器保留内存态并明确提示，不静默丢改动 |

### 9.5 单实例与并发

- 桌面端进程级单实例（Tauri 单窗口）；**不做**多进程写同一 `database.sqlite` 的保护（超出本项目范围）。
- 所有写操作串行化：core 内部一条 `writeQueue: Promise<void>` 链，避免编辑器快速连点造成事务交错。
- 自定义图片协议只读打开数据库，Rust 侧设置 5 秒 `busy_timeout`；正常编辑是短事务，缩放/滚动时的读不会被长写阻塞。

### 9.6 旧 JSON workspace 迁移

首次打开没有 `database.sqlite` 的库时，`ensureLocalDatabase` 自动迁移：

1. 读取根目录旧 `manifest.json` / `authors.json` / `tags.json` / `images.json` / `featured.json` / `credits.json`、`articles/*.json`、`series/*.json`，并扫描实际存在的 Markdown 与图片文件。
2. `migrateDatabase` 改形状 → `validateDatabase`（错误级直接中止，不生成半成品）。
3. 读正文 Markdown；图片按 id 记录源文件路径。
4. 写同目录的 `database.sqlite.migrating`，内部读回校验通过后原子改名为 `database.sqlite`。
5. 把旧根条目（JSON、`articles/`、`series/`、`images/`、`.dirty`）移进 `legacy/`；**不删除**，留给用户人工备份。下次打开若已存在 `database.sqlite`，只做幂等的残留清理，不重复迁移。

任一步失败旧数据都还在；`.migrating` 半成品下次启动丢弃重来。迁移后 `.tpr` 导出仍是旧格式（JSON + 文件），导入端继续兼容。

---

## 10. 合并算法与冲突报告

### 10.1 输入输出

```ts
export interface MergeInput {
  base: DBSnapshot;      // 当前库
  incoming: DBSnapshot;  // 要并进来的库
}
export interface MergeReport {
  base: { databaseId: string; name: string; version: string };
  incoming: { databaseId: string; name: string; version: string };
  added: Record<CollectionKey, number>;
  updated: Record<CollectionKey, number>;
  kept: Record<CollectionKey, number>;
  conflicts: Conflict[];
  dangling: Issue[];
  possibleDuplicates: Duplicate[];
}
export type CollectionKey = 'authors' | 'tags' | 'articles' | 'series' | 'images';
export interface Conflict {
  conflictId: string;                 // `${collection}:${id}`，稳定可复现
  collection: CollectionKey;
  id: string;
  kind: 'same-time-different-content' | 'binary-different' | 'order-different';
  base?: unknown; incoming?: unknown;
  fields?: string[];                  // 内容层面的差异字段名，给 UI 展示
}
export interface Duplicate { collection: 'authors' | 'tags'; ids: string[]; normalizedName: string }
export interface MergeResult { merged: DBSnapshot; report: MergeReport }
```

### 10.2 逐个集合的规则

对 `authors / tags / articles / series` 统一走 `mergeById`：

```
for id in union(base.ids, incoming.ids):
  if id ∉ base:  → 采用 incoming（added++）
  elif id ∉ incoming: → 保留 base（kept++，不算冲突）
  else:
     a = base[id], b = incoming[id]
     if b.updatedAt > a.updatedAt → 采用 b（updated++）
     elif b.updatedAt < a.updatedAt → 保留 a（kept++）
     else:  # 时间戳相同
        if deepEqual(stripNoise(a), stripNoise(b)) → 保留 a（kept++，视为同一版本）
        else → 冲突（默认保留 a，等用户裁决）
```

- `stripNoise` 去掉 `updatedAt` 自身与任何运行时注入字段；比较用结构深比较，数组顺序敏感（`articleIds` 顺序是数据）。
- **不合并字段级**：不做"取标题自 A、取简介自 B"。理由：字段级合并会产出两个库都不存在的新状态，用户无法预期，也让 round-trip 测试失效。
- `images`：以 id 为键；两边都有时比较**字节 sha256**：相同 → 保留；不同 → 冲突 `binary-different`（用户选一个，绝不自动换图）。base 的 `data` 为 NULL 时按“无字节”参与比较，读取 SQL 只查 `data IS NOT NULL`，不会把 SQLite NULL 抛成 Rust 类型错误。
- `images` 文件缺失：`prepare` 先扫描 incoming 的图片元数据并尝试读包内文件；读不到文件的图片从 incoming snapshot 与 `imageFiles` 中剔除，apply 不会为它写元数据，因此不会新增 `data` 为 NULL 的行。若文章仍引用该 id，validate 阶段记 `W_DANGLING_IMAGE`。
- `featured`：无 id，键 = `${targetType}:${targetId}`。两边都有 → **推荐语取并集**（按 `author ?? ''` + `\u0000` + `text` 去重，保留 base 在前）；这条不产生冲突（推荐语是附加信息，丢一条比多一条更糟）。
- `credits`：无 id，键 = `${normalizeName(name)}\u0000${role ?? ''}\u0000${link ?? ''}`；并集，保持 base 顺序。

### 10.3 冲突裁决

```ts
export type Decision = 'keep-base' | 'take-incoming';
export function applyConflicts(
  result: MergeResult,
  decisions: ReadonlyMap<string, Decision>,   // key = conflictId
): { merged: DBSnapshot; report: MergeReport };  // report.conflicts 已被解决项移除
```

- 未出现在 `decisions` 里的冲突 → 保持"保留 base"，并在 `report.conflicts` 中继续存在（UI 可稍后再处理）。
- 裁决**不回写** base 库，直到用户点「应用合并」；`/merge` 页维护一个待提交的 `MergeResult`。
- 合并结果落盘时：沿用 base 的 `databaseId`，`updatedAt = now`，`version` 由用户填（默认 `base.version + 合并`），`counts` 重算。

### 10.4 合并后的一致性收尾

1. 重算 `indexes`（不用增量，合并是低频操作）。
2. 跑 `validateDatabase`，把新增的 `dangling` 原样塞进 `report.dangling`（**不自动删除**引用）。
3. `possibleDuplicates`：按 `normalizeName` 分组作者与标签，组内 id ≥ 2 即列出；UI 提供"合并为一条"的后续操作（Goal 9 的编辑器里实现，不在合并流程里自动做）。

- 图片一致性：`prepare` 已按包内文件过滤 incoming 图片，base 的 NULL 按无字节处理；因此合并不会因缺 BLOB 中断，也不会在 apply 时为缺图新增 `data=NULL` 行。被过滤图片若仍被文章引用，由第 2 步的 validate 记 `W_DANGLING_IMAGE`。

### 10.5 合并页交互契约（Goal 10）

- 三步：**选择文件 → 预览影响 → 确认应用**。
- 预览必须显示：新增/更新/保留数量（分集合）、冲突清单（每条显示 `base` vs `incoming` 的标题或名字 + 差异字段 + 单条切换）、疑似重复清单、悬空引用清单。
- 「应用」后：写 workspace → 重建索引 → 跳首页并 toast 汇总。
- 「取消」必须无副作用（预览阶段只在内存里算）。

### 10.6 测试要求（Goal 10）

1. 同 id 新 `updatedAt` → incoming 胜，`updated` 计数正确。
2. 同 id 同 `updatedAt` 同内容 → 无冲突。
3. 同 id 同 `updatedAt` 异内容 → 1 条冲突，默认 keep-base；给 `take-incoming` 后内容变 incoming。
4. 图片同 id 异字节 → `binary-different` 冲突。
5. 合并后再导出再导入 → 无重复实体、无 error 级问题（`/goal` 10 的原话）。
6. 合并是纯函数：同一输入两次调用结果深相等。
7. base 图片 `data` 为 NULL、incoming 包内缺图片文件 → prepare 不抛 rusqlite 类型错误；incoming 缺图不进入合并结果，apply 后不新增 NULL 行，base 的 NULL 行保留。

---

## 11. 搜索（D16）

### 11.1 为什么要自己处理中文

FlexSearch 默认按空白与标点切词，中文整句会变成一个 token，导致"搜魔理沙搜不到"。方案：**在进索引前把文本规整成"用空格分隔的检索词串"**，FlexSearch 只负责召回与打分，分词/高亮/摘要全由我们自己控制。

### 11.2 分词器

```ts
// packages/core/src/search/tokenize.ts
const CJK_RUN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff]+/gu;

export function tokenizeZh(input: string): string[] {
  const text = input.normalize('NFKC').toLowerCase();
  const out: string[] = [];
  for (const run of splitRuns(text)) {   // CJK 连续串 / 其它片段
    if (run.cjk) {
      out.push(run.value);               // 整串
      for (let i = 0; i + 1 < run.value.length; i++) {
        out.push(run.value.slice(i, i + 2));   // 二元组，解决"未登录词"
      }
    } else {
      out.push(...segmentWords(run.value));    // 拉丁/数字交给 Intl.Segmenter
    }
  }
  return [...new Set(out)];
}
export const toIndexText = (input: string) => tokenizeZh(input).join(' ');
```

- **不能只靠 `Intl.Segmenter` 切中文**：实测 `segment('雾雨魔理沙')` → `雾 / 雨 / 魔 / 理沙`，整个名字被切碎，查「魔理沙」反而命中不了。所以 CJK 连续串自己产「整串 + 全部二元组」，Segmenter 只用来切拉丁词。
- 为什么要二元组：新角色名/自造词不在词典里，"魔理沙""理沙"都能命中"雾雨魔理沙"。
- 查询串走同一个函数：Query `"魔理沙 红魔馆"` → `"魔理沙 魔理 理沙 红魔馆 红魔 魔馆"`，交给 FlexSearch 做 OR + 打分，命中越多分越高。

### 11.3 索引构建

```ts
// packages/core/src/search/build.ts
export type HitKind = 'article' | 'series' | 'author' | 'tag';

interface IndexDoc {
  rid: string;                      // 'a:'+id / 's:'+id / 'p:'+id / 't:'+id
  kind: HitKind;
  title: string;                    // 原名（用于展示）
  tokens: { title: string; summary: string; body: string; people: string; tags: string };
  virtual: string[];                // ['系列文','已完结'] —— 给 #tag 过滤
}

export async function buildSearchIndex(
  snapshot: DBSnapshot,
  opts: { content: ContentStore; onProgress?: (done: number, total: number) => void; chunk?: number },
): Promise<SearchEngine>;
```

- 索引的 5 个字段：`title`（标题）、`summary`（简介）、`body`（正文，文章专属）、`people`（作者/译者主名 + 全部别名）、`tags`（角色/情节/主题 tag 名 + 别名 + 虚拟标签中文名）。
- 每 `chunk = 200` 篇 `await new Promise(r => setTimeout(r, 0))` 让出主线程，`onProgress` 驱动"索引中 n/m"。
- 作者/标签实体也进索引（Goal 4 的筛选类别里有"作者/角色/情节"）：作者 doc 的 `tokens.people` = 全部别名，`tokens.title` = 主名；tag doc 同理。
- 内存预算：2 万篇 × 平均 6 KB 正文 ≈ 120 MB 原文，索引后约 1.5–2 倍；**不保留原文**（`body` 的 token 串用完即丢），正文靠 `ContentStore` 二次读取做高亮。

### 11.4 引擎适配层（隔离 FlexSearch）

```ts
// packages/core/src/search/engine.ts
export interface SearchEngine {
  search(query: string, opts?: SearchOptions): SearchHit[];   // 同步：FlexSearch 本身是同步的
  add(docs: readonly SearchDoc[]): void;
  remove(rids: readonly string[]): void;
  readonly size: number;
  dispose(): void;
}
export type FilterKind = 'all' | 'short' | 'series' | 'author' | 'tag-character' | 'tag-plot';
export interface SearchOptions { filter?: FilterKind; limit?: number }   // limit 默认 50
export interface SearchHit { kind: HitKind; id: string; score: number; matchedFields: string[] }
```

FlexSearch 0.8 实测（2026-10-19，写代码前先验证过）：

- `Document.add([{...}])` 数组形式**静默无效**，只能 `add({...})` 单条，且结果形状是 `[{field, result:[ids]}]`。
- `Document` 多 token 查询的 AND 语义无法关闭：`bool:'or'` / `bool:'and'` 选项实测均无效（多词仍返回 `[]`）。
- 结论：**不用 `Document`**，改为「每个字段一个 `Index`」——`new Index({ tokenize: 'strict', resolution: 9 })`，索引与查询都喂「空格分隔的 token 串」，召回、加权、过滤全部在自己的代码里做（D16 的隔离意义也更强：FlexSearch 只负责单 token 召回）。

```ts
const FIELD_NAMES = ['title', 'summary', 'body', 'people', 'tags'] as const;
const indexes = new Map(FIELD_NAMES.map((field) => [field, new Index({ tokenize: 'strict', resolution: 9 })]));
```

- `tokenize: 'strict'`：我们已经在 `toIndexText` 里切好词，不希望它再按字符拆。
- **不启用 `store`/`highlight`/`enrich`**：正文高亮必须基于原文（而不是 token 串），自己算更准且省内存。
- FlexSearch 的 API 若在小版本间漂移，只需改 `engine.ts` 一个文件。

### 11.5 查询与两段式策略

```ts
function search(query: string, opts: SearchOptions = {}): SearchHit[] {
  const parsed = parseQuery(query);                       // '#已完结 魔理沙' → {virtualTags:['v:completed'], terms:['魔理沙']}
  const explicitTags = normalizeTagNames(opts.tags ?? []); // 结果页多选标签：归一化、去重
  if (isEmptyQuery(parsed) && explicitTags.length === 0) return [];
  const tokens = queryTokens(parsed);                     // 见下：长 CJK 词拆二元组
  const requireTags = unique([...parsed.tagNames, ...explicitTags]); // 并集后 AND
  const first = run(tokens, parsed, opts, requireTags);
  if (first.length > 0 || parsed.terms.length === 0) return first;
  // 第二段：只保留二元组，放宽召回（"输入错一个字也能找到"）
  return run(bigramsOnly(tokens), parsed, opts, requireTags);
}
```

- **查询串必须与索引端用同一套切分**：索引里 CJK 串存的是「整串 + 全部二元组」，所以查询里的长 CJK 词（如 3 字的「魔理沙」）要先拆成二元组再召回；否则这个 3 字 token 在索引中根本不存在，会漏掉最该命中的名字。
- **多标签（Goal 25）**：`SearchOptions.tags` 接收结果页选中的标签名，与查询串里的 `#标签` 归一去重后取并集，再按 **AND** 过滤（`doc.tagNames` 必须包含全部标签）；只有标签、没有关键词也是合法查询。标签名含空格时无法用 `#` 语法表达，但可以通过多选传入。
- 字段权重（后处理排序用）：`title ×3`、`people ×2.2`、`tags ×2`、`summary ×1.2`、`body ×1`；同分时 `updatedAt` 新的在前。
- `parseQuery` 同时支持：`#系列文/#短篇文/#连载中/#已完结`、`#标签名`（任意 tag 名精确匹配）、普通关键词、`"精确短语"`（整串作为单 token 参与召回）。

### 11.6 高亮片段（自建）

```ts
export interface SnippetPart { text: string; highlighted: boolean }
export function buildSnippets(
  source: string,
  terms: readonly string[],
  opts?: { radius?: number; max?: number },
): SnippetPart[][]            // 外层 = 最多 max 段，内层 = 分段文本
```

算法：

1. 对 `source` 与 `terms` 都做 NFKC 归一化后的小写映射，但**只在归一化串上定位下标**，再用原串切片（保证展示原样、含全角标点）。
2. 每个 term（长度 ≥ 2 优先）在归一化串里找全部出现位置；同一 term 只取前 5 处，避免病态重复文本（如"啊"×1000）拖垮性能。
3. 每个命中扩展成窗口 `[pos - radius, pos + len + radius]`（`radius` 默认 40，按**字符**不是字节）。
4. 窗口按重叠合并（`next.start <= cur.end + 8` 视为连续，避免碎片化）。
5. 每段内部把命中区间标成 `highlighted: true`；段首尾截断处补 `…`。
6. 最多 `max = 2` 段；没有命中则返回空数组，由调用方决定显示 `summary`。
7. 正则**不用**（term 里可能有 `.*+?`），一律用 `indexOf` 循环。

### 11.7 结果页数据流（Goal 4）

1. 输入变化 → 200 ms 防抖 → `searchStore.run(query, filter, tags)`（带序号，丢弃过期响应）。
2. 引擎返回 `rid` 列表 → 从快照取实体 → 文章/系列取 `summary` 做片段源；正文片段在**详情页**才读（搜索页只对前 20 条异步读 `articles/{id}.md` 并缓存，用于"正文命中"高亮）。
3. 筛选类别映射：

| UI 标签 | `filter` | 实现 |
|---|---|---|
| 全部 | `all` | 不设 tag 过滤 |
| 短篇 | `short` | `kind='article'` + `virtual='短篇文'` |
| 系列 | `series` | `kind='series'` |
| 作者 | `author` | `kind='author'` |
| 角色 | `tag-character` | `kind='tag'` + tag 实体 `category='character'` |
| 情节 | `tag-plot` | `kind='tag'` + `category='plot'` |

4. 索引失效：快照 `revision` 变化后 500 ms 触发重建（全量但分块）；编辑单篇时可走 `remove+add` 增量，v1 不做增量、留给优化。
5. **多标签筛选（Goal 25）**：筛选按钮下方可展开标签选择器，支持按名称/别名/分类搜索；选中标签按 AND 组合，与查询串里的 `#标签` 取并集。选择写入 URL 的重复 `tag` 参数（如 `/search?q=茶会&tag=红魔馆&tag=日常`），`q` 为空时省略，便于分享/后退恢复。标签选择器默认收起，只显示前 40 个匹配项并提示总数。
6. **同系列折叠（Goal 25）**：core 的 `groupSearchItems` 只负责展示分组，不改引擎排名。同一系列命中 ≥2 篇文章时折叠为一行：组头取该系列所有命中里排名最高的一项（文章或系列实体）的位置，系列实体命中时吸收进组头，不再单独占行；组内文章保持原排名顺序。默认收起，展开后显示「第 N 篇」；只命中 1 篇或没有系列归属的文章保持原样。桌面端只调用 core 的分组函数，符合 §13.5。

### 11.8 性能预算与测试

| 场景 | 预算 |
|---|---|
| 2 000 篇建索引 | ≤ 1.5 s（Goal 4 的可感知上限） |
| 20 000 篇建索引 | ≤ 8 s，期间 UI 可交互（分块） |
| 单次查询（含排序） | ≤ 30 ms（P95） |
| 片段生成 | ≤ 5 ms / 篇 |

测试用例（Goal 4 必过）：标题命中、正文命中、摘要命中、作者**别名**命中（"同一作者的另一个名字能搜到他全部作品"）、`#已完结` 命中全部已完结系列、空查询不崩、含 `.*` 等正则元字符的查询不崩、超长查询（10 KB）不卡死。

Goal 25 追加：只有标签没有关键词可检索；两个标签必须同时满足（AND）；重复/大小写/空白归一化；标签名含空格时通过多选可命中；空查询且无标签仍返回空。系列分组只在同一系列 ≥2 篇时成组，组头位于最高排名项，系列实体被吸收，单篇与无系列条目保持原样且顺序不变。桌面纯函数测试覆盖标签选择归一化/去重、别名与分类搜索、40 条上限和展示名。

## 12. 随机与十连抽（`@tpr/core/random`）

### 12.1 目的与约束

- 纯函数、零 IO、零 DOM：输入 `DBSnapshot` + 可注入 `rng`，输出文章列表。
- 十连抽的硬约束（`/goal` 8）：**同一 `seriesId` 最多出现一篇**；无 `seriesId` 的短篇各自独立成组。
- 可重现：同一 `rng` 序列 → 同一结果，便于测试。

### 12.2 接口

```ts
// packages/core/src/random/index.ts
export type Rng = () => number;                 // 返回 [0,1)，注入 Math.random 或测试序列

/** 从全部文章（含系列内文章与独立短篇）均匀抽一篇 */
export function randomOne(snapshot: DBSnapshot, rng: Rng = Math.random): ArticleMeta | null;

export interface TenPullResult {
  picks: ArticleMeta[];      // 按抽取顺序
  depleted: boolean;         // 组数 < count
  groupCount: number;        // 可用组数
}
export function tenPull(snapshot: DBSnapshot, rng: Rng = Math.random, count = 10): TenPullResult;
```

### 12.3 算法

```
tenPull(snapshot, rng, count):
  groups = Map<string, ArticleMeta[]>            // key = seriesId ?? `a:${id}`
  for a of snapshot.articles.values():
      key = a.seriesId ?? `a:${a.id}`
      groups.get(key)?.push(a) ?? groups.set(key, [a])
  keys = [...groups.keys()]
  fisherYates(keys, rng)                          // 组级洗牌，保证"同一系列不会挤占多个名额"
  n = min(count, keys.length)
  picks = []
  for i in 0..n-1:
      pool = groups.get(keys[i])!
      picks.push(pool[floor(clamp01(rng()) * pool.length)])
  return { picks, depleted: keys.length < count, groupCount: keys.length }
```

- `fisherYates` 与 `pickIndex` 都只用注入的 `rng`，不碰 `Math.random`（默认参数也显式传下去）。
- `clamp01(x)`：`Math.min(0.999999, Math.max(0, x))`，防止注入的 `rng` 返回 `1` 造成越界。
- 空库：`randomOne` 返回 `null`（UI 显示"库是空的，先导入"）；`tenPull` 返回 `{picks: [], depleted: true, groupCount: 0}`。
- 「重新抽取」= 再调一次；不排除已抽过的（用户要的就是重抽，不是去重）。

### 12.4 测试（Goal 8）

1. 1000 次 `tenPull`，断言每次结果里不存在两篇同 `seriesId`。
2. 构造 3 组（2 系列 + 1 短篇）的库，`count=10` → `picks.length === 3`、`depleted === true`。
3. 固定 rng 序列（如 `[0, 0.5, 0.999]` 循环）→ 两次调用结果深相等。
4. 单篇文章的库 → `randomOne` 恒返回该篇；`tenPull` 返回 1 篇。
5. 超大库（2 万篇）性能：`tenPull` ≤ 20 ms。

---

## 13. UI 层（`@tpr/ui` + `apps/desktop`）

### 13.1 Tailwind v4 与 shadcn 的安家方式（D17）

**shadcn 组件住在 `packages/ui`**，因为未来移动端要复用它；`apps/desktop` 只做页面组装。

`packages/ui/components.json`

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": false,
  "tsx": true,
  "tailwind": { "config": "", "css": "src/styles.css", "baseColor": "neutral", "cssVariables": true },
  "aliases": {
    "components": "@tpr/ui/components",
    "ui": "@tpr/ui/components/ui",
    "utils": "@tpr/ui/lib/utils",
    "lib": "@tpr/ui/lib",
    "hooks": "@tpr/ui/hooks"
  },
  "iconLibrary": "lucide"
}
```

`packages/ui/tsconfig.json` 必须提供 CLI 能解析的别名：

```jsonc
{ "extends": "../../tsconfig.base.json",
  "compilerOptions": { "baseUrl": ".", "paths": { "@tpr/ui/*": ["./src/*"] } },
  "include": ["src"] }
```

添加组件（在 `packages/ui` 目录下执行）：

```bash
cd packages/ui
pnpm dlx shadcn@latest add button card input textarea tabs dialog dropdown-menu sonner
```

> 已知风险：CLI 在 monorepo 里偶尔解析不到别名。兜底方案 = 按 `ui.shadcn.com` 上的源码手工复制进 `components/ui/`（组件就是几个文件，无运行时魔法），并在 `components.json` 里保持别名不变。**不要**因为 CLI 失败就改去 app 目录建一套。

CSS 组织（Tailwind v4 CSS-first，没有 `tailwind.config.js`）：

`packages/ui/src/styles.css`（**只放主题与变量，不 import tailwind**）

```css
@custom-variant dark (&:is(.dark *));

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-primary: var(--primary);
  /* …shadcn 生成的其余 token… */
  --radius-lg: var(--radius);
}

:root {
  --background: oklch(1 0 0);
  --foreground: oklch(0.145 0 0);
  /* … */
  --radius: 0.625rem;
}
.dark { --background: oklch(0.145 0 0); /* … */ }
```

`apps/desktop/src/styles.css`（**唯一** import tailwind 的入口）

```css
@import "tailwindcss";
@import "@tpr/ui/styles.css";

/* 让 Tailwind 扫描 ui 包源码（相对本文件解析） */
@source "../../../packages/ui/src";

html, body, #root { height: 100%; }
```

要点：

- shadcn 初始化会生成一个自带 `@import "tailwindcss"` 的 `globals.css`；搬进 `ui` 包时**必须删掉那一行**，否则 tailwind 被引入两次、`@source` 行为异常。
- `@source` 是 Tailwind v4 在 monorepo 里找到 ui 包类名的**必需项**，漏了的表现是"组件样式全丢、只有基础样式"。
- 主题切换 = 在 `<html>` 上加/去 `dark` 类；三档：`light / dark / system`（`prefers-color-scheme`），存 `settings.json`。
- **配色体系（Goal 14）**：`<html data-palette="peach|bamboo|moon|scarlet|ink">` 与 `dark` 正交组合；`styles.css` 用 `[data-palette='x']` 与 `[data-palette='x'].dark` 两组 token 覆盖，声明顺序必须是「默认浅色 → 其它浅色 → `.dark` → 各配色 `.dark`」，否则同权重下暗色会被浅色覆盖。5 套配色 × 明暗 = 10 组 token，全部只改语义变量（background/surface/accent/…），组件不感知配色。
- **壁纸（Goal 14）**：`settings.wallpapers.{home,article} = { file, opacity(0.1–1), blur(0–20) }`，两槽独立；文件先经 `import_wallpaper` 复制进 `$APPDATA/wallpapers/`（asset 协议只放行 app data），渲染用一个固定层 `.tpr-wallpaper{z-index:-1}` + `::after` 半透明渐变保证正文对比度。**只在 `Layout` 渲染一份**，按 `pathname.startsWith('/article/')` 选槽；页面内再渲染第二个层会把同页静态内容压到层下（实测正文整块变暗）。
- 背景色与径向渐变画在 `html` 上、`body` 保持 `transparent`，否则 `z-index:-1` 的壁纸层会被 body 背景盖住（实测不可见）。

### 13.2 组件分层

| 层 | 位置 | 规则 |
|---|---|---|
| 原子组件 | `packages/ui/src/components/ui/*` | shadcn 原样，**不手改**；要改行为用外层包装 |
| 业务展示组件 | `packages/ui/src/components/*` | 纯 props + 回调，禁止 import `@tpr/core`，禁止访问文件/网络 |
| 工具 | `packages/ui/src/lib/{cn,format,labels}.ts` | `cn()`（clsx + tailwind-merge）、日期格式化、虚拟标签中文名 |
| 页面 | `apps/desktop/src/pages/*` | 允许调 core 服务、用路由、用 store |

`packages/ui/src/index.ts` 统一导出；`package.json` 增加样式子路径：

```json
"exports": { ".": "./src/index.ts", "./styles.css": "./src/styles.css" }
```

Goal 3 要求的拖拽组件就在这里：

```tsx
export interface DropZoneProps {
  onFile: (file: File) => void;
  accept?: string;              // 默认 ".tpr,.zip"
  disabled?: boolean;
  children?: ReactNode;
}
export function DropZone({ onFile, accept = '.tpr,.zip', disabled, children }: DropZoneProps): JSX.Element;
```

- 拖入时 `onDragOver` 必须 `preventDefault()`，否则 WebView2 会直接用文件打开页面（表现为"应用闪一下白屏"）。
- 同时提供一个"点击选择文件"的按钮（走 `dialog.open()`），拖拽在触屏/远程桌面下不总是可用。

标签相关的三个组件也在这层（Goal 13）：

| 组件 | 位置 | 职责 |
|---|---|---|
| `TagChip` / `tagChipClass` | `packages/ui/src/components/TagChip.tsx` | 纯展示芯片，按 `category` 上色（角色琥珀 / 情节翡翠 / 系列紫 / 其他灰）；**不含链接**，`@tpr/ui` 不依赖路由 |
| `TagLinks` | `apps/desktop/src/components/TagLinks.tsx` | 芯片 + `<Link to="/search?q=名称">`，超过 `limit` 折叠为可点击的 `+N`，点击展开该卡片全部标签 |
| `TagPicker` | `apps/desktop/src/components/TagPicker.tsx` | 编辑器里的标签选择器：过滤已有标签、勾选、输入新名称直接新建 |

- **`TagLinks` 含 `<Link>`，调用方不得把它放进另一个 `<Link>`/`<button>` 里**（HTML 不允许 `<a>` 套 `<a>`，React 会警告且点击行为不可预期）。列表卡片因此改成"封面链接 + 标题链接 + 标签链接"三个并列元素，而不是整卡一个 `<Link>`。`TagLinks` 现在自身还含一个展开 `<button>`，同样不得嵌进 `<a>`/`<button>`。
- `TagPicker` 的「新建」走 `editor.saveTag`：按 `category` + 归一化名称/别名判重，命中已有标签时复用其 id（返回 `created=false`），不会重复建同一个标签。

**编辑器全实体搜索（Goal 21）**：`apps/desktop/src/editor/search.ts` 是纯函数模块，`searchEditor(snapshot, rawQuery, limitPerKind = 6)` 返回 `EditorSearchResult | null`（空白查询返回 `null`，UI 据此关闭下拉）。

- 覆盖全部七类实体：文章、系列、作者、标签、图片、推荐语、鸣谢；每个 `EditorSearchHit` 带 `{ kind, id, label, detail? }`，`label` 直接给下拉显示，`detail` 放系列位置、标签类别、别名、图片类型等辅助信息。
- 匹配规则：NFKC 归一化 + 小写 + 按空白切词 + 去重，每个词都要命中（AND 子串）；标题、简介、作者名/别名、角色/情节标签名、图片 caption/id/类型、推荐语正文与推荐人、鸣谢 name/role/note 都算 haystack。
- **明确不搜正文**：正文动辄上千字，逐键扫描会卡输入框，也会让"搜索"变成全文检索；正文检索留给第 11 章的独立搜索页。
- 推荐语与鸣谢的 id 是合成 id（`${targetType}:${targetId}` 与 `credits:${index}`），因为这两类没有实体主键；`ids` 供列表面板过滤用，`totals` 是过滤前的全量计数（`limitPerKind` 只截断 `hits`，不影响 `totals`/`ids`）。
- UI 侧（`EditorPage`）：搜索框常驻在标签页上方，↑↓ 选择、Enter 打开、Esc 关闭；`onMouseDown preventDefault` 防止输入框失焦导致下拉先关。选中后切到对应标签页并定位：列表按 `visibleIds` 过滤、目标项用 `focus: { kind, id, token }` 选中并 `scrollIntoView`；标签页在搜索时忽略类别筛选（否则会出现"列表空但右侧打开"）；鸣谢是整表编辑，搜索只高亮匹配行、保存仍写全部行。
- 草稿（未保存的新建内容）不参与搜索，仍显示在左侧草稿列表；不做拼音/模糊匹配，不跨库。

### 13.3 路由（D18）

```tsx
// apps/desktop/src/router.tsx
import { createHashRouter } from 'react-router';

export const router = createHashRouter([
  { path: '/',                element: <HomePage /> },
  { path: '/articles',        element: <ArticlesPage /> },   // Goal 13：全部文章网格
  { path: '/search',          element: <SearchPage /> },
  { path: '/article/:id',     element: <ArticlePage /> },
  { path: '/series/:id',      element: <SeriesPage /> },
  { path: '/featured/short',  element: <FeaturedPage page="short" /> },
  { path: '/featured/series', element: <FeaturedPage page="series" /> },
  { path: '/favorites',       element: <FavoritesPage /> },
  { path: '/editor',          element: <EditorPage /> },
  { path: '/import',          element: <ImportPage /> },
  { path: '/merge',           element: <MergePage /> },
  { path: '/credits',         element: <CreditsPage /> },
  { path: '/settings',        element: <SettingsPage /> },
  { path: '*',                element: <NotFoundPage /> },
]);
```

- 选 hash（`#/article/a_…`）而不是 history：生产环境页面由 `tauri://localhost` 的自定义协议提供，深链与刷新对未知路径的 fallback 不可靠；hash 完全不依赖服务端。代价是 URL 里多一个 `#`，桌面应用不可见。
- 与 `/plan` 六、的差异：**新增 `/articles`**（Goal 13 的"全部文章"网格）；**不单设 `/editor/export`**，导出按钮在编辑器的文章表单与首页；其余逐行对应。
- 除 `HomePage` / `Layout` / `NotFoundPage` 外全部 `React.lazy` + `<Suspense>`（Goal 12 把入口 chunk 从 639 kB 降到 224 kB）。

### 13.4 平台注入与图片（D19）

```tsx
// apps/desktop/src/main.tsx
const platform = createTauriPlatform();          // 唯一 import @tauri-apps/* 的地方
const services = createServices(platform);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PlatformProvider value={platform}>
      <ServicesProvider value={services}>
        <RouterProvider router={router} />
      </ServicesProvider>
    </PlatformProvider>
  </StrictMode>,
);
```

- `createTauriPlatform()` 返回 `Platform`；`services = createServices(platform)` 是 core 的唯一入口（D8），**不导出全局单例**，测试里可以造第二套。
- 图片：`<img src={assets.toUrl(paths.join(snapshotRoot, image.file))} />`。桌面实现：

```ts
// apps/desktop/src/platform/tauri.ts
import { convertFileSrc } from '@tauri-apps/api/core';
assets: { kind: 'asset-protocol', toUrl: (abs) => convertFileSrc(abs) }
```

- 依赖 `tauri.conf.json` 里 `app.security.assetProtocol.enable = true` 且 `scope` 覆盖 `$APPDATA/**`（§14.3），否则 `convertFileSrc` 出来的 URL 会被拒绝加载（表现为全部图片空白）。
- 内存/浏览器实现用 `URL.createObjectURL(new Blob([bytes]))`，并在替换时 `revokeObjectURL`（`IAssetUrls` 的 `kind: 'blob'` 分支）。

### 13.5 状态管理（zustand）

| store | 内容 | 说明 |
|---|---|---|
| `useLibraryStore` | `{ status, snapshot, nodeCount }` + `openActive() / importZip(file) / reload()` | 只调 services，不算业务 |
| `useSearchStore` | `{ query, filter, hits, loading }` + `run()` | 带序号，丢弃过期响应 |
| `useUiStore` | `{ theme, sidebarOpen }` | 主题持久化到 `settings.json` |

规则：**desktop 的 store 只允许"调用 core 服务 + 存结果"**，任何计算（分组、排序、派生标签）都必须在 core（Goal 1 的"无业务逻辑"验收项靠这条守住）。

### 13.6 页面与 Goal 对应

| 路由 | Goal | 关键 UI |
|---|---|---|
| `/` | 8 | 随机一篇、十连抽按钮 + 结果网格（可点击、可重抽、不足 10 组时提示） |
| `/search` | 4 | 搜索框 + 6 个类别 tab + 结果列表（高亮片段） |
| `/article/:id` | 5 | 标题/简介/**标签（简介与正文之间）**/正文/封面/插图（含配文）/作者（可展开别名）/原出处；属系列时顶部"查看所属系列" |
| `/series/:id` | 5 | 简介、状态 tag、按序文章列表 |
| `/featured/short` `/featured/series` | 6 | 卡片 + **全部**推荐语；失效 target 显示"条目已失效" |
| `/favorites` | 7 | 文章/系列两个 tab，可取消收藏 |
| `/editor` | 9 | 实体 CRUD（短篇/系列/作者/标签/图片/推荐语/鸣谢） |
| `/editor/export` | 10 | 单篇/选中/全库导出 |
| `/merge` | 10 | 选择文件 → 预览 → 冲突裁决 → 应用 |
| `/import` | 3/11 | 拖拽 + 路径选择 + GitHub URL 下载 |
| `/credits` | 11 | 鸣谢列表 + 外链 |
| `/settings` | 11 | 默认源、主题、语言（语言占位，见 U2） |

---

## 14. Tauri 壳（`apps/desktop/src-tauri`）

### 14.1 初始化方式

不跑 `create-tauri-app`（它会生成一套独立目录结构并覆盖我们的 monorepo 布局），而是：

```bash
cd apps/desktop
pnpm add -D @tauri-apps/cli@2.12.3 @tauri-apps/api@2.12.4 \
  @tauri-apps/plugin-opener@2.7.2 @tauri-apps/plugin-dialog@2.8.3
pnpm tauri init --app-name "Touhou Peach Reader" \
  --window-title "Touhou Peach Reader" \
  --frontend-dist ../dist --dev-url http://localhost:1420 \
  --before-dev-command "pnpm dev" --before-build-command "pnpm build"
```

生成后按 14.2/14.4 覆写配置文件。

### 14.2 `tauri.conf.json`

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "Touhou Peach Reader",
  "version": "0.1.0",
  "identifier": "com.touhou.peachreader",
  "build": {
    "beforeDevCommand": "pnpm dev",
    "devUrl": "http://localhost:1420",
    "beforeBuildCommand": "pnpm build",
    "frontendDist": "../dist"
  },
  "app": {
    "windows": [
      {
        "label": "main",
        "title": "Touhou Peach Reader",
        "width": 1280,
        "height": 840,
        "minWidth": 960,
        "minHeight": 640,
        "resizable": true,
        "center": true
      }
    ],
    "security": {
      "csp": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' asset: http://asset.localhost blob: data:; font-src 'self' data:; connect-src 'self' ipc: http://ipc.localhost https://api.github.com https://github.com https://objects.githubusercontent.com https://*.githubusercontent.com",
      "assetProtocol": { "enable": true, "scope": ["$APPDATA/**"] }
    }
  },
  "bundle": {
    "active": true,
    "targets": ["nsis", "msi"],
    "icon": ["icons/32x32.png", "icons/128x128.png", "icons/icon.ico"],
    "windows": { "webviewInstallMode": { "type": "downloadBootstrapper" } }
  }
}
```

- `productName` 与窗口 `title` 都写死 `Touhou Peach Reader` —— Goal 1 的验收就是窗口标题，两个地方都要对。
- `identifier` 决定 `$APPDATA` 的实际路径：`%APPDATA%\com.touhou.peachreader`（Windows）/ `~/Library/Application Support/com.touhou.peachreader`（macOS）。`@tpr/platform` 里的 `dataDir` 由它推导，**不要**在别处硬编码。
- `assetProtocol.scope` 必须是 `$APPDATA/**`；写窄了图片全白，写宽了（如 `**`）等于把整个磁盘暴露给页面。
- CSP 里 `connect-src` 必须含 GitHub 相关域：`api.github.com`（API）、`github.com`（release 重定向）、`objects.githubusercontent.com` / `release-assets.githubusercontent.com` / `*.githubusercontent.com`（实际资产下载）。实现时最初漏了资产域，真机下载会在重定向处被 CSP 拦下——已补进 `tauri.conf.json`。**`style-src` 的 `'unsafe-inline'` 不能省**：Tailwind v4 与 React 内联 style 依赖它。

### 14.3 Capabilities（最小权限）

`src-tauri/capabilities/default.json`

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "主窗口最小权限：外链、文件选择、自研 fs/zip 命令",
  "windows": ["main"],
  "permissions": [
    "core:default",
    {
      "identifier": "opener:allow-open-url",
      "allow": [{ "url": "https://*" }, { "url": "http://*" }]
    },
    "dialog:allow-open",
    "dialog:allow-save",
    "dialog:allow-message",
    "dialog:allow-ask"
  ]
}
```

- **`opener:allow-open-url` 必须带 scope**：只写权限标识、不写 `allow` 列表时，`openUrl()` 会以裸字符串 `Not allowed to open url …` 拒绝（Goal 5 实测踩过）。scope 只放 `http/https`，与 §5.5 的 TS 侧白名单同口径。
- **不使用 `tauri-plugin-fs`**（虽有 2.7.1 可用）：文件读写全部走自研 `#[tauri::command]`，在 Rust 侧统一做"必须位于 app data 目录内"的校验。理由：plugin-fs 的 scope 表达式与自定义命令混用会让"到底谁能读哪里"变成两套规则；自研命令只有一个入口，安全边界可审计。
- 自定义命令无需在 capabilities 里授权（非插件命令不受 ACL 管辖），但仍受窗口 label 与 IPC 限制保护。若后续要收紧，可在命令内校验 `webview.label() === "main"`。
- `opener:allow-open-url` 是插件权限；`openUrl` 之前仍在 TS 层做 `http(s)` 白名单（§5.5）。

### 14.4 Rust 侧实现

`Cargo.toml`

```toml
[package]
name = "touhou-peach-reader"
version = "0.1.0"
edition = "2021"
rust-version = "1.85"

[lib]
name = "touhou_peach_reader_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = ["protocol-asset"] }
tauri-plugin-opener = "2"
tauri-plugin-dialog = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
zip = { version = "9", default-features = false, features = ["deflate"] }
walkdir = "2"
```

`src/lib.rs`（骨架，完整实现按 §5.2 接口逐一对应）

```rust
use std::path::{Path, PathBuf};

fn ensure_within(root: &Path, candidate: &Path) -> Result<PathBuf, String> {
    let root = root.canonicalize().map_err(|e| format!("EIO: {e}"))?;
    let cand = candidate.canonicalize().map_err(|e| format!("ENOENT: {e}"))?;
    if !cand.starts_with(&root) { return Err("EACCES: path outside app data".into()); }
    Ok(cand)
}

#[tauri::command]
async fn zip_extract_all(app: tauri::AppHandle, zip_path: String, dest_dir: String)
    -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || crate::zip::extract_all(&zip_path, &dest_dir))
        .await.map_err(|e| format!("EIO: {e}"))?
}
```

实现要点（照做即可，无需再设计）：

| 命令 | 对应接口 | 要点 |
|---|---|---|
| `fs_read_text` / `fs_write_text` | `IFileSystem.readText/writeText` | 写入先落 `*.tmp` 再 `rename` |
| `fs_read_bytes` / `fs_write_bytes` | `readBytes/writeBytes` | 仅用于 ≤ 8 MB 的小文件（图片哈希、上传落盘）；返回 `Vec<u8>` |
| `fs_exists` / `fs_stat` / `fs_list_dir` / `fs_mkdir` / `fs_remove` / `fs_rename` / `fs_copy` | 同名方法 | 全部先过 `ensure_within(&app_data_dir, path)` |
| `zip_extract_all` | `IZip.extractAll` | 用 `zip` crate 逐条流式复制（64 KB 缓冲）；拒 symlink、拒 `..`、限额（§5.5）；返回 `{entries, bytes, rejected}` |
| `zip_create_from_dir` | `IZip.createFromDir` | `walkdir` 遍历 + `ZipWriter` DEFLATE；`manifest.json` 最后写；用于浏览器/测试的字节导出 |
| `zip_create_from_dir_to` | `IZip.createFromDirTo` / `exportDatabaseToPath` | **写 app data 之外**：源目录必须在 app data 内，目标来自系统保存对话框；校验绝对路径、`.tpr` 后缀、父目录存在；同目录写 `*.partial`，成功后 `rename` 覆盖，失败删 partial、保留旧目标 |
| `stage_import` | `apps/desktop/src/platform/files.ts` 的 `stageTprFile` | **读 app data 之外**（Goal 18）：拖入 / 对话框选中的 `.tpr` 先复制到 `imports/staged-{ms}-{safe}.tpr`，后续解压与合并只碰 app data 内的路径；校验绝对路径、`.tpr` 后缀、常规文件、≤1 GB |
| `app_info` | `apps/desktop/src/platform/app-info.ts` | 只读：返回 `{version, exePath, dataDir}`。`version` 取 `app.package_info()`（与 `tauri.conf.json` / `Cargo.toml` 同源）（Goal 19） |
| `install_info` | `apps/desktop/src/platform/app-info.ts` | 只读：查 `HKCU\…\Uninstall\Touhou Peach Reader` 的 `InstallLocation` / `DisplayVersion`，返回 `{location, version}` 或 `null`；用于判断当前 exe 是安装版还是免安装版（Goal 20） |
| `import_wallpaper` | `IWallpaperStore.importFile` | 壁纸源在 app data 之外（用户任意目录），读入后复制到 `$APPDATA/wallpapers/wp-{epoch_ms}.{ext}`；校验绝对路径、扩展名白名单、≤20 MB、magic bytes（PNG/JPEG/WebP）；返回 `{fileName, bytes}` |
| `http_*` | — | **不实现**：网络走 JS `fetch`（见 14.5），避免把 reqwest/TLS 拖进首次编译 |

- 除 `zip_*` 外，其余命令都在 `spawn_blocking` 里跑，避免阻塞 async runtime。
- 外部路径的例外只有三条：`zip_create_from_dir_to`（把导出包写到用户选的位置）、`import_wallpaper`（读用户选的壁纸）、`stage_import`（把拖入/选中的 `.tpr` 复制进 app data）。三者都只服务"用户在对话框/拖拽里明确指定的单个文件"，并各自校验后缀、绝对路径与大小上限。旧 `save_export` 已删除，避免出现"ZIP 字节先回传 JS 再写盘"的第二条路径。
- zip 9 的 API 细节（实测）：`entry.name()` 返回 `Result<Cow<str>, ZipError>`；`ZipFile<'_, R>` 带泛型参数，辅助函数要写成 `fn is_symlink<R: Read + ?Sized>(f: &ZipFile<'_, R>)`。
- 错误统一 `Err("ECODE: 可读信息")` 字符串，TS 侧用一个 `mapNativeError()` 转成 `PlatformError`（§5.3）。改错误文案不会破坏分类，因为分类只看 `ECODE` 前缀。

### 14.5 网络为什么不进 Rust

`INetwork` 在 `apps/desktop/src/platform/network.ts` 用标准 `fetch` + `ReadableStream` 实现：

- GitHub API 与 release 资产都允许跨域；CSP 已放行相应域。
- 下载进度来自 `Content-Length` 与流式读取，无需额外依赖。
- 代价：首次编译不引入 reqwest/openssl/rustls，cargo build 时间显著更短。
- 触发回退的信号：GitHub 改 CORS、或大文件下载在 WebView2 里频繁中断 → 此时再加一个 `download_to_file` Rust 命令（用 `ureq` 而非 reqwest，同步且轻量），接口不变。

### 14.6 开发与构建

```bash
pnpm dev          # = tauri dev：先起 Vite(1420)，再起 Rust 窗口
pnpm build:web    # 只构建前端，验证前端本身能过
pnpm build        # = tauri build：产出安装包
```

| 场景 | 预期 |
|---|---|
| 首次 `pnpm dev` | 首次 cargo 编译 5–15 分钟（D 盘），之后增量 < 10 s |
| 前端热更 | 改 `packages/ui` 或 `apps/desktop` 即时 HMR |
| Rust 改动 | 自动重编译 + 重启窗口 |
| 产物 | `src-tauri/target/release/bundle/nsis/*-setup.exe`、`.../msi/*.msi` |
| 体积 | 安装包 ~3–6 MB（WebView2 走系统运行时） |

### 14.7 非 Windows 说明（对齐 U1）

`tauri.conf.json` 里的 `bundle.targets` 在 macOS 需换成 `["app", "dmg"]`，并补签名/公证；本设计不做，Goal 12 只交付 Windows 产物 + macOS 的构建步骤说明。

---

## 15. 测试与验收矩阵（D21 / D22）

### 15.1 测试基建

| 项 | 规定 |
|---|---|
| 框架 | `vitest@5.0.5`（Node 环境；core/schema 不需要 jsdom） |
| 位置 | 与包内 `src/` 同级的 `test/`；文件 `*.test.ts` |
| fixture | `@tpr/schema/src/testing/factory.ts` 提供 `makeAuthor/makeTag/makeArticle/makeSeries/makeImage/makeFeatured/makeCredits/makeDatabase`，参数可覆盖 |
| 随机 | 注入 `rng`（`makeSeqRng([0.1,0.5,0.9])`），禁止测试里依赖 `Math.random` |
| 时间 | 注入 `now`（默认 `() => new Date()`），避免"今天"导致的断言漂移 |
| 文件系统 | `@tpr/platform/memory` 的 `InMemoryFS`；ZIP 用 fflate 实现 |
| 运行 | `pnpm -r test`（每包独立 `vitest run`，不共享全局状态） |
| 门槛 | 每个 Goal 完成时：`pnpm typecheck && pnpm test && pnpm check:boundaries` 全绿 |

最小 fixture 示例（Goal 2 用它跑通校验）：

```ts
export function makeDatabase(over?: Partial<RawDatabase>): RawDatabase {
  const author = makeAuthor({ canonicalName: '示例作者' });
  const tag = makeTag({ category: 'character', name: '雾雨魔理沙' });
  const series = makeSeries({ title: '示例系列', status: 'completed' });
  const a1 = makeArticle({ type: 'series-entry', seriesId: series.id, authorIds: [author.id], characterTagIds: [tag.id] });
  const a2 = makeArticle({ type: 'series-entry', seriesId: series.id });
  return { /* manifest + authors/tags/series/articles + 配对 md */ ...over };
}
```

### 15.2 逐 Goal 验收

> 每条都写明：**自动化命令**（能跑就必须跑）+ **人工确认**（UI 观感/交互，无法自动化）。

| Goal | 自动化验收 | 人工确认 |
|---|---|---|
| **1** 骨架 | `pnpm check:boundaries`、`pnpm -r typecheck`、`pnpm --filter @tpr/core test -- -t getVersion`、`pnpm build:web` | `pnpm dev` 出窗口，标题为 `Touhou Peach Reader`；页面显示 core 的 `getVersion()` 值 |
| **2** 模型 | `pnpm --filter @tpr/schema test`（类型/schema 生成/校验码/迁移链 4 组） | 无 |
| **3** 导入导出 | `pnpm --filter @tpr/core test -- -t import`（含 round-trip：导出→导入→逐字段深比较）、`pnpm --filter @tpr/core test -- -t zip-slip` | 拖 `.tpr` 到窗口能导入；重启应用后数据还在；导出文件重新导入无差异 |
| **4** 搜索 | `pnpm --filter @tpr/core test -- -t search`（标题/正文/简介/别名/`#已完结`/空查/元字符/超长 8 组） | 输入即出结果（200 ms 防抖）；点结果跳详情；筛类别正确 |
| **5** 详情页 | `pnpm --filter @tpr/core test -- -t series-order`、`pnpm --filter @tpr/ui test`（若有组件测试） | 文章页字段齐全、插图配文显示、别名可展开、系列跳转可用、原出处打开系统浏览器、标签位于简介与正文之间且页尾无重复 |
| **6** 精选 | `pnpm --filter @tpr/core test -- -t featured`（多条推荐语全渲染、失效 target 降级） | 两个精选页的推荐语全部显示；删掉目标后显示"条目已失效"不白屏 |
| **7** 收藏 | `pnpm --filter @tpr/core test -- -t favorites`（持久化、失效标记） | 收藏→重启仍在；两 tab；取消收藏即时生效 |
| **8** 随机 | `pnpm --filter @tpr/core test -- -t random`（5 组用例，见 §12.4） | 十连抽网格、可点、可重抽、不足 10 组有提示 |
| **9** 编辑器 | `pnpm --filter @tpr/core test -- -t edit`（CRUD 纯函数、别名不误判、图片 kind/caption） | 各类实体建/改/删后重启仍存在；图片能选能显；鸣谢可排序 |
| **10** 导出合并 | `pnpm --filter @tpr/core test -- -t merge`（7 组用例，见 §10.6）、`pnpm --filter @tpr/core test -- -t export`（B1–B7 各一条） | 合并页三步流程；冲突逐条可切换；应用后无重复实体 |
| **11** GitHub | `pnpm --filter @tpr/core test -- -t github-url`（URL→API 解析，纯函数） | 输入 release URL 能下载并导入；设置页能检查更新；鸣谢外链可点 |
| **12** 打包 | `node scripts/check-no-tauri.mjs`（core/ui/schema 中 0 命中）、`pnpm build` 成功 | 安装包双击能起、能导入示例库；`packages/platform/docs/mobile-adaptation.md` 存在且覆盖接口清单 |

### 15.3 `scripts/check-no-tauri.mjs`（Goal 12 的 grep 验收）

```js
// 扫描 packages/{core,ui,schema}/src/**/*.{ts,tsx}
const FORBIDDEN = [/@tauri-apps\//, /window\.__TAURI__/, /\bconvertFileSrc\b/, /\binvoke\(/];
// 命中即打印 file:line 并 exit 1
```

`check-boundaries.mjs` 与它共享同一套 walk 逻辑，但规则不同（前者管包间依赖，后者管 Tauri 泄漏）。

---

## 16. 风险登记表

| # | 风险 | 概率 | 影响 | 对策 | 触发信号 |
|---|---|---|---|---|---|
| R1 | TypeScript 7.0.2 与某些工具（vite/vitest 插件）不兼容 | 中 | 构建失败 | 版本回退到 `5.9.3`（唯一允许的回退，§2.3） | `tsc` 报未知选项或插件 peer 冲突 |
| R2 | shadcn CLI 在 pnpm monorepo 里解析别名失败 | 中 | 组件装不进去 | 手工复制组件源码进 `components/ui/`（§13.1） | CLI 报 "no components.json" / 写到错误目录 |
| R3 | 首次 `cargo build` 耗时超预期（5–15 min） | 高 | 开发节奏被打断 | 明确预算；先把 `pnpm dev:web` 跑通再等编译；不频繁 `cargo clean` | 超过 20 min 仍在编译 |
| R4 | `raw.githubusercontent.com` 被重置 | 已发生 | 无法用 raw 链接下载 | 一律 `api.github.com`；下载走 `browser_download_url`；直连 | 连接重置 / 超时 |
| R5 | 2 GB 图库解压/打包爆内存 | 中 | 应用崩溃 | 桌面端 Rust 流式（64 KB 缓冲）；限额 8 GB/512 MB | 内存 > 1 GB |
| R6 | 中文、空格、超长路径（工作目录本身含空格） | 高 | 文件读写失败 | 全程 `paths.join()`；用例覆盖含空格/中文/长名；单路径 ≤ 240 字符 | `ENOENT` 且路径看着"没错" |
| R7 | Windows 文件被占用导致 rename 失败 | 中 | 导入/保存失败 | 暂存 + 换名 + 指数退避 5 次；失败提示关闭占用程序 | `EPERM`/`EACCES` on rename |
| R8 | FlexSearch 0.8 API 与文档漂移 | 中 | 搜索挂掉 | 适配层 `engine.ts` 单点隔离（§11.4） | 类型报错 / 运行时报 `doc.search is not a function` |
| R9 | `Intl.Segmenter` 在某些 WebView2 版本缺失 | 低 | 中文分词退化 | 已有 `fallbackSplit` 分支（§11.2）；测试强制走 fallback 也能过 | `typeof Intl.Segmenter === 'undefined'` |
| R10 | GitHub CORS / 重定向阻断下载 | 中 | Goal 11 卡住 | CSP 已白名单；回退方案 = 加 `download_to_file` Rust 命令（§14.5） | 浏览器控制台 CORS 错误 |
| R11 | 虚拟标签与物理 tag 混淆 | 中 | 数据污染（`v:` 被写进 tags.json） | `v:` 前缀隔离 + 导入丢弃并告警 + 校验码 `W_VIRTUAL_TAG_IN_FILE` | tags.json 里出现 `v:` 开头 id |
| R12 | 合并时的字段级误合并预期 | 低 | 数据不可预期 | 明确"整条实体取舍、不做字段级合并"（§10.2），UI 展示差异字段但不逐字段选 | 用户反馈"合并后标题和简介对不上" |

---

## 17. 与 `TohoPR_plan.md` 的差异清单

### 17.1 方向性差异（4 处，需要用户知情）

| # | `/plan` 原文 | 本设计 | 理由 |
|---|---|---|---|
| 1 | React **18** + Vite（未指定） | React **19.3.1** + Vite **8.3.4** | 新项目没有历史包袱；19 是当前稳定线；Vite 8 是 React 19 插件的主线版本 |
| 2 | 本地存储 **SQLite**（`tauri-plugin-sql`） | **单文件 SQLite**（自研 rusqlite 命令，不用插件） | ① 正文与图片都是大对象，插件经 JSON 往返会把整张图读进 JS 内存，自研命令可以用 BLOB 流式写文件；② 单库 225 MB 图片用 SQLite 单文件便于备份/替换；③ `.tpr` 仍是 JSON+Markdown+图片的交换格式，导入导出逻辑不变；④ 旧 JSON workspace 自动迁移并保留 `legacy/` 备份 |
| 3 | `content: string \| { file: string }` | 落盘**恒为** `{ file }`（导入时接受 string 并归一化） | 双形态会让"导出后逐字段相等"的 round-trip 断言变得含混；统一后格式只有一种 |
| 4 | 标签/作者 **无 ID 规则** | 确定性 ID（`p_`/`t_` + sha256 前缀） | `/plan` 三、要求"按 id 归并"，但没定义 id 从哪来；不解决这个就无法合并 |
| 5 | 四、目录树**没有图片元数据文件** | 新增 `images.json`（裸数组） | `ImageAsset` 有 `caption`/`kind`，而 `images/cover/{id}.ext` 只存字节；不给元数据一个落点，`.tpr` 就无法逐字段 round-trip |

### 17.2 一致性差异（3 处，实现细节，不改变架构）

| # | `/plan` | 本设计 | 说明 |
|---|---|---|---|
| 6 | 搜索用 FlexSearch 的 highlight | 自建 `buildSnippets` | FlexSearch 的高亮基于 token 串，中文切词后原文位置对不上；自建才能保证片段来自原文 |
| 7 | 路由未指定模式 | `createHashRouter` | `tauri://localhost` 下深链/刷新的 fallback 不可靠 |
| 8 | 图片显示方式未指定 | 本地库图片走 `IAssetUrls.imageUrl()`，其余经 `IAssetUrls.toUrl()` | 本地图片字节在 SQLite BLOB 里，用自定义 `peach` 协议按数据库/图片 id 读取；内存平台回退到文件 URL。UI 层仍零 Tauri 依赖 |

### 17.3 保持不变的部分

- 8 个实体字段**未增未删**（`Article`/`Series`/`Tag`/`Author`/`ImageAsset`/`FeaturedEntry`/`CreditsEntry`/`Manifest` 全部照抄）；唯一增补是 Goal 16 给 `Series` 加的**可选** `translatorIds`（§6.1 末尾，加法变更、不升 schema 版本）。
- 数据模型语义（虚拟 tag 不落库、`articleIds` 有序、推荐语可多条）完全照抄。
- `.tpr` 的目录骨架与 `/plan` 四、一致（仅补充了 `other/` 图片目录与 `articles/*.md` 的显式位置）。
- 12 个 Goal 的验收口径未降低，只补了自动化手段。

---

## 18. Goal 1 实施清单（照做即可）

> 目标：**空仓库 → 双击出窗口，显示 `Touhou Peach Reader` 与 core 的 `getVersion()`**。
> 预计 1 个工作日（其中 10–15 分钟是等 cargo 编译）。

| 步骤 | 命令 / 动作 | 预期 |
|---|---|---|
| 1 | 安装 Rust：`rustup-init.exe -y --profile minimal --default-toolchain stable-x86_64-pc-windows-msvc`（§1.2） | `rustc -V` / `cargo -V` 有输出 |
| 2 | `corepack enable && corepack prepare pnpm@12.14.0 --activate` | `pnpm -v` → 12.14.0 |
| 3 | `git init` + 写 `.gitignore`（`node_modules/`、`dist/`、`src-tauri/target/`、`*.tmp`、`.dirty`、`pnpm-debug.log`） | `git status` 只看到源码 |
| 4 | 根 `package.json`（`private`、`packageManager`、§3.3 脚本）+ `pnpm-workspace.yaml`（`packages: ['packages/*','apps/*']`）+ `tsconfig.base.json` + `biome.json` + `.npmrc`（`shamefully-hoist=false`、`node-linker=isolated`） | `pnpm install` 成功 |
| 5 | 建 4 个包骨架（§4.1 的 `exports` 源码直连）+ `@tpr/schema` 里先放 §6.1 的类型与 fixture 工厂 | `pnpm -r typecheck` 绿 |
| 6 | `@tpr/platform`：§5.2 的 6 个接口 + `PlatformError` + `@tpr/platform/memory`（InMemoryFS/fflate zip/mock network） | `pnpm --filter @tpr/platform typecheck` 绿 |
| 7 | `@tpr/core`：`createServices(platform)` 骨架 + `getVersion()`（读根 `package.json` 的 `version` 或常量 `0.1.0`）+ 空实现的服务方法 | `pnpm --filter @tpr/core test` 绿（一个用例：`getVersion()` 返回非空字符串） |
| 8 | `apps/desktop`：`index.html` + Vite 配置（§4.3）+ `main.tsx`/`App.tsx` + §13.1 的 styles.css + §13.4 的注入 + `src/platform/tauri.ts`（6 个接口的 Tauri 实现，先给桩：`zip`/`fs` 抛 `PlatformError('EIO','未实现')` 也可，但接口必须齐） | `pnpm dev:web` 能在浏览器显示标题与版本 |
| 9 | `pnpm tauri init`（§14.1）+ 覆写 `tauri.conf.json`（§14.2）+ `capabilities/default.json`（§14.3）+ `Cargo.toml`（§14.4）+ `lib.rs` 最小命令集 | — |
| 10 | `cd apps/desktop && pnpm tauri dev` | 桌面窗口出现，标题 `Touhou Peach Reader`，页面显示版本号；**首次编译 5–15 分钟** |
| 11 | 收尾：`scripts/check-boundaries.mjs` + 根 `pnpm check` 全绿；`git add -A && git commit -m "chore: bootstrap monorepo (Goal 1)"`；`rust-toolchain.toml` 钉住实测版本 | Goal 1 验收全部满足 |

**Goal 1 完成即验证**：

```bash
pnpm check              # typecheck + test + boundaries
pnpm build:web          # 前端可构建
pnpm --filter @tpr/desktop tauri build --debug   # 可选：确认 Rust 侧可打包
```

### 18.1 实施记录（2026-10-19，Goal 1 实际执行）

| 计划步骤 | 实际发生 | 处置 |
|---|---|---|
| 1 安装 Rust | `rustup-init.exe -y --profile minimal --default-toolchain stable-x86_64-pc-windows-msvc --no-modify-path` → **rustc/cargo 1.99.1**（2026-10-13） | `rust-toolchain.toml` 钉住 `1.99.1`；因 `--no-modify-path`，构建时显式 `export PATH="$HOME/.cargo/bin:$PATH"` |
| 2 `corepack enable` | `EPERM`（`D:\nodejs` 不可写） | 全部脚本改用 `corepack pnpm ...`（§2.3-6） |
| 4 根配置 | TS 7 移除 `baseUrl`，首次 `typecheck` 报 `TS5102` | 删掉各包 `baseUrl`/`paths`，靠 `workspace:` 链接 + `exports` 解析（§2.3-5） |
| 9 `tauri init` | 手写配置；首次 `cargo build` 报 "`protocol-asset` feature 缺失" | `tauri = { version = "2", features = ["protocol-asset"] }`（`assetProtocol.enable: true` 的硬要求） |
| 其余 | 照计划 | typecheck 5 包全绿、单测 34 个全绿、`build:web` 154 ms、边界检查全绿 |

Goal 2–3 追加记录（同日完成）：

- **`images.json` 是 `/plan` 目录树漏掉的集合**：`ImageAsset` 的 `caption`/`kind` 需要地方存放，`tpr` 里必须有 `images.json`（§7.2）。
- **`.tpr` 没有 `series.json`**：系列只有 `series/{id}.json`，`readDatabaseDir` 首版误读了根级 `series.json`，已删。
- **core 不依赖 zod**：`read.ts` 用结构化的 `SchemaLike<T>` 接 schema 包，保持 core 只依赖 `@tpr/platform` + `@tpr/schema` 的类型层。
- **zip 9 API 与旧版不同**（见 §14.4 注），两个编译错误按注中写法修复。
- **桌面端 E2E 自动化**：`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222` 启动 `tauri dev`，用 CDP `Runtime.evaluate` 在页面里合成 `drop` 事件（把夹具 `.tpr` 塞进 `DataTransfer`）→ 真实走通 `importBytes` → Rust `zip_extract_all` + `fs_*` → 落盘；随后 `Page.reload` 验证 `restore()` 从磁盘读回，`library.export({all:true})` 产出 2983 字节 ZIP 并 `save_export` 到 %TEMP%。夹具由 `packages/platform/scripts/make-fixture.mjs` 生成。
- 结论：**Goal 3 的导入/导出/持久化在真实 Tauri 壳里跑通**，不再是内存桩。

Goal 4 追加记录：

- **FlexSearch 0.8 的 `Document` 不能按原计划用**：数组 `add` 静默无效、多 token 查询的 AND 语义关不掉（`bool` 选项实测无效）。最终落地为「每字段一个 `Index`」+ 自己加权/过滤，见 §11.4 实测记录。
- **`Intl.Segmenter` 不能切中文人名**：`雾雨魔理沙` → `雾/雨/魔/理沙`，因此 `tokenizeZh` 改为「CJK 连续串 → 整串 + 全部二元组，拉丁串才交给 Segmenter」，见 §11.2。
- **查询端必须做同样的长词拆分**：索引里没有 3 字以上的 CJK token，查询「魔理沙」要先拆成「魔理/理沙」才能召回（§11.5）。
- **路由开始落地**：本 Goal 引入 `react-router` 8 的 `createHashRouter`，`/`（库概览，Goal 8 会换成随机页）与 `/search`；`/article/:id`、`/series/:id` 等留给 Goal 5。
- 真机验收：CDP 驱动真实 Tauri 窗口，导入夹具后搜 `Example`（作者别名）、`#连载中`、`博丽灵梦`（角色），6 个类别筛选与空结果态全部通过，截图 `.tmp/goal4-search.png`。

Goal 5 追加记录：

- **`opener:allow-open-url` 必须写 scope**：Tauri 2 的 opener 插件只给权限标识、不给 `allow` 列表时，`openUrl` 抛的是裸字符串 `Not allowed to open url …`（不是 `Error`），被包成 `PlatformError('EACCES')` 后在页面上显示为横幅。scope 定为 `https://*` / `http://*`，见 §14.3。
- **`plugin-opener` 的异常不是 Error 实例**：`mapNativeError` 原样吃 `string` 即可；不要写 `catch (e) { e.message }`，否则页面上只剩 `undefined`。
- **正文渲染不引入 Markdown 依赖**：`@tpr/ui` 里 180 行的 `Markdown` 组件（标题/段落/列表/引用/代码/规则线 + 行内 code/bold/italic/link），不用 `dangerouslySetInnerHTML`，链接统一交给 `IOpener`，避免 WebView 被页面内导航带走。
- **详情页不额外读库**：`getArticleView` / `getSeriesView` 是 `DBSnapshot` 上的纯函数（§10.3），正文才走 `Library.readContent`；系列目录严格按 `series.articleIds` 顺序，缺 id 跳过。
- 夹具升级：`packages/platform/scripts/make-fixture.mjs` 现在生成 3 篇文章（短篇 + 系列两篇，`articleIds` 故意倒序）并带 `sourceUrl`，用来同时验证"排序"和"原出处"。真机 17 项断言全过，截图 `.tmp/goal5-article.png` / `.tmp/goal5-series.png`。

Goal 6 追加记录：

- **精选卡片是纯函数**：`getFeaturedCards(snapshot, opts, 'short' | 'series')` 只读 `snapshot.featured`，把目标解析成 `FeaturedCard`；目标缺失时保留卡片、`status: 'missing'` 并给出中文 `reason`，页面单独渲染「条目已失效（N）」区块，不白屏也不丢推荐语。
- **精选按目标类型分页**：短篇页只收 `targetType === 'article'`，系列页只收 `'series'`；系列条目（`type === 'series-entry'`）出现在短篇页时提示"请到精选系列中查看"，但仍给 `to` 允许用户点进去。
- **`resolveImageRef` 从 `view.ts` 导出**：精选与详情页共用同一套图片绝对路径解析（`join(dir, image.file)`），避免两处各写一遍。
- 夹具的 `featured.json` 扩到 3 条（短篇 2 条推荐语含署名、系列 1 条、故意指向不存在文章的 1 条），`counts.featured = 3`；封面改成脚本内生成的合法 160×224 纯色 PNG（`node:zlib` 手写 IHDR/IDAT/IEND），用来验证 `asset:` 协议真能加载。
- 真机 11 项断言全过（导入、短篇页全部推荐语与推荐人、失效降级、卡片跳转、系列页过滤与推荐人、进入系列详情），截图 `.tmp/goal6-short.png` / `.tmp/goal6-series.png`。
- 教训：CDP 里直接调 `window.__tpr.library.importBytes` 不会刷新 `LibraryProvider` 的 snapshot，验证 UI 前必须 `Page.reload` 让 Provider 从磁盘 `restore()`。

Goal 7 追加记录：

- **收藏是用户态、可丢的数据**：存 `user/{databaseId}.json` 的 `favorites.articles` / `favorites.series`（新收藏 `unshift` 到最前，即最近收藏在最上），不写进数据库包、不参与导出；`createFavorites(platform, () => library.current()?.databaseId ?? null)` 在没有当前库时静默不写盘。
- **失效选择"标记"而不是"清理"**：`Favorites.list(snapshot)` 只做解析，目标不在 `maps` 里就 `stale: true`、`to: null`，UI 显示灰色「已失效」+「目标已从当前数据库中删除，可移出收藏夹」，id 仍留在文件里——数据库被重新导入后目标可能回来，清理就不可逆了。
- **读写都要 `ensureLoaded()`**：按 `databaseId` 懒加载、只读一次；`toggle/remove` 前先确保已读盘，避免"启动瞬间点收藏"把文件覆盖成空。
- 桌面端：`FavoritesProvider` 挂在 `LibraryProvider` 内（`main.tsx` 顺序 ServicesProvider → LibraryProvider → FavoritesProvider → RouterProvider），详情页 `FavoriteButton` 用 `aria-pressed` + ★/☆，收藏页两个 tab 各自显示计数，取消收藏即时生效。
- 真机 9 项断言全过（按钮状态、收藏落盘、重载后仍在、取消后清空、系列 tab、失效标记不白屏），并**真实重启 `tauri dev` 进程**后确认收藏仍在（截图 `.tmp/goal7-favorites.png`）。
- 教训：CDP 里直接改 `user/*.json` 后必须 `Page.reload`，Provider 只在挂载/换库时读盘。

Goal 8 追加记录：

- **分组键 = `seriesId ?? "a:" + id`**：十连抽先按组洗牌再在组内抽一篇，天然满足"同一系列最多出现一篇"；组数不足 `count` 时返回全部组并置 `depleted`，UI 显示「池子里只有 N 组，本次抽到 M 篇」。
- `randomOne` / `tenPull` 全部只吃注入的 `rng`（默认参数显式传 `Math.random`），`clamp01` 防止外部 rng 返回 1 造成越界；2 万篇库 `tenPull` < 20ms（单测守护）。
- 首页新增「随便看看」区块：`随机一篇` 直接 `navigate('/article/' + id)`；`十连抽` 渲染 2/3/5 列卡片网格（封面 5:7、标题、系列名或"短篇"），提供「重新抽取」，不排除已抽过的。
- 夹具只有 1 个系列（2 篇）+ 1 个短篇 → 十连抽得 2 组，正好覆盖"组数不足"分支；真机 7 项断言全过（按钮、组数提示、卡片网格、系列不重复、重抽、卡片跳转、随机跳转），截图 `.tmp/goal8-home.png`。

Goal 9 追加记录：

- **写入路径**：编辑器全部走 `library.applyEdit(build)` —— `structuredClone(current.db)` → 改草稿 → `computeCounts` → `validateDatabase`（有 error 直接抛 `CODE: message`，不落盘）→ 补空正文（`ContentStore.write(id, '')`）→ `saveDatabase(platform, dir, previous, next)` 单事务差异落盘 → 内存替换 + `revision += 1`；所有写入走 `writeQueue` 串行（design §9.2）。正文由 `ContentStore` 按 id UPSERT 到 `article_contents`，图片字节由 `writeImageBlob` 写 `images.data` BLOB；不再有 `.dirty` / `writeDatabaseDir`（SQLite 化前的旧路径已删除）。
- **SQLite 化后 `filePaths` 不再是落盘依据**：`persist` 在 `validateDatabase` 前删掉从 SQLite 读出的虚拟 `filePaths`，否则新增正文/图片会被误报 `E_CONTENT_MISSING` / `E_IMAGE_FILE_MISSING`——校验只在 `.tpr` 导入/导出时才需要真实文件集合。
- **作者别名复用**：`saveAuthor` 无 id 时按 `normalizeName` 在 canonicalName 与 aliases 里查重，命中就复用原 id，不新建（/goal 9 明确要求）；标签同理，但查重限定在同一 `category` 内。
- **图片**：`saveImage` 用 `writeImageBlob` 把字节写进 `images.data` BLOB；`updateImage` 只改元数据里的 `file`/kind；`deleteImage` 级联清掉引用它的 `coverImageId` / `illustrationImageIds`，该图片行与 BLOB 由差异事务删除。
- **系列双向同步**：`saveSeries` 把 `articleIds` 里的文章改成 `series-entry` 并写 `seriesId`，被移出的文章降级为 `short` 并删 `seriesId`；`deleteSeries` 一律降级。
- 桌面端 `/editor` 七个 tab（文章/系列/作者/标签/图片/推荐语/鸣谢）：文章与系列是"列表 + 表单"两栏，正文按需读取（编辑元数据不覆盖正文），标签/作者用复选网格，图片用文件上传 + 逐张改 kind/配文，推荐语可多条（推荐人可空），鸣谢可增删并 ↑↓ 排序。`useLibrary().refresh()` 在每次保存后把 `library.snapshot()` 同步回 Provider。
- 单测新增 `test/edit.test.ts` 8 个用例（新建/重启、别名复用、标签类别、系列同步、级联删除、图片移动/清理、推荐语与鸣谢、空标题拒绝），core 54 passed；真机 E2E `.tmp/goal9-e2e.mjs` 13 项全过（表单新建作者、表单改标题、详情页正文、图片上传/改 kind/删除、推荐语 2 条、鸣谢保序、刷新后全部保留），截图 `.tmp/goal9-editor.png`。

Goal 10 追加记录：

- **合并分三层**：`merge.ts` 纯函数（`mergeDatabases` / `applyConflicts` / `deepEqualIgnoringUpdatedAt`）+ `service.ts` IO 编排（`prepare` / `apply` / `discard`）+ UI `/merge` 页。预览阶段只解到 `imports/merge-{ts}` 临时目录，不动当前库；取消只删临时目录。
- **`DBSnapshot` 不含正文**：`mergeDatabases` 返回的 `articles` 是 `ArticleMeta`，落盘前必须把 `content: { file: 'articles/{id}.md' }` 补回去（`applyEdit` 里按 id 找旧对象复用，新增文章给默认路径），否则导出的包缺 `content` 字段、再导入时整篇被当坏条目跳过（实现时踩过）。
- **`applyConflicts` 需要对方快照**：只传 `contents`/`imageFiles` 不够——裁决"用对方"时必须能拿到 incoming 的实体本身才能替换，签名因此是 `applyConflicts(result, decisions, { snapshot, contents, imageFiles })`。
- **图片按字节哈希判冲突**：`mergeDatabases` 的 `MergeSide.hashImage` 由调用方注入（桌面走 Rust 读文件 + `crypto.subtle` sha256），两边同 id 不同哈希才进冲突清单；图片**绝不**按 `updatedAt` 自动换。
- **写入顺序**：先 `library.saveContent` 写正文（incoming 新增/更新 + 冲突裁决为对方的），再用 `writeImageBlob` 把图片字节写进本地 BLOB，最后 `library.applyEdit` 整体替换七个集合（`applyEdit` 重算 counts、校验、`saveDatabase` 差异落盘）。
- 单测 `test/merge.test.ts` 7 个用例（新者胜、同内容不冲突、冲突+裁决、图片哈希冲突、幂等、prepare→apply→导出→再导入、悬空引用进 `report.dangling`），core 61 passed；真机 CDP 12 项断言全过（prepare 计数、自动更新、冲突清单、裁决落盘、未动项不变、无重复 id、取消清理且不改库、导出仍可用、`/merge` 页渲染）。
- 编辑器文章面板新增「导出这篇」与「多选导出（已选 N）」，复用 `library.export({ articles })`；原生文件对话框无法在 CDP 里自动点，E2E 用服务层直调 + 页面渲染双重验证。
- 顺带把 `random.test.ts` 的性能断言从 20ms 放宽到 50ms（取 5 次最快值），避免并行跑测试时抖动。

Goal 11 追加记录：

- **URL 解析是纯函数** `parseGitHubInput(input)`（`packages/core/src/github/url.ts`）：支持仓库首页、`/releases`、`/releases/latest`、`/releases/tag/{tag}`、资产直链、`owner/repo` 速记；非 github 域报 `E_GITHUB_HOST`，其余格式错误报 `E_GITHUB_URL`，错误类 `GitHubUrlError`（**故意不继承** `GitHubError`，调用方按类区分"地址错"和"网络错"）。
- **API 与下载都直连**：`createGitHubService(platform)` 的 `resolve` 打 `https://api.github.com/repos/{owner}/{repo}/releases/{latest|tags/{tag}}`，`download` 直接下载 `browser_download_url`。不提供镜像前缀（没有可用的镜像站）。
- **资产挑选**：`.tpr` 优先，其次 `.zip`（`pickDatabaseAsset`）；都没有报 `E_NO_ASSET` 并列出资产名。下载上限默认 256 MB（`E_TOO_LARGE`），避免把内存打满。
- **版本比较**：`checkUpdate` 把 tag 与 `manifest.version` 都去掉前缀 `v` 再比；tag 可能带仓库前缀（如 `tauri-v3.0.0`），此时只会判为"不同版本"，不会误判为相同。
- **设置文件** `settings.json`（`createSettings`）：`{ theme, language, defaultSource, extractLimits }`；宽容解析（坏字段逐个回退默认值，整份坏 JSON 回退全默认），写盘 tmp+rename；`settings.path` 直接暴露给设置页展示。core **不依赖 zod**，手写 `parseSettings`；`defaultSource` 缺省/坏值回退到内置 GitHub Release 地址。
- **主题三档**：`SettingsProvider` 在 `<html>` 上挂/去 `dark` 类，`system` 档监听 `prefers-color-scheme` 变化；切换即时生效并落盘。
- **页面**：`/import`（DropZone + 原生拖拽 + GitHub 地址下载，默认源从设置预填）、`/credits`（`credits.json` 渲染，外链走 `IOpener`）、`/settings`（默认源 + 恢复内置默认、主题、检查更新、重新下载并导入、项目仓库入口）。导航加到 10 项并改成 `flex-wrap`。
- 单测 `test/github.test.ts` + `test/settings.test.ts` 覆盖 URL 解析、资产挑选、版本比较、设置持久化与内置默认源；真机 CDP 13 项断言全过，其中真实调用 GitHub API 两次（`tauri-apps/tauri` 检查更新、`cli/cli` 解析 release 并验证 `.zip` 兜底），下载链路用注入的假 network 验证导入闭环。
- 截图：`.tmp/goal11-settings.png`（深色设置页）、`.tmp/goal11-credits.png`、`.tmp/goal11-import.png`。

Goal 12 追加记录：

- **路由懒加载**：除首页/布局/404 外全部 `lazy(() => import(...))`，`Layout` 的 `<Outlet />` 包 `Suspense`。入口 chunk 从 639 kB 降到 223.84 kB，`build:web` 的 >500 kB 警告消失（编辑器 27.68 kB、合并 7.46 kB 等按需加载）。
- **移动端适配文档**：`packages/platform/docs/mobile-adaptation.md`（两条路线对比、六个接口逐项实现要点、路由映射、迁移步骤、已知限制）。
- **打包**：`corepack pnpm tauri build` → `target/release/touhou-peach-reader.exe` + `bundle/nsis/Touhou Peach Reader_0.1.0_x64-setup.exe`（1.50 MiB，release 编译 2m42s；NSIS 与 nsis_tauri_utils 由 Tauri 自动下载）。
- **产物验证**：直接运行 release exe（可执行文件与安装包同源）后，应用从 `%APPDATA%` 读回先前导入的夹具库，首页计数、文章正文/封面/作者别名/标签/外链、系列目录与外链均正常；截图 `.tmp/goal12-prod-home.png`、`.tmp/goal12-prod-article.png`、`.tmp/goal12-prod-body.png`、`.tmp/goal12-prod-series.png`。
- **验收命令**：`node scripts/check-no-tauri.mjs`（core/ui/schema 无 Tauri API）与 `node scripts/check-boundaries.mjs` 均通过；`corepack pnpm check` = platform 7 + schema 23 + core 76 = 106 个测试。
- **已知小坑**：release 版与 `tauri dev` 同时启动会因共用 WebView2 用户数据目录报 `HRESULT(0x8007139F)`；验证 release 前先关掉 dev 实例即可。

Goal 13 追加记录（编辑器内新建标签 + 列表标签展示）：

- **`resolveTags(snapshot, ids)`**（`packages/core/src/db/view.ts`）：按传入顺序解析标签 id、去重、跳过悬空 id；`getArticleView` / `getSeriesView` 内部改用它，`featured.ts` / `favorites.ts` 也复用它给卡片补 `tags: TagRef[]`。缩略卡片与详情页因此共用同一套解析，不会出现"详情页有标签、列表没有"。
- **展示面**：首页最近文章、`/articles` 文章库、搜索结果、系列目录、精选卡片、收藏夹、十连抽卡片都加了标签芯片；芯片按 `TagCategory` 上色（角色琥珀、情节翡翠、系列紫），点击跳 `/search?q=名称`。
- **新增 `/articles`**：封面卡片网格 + 标题/简介/标签过滤 + 全部/短篇/系列切换，按 `updatedAt` 降序；这是 `/plan` 没有的页面，属于用户显式要求。
- **编辑器内新建标签**：旧的 `PickerRow`（只读复选）在文章/系列表单里换成 `TagPicker`；输入新名称 → 「+ 新建「名称」」按钮 → `editor.saveTag`（判重复用）→ `refresh()` 刷新快照 → 新标签自动勾进当前表单。此前只有「标签」tab 能新建，表单里必须先切走再回来。
- **结构约束**：`TagLinks` 含 `<Link>`，所有列表卡片从"整卡一个 `<Link>`"重排为"封面链接 + 标题链接 + 标签链接"；卡片内的 `<button>`（十连抽）同样改为外层 `<div>` + 内层 `<Link>`，避免 `<a>` 嵌 `<a>`。
- **测试**：新增 `test/tags.test.ts` 5 个用例（去重/悬空、文章视图、精选卡片、收藏条目与失效条目），core 81 passed；`corepack pnpm check` = platform 7 + schema 23 + core 81 = 111 个测试。夹具给两篇系列条目补上标签，真机 CDP 16 项断言全过（含"输入新名称 → 新建 → 自动勾选 → 保存 → 刷新后仍在"完整链路）。
- 截图：`.tmp/goal13-articles.png`、`.tmp/goal13-editor-tag.png`、`.tmp/goal13-favorites.png`。

Goal 14 追加记录（界面美化 + 5 套配色 + 主界面/文章页壁纸）：

- **设置模型**：`AppSettings` 增 `palette: 'peach'|'bamboo'|'moon'|'scarlet'|'ink'` 与 `wallpapers: { home, article }`（各 `{ file, opacity, blur }`）；`sanitizeWallpaperFile` 只接受 `[A-Za-z0-9][A-Za-z0-9._-]{0,127}` 且扩展名在白名单内，`clampWallpaperOpacity` 收敛到 0.1–1、`clampWallpaperBlur` 收敛到 0–20；`SettingsPatch` 让 `wallpapers` 支持只改一个槽（深合并），避免保存主题时把壁纸清空。
- **平台接口**：新增 `IWallpaperStore { importFile, remove, toUrl }` 并挂到 `Platform.wallpapers`；内存实现把图片存 Map、`toUrl` 返回 data URL；桌面实现 `importFile` 走 Rust `import_wallpaper`、`toUrl` 走 `convertFileSrc($APPDATA/wallpapers/...)`。
- **Rust `import_wallpaper`**：源路径可在 app data 之外（用户任意目录），但仍校验绝对路径、扩展名、≤20 MB、magic bytes；目标写 `wallpapers/wp-{epoch_ms}.{ext}`。这是继 `save_export`（Goal 24 后改为 `zip_create_from_dir_to`）之后第二个"读/写 app data 之外"的命令，二者都只服务对话框选中的单个文件。
- **配色**：`styles.css` 定义 5 套 `[data-palette]` × 深浅 token，`SettingsProvider` 同时切 `class="dark"` 与 `data-palette`；10 组组合的对比度按"面板半透明、正文用 foreground"设计。
- **组件层**：`Button / Panel / SectionHeading / EmptyState / StatTile` 五个原子件进 `@tpr/ui`；`Layout` 改粘性顶栏 + pill 导航；`Home / Articles / Article / Series / Search / Featured / Favorites / Import / Merge / Credits / Settings / 404` 全部重排，`Editor` 只机械换类名（表单逻辑未动）。
- **壁纸层三个坑（都实测踩过）**：① `z-index:-1` 时被 `body` 背景盖住 → 把背景色与径向渐变移到 `html`、`body` 改 `transparent`；② 每页各自渲染一层会压住同页静态内容（正文发暗）→ 只在 `Layout` 渲染、按路由选槽；③ `Markdown` 组件早期写死 `text-neutral-900/800/600`、`bg-neutral-50` 等浅色假设 → 深色主题下正文近乎不可见，全部换成 `foreground / muted-foreground / border / muted` 语义 token。
- **验证**：`test/settings.test.ts` 增 6 个外观用例、`platform` 增 3 个壁纸用例；`corepack pnpm check` = platform 10 + schema 23 + core 87 = 120 个测试；`build:web` 入口 225.29 kB；真机 CDP 截图覆盖深/浅 × 桃夭/竹青/绯红与设置页、文章页、文章库、首页。
- 截图：`.tmp/goal14-settings.png`、`.tmp/goal14-settings-light.png`、`.tmp/goal14-home-bamboo.png`、`.tmp/goal14-home-light.png`、`.tmp/goal14-home-scarlet.png`、`.tmp/goal14-article.png`、`.tmp/goal14-articles.png`。

Goal 15 追加记录（系列文章编号排序 + 文章编辑页快捷创建系列/作者/译者）：

- **编号不落库**：系列内序号 = `series.articleIds` 中的 1-based 下标（`articleSeriesPosition()` 统一计算）。`ArticleMeta` 没有 `order` 字段，也不新增：否则 `articleIds` 与 `order` 会有两个真相。
- **`saveArticle` 接管成员关系**：保存时把文章从所有其它系列的 `articleIds` 里移除、追加到目标系列**末尾**（已在目标系列中则保持原位），并按有无 `seriesId` 强制 `type` 为 `series-entry` / `short`。这消灭了此前"文章标了系列但系列目录里没有它"的静默不一致。
- **新增 `W_SERIES_MEMBERSHIP` warning**（§8 校验表）：只对历史包告警，编辑器下一次保存即修复；不升级为 error，避免旧库直接打不开。
- **`SeriesForm` 的目录改成「可排序列表」**：编号 + 上移/下移/移除 + 搜索添加，保存时写回 `articleIds`；`saveSeries` 原有的双向同步（进列表→`series-entry`、出列表→`short`）不变。
- **快捷创建**：`CreatablePicker` 抽出「过滤 + 精确判重 + 新建/复用提示 + 复选」的唯一实现，`TagPicker`/`AuthorPicker` 都是薄包装；`SeriesPicker` 提供下拉 + 行内新建（按归一化标题复用，避免同名系列）。译者与作者共用 `Author` 实体，因此共用 `AuthorPicker`。
- **展示**：文章库卡片、编辑器文章列表都显示「第 N 篇」；系列页仍是 `01/02` 编号目录，文章页横幅仍是「第 N 篇」，三处同源。
- **测试**：`core/test/view.test.ts` 增 2 例（编号、已加入/未加入）；`core/test/edit.test.ts` 增 7 例（保存追加、换系列、清空降级、目录顺序、`seriesId` 与目录不匹配的修复、快捷创建作者复用、编号查询）；`schema/test/validate.test.ts` 增 `W_SERIES_MEMBERSHIP` 一例。`corepack pnpm check` = platform 10 + schema 24 + core 95 = **129 个测试**。
- **真机 E2E**（`.tmp/goal15-e2e.mjs`，CDP）23/23 通过：快捷建系列→文章自动入目录第 1 篇、第二篇追加为第 2 篇、系列页 `01/02`、文章页「第 1 篇」、系列表单上移后顺序互换并落库、文章库与编辑器列表显示编号、快捷建作者/译者并自动勾选、`Page.reload` 后仍在、同名作者不再出现「新建」按钮、同名系列复用提示。
- 截图：`.tmp/goal15-series.png`、`.tmp/goal15-articles.png`、`.tmp/goal15-editor.png`、`.tmp/goal15-article-form.png`、`.tmp/goal15-series-form.png`。

Goal 16 追加记录（系列译者 / 搜索 `#` 联想 / 编辑器草稿箱）：

- **系列译者**：`Series.translatorIds` 是可选加法字段（§6.1 末、§17.3），zod 用 `.default([])`，导出时写空数组；`SeriesPage` 在"篇数"上方多一行「译者」，编辑器系列表单复用 `AuthorPicker`。悬空译者沿用 `W_DANGLING_AUTHOR` 告警（`entity: 'series'`、`field: 'translatorIds'`），不新增告警码。
- **`#` 联想**：纯函数放在 `apps/desktop/src/search/suggest.ts`——`tagFragmentAt()` 只认行首或空白后的 `#`，`computeTagSuggestions()` 合并虚拟标签（已完结/连载中/短篇文/系列文）与库内标签（按名称+别名过滤、最多 8 条），`applyTagSuggestion()` 替换片段并把光标放到名字后。UI 用 `role="listbox"` + `aria-activedescendant` 语义，↑↓ 选择、Enter/Tab 应用、Esc 关闭。踩坑：下拉最初用 `bg-surface`（半透明），叠在筛选 chips 上会透字 → 改 `bg-background` + `shadow-xl`。
- **草稿箱**：`apps/desktop/src/editor/drafts.ts` 是纯逻辑 + 注入 `StorageLike`（`createDraftStore`、`DraftEnvelope`、`MAX_DRAFTS=50`、`MAX_PAYLOAD_CHARS=1.5M`、`DraftStorageError` 的 `E_QUOTA`/`E_TOO_LARGE`）；`useDraft.ts` 提供 `useDraftStore/useDraftList/useDraftAutosave/useDraftBox`，自动保存 **600 ms 防抖 + 卸载补写**。文章/系列/作者/标签/推荐语/鸣谢六个表单接入；图片面板不接（上传必须选文件，元数据草稿没有意义），在文档里明说。
- **保存成功即清草稿**：`box.discard(draftId)` 在 `onSubmit` 成功后调用；打开已存在实体时 `box.close()`，避免草稿和实体表单互相串。
- **修掉的真 bug**：`ArticleForm` 里"新建 = 空正文"的 `useEffect` 会在草稿恢复后立刻把正文清空（标题还在、正文空）。加 `hasDraft` 守卫跳过该初始化；这正是真机 E2E 才能发现的时序问题（截图里标题正确、正文是占位符）。
- **测试**：`apps/desktop/test/drafts.test.ts` 8 例（保存/倒序、按库隔离、同 id 覆盖、超 50 条裁剪、payload 过大、配额错误、坏 JSON、删除与清空）；`apps/desktop/test/suggest.test.ts` 8 例（片段识别、空片段、名称/别名过滤、虚拟标签、条数上限、替换与光标、词中替换、无匹配）。`corepack pnpm check` = platform 10 + schema 25 + core 97 + desktop 16 = **148 个测试**。
- **真机 E2E**（`.tmp/goal16-e2e.mjs`，CDP）16/16 通过：系列表单内新建译者并自动勾选、保存后 `series.translatorIds` 有 1 个、系列页显示译者、文章草稿自动落盘、离开再回来草稿仍在、`Page.reload` 后仍在、打开草稿标题/正文都恢复、保存后草稿被清、`#` 下拉列出虚拟标签、`#灵` 过滤到博丽灵梦、Enter 应用为 `#博丽灵梦 `、搜索结果命中。联想部分用 CDP `Input.insertText` 注入真实输入事件（合成 `input` 事件的光标位置不可靠，会误判为"联想没出现"）。
- 截图：`.tmp/goal16-series.png`、`.tmp/goal16-draft.png`、`.tmp/goal16-suggest.png`。

Goal 17 追加记录（封面内联上传）：

- 编辑器原来要先到「图片」标签页上传、再回文章/系列表单的下拉里挑，且选项只显示图片 id。现在文章与系列表单的「封面」字段是 `CoverField`：**下拉选择已有图片 + 「上传封面」按钮**，上传即写 `kind='cover'` 的 `ImageAsset`（caption 取文件名去扩展名），`refresh()` 后自动选中新图，提示"已上传并选中"。
- 下拉标签改为「配文（类型）」，无配文时显示「类型 · id」，比裸 id 可读；插图多选仍复用同一批 `ImageAsset`。
- 验证：typecheck 通过；真机 CDP 用 `DataTransfer` 构造 160×224 PNG 触发隐藏 `input[type=file]` 的 change，下拉自动变为 `cover-test（封面）`，保存后文章详情页渲染该封面；测试产生的文章与图片已用 `editor.deleteArticle/deleteImage` 清掉。

Goal 18 追加记录（修复：桌面/对话框路径导入被 app data 限制拦下）：

- **现象**：用户从应用导出 `.tpr` 到桌面（当时 `save_export` 允许外部路径；Goal 24 后由 `zip_create_from_dir_to` 承担），再拖回应用导入时横幅报 `EACCES: 路径越界（只允许 app data 目录）：\\?\C:\Users\…\Desktop\…tpr`。
- **根因**：`library.importZip(path)` → `importDatabaseFromPath` → `platform.zip.extractAll(path, staging)`，而 Rust 的 `zip_extract_all` 仍先过 `ensure_within(app_data)`；拖拽与文件对话框给的正是 app data 之外的绝对路径。导出能成功、导入却失败，是两条路径的权限模型不一致（`save_export` 是例外，解压不是）。Goal 3 的 E2E 用 `importBytes` 与 app data 内路径，恰好绕过了这条分支。
- **修法**：新增 Rust 命令 `stage_import(source_path) -> String`：校验绝对路径、`.tpr` 后缀、常规文件、≤1 GB，复制到 `$APPDATA/imports/staged-{ms}-{sanitized}.tpr` 并返回该路径。TS 侧 `stageTprFile()`（`apps/desktop/src/platform/files.ts`）调它；`useLibrary.importPath` 与 `MergePage.choose` 改为"先 staging → 再 import/prepare → finally 删除 staged 文件"。解压/合并命令一行未改，安全边界仍是"只碰 app data"。
- **验证**：真机 CDP 直接拿用户桌面那份 `夹具数据库-20261019-2319.tpr` 调 `stage_import` → 返回 `%APPDATA%\com.touhou.peachreader\imports\staged-….tpr`，`library.importZip(staged)` 导入成功（5 篇文章）、`fs_remove` 清理成功；非 `.tpr` 返回 `EINVAL: 只支持 .tpr 文件`，不存在的路径返回 `ENOENT`。
- 教训：E2E 应至少有一条"从真实外部路径导入"的用例；只测 `importBytes` 会漏掉平台层的路径边界。

Goal 19 追加记录（导出保真验证 + 安装版随构建同步）：

- **用户的两个疑问**：① 导出的数据库是不是程序内修改后的版本；② 每次更新是否能同时作用于安装版与免安装版。
- **导出链路核对**：`Library.export()` 读的是 `library.current().db`（编辑器 `applyEdit` 已经把内存副本 `Object.assign` 成最新值）与 `ContentStore` 里现读的正文，`selectSubset` 逐集合重建、`computeCounts` 重算、`manifest.updatedAt` 取导出时刻——**导出即当前状态**，没有缓存旧快照的路径。用户那份桌面导出（5 篇文章、2 个系列、2 位作者）也与库内一致。
- **安装版不同步的根因**：Tauri 没有增量更新。`tauri build` 只写 `target/release` 与 `bundle/nsis`，NSIS 安装包**不会**自动覆盖已安装副本；实测注册表 `InstallLocation=D:\Touhou Peach Reader` 里仍是 19:08 构建的 0.1.0（哈希 `33E9109A…`），而 `target/release` 已是 0.1.1（`90E79ED4…`）。另外根 `package.json` 的 `version` 在升 0.1.1 时漏改，五个版本号里混进一个 0.1.0。
- **修法一：发布脚本 `scripts/release.mjs`**：
  - `status`（默认）只读核对五处版本（根/core/desktop/`tauri.conf.json`/`Cargo.toml`）、免安装 exe 的 `VersionInfo.FileVersion` 与 SHA-256、最新 NSIS 安装包、注册表里的安装版版本/哈希；任何不一致以退出码 1 结束并打印差异。
  - `build` = `pnpm check` + `tauri build`（自动把 `~/.cargo/bin` 加进 PATH）。
  - `install` = 检查无运行中进程 → 从注册表取 `InstallLocation`（NSIS 写入时带引号，解析要剥掉）→ `setup.exe /S /D=<dir>` 静默覆盖 → 轮询等待新 exe 版本落地。
  - `--set x.y.z` 一次改五处版本号。
  - 对应 `package.json`：`release:status` / `release:build` / `release:install` / `release`。
- **修法二：运行时可确认**：Rust `app_info` 返回 `{version, exePath, dataDir}`；`apps/desktop/src/platform/app-info.ts` 在浏览器预览返回 `null`；设置页新增「关于」面板，显示版本、运行方式（按 `exePath` 是否含 `target\release` 区分安装版/免安装）、程序路径与数据目录。
- **修法三：导出保真测试** `packages/core/test/export-fidelity.test.ts`（2 例）：导入夹具 → 编辑器改标题/简介/正文/角色标签/封面、调换系列目录 → 导出 → 解包逐文件断言（JSON 字段、`.md` 正文、`images/cover/*.png` 存在、`series.articleIds` 为新顺序、`counts` 与库一致）→ 再把导出物导入一个全新库，除 `manifest.updatedAt` 外与当前库逐字段相等（比较前对对象键排序，避免字段顺序误报）；另一例删除文章后再导出，断言 `.json`/`.md` 消失、系列目录同步清理、计数减一。
- 结果：`corepack pnpm check` = platform 10 + schema 25 + core 99 + desktop 16 = **150 tests**；根 `package.json` 版本补到 0.1.1。
- 教训：多副本分发（免安装 + 安装包 + 已安装）下，"改了代码但用户看到的还是旧版"是默认结果，不是意外；要么提供自动更新，要么把"核对 + 覆盖安装"做成一键命令。
- 顺手把拖拽做成**全局能力**：`LibraryProvider` 注册一次 `onTauriDrop`（原来只有首页与导入页各注册一次），无论在哪个页面拖入 `.tpr` 都会导入；页面里的 `useNativeDrop` 调用随之删除，避免同一路径被导入两次。
- 版本号随之升到 **0.1.1**（`apps/desktop/package.json`、`src-tauri/tauri.conf.json`、`Cargo.toml`），安装包改名为 `Touhou Peach Reader_0.1.1_x64-setup.exe`，方便用户分辨是否装上了这次修复。
- 全局拖拽的验证方式：dev 下用 CDP 调 `plugin:event|emit` 发 `tauri://drag-drop`（payload `{paths:['C:/Users/…/Desktop/….tpr']}`），首页立即出现「已导入「夹具数据库」：5 篇文章、2 个系列」——说明监听已从页面搬到 Provider 且仍能走 `stage_import → importZip` 全链路。

Goal 20 追加记录（统一更新两版：一条命令 + 运行方式识别）：

- **问题**：即使有 `release.mjs`，更新仍是三步（build/install/portable 甚至只存在于文档里），免安装 exe 也埋在 `target/release` 里；用户无法一眼确认「我现在跑的是哪一版」，安装版落后时也没有提示。
- **发布编排**：`release.mjs` 新增 `release` = `build → install → packagePortable → status`，并在开头检查应用是否在运行（运行中会锁 exe）；`packagePortable()` 把 exe 重命名为 `Touhou Peach Reader.exe`、连同安装包与 `README.txt`、`manifest.json`（版本/构建时间/SHA-256）写进 `dist/portable/`，每次先清空旧目录避免残留旧 exe。`status` 增加「免安装目录」一行，判据从「哈希一致」改为**版本号一致**（哈希必不相同，见 Goal 19 记录）。
- **双击入口**：根目录 `发布更新.cmd` 调 `corepack pnpm release`，失败也 `pause`，不闪退。
- **运行方式识别**：Rust 新增只读命令 `install_info()`，用 `reg query` 解析 `InstallLocation`/`DisplayVersion`（不新增 crate；非 Windows 返回 `None`）。TS 侧 `resolveRunMode(exePath, installLocation)` 按「exe 是否位于安装目录下」判断（去 `\\?\`、统一斜杠与大小写），不再用「路径里有没有 `target\release`」——后者对 `dist/portable` 会误判。
- **关于面板**：显示运行方式、当前版本、程序路径、数据目录、安装版「版本 · 位置」；安装版版本与当前 exe 不一致时显示琥珀色提示，指引双击「发布更新.cmd」。
- 验证：`node scripts/release.mjs release` 在 0.1.1 上端到端跑通（platform 10 + schema 25 + core 99 + desktop 21 = **155 tests**，末尾 `✔ 一致`）；分别启动 `D:\Touhou Peach Reader\touhou-peach-reader.exe` 与 `dist/portable/Touhou Peach Reader.exe`，CDP 读取「关于」面板确认运行方式分别为安装版/免安装版（截图 `.tmp/goal20-about-installed.png`、`.tmp/goal20-about-portable.png`）。
- **冷启动 IPC 竞态**：WebView2 先渲染、Tauri IPC 后可用，冷启动后前 5–8 秒 `invoke('app_info')` 一直 pending（同一进程里稍后直接调用又能成功，说明不是路径或注册表问题）。`getAppRuntimeInfo` 因此带 `waitForInvoke(15s)` + 5 次重试（每次 5s 超时、间隔 800ms），面板在未返回前显示「读取中…」而不是「读取失败」；全部超时才降级并 `console.warn`。
- 教训：多副本分发时，"更新"必须是一个给人用的一步操作，而不是一串给开发者看的命令；应用自身也要能回答"我是谁、从哪来、是不是最新"。

Goal 21 追加记录（首页计数不更新 + 编辑器全实体搜索）：

- **计数 bug 根因**：`packages/core/src/db/library.ts:122` 只写了 `computeCounts(draft);`，而 `computeCounts` 返回新对象、不修改入参（`packages/core/src/db/normalize.ts:28-38`），因此编辑器保存后 `manifest.counts` 仍是导入时的数字，首页「当前数据库」纹丝不动。修法是双保险：写入时 `draft.manifest.counts = computeCounts(draft)`；读取时 `packages/core/src/db/snapshot.ts:39` 用 `{ ...raw.manifest, counts: computeCounts(raw) }` 重算，旧库也能自愈。
- **「删了又复活」在 SQLite 化后消失**：旧 JSON 落盘是覆盖式的，删除文章/系列/图片后旧文件仍留在 `workspace/{databaseId}/`，`restore()` 会把它们读回来；当时新增 `pruneDatabaseDir(io, dir, keep)` 清理。现在 `saveDatabase` 按 id 差异删行、图片 BLOB 随主表删除，不再有目录残留，`pruneDatabaseDir` 已删除。
- **编辑器搜索**：新增 `apps/desktop/src/editor/search.ts`（纯函数，七类实体、AND 子串、不搜正文，接口见 §13.2）；`EditorPage` 加常驻搜索框与 combobox/listbox 语义（↑↓/Enter/Esc、`aria-activedescendant`）。选中命中后切标签页、按 `visibleIds` 过滤左侧列表、用 `focus` + `useFocusJump` 定位到具体条目。`useFocusJump` 用 ref 存回调、依赖只写 `[token, id]`——若把 `snapshot`/`box` 写进依赖，保存后的 `refresh()` 会重置正在编辑的表单。
- **测试**：`apps/desktop/test/editor-search.test.ts` 14 例（七类命中、大小写、别名、标签类别、推荐语/鸣谢合成 id、AND 多词、全角空格、空查询 null、`limit` 与 `totals` 分离、结果顺序）；`packages/core/test/library.test.ts` 加 `counts-after-edit`（saveTag/saveAuthor/deleteArticle 后 counts 与数组长度一致，`restore()` 后仍一致）。合计 155 → **170**（platform 10 + schema 25 + core 100 + desktop 35）。
- **E2E（CDP 9222，`.tmp/goal21-e2e.mjs`）**：首页标签数 2 → 新建「目标21计数标签」→ 3；`Page.reload` 后仍 3；杀进程重启后仍 3；删除该标签 → 回 2，重启仍 2。搜索「灵梦」下拉显示 文章·3/系列·1/标签·1 共 5 项，Enter 跳到文章页并打开《夹具系列第一篇》；查询时左侧列表 6 → 3，清空恢复 6。截图 `.tmp/goal21-home-added.png`、`.tmp/goal21-reload.png`、`.tmp/goal21-search.png`、`.tmp/goal21-jump.png`。
- **教训**：凡是"计算结果返回新对象"的纯函数，调用处忘赋值不会报错、只会静默失效；这类"给人看的体检数字"必须在读和写两端都重算，UI 永远以数组长度为准。

Goal 21 后续修复（导出丢失未挂接标签）：

- **现象**：用户在编辑器新建标签（还没挂到任何文章）→ 导出 → 导入后标签消失。导入端没问题（`packages/core/src/db/read.ts:124` 整表读 `tags.json`，`normalizeDatabase` 不裁实体），损失发生在导出：旧 `selectSubset` 无论 `all` 还是选中导出，都只按文章/系列引用收集标签/作者再过滤（`packages/core/src/db/export.ts` 旧 98-99 行），未被引用的实体直接被扔掉。
- **修法**：`all: true` 走 B0 完整备份分支（全量集合，仅重算 counts/updatedAt）；部分导出的作者/标签改为全量（库级词表），图片仍按 B3 闭包；悬空引用警告由"长度差"改为逐 id 检查存在性（全量词表下长度差恒等，旧判断会失效）。
- **测试**：新增 `packages/core/test/export-subset.test.ts` 5 例（all 保留未引用标签/作者/图片/空系列推荐语、includeCredits、部分导出词表全量而图片/系列/推荐语闭包、悬空引用告警）；`packages/core/test/export-fidelity.test.ts` 加 2 例真 zip 往返（全库保留未挂接标签/作者并重导入仍在、单篇导出保留词表且不带无关封面）。修复前 `all-keeps-unreferenced` 与 `partial-keeps-vocabulary` 为红，修复后 **177 全绿**（platform 10 + schema 25 + core 107 + desktop 35）。
- **教训**：同一入口同时承担"完整备份"和"部分分享"时必须分叉；闭包适合"能被独立打开的最小集"，库级词表（作者/标签）不属于闭包，不能按引用裁剪。

标签交互调整记录（+N 展开 / 详情页标签上移）：

- **`TagLinks` 的 `+N` 改为按钮**：`apps/desktop/src/components/TagLinks.tsx` 里用组件内 `useState` 控制展开，点击后 `shown` 取全量、`+N` 卸载；7 个调用点（`/articles` 文章库、首页最近文章、系列目录、搜索结果、精选、收藏、十连抽）一次生效，标签芯片仍跳 `/search?q=名称`。
- **详情页标签上移**：`apps/desktop/src/pages/ArticlePage.tsx` 把标签 section 从插图之后移到简介卡与正文卡之间，顺序为「简介卡 → 错误横幅 → 标签 → 正文 → 插图」；详情页仍全量展示，不显示 `+N`。
- **验证方式**：`corepack pnpm typecheck`、`corepack pnpm test`、`corepack pnpm build:web`；人工确认列表卡片点击 `+N` 展开且不跳转、详情页标签位置正确（夹具每篇仅 2 个标签，验收前需在编辑器补到 4 个以上）。
- **取舍**：展开是单向的，不提供「收起」；展开状态只属于当前卡片实例，列表按实体 id 作 key，筛选/搜索不会串状态。

## Goal 22 追加记录：公开发布与默认数据库源

- **仓库即默认源**：仓库地址收敛到 `packages/core/src/repo.ts`（`REPOSITORY_URL` / `DEFAULT_DATABASE_SOURCE`），设置页「项目仓库」按钮与 `DEFAULT_SETTINGS.defaultSource` 都从它派生；默认源用 `https://github.com/X1a0se/Touhou-Peach-Reader/releases/latest`，同一个 Release 里放安装包、免安装 exe 与 `.tpr`，`pickDatabaseAsset()` 自动挑数据库。
- **移除镜像前缀**：`AppSettings.mirrorPrefix`、`applyMirrorPrefix()`、设置页输入框与相关单测全部删除；旧 `settings.json` 里的该字段由宽容解析忽略，下次保存自动消失。`createGitHubService(platform)` 不再需要 `SettingsService`，API 与下载都直连。
- **发布约定**：Release 标签 = 数据库版本（首个版本 `v1.0.0`，数据库 manifest `1.0.0`），应用版本独立（0.1.5，见「设置 → 关于」）；这样 `checkUpdate` 的 tag/manifest 比较语义不变，不会误报「有新版本」。
- **设置页**：数据库源下方展示内置默认地址并提供「恢复内置默认」；新增「项目仓库」面板与「喜欢就给个star⭐吧」按钮（`IOpener.openExternal`，失败时面板内报错）。

## Goal 23 追加记录：数据库重命名

- **入口**：设置页底部新增「当前数据库」面板（`apps/desktop/src/pages/SettingsPage.tsx`），复用 `useLibraryContext` 的 `snapshot`；输入框 `aria-label="数据库名称"`、`maxLength=200`，主按钮「保存名称」/「保存中…」，成功后显示「数据库名称已保存」，失败显示红字。保存调用 `services.library.rename(name)`，再 `library.refresh()`，首页「当前数据库」、设置页与导出文件名立即使用新名称。
- **服务层**：`packages/core/src/db/library.ts` 的 `Library` 增加 `rename(name: string): Promise<void>`；`trim()` 后为空抛「数据库名称不能为空」，超过 200 抛「数据库名称不能超过 200 个字符」；复用 `applyEdit` 的串行写队列（抽成 `persist` / `enqueueEdit`），只改 `draft.manifest.name`，**不动** `databaseId`、目录与文章内容。
- **内存同步坑**：落盘后把 `current.db.manifest.name` 同步进快照。原 `persist` 只同步 `counts/updatedAt`，不同步名称会导致「保存成功但首页仍旧名」——界面读的是 `current.db`，不是磁盘。
- **导出**：`packages/core/src/db/export.ts` 的 `safeName(db.manifest.name)` 已按名称生成文件名，改名后导出文件名随之变化；非法字符替换、空白压缩、60 字符截断与空名回落逻辑不变。
- **测试**：`packages/core/test/library.test.ts` 新增 2 例（core 107 例中包含）：改名（含 trim）后 `snapshot.name`、编辑后名称不回退、导出 `fileName` 前缀、`restore()` 后仍保持；空名与 201 字符被拒、原 name/updatedAt 不变、200 字符可保存。
- **验证**：`corepack pnpm typecheck`、`corepack pnpm check`（182 全绿）；0.1.6 安装版 CDP 实测：设置页改名「雾雨图书馆」→ 提示保存成功 → 首页「当前数据库」显示新名 → `Page.reload` 后仍在 → 改回「夹具数据库」；磁盘 `manifest.json` 同步。截图 `.tmp/goal23-rename-home.png`。
- **发布**：0.1.6 已用 GUI 安装器覆盖安装（本机 NSIS 静默 `/S` 在此环境 exit 1 且不落盘，属安装器/环境问题，不是本次代码）；`scripts/release.mjs install()` 补上安装后 `exeVersion` 校验，版本不符即失败，避免再假报「已安装」。`dist/portable` 与 `D:\Touhou Peach Reader Portable` 已刷新为 0.1.6。
- **教训**：改名不是只写磁盘；`current.db` 是界面读的快照，任何 `manifest` 字段变更都必须在 `persist` 里同步，否则「保存成功但界面不变」。

## Goal 24 追加记录：导出直写（0.1.7）

- **现象**：230 MB 的库点「导出全库 .tpr」后白屏，但 exports 下已留下完整 223 MB ZIP。根因不是打包失败，而是 `exportDatabase` 把整包 ZIP 经 `fs_read_bytes` 读成 `number[]`，再 `Uint8Array.from` + `Array.from`，223 MB 变成约 2.23 亿个 JS number，渲染进程必然 OOM。
- **API**：`packages/core/src/db/export.ts` 抽出 `prepareExport`，新增 `exportDatabaseToPath` / `suggestExportFileName` / `ExportSummary`；`Library.exportToPath(selection, targetPath)` 直写，不读回 ZIP。`exportDatabase` 的 bytes 语义保留给浏览器与测试。
- **平台/Rust**：`IZip.createFromDirTo`；Rust `zip_create_from_dir_to` 校验源目录在 app data 内、目标为绝对路径且父目录存在，先写同目录 `*.partial`，成功后 `fs::rename` 覆盖；删除 `save_export`。
- **UI**：`apps/desktop/src/platform/files.ts` 的 `saveTprFile` 拆成 `pickTprSavePath` + `downloadTprFile`；`useLibrary.exportSelection` 在 Tauri 下先选路径再调 `library.exportToPath`，浏览器预览仍走字节下载。三个导出入口共用该函数。
- **保护**：目标落在本次临时工作目录内时 core 直接拒绝并清理，避免 `finally` 删掉用户目标；临时目录名带 `Date.now()` 后缀，避免同分钟并发导出互相覆盖。
- **测试**：core 新增 `export-direct`（目标存在、未对目标调用 `readBytes`、临时目录清空、重新导入）；platform 新增 `createFromDirTo`；Rust 新增 3 例（成功替换、替换失败删 partial、目标校验）。`corepack pnpm typecheck`、`corepack pnpm test`、`cargo test --lib` 全绿。
- **版本**：0.1.7；发布后验证大库导出、三个入口、取消保存与失败场景。

## Goal 25 追加记录：图片压缩开关、多标签搜索、同系列折叠

- **图片压缩开关**：`AppSettings.compressImages`（默认 `true`）随 `settings.json` 持久化，不进数据库包、不参与导出/合并；`parseSettings` 与 `sanitize` 只接受布尔值，旧设置缺字段或类型错误时回退 `true`。编辑器「图片」页在文件选择器上方提供 `role="switch"` 开关，保存失败在开关旁显示红字；封面内联上传与图片页都先读同一设置。
- **压缩策略**：新增 `apps/desktop/src/editor/image-upload.ts`，只处理 PNG/JPEG：`createImageBitmap` + canvas 把最长边缩到 2560，`canvas.toBlob('image/webp', 0.85)`；GIF/WebP 或压缩失败、非 WebP 输出、收益不足（< 2048 字节或 < 5%）时保留原图。压缩后扩展名统一 `webp`，提示会写明「已压缩 X → Y」或保留原图的原因；不追溯已上传图片。core 的 `saveImage` API 不变，压缩完全在桌面端浏览器能力内完成。
- **多标签搜索**：`SearchOptions.tags` 与查询串里的 `#标签` 归一化、去重后取并集，按 AND 过滤；只有标签没有关键词也合法，空查询且无标签仍返回空。桌面端标签选择器支持名称/别名/分类搜索、默认收起、最多显示 40 个匹配项；选中标签写入 URL 的重复 `tag` 参数（`q` 为空时省略），后退/分享可恢复。`#` 联想与原有筛选按钮保持不变。
- **同系列折叠**：`SearchItem.series` 由 `articleSeriesPosition` 填充；`packages/core/src/search/group.ts` 的 `groupSearchItems` 只做展示分组，不改引擎排名。同一系列命中 ≥2 篇文章时折叠为一行，组头取该系列所有命中（含系列实体）中排名最高的一项，系列实体被吸收，组内文章保持原排名顺序；组头显示「命中 N 篇 · 共 M 篇」，默认收起，展开后显示「第 N 篇」；单篇或无系列命中保持原样。桌面只调用 core，符合 §13.5。
- **测试与验证**：core 新增多标签 4 例、系列分组 5 例、settings 3 例（共 120 例）；desktop 新增 image-upload 7 例、search-tags 6 例（共 53 例）；全仓 typecheck、test 通过（209 例）。针对改动文件运行 `biome check` 通过；全仓 `biome check .` 仍会命中 `.tmp` 夹具与 Windows CRLF 的历史问题，未批量格式化无关文件。
- **取舍**：压缩只在浏览器画布可用时启用，不引入新依赖，也不在 core 里解码图片；GIF 动图与 WebP 原样保存，避免丢帧/重复压缩。多标签是 AND 语义，减少标签会扩大结果；分组只作用于当前结果集，搜索排名仍由引擎决定。

## 追加记录：系列目录跳转 / 文章库同系列折叠 / 系列前后篇 / 标签合并

- **编辑器系列目录跳转**：`ArticleOrderPicker` 增加可选 `onOpenArticle`，目录标题变成按钮；`SeriesPanel`/`SeriesForm` 透传到 `EditorPage`，复用已有 `focus` + `useFocusJump`：`setTab('articles')` 后由文章面板打开目标表单。与编辑器搜索跳转一致，未保存的系列表单会被丢弃；缺失文章保持不可点。
- **文章库同系列折叠**：core 新增 `packages/core/src/db/article-groups.ts` 的 `groupArticlesBySeries(snapshot, articles)`（纯函数、零 IO）：当前结果集内同系列 ≥2 篇时在首个成员位置成组，组内保持输入顺序，`position` 取 `series.articleIds` 的 1 基下标；悬空 seriesId 与不足两篇的系列保持单篇。`/articles` 默认收起，组头显示系列/状态/篇数并可展开，展开状态只在本页组件内。
- **系列前后篇**：core `getArticleNeighbors(snapshot, articleId)` 按 `series.articleIds` 顺序、跳过缺失文章返回 `previous/next`；文章页新增 `SeriesPager`，在标签之后（正文前）与插图之后（文尾）各渲染一次，首末篇显示「已是第一篇 / 已是最后一篇」，短篇/无系列/不在目录中不渲染，单篇系列整块隐藏。
- **标签合并**：`Editor.mergeTags(sourceIds, targetId)` 走一次 `library.applyEdit`：只允许同类别；源标签名称与别名按 `normalizeName` 去重后并入目标别名；文章/系列的 `characterTagIds`/`plotTagIds` 去掉源、按目标类别归位并去重；删除源标签，目标 id 不重算。目标是 `series`/`general` 且源仍被引用时直接报错（这两类标签没有挂接字段，避免静默丢引用）。UI 在编辑器「标签」页新增「合并标签…」面板（目标下拉 + 同类别源复选 + 二次确认）。合并不改文章/系列 `updatedAt`；`library.applyEdit` 会自动重算 counts、校验并落盘。
- **测试与验证**：core 新增 `article-groups.test.ts` 6 例、`view.test.ts` 增加 3 例、`edit.test.ts` 增加 4 例合并测试（core 120→133）；全仓 typecheck 通过、测试 222 全绿（platform 11 + schema 25 + core 133 + desktop 53）。`biome lint` 对改动文件无新增错误；`biome format` 仍会因工作区历史 CRLF 把整文件判为需重排，未批量格式化无关文件。
- **取舍**：同系列折叠只作用于当前筛选/搜索后的结果集，组内保持当前排序（文章库按更新时间）；不提供全局展开/收起（逐组按钮足够，与搜索结果页一致）。标签合并限定同类别，避免在 `characterTagIds`/`plotTagIds` 之间改变语义；不新增 schema/迁移/导出格式变化。

## 追加记录：多选搜索、封面压缩、编辑草稿、导入合并标签与 R18

- **多选搜索**：新增 `apps/desktop/src/editor/filter.ts`（`joinSearchParts` / `createQueryMatcher` / `matchesQuery` / `filterByQuery`），复用编辑器搜索的 `tokenizeQuery`，用 `normalizeName` 做 NFKC、大小写与空白归一化，多个 token 按 AND 同时包含；空查询显示全部。新增受控的 `ListSearchInput`（`type="search"`，Esc 清空）并接入三处原先没有搜索的多选面：文章面板「多选导出」（标题 + 简介 + 系列标题 + 作者名）、标签合并面板（同时过滤目标下拉与源候选）、文章/系列表单的插图 `PickerRow`。已勾选项始终留在可见列表里，避免“搜索后看不见已选”。合并面板同时修正关闭时机：`submit` 等待 `run` 返回，只有合并成功才 `onDone()`，失败保留面板；合并中禁用按钮。已有的 `CreatablePicker`、`ArticleOrderPicker`、`SearchTagFilter` 搜索保持原样。
- **封面压缩开关**：新增 `apps/desktop/src/components/CompressImagesSwitch.tsx`，从 `useSettingsContext` 读写全局 `compressImages`，`role="switch"`、`aria-label="压缩上传图片"`，保存失败在旁显示红字；图片页与文章/系列的 `CoverField` 内联上传处共用同一个开关，上传仍调用 `prepareImageUpload(file, settings.compressImages)`。开关只影响之后的上传，不追溯已入库图片；设置仍只写 `settings.json`，不进数据库包、不参与导出/合并。
- **编辑已有实体的草稿**：`apps/desktop/src/editor/drafts.ts` 的草稿信封增加可选 `targetId`，新增 `editDraftId(kind, targetId)`、`findDraftForTarget`、`isEditDraft` 与按 key 排序的 `stableSerialize`；`useDraftAutosave` 增加 `baseline`、`targetId`、`onSaved`、`isDiscarded`：payload 与 baseline 结构比较相等时不写草稿，已有草稿会被删除（改回原样即撤销草稿）；`isDiscarded` 记录本次会话丢弃过的 id，防止“删除草稿后组件卸载/关页时又补写回来”；`beforeunload` 同步 flush，保存/删除成功后通知 `onSaved`。`useDraftBox` 增加 `activate(id)` 与 `wasDiscarded(id)`。文章、系列、作者、标签四类编辑表单都从实体构造 baseline，编辑态也启用 autosave；文章正文尤其要注意：即使已有草稿也读取原正文作为 baseline，正文尚未读到或读取失败时 payload 为 null，不会用空正文覆盖原文；读取失败后仍可直接输入或导入新正文。保存成功才清草稿并关闭；取消/切换标签页/关闭编辑器保留草稿；删除实体成功后才清对应编辑草稿；草稿指向的实体不存在时丢弃并提示。`DraftList` 对编辑草稿显示「编辑」徽章。推荐语与鸣谢仍是原有的整表草稿，图片元数据不接编辑草稿。
- **导入合并同名标签**：新增 `packages/core/src/db/tag-merge.ts` 的纯函数 `mergeDuplicateTags(db)`：先按 id 去重，再按 `category + "\0" + normalizeName(name)` 分组；每组保留第一个为目标，其余标签的名称与别名按 `normalizeName` 去重后并入目标 `aliases`，并改写文章/系列 `characterTagIds` / `plotTagIds` 的引用、去重保序；跨类别同名不合并，不原地修改输入。`runImport` 在 `normalizeDatabase` 之后、校验与写 SQLite 之前执行合并，后续文件路径、图片剔除、counts、校验全部基于合并后的库；有合并时在报告最前面插入 `W_IMPORT_TAG_MERGED`（写明组数、移除数量与前几个名称），`ImportOutcome` 增加 `mergedTags`，导入成功提示追加「自动合并 N 组同名标签」。只影响导入，不改变导出、合并与 restore 的语义。
- **R18 特殊显示**：`packages/schema/src/tags.ts` 提供 `R18_TAG_NAME`、`isR18TagName`（`normalizeName` 相等）与 `isR18Tag`（主名或别名命中）；core 的 `hasR18PlotTag(snapshot, tagIds)` 只认 `category === 'plot'` 且能在快照里解析到的标签，角色标签或悬空 id 不触发。`FeaturedCard.r18` 与 `FavoriteEntry.r18` 由文章/系列的情节标签计算；`TagChip` 对情节 R18 用红色芯片，新增 `R18Badge`（`aria-label/title="含 R18 情节"`）。文章/系列详情、文章库卡片与系列组头、精选、收藏、搜索结果（文章与系列组）、首页最近文章、十连抽、编辑器文章/系列列表与标签列表都带徽章或红色芯片。新建/编辑文章与系列时，情节 `TagPicker` 上方新增 `R18Field`：勾选优先复用已在情节标签里的 R18，其次复用库里的 R18（含别名），都没有时调用 `createTag('plot','R18')` 新建并刷新快照；取消勾选会移除所有 R18 情节标签。R18 只是普通 plot 标签，不新增字段、不升 schemaVersion。
- **测试与验证**：`corepack pnpm typecheck`、`corepack pnpm test`、`corepack pnpm check`、`corepack pnpm build:web` 全部通过。当前全仓 263 例：schema 28、platform 11、core 164、desktop 60；本轮新增 schema `tags.test.ts` 3 例、core `tag-merge.test.ts` 4 例 + `r18.test.ts` 3 例 + library 导入合并 1 例、desktop `filter.test.ts` 4 例 + drafts 编辑 id/目标/stableSerialize 3 例。`check` 额外跑依赖边界与“core/ui/schema 无 Tauri API”检查；`build:web` 329 个模块构建成功。仓库没有 React 组件测试库，UI 交互以 typecheck + 构建 + 手工验收为准。
- **取舍**：搜索只补在多选面，未改已有选择器的交互；导入合并是自动的，但只在导入路径执行且限定同类别，避免跨语义合并；R18 只认 plot 类别，角色/通用标签同名不触发，别名命中会显示文章徽章但标签芯片按显示名判定；编辑草稿只在字段真的偏离 baseline 时落盘，图片元数据与推荐语/鸣谢保持原状；草稿信封新增字段是向后兼容的可选字段，不升 localStorage 版本。

---

## 附：文档自检

| 检查项 | 结论 |
|---|---|
| `/goal` 12 条全部有实现方案与验收手段 | ✅ §15.2 逐条对应 |
| 无"待定/TBD"字样 | ✅ 仅 §0.3 三处显式推迟项（U1–U3，均有归属 Goal） |
| 每个接口有实现方（桌面 / 内存） | ✅ §5.1 §5.4 §14.4 |
| 每个数据结构有落盘位置 | ✅ §6 §7 §9.1 |
| 与 `/plan` 的差异全部列出并说明 | ✅ §17 |
| 风险均有对策与触发信号 | ✅ §16（12 条） |
| 版本号均为实查结果 | ✅ §2（2026-10-19，npm/crates.io） |
| Goal 1–25 的实现均已回填 §18.1 | ✅ 每节含决策、踩坑与验证方式（Goal 21 后续修复、公开发布、数据库重命名、导出直写与 Goal 25 已追加） |


