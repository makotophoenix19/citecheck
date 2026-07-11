#!/usr/bin/env python3
"""Summarize a citecheck --json result into the headline numbers.

    python3 tools/summarize.py RESULTS.json [BIBLIO.json]

Pass the biblio.json you checked as the 2nd argument to also get the
"DOI-bearing references found" rate (the number that matters most).
"""
import json, sys
from collections import Counter


def main():
    if len(sys.argv) < 2:
        sys.exit("usage: summarize.py RESULTS.json [BIBLIO.json]")
    res = json.load(open(sys.argv[1]))
    cits = res.get("citations") or res.get("result", {}).get("citations") or []
    n = len(cits)
    inp = {}
    if len(sys.argv) > 2:
        inp = {x["id"]: x for x in json.load(open(sys.argv[2]))}

    st = Counter(x["status"] for x in cits)
    print(f"=== {n} references ===")
    for s in ["verified", "partial_match", "suspicious", "not_found", "check_failed"]:
        if n:
            print(f"  {s:14} {st.get(s, 0):5}  ({100 * st.get(s, 0) / n:.1f}%)")

    retr = sum(1 for x in cits if x.get("retracted"))
    doaj = sum(1 for x in cits if x.get("journalStatus") == "doaj_listed")
    yrt = sum(1 for x in cits if any("off by 1" in w for w in x.get("warnings", [])))
    print(f"  retracted: {retr}   open-access (DOAJ): {doaj}   verified via year-tolerance: {yrt}")

    if inp:
        has = lambda x: "DOI" in inp.get(x.get("key", ""), {})
        ndoi = sum(1 for x in cits if has(x))
        nf = sum(1 for x in cits if x["status"] == "not_found" and has(x))
        if ndoi:
            print(f"  DOI-bearing references FOUND: {ndoi - nf}/{ndoi} = {100 * (ndoi - nf) / ndoi:.1f}%")

    flagged = [x for x in cits if x["status"] != "verified"]
    print(f"\n--- {len(flagged)} flagged for a look (showing first 25) ---")
    for x in flagged[:25]:
        label = (x.get("title") or x.get("sourceRef") or x.get("key") or "")[:66]
        print(f"  [{x['status']:13}] {label}")
    if len(flagged) > 25:
        print(f"  ... and {len(flagged) - 25} more (use --csv or --only-issues to see them all)")


if __name__ == "__main__":
    main()
