/**
 * 图片上传前的浏览器端压缩（Goal 25）。
 *
 * 只处理 PNG/JPEG：转成 WebP 并限制最长边，避免把截图/照片原样塞进数据库。
 * GIF/WebP 保持原样（保留动画），压缩失败或收益不足也回退原图。
 * core 的 saveImage 仍然只接收 bytes + ext，不感知压缩。
 */

import { validateImageFile } from './images.js';

export const MAX_IMAGE_EDGE = 2560;
export const WEBP_QUALITY = 0.85;
export const MIN_COMPRESSION_SAVING_BYTES = 2048;
export const MIN_COMPRESSION_SAVING_RATIO = 0.05;

export type ImageCompressionReason = 'disabled' | 'format' | 'failed' | 'no-gain' | null;

export interface PreparedImageUpload {
  bytes: Uint8Array;
  ext: string;
  originalSize: number;
  outputSize: number;
  compressed: boolean;
  reason: ImageCompressionReason;
}

export interface EncodedImage {
  bytes: Uint8Array;
  ext: string;
}

/** 测试可注入；生产实现见 transcodeToWebp。 */
export type ImageTranscoder = (file: File) => Promise<EncodedImage | null>;

function extensionOf(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? '';
}

function originalResult(
  bytes: Uint8Array,
  ext: string,
  reason: Exclude<ImageCompressionReason, null>,
): PreparedImageUpload {
  return {
    bytes,
    ext,
    originalSize: bytes.byteLength,
    outputSize: bytes.byteLength,
    compressed: false,
    reason,
  };
}

function isCompressible(file: File, ext: string): boolean {
  const type = file.type.toLowerCase();
  const extOk = ext === 'png' || ext === 'jpg' || ext === 'jpeg';
  const typeOk =
    type === '' || type === 'image/png' || type === 'image/jpeg' || type === 'image/jpg';
  return extOk && typeOk;
}

/** 把 PNG/JPEG 转成最长边不超过 2560 的 WebP；浏览器不支持时返回 null。 */
export async function transcodeToWebp(file: File): Promise<EncodedImage | null> {
  const bitmap = await createImageBitmap(file);
  try {
    const longest = Math.max(bitmap.width, bitmap.height);
    if (longest <= 0) return null;

    const scale = Math.min(1, MAX_IMAGE_EDGE / longest);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return null;

    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/webp', WEBP_QUALITY);
    });
    if (!blob) return null;
    if (blob.type !== 'image/webp') return null;

    return { bytes: new Uint8Array(await blob.arrayBuffer()), ext: 'webp' };
  } finally {
    bitmap.close();
  }
}

export async function prepareImageUpload(
  file: File,
  compress: boolean,
  transcode: ImageTranscoder = transcodeToWebp,
): Promise<PreparedImageUpload> {
  const invalid = validateImageFile(file);
  if (invalid !== null) throw new Error(invalid);

  const ext = extensionOf(file.name);
  const original = new Uint8Array(await file.arrayBuffer());

  if (!compress) return originalResult(original, ext, 'disabled');
  if (!isCompressible(file, ext)) return originalResult(original, ext, 'format');

  let encoded: EncodedImage | null = null;
  try {
    encoded = await transcode(file);
  } catch {
    encoded = null;
  }

  if (!encoded || encoded.bytes.byteLength === 0 || encoded.ext.toLowerCase() !== 'webp') {
    return originalResult(original, ext, 'failed');
  }

  const outputSize = encoded.bytes.byteLength;
  const saving = original.byteLength - outputSize;
  const savingRatio = original.byteLength > 0 ? saving / original.byteLength : 0;
  if (saving < MIN_COMPRESSION_SAVING_BYTES || savingRatio < MIN_COMPRESSION_SAVING_RATIO) {
    return originalResult(original, ext, 'no-gain');
  }

  return {
    bytes: encoded.bytes,
    ext: 'webp',
    originalSize: original.byteLength,
    outputSize,
    compressed: true,
    reason: null,
  };
}

const BYTE_UNITS = ['B', 'KB', 'MB'] as const;

export function formatBytes(bytes: number): string {
  const value = Math.max(0, Number.isFinite(bytes) ? bytes : 0);
  const unit = value < 1024 ? 0 : value < 1024 * 1024 ? 1 : 2;
  if (unit === 0) return `${Math.round(value)} B`;
  return `${(value / 1024 ** unit).toFixed(1)} ${BYTE_UNITS[unit]}`;
}

function compressionSummary(result: PreparedImageUpload): string {
  if (result.compressed) {
    return `已压缩 ${formatBytes(result.originalSize)} → ${formatBytes(result.outputSize)}`;
  }
  switch (result.reason) {
    case 'disabled':
      return '压缩已关闭，按原样保存';
    case 'format':
      return 'GIF/WebP 不压缩，按原样保存';
    case 'no-gain':
      return '压缩收益不足，保留原图';
    case 'failed':
      return '无法压缩，保留原图';
    default:
      return `${formatBytes(result.outputSize)}，按原样保存`;
  }
}

/** 图片页/封面共用的上传成功提示；verb 用于区分“已上传”和“已上传并选中”。 */
export function uploadNotice(
  result: PreparedImageUpload,
  fileName?: string,
  verb = '已上传',
): string {
  const head = fileName ? `${verb}：${fileName}` : `${verb}图片`;
  return `${head}（${compressionSummary(result)}）`;
}
