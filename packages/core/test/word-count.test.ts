import { describe, expect, it } from 'vitest';
import { countWords, formatWordCount, stripMarkdown } from '../src/text/word-count.js';

describe('word-count: 正文字数统计', () => {
  it('count-cjk: 中文/日文/韩文逐字计数，标点与空白不计', () => {
    expect(countWords('你好世界')).toBe(4);
    expect(countWords('你好，世界！')).toBe(4);
    expect(countWords('こんにちは')).toBe(5);
    expect(countWords('안녕하세요')).toBe(5);
  });

  it('count-latin: 其他语言按字母/数字连续串计 1 个词', () => {
    expect(countWords('Hello world')).toBe(2);
    expect(countWords("It's a test-case.")).toBe(4);
    expect(countWords('版本 2 的 API 有 3 个变化')).toBe(10);
  });

  it('count-mixed: 中文与英文混排分别计数', () => {
    expect(countWords('中文abc汉字')).toBe(5);
    expect(countWords('API 返回 200 OK')).toBe(5);
  });

  it('count-markdown: 标题/强调/链接只统计可见文本', () => {
    expect(countWords('# 标题')).toBe(2);
    expect(countWords('**粗体**和 *斜体*')).toBe(5);
    expect(countWords('[示例链接](https://example.com/path)文字')).toBe(6);
    expect(countWords('> 引用\n\n- 列表项')).toBe(5);
  });

  it('count-image: Markdown 图片与 HTML img 不产生词数', () => {
    expect(countWords('前文 ![插图](images/a.png) 后文')).toBe(4);
    expect(countWords('<img src="images/a.png" alt="插图">')).toBe(0);
  });

  it('count-html: HTML 标签/注释/实体的标记部分不计', () => {
    expect(countWords('<!-- 注释 -->正文')).toBe(2);
    expect(countWords('<p>你好</p>')).toBe(2);
    expect(countWords('A&amp;B')).toBe(2);
  });

  it('count-url: 链接地址与裸 URL 不计，只算链接文字', () => {
    expect(countWords('[示例](https://example.com/a?b=1)文字')).toBe(4);
    expect(countWords('参考 https://example.com/a?b=1 结束')).toBe(4);
    expect(countWords('www.example.com')).toBe(0);
  });

  it('count-code: 代码围栏标记不计，代码内容照常统计', () => {
    expect(countWords('```js\nconst x = 1;\n```')).toBe(3);
    expect(countWords('~~~\n你好\n~~~')).toBe(2);
  });

  it('count-empty: 空串、纯空白与纯标记返回 0', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('   \n\t ')).toBe(0);
    expect(countWords('![a](b.png)')).toBe(0);
    expect(countWords('---')).toBe(0);
  });

  it('strip-markdown: 保留可读文字，去掉图片与 URL', () => {
    const stripped = stripMarkdown('# 标题\n\n![图](a.png) [链](https://x.test)\n');
    expect(stripped).toContain('标题');
    expect(stripped).toContain('链');
    expect(stripped).not.toContain('a.png');
    expect(stripped).not.toContain('https://x.test');
  });

  it('format-count: 千分位展示', () => {
    expect(formatWordCount(0)).toBe('0');
    expect(formatWordCount(999)).toBe('999');
    expect(formatWordCount(1234)).toBe('1,234');
    expect(formatWordCount(1234567)).toBe('1,234,567');
  });
});
