"""Build the PENTAX Loupes UK brochure PDF from brochure.html.

    python brochure/build.py            # writes brochure/PENTAX-Loupes-UK-Brochure.pdf
    python brochure/build.py --preview  # also renders page thumbnails for a visual check

The template references images and the font with relative ../ paths; this
script inlines every one of them as a data URI (so the PDF is fully
self-contained and identical wherever it is built), then prints the page
with headless Edge or Chrome. No Node, no npm packages, no build service.
"""
import base64
import mimetypes
import os
import re
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HERE = os.path.join(ROOT, "brochure")
TEMPLATE = os.path.join(HERE, "brochure.html")
OUT_PDF = os.path.join(HERE, "PENTAX-Loupes-UK-Brochure.pdf")

BROWSERS = [
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
]


def data_uri(rel_path):
    path = os.path.normpath(os.path.join(HERE, rel_path))
    mime = mimetypes.guess_type(path)[0] or "application/octet-stream"
    if path.endswith(".woff2"):
        mime = "font/woff2"
    with open(path, "rb") as fh:
        return f"data:{mime};base64,{base64.b64encode(fh.read()).decode('ascii')}"


def optional_photo(m):
    """<img ... data-optional> is used when the photo exists in brochure/ and
    becomes a marked placeholder box when it does not, so the PDF can be
    built before every photo has been taken. Drop the file in and rebuild."""
    tag = m.group(0)
    src = re.search(r'src="([^"]+)"', tag).group(1)
    if os.path.exists(os.path.join(HERE, src)):
        return tag.replace(f'src="{src}"', f'src="{data_uri(src)}"')
    cls = re.search(r'class="([^"]*)"', tag)
    classes = (cls.group(1) + " " if cls else "") + "placeholder"
    return f'<div class="{classes}">Photo to follow</div>'


def inline_assets(html):
    html = re.sub(r'<img[^>]*\sdata-optional[^>]*>', optional_photo, html)
    html = re.sub(r'(src|href)="(\.\./[^"]+)"', lambda m: f'{m.group(1)}="{data_uri(m.group(2))}"', html)
    html = re.sub(r'url\(["\']?(\.\./[^"\')]+)["\']?\)', lambda m: f'url("{data_uri(m.group(1))}")', html)
    return html


def find_browser():
    for p in BROWSERS:
        if os.path.exists(p):
            return p
    sys.exit("No Edge or Chrome found; install one or add its path to BROWSERS.")


def build(preview=False):
    html = inline_assets(open(TEMPLATE, encoding="utf-8").read())
    work = tempfile.mkdtemp(prefix="pentax-brochure-")
    page = os.path.join(work, "brochure.html")
    open(page, "w", encoding="utf-8").write(html)
    browser = find_browser()
    cmd = [
        browser,
        "--headless=new",
        "--disable-gpu",
        "--no-first-run",
        "--no-default-browser-check",
        f"--user-data-dir={os.path.join(work, 'profile')}",
        "--allow-file-access-from-files",
        "--run-all-compositor-stages-before-draw",
        "--virtual-time-budget=10000",
        "--no-pdf-header-footer",
        f"--print-to-pdf={OUT_PDF}",
        "file:///" + page.replace("\\", "/"),
    ]
    res = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
    if not os.path.exists(OUT_PDF):
        sys.exit(f"PDF not produced.\n{res.stdout}\n{res.stderr}")

    from pypdf import PdfReader

    reader = PdfReader(OUT_PDF)
    box = reader.pages[0].mediabox
    print(f"wrote {os.path.relpath(OUT_PDF, ROOT)}: {len(reader.pages)} pages, "
          f"{float(box.width) / 72 * 25.4:.0f}x{float(box.height) / 72 * 25.4:.0f} mm, "
          f"{os.path.getsize(OUT_PDF) / 1e6:.2f} MB")

    if preview:
        import pypdfium2 as pdfium
        from PIL import Image

        pdf = pdfium.PdfDocument(OUT_PDF)
        thumbs = [p.render(scale=0.55).to_pil() for p in pdf]
        cols = 4
        tw, th = thumbs[0].size
        rows = (len(thumbs) + cols - 1) // cols
        sheet = Image.new("RGB", (tw * cols + 12 * (cols + 1), th * rows + 12 * (rows + 1)), (60, 60, 66))
        for i, im in enumerate(thumbs):
            sheet.paste(im, (12 + (i % cols) * (tw + 12), 12 + (i // cols) * (th + 12)))
        out = os.path.join(work, "pages.jpg")
        sheet.save(out, quality=85)
        # Full-size renders of each page for close inspection.
        for i, p in enumerate(pdf):
            p.render(scale=1.6).to_pil().save(os.path.join(work, f"page-{i + 1}.png"))
        print("preview:", out)


if __name__ == "__main__":
    build(preview="--preview" in sys.argv)
