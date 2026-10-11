# 产品页与演示视频

公开地址：[Cloudy’s Gloss](https://vibe-ideas.github.io/cloudys-gloss/)。与扩展共用当前仓库，不创建独立仓库。

## 页面

源码在 `site/`，纯 HTML、CSS、JavaScript，无运行时框架、外部字体或统计脚本。米白纸面、墨色文字、荧光绿标记配合原有紫色 Logo，围绕「阅读、理解、表达」组织内容。双语切换与词卡使用预置示例，明确标记为演示，不请求模型。

Firefox 下载使用固定 Release 附件入口；Chrome 优先解析 GitHub 最新 Release 的 ZIP，API 不可用时回退到 Release 页面。页面说明未签名包的安装限制，不暗示已上架商店。

```sh
python3 -m http.server 4420 --bind 127.0.0.1 --directory site
pnpm exec playwright test -c playwright.site.config.ts
python3 scripts/build-site.py
```

构建仅复制白名单资源至 `.output/site`。CI 检查移动端、桌面端、双语恢复、词卡 Escape/焦点恢复、减少动态效果、下载降级和媒体资源。Pages 在标签发布成功后部署，也可手动运行 CI；main 推送仅检查。

Pages 的 `github-pages` 环境保留分支/标签限制：允许 `main` 分支和 `v*` 标签。新建 Pages 时 GitHub 默认只允许 main；若版本标签部署在创建 runner 前失败，检查环境规则中是否缺少发布标签，不要取消全部保护规则。

## 视频

30 秒、1280 × 720、24 fps 的无声 H.264 动画，配有字幕、封面与原生播放器，不自动播放。视频是功能流程示意，不能作为模型速度或质量证据。

源码、渲染入口与复现说明见 [site/video](../../site/video/README.md)。需要 Playwright Chromium 和 ffmpeg：

```sh
node site/video/render.mjs
# macOS PATH 中有其他 ffmpeg 时可显式指定
FFMPEG_PATH=/opt/homebrew/bin/ffmpeg node site/video/render.mjs
```

本次按用户建议调用过 Claude Code，但 CLI 在生成前返回会话额度耗尽。当前动画由 Codex 完成，未署名为 Claude 制作；源文件可供后续继续修改。
