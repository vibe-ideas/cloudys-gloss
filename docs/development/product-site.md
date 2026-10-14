# 产品页与演示视频

公开地址：[Cloudy’s Gloss](https://vibe-ideas.github.io/cloudys-gloss/)。与扩展共用当前公开仓库。

## 页面

源码在 `site/`，纯 HTML、CSS、JavaScript，无运行时框架、外部字体或统计脚本。第三版采用深黑 / 冷白分区、大字号标题、细线边界和静态光环背景，保留折页 G 标记。设计与验收说明见 [产品页第三版](../design/product-page-v3.md)。

双语切换与词卡使用预置示例，并明确标记，不请求模型。手机导航支持键盘、Escape 关闭及焦点恢复；页面保留减少动态效果模式。首屏光感图形由 CSS 组成，没有 Canvas、WebGL 或持续的动画循环。

Firefox 下载使用固定 Release 附件入口；Chrome 优先解析 GitHub 最新 Release 的 ZIP，API 不可用时回退到 Release 页面。未签名包的安装限制在下载处说明。

```sh
python3 -m http.server 4420 --bind 127.0.0.1 --directory site
pnpm exec playwright test -c playwright.site.config.ts
node scripts/site-cover.mjs
python3 scripts/build-site.py
```

分享封面由实际页面确定性渲染，保存在 `site/assets/social-cover.png`。构建只复制白名单资源到 `.output/site`，不会部署脚本、测试与仓库文件。

## 部署

[Product Site 工作流](../../.github/workflows/site.yml) 在 `main` 上的页面、网站测试或构建脚本发生变化时运行。lint、类型检查、Chrome / Firefox 产品页测试全部通过后部署 Pages。PR 只检查，不部署。网站更新不增加扩展版本、不创建 Release，也不要求用户重装扩展。

原有 [CI and Release](../../.github/workflows/ci-release.yml) 仍负责完整扩展回归和版本发布，在标签发布成功或手动运行时也会部署随该提交保存的页面。两个部署任务共用 `github-pages` 并发组。

`github-pages` 环境允许 `main` 分支与 `v*` 标签。若版本标签部署在创建 runner 前失败，检查环境是否缺少发布标签规则，不要取消全部保护规则。

## 视频

30 秒、1280 × 720、24 fps 的无声 H.264 动画，配字幕、封面与原生播放器，不自动播放。第三版同步改成冷灰配色。视频是功能流程示意，不能作为模型速度或质量证据。

源码与渲染入口见 [site/video](../../site/video/README.md)。需要 Playwright Chromium 和 ffmpeg：

```sh
node site/video/render.mjs
# macOS PATH 中有其他 ffmpeg 时可显式指定
FFMPEG_PATH=/opt/homebrew/bin/ffmpeg node site/video/render.mjs
```

第一版曾按用户建议调用 Claude Code，但 CLI 在生成前返回会话额度耗尽。现有动画由 Codex 完成，未署名为 Claude 制作。
