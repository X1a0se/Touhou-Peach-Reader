import type { Platform } from '@tpr/platform';
import { getName, getVersion } from './version.js';
import { createLibrary, type Library } from './db/library.js';

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
}

export function createServices(platform: Platform): Services {
  return {
    platform,
    app: { getName, getVersion },
    library: createLibrary(platform),
  };
}
