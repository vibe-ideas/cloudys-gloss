# Firefox 原生自动更新

从 0.1.10 起，Firefox manifest 使用稳定的 `browser_specific_settings.gecko.update_url`，配置统一维护在 [data/firefox-update.json](../../data/firefox-update.json)。当前仓库公开，浏览器无需 GitHub Token。

## 安装与升级

1. 下载 [最新 XPI](https://github.com/vibe-ideas/cloudys-gloss/releases/latest/download/cloudys-gloss-firefox-unsigned.xpi)。在已允许未签名扩展的 Firefox Developer Edition 中，通过附加组件管理器的「从文件安装附加组件」覆盖安装。
2. 0.1.9 及以前的包没有更新地址，必须做一次上述安装。扩展 ID 保持不变，覆盖安装保留设置。
3. 在扩展管理器保持「自动更新」开启。Firefox 定期检查，也可使用齿轮菜单「检查更新」主动触发。发布后不保证立即更新。

临时载入的扩展不适用；普通 Firefox 正式版需要 Mozilla 签名，当前公开 XPI 仍未签名。公开仓库不等同于商店上架或签名。脚本不修改日常浏览器的签名设置。

## 发布链路

推送版本标签 → 全部检查通过 → 构建 XPI → 生成更新清单 → 校验附件 → 公开 Release。

稳定清单地址是 `https://github.com/vibe-ideas/cloudys-gloss/releases/latest/download/firefox-updates.json`。每个清单指向带版本号的 XPI URL，附带 SHA-256 校验；不依赖 Pages 部署。新包也必须包含同一稳定更新地址，否则发布脚本拒绝打包。扩展 ID 为 `cloudys-gloss@local.dev`。

同版本不会由在线更新替换；本地开发修改使用 `pnpm update:firefox`。已公开附件不覆盖，修复时增加版本。回滚发布应采用更高版本号。

## 验证

```sh
pnpm exec vitest run tests/unit/firefox-updates.test.ts tests/unit/release.test.ts tests/unit/update-firefox.test.ts
pnpm zip
pnpm zip:firefox
python3 scripts/release.py --tag v0.1.10
```

单测覆盖版本、扩展 ID、HTTPS 地址、清单与包的一致性和 XPI 哈希。它们不能代替浏览器升级验收。

版本公开后，可在本机运行真实下载与升级验收：

```sh
python3 tests/updates/firefox-native.py
# 非默认路径用 --firefox /path/to/firefox；版本用 --expected 0.1.10
```

测试在临时配置中永久安装低版本夹具，调用 Firefox 原生更新检查，通过公开清单下载正式 XPI，验证版本与原有模型设置，并重启验证持久化。夹具具有同一扩展 ID、权限和更新地址；它不是 0.1.9 原包，因此不代表旧包能免覆盖安装迁移。仅测试子进程允许未签名扩展和系统自动化访问，不触碰日常浏览器配置。首次清单尚未发布时，可用 `--install-only` 只检查夹具安装。

## v0.1.10 验收记录（2026-10-12）

- [CI 与发布运行](https://github.com/vibe-ideas/cloudys-gloss/actions/runs/38164624495)：382 项单测、18 项原生交互检查、116 项扩展 E2E、8 项产品页测试通过。扩展 E2E 另有 2 项既有 Firefox 站点 DOM 用例按配置跳过。
- macOS 上的 Firefox Developer Edition 158.0b5：运行 `python3 tests/updates/firefox-native.py`，低版本夹具通过公开 HTTPS 更新清单升级到真实 Release 的 0.1.10。扩展永久安装且启用，模型设置保留，退出重启后再次通过版本、启用状态和设置断言。
- 上述结果来自隔离测试配置，不代表用户日常配置已经完成安装。日常 Firefox 已收到本地 XPI 打开请求，但窗口自动化接口超时，无法代替用户确认安装结果。

## v0.1.14 验收记录（2026-10-21）

- [Release](https://github.com/vibe-ideas/cloudys-gloss/releases/tag/v0.1.14) 与 [发布 CI](https://github.com/vibe-ideas/cloudys-gloss/actions/runs/39578309496) 已公开且成功。534 项单测、18 项真实窗口交互检查、184 项扩展 E2E、14 项产品页测试通过，另有 4 项既有用例按配置跳过。
- 公开 `latest/download/firefox-updates.json` 已指向 0.1.14，实际下载 XPI 并核验 SHA-256、manifest 版本及稳定更新地址。
- macOS Firefox Developer Edition 执行 `python3 tests/updates/firefox-native.py --expected 0.1.14`：临时配置中的 0.0.1 低版本夹具通过 Firefox 原生更新升级至公开的 0.1.14，永久安装、启用状态及原模型设置检查通过；重启后再次通过。
- 该验证不读取或修改日常 Firefox 配置，不能据此声称用户日常安装已经更新。日常永久安装可等待原生自动检查，或在附加组件管理器中主动“检查更新”。
- v0.1.13 的发布流程已取消，未公开 Release。0.1.14 修正了旧词卡测试仍等待“释义准备中”的过时预期，并保留离线音标、模型队列隔离、释义保留和词卡位置的断言。

Mozilla 参考：[更新扩展](https://extensionworkshop.com/documentation/manage/updating-your-extension/) · [自行分发](https://extensionworkshop.com/documentation/publish/self-distribution/)。
