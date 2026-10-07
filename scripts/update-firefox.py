"""Check, package and request a local Firefox Developer Edition update on macOS."""
import argparse
import hashlib
import json
import platform
import shutil
import subprocess
import sys
from pathlib import Path

from release import validate_archive, validate_version

DEFAULT_APP = Path('/Applications/Firefox Developer Edition.app')


def update(root, *, open_browser=True, app=DEFAULT_APP):
    root = Path(root).resolve()
    app = Path(app).expanduser().resolve()
    if open_browser and (platform.system() != 'Darwin' or not app.is_dir()):
        raise ValueError('自动打开安装仅支持 macOS Firefox 开发者版；可用 --firefox-app 指定 .app，或 --no-open 仅生成安装包')
    pnpm = shutil.which('pnpm')
    if not pnpm:
        raise ValueError('未找到 pnpm，请先安装 pnpm 10')
    version = validate_version(json.loads((root / 'package.json').read_text())['version'])
    # Fail closed: never request installation after a failed check or build.
    subprocess.run([pnpm, 'check'], cwd=root, check=True)
    subprocess.run([pnpm, 'zip:firefox'], cwd=root, check=True)
    archive = root / f'.output/cloudys-gloss-{version}-firefox.zip'
    validate_archive(archive, version, 2)
    destination = root / '.output/local-install'
    destination.mkdir(parents=True, exist_ok=True)
    xpi = destination / f'cloudys-gloss-{version}-firefox-unsigned.xpi'
    temporary = xpi.with_suffix('.xpi.tmp')
    shutil.copyfile(archive, temporary)
    temporary.replace(xpi)
    print(f'\nFirefox 安装包：{xpi}', flush=True)
    print(f'SHA-256：{hashlib.sha256(xpi.read_bytes()).hexdigest()}', flush=True)
    if open_browser:
        # Open the file URL in the normal profile; Firefox handles installation
        # and any confirmation. Never edit the profile or signature preference.
        subprocess.run(['/usr/bin/open', '-a', str(app), xpi.as_uri()], check=True)
        print('已向 Firefox 发送安装请求。若出现确认提示，请确认更新；完成后刷新网页。', flush=True)
    return xpi


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--no-open', action='store_true', help='运行检查和打包，不打开浏览器')
    parser.add_argument('--firefox-app', type=Path, default=DEFAULT_APP, help='macOS Firefox Developer Edition .app 路径')
    args = parser.parse_args()
    try:
        update(Path(__file__).resolve().parent.parent, open_browser=not args.no_open, app=args.firefox_app)
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        print(f'本地更新未完成：{error}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
