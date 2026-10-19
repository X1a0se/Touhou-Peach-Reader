import { lazy } from 'react';
import { createHashRouter } from 'react-router';
import { HomePage } from './pages/HomePage.js';
import { Layout } from './pages/Layout.js';
import { NotFoundPage } from './pages/NotFoundPage.js';

/**
 * 路由表（design §13.3）：选 hash 而不是 history，生产环境的深链/刷新不依赖服务端 fallback。
 *
 * 除首屏（首页）外全部按路由懒加载：单个入口 chunk 从 640 kB 降到 200 kB 量级，
 * 也让「编辑器 / 合并 / 设置」这类重页面只在真正进入时才解析。
 */
const ArticlePage = lazy(() => import('./pages/ArticlePage.js').then((m) => ({ default: m.ArticlePage })));
const ArticlesPage = lazy(() => import('./pages/ArticlesPage.js').then((m) => ({ default: m.ArticlesPage })));
const CreditsPage = lazy(() => import('./pages/CreditsPage.js').then((m) => ({ default: m.CreditsPage })));
const EditorPage = lazy(() => import('./pages/EditorPage.js').then((m) => ({ default: m.EditorPage })));
const FavoritesPage = lazy(() => import('./pages/FavoritesPage.js').then((m) => ({ default: m.FavoritesPage })));
const FeaturedPage = lazy(() => import('./pages/FeaturedPage.js').then((m) => ({ default: m.FeaturedPage })));
const ImportPage = lazy(() => import('./pages/ImportPage.js').then((m) => ({ default: m.ImportPage })));
const MergePage = lazy(() => import('./pages/MergePage.js').then((m) => ({ default: m.MergePage })));
const SearchPage = lazy(() => import('./pages/SearchPage.js').then((m) => ({ default: m.SearchPage })));
const SeriesPage = lazy(() => import('./pages/SeriesPage.js').then((m) => ({ default: m.SeriesPage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage.js').then((m) => ({ default: m.SettingsPage })));

export const router = createHashRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'articles', element: <ArticlesPage /> },
      { path: 'search', element: <SearchPage /> },
      { path: 'featured/short', element: <FeaturedPage page="short" /> },
      { path: 'featured/series', element: <FeaturedPage page="series" /> },
      { path: 'favorites', element: <FavoritesPage /> },
      { path: 'editor', element: <EditorPage /> },
      { path: 'merge', element: <MergePage /> },
      { path: 'import', element: <ImportPage /> },
      { path: 'credits', element: <CreditsPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: 'article/:id', element: <ArticlePage /> },
      { path: 'series/:id', element: <SeriesPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
