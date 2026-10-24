/**
 * 正文导入：把外部 .txt / .docx 变成编辑器正文（Markdown）。
 *
 * 纯函数模块，不碰文件系统、平台层与 DOM 事件：
 * - `.txt` 按 BOM → 严格 UTF-8 → GB18030（GBK / GB2312 的超集）的顺序解码，再统一换行；
 * - `.docx` 用自带的极小 ZIP 读取器取出 `word/document.xml`（解压交给运行时的
 *   `DecompressionStream('deflate-raw')`），再抽取段落、标题、无序列表、粗体/斜体与段内换行；
 *   图片、表格样式、修订删除内容一律丢弃。
 *
 * 所以本模块不引入任何第三方依赖：桌面端（WebView2）与 Node 测试环境都自带
 * `DecompressionStream`。导入只产出正文文本，标题/简介等元数据仍由用户自己填。
 */

/** 与图片上限保持一致：更大的正文会让受控 textarea 明显变慢 */
export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;

/** docx 正文 XML 解压后的上限；先看 ZIP 里记录的原始大小，避免压缩炸弹 */
export const MAX_DOCX_XML_BYTES = 32 * 1024 * 1024;

/** `<input type="file">` 的 accept：扩展名与两种 MIME 都给，避免不同系统下过滤器不一致 */
export const DOCUMENT_ACCEPT =
  '.txt,.docx,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export type DocumentFormat = 'txt' | 'docx';

export interface DocumentFileMeta {
  name: string;
  size: number;
}

/** `File` 里本节真正用到的那部分，方便测试传入假对象 */
export interface ImportableFile extends DocumentFileMeta {
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface DecodedText {
  text: string;
  encoding: string;
}

export interface ConvertedText {
  /** 规范化后的 Markdown：LF 换行、结尾单个换行 */
  text: string;
  /** 空行分隔的块数 */
  paragraphs: number;
}

export interface ImportedDocument extends ConvertedText {
  format: DocumentFormat;
  /** 原文件字节数 */
  bytes: number;
  /** 非致命提示，例如「已按 GB18030（兼容 GBK/GB2312） 解码」 */
  notices: string[];
}

const CORRUPT_DOCX = '无法解析 .docx：文件可能已损坏或不是 Word 文档';
const UNSUPPORTED_ZIP = '无法解析 .docx：不支持的压缩方式';
const DOCX_DOCUMENT_ENTRY = 'word/document.xml';

const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_SIGNATURE = 0x02014b50;
const ZIP_LOCAL_SIGNATURE = 0x04034b50;
const ZIP_EOCD_BYTES = 22;
const ZIP_CENTRAL_HEADER_BYTES = 46;
const ZIP_LOCAL_HEADER_BYTES = 30;

const UTF8_BOM: readonly number[] = [0xef, 0xbb, 0xbf];
const UTF16_LE_BOM: readonly number[] = [0xff, 0xfe];
const UTF16_BE_BOM: readonly number[] = [0xfe, 0xff];

function extensionOf(name: string): string {
  const index = name.lastIndexOf('.');
  return index < 0 ? '' : name.slice(index + 1).toLowerCase();
}

/** 只按扩展名判断格式：txt / docx，其余返回 null。 */
export function documentFormatOf(name: string): DocumentFormat | null {
  const extension = extensionOf(name);
  if (extension === 'txt') return 'txt';
  if (extension === 'docx') return 'docx';
  return null;
}

/** 返回中文错误文案；合法返回 null。`.doc` 给单独提示，避免被当成"格式不对"含糊带过。 */
export function validateDocumentFile(file: DocumentFileMeta): string | null {
  const extension = extensionOf(file.name);
  if (extension === 'doc') return '暂不支持旧版 .doc，请用 Word 另存为 .docx 后再导入';
  if (documentFormatOf(file.name) === null) return '请选择 .txt 或 .docx 文件';
  if (file.size <= 0) return '文件为空';
  if (file.size > MAX_DOCUMENT_BYTES) return '文件不能超过 20 MB';
  return null;
}

function startsWithPrefix(bytes: Uint8Array, prefix: readonly number[]): boolean {
  if (bytes.byteLength < prefix.length) return false;
  return prefix.every((value, index) => bytes[index] === value);
}

function tryDecode(bytes: Uint8Array, encoding: string, fatal = false): string | null {
  try {
    return new TextDecoder(encoding, { fatal }).decode(bytes);
  } catch {
    // 未知编码或严格解码失败：交给调用方换下一种编码
    return null;
  }
}

function finishDecoding(text: string, encoding: string): DecodedText {
  // 记事本导出的文本偶尔带 NUL；留着会让渲染与搜索都变怪
  return { text: text.replace(/\u0000/g, ''), encoding };
}

/**
 * 解码 txt：BOM 优先，其次严格 UTF-8，再退回 GB18030，最后用宽松 UTF-8 兜底。
 * 返回实际使用的编码，供导入提示告诉用户"按 GBK 解出来了"。
 */
export function decodeText(bytes: Uint8Array): DecodedText {
  if (startsWithPrefix(bytes, UTF8_BOM)) {
    return finishDecoding(new TextDecoder('utf-8').decode(bytes.subarray(3)), 'utf-8');
  }
  if (startsWithPrefix(bytes, UTF16_LE_BOM)) {
    return finishDecoding(new TextDecoder('utf-16le').decode(bytes.subarray(2)), 'utf-16le');
  }
  if (startsWithPrefix(bytes, UTF16_BE_BOM)) {
    return finishDecoding(new TextDecoder('utf-16be').decode(bytes.subarray(2)), 'utf-16be');
  }

  const strictUtf8 = tryDecode(bytes, 'utf-8', true);
  if (strictUtf8 !== null) return finishDecoding(strictUtf8, 'utf-8');

  // 中文 txt 常见 GBK/GB2312，用 GB18030 这个超集兜底
  const gb18030 = tryDecode(bytes, 'gb18030');
  if (gb18030 !== null) return finishDecoding(gb18030, 'gb18030');

  return finishDecoding(new TextDecoder('utf-8').decode(bytes), 'utf-8');
}

/**
 * txt → Markdown：统一换行为 LF、去掉行尾空白、连续空行压成一个空行、去掉首尾空行。
 * 保留原有断行——阅读器把段内换行渲染成 <br/>，所以一行的换行不会被合并掉。
 */
export function textToMarkdown(raw: string): ConvertedText {
  const lines = raw.replace(/\r\n?/g, '\n').split('\n');
  const blocks: string[] = [];
  let current: string[] = [];

  for (const line of lines) {
    const trimmed = line.replace(/[ \t]+$/, '');
    if (trimmed === '') {
      if (current.length > 0) {
        blocks.push(current.join('\n'));
        current = [];
      }
      continue;
    }
    current.push(trimmed);
  }
  if (current.length > 0) blocks.push(current.join('\n'));

  if (blocks.length === 0) return { text: '', paragraphs: 0 };
  return { text: `${blocks.join('\n\n')}\n`, paragraphs: blocks.length };
}

function decodeEntities(text: string): string {
  const pattern = /&(amp|lt|gt|quot|apos|#\d+|#[xX][0-9a-fA-F]+);/g;
  return text.replace(pattern, (match, body: string) => {
    if (body.startsWith('#')) {
      const hex = body[1] === 'x' || body[1] === 'X';
      const code = Number.parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
      if (!Number.isInteger(code) || code <= 0 || code > 0x10ffff) return match;
      // 单独的代理项不是合法字符，保持原样
      if (code >= 0xd800 && code <= 0xdfff) return match;
      return String.fromCodePoint(code);
    }
    switch (body) {
      case 'amp':
        return '&';
      case 'lt':
        return '<';
      case 'gt':
        return '>';
      case 'quot':
        return '"';
      case 'apos':
        return "'";
      default:
        return match;
    }
  });
}

/** 读 <w:b/> / <w:i/>：没有 w:val 或 w:val 不是 0/false/off 时都算开启 */
function formatFlag(properties: string, tag: 'b' | 'i'): boolean {
  const property = new RegExp(`<w:${tag}\\b([^>]*)>`).exec(properties);
  if (!property) return false;
  const value = /w:val="([^"]*)"/.exec(property[1] ?? '')?.[1];
  if (value === undefined) return true;
  return value !== '0' && value !== 'false' && value !== 'off';
}

/** 一个 run 里的文字：<w:t> 取文本，<w:br/> 变换行、<w:tab/> 变制表符 */
function runText(inner: string): string {
  const tokens = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:br\b[^>]*\/?>|<w:tab\b[^>]*\/?>/g;
  let text = '';
  for (const match of inner.matchAll(tokens)) {
    if (match[1] !== undefined) {
      text += decodeEntities(match[1]);
      continue;
    }
    text += (match[0] ?? '').startsWith('<w:br') ? '\n' : '\t';
  }
  return text;
}

interface Segment {
  text: string;
  bold: boolean;
  italic: boolean;
}

/**
 * 段落内的 run 拼成一行 Markdown：粗体 **、斜体 *，粗体优先（渲染器的行内正则
 * 处理不了 ***粗斜***）。相邻同样式 run 先合并，避免出现 **a****b**。
 */
function runsToMarkdown(body: string): string {
  const segments: Segment[] = [];
  const runs = /<w:r\b[^>]*>([\s\S]*?)<\/w:r>/g;

  for (const match of body.matchAll(runs)) {
    const inner = match[1] ?? '';
    const text = runText(inner);
    if (text === '') continue;
    const properties = /<w:rPr>([\s\S]*?)<\/w:rPr>/.exec(inner)?.[1] ?? '';
    segments.push({ text, bold: formatFlag(properties, 'b'), italic: formatFlag(properties, 'i') });
  }
  if (segments.length === 0) return '';

  // 去掉段首段尾的空白 run，避免产出 "** 正文 **" 这种把空格包进粗体的结果
  const first = segments[0];
  const last = segments[segments.length - 1];
  if (first) first.text = first.text.replace(/^\s+/, '');
  if (last) last.text = last.text.replace(/\s+$/, '');

  const merged: Segment[] = [];
  for (const segment of segments) {
    const previous = merged[merged.length - 1];
    if (previous && previous.bold === segment.bold && previous.italic === segment.italic) {
      previous.text += segment.text;
      continue;
    }
    merged.push({ ...segment });
  }

  return merged
    .filter((segment) => segment.text !== '')
    .map((segment) => {
      if (segment.bold) return `**${segment.text}**`;
      if (segment.italic) return `*${segment.text}*`;
      return segment.text;
    })
    .join('');
}

/** w:pStyle 是 Heading1..6 或中文 Word 的 "1".."6" 时返回标题级别，否则 0 */
function headingLevel(properties: string): number {
  const style = /<w:pStyle\b[^>]*w:val="([^"]*)"/.exec(properties)?.[1];
  if (!style) return 0;
  const level = /^(?:heading\s*)?([1-6])$/i.exec(style)?.[1];
  if (!level) return 0;
  return Number.parseInt(level, 10);
}

function paragraphToBlock(body: string): string {
  const text = runsToMarkdown(body).trim();
  if (text === '') return '';
  const properties = /<w:pPr>([\s\S]*?)<\/w:pPr>/.exec(body)?.[1] ?? '';
  const level = headingLevel(properties);
  if (level > 0) return `${'#'.repeat(level)} ${text}`;
  if (/<w:numPr\b/.test(properties)) return `- ${text}`;
  return text;
}

/** 去掉不进入正文的内容：注释、修订删除、域代码、段落属性变更 */
function cleanDocumentXml(xml: string): string {
  return xml
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<w:del\b[^>]*>[\s\S]*?<\/w:del>/g, '')
    .replace(/<w:delText\b[^>]*>[\s\S]*?<\/w:delText>/g, '')
    .replace(/<w:instrText\b[^>]*>[\s\S]*?<\/w:instrText>/g, '')
    .replace(/<w:pPrChange\b[^>]*>[\s\S]*?<\/w:pPrChange>/g, '');
}

interface ZipEntry {
  method: number;
  compressedSize: number;
  originalSize: number;
  localOffset: number;
}

function findEndOfCentralDirectory(view: DataView): number {
  for (let offset = view.byteLength - ZIP_EOCD_BYTES; offset >= 0; offset -= 1) {
    if (view.getUint32(offset, true) === ZIP_EOCD_SIGNATURE) return offset;
  }
  return -1;
}

function entryNameAt(view: DataView, start: number, length: number): string {
  const slice = new Uint8Array(view.buffer, view.byteOffset + start, length);
  return new TextDecoder('utf-8').decode(slice);
}

/** 从中央目录里找条目；ZIP 结构本身就是坏的抛错，找不到条目返回 null。 */
function findZipEntry(view: DataView, name: string): ZipEntry | null {
  const eocd = findEndOfCentralDirectory(view);
  if (eocd < 0) throw new Error(CORRUPT_DOCX);

  let offset = view.getUint32(eocd + 16, true);
  while (
    offset + ZIP_CENTRAL_HEADER_BYTES <= view.byteLength &&
    view.getUint32(offset, true) === ZIP_CENTRAL_SIGNATURE
  ) {
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const dataStart = offset + ZIP_CENTRAL_HEADER_BYTES;
    if (entryNameAt(view, dataStart, nameLength) === name) {
      return {
        method: view.getUint16(offset + 10, true),
        compressedSize: view.getUint32(offset + 20, true),
        originalSize: view.getUint32(offset + 24, true),
        localOffset: view.getUint32(offset + 42, true),
      };
    }
    offset = dataStart + nameLength + extraLength + commentLength;
  }
  return null;
}

/** 按本地文件头切出条目的压缩字节；不校验 CRC（Word 自己写的数据，坏了会解压失败） */
function readZipEntryRaw(bytes: Uint8Array, view: DataView, entry: ZipEntry): Uint8Array {
  const start = entry.localOffset;
  if (
    start + ZIP_LOCAL_HEADER_BYTES > view.byteLength ||
    view.getUint32(start, true) !== ZIP_LOCAL_SIGNATURE
  ) {
    throw new Error(CORRUPT_DOCX);
  }
  const nameLength = view.getUint16(start + 26, true);
  const extraLength = view.getUint16(start + 28, true);
  const dataStart = start + ZIP_LOCAL_HEADER_BYTES + nameLength + extraLength;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataStart > view.byteLength || dataEnd > view.byteLength) throw new Error(CORRUPT_DOCX);
  return bytes.subarray(dataStart, dataEnd);
}

async function inflateRaw(raw: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([raw as unknown as BlobPart]).stream().pipeThrough(
    new DecompressionStream('deflate-raw'),
  );
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * docx → Markdown：每个 <w:p> 一个块，块之间空一行。
 * 表格按阅读顺序摊平成段落（没有 | 表格语法），图片与超链接目标丢弃。
 */
export async function docxToMarkdown(bytes: Uint8Array): Promise<ConvertedText> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('当前环境不支持解压，无法解析 .docx');
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entry = findZipEntry(view, DOCX_DOCUMENT_ENTRY);
  if (!entry) throw new Error('这个 .docx 里没有正文（word/document.xml）');
  if (entry.originalSize > MAX_DOCX_XML_BYTES) throw new Error('文档正文过大（超过 32 MB）');

  const raw = readZipEntryRaw(bytes, view, entry);
  let xmlBytes: Uint8Array;
  if (entry.method === 0) {
    xmlBytes = raw;
  } else if (entry.method === 8) {
    try {
      xmlBytes = await inflateRaw(raw);
    } catch (cause) {
      throw new Error(CORRUPT_DOCX, { cause });
    }
  } else {
    throw new Error(UNSUPPORTED_ZIP);
  }
  if (xmlBytes.byteLength > MAX_DOCX_XML_BYTES) throw new Error('文档正文过大（超过 32 MB）');

  const xml = cleanDocumentXml(new TextDecoder('utf-8').decode(xmlBytes));
  const blocks: string[] = [];
  const paragraphs = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g;
  for (const match of xml.matchAll(paragraphs)) {
    const block = paragraphToBlock(match[1] ?? '');
    if (block !== '') blocks.push(block);
  }

  if (blocks.length === 0) throw new Error('这个 .docx 没有可导入的文字（可能是纯图片文档）');
  return { text: `${blocks.join('\n\n')}\n`, paragraphs: blocks.length };
}

function encodingLabel(encoding: string): string {
  switch (encoding) {
    case 'gb18030':
      return 'GB18030（兼容 GBK/GB2312）';
    case 'utf-16le':
      return 'UTF-16 LE';
    case 'utf-16be':
      return 'UTF-16 BE';
    default:
      return encoding.toUpperCase();
  }
}

/**
 * 导入入口：校验 → 读字节 → 解码/解析。
 * 失败一律抛带中文文案的 Error，由界面原样展示。
 */
export async function importDocument(file: ImportableFile): Promise<ImportedDocument> {
  const invalid = validateDocumentFile(file);
  if (invalid !== null) throw new Error(invalid);

  const format = documentFormatOf(file.name);
  if (format === null) throw new Error('请选择 .txt 或 .docx 文件');

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength === 0) throw new Error('文件为空');
  if (bytes.byteLength > MAX_DOCUMENT_BYTES) throw new Error('文件不能超过 20 MB');

  if (format === 'txt') {
    const decoded = decodeText(bytes);
    const converted = textToMarkdown(decoded.text);
    if (converted.text === '') throw new Error('这个 .txt 没有可导入的文字');
    const notices =
      decoded.encoding === 'utf-8' ? [] : [`已按 ${encodingLabel(decoded.encoding)} 解码`];
    return { ...converted, format, bytes: bytes.byteLength, notices };
  }

  const converted = await docxToMarkdown(bytes);
  return { ...converted, format, bytes: bytes.byteLength, notices: [] };
}
