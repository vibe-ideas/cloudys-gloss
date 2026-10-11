# Cloudy’s Gloss 标识

## 第二版：Gloss G 与书页折角 · 2026-10-12

当前版本使用墨色方章、荧光绿 G 和紫色折角。G 对应 Gloss，内侧横笔与右上折角借用阅读注解和书页的形态；去掉通用云朵轮廓，让工具栏里的标记更容易辨认。保留页面现有的紫色交互色，Logo 与产品页的纸面、墨色、荧光绿相呼应。

- 图形唯一来源：[data/brand-mark.json](../../../data/brand-mark.json)，只有两个实心路径，无字体、渐变、滤镜、外部引用或运行时请求。
- [生产图形预览](brand-v2-preview.png) · [16–64 px 深浅色预览](toolbar-icons.png) · [imagegen 视觉探索](cloudys-gloss-board-v2.png)。探索稿用于设计方向，实际资产以确定性的矢量路径为准。
- `pnpm icons:build` 同时更新 `public/icon/source.svg`、9 档工具栏 PNG、`site/assets/logo.svg` 和预览。正常扩展构建使用已提交的资源，无需现场生成图标。
- 扩展 Popup、设置页、PDF 页及悬浮球共用 [BrandMark](../../../src/ui/brand-mark.tsx)，直接读取同一图形数据。悬浮球忙碌时只轻微呼吸折角，减少动态效果模式仍会停用动画。
- 产品视频需重新运行 `FFMPEG_PATH=/opt/homebrew/bin/ffmpeg node site/video/render.mjs`，同步片头、片尾、阅读演示和封面。

色值：墨色 `#25261F`、荧光绿 `#DFFF72`、折角紫 `#B6A0FF`。不依赖颜色区分交互状态；翻译状态继续使用文字、进度环及状态标记。

本次使用内置 imagegen 生成视觉探索，随后将几何轮廓整理为可维护的 SVG 数据。最终图标由 Playwright Chromium 从 SVG 导出，不使用生成图中的纹理和字标。

### 第二版探索提示词

```text
Use case: logo-brand exploration. Create one distinctive new identity concept for Cloudy’s Gloss, a bilingual reading browser extension. Replace the old generic cloud with a custom 'double-page G' monogram: a confident thick geometric capital G, open at upper right, with its inner horizontal stroke suggesting a second translated reading line; a detached folded-page corner in violet occupies the upper-right opening. Primary badge: ink-black #25261F rounded square, acid-lime #DFFF72 G, tiny lavender #B6A0FF page corner. Flat, crisply drawn vector-style geometry, optical balance, enough negative space to read at 16 px. Make the G uniquely editorial, with a subtly squared left bowl and diagonal page-cut terminal, not a stock font letter. Visual language: contemporary independent reading journal, clever, confident, calm, not childish or corporate AI. Presentation: warm ivory #F7F5EE landscape brand board, large badge left, exact wordmark 'Cloudy’s Gloss' right in refined dark sans serif; bottom row three small same-logo applications on light and dark backgrounds. Keep EXACT SAME mark in all samples. No clouds, no A/文, no globes, no sparkles, no arrows, no 3D, no gradients, no decorative texture, no invented tagline. The mark must be reproducible using a few SVG paths.
```

以下为第一版历史记录，其中旧图不再用于产品。

## 浏览器图标 · 2026-10-07

0.1.3 补齐浏览器扩展图标。原安装包没有 `icons` 和工具栏 `default_icon`，浏览器因此回退到默认拼图。沿用云朵与双语阅读线，使用纯色矢量母版，并加粗阅读线以适配小尺寸。

- 现用矢量导出：[public/icon/source.svg](../../../public/icon/source.svg)。
- PNG：16 / 19 / 24 / 32 / 38 / 48 / 64 / 96 / 128 px，覆盖工具栏、Retina 和扩展管理页。
- 重建：`pnpm icons:build`，使用已安装的 Playwright Chromium；必要时先运行 `pnpm exec playwright install chromium`。PNG 已随源码提交，正常构建不需要重新导出。
- WXT 自动从 `public/icon/数字.png` 生成 `icons`；popup 的 `manifest.default_icon` 元数据由 WXT 转换成 Chrome `action` / Firefox `browser_action`，共用同一份业务配置。
- [浅色、深色及原尺寸预览](toolbar-icons.png)。图标为静态本地资源，无网络请求或运行时动画。

Firefox 自带的「扩展」菜单按钮仍是拼图，它不是插件图标。打开扩展菜单，找到 Cloudy’s Gloss，在对应菜单中选择固定到工具栏，才能显示独立品牌图标。

## 初版设计稿

2026-10-05，视觉设计方案。

## 设计

紫色圆角方形搭配白色云朵。云朵呼应 Cloudy，两条长短阅读线表达原文与译文；底部的收口借用书页形态。使用简洁、圆润的轮廓，适合浏览器扩展和阅读工具。

品牌主色目标值为 `#7257D6`，沿用现有设置页的紫色；浅色背景用白色或暖白，深色背景参考 `#19181F`。这些是设计目标值，生成式 PNG 的实际像素可能有轻微色差。

第一版悬浮球曾采用这套轮廓的内联 SVG 版本，见 [悬浮球设计](../floating-control-v2.md)。

## 文件

- [品牌展示稿](cloudys-gloss-board-v1.png)：1536 × 1024，包含字标、浅色与深色背景示例，以及缩小展示。
- [透明底图标](cloudys-gloss-icon-v1.png)：1254 × 1254，RGBA PNG，圆角方形外部透明。已检查 alpha 通道范围为 0–255。

展示稿中的小图为视觉示意。正式工具栏资产采用上方的矢量母版与 PNG 导出，原始设计稿继续保留。

## 生成记录

使用内置 imagegen，先生成品牌展示稿，再以展示稿为参考生成透明底图标。保留原始输出，项目内文件为副本。

### 展示稿提示词

```text
Use case: logo-brand. Design a polished original logo identity presentation for an existing lightweight bilingual browser translation extension named exactly “Cloudy’s Gloss”. Core symbol: a distinctive friendly compact white cloud silhouette with three carefully proportioned soft lobes, containing TWO bold short horizontal negative-space reading strokes, one slightly longer than the other, suggesting original and translated lines. The cloud bottom has a very subtle central open-book notch, not a speech balloon tail. Extremely simple, optical balance and thick geometry suitable for a 16px browser toolbar. Primary app badge: solid violet #7257D6 rounded square, white cloud, violet cutout reading strokes. No letters inside the symbol, no A/文, no globe, no arrows, no sparkle, no gradients, no glass, no 3D, no shadows, no texture. Make an elegant flat vector-style brand board with a warm off-white background and generous editorial whitespace, landscape 3:2. Upper half: one large app icon at left and refined near-black sans-serif wordmark exactly “Cloudy’s Gloss” at right. Lower half: three clearly separated small demonstrations of the EXACT SAME symbol: violet standalone cloud on off-white, white standalone cloud on deep charcoal #19181F, and a violet rounded-square toolbar/app icon at small sizes. Keep same geometry everywhere. Clean professional software identity, warm and calm rather than childish. No invented tagline, no other words, no mock device frames, no decorative background illustrations. The two reading strokes must remain visible and legible in the small icons.
```

### 透明底图标提示词

```text
Use case: logo-brand / precise-object-edit. From the provided Cloudy’s Gloss identity board, extract and recreate ONLY the top-left violet rounded-square application icon as a standalone production asset. Preserve its exact cloud silhouette, two reading-line cutouts, centered small bottom book-like point, relative proportions, and violet #7257D6 identity. Single icon, centered, facing straight forward, occupying 92 percent of a square canvas with equal padding. The badge background is flat uniform solid violet; cloud is pure white; two horizontal reading strokes are violet cutouts. Pure clean hard vector-like edges. Remove paper texture and lighting variation. Transparent canvas outside the violet badge including its rounded corners. No white rectangle behind it, no checkerboard painted into it, no wordmark, no text, no other icons, no gradient, no shadow, no border.
```
