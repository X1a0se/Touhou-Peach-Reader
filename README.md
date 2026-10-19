# Touhou Peach Reader

东方同人阅读客户端。阅读器与数据库分离：客户端只负责呈现、搜索、收藏、编辑、同步，所有内容来自可独立分发的 `.tpr` 数据库包。

## 文档

| 文档 | 内容 |
|---|---|
| [TohoPR_plan.md](TohoPR_plan.md) | 架构意图：分层、数据模型、包格式、页面路由 |
| [TohoPR_design.md](TohoPR_design.md) | 技术设计：版本锁定、接口签名、算法、Tauri 配置、验收矩阵 |
| [TohoPR_goal.md](TohoPR_goal.md) | 12 个验收单元 |

## 环境

- Node.js ≥ 22.12（本项目在 24.21 上开发）
- pnpm 12.14（通过 corepack，无需全局安装）
- Rust stable（`stable-x86_64-pc-windows-msvc`）+ WebView2（仅桌面壳需要）

```bash
corepack enable pnpm
pnpm install
```

## 命令

```bash
pnpm dev          # Tauri 桌面窗口
pnpm dev:web      # 仅前端（浏览器预览，使用内存平台实现）
pnpm build        # 打包桌面安装包
pnpm typecheck    # 全包类型检查
pnpm test         # 全包单测
pnpm check        # typecheck + test + 依赖边界 + Tauri 泄漏检查
```

## 结构

```
packages/
  schema/    数据模型、校验、迁移（纯 TS）
  platform/  平台接口 + 内存实现（零 Tauri 依赖）
  core/      业务逻辑（导入导出、搜索、抽卡、合并、编辑）
  ui/        跨平台 React 组件（shadcn/ui）
apps/
  desktop/   Tauri 2 壳 + 路由 + 页面组装
```
