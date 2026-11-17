import shutil
import os

src_dir = os.path.join(os.path.dirname(__file__), "web")
dst_dir = os.path.dirname(__file__)

for filename in ["index.html", "styles.css", "app.js", "data.js", "robots.txt", ".nojekyll"]:
    src_file = os.path.join(src_dir, filename)
    if os.path.exists(src_file):
        dst_file = os.path.join(dst_dir, filename)
        shutil.copy2(src_file, dst_file)
        print(f"Copied {filename} to repository root for GitHub Pages.")
