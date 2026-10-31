import pkg from '../package.json';

/** 应用名与版本：版本号以 package.json 为唯一来源（Vite/vitest 都能内联 JSON） */
export const APP_NAME: string = '东方桃图吧大书库';
export const APP_VERSION: string = pkg.version;

export function getVersion(): string {
  return APP_VERSION;
}

export function getName(): string {
  return APP_NAME;
}
