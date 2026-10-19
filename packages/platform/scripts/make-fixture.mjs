// 生成一个小而完整的 .tpr 夹具，用于桌面端"拖拽导入"的手工/自动验证。
// 用法：node scripts/make-fixture.mjs [输出路径]
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { zipSync } from 'fflate';

const out = process.argv[2] ?? '.tmp/fixture.tpr';

const NOW = '2026-02-03T04:05:06.000Z';
const author = { id: 'p_111111111111', canonicalName: '示例作者', aliases: ['Example'] };
const tagA = { id: 't_222222222222', category: 'character', name: '博丽灵梦' };
const tagB = { id: 't_333333333333', category: 'plot', name: '幻想乡' };
const image = { id: 'i_4444444444444444', file: 'images/cover/i_4444444444444444.png', kind: 'cover' };

const articles = [
  {
    id: 'a_short00000000001',
    type: 'short',
    title: '夹具短篇',
    summary: '用于验证导入的最小短篇。',
    content: { file: 'articles/a_short00000000001.md' },
    authorIds: [author.id],
    translatorIds: [],
    characterTagIds: [tagA.id],
    plotTagIds: [tagB.id],
    coverImageId: image.id,
    sourceUrl: 'https://example.com/post/1',
    illustrationImageIds: [],
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: 'a_entry00000000001',
    type: 'series-entry',
    title: '夹具系列第一篇',
    summary: '系列条目。',
    content: { file: 'articles/a_entry00000000001.md' },
    authorIds: [author.id],
    translatorIds: [],
    characterTagIds: [],
    plotTagIds: [],
    seriesId: 's_5555555555555555',
    sourceUrl: 'https://example.com/post/2',
    illustrationImageIds: [],
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: 'a_entry00000000002',
    type: 'series-entry',
    title: '夹具系列第二篇',
    summary: '系列条目二。',
    content: { file: 'articles/a_entry00000000002.md' },
    authorIds: [author.id],
    translatorIds: [],
    characterTagIds: [],
    plotTagIds: [],
    seriesId: 's_5555555555555555',
    illustrationImageIds: [],
    createdAt: NOW,
    updatedAt: NOW,
  },
];

const series = {
  id: 's_5555555555555555',
  title: '夹具系列',
  summary: '两篇的系列。',
  status: 'ongoing',
  articleIds: ['a_entry00000000002', 'a_entry00000000001'],
  authorIds: [author.id],
  characterTagIds: [tagA.id],
  plotTagIds: [],
  createdAt: NOW,
  updatedAt: NOW,
};

const manifest = {
  schemaVersion: 1,
  databaseId: 'db_fixture0001',
  name: '夹具数据库',
  version: '1.0.0',
  updatedAt: NOW,
  description: '由 scripts/make-fixture.mjs 生成',
  counts: { authors: 1, tags: 2, images: 1, articles: 3, series: 1, featured: 3, credits: 1 },
};

/** 生成一张纯色 PNG，保证夹具里的封面在 asset 协议下真能显示。 */
function coverPng(width, height) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (buf) => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), body.length + 4);
    return out;
  };
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x += 1) {
    row[1 + x * 3] = 0xf2;
    row[2 + x * 3] = 0xb8;
    row[3 + x * 3] = 0xc6;
  }
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const files = {
  'manifest.json': JSON.stringify(manifest, null, 2),
  'authors.json': JSON.stringify([author], null, 2),
  'tags.json': JSON.stringify([tagA, tagB], null, 2),
  'images.json': JSON.stringify([image], null, 2),
  'featured.json': JSON.stringify(
    [
      {
        targetType: 'article',
        targetId: articles[0].id,
        recommendations: [
          { text: '夹具推荐语：这篇短篇适合导入验证。', author: '推荐人甲' },
          { text: '第二条推荐语，不带作者。' },
        ],
      },
      {
        targetType: 'series',
        targetId: series.id,
        recommendations: [{ text: '夹具系列推荐语。', author: '推荐人乙' }],
      },
      {
        targetType: 'article',
        targetId: 'a_missing00000000',
        recommendations: [{ text: '目标已被删除的推荐语。' }],
      },
    ],
    null,
    2,
  ),
  'credits.json': JSON.stringify([{ name: '夹具鸣谢', role: '作者' }], null, 2),
  'articles/a_short00000000001.json': JSON.stringify(articles[0], null, 2),
  'articles/a_entry00000000001.json': JSON.stringify(articles[1], null, 2),
  'articles/a_entry00000000002.json': JSON.stringify(articles[2], null, 2),
  'series/s_5555555555555555.json': JSON.stringify(series, null, 2),
  'articles/a_short00000000001.md': '# 夹具短篇\n\n这是**导入验证**用的正文。\n',
  'articles/a_entry00000000001.md': '# 夹具系列第一篇\n\n系列正文。\n',
  'articles/a_entry00000000002.md': '# 夹具系列第二篇\n\n系列正文二。\n',
  'images/cover/i_4444444444444444.png': coverPng(160, 224),
};

const encoder = new TextEncoder();
const entries = {};
for (const [path, value] of Object.entries(files)) {
  entries[path] = typeof value === 'string' ? encoder.encode(value) : value;
}

const zipped = zipSync(entries, { level: 6 });
writeFileSync(out, zipped);
console.log(`wrote ${out} (${zipped.byteLength} bytes)`);
