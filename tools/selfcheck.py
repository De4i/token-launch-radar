#!/usr/bin/env python3
"""Re-implement the seven gate rows locally and print one line each (program/v1 has no local grade).

    python tools/selfcheck.py --out out --snapshot input/snapshot.json
"""
import argparse, json, pathlib, re, struct, subprocess, sys, tempfile, shutil

PLAIN = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$")
NET = re.compile(r"https?://")
ATTR = re.compile(r"""\b(?:src|href|action|srcset|poster|data|formaction)\s*=\s*["']?[^"'>\s]*https?://""", re.I)
JS_IMPORT = re.compile(r"""(?:^|[\s;(])(?:import|export\s+from|require|import\s*\()\s*["'][^"']*https?://""", re.I)


def whole_jpeg(b: bytes):
    if not b.startswith(b"\xff\xd8"):
        return None
    i = 2
    while i < len(b) - 1:
        if b[i] != 0xFF:
            i += 1
            continue
        m = b[i + 1]
        if m in (0xC0, 0xC1, 0xC2):
            h, w = struct.unpack(">HH", b[i + 5:i + 9])
            return w, h
        if m in (0xD8, 0xD9):
            i += 2
            continue
        i += 2 + struct.unpack(">H", b[i + 2:i + 4])[0]
    return None


def whole_png(b: bytes):
    if not b.startswith(b"\x89PNG\r\n\x1a\n") or b[-12:-8] != b"IEND":
        return None
    w, h = struct.unpack(">II", b[16:24])
    return w, h


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="out")
    ap.add_argument("--snapshot", default="input/snapshot.json")
    ap.add_argument("--vendor", default="vendor/makefun-board.ts")
    a = ap.parse_args()
    out = pathlib.Path(a.out)
    snap = json.loads(pathlib.Path(a.snapshot).read_text())
    ok = []

    # 1 dashboard_files
    dash = out / "dashboard"
    files = [p for p in dash.rglob("*") if p.is_file()]
    names_ok = all(PLAIN.match(p.name) for p in files) and all(not part.startswith(".") for p in files for part in p.relative_to(dash).parts)
    bad = None
    for p in files:
        if p.suffix not in (".html", ".css", ".js"):
            continue
        t = p.read_text(errors="ignore")
        if p.suffix == ".css" and NET.search(t):
            bad = f"{p.name}: network address in css"
        elif p.suffix == ".js" and JS_IMPORT.search(t):
            bad = f"{p.name}: network address in import/require"
        elif p.suffix == ".html" and ATTR.search(t):
            bad = f"{p.name}: network address in an attribute"
        if bad:
            break
    kind = {p.suffix for p in files}
    ok.append(("dashboard_files", bool(files) and len(files) <= 400 and sum(p.stat().st_size for p in files) <= 4 * 1024 * 1024
               and {".css", ".js"} <= kind and any(p.name == "index.html" for p in files) and names_ok and bad is None,
               bad or f"{len(files)} files, {sum(p.stat().st_size for p in files)//1024} KB, index+css+js present"))

    # 2 board_file
    raw = (out / "board.json").read_bytes()
    board = json.loads(raw)
    rows = board["rows"] if isinstance(board, dict) else board
    slugs = {p["slug"] for p in snap["protocols"]}
    def row_ok(r):
        return (isinstance(r.get("slug"), str) and r["slug"] in slugs and isinstance(r.get("name"), str) and r["name"]
                and isinstance(r.get("rank"), int) and r["rank"] > 0
                and isinstance(r.get("implied_value_usd"), int) and 0 < r["implied_value_usd"] <= 100_000_000_000_000
                and isinstance(r.get("farm_steps"), list))
    ok.append(("board_file", 100 <= len(rows) <= 4000 and all(row_ok(r) for r in rows) and len(raw) <= 8 * 1024 * 1024
               and len({r["implied_value_usd"] for r in rows}) > 1,
               f"{len(rows)} rows, {len(raw)//1024} KB, slugs all from the snapshot"))

    # 3 sorted_by_value
    ok.append(("sorted_by_value", [r["rank"] for r in rows] == list(range(1, len(rows) + 1))
               and all(rows[i]["implied_value_usd"] >= rows[i + 1]["implied_value_usd"] for i in range(len(rows) - 1)),
               "ranks 1..N once each, value non-increasing"))

    # 4 coverage
    ok.append(("coverage", set(snap["watchlist"]) <= {r["slug"] for r in rows},
               f"{len(snap['watchlist'])}/{len(snap['watchlist'])} watchlist slugs present"))

    # 5 farm_steps
    bad = None
    for r in rows:
        s = r["farm_steps"]
        if not (3 <= len(s) <= 12) or any(not (20 <= len(x.strip()) <= 600) for x in s):
            bad = r["slug"]
            break
    ok.append(("farm_steps", bad is None, bad or "every row 3-12 steps, each 20-600 chars trimmed"))

    # 6 screenshots
    shots = [p for p in (out / "screenshots").iterdir() if p.is_file() and not p.name.startswith(".")]
    detail, good = [], True
    for p in shots:
        b = p.read_bytes()
        dim = whole_jpeg(b) or whole_png(b)
        if dim is None:
            good, detail = False, f"{p.name} is not a whole PNG/JPEG"
            break
        w, h = dim
        if len(b) > 524_288 or max(w, h) > 1440 or min(w, h) < 800:
            good, detail = False, f"{p.name} {w}x{h} {len(b)//1024} KB outside the caps"
            break
        detail.append(f"{p.name} {w}x{h} {len(b)//1024} KB")
    ok.append(("screenshots", good and 3 <= len(shots) <= 4, "; ".join(detail) if isinstance(detail, list) else detail))

    # 7 dossier_matches
    tmp = pathlib.Path(tempfile.mkdtemp())
    shutil.copytree(out / "dashboard", tmp / "dashboard")
    shutil.copytree(out / "screenshots", tmp / "screenshots")
    js = ("import{writeFileSync}from'node:fs';import{buildDossier}from'%s';"
          "writeFileSync(process.argv[2],buildDossier(process.argv[3],{text_max_bytes:65536}));"
          ) % (pathlib.Path(a.vendor).resolve().as_uri(),)
    (tmp / "gen.mjs").write_text(js.replace("'%s'" % pathlib.Path(a.vendor).resolve().as_uri(), repr(str(pathlib.Path(a.vendor).resolve()))))
    subprocess.run(["node", str(tmp / "gen.mjs"), str(tmp / "dossier.json"), str(tmp)], check=True)
    mine = (out / "dossier.json").read_bytes()
    rebuilt = (tmp / "dossier.json").read_bytes()
    ok.append(("dossier_matches", mine == rebuilt and len(mine) <= 1_536 * 1024,
               f"{len(mine)//1024} KB, byte-identical to buildDossier from dashboard/ and screenshots/"))
    shutil.rmtree(tmp)

    for name, passed, detail in ok:
        print(f"{'PASS' if passed else 'FAIL'}  {name}: {detail}")
    print("all seven pass" if all(p for _, p, _ in ok) else "GATE WOULD REFUSE")
    sys.exit(0 if all(p for _, p, _ in ok) else 1)


if __name__ == "__main__":
    main()
