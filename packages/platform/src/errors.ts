/**
 * 统一错误类型。跨平台边界只传"可分类的错误码 + 中文信息"，
 * 不把 Rust / DOM 的原始异常对象泄漏到 core。
 */

export type PlatformErrorCode =
  | 'ENOENT'
  | 'EACCES'
  | 'EEXIST'
  | 'ENOTDIR'
  | 'EISDIR'
  | 'ENOTEMPTY'
  | 'EIO'
  | 'ENOSPC'
  | 'EINVAL'
  | 'ENOT_IMPLEMENTED'
  | 'EZIP_SLIP'
  | 'E_TOO_LARGE'
  | 'EUNSUPPORTED';

export class PlatformError extends Error {
  constructor(
    readonly code: PlatformErrorCode,
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'PlatformError';
  }
}

const KNOWN: readonly PlatformErrorCode[] = [
  'ENOENT',
  'EACCES',
  'EEXIST',
  'ENOTDIR',
  'EISDIR',
  'ENOTEMPTY',
  'EIO',
  'ENOSPC',
  'EINVAL',
  'ENOT_IMPLEMENTED',
  'EZIP_SLIP',
  'E_TOO_LARGE',
  'EUNSUPPORTED',
];

/**
 * Rust 命令返回 `Err("ECODE: 可读信息")`，这里转成 PlatformError。
 * 只看前缀，改文案不会破坏分类。
 */
export function mapNativeError(error: unknown, fallback: PlatformErrorCode = 'EIO'): PlatformError {
  if (error instanceof PlatformError) return error;
  const text =
    typeof error === 'string' ? error : error instanceof Error ? error.message : String(error);
  const head = text.slice(0, 24).split(':')[0]?.trim().toUpperCase() ?? '';
  const code = (KNOWN as readonly string[]).includes(head) ? (head as PlatformErrorCode) : fallback;
  return new PlatformError(code, text, error);
}
