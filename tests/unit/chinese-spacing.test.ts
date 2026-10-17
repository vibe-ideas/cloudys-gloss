import { describe, expect, it } from 'vitest';
import { chineseSpacing, chineseCardSpacing } from '../../src/core/chinese-spacing';

describe('科技文档中文译文的混排间距', () => {
  it.each([
    ['技术名称与数字', '使用React构建API，支持3种模式。', '使用 React 构建 API，支持 3 种模式。'],
    ['产品名、版本与百分比', '升级到Node.js 22和GPT-4o，性能提升20%。C++和C#均可用。', '升级到 Node.js 22 和 GPT-4o，性能提升 20%。C++ 和 C# 均可用。'],
    ['小数与范围', '占用2.5 GB内存，支持2–3个worker，降低20%的延迟。', '占用 2.5 GB 内存，支持 2–3 个 worker，降低 20% 的延迟。'],
    ['带重音的西文与扩展汉字', '读取café文档与𠮷A接口。', '读取 café 文档与𠮷 A 接口。'],
    ['原有空白和段落', '使用 React\t调用 API\n\n支持3种模式。\r\n  保持缩进。', '使用 React\t调用 API\n\n支持 3 种模式。\r\n  保持缩进。'],
    ['中文标点', '调用（API），返回“JSON”；成功！', '调用（API），返回“JSON”；成功！'],
    ['内联代码', '执行`const 中文A = 1`命令，用``a`中文B``表示。', '执行 `const 中文A = 1` 命令，用 ``a`中文B`` 表示。'],
    ['代码块和未闭合代码', '使用API\n```ts\nconst 中文A = "v2中文";\n```\n说明B\n`保留C', '使用 API\n```ts\nconst 中文A = "v2中文";\n```\n说明 B\n`保留C'],
    ['波浪线代码块', '说明A\n~~~js\nconst 中文B=1;\n~~~\n结束C', '说明 A\n~~~js\nconst 中文B=1;\n~~~\n结束 C'],
    ['地址内部的中文路径和参数', '访问https://example.com/中文API?q=版本2，联系dev@example.com。', '访问 https://example.com/中文API?q=版本2，联系 dev@example.com。'],
    ['文件路径', '目录 /tmp/中文A/v2 和 C:\\目录A\\文件2 保留。使用API。', '目录 /tmp/中文A/v2 和 C:\\目录A\\文件2 保留。使用 API。'],
    ['Markdown 链接的标签与地址', '[中文API](https://example.com/中文API)及API说明', '[中文 API](https://example.com/中文API)及 API 说明'],
    ['英文原句', 'Use React with Node.js 22. Keep 20% and C++.', 'Use React with Node.js 22. Keep 20% and C++.'],
    ['清除临时译文的空字符串', '', ''],
  ])('%s：补齐边界间距且重复处理不会继续增加空格', (_name, input, output) => {
    expect(chineseSpacing(input)).toBe(output);
    expect(chineseSpacing(output)).toBe(output);
  });

  it('补空格会超出消息或词卡字段长度限制时保留完整内容，不截断或导致校验失败', () => {
    const text = '中A'.repeat(10000);
    expect(chineseSpacing(text)).toBe(text);
    expect(chineseSpacing('含API', 4)).toBe('含API');
  });

  it('词卡只整理中文释义、语境和中文例句，词头、音标、词性与英文例句逐字保留', () => {
    const card = { word: 'API', ipa: { us: '/ˌeɪ piː ˈaɪ/', uk: '/ˌeɪ piː ˈaɪ/' },
      senses: [{ partOfSpeech: 'noun', meaning: '调用API的接口' }], contextMeaning: '连接2个服务',
      examples: [{ en: 'Use the API.', zh: '使用API。' }] };
    const result = chineseCardSpacing(card);
    expect(result).toEqual({ ...card, senses: [{ partOfSpeech: 'noun', meaning: '调用 API 的接口' }],
      contextMeaning: '连接 2 个服务', examples: [{ en: 'Use the API.', zh: '使用 API。' }] });
    expect(card.senses[0]!.meaning).toBe('调用API的接口');
  });
});
