import type { Analysis } from "./analysis.js";

const esc = (s: unknown) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A self-contained, print-to-PDF one-page report generated from the analysis.
 * `narrative`, when present, is the Claude-written leadership briefing. */
export function renderAnalysisHtml(a: Analysis, sourceName: string, generatedAt = new Date(), narrative?: string): string {
  const date = generatedAt.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const verified = a.buckets.clean + a.buckets.yearTolerated;
  const mismatch = a.buckets.yearMismatch + a.buckets.titleMismatch + a.buckets.review;
  const attention = [...a.retracted, ...a.notFound];

  const tile = (num: string, label: string, tone: "good" | "warn" | "flag" | "plain") =>
    `<div class="tile ${tone}"><div class="num">${esc(num)}</div><div class="lab">${esc(label)}</div></div>`;

  const tiles = [
    a.doiFound != null && a.doiTotal ? tile(`${a.doiFoundPct}%`, "of DOI-bearing references found", "good") : "",
    tile(String(verified), "verified", "good"),
    tile(String(mismatch), "found, minor mismatch", mismatch ? "warn" : "plain"),
    tile(String(a.buckets.notFound), "not found — check", a.buckets.notFound ? "flag" : "plain"),
    tile(String(a.retracted.length), "retracted", a.retracted.length ? "flag" : "plain"),
  ].filter(Boolean).join("");

  const attentionRows = attention.length
    ? attention.map((f) => `<tr>
        <td class="st ${f.retracted ? "flag" : "flag"}">${f.retracted ? "RETRACTED" : "not found"}</td>
        <td>${esc(f.title)}${f.doi ? `<div class="doi">${esc(f.doi)}</div>` : ""}</td>
        <td class="why">${esc(f.reason)}</td></tr>`).join("")
    : `<tr><td colspan="3" class="ok">Nothing needs a look — every reference was located and none were retracted.</td></tr>`;

  const verdictBadge = `<div class="verdict verdict-${a.verdict}"><span class="badge">${esc(a.verdictLabel)}</span><span class="vdetail">${esc(a.verdictDetail)}</span></div>`;

  const narrativeBlock = narrative
    ? `<div class="brief"><div class="brief-label">In plain terms</div><p>${esc(narrative).replace(/\n{2,}/g, "</p><p>").replace(/\n/g, " ")}</p></div>`
    : "";

  const cosmeticNote = mismatch
    ? `<p class="cosmetic">${mismatch} more references had a minor metadata difference (publication year or title formatting) but were found — safe to ignore. The full, filterable list is in the accompanying spreadsheet.</p>`
    : "";

  return `<!doctype html><html><head><meta charset="utf-8">
<title>citecheck report — ${esc(sourceName)}</title>
<style>
  :root{ --ink:#0e1a18; --body:#33403d; --muted:#5c6c69; --rule:#e2e9e7;
    --teal:#0d7d72; --teal-soft:#e2f1ef; --good:#157347; --warn:#a4680f; --flag:#b3261e;
    --serif:"Iowan Old Style",Palatino,Georgia,serif; --sans:system-ui,-apple-system,Segoe UI,Roboto,sans-serif; }
  *{box-sizing:border-box} body{margin:0;background:#fff;color:var(--body);font-family:var(--sans);line-height:1.5}
  .wrap{max-width:820px;margin:0 auto;padding:44px 30px 60px}
  .eyebrow{font-size:11.5px;letter-spacing:.13em;text-transform:uppercase;color:var(--teal);font-weight:700}
  h1{font-family:var(--serif);color:var(--ink);font-weight:600;font-size:30px;margin:8px 0 4px;line-height:1.1}
  .src{color:var(--muted);font-size:14px;margin:0 0 2px}
  .verdict{display:flex;align-items:center;gap:12px;margin:18px 0 4px;flex-wrap:wrap}
  .verdict .badge{display:inline-block;padding:6px 16px;border-radius:7px;font-size:15px;letter-spacing:.09em;font-weight:800;color:#fff;white-space:nowrap}
  .verdict .vdetail{font-size:15px;font-weight:600}
  .verdict-pass .badge{background:var(--good)} .verdict-pass .vdetail{color:var(--good)}
  .verdict-review .badge{background:var(--flag)} .verdict-review .vdetail{color:var(--flag)}
  .verdict-rerun .badge{background:var(--muted)} .verdict-rerun .vdetail{color:var(--muted)}
  .bottomline{font-family:var(--serif);font-size:20px;color:var(--ink);font-weight:600;margin:14px 0 18px;line-height:1.25}
  .tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px;margin:0 0 26px}
  .tile{border:1px solid var(--rule);border-radius:11px;padding:16px 14px}
  .tile .num{font-family:var(--serif);font-size:30px;font-weight:600;line-height:1;font-variant-numeric:tabular-nums}
  .tile .lab{margin-top:7px;font-size:12px;color:var(--muted)}
  .tile.good .num{color:var(--good)} .tile.warn .num{color:var(--warn)} .tile.flag .num{color:var(--flag)} .tile.plain .num{color:var(--ink)}
  h2{font-size:12.5px;letter-spacing:.09em;text-transform:uppercase;color:var(--ink);font-weight:700;margin:26px 0 12px;display:flex;align-items:center;gap:12px}
  h2::after{content:"";flex:1;height:1px;background:var(--rule)}
  ul{margin:0;padding-left:20px} li{margin:0 0 7px}
  ol.actions{margin:0;padding-left:22px} ol.actions li{margin:0 0 8px;color:var(--ink)}
  table{border-collapse:collapse;width:100%;font-size:13.5px;margin-top:4px}
  th{text-align:left;color:var(--muted);font-weight:600;padding:7px 9px;border-bottom:2px solid var(--rule)}
  td{padding:8px 9px;border-bottom:1px solid var(--rule);vertical-align:top}
  td.st{font-weight:700;white-space:nowrap} td.st.flag{color:var(--flag)}
  td.why{color:var(--muted)} .doi{font-size:11.5px;color:var(--muted);margin-top:2px}
  td.ok{color:var(--good);font-weight:600}
  .brief{background:var(--teal-soft);border-left:3px solid var(--teal);border-radius:0 10px 10px 0;padding:14px 18px;margin:0 0 24px}
  .brief-label{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--teal);font-weight:700;margin-bottom:5px}
  .brief p{margin:0 0 8px;color:var(--ink);font-size:15px;line-height:1.5}.brief p:last-child{margin:0}
  .cosmetic{font-size:13px;color:var(--muted);margin:14px 0 0}
  footer{margin-top:34px;padding-top:16px;border-top:1px solid var(--rule);font-size:12px;color:var(--muted);display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px}
  @media print{ .wrap{padding:0} body{font-size:12px} }
</style></head><body><div class="wrap">
  <div class="eyebrow">Reference-integrity report</div>
  <h1>${esc(sourceName)}</h1>
  ${verdictBadge}
  <p class="bottomline">${esc(a.headline)}</p>
  ${narrativeBlock}
  <div class="tiles">${tiles}</div>

  <h2>What this means</h2>
  <ul>${a.meaning.map((m) => `<li>${esc(m)}</li>`).join("")}</ul>

  <h2>What to do</h2>
  <ol class="actions">${a.actions.map((x) => `<li>${esc(x)}</li>`).join("")}</ol>

  <h2>Needs a look${attention.length ? ` (${attention.length})` : ""}</h2>
  <table><thead><tr><th>Status</th><th>Reference</th><th>What it means</th></tr></thead>
  <tbody>${attentionRows}</tbody></table>
  ${cosmeticNote}

  <footer>
    <span>Generated by citecheck · Crossref · PubMed · OpenAlex · DOAJ</span>
    <span>${esc(date)}</span>
  </footer>
</div></body></html>`;
}
