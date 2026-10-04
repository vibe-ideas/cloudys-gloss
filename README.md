# Cloudy’s Gloss

轻量双语阅读扩展：全文双语翻译、划词词卡、贴边悬浮球。WXT + TypeScript + Preact，同一套代码支持 Chrome/Chromium 和 Firefox；默认连接本地 MLX，也支持 Ollama 与 OpenAI-compatible API。

## 快速开始

需要 Node.js 22.12+、pnpm 10；本地 MLX 需要 Apple Silicon 和 uv。

```sh
pnpm install
pnpm model:mlx  # 单独终端，保持运行
pnpm dev       # Chrome / Chromium
# 或 pnpm dev:firefox
```

点击网页右侧「译」开启双语，选中英文查看词卡。已有网页在安装后需刷新。

## 文档

- [文档目录](docs/README.md)
- [安装与使用](docs/guides/getting-started.md)
- [模型配置](docs/guides/models.md)
- [架构](docs/development/architecture.md) · [开发与测试](docs/development/testing.md)
- [性能实测与模型选择](docs/performance/README.md)
- [翻译质量对比](docs/performance/2026-10-04-translation-quality.md) · [质量回归用例](docs/development/translation-quality.md)
- [数据与权限](docs/reference/privacy.md)

详细说明、测试方法和性能报告统一在 `docs/` 分类维护；`artifacts/` 仅保留本地临时产物。
