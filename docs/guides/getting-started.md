# 安装与使用

## 开发

需要 Node.js 22.12+ 和 pnpm 10。

```sh
pnpm install
pnpm dev
pnpm dev:firefox
```

WXT 自动打开独立浏览器配置并加载扩展。点击工具栏的 Cloudy’s Gloss →「模型设置」，保存配置并测试连接。打开普通网页后点击右侧「译」悬浮球（或工具栏中的「翻译当前网页」）；再次点击恢复原页面。悬浮球默认贴边露出一半，鼠标移近或键盘聚焦时展开，移开后收起；支持拖动换边，旁边的箭头菜单可查看进度、重试、打开模型设置或本页隐藏；位置随窗口大小避让。翻译等待时显示轻量呼吸圆点与占位条，译文逐段淡入；遵循系统减少动态效果设置。选中英文可直接查看词卡；Escape 或点击外部关闭。

浏览器内部页面、扩展商店、PDF 阅读器不支持内容脚本。安装或更新后，已有网页需要刷新。

## 手动安装生产构建

- Chrome/Chromium：`pnpm build`，在 `chrome://extensions` 开发者模式下加载 `.output/chrome-mv3`。
- Firefox 140+：`pnpm build:firefox`，在 `about:debugging#/runtime/this-firefox` 临时载入 `.output/firefox-mv2/manifest.json`。正式分发需 Firefox 签名。
- `pnpm zip` / `pnpm zip:firefox` 生成分发压缩包。

WXT 负责浏览器 API 和 manifest 差异，没有两套业务代码或手写完整 manifest。
