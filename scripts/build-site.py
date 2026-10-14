"""Stage only public site assets for GitHub Pages, never repository contents."""
import shutil
from pathlib import Path

root = Path(__file__).resolve().parent.parent
source = root / "site"
required = ["index.html", "style.css", "app.js", "assets/logo.svg", "assets/demo.mp4", "assets/demo-poster.jpg", "assets/demo.vtt", "assets/social-cover.png"]
for name in required:
    if not (source / name).is_file() or not (source / name).stat().st_size:
        raise ValueError(f"产品页缺少资源：{name}")
destination = root / ".output/site"
if destination.exists():
    shutil.rmtree(destination)
destination.mkdir(parents=True)
for name in required:
    target = destination / name
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source / name, target)
(destination / ".nojekyll").write_text("")
print(f"GitHub Pages assets: {destination}")
