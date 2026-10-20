/** 编辑器图片选择：图片页签与封面字段共用的格式/大小校验。 */

export const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif';
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

const ALLOWED_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif']);
const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif']);

export interface ImageFileMeta {
  name: string;
  type: string;
  size: number;
}

/** 返回中文错误文案；合法返回 null。 */
export function validateImageFile(file: ImageFileMeta): string | null {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    return '请选择 PNG / JPEG / WebP / GIF 图片';
  }
  if (file.type !== '' && !ALLOWED_MIME.has(file.type.toLowerCase())) {
    return '图片内容与扩展名不符（仅支持 PNG / JPEG / WebP / GIF）';
  }
  if (file.size <= 0) {
    return '图片文件为空';
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return '图片不能超过 20 MB';
  }
  return null;
}
