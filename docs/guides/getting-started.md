# 安装与使用

## 先启动本地模型

扩展本身不包含模型。Apple Silicon Mac（macOS 26.2+）安装 uv 和 Python 3.12+ 后，在项目目录执行：

```sh
pnpm install
pnpm model:install  # 安装并启动 mlx-serve
pnpm model:bridge   # 注册浏览器启停助手
```

模型准备好后，启动下方的浏览器扩展。服务默认登录 macOS 后自动启动；也可以在扩展设置里关闭登录自启，改为翻译时按需启动。完整安装、迁移、停止和卸载步骤见 [模型启动与登录自启](model-service.md)。其他平台见 [Ollama 与模型配置](models.md)。

## 开发

需要 Node.js 24 或 22.13+，以及 pnpm 10。

```sh
pnpm install
pnpm dev
pnpm dev:firefox
```

WXT 自动打开独立浏览器配置并加载扩展。点击工具栏的 Cloudy’s Gloss →「模型设置」，保存配置并测试连接。打开普通网页后点击右侧「译」悬浮球（或工具栏中的「翻译当前网页」）；再次点击恢复原页面。悬浮球默认贴边露出一半，鼠标移近或键盘聚焦时展开，移开后收起；支持拖动换边，旁边的箭头菜单可查看进度、重试、打开模型设置或本页隐藏；位置随窗口大小避让。翻译等待时显示轻量呼吸圆点与占位条，译文逐段淡入；遵循系统减少动态效果设置。选中英文可直接查看词卡；Escape 或点击外部关闭。

浏览器内部页面和扩展商店不支持内容脚本。PDF 使用独立双语阅读器：点击扩展弹窗里的「打开 PDF 文件或链接」，支持本地文件、在线链接和逐页翻译，见 [PDF 使用说明](pdf.md)。安装或更新后，已有网页需要刷新。

## 手动安装生产构建

- Chrome/Chromium：`pnpm build`，在 `chrome://extensions` 开发者模式下加载 `.output/chrome-mv3`。
- Firefox 140+：`pnpm build:firefox`，在 `about:debugging#/runtime/this-firefox` 临时载入 `.output/firefox-mv2/manifest.json`。正式分发需 Firefox 签名。
- `pnpm zip` / `pnpm zip:firefox` 生成分发压缩包。

WXT 负责浏览器 API 和 manifest 差异，没有两套业务代码或手写完整 manifest。
