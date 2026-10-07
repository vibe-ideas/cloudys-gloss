# 文档目录

## 使用指南

- [导入、管理与使用离线 StarDict 词库](guides/dictionary-import.md)
- [安装、开发启动与网页操作](guides/getting-started.md)
- [MLX、Ollama 与兼容 API 配置](guides/models.md)
- [模型启动、macOS 登录自启与停止卸载](guides/model-service.md)
- [PDF 文件、在线链接与逐页双语阅读](guides/pdf.md)

## 开发维护

- [架构与性能设计](development/architecture.md)
- [单元测试、浏览器 E2E 与真实模型测试](development/testing.md)
- [GitHub CI、版本标签与自动发布](development/releases.md)
- [翻译质量回归与模型切换](development/translation-quality.md)
- [数据与权限](reference/privacy.md)

## 体验设计

- [PDF 原版式对照、长译文和视觉验证](design/2026-10-05-pdf-layout.md)

- [页眉、常见组件与 PDF 体验修复](design/2026-10-05-components-pdf.md)
- [全文双语排版与视觉回归](design/bilingual-reading.md)
- [多样化网页体验测试与修复](design/2026-10-05-diverse-web-ux.md)
- [Apple 产品页真实浏览验收与待修问题](design/2026-10-05-apple-product-review.md)

## 技术调研

- [GoldenDict 词库生态、科技义项与双浏览器读取实测](research/2026-10-07-goldendict.md)
- [轻量离线词典覆盖与存储对比](research/2026-10-07-lightweight-dictionaries.md)
- [PDF 原版式翻译：竞品、BabelDOC、PDF.js 与实现取舍](research/2026-10-05-pdf-layout.md)

## 性能

- [PDF 原版式首屏、逐块回填与画布预算](performance/2026-10-05-pdf-layout.md)

- [报告索引、指标口径与模型选择](performance/README.md)
- [常见组件、大页面调度与 PDF 资源开销](performance/2026-10-05-components-pdf.md)
- [三模型翻译质量与逐例对照](performance/2026-10-04-translation-quality.md)
- [M4 Pro：MLX 与 llama.cpp 对比](performance/2026-10-04-backends.md)
- [M4 Pro：MLX 模型 TPS 与内存对比](performance/2026-10-04-mlx-models.md)
- [2000 段大页面实测](performance/2026-10-04-large-page.md)

## 维护约定

README 只保留项目简介、最短启动步骤和文档入口。使用说明放 `guides/`，开发说明放 `development/`，权限等参考信息放 `reference/`，性能报告按日期放 `performance/`，体验规范和经审阅的公共夹具示意图放 `design/`。

可执行测试、活跃语料和翻译质量基线统一放 `tests/`：质量用例在 `tests/quality/`，性能脚本及公共输入在 `tests/performance/`。`performance/data/` 保留此前性能报告的历史证据；文档链接测试源，不再维护第二份活跃语料。原始机器日志、浏览器截图、临时 HTML 和模型文件保留在被忽略的 `artifacts/` 或本机模型缓存中。归档前去掉本机用户名、凭据和私有请求内容。新增报告必须说明设备、模型版本、缓存、重复次数、统计方式和限制，并更新索引。
