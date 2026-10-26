import type { Platform } from '@tpr/platform';

/** 本地数据库图片：SQLite 下字节在库里，内存平台仍回退到虚拟文件路径。 */
export interface DatabaseImage {
  id: string;
  file: string;
}

/**
 * 图片的 <img src>：优先走本地数据库 BLOB 协议，平台不支持时回退到文件 URL。
 * 所有页面都通过这里拼图片地址，避免各自记得 `imageUrl`。
 */
export function imageSource(platform: Platform, databaseDir: string, image: DatabaseImage): string {
  return (
    platform.assets.imageUrl?.(databaseDir, image.id) ??
    platform.assets.toUrl(platform.paths.join(databaseDir, image.file))
  );
}
