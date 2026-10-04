# 2000 段大页面实测

日期：2026-10-04。本机 Apple Silicon，MLX Qwen2.5-3B-Instruct-4bit，温度 0、并发 1；模型已预热，扩展使用全新浏览器配置和空翻译缓存。

| 指标 | Chrome | Firefox |
| --- | ---: | ---: |
| 首段显示 | 475 ms | 512 ms |
| 首段出现前最大 rAF 回调间隔 | 18 ms | 10 ms |
| 首段出现时同批次状态 | partial | partial |

测试页面包含 2000 个短段落。首段出现时同批尚未完成，说明译文会逐段显示；测试也确认滚到第 2000 段后继续翻译，以及关闭后恢复原文。

## 复现

```sh
pnpm model:mlx
# 另一个终端
pnpm smoke:mlx
```

脚本位于 [scripts/live.spec.ts](../../scripts/live.spec.ts)，输入夹具位于 [tests/e2e/server.ts](../../tests/e2e/server.ts)。测试命令会构建双浏览器扩展并保存本机截图到 `artifacts/live/`。离线可重复的流式时序断言见 [tests/e2e/large-page.spec.ts](../../tests/e2e/large-page.spec.ts)，通过 `pnpm test:e2e` 运行。

## 限制

这里记录的是先前单次真实模型 smoke run，不是多轮中位数或 P95。rAF 最大间隔只是在首段出现前的短窗口内采样，不是完整性能分析。结果不代表所有网站、长句、冷启动或翻译质量。截图和 HTML 为本地临时产物，没有作为公开数据提交；本报告记录当时测量值，重新运行可能不同。
