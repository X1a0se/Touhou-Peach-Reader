import { describe, expect, it } from 'vitest';
import {
  MAX_DOCUMENT_BYTES,
  decodeText,
  docxToMarkdown,
  documentFormatOf,
  importDocument,
  textToMarkdown,
  validateDocumentFile,
} from '../src/editor/document-import.js';
import { makeDocx, makeDocxEntries, makeStoredDocx } from './support/docx-fixture.js';

const encoder = new TextEncoder();

function paragraph(text: string): string {
  return `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
}

function fakeFile(name: string, bytes: Uint8Array) {
  return {
    name,
    size: bytes.byteLength,
    arrayBuffer: async () => bytes.buffer as ArrayBuffer,
  };
}

describe('正文导入：txt 解码', () => {
  it('去掉 UTF-8 BOM，保留换行交给下一步规范化', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...encoder.encode('# 标题\r\n\r\n正文  \r\n')]);
    const decoded = decodeText(bytes);
    expect(decoded.encoding).toBe('utf-8');
    expect(decoded.text.startsWith('\uFEFF')).toBe(false);
    expect(textToMarkdown(decoded.text)).toEqual({ text: '# 标题\n\n正文\n', paragraphs: 2 });
  });

  it('不是合法 UTF-8 时按 GB18030（GBK 超集）兜底', () => {
    expect(decodeText(new Uint8Array([0xc4, 0xe3, 0xba, 0xc3]))).toEqual({
      text: '你好',
      encoding: 'gb18030',
    });
  });

  it('识别 UTF-16 LE / BE 的 BOM', () => {
    const le = new Uint8Array([0xff, 0xfe, 0x60, 0x4f, 0x7d, 0x59]);
    expect(decodeText(le)).toEqual({ text: '你好', encoding: 'utf-16le' });
    const be = new Uint8Array([0xfe, 0xff, 0x4f, 0x60, 0x59, 0x7d]);
    expect(decodeText(be)).toEqual({ text: '你好', encoding: 'utf-16be' });
  });
});

describe('正文导入：txt 规范化为 Markdown', () => {
  it('保留段内断行，连续空行压成一个，去掉首尾空行', () => {
    expect(textToMarkdown('\n\n第一行\n第二行\n\n\n\n第二段\n\n')).toEqual({
      text: '第一行\n第二行\n\n第二段\n',
      paragraphs: 2,
    });
  });

  it('纯空白文件得到空结果', () => {
    expect(textToMarkdown('  \n\n \t\n')).toEqual({ text: '', paragraphs: 0 });
  });
});

describe('正文导入：文件名与体积校验', () => {
  it('只认 txt / docx', () => {
    expect(documentFormatOf('正文.TXT')).toBe('txt');
    expect(documentFormatOf('正文.docx')).toBe('docx');
    expect(documentFormatOf('正文.md')).toBeNull();
  });

  it('错误文案是中文', () => {
    expect(validateDocumentFile({ name: 'a.doc', size: 10 })).toContain('另存为 .docx');
    expect(validateDocumentFile({ name: 'a.md', size: 10 })).toBe('请选择 .txt 或 .docx 文件');
    expect(validateDocumentFile({ name: 'a.txt', size: 0 })).toBe('文件为空');
    expect(validateDocumentFile({ name: 'a.txt', size: MAX_DOCUMENT_BYTES + 1 })).toBe(
      '文件不能超过 20 MB',
    );
    expect(validateDocumentFile({ name: 'a.docx', size: 1024 })).toBeNull();
  });
});

describe('正文导入：docx 转 Markdown', () => {
  it('粗体 / 斜体 / 段内换行都保留，段落之间空一行', async () => {
    const body = [
      '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>粗体</w:t></w:r>',
      '<w:r><w:t>与</w:t></w:r>',
      '<w:r><w:rPr><w:i/></w:rPr><w:t>斜体</w:t></w:r></w:p>',
      '<w:p><w:r><w:t xml:space="preserve">第一行</w:t><w:br/><w:t>第二行</w:t></w:r></w:p>',
    ].join('');
    expect(await docxToMarkdown(await makeDocx(body))).toEqual({
      text: '**粗体**与*斜体*\n\n第一行\n第二行\n',
      paragraphs: 2,
    });
  });

  it('标题样式、无序列表、XML 实体', async () => {
    const body = [
      '<w:p><w:pPr><w:pStyle w:val="1"/></w:pPr><w:r><w:t>标题</w:t></w:r></w:p>',
      '<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>二级</w:t></w:r></w:p>',
      '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>',
      '<w:r><w:t>项目</w:t></w:r></w:p>',
      '<w:p><w:r><w:t>a &amp; b &lt;c&gt; &#x4F60;</w:t></w:r></w:p>',
    ].join('');
    expect(await docxToMarkdown(await makeDocx(body))).toEqual({
      text: '# 标题\n\n## 二级\n\n- 项目\n\na & b <c> 你\n',
      paragraphs: 4,
    });
  });

  it('跳过修订删除与域代码，并支持存储型（未压缩）条目', async () => {
    const body = [
      '<w:p><w:r><w:t>保留</w:t></w:r>',
      '<w:del w:id="1"><w:r><w:delText>删掉</w:delText></w:r></w:del></w:p>',
      '<w:p><w:r><w:instrText> TOC \\o "1-3" </w:instrText><w:t>正文</w:t></w:r></w:p>',
    ].join('');
    const result = await docxToMarkdown(await makeStoredDocx(body));
    expect(result.text).toContain('保留');
    expect(result.text).not.toContain('删掉');
    expect(result.text).not.toContain('TOC');
    expect(result.text).toContain('正文');
  });

  it('错误路径给出中文文案', async () => {
    await expect(docxToMarkdown(new Uint8Array([1, 2, 3, 4]))).rejects.toThrow('无法解析 .docx');
    const noBody = await makeDocxEntries([{ name: '[Content_Types].xml', xml: '<Types/>' }]);
    await expect(docxToMarkdown(noBody)).rejects.toThrow('没有正文');
    await expect(docxToMarkdown(await makeDocx('<w:p/>'))).rejects.toThrow('没有可导入的文字');
  });
});

describe('正文导入：importDocument 入口', () => {
  it('txt 返回格式、段数、字节数与提示', async () => {
    const bytes = encoder.encode('第一段\n\n第二段\n');
    expect(await importDocument(fakeFile('正文.txt', bytes))).toEqual({
      format: 'txt',
      text: '第一段\n\n第二段\n',
      paragraphs: 2,
      bytes: bytes.byteLength,
      notices: [],
    });
  });

  it('非 UTF-8 的 txt 附带解码提示', async () => {
    const gbk = new Uint8Array([0xc4, 0xe3, 0xba, 0xc3]);
    const result = await importDocument(fakeFile('gbk.txt', gbk));
    expect(result.text).toBe('你好\n');
    expect(result.notices).toEqual(['已按 GB18030（兼容 GBK/GB2312） 解码']);
  });

  it('docx 端到端', async () => {
    const bytes = await makeDocx(paragraph('正文'));
    const result = await importDocument(fakeFile('正文.docx', bytes));
    expect(result.format).toBe('docx');
    expect(result.text).toBe('正文\n');
    expect(result.bytes).toBe(bytes.byteLength);
    expect(result.notices).toEqual([]);
  });

  it('非法文件在读取字节之前就被拒绝', async () => {
    let read = false;
    const file = {
      name: 'a.doc',
      size: 10,
      arrayBuffer: async () => {
        read = true;
        return new ArrayBuffer(0);
      },
    };
    await expect(importDocument(file)).rejects.toThrow('另存为 .docx');
    expect(read).toBe(false);
  });
});
