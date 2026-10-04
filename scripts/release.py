"""Validate extension versions and stage the two browser packages for GitHub Release."""
import argparse
import hashlib
import json
import re
import shutil
import zipfile
from pathlib import Path


def validate_version(version, tag=None):
    if not isinstance(version, str) or not re.fullmatch(r"(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)", version):
        raise ValueError("发布版本必须为浏览器支持的三段数字，例如 0.1.0，不接受预发布后缀")
    parts = [int(part) for part in version.split(".")]
    if max(parts) > 65535 or not any(parts):
        raise ValueError("浏览器版本每段不得超过 65535，且不能全部为零")
    if tag is not None and tag != f"v{version}":
        raise ValueError(f"标签 {tag} 与 package.json 版本 v{version} 不一致")
    return version


def validate_archive(archive, version, manifest_version):
    with zipfile.ZipFile(archive) as package:
        bad = package.testzip()
        if bad:
            raise ValueError(f"ZIP 校验失败：{bad}")
        manifest = json.loads(package.read("manifest.json"))
        if manifest.get("version") != version or manifest.get("manifest_version") != manifest_version:
            raise ValueError(f"{archive.name} 的 manifest 版本或浏览器类型不一致")
        if manifest_version == 2 and manifest.get("browser_specific_settings", {}).get("gecko", {}).get("id") != "cloudys-gloss@local.dev":
            raise ValueError("Firefox 扩展 ID 意外改变")


def prepare(root, version):
    sources = [(root / f".output/cloudys-gloss-{version}-chrome.zip", f"cloudys-gloss-{version}-chrome.zip", 3),
               (root / f".output/cloudys-gloss-{version}-firefox.zip", f"cloudys-gloss-{version}-firefox-unsigned.zip", 2)]
    # Validate both packages before staging either, so a stale mixed-version build cannot be published.
    for source, _, manifest_version in sources:
        validate_archive(source, version, manifest_version)
    destination = root / ".output/release"
    if destination.exists():
        shutil.rmtree(destination)
    destination.mkdir(parents=True)
    checksums = []
    for source, name, _ in sources:
        target = destination / name
        shutil.copyfile(source, target)
        checksums.append(f"{hashlib.sha256(target.read_bytes()).hexdigest()}  {name}")
    (destination / "SHA256SUMS").write_text("\n".join(checksums) + "\n")
    (destination / "RELEASE_NOTES.md").write_text(f"""## 下载与安装

- **Chrome / Chromium**：下载 `cloudys-gloss-{version}-chrome.zip`，解压后在 `chrome://extensions` 开启开发者模式，选择“加载已解压的扩展程序”。
- **Firefox**：下载 `cloudys-gloss-{version}-firefox-unsigned.zip`，解压后在 `about:debugging#/runtime/this-firefox` 临时载入 `manifest.json`。这是**未签名**的开发安装包，Firefox 重启后需重新载入，不是商店签名 XPI。
- `SHA256SUMS` 可用于核验两个 ZIP。源码使用本 Release 的 Source code 下载入口。

## 本地模型

扩展不包含模型权重。Apple Silicon Mac（macOS 26.2+）可在源码目录运行 `pnpm model:install` 安装并启动 mlx-serve，再运行 `pnpm model:bridge` 启用浏览器按需启动。

默认地址 `http://127.0.0.1:8080/v1`，模型 `Qwen/Qwen3-1.7B-MLX-4bit`，API Key 留空。

完整安装步骤见仓库 `docs/guides/getting-started.md` 和 `docs/guides/model-service.md`。

发布门槛：lint、TypeScript 检查、Vitest 单测、Chrome / Firefox E2E、ZIP manifest 与 SHA-256 校验。CI 使用本地模拟模型，不代表真实模型的翻译质量已通过验收。
""")
    print(f"已准备发布包：{destination}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tag")
    parser.add_argument("--validate-only", action="store_true")
    args = parser.parse_args()
    root = Path.cwd()
    version = validate_version(json.loads((root / "package.json").read_text())["version"], args.tag)
    if not args.validate_only:
        prepare(root, version)


if __name__ == "__main__":
    main()
