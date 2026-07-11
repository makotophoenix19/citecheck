#!/usr/bin/env python3
"""Convert a Pure 'Research Output' CSV export into a CSL-JSON bibliography that
citecheck can read.

    python3 tools/pure-csv-to-biblio.py INPUT.csv OUTPUT.json

Dedupes by DOI (keeps legitimately duplicated titles that have distinct DOIs,
e.g. an editorial published across several journals), parses the author list,
and carries the DOI, title, year, and journal through.
"""
import csv, json, re, sys


def parse_authors(af):
    if not af:
        return []
    head = af.split(" / ")[0]  # Pure appends "/ Title..." after the author list
    out = []
    for part in head.split(";"):
        p = re.sub(r"\s+", " ", part).strip().strip(".").strip()
        if not p:
            continue
        if "," in p:
            fam, giv = p.split(",", 1)
            out.append({"family": fam.strip(), "given": giv.strip()})
        else:
            out.append({"family": p})  # corporate/consortium author
    return out


def col(row, *names):
    """Fetch a column by exact name, then by case-insensitive substring."""
    for n in names:
        for k in row:
            if k and k.strip().lower() == n.lower():
                return (row[k] or "").strip()
    for n in names:
        for k in row:
            if k and n.lower() in k.strip().lower():
                return (row[k] or "").strip()
    return ""


def main():
    if len(sys.argv) < 3:
        sys.exit("usage: pure-csv-to-biblio.py INPUT.csv OUTPUT.json")
    src, out = sys.argv[1], sys.argv[2]
    rows = list(csv.DictReader(open(src, encoding="utf-8", errors="replace")))
    seen, items = set(), []
    for i, r in enumerate(rows):
        doi = col(r, "DOIs (Digital Object Identifiers)", "doi")
        title = col(r, "Research Output Title", "title")
        van = col(r, "Vancouver format")
        if not (doi or title):
            continue
        key = doi.lower() if doi else (van.lower()[:80] if van else title.lower())
        if key in seen:
            continue
        seen.add(key)
        it = {"id": f"ref{i:04d}", "type": "article-journal", "title": title,
              "container-title": col(r, "Journal Title", "journal")}
        if doi:
            it["DOI"] = doi
        y = col(r, "Year")
        if y.isdigit():
            it["issued"] = {"date-parts": [[int(y)]]}
        au = parse_authors(col(r, "Author format", "author"))
        if au:
            it["author"] = au
        items.append(it)
    json.dump(items, open(out, "w"), ensure_ascii=False)
    nod = sum(1 for x in items if "DOI" not in x)
    print(f"wrote {len(items)} references -> {out}  ({len(items) - nod} with DOI, {nod} without)")


if __name__ == "__main__":
    main()
