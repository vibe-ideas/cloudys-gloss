# 更新本地永久安装的 Firefox 扩展

开发完成后，在项目目录运行：

```sh
pnpm update:firefox
```

命令依次运行 lint、类型检查、Vitest，再构建 Firefox 生产 ZIP，检查压缩包完整性、版本和扩展 ID，生成 XPI 并在日常使用的 Firefox Developer Edition 中打开。若浏览器显示安装或更新提示，确认后刷新网页即可。检查或构建失败会停止，不继续安装旧包。

自动打开目前支持 macOS，默认应用为 `/Applications/Firefox Developer Edition.app`。需要 Python 3、pnpm 和已安装的项目依赖。浏览器必须已允许安装本项目的未签名扩展；脚本不修改签名设置。多个 Firefox 配置同时运行时，请确认安装提示出现在你希望更新的配置中。

产物路径：

```text
.output/local-install/cloudys-gloss-<version>-firefox-unsigned.xpi
```

安装使用原扩展 ID，不需要卸载旧版，可保留扩展设置；命令不会修改 `package.json` 版本、创建 Git 标签或发布 GitHub Release。同版本的本地修改通过主动打开 XPI 重新安装更新，不依赖 Firefox 的在线版本检查。

这是一条手动触发的本地更新命令，不会监视源码自动安装。开发调试时继续使用 `pnpm dev:firefox`，它管理独立的测试浏览器并自动重载内容。

## 可选参数

仅检查和生成 XPI（可在其他平台运行），不打开浏览器：

```sh
pnpm update:firefox --no-open
```

开发者版安装在其他位置：

```sh
pnpm update:firefox --firefox-app "$HOME/Applications/Firefox Developer Edition.app"
```

若本次开发同时修改了系统发音或模型管理助手，还需要运行 `pnpm model:bridge` 更新助手。扩展 XPI 不包含本地助手和模型。

Firefox 的本地 XPI 安装入口见 [Mozilla 官方说明](https://extensionworkshop.com/documentation/publish/install-self-distributed/)。
