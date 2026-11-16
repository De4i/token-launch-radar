#!/usr/bin/env python3
"""Capture the dashboard's screenshots locally (not shipped in the entry's dashboard/).

Serves the program's output directory over loopback so ../data.js resolves, then drives Chromium
through Playwright at the gate's viewport limits (long side <= 1440, short side >= 800).
    python tools/shoot.py [--out out] [--dir screenshots]
"""
import argparse, functools, http.server, json, pathlib, socketserver, threading, time

BROWSERS = sorted(pathlib.Path.home().glob('.cache/ms-playwright/chromium-*/chrome-linux64/chrome'))
SHOTS = [
    ("1-board.jpg", "#/board?cat=&tvl=0&sort=value&watch=0&q=", 1440, 900, "#board tbody tr"),
    ("2-detail.jpg", None, 1440, 1260, ".detail-head h2"),
    ("3-filtered.jpg", "#/board?cat=Lending&tvl=50000000&sort=tvl&watch=0&q=", 1440, 990, "#board tbody tr"),
]


def serve(root: pathlib.Path, port: int):
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(root))
    class Server(socketserver.TCPServer):
        allow_reuse_address = True
    httpd = Server(("127.0.0.1", port), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="out")
    ap.add_argument("--dir", default="screenshots")
    ap.add_argument("--quality", type=int, default=86)
    ap.add_argument("--detail", default=None, help="protocol slug for the detail view")
    args = ap.parse_args()

    root = pathlib.Path(args.out).resolve()
    board = json.loads((root / "board.json").read_text())["rows"]
    watch = [r for r in board if r["watch"]]
    detail = args.detail or (watch[0]["slug"] if watch else board[0]["slug"])

    port = 8791
    httpd = serve(root, port)
    target = pathlib.Path(args.dir)
    target.mkdir(parents=True, exist_ok=True)

    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        launch = {"executable_path": str(BROWSERS[-1])} if BROWSERS else {}
        browser = pw.chromium.launch(**launch)
        for name, route, w, h, sel in SHOTS:
            page = browser.new_page(viewport={"width": w, "height": h}, device_scale_factor=1)
            url = f"http://127.0.0.1:{port}/dashboard/index.html" + (f"#/protocol/{detail}" if route is None else route)
            page.goto(url, wait_until="load")
            page.wait_for_selector(sel, timeout=15000)
            page.wait_for_timeout(450)
            path = target / name
            page.screenshot(path=str(path), type="jpeg", quality=args.quality)
            rows_visible = page.evaluate("Array.from(document.querySelectorAll('#board tbody tr')).filter(r=>r.getBoundingClientRect().bottom<=innerHeight).length")
            print(f"{name}: {path.stat().st_size/1024:.0f} KB  visible rows above the fold: {rows_visible}")
            page.close()
        browser.close()
    httpd.shutdown()


if __name__ == "__main__":
    main()
