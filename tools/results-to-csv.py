#!/usr/bin/env python3
"""Convert a citecheck --json result into the same CSV as `citecheck --csv`,
without re-running the check.

    python3 tools/results-to-csv.py RESULTS.json > report.csv
"""
import json, sys, csv


def main():
    if len(sys.argv) < 2:
        sys.exit("usage: results-to-csv.py RESULTS.json > report.csv")
    res = json.load(open(sys.argv[1]))
    cits = res.get("citations") or res.get("result", {}).get("citations") or []
    w = csv.writer(sys.stdout)
    w.writerow(["key", "status", "retracted", "open_access", "doi", "pmid", "title", "notes", "source_ref"])
    for r in cits:
        oa = r.get("journalStatus") == "doaj_listed" or (r.get("openalexMatch") or {}).get("isOa") is True
        w.writerow([
            r.get("key", ""),
            r.get("status", ""),
            "yes" if r.get("retracted") else "",
            "yes" if oa else "",
            (r.get("crossrefMatch") or {}).get("doi", ""),
            (r.get("pubmedMatch") or {}).get("pmid", ""),
            r.get("title", ""),
            " | ".join(r.get("warnings", [])),
            r.get("sourceRef", ""),
        ])


if __name__ == "__main__":
    main()
