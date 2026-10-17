import { describe, expect, it } from 'vitest';
import { needsChineseTranslation } from '../../src/core/source-language';

describe('网页语义块是否需要译为中文', () => {
  it.each([
    '这是一整段中文内容，不需要再翻译。',
    '這是一段繁體中文，保持原文即可。',
    '使用React构建API，支持3种模式。',
    'Kubernetes支持Docker',
    'API设置',
    '配置 PostgreSQL、Kubernetes 与 OpenTelemetry，然后开启服务。',
    '这里介绍 large language model 的常见用法。',
    '请安装 Windows Subsystem for Linux 后继续操作。',
    '访问 https://example.com/very/long/technical/path?q=english，联系 support@example.com。',
    '路径 /usr/local/bin/python3 保持不变。',
    '执行 `const a = "some English text here"` 后结束。',
    '2026年10月18日，版本2.5，增长20%。',
    '',
  ])('已有中文正文「%s」直接保留，技术名词、日期与地址不触发整段重译', text => {
    expect(needsChineseTranslation(text)).toBe(false);
  });

  it.each([
    'Read the original and discover another meaning.',
    'Store', 'API', 'Learn more', 'Café',
    'Read the 中文 guide before deployment.',
    'How to deploy Kubernetes? 中文说明',
    '这是一段很长的中文说明，但引用的英文句子仍需翻译：Please restart the server.',
    '下文详细说明原理。This is an English sentence that still needs translation.',
    'このAPIを使う',
  ])('实际包含外文内容「%s」仍参与翻译，不按整页语言一刀切', text => {
    expect(needsChineseTranslation(text)).toBe(true);
  });
});
