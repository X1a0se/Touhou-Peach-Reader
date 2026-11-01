/**
 * 数据库版本比较（发布时间戳 / 旧数字版本）。
 *
 * 新版本格式：<数据库名>-YYYY-MM-DD-HHmmss；时间戳只作为本机墙上时间的有序键，
 * 不做时区换算。旧库仍是 1.0.0 这类数字版本，需要向后兼容。
 */

export interface TimestampedVersion {
  /** 时间戳前的数据库名（已清洗，非空） */
  readonly prefix: string;
  /** YYYYMMDDHHmmss 拼成的 14 位数字，可直接比较大小 */
  readonly stamp: number;
  /** YYYY-MM-DD-HHmmss */
  readonly timestamp: string;
}

export interface DatabaseVersionCandidate {
  readonly version: string;
  readonly publishedAt?: string | null;
  readonly localUpdatedAt?: string | null;
}

const TIMESTAMP_RE = /^(.*)-(\d{4})-(\d{2})-(\d{2})-(\d{6})$/;
const NUMERIC_RE = /^[vV]?(\d+(?:\.\d+)*)$/;

/** 解析新格式；不是时间戳版本时返回 null。 */
export function parseTimestampedVersion(version: string): TimestampedVersion | null {
  const match = TIMESTAMP_RE.exec(version.trim());
  if (match === null) return null;
  const prefix = match[1] ?? '';
  const year = match[2] ?? '';
  const month = match[3] ?? '';
  const day = match[4] ?? '';
  const hms = match[5] ?? '';
  if (prefix.trim().length === 0) return null;
  const monthNumber = Number(month);
  const dayNumber = Number(day);
  const hour = Number(hms.slice(0, 2));
  const minute = Number(hms.slice(2, 4));
  const second = Number(hms.slice(4, 6));
  if (
    monthNumber < 1 ||
    monthNumber > 12 ||
    dayNumber < 1 ||
    dayNumber > 31 ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return null;
  }
  return {
    prefix,
    stamp: Number(year + month + day + hms),
    timestamp: `${year}-${month}-${day}-${hms}`,
  };
}

function parseNumericVersion(version: string): readonly number[] | null {
  const match = NUMERIC_RE.exec(version.trim());
  if (match === null) return null;
  const body = match[1];
  if (body === undefined) return null;
  const parts = body.split('.').map((part) => Number(part));
  return parts.every((part) => Number.isSafeInteger(part) && part >= 0) ? parts : null;
}

function compareNumeric(a: readonly number[], b: readonly number[]): number {
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    const left = a[i] ?? 0;
    const right = b[i] ?? 0;
    if (left !== right) return left < right ? -1 : 1;
  }
  return 0;
}

function compareTimestamped(a: TimestampedVersion, b: TimestampedVersion): number {
  if (a.stamp !== b.stamp) return a.stamp < b.stamp ? -1 : 1;
  if (a.prefix === b.prefix) return 0;
  return a.prefix < b.prefix ? -1 : 1;
}

/** 返回负数表示 current 更旧，正数表示 current 更新，null 表示无法判断。 */
function compareVersions(current: string, latest: string): number | null {
  const currentTimestamp = parseTimestampedVersion(current);
  const latestTimestamp = parseTimestampedVersion(latest);
  if (currentTimestamp !== null && latestTimestamp !== null) {
    return compareTimestamped(currentTimestamp, latestTimestamp);
  }
  const currentNumeric = parseNumericVersion(current);
  const latestNumeric = parseNumericVersion(latest);
  if (currentNumeric !== null && latestNumeric !== null) {
    return compareNumeric(currentNumeric, latestNumeric);
  }
  // 时间戳版本一定比旧的纯数字版本新。
  if (currentTimestamp !== null && latestNumeric !== null) return 1;
  if (currentNumeric !== null && latestTimestamp !== null) return -1;
  return null;
}

function dateValue(value: string | null | undefined): number | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

/**
 * latest 是否比 current 新。
 *
 * current 为 null（还没导入库）时视为需要更新；版本完全相同返回 false。
 * 先比时间戳/数字版本；再比发布时间与本地库更新时间；最后按标签不同即更新。
 */
export function isNewerDatabaseVersion(
  current: string | null,
  candidate: string | DatabaseVersionCandidate,
): boolean {
  if (current === null) return true;
  const value = typeof candidate === 'string' ? { version: candidate } : candidate;
  const currentText = current.trim();
  const latestText = value.version.trim();
  if (currentText === latestText) return false;
  if (currentText.length === 0 || latestText.length === 0) return latestText.length > 0;
  const order = compareVersions(currentText, latestText);
  if (order !== null) return order < 0;
  const localUpdatedAt = dateValue(value.localUpdatedAt);
  const publishedAt = dateValue(value.publishedAt);
  if (localUpdatedAt !== null && publishedAt !== null) return publishedAt > localUpdatedAt;
  return true;
}
