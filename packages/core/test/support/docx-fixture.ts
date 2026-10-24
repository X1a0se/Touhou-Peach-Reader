/**
 * 测试用的极小 docx 构造函数。
 *
 * 只写需要的条目（默认 `word/document.xml`，deflate 压缩），CRC 留 0——
 * 生产解析器不校验 CRC，这样单测就不必依赖任何 zip 库，也不会把二进制固件塞进仓库。
 */

const encoder = new TextEncoder();

export const DOCX_ENTRY = 'word/document.xml';

export const DOCX_NAMESPACE = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

export interface ZipFixtureEntry {
  name: string;
  data: Uint8Array;
  /** 0 = 直接存储，8 = deflate-raw */
  method: 0 | 8;
  /** 压缩前的真实字节数（解析器用它判断是否超过解压上限） */
  originalSize: number;
}

/** 按最小可解析结构拼一个 ZIP：本地头 + 中央目录 + EOCD，单条目或多条目都行。 */
export function buildZip(entries: ZipFixtureEntry[]): Uint8Array {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);

    const localHeader = new Uint8Array(30);
    const local = new DataView(localHeader.buffer);
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(8, entry.method, true);
    local.setUint16(10, 0x21, true);
    local.setUint32(18, entry.data.byteLength, true);
    local.setUint32(22, entry.originalSize, true);
    local.setUint16(26, name.byteLength, true);

    const localRecord = new Uint8Array(30 + name.byteLength + entry.data.byteLength);
    localRecord.set(localHeader, 0);
    localRecord.set(name, 30);
    localRecord.set(entry.data, 30 + name.byteLength);
    locals.push(localRecord);

    const centralHeader = new Uint8Array(46);
    const central = new DataView(centralHeader.buffer);
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true);
    central.setUint16(6, 20, true);
    central.setUint16(10, entry.method, true);
    central.setUint16(12, 0x21, true);
    central.setUint32(20, entry.data.byteLength, true);
    central.setUint32(24, entry.originalSize, true);
    central.setUint16(28, name.byteLength, true);
    central.setUint32(42, offset, true);

    const centralRecord = new Uint8Array(46 + name.byteLength);
    centralRecord.set(centralHeader, 0);
    centralRecord.set(name, 46);
    centrals.push(centralRecord);

    offset += localRecord.byteLength;
  }

  const centralSize = centrals.reduce((sum, record) => sum + record.byteLength, 0);
  const endRecord = new Uint8Array(22);
  const end = new DataView(endRecord.buffer);
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);

  const out = new Uint8Array(offset + centralSize + endRecord.byteLength);
  let cursor = 0;
  for (const record of [...locals, ...centrals, endRecord]) {
    out.set(record, cursor);
    cursor += record.byteLength;
  }
  return out;
}

export function documentXml(body: string): string {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    `<w:document xmlns:w="${DOCX_NAMESPACE}"><w:body>${body}</w:body></w:document>`,
  ].join('');
}

async function deflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as unknown as BlobPart]).stream().pipeThrough(
    new CompressionStream('deflate-raw'),
  );
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** 把若干 XML 条目压成 docx；条目名可用 DOCX_ENTRY 或任意字符串。 */
export async function makeDocxEntries(
  entries: { name: string; xml: string }[],
): Promise<Uint8Array> {
  const zipped: ZipFixtureEntry[] = [];
  for (const entry of entries) {
    const raw = encoder.encode(entry.xml);
    zipped.push({
      name: entry.name,
      data: await deflateRaw(raw),
      method: 8,
      originalSize: raw.byteLength,
    });
  }
  return buildZip(zipped);
}

/** 正常的 docx：正文段落塞进 word/document.xml 后 deflate 压缩。 */
export async function makeDocx(body: string): Promise<Uint8Array> {
  return makeDocxEntries([{ name: DOCX_ENTRY, xml: documentXml(body) }]);
}

/** 不压缩（method 0）的 docx，用来覆盖"存储型条目"分支。 */
export async function makeStoredDocx(body: string): Promise<Uint8Array> {
  const raw = encoder.encode(documentXml(body));
  return buildZip([{ name: DOCX_ENTRY, data: raw, method: 0, originalSize: raw.byteLength }]);
}
