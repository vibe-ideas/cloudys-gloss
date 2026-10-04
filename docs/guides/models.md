# 连接本地模型与兼容 API

默认服务的实测见 [mlx-serve 迁移对比](../performance/2026-10-05-mlx-serve.md)，模型选择依据见 [模型 TPS、内存和质量对比](../performance/2026-10-04-mlx-models.md)。本页维护连接方式；性能结果统一维护在 `docs/performance/`。

首次安装请先看 [模型启动与 macOS 登录自启](model-service.md)：`pnpm model:install` 安装后台服务，`pnpm model:bridge` 注册浏览器助手后支持翻译时按需启动。

## 连接模型

| 服务 | Base URL 示例 | Model |
| --- | --- | --- |
| mlx-serve（默认） | `http://127.0.0.1:8080/v1` | `Qwen/Qwen3-1.7B-MLX-4bit` |
| Ollama | `http://localhost:11434/v1` | 已下载的模型，如 `qwen2.5:7b` |
| Magpie | `http://127.0.0.1:3425/v1` | 网关 `/v1/models` 返回的模型 ID |
| 其他兼容 API | 服务提供的 API 前缀（通常含 `/v1`） | 服务支持的模型 ID |

Ollama 示例：

```sh
ollama pull qwen2.5:7b
ollama serve
```

mlx-serve 本机测试（Apple Silicon、macOS 26.2+、Python 3.12+ 和 [uv](https://docs.astral.sh/uv/getting-started/installation/)）：

```sh
pnpm model:install
pnpm model:bridge
pnpm smoke:mlx  # Chrome + Firefox 真实翻译、词卡与耗时测试
```

安装器使用 [ddalcu/mlx-serve v26.10.1](https://github.com/ddalcu/mlx-serve/releases/tag/v26.10.1) 官方原生程序，校验 SHA256，复用 Qwen3 1.7B 的本地权重缓存。默认监听 `127.0.0.1:8080`，温度 0、并发 1、超时 120 秒，API Key 留空。旧版本升级需重新执行 `pnpm model:install` 和 `pnpm model:bridge`，同步服务与浏览器助手。扩展会迁移旧的本地默认预设；远程及自定义模型配置保留。需要手动切换时点击 **mlx-serve · 默认 → 保存设置 → 测试连接**。测试连接会执行真实生成并显示端到端耗时。

其他模型需先下载 mlx-serve 支持的权重，然后单独启动，例如（替换权重路径）：

```sh
"$HOME/Library/Application Support/CloudysGloss/mlx-serve/26.10.1/mlx-serve" \
  --model /absolute/path/to/model --serve --host 127.0.0.1 --port 8081 \
  --ctx-size 8192 --max-concurrent 1
```

在设置页填写该端口及 `/v1/models` 返回的模型 ID。浏览器助手只管理默认 8080 服务，不会替其他端口切换模型。支持架构与参数见 [官方模型文档](https://github.com/ddalcu/mlx-serve/blob/v26.10.1/docs/models.md) 和 [CLI 文档](https://github.com/ddalcu/mlx-serve/blob/v26.10.1/docs/cli.md)。

扩展使用 `POST /chat/completions`。全文翻译与连接测试使用 SSE 流式响应；词卡使用完整 JSON 响应并通过 Zod 校验后显示，显式设置 `max_tokens` 避免 MLX 默认 512 tokens 截断较长结果；达到输出上限时明确显示截断错误。支持完整 `/chat/completions` URL；不强制使用 `response_format`，方便兼容各类本地模型。全文批次 JSON 校验失败时，在原有超时与取消范围内，对每个语义块最多回退一次纯文本翻译；每完成一段就推送。词卡结构校验失败最多补问一次。未完成或不合法的结果不写入缓存。网络错误和输出截断不自动重试；服务以 HTTP 400/422 拒绝流式请求时只回退一次非流式请求，也兼容服务直接返回普通 JSON。API Key 可留空；需要鉴权时填写网关自己的 Key。Timeout 单位为毫秒，范围 1–300 秒。Concurrency 范围 1–8，所有页面共享，建议本地模型使用 1–2。

本轮调优选择与已知质量限制见 [质量调优报告](../performance/2026-10-05-quality-tuning.md)。固定本地运行参数关闭思考、温度 0；不要把 JSON 成功率当作翻译准确率。
