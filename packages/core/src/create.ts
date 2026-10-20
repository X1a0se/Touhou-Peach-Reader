import type { Platform } from '@tpr/platform';
import { createLibrary, type Library } from './db/library.js';
import { createEditor, type Editor } from './editor/index.js';
import { createFavorites, type Favorites } from './favorites.js';
import { createGitHubService, type GitHubService } from './github/client.js';
import { createMergeService, type MergeService } from './merge/service.js';
import { createSearchService, type SearchService } from './search/service.js';
import { createSettings, type SettingsService } from './settings/index.js';
import { getName, getVersion } from './version.js';

/**
 * core 的唯一入口（design §5.1 D8）：所有服务都由 `createServices(platform)` 产出，
 * 不导出全局单例，测试里可以同时造多套。
 */
export interface AppService {
  getName(): string;
  getVersion(): string;
}

export interface Services {
  readonly platform: Platform;
  readonly app: AppService;
  readonly library: Library;
  readonly favorites: Favorites;
  readonly search: SearchService;
  readonly editor: Editor;
  readonly merge: MergeService;
  readonly settings: SettingsService;
  readonly github: GitHubService;
}

export function createServices(platform: Platform): Services {
  const library = createLibrary(platform);
  const settings = createSettings(platform);
  return {
    platform,
    app: { getName, getVersion },
    library,
    favorites: createFavorites(platform, () => library.current()?.databaseId ?? null),
    search: createSearchService(library),
    editor: createEditor(platform, library),
    merge: createMergeService(platform, library),
    settings,
    github: createGitHubService(platform),
  };
}
