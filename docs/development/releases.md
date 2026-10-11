# GitHub CI 与版本发布

只想更新自己日常使用的 Firefox 开发者版：运行 `pnpm update:firefox`，见 [本地永久安装更新](local-firefox-update.md)。

工作流为 [ci-release.yml](../../.github/workflows/ci-release.yml)。发布位置：[GitHub Releases](https://github.com/vibe-ideas/cloudys-gloss/releases)。本流程发布下载包，不提交 Chrome Web Store 或 Mozilla AMO，也不会自动获得 Firefox 签名。

## 触发方式

| 操作 | 结果 |
| --- | --- |
| 向 `main` 推送或创建 PR | 检查、双浏览器 E2E、打包；产物保留 14 天，不发布版本 |
| 推送 `v0.1.0` 形式的标签 | 上述步骤全部通过后创建 GitHub Release |
| Actions 页面手动运行工作流 | 检查、打包并部署产品页，不创建 Release，即使手动选择标签也是如此 |

标签必须严格等于 `v` 加 `package.json` 的 version。当前只支持三段数字的正式版本，例如 `0.1.1`；不接受 `-beta` 等后缀，避免生成浏览器不接受的 manifest 版本。每段不超过 65535，不能全部为零。

## 发布新版本

先在干净工作区完成业务修改与验证，确认 `main` 已同步。可用 Node 自带的 npm 命令只修改版本并生成版本提交、标签（不使用 npm 安装依赖）：

```sh
pnpm check
pnpm test:e2e
npm version patch -m "chore: release v%s"
git push origin main
git push origin v0.1.1  # 填入上一条命令输出的实际标签
```

也可手工修改 `package.json` 版本、提交后创建对应标签。首次发布当前 `0.1.0` 无需升版，直接在已验证提交上创建 `git tag -a v0.1.0 -m "Release v0.1.0"` 并推送该标签。

工作流依次执行：

1. 使用锁文件安装依赖，Node.js 24、Python 3.12、packageManager 指定的 pnpm。
2. `pnpm check`：lint、TypeScript、Vitest 单元测试。
3. 安装 Playwright Chromium 和 Mozilla 官方 Firefox（通过 BiDi 自动化），构建后先验证原生标签页可见性，再执行完整 Playwright E2E，实际加载两个浏览器的扩展。使用仓库模拟模型服务，不依赖 Mac、MLX 或付费 API。
4. 产品页通过 Chrome / Firefox 移动与桌面宽度、键盘操作、资源加载测试。WXT 分别构建 ZIP，发布脚本检查 ZIP 完整性、内置 manifest 版本、MV3/MV2 类型和 Firefox ID，并生成 SHA-256 校验和。
5. 生成同内容 XPI 和 Firefox 原生更新清单，校验内置更新地址并写入 XPI 的 SHA-256。发布任务下载同一次运行的产物、复核校验和，创建草稿、上传附件，最后公开发布。更新说明包含安装方法并追加 GitHub 自动生成的变更记录。
6. 发布成功后部署 [GitHub Pages 产品页](https://vibe-ideas.github.io/cloudys-gloss/)，普通 main 推送不会部署。

发布任务才拥有 `contents: write`；普通检查和 PR 只有读取权限。使用 GitHub 自动提供的 `GITHUB_TOKEN`，无需新增仓库密钥。第三方 Actions 固定到提交 SHA。

## 下载内容

- `cloudys-gloss-<version>-chrome.zip`：解压后在 `chrome://extensions` 中“加载已解压的扩展程序”。
- `cloudys-gloss-<version>-firefox-unsigned.zip`：明确为未签名包，解压后在 `about:debugging` 临时载入 manifest；Firefox 重启后需重新加载。不是可永久安装的签名 XPI。
- `cloudys-gloss-firefox-unsigned.xpi`：允许未签名扩展的 Firefox Developer Edition 可永久安装；从 0.1.10 起包含原生自动更新地址。普通 Firefox 需要另行签名，见 [自动更新说明](firefox-auto-update.md)。
- `firefox-updates.json`：稳定 HTTPS 更新入口，指向带版本号的 Release XPI，并包含 SHA-256。
- `SHA256SUMS`：在下载目录运行 `shasum -a 256 -c SHA256SUMS`（macOS）或 `sha256sum -c SHA256SUMS`（Linux）。
- Source code：GitHub 根据版本标签自动提供仓库源码下载。

安装包不包含模型。启动模型与 macOS 登录自启见 [模型服务](../guides/model-service.md)。

WXT 的额外 Firefox 源码 ZIP 采用构建源码白名单，避免把本地 `artifacts/`、日志、测试产物或密钥文件带入；本流程不上传该额外 ZIP，GitHub Release 使用标签源码归档。

## 浏览器测试环境

CI 使用 Mozilla 官方 Firefox，通过 BiDi 驱动，并显式配置桌面鼠标与 hover 能力。有界面测试保留真实标签页可见性，验证后台标签暂停翻译。

Chromium 原生窗口启动最多等待 30 秒，同时读取启动日志和 `DevToolsActivePort` 获取调试端点；超时或异常退出会附带最近的浏览器日志。Linux 启动参数避免受共享内存容量限制。测试结束时，即使浏览器关闭报错，也会停止独立进程并清理服务；临时目录删除只对文件系统瞬时错误做有限重试，不重试或忽略测试断言。

## 失败与重跑

- 检查或 E2E 失败：不会进入发布任务；从 Actions 下载 `browser-test-results` 查看报告和截图。修改实现后使用新的版本标签，不强推覆盖已经公开的版本。
- 标签与版本号不一致：在依赖安装前失败，不会发布命名正确但内部版本错误的安装包。
- 上传中断：Release 保持草稿。修复外部问题后重跑该次工作流，可补传草稿附件。
- 已公开 Release：同一标签再次执行会明确失败，不覆盖已发布附件。需要修复时发布下一版本。
- 没有浏览器商店凭据也能完成此流程。后续接商店需先创建商店条目，再配置 WXT 提交所需凭据；不要把凭据写进仓库。[WXT 官方发布说明](https://wxt.dev/guide/essentials/publishing.html)

本地只检查打包、不发布：

```sh
pnpm zip
pnpm zip:firefox
python3 scripts/release.py --tag v0.1.0
```

结果在 `.output/release/`；这个目录和本地模型、机器日志不会提交到 Git。
