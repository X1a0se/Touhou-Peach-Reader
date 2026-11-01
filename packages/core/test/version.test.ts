import { describe, expect, it } from 'vitest';
import { isNewerDatabaseVersion, parseTimestampedVersion } from '../src/github/index.js';

describe('version: 时间戳版本解析', () => {
  it('version-parse: 数据库名可以带连字符，时间戳拆成 14 位比较键', () => {
    expect(parseTimestampedVersion('纯文字文章1029-2026-10-31-121918')).toEqual({
      prefix: '纯文字文章1029',
      stamp: 20261031121918,
      timestamp: '2026-10-31-121918',
    });
    expect(parseTimestampedVersion('a-b-2026-01-02-030405')).toEqual({
      prefix: 'a-b',
      stamp: 20260102030405,
      timestamp: '2026-01-02-030405',
    });
  });

  it('version-parse-invalid: 数字旧版本、非法日期时间与空前缀都不算时间戳版本', () => {
    expect(parseTimestampedVersion('1.0.0')).toBeNull();
    expect(parseTimestampedVersion('2026-10-31-121918')).toBeNull();
    expect(parseTimestampedVersion('-2026-10-31-121918')).toBeNull();
    expect(parseTimestampedVersion('x-2026-13-01-000000')).toBeNull();
    expect(parseTimestampedVersion('x-2026-10-32-000000')).toBeNull();
    expect(parseTimestampedVersion('x-2026-10-31-240000')).toBeNull();
    expect(parseTimestampedVersion('x-2026-10-31-126000')).toBeNull();
    expect(parseTimestampedVersion('x-2026-10-31-120060')).toBeNull();
    expect(parseTimestampedVersion('x-2026-10-31-12000')).toBeNull();
  });
});

describe('version: 判断数据库是否需要更新', () => {
  it('version-null: 还没导入库时永远需要更新，版本相同则不需要', () => {
    expect(isNewerDatabaseVersion(null, '纯文字文章1029-2026-10-31-121918')).toBe(true);
    expect(isNewerDatabaseVersion(null, '1.0.0')).toBe(true);
    const same = '纯文字文章1029-2026-10-31-121918';
    expect(isNewerDatabaseVersion(same, same)).toBe(false);
    expect(isNewerDatabaseVersion('v1.4.0', '1.4.0')).toBe(false);
    expect(isNewerDatabaseVersion('1.0.0', 'v1.0.0')).toBe(false);
  });

  it('version-timestamp: 时间戳新则更新，旧则保持；前缀不同按前缀排序', () => {
    const old = '纯文字文章1029-2026-10-30-121918';
    const fresh = '纯文字文章1029-2026-10-31-121918';
    expect(isNewerDatabaseVersion(old, fresh)).toBe(true);
    expect(isNewerDatabaseVersion(fresh, old)).toBe(false);
    expect(isNewerDatabaseVersion(old, { version: fresh })).toBe(true);
    expect(isNewerDatabaseVersion('乙-2026-10-31-121918', '甲-2026-10-31-121918')).toBe(true);
  });

  it('version-numeric: 旧数字版本仍按数字段比较', () => {
    expect(isNewerDatabaseVersion('1.0.0', '1.0.1')).toBe(true);
    expect(isNewerDatabaseVersion('1.0.1', '1.0.0')).toBe(false);
    expect(isNewerDatabaseVersion('1.10.0', '1.9.0')).toBe(false);
    expect(isNewerDatabaseVersion('1.9.0', '1.10.0')).toBe(true);
    expect(isNewerDatabaseVersion('1.0', '1.0.0')).toBe(false);
  });

  it('version-mixed: 时间戳版本一定比纯数字版本新', () => {
    expect(isNewerDatabaseVersion('1.0.0', '纯文字文章1029-2026-10-31-121918')).toBe(true);
    expect(isNewerDatabaseVersion('纯文字文章1029-2026-10-31-121918', '1.0.0')).toBe(false);
  });

  it('version-date: 无法解析版本时用发布时间与本地更新时间兜底', () => {
    expect(
      isNewerDatabaseVersion('自定义旧版', {
        version: '自定义新版',
        publishedAt: '2026-10-31T04:19:18Z',
        localUpdatedAt: '2026-10-30T12:19:18Z',
      }),
    ).toBe(true);
    expect(
      isNewerDatabaseVersion('自定义新版', {
        version: '自定义旧版',
        publishedAt: '2026-10-30T12:19:18Z',
        localUpdatedAt: '2026-10-31T04:19:18Z',
      }),
    ).toBe(false);
    expect(
      isNewerDatabaseVersion('自定义版本', {
        version: '另一个自定义版本',
        publishedAt: '2026-10-31T04:19:18Z',
        localUpdatedAt: '2026-10-31T04:19:18Z',
      }),
    ).toBe(false);
    expect(
      isNewerDatabaseVersion('自定义版本', {
        version: '另一个自定义版本',
        publishedAt: '2026-10-31T04:19:18Z',
      }),
    ).toBe(true);
    expect(isNewerDatabaseVersion('自定义版本', '另一个自定义版本')).toBe(true);
  });

  it('version-empty: 空版本按有内容的较新处理', () => {
    expect(isNewerDatabaseVersion('', '1.0.0')).toBe(true);
    expect(isNewerDatabaseVersion('1.0.0', '')).toBe(false);
    expect(isNewerDatabaseVersion('', '')).toBe(false);
  });
});
