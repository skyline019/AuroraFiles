#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
xelatex -interaction=nonstopmode aurora-index-search.tex
xelatex -interaction=nonstopmode aurora-index-search.tex
ls -lh aurora-index-search.pdf
echo "OK: $(pwd)/aurora-index-search.pdf"
