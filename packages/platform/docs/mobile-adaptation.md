# 移动端适配说明（架构层面）

> 对应 `TohoPR_goal.md` Goal 12 第三条：`packages/platform` 需要一份移动端适配说明。
> 结论先说：**`@tpr/schema` 与 `@tpr/core` 可以原样复用；`@tpr/ui` 与 `apps/desktop` 需要按目标重写；`@tpr/platform` 只需补一套移动实现。**

## 1. 现有分层与依赖方向

```
apps/desktop ─┬─▶ @tpr/ui ──▶ @tpr/schema
              └─▶ @tpr/core ──▶ @tpr/schema
                            └─▶ @tpr/platform
```

- `@tpr/schema`：纯 zod 实体、id、迁移、校验、JSON Schema。**零 IO、零框架依赖**，移动端直接复用。
- `@tpr/core`：库、搜索、编辑器、合并、随机、收藏、设置、GitHub 下载。**只通过 `Platform` 接口碰系统**，不 import `@tauri-apps/*`（`scripts/check-no-tauri.mjs` 在 CI 里守护）。
- `@tpr/platform`：`IFileSystem` / `IZip` / `INetwork` / `IOpener` / `IAssetUrls` / `IAppPaths` 六个接口 + 内存实现（测试用）。移动端要做的只是再写一套实现。
- `@tpr/ui`：纯 props 组件 + Tailwind v4 主题，只依赖 React DOM。
- `apps/desktop`：页面、路由、Tauri 平台实现。

## 2. 两条可选路线

| | A. Tauri Mobile | B. React Native / Expo |
|---|---|---|
| core / schema | 直接复用 | 直接复用 |
| 平台实现 | 复用现有 Rust 命令，补移动端路径与插件 | 用 RN 生态重写六个接口 |
| UI | 复用 `@tpr/ui`（响应式改造 + 触摸拖拽替代） | **不可复用**，按 `@tpr/ui` 的视觉规范重写 |
| 路由 | 沿用 `createHashRouter` | React Navigation，按 §4 映射 |
| 打包 | `tauri android/ios build` | EAS / Gradle / Xcode |

推荐 A：Rust 侧的 zip/fs 命令（含 zip-slip、符号链接、限额校验）与 `save_export` 都能直接编译到 Android/iOS，安全边界不用重写。

## 3. 需要实现的接口（以路线 A 为主）

### 3.1 `IAppPaths`

| 项 | 桌面（现状） | Android | iOS |
|---|---|---|---|
| `dataDir` | `%APPDATA%\com.touhou.peachreader` | `context.filesDir`（内部存储） | `Library/Application Support` |
| `join/basename/dirname` | 纯字符串工具 | 同左（不要换成 `std::path`，保持 POSIX 风格返回值一致） | 同左 |

注意：移动端**没有可写的"用户可见目录"**，导出 `.tpr` 必须走系统分享面板（见 3.5），不能直接写 Download。

### 3.2 `IFileSystem`

现实现全部是 Rust `spawn_blocking` + `ensure_within(app_data)`。移动端：

- `app_data_dir` 换成 `app.path().app_data_dir()`（Tauri 2 已跨平台）；
- `ensure_within` 的 canonicalize 逻辑可原样用；
- `write_atomic`（tmp + rename）在 Android 上同一分区可用，iOS 也成立；
- 建议额外处理：Android 的 scoped storage 不影响 app 私有目录，无需 MANAGE_EXTERNAL_STORAGE。

### 3.3 `IZip`

Rust `zip` crate 与 `walkdir` 都支持 Android/iOS。需要保留的三条硬约束：

1. 拒绝符号链接条目；
2. 拒绝 zip-slip（绝对路径、盘符、`..`）；
3. 限额（条目数 / 单文件 / 总量 / 压缩比）——移动端内存更紧，建议把默认单文件上限从 512 MB 调到 128 MB，并在设置里可调。

解压临时目录用 `cacheDir` 而不是 `filesDir`，失败即删。

### 3.4 `INetwork`

直接复用 JS `fetch`（Tauri Mobile 的 WebView 同样允许跨域到 GitHub，CSP 配置要同步搬过去）。不需要改 Rust。

### 3.5 `IOpener` 与 `IAssetUrls`

- `IOpener.openExternal`：桌面是 `opener` 插件；移动端用 `@tauri-apps/plugin-opener` 的移动实现（Android Intent / iOS `UIApplication.open`）。
- 导出/分享文件：桌面用 `dialog.save` + `save_export`；**移动端没有保存对话框**，需要新增 `share_file` 命令（Android `FileProvider` + `ACTION_SEND`，iOS `UIActivityViewController`），或在 `IOpener` 旁加一个 `IShare` 接口（推荐，语义更清楚）。
- `IAssetUrls`：桌面用 `asset:` 协议；移动端 Tauri 2 同样支持 `asset:`（`convertFileSrc`），把 scope 配成 app data 目录即可。

### 3.6 触摸与拖拽

桌面独有的交互要替换：

| 桌面 | 移动替代 |
|---|---|
| 窗口拖拽 `.tpr` | 系统文件选择器（`dialog.open` 在移动端即 document picker） |
| 悬停高亮、右键 | 长按 / 底部操作表 |
| 多列网格 | 单列 + 断点收缩（`@tpr/ui` 已用 Tailwind 断点，改 `max-w` 即可） |

## 4. 路由映射

| 桌面 hash 路由 | 移动端页面 | 备注 |
|---|---|---|
| `/` | 首页 | 随机 / 十连抽保留 |
| `/search` | 搜索 | 输入法中文组合事件要测 |
| `/featured/short`、`/featured/series` | 精选（两个 tab） | 合并为一个页面更符合移动习惯 |
| `/favorites` | 收藏 | 同 |
| `/editor` | 编辑器 | 表单改全屏单栏 |
| `/merge` | 合并 | 文件选择改为分享导入 |
| `/import` | 导入 | 主入口改为系统分享 + 文件选择 |
| `/credits` | 鸣谢 | 从设置进入 |
| `/settings` | 设置 | 同 |
| `/article/:id`、`/series/:id` | 详情 | 返回手势要接管 |

React Navigation 对应：`createNativeStackNavigator` + `createBottomTabNavigator`（首页 / 搜索 / 精选 / 收藏 / 我的），`article/:id` 用 `params.id`。

## 5. 数据与迁移注意

- `DBSnapshot`、`.tpr` 包格式、`settings.json`、`user/{databaseId}.json` 都不含平台相关字段，可直接跨端拷贝。
- 同一 `databaseId` 在两端各有一份 workspace 时，用 Goal 10 的合并流程解决冲突（按 id + `updatedAt`，同刻异内容人工裁决）。
- 移动端后台被杀概率高：`library.importBytes` 的 staging → rename 协议必须保持原子，写盘期间不能只写一半。
- 移动端没有"双击安装包"的概念，首次启动空库 → 引导页直接进 `/import`。

## 6. 迁移步骤（建议顺序）

1. 新建 `packages/platform-mobile`（或 `apps/mobile/src/platform`），实现六个接口，先跑通 `restore → import → 阅读` 三条路径；
2. 用 `createMemoryPlatform` 的同一套 core 测试跑移动实现（`test/platform.test.ts` 是模板）；
3. 复用 `@tpr/ui`，先做首页 / 搜索 / 详情三页；
4. 补 `IShare` 与移动端导出；
5. 最后做编辑器与合并（表单最重，收益最低）。

## 7. 已知限制

- iOS 不允许应用内下载可执行内容，但 `.tpr` 是数据包，不触发 App Store 审核限制；
- Android 13+ 需要 `READ_MEDIA_*` 权限才能从系统选择器读取任意文件，Tauri 的 dialog 插件已封装；
- 移动端 WebView 的内存上限约为桌面 1/4，解压限额与图片缓存（`ContentStore` capacity=32）建议减半。
