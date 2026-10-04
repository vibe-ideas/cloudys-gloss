# 连接本地模型与兼容 API

默认选择与实测依据见 [模型 TPS、内存和质量对比](../performance/2026-10-04-mlx-models.md)。本页维护连接方式；性能结果统一维护在 `docs/performance/`。

首次安装请先看 [模型启动与 macOS 登录自启](model-service.md)：`pnpm model:mlx` 手动启动，`pnpm model:install` 安装后台自启服务。启动扩展不会自动启动模型。

## 连接模型

| 服务 | Base URL 示例 | Model |
| --- | --- | --- |
| MLX-LM（默认） | `http://127.0.0.1:8080/v1` | `mlx-community/Qwen2.5-3B-Instruct-4bit` |
| Ollama | `http://localhost:11434/v1` | 已下载的模型，如 `qwen2.5:7b` |
| Magpie | `http://127.0.0.1:3425/v1` | 网关 `/v1/models` 返回的模型 ID |
| 其他兼容 API | 服务提供的 API 前缀（通常含 `/v1`） | 服务支持的模型 ID |

Ollama 示例：

```sh
ollama pull qwen2.5:7b
ollama serve
```

MLX-LM 本机测试（Apple Silicon，需要 [uv](https://docs.astral.sh/uv/getting-started/installation/)）：

```sh
pnpm model:mlx  # 启动服务，保持此终端运行
# 另一个终端：
pnpm smoke:mlx  # Chrome + Firefox 真实模型翻译、词卡与耗时测试
```

脚本使用独立 uv 环境中的 `mlx-lm==0.32.0` 和 `mlx-community/Qwen2.5-3B-Instruct-4bit`，监听 `127.0.0.1:8080`。首次运行会安装依赖并下载约 1.7 GB 权重，已缓存则复用。停止服务用 Ctrl+C。新安装默认连接这套 MLX 服务，温度 0、并发 1、超时 120 秒，API Key 留空；启动服务后即可在设置页测试连接。已有的自定义配置会保留，需要切换时点击 **MLX-LM · 默认 → 保存设置 → 测试连接**。测试连接会显示端到端耗时，首次模型加载需要额外时间。

使用其他 MLX 模型时，可自行运行 `mlx_lm.server --model <模型 ID> --host 127.0.0.1 --port 8080`，并在设置页填写相同模型 ID。接口选项参考 [MLX-LM 官方服务文档](https://github.com/ml-explore/mlx-lm/blob/main/mlx_lm/SERVER.md)。

扩展使用 `POST /chat/completions`。全文翻译默认开启 SSE 流式响应，词卡和连接测试使用完整 JSON 响应，显式设置 `max_tokens` 避免 MLX 默认 512 tokens 截断较长结果；达到输出上限时明确显示截断错误。支持完整 `/chat/completions` URL；不强制使用 `response_format`，方便兼容各类本地模型。全文批次 JSON 校验失败时，在原有超时与取消范围内，对每个语义块最多回退一次纯文本翻译；每完成一段就推送。词卡结构校验失败最多补问一次。未完成或不合法的结果不写入缓存。网络错误和输出截断不自动重试；服务以 HTTP 400/422 拒绝流式请求时只回退一次非流式请求，也兼容服务直接返回普通 JSON。API Key 可留空；需要鉴权时填写网关自己的 Key。Timeout 单位为毫秒，范围 1–300 秒。Concurrency 范围 1–8，所有页面共享，建议本地模型使用 1–2。
