# 启动本地模型与 macOS 登录自启

浏览器扩展和模型服务是两个独立程序。`pnpm dev`、`pnpm dev:firefox` 只启动扩展开发环境；安装本地助手后，扩展可以在翻译时按需启动模型，也可以在设置页手动启停。命中缓存的译文和词卡不需要启动模型。

默认模型为 `mlx-community/Qwen2.5-3B-Instruct-4bit`，运行在 Apple Silicon Mac 上。本指南的自启方式使用用户级 LaunchAgent：**开机并登录当前 macOS 账户后启动**，不需要保持终端打开；不是登录前运行的系统守护进程，不需要 sudo。[Apple 官方说明](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html)

## 安装前准备

需要 Apple Silicon macOS、Python 3（运行管理脚本）、Node.js 22.12+、pnpm 10、uv。已有 Homebrew 时可安装工具：

```sh
brew install uv python@3.12 node pnpm
pnpm install
```

所有 `pnpm` 命令都在项目目录中运行。不使用 Homebrew 时，uv 的其他安装方式见 [官方安装指南](https://docs.astral.sh/uv/getting-started/installation/)；Node.js / pnpm 按各自官方指南安装。

## 方式一：终端手动启动

```sh
pnpm model:mlx
```

第一次会安装 MLX 依赖并下载模型，需联网并等待完成；后续复用缓存。此终端需保持打开，Ctrl+C 停止。再开一个终端运行 `pnpm dev:firefox` 或 `pnpm dev`。

若已安装下面的自启服务，不要再运行 `pnpm model:mlx`，两者默认都占用 8080 端口。

## 方式二：安装后台服务并登录自启

先用 Ctrl+C 停止之前手动启动的服务，然后运行：

```sh
pnpm model:install
```

这个命令会安装独立环境（mlx-lm 0.32.0、mlx 0.32.3）、预下载默认模型、写入 LaunchAgent、立即启动并发送一次真实生成请求验证。已经安装时再次执行只恢复服务，不重复创建自启项。首次安装需要网络；成功后登录启动使用本地缓存，即使离线也可运行。

服务直接使用独立环境的绝对路径，不依赖项目目录、开发服务器、终端 PATH 或 uv 的临时运行环境。关闭终端、关闭浏览器或移动项目目录都不会停止它。独立环境使用的 uv 管理 Python 也应保留，不要手动删除其安装目录。

模型常驻会占用内存，当前默认在本机短上下文测试中约 2 GiB；更长上下文可能增加占用。自启并不是按需加载或空闲自动卸载。[内存实测](../performance/2026-10-04-mlx-models.md)

## 在浏览器中启动（推荐）

首次在项目目录安装模型服务和浏览器助手：

```sh
pnpm model:install
pnpm model:bridge
```

加载新版扩展，打开设置页的“本地模型服务”，即可启动、停止、重启、刷新状态，以及独立开启或关闭登录自启。**浏览器里的启动、停止不会修改登录自启偏好**；修改自启时，运行中的服务会重启。想只在翻译时运行，可先关闭登录自启，再停止模型。

“本地模型按需启动”默认开启：默认 MLX 连接不可达时，后台通过 Native Messaging 唤起助手，助手启动并验证模型生成，原来的翻译/词卡请求随后继续执行。多个请求会合并启动，取消请求不影响其他页面等待。普通 HTTP 错误不会触发启动其他进程。

自动启动仅匹配 `http://127.0.0.1:8080/v1` 或 `http://localhost:8080/v1` 上的默认模型，也接受对应 `/chat/completions` 地址。Ollama、远程地址、其他端口或模型保持原有连接方式。未安装助手且服务未运行时，扩展会显示安装提示；已运行的服务无需助手也能使用。

首次模型加载仍有等待时间。**当前没有空闲自动卸载**，启动后一直运行到主动停止；关闭登录自启时也不会自动恢复异常退出的模型进程。

助手目前支持 Apple Silicon macOS。安装器为 Firefox（含 Developer Edition）、Chrome、Chrome for Testing、Chromium 注册同一助手；Chrome 构建用固定公钥保持开发版扩展 ID 稳定。与旧版不同 ID 的 Chrome 扩展视为新安装，需要重新配置；Firefox ID 不变。今后商店分配的 ID 需要加入对应安装器白名单。

助手与脚本复制到 `~/Library/Application Support/CloudysGloss/native-host`，不依赖项目路径、不常驻进程。更新助手代码后重新运行 `pnpm model:bridge`；仅更新扩展不会同步更新本地脚本。`pnpm model:bridge:uninstall` 删除浏览器注册，不停止服务或删除模型。首次安装需要本机操作，扩展 ZIP 不能自己安装本地程序。

## 命令行管理

| 命令 | 行为 |
| --- | --- |
| `pnpm model:status` | 查看自启文件、launchd 状态、PID、禁用状态及日志位置 |
| `pnpm model:stop` | 停止服务并暂停登录自启，释放模型进程内存 |
| `pnpm model:start` | 恢复登录自启、启动服务并验证真实生成 |
| `pnpm model:uninstall` | 停止并移除自启配置；保留模型缓存、独立环境和日志 |

开启登录自启时，异常退出由 launchd 重新启动，重启频率受 30 秒节流限制。主动停止请用 `model:stop`，直接结束进程会触发自动重启。`status` 中 `disabled` 表示已暂停自启，`enabled` 表示已启用；部分 macOS 版本分别显示为 `true` / `false`，没有记录时使用系统默认状态。

## 扩展配置与验证

在扩展的模型设置中选择 **MLX-LM · 默认**，保存以下配置并点击“测试连接”：

| 配置 | 值 |
| --- | --- |
| Base URL | `http://127.0.0.1:8080/v1` |
| API Key | 留空 |
| Model | `mlx-community/Qwen2.5-3B-Instruct-4bit` |
| Temperature | `0` |
| Timeout | `120000` 毫秒 |
| Concurrency | `1` |

命令行可检查 HTTP 接口：

```sh
curl --fail http://127.0.0.1:8080/v1/models
```

模型列表返回成功只证明接口响应，不能代替真实生成验证。`model:install`、`model:start` 已包含生成验证；端到端浏览器检查可运行 `pnpm smoke:mlx`。

## 位置与排障

- 自启文件：`~/Library/LaunchAgents/com.cloudys-gloss.mlx.plist`
- 独立环境：`~/Library/Application Support/CloudysGloss/mlx-venv`
- 日志：`~/Library/Logs/CloudysGloss/mlx.stdout.log`、`mlx.stderr.log`
- 服务模型缓存：固定使用 `~/.cache/huggingface/hub`，安装和登录启动使用同一路径。

查看最近错误：

```sh
tail -n 80 ~/Library/Logs/CloudysGloss/mlx.stderr.log
```

**端口已占用**：先检查 `pnpm model:status`。若服务未加载，可能是手动启动的 MLX 或其他程序，使用 `lsof -nP -iTCP:8080 -sTCP:LISTEN` 找到来源后正常停止。管理脚本不会擅自结束未知进程。

**开机后没有启动**：确认已登录安装服务的账户，并查看“系统设置 → 通用 → 登录项与扩展”中是否禁止了该后台项目。执行 `pnpm model:start` 恢复并检查日志。

**启动报找不到模型**：自启刻意使用离线模式。不要清理正在使用的模型缓存；需要重新下载时先 `pnpm model:uninstall`，再 `pnpm model:install`。卸载自启不会删除缓存。

**切换模型**：当前管理命令固定管理默认 Qwen2.5 3B。测试其他模型使用独立端口，或先停止本服务再按 [模型配置](models.md) 手动启动。不要只修改扩展的 Model 字段就假定后台已经切换到对应模型。

模型自启不等于 Firefox 扩展永久安装：`about:debugging` 临时载入的扩展会在 Firefox 重启后消失，需重新加载；正式持久安装按 [安装与使用](getting-started.md) 的签名分发说明处理。
