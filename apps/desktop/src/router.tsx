import { createHashRouter } from 'react-router';
import { ArticlePage } from './pages/ArticlePage.js';
import { FavoritesPage } from './pages/FavoritesPage.js';
import { FeaturedPage } from './pages/FeaturedPage.js';
import { HomePage } from './pages/HomePage.js';
import { Layout } from './pages/Layout.js';
import { NotFoundPage } from './pages/NotFoundPage.js';
import { SearchPage } from './pages/SearchPage.js';
import { SeriesPage } from './pages/SeriesPage.js';

/**
 * 路由表（design §13.3）：选 hash 而不是 history，生产环境的深链/刷新不依赖服务端 fallback。
 * 后续 Goal 会按设计表逐条补 /featured/*、/favorites、/editor…
 */
export const router = createHashRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'search', element: <SearchPage /> },
      { path: 'featured/short', element: <FeaturedPage page="short" /> },
      { path: 'featured/series', element: <FeaturedPage page="series" /> },
      { path: 'favorites', element: <FavoritesPage /> },
      { path: 'article/:id', element: <ArticlePage /> },
      { path: 'series/:id', element: <SeriesPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
