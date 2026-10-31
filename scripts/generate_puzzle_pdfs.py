#!/usr/bin/env python3
"""Generate printable PDF versions of each UNIPOL logic puzzle.

Each PDF contains, in order:
  1. The puzzle clues (numbered)
  2. A blank solution grid
  3. The filled-in solution grid

The puzzle data is fetched from the public API by default; pass --input to
use a locally cached JSON snapshot instead.

Usage:
  python3 scripts/generate_puzzle_pdfs.py                 # fetch from API
  python3 scripts/generate_puzzle_pdfs.py --input x.json  # local snapshot
  python3 scripts/generate_puzzle_pdfs.py --only friendly # filter by name
"""

import argparse
import html
import json
import re
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

API_URL = "https://staging--btnowg4yy54vl9fywzsv.youbase.cloud/api/public/puzzles"
ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "public" / "pdfs"
CHROMIUM = "chromium"


# ───────────────────────── helpers ─────────────────────────

def slugify(name: str) -> str:
    """Turn a puzzle name into a filesystem-safe slug."""
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return slug or "puzzle"


def esc(text: str) -> str:
    return html.escape(str(text), quote=True)


def sorted_clues(puzzle: dict) -> list:
    return sorted(puzzle.get("clues") or [], key=lambda c: c.get("order", 0))


# ───────────────────────── HTML rendering ─────────────────────────

def render_grid_table(puzzle: dict, filled: bool) -> str:
    """Render the Excel-style grid: category headers on top, Row N labels on the left."""
    categories = [c["name"].strip() for c in puzzle["categories"]]
    rows = int(puzzle.get("gridRows") or 0)
    solution = puzzle.get("solution") or []

    head_cells = "".join(f"<th>{esc(cat)}</th>" for cat in categories)

    body_rows = []
    for r in range(rows):
        cells = []
        for c_idx in range(len(categories)):
            value = ""
            if filled:
                value = (solution[r][c_idx] if r < len(solution) and c_idx < len(solution[r]) else "") or ""
                value = value.strip()
            if filled:
                cls = "cell filled" if value else "cell empty"
                inner = esc(value) if value else "&mdash;"
            else:
                cls = "cell"
                inner = ""
            cells.append(f'<td class="{cls}">{inner}</td>')
        body_rows.append(
            f'<tr><td class="rowhead">Row {r + 1}</td>{"".join(cells)}</tr>'
        )

    return (
        '<table class="grid">'
        f'<thead><tr><td class="corner">Category</td>{head_cells}</tr></thead>'
        f'<tbody>{"".join(body_rows)}</tbody>'
        "</table>"
    )


def render_puzzle_html(puzzle: dict) -> str:
    name = esc(puzzle["name"])
    n_cats = len(puzzle["categories"])
    n_rows = int(puzzle.get("gridRows") or 0)
    clues = sorted_clues(puzzle)

    clue_items = "\n".join(
        f"<li>{esc(c.get('text', ''))}</li>" for c in clues
    )

    return f"""<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  @page {{ size: letter portrait; margin: 0.55in 0.6in; }}
  * {{ box-sizing: border-box; }}
  body {{
    font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
    color: #1e293b;
    margin: 0;
    font-size: 11pt;
  }}
  .brand {{
    font-size: 8.5pt;
    font-weight: 700;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: #b45309;
    margin-bottom: 6pt;
  }}
  h1 {{
    font-size: 21pt;
    margin: 0 0 4pt;
    color: #0f172a;
    line-height: 1.15;
  }}
  .accent {{
    width: 54pt;
    height: 3pt;
    background: #f59e0b;
    margin: 8pt 0 14pt;
  }}
  .meta {{
    font-size: 10pt;
    color: #64748b;
    margin-bottom: 20pt;
  }}
  h2 {{
    font-size: 12pt;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: #334155;
    border-bottom: 1pt solid #e2e8f0;
    padding-bottom: 5pt;
    margin: 0 0 14pt;
  }}
  ol.clues {{
    margin: 0;
    padding-left: 20pt;
  }}
  ol.clues li {{
    margin-bottom: 9pt;
    line-height: 1.45;
    padding-left: 4pt;
  }}
  ol.clues li::marker {{
    color: #b45309;
    font-weight: 700;
  }}
  .page-break {{ page-break-before: always; }}
  table.grid {{
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
  }}
  table.grid th, table.grid td {{
    border: 1pt solid #94a3b8;
    padding: 7pt 3pt;
    text-align: center;
    vertical-align: middle;
    font-size: 9pt;
    word-wrap: break-word;
    overflow-wrap: break-word;
  }}
  table.grid thead td.corner, table.grid thead th {{
    background: #f1f5f9;
    font-weight: 700;
    color: #334155;
  }}
  table.grid tbody td.rowhead {{
    background: #f8fafc;
    font-weight: 600;
    color: #475569;
    font-size: 8.5pt;
  }}
  table.grid td.cell {{
    height: 46pt;
    background: #ffffff;
    color: #0f172a;
    font-weight: 500;
  }}
  table.grid td.cell.filled {{
    background: #ecfdf5;
    color: #065f46;
    font-weight: 600;
  }}
  table.grid td.cell.empty {{
    color: #cbd5e1;
  }}
  .grid-note {{
    margin-top: 12pt;
    font-size: 9pt;
    color: #94a3b8;
    font-style: italic;
  }}
</style>
</head>
<body>

  <!-- 1. CLUES -->
  <section>
    <div class="brand">UNIPOL &middot; Logic Puzzles</div>
    <h1>{name}</h1>
    <div class="accent"></div>
    <div class="meta">{n_rows} rows &times; {n_cats} categories &middot; {len(clues)} clues</div>
    <h2>Clues</h2>
    <ol class="clues">
{clue_items}
    </ol>
  </section>

  <!-- 2. BLANK GRID -->
  <section class="page-break">
    <div class="brand">UNIPOL &middot; Logic Puzzles</div>
    <h1>{name}</h1>
    <div class="accent"></div>
    <h2>Blank Grid</h2>
    {render_grid_table(puzzle, filled=False)}
    <p class="grid-note">Write one item from each category into every row.</p>
  </section>

  <!-- 3. FILLED GRID -->
  <section class="page-break">
    <div class="brand">UNIPOL &middot; Logic Puzzles</div>
    <h1>{name}</h1>
    <div class="accent"></div>
    <h2>Solution Grid</h2>
    {render_grid_table(puzzle, filled=True)}
    <p class="grid-note">Completed solution &mdash; one item from each category per row.</p>
  </section>

</body>
</html>
"""


# ───────────────────────── PDF conversion ─────────────────────────

def html_to_pdf(html_text: str, pdf_path: Path) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        html_file = Path(tmp) / "puzzle.html"
        html_file.write_text(html_text, encoding="utf-8")
        result = subprocess.run(
            [
                CHROMIUM,
                "--headless=new",
                "--disable-gpu",
                "--no-sandbox",
                "--disable-dev-shm-usage",
                "--no-pdf-header-footer",
                f"--print-to-pdf={pdf_path}",
                html_file.as_uri(),
            ],
            capture_output=True,
            text=True,
        )
        if result.returncode != 0 or not pdf_path.exists():
            print(result.stderr[-2000:], file=sys.stderr)
            raise RuntimeError(f"chromium failed for {pdf_path.name}")


# ───────────────────────── main ─────────────────────────

def load_puzzles(args) -> list:
    if args.input:
        raw = json.loads(Path(args.input).read_text(encoding="utf-8"))
    else:
        with urllib.request.urlopen(API_URL, timeout=30) as res:
            raw = json.loads(res.read().decode("utf-8"))
    puzzles = raw.get("data", raw) if isinstance(raw, dict) else raw
    # Skip trashed/empty placeholders
    return [p for p in puzzles if p.get("categories") and p.get("gridRows")]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", help="Local JSON snapshot instead of API fetch")
    parser.add_argument("--only", help="Only generate PDFs whose name contains this text")
    parser.add_argument("--out", default=str(OUT_DIR), help="Output directory")
    args = parser.parse_args()

    puzzles = load_puzzles(args)
    if args.only:
        needle = args.only.lower()
        puzzles = [p for p in puzzles if needle in p["name"].lower()]

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    for puzzle in puzzles:
        pdf_path = out_dir / f"{slugify(puzzle['name'])}.pdf"
        html_to_pdf(render_puzzle_html(puzzle), pdf_path)
        print(f"  ✓ {pdf_path.relative_to(ROOT)}  ({puzzle['name']})")

    print(f"\nDone: {len(puzzles)} PDF(s) written to {out_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
