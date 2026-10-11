# 产品演示视频

30 秒、1280×720、24 fps、无声 H.264 MP4。画面使用预置示例，不是模型速度实录；网页提供字幕与文字说明。

Claude Code 已尝试调用，但当时会话额度用尽（提示 03:40 恢复），没有生成文件。当前版本由 Codex 制作，不署名为 Claude Code 作品。

在仓库根目录安装项目依赖及 Playwright Chromium，并确保 ffmpeg 可用，然后运行：

```sh
node site/video/render.mjs
```

可以通过 `FFMPEG_PATH=/path/to/ffmpeg` 指定可用的编码器。

输出 `site/assets/demo.mp4` 与 `demo-poster.jpg`。`film.html` 的 `renderAt(seconds)` 提供确定性逐帧渲染；脚本不访问第三方素材或生成服务。
