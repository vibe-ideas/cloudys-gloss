# Cloudy’s Gloss

轻量双语阅读扩展：全文与组件双语翻译、划词词卡、贴边悬浮球、图片 OCR、PDF 逐页阅读。WXT + TypeScript + Preact，同一套代码支持 Chrome/Chromium 和 Firefox。翻译使用用户配置的模型，默认连接本地 mlx-serve，也支持 Ollama 与 OpenAI-compatible API；不调用浏览器翻译或下载浏览器语言包。

[产品页与演示视频](https://vibe-ideas.github.io/cloudys-gloss/) · [下载最新版本](https://github.com/vibe-ideas/cloudys-gloss/releases/latest) · [Firefox 自动更新](docs/development/firefox-auto-update.md)

## 快速开始

需要 Node.js 24 或 22.13+、pnpm 10；本地 mlx-serve 需要 Apple Silicon、macOS 26.2+、Python 3.12+ 和 uv。

```sh
pnpm install
pnpm model:install  # 安装并启动本地 mlx-serve
pnpm model:bridge   # 允许插件按需启动模型
pnpm dev       # Chrome / Chromium
# 或 pnpm dev:firefox
```

点击网页右侧「译」开启双语，选中英文查看词卡。已有网页在安装后需刷新。

右键网页或图片可选择翻译/恢复原文；右键悬浮球打开快捷操作。图片优先在文章原位置显示译文，内嵌框架等无法原位处理时打开图片阅读页。

## 文档

- [文档目录](docs/README.md)
- [安装与使用](docs/guides/getting-started.md)
- [PDF 文件与在线链接双语阅读](docs/guides/pdf.md)
- [离线图片 OCR、翻译与原图对照](docs/guides/image-translation.md)
- [模型配置](docs/guides/models.md)
- [模型启动与 macOS 登录自启](docs/guides/model-service.md)
- [版本下载](https://github.com/vibe-ideas/cloudys-gloss/releases) · [自动发布流程](docs/development/releases.md)
- [架构](docs/development/architecture.md) · [开发与测试](docs/development/testing.md)
- [性能实测与模型选择](docs/performance/README.md)
- [最新质量调优与独立验收](docs/performance/2026-10-05-quality-tuning.md) · [质量回归用例](docs/development/translation-quality.md)
- [数据与权限](docs/reference/privacy.md)

详细说明、测试方法和性能报告统一在 `docs/` 分类维护；`artifacts/` 仅保留本地临时产物。
