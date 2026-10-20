/**
 * 仓库与发布地址（公开发布）。
 *
 * 这里是唯一来源：设置页的「项目仓库」入口与内置默认数据库源都从这几个
 * 常量派生，避免仓库名散落在 UI、README 与代码里各写一份。
 */
export const REPOSITORY_OWNER = 'X1a0se';
export const REPOSITORY_NAME = 'Touhou-Peach-Reader';

/** 仓库首页（设置页「喜欢就给个star⭐吧」跳这里） */
export const REPOSITORY_URL = `https://github.com/${REPOSITORY_OWNER}/${REPOSITORY_NAME}`;

/** 发布页：latest 由 GitHub 解析到最新的正式 release */
export const REPOSITORY_RELEASES_URL = `${REPOSITORY_URL}/releases`;

/**
 * 内置默认数据库源。
 *
 * 用 `/releases/latest` 而不是资产直链：同一个 release 里既有安装包、免安装
 * exe，也有 `.tpr` 数据库，`pickDatabaseAsset()` 会自动挑出 `.tpr`；以后换
 * 数据库版本地址也不用改。
 */
export const DEFAULT_DATABASE_SOURCE = `${REPOSITORY_RELEASES_URL}/latest`;
