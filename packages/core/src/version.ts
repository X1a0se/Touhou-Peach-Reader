import pkg from '../package.json';

/** 应用名与版本：版本号以 package.json 为唯一来源（Vite/vitest 都能内联 JSON） */
export const APP_NAME: string = 'Touhou Peach Reader';
export const APP_VERSION: string = pkg.version;

export function getVersion(): string {
  return APP_VERSION;
}

export function getName(): string {
  return APP_NAME;
}
