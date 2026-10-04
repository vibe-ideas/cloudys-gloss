# Cloudy’s Gloss

轻量双语阅读扩展。WXT + TypeScript + Preact + Zod + idb，同一套代码生成 Chrome/Chromium MV3 与 Firefox MV2 扩展。

## 开发

需要 Node.js 22.12+ 和 pnpm 10。

```sh
pnpm install
pnpm dev
pnpm dev:firefox
```

WXT 自动打开独立浏览器配置并加载扩展。点击工具栏的 Cloudy’s Gloss →「模型设置」，保存配置并测试连接。打开普通网页后点击右侧「译」悬浮球（或工具栏中的「翻译当前网页」）；再次点击恢复原页面。悬浮球默认贴边露出一半，鼠标移近或键盘聚焦时展开，移开后收起；支持拖动换边，旁边的箭头菜单可查看进度、重试、打开模型设置或本页隐藏；位置随窗口大小避让。翻译等待时显示轻量呼吸圆点与占位条，译文逐段淡入；遵循系统减少动态效果设置。选中英文可直接查看词卡；Escape 或点击外部关闭。

浏览器内部页面、扩展商店、PDF 阅读器不支持内容脚本。安装或更新后，已有网页需要刷新。

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

## 架构

```text
网页内容脚本 / Preact Shadow DOM 词卡
                 │ runtime messaging / Port 分段回传
                 ▼
WXT background → 输入 Zod 校验 → IndexedDB cache
                 │ cache miss
                 ▼
全局并发队列 → OpenAICompatibleProvider → 本地服务 / 兼容 API
                 │ 输出 Zod 校验
                 └─ 结果缓存 → 页面按原位置插入译文
```

- **语义块**：段落、标题、列表项、表格单元格及纯文本容器；保留内联强调和链接。排除代码、表单、可编辑区域、`translate="no"`、隐藏标记和扩展自身 DOM。
- **视口调度**：IntersectionObserver 提前 500px 观察；屏幕内段落优先于预取区域；每批最多 2 段 / 1,800 字符，长段按 900 字符切分，每页最多两个在途批次。后台通过 runtime Port 在每个完整译文字符串生成后立即推送，长段完成的连续片段也先显示，不等同批或整段结束。短词卡只请求相关词义与一个例句。
- **逐段反馈**：视口附近的语义块显示等待／翻译中；已生成部分可先阅读，批次校验通过后取消加载标记。缓存命中先显示，单段失败可就地重试。
- **大页面扫描**：TreeWalker 按每片最多 200 个节点或 6ms 分片，让首屏发现后立即开始翻译。调度只遍历视口附近集合；进度更新在 24ms 窗口内合并 DOM 写入，不逐 token 测量布局。
- **增量更新**：MutationObserver 合并 24ms 内的局部变动；原文变化使旧译文失效。不会在每次 mutation 上重新扫描整个页面。
- **取消**：关闭翻译、关闭词卡、页面离开和标签关闭时取消任务；快速滚动到远处时取消全部已离开预取区域的批次，让新视口进入队列；队列中的任务也支持取消。以请求代次与原文快照拒绝迟到结果。
- **缓存**：idb / IndexedDB，最多 1,500 条，30 天过期。模型、地址、温度、凭据、文本/上下文均参与哈希键，不跨配置复用。存储不可用时仍可翻译。
- **词卡**：单页面单实例 Shadow DOM；Light / Dark / 系统主题；边缘避让、可滚动、加载态、错误与重试；所有模型字符串通过文本渲染。
- **词典扩展点**：`DictionaryProvider` 接口，可在后台组合本地词典与 LLM。当前 IPA 由 LLM 生成，可能不准确；发音使用浏览器 SpeechSynthesis，优先匹配本地 US / UK 系统语音。

全文关闭会移除扩展插入的节点，不重写或替换原文 HTML。SPA 中保留的段落沿用缓存，新增/变化的段落增量处理。第一版不遍历网页自身的 Shadow DOM、iframe 或虚拟化编辑器。

首次划词立即展示浮层与加载态，完整 IPA / 释义在模型返回后展示；缓存命中更快。模型推理耗时取决于本地硬件与服务负载。

## 校验与浏览器测试

```sh
pnpm check           # ESLint + TypeScript + Vitest
pnpm build
pnpm build:firefox
pnpm exec playwright install chromium firefox
pnpm test:e2e
```

E2E 使用本地 HTTP 模型夹具和真实扩展后台，不模拟 `runtime.sendMessage`，也不让内容脚本请求模型。页面夹具的 CSP 禁止页面网络请求。验证 2000 段页面在第二段响应被暂停时已经显示第一段、快速跳页尾取消旧流、关闭恢复原文，以及悬浮球切换、拖动不误触、窄屏边界、隐藏与恢复、语义 batching、视口延迟翻译、SPA 增量变化、恢复原文、缓存、词卡结构、CSS 隔离、明暗主题、窄屏位置和设置错误。

Chromium 用 Playwright 持久上下文加载生产构建。Firefox 用 Playwright 的 Firefox BiDi 和 Mozilla `web-ext` RDP 临时安装生产构建；由于 BiDi 不暴露扩展页面的执行上下文，测试副本附加打开设置页与 DOM 操作桥接脚本，操作实际设置页并经真实 runtime messaging 访问 background；发布构建不包含这些脚本。网页交互和断言仍由 Playwright 驱动。Firefox 设置页不生成截图。macOS 优先检测 Firefox Developer Edition，也可指定 `FIREFOX_BINARY`。所有测试均使用独立临时配置，不修改日常浏览器配置。

真实网关测试需要显式配置，可能产生服务用量：

```sh
MODEL_BASE_URL=http://127.0.0.1:3425/v1 \
MODEL_NAME=qoder-plugin/qmodel \
pnpm smoke:live
# 可选 MODEL_API_KEY、FIREFOX_BINARY
```

真实测试还会在 2000 段页面记录首段显示时间及首段出现前的最大 rAF 回调间隔（仅为响应性采样，不是完整性能分析），验证滚到页尾继续翻译，再验证中文译文、IPA 按钮、上下文释义与双语例句，并在 `artifacts/live` 保存截图。普通 E2E 截图与 HTML 报告位于 `test-results`、`playwright-report`。

## 手动安装生产构建

- Chrome/Chromium：`pnpm build`，在 `chrome://extensions` 开发者模式下加载 `.output/chrome-mv3`。
- Firefox 140+：`pnpm build:firefox`，在 `about:debugging#/runtime/this-firefox` 临时载入 `.output/firefox-mv2/manifest.json`。正式分发需 Firefox 签名。
- `pnpm zip` / `pnpm zip:firefox` 生成分发压缩包。

WXT 负责浏览器 API 和 manifest 差异，没有两套业务代码或手写完整 manifest。

## 数据与权限

HTTP(S) host permissions 用于网页注入和用户自行配置的模型地址（包括 localhost）。仅 background 发出模型请求，不把 API Key 通过消息传给内容脚本。Key 存储于本机扩展存储，不加密、不云同步；译文与词卡存储于本地 IndexedDB。选区/语义块以及词卡所需的附近上下文会发送到所配置的服务，不包含整个页面 HTML、URL 或页面 Cookie。没有遥测。Firefox manifest 声明 `websiteContent` 传输类别。

实现参考：[WXT 浏览器目标](https://wxt.dev/guide/essentials/target-different-browsers)、[Playwright 扩展测试](https://playwright.dev/docs/chrome-extensions)、[Firefox 数据传输声明](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/)。

## 大页面实测（2026-10-04）

本机 Apple Silicon，MLX Qwen2.5-3B-Instruct-4bit，温度 0、并发 1；模型已预热、扩展使用全新浏览器配置与空翻译缓存。2000 个短段落的本地测试页：Chrome 首段 475ms，Firefox 512ms，首段状态均为 partial（同批尚未完成）。首段出现前最大 rAF 间隔分别为 18ms、10ms。测试还确认跳到第 2000 段后可继续翻译并恢复原文。此结果不代表所有网站、长句或冷启动耗时，也不是译文质量评测。
