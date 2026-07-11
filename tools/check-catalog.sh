#!/usr/bin/env bash
# check-catalog.sh — one command to validate a Pure "Research Output" CSV export.
#
#   ./tools/check-catalog.sh "path/to/export.csv" [output-name]
#
# Converts the CSV to a bibliography, checks every reference against Crossref,
# PubMed, OpenAlex and DOAJ, prints the headline numbers, and writes an
# Excel-friendly report. Outputs land in ./results/.
#
# Tip: set CITECHECK_MAILTO to your email first for faster, kinder rate limits:
#   export CITECHECK_MAILTO="baware@houstonmethodist.org"
set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(dirname "$here")"

if [ $# -lt 1 ]; then
  echo "usage: ./tools/check-catalog.sh <export.csv> [output-name]"
  echo
  echo "Pure CSV exports found in ~/Downloads:"
  ls -1 "$HOME/Downloads"/*.csv 2>/dev/null | sed 's/^/  /' || echo "  (none found)"
  exit 2
fi

csv="$1"
if [ ! -f "$csv" ]; then
  echo "error: file not found: $csv" >&2
  exit 2
fi

# Output name: 2nd arg, or a filesystem-safe version of the CSV's name.
if [ $# -ge 2 ]; then
  base="$2"
else
  base="$(basename "$csv" .csv | tr ' ' '_' | tr -cd 'A-Za-z0-9_.-')"
fi
outdir="$repo/results"
mkdir -p "$outdir"
biblio="$outdir/$base.biblio.json"
results="$outdir/$base.results.json"
report="$outdir/$base.report.csv"

# Prefer the globally-linked `citecheck`; fall back to the local build.
if command -v citecheck >/dev/null 2>&1; then
  cc() { citecheck "$@"; }
else
  cc() { node "$repo/dist/cli.js" "$@"; }
fi

[ -z "${CITECHECK_MAILTO:-}" ] && echo "note: set CITECHECK_MAILTO=<your email> for the faster 'polite pool'."

echo "-> converting $(basename "$csv") ..."
python3 "$here/pure-csv-to-biblio.py" "$csv" "$biblio" || { echo "conversion failed" >&2; exit 1; }

echo "-> checking references (this can take several minutes for a large catalog) ..."
cc "$biblio" --json > "$results"
code=$?
# citecheck exits 1 when it flags issues (expected on real catalogs); only 2+
# is a real failure (bad input / read error).
if [ "$code" -ge 2 ]; then echo "citecheck failed (exit $code)" >&2; exit "$code"; fi

echo "-> writing Excel report ..."
python3 "$here/results-to-csv.py" "$results" > "$report"

echo
python3 "$here/summarize.py" "$results" "$biblio"

echo
echo "files written:"
echo "  bibliography : $biblio"
echo "  full results : $results"
echo "  excel report : $report"
echo
echo "open the Excel report:   open \"$report\""
