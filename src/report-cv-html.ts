import type { CvAnalysis } from "./analyze-cv.js";

const esc = (s: unknown) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A self-contained, print-to-PDF one-page CV publications report. The verdict
 * reflects the journal articles; book chapters and presentations are shown for
 * information (a conference abstract that isn't indexed is normal, not a flag). */
export function renderCvHtml(a: CvAnalysis, sourceName: string, generatedAt = new Date()): string {
  const date = generatedAt.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const badge = `<div class="verdict verdict-${a.verdict}"><span class="badge">${esc(a.verdictLabel)}</span><span class="vdetail">${esc(a.verdictDetail)}</span></div>`;

  const span = a.profile.yearRange ? `${a.profile.yearRange[0]}–${a.profile.yearRange[1]}` : "—";
  const tile = (num: string, label: string, tone = "plain") =>
    `<div class="tile ${tone}"><div class="num">${esc(num)}</div><div class="lab">${esc(label)}</div></div>`;
  const tiles = [
    tile(String(a.profile.articles), "journal articles", "good"),
    tile(String(a.profile.bookChapters), "book chapters"),
    tile(String(a.profile.presentations), "presentations"),
    tile(span, "publication span"),
    a.openAccess ? tile(String(a.openAccess), "open-access") : "",
  ].filter(Boolean).join("");

  const j = a.journal;
  const jStat = `${j.verified} verified` +
    (j.notFound.length ? ` · ${j.notFound.length} to confirm` : "") +
    (j.mismatch ? ` · ${j.mismatch} minor mismatch` : "") +
    (j.unreachable ? ` · ${j.unreachable} couldn't reach` : "");

  const attention = [...a.retracted.map((f) => ({ ...f, kind: "retracted" as const })), ...j.notFound.map((f) => ({ ...f, kind: "confirm" as const }))];
  const attentionRows = attention.length
    ? attention.map((f) => `<tr>
        <td class="st ${f.retracted ? "flag" : "flag"}">${f.kind === "retracted" ? "RETRACTED" : "to confirm"}</td>
        <td>${esc(f.title)}</td>
        <td class="why">${esc(f.reason)}</td></tr>`).join("")
    : `<tr><td colspan="3" class="ok">Every journal article verified — nothing to confirm.</td></tr>`;

  return `<!doctype html><html><head><meta charset="utf-8">
<title>CV publications check — ${esc(sourceName)}</title>
<style>
  :root{ --ink:#0e1a18; --body:#33403d; --muted:#5c6c69; --rule:#e2e9e7;
    --teal:#0d7d72; --teal-soft:#e2f1ef; --good:#157347; --warn:#a4680f; --flag:#b3261e;
    --serif:"Iowan Old Style",Palatino,Georgia,serif; --sans:system-ui,-apple-system,Segoe UI,Roboto,sans-serif; }
  *{box-sizing:border-box} body{margin:0;background:#fff;color:var(--body);font-family:var(--sans);line-height:1.5}
  .wrap{max-width:820px;margin:0 auto;padding:44px 30px 60px}
  .eyebrow{font-size:11.5px;letter-spacing:.13em;text-transform:uppercase;color:var(--teal);font-weight:700}
  h1{font-family:var(--serif);color:var(--ink);font-weight:600;font-size:29px;margin:8px 0 4px;line-height:1.1}
  .verdict{display:flex;align-items:center;gap:12px;margin:18px 0 22px;flex-wrap:wrap}
  .verdict .badge{display:inline-block;padding:6px 16px;border-radius:7px;font-size:15px;letter-spacing:.09em;font-weight:800;color:#fff;white-space:nowrap}
  .verdict .vdetail{font-size:15px;font-weight:600}
  .verdict-pass .badge{background:var(--good)} .verdict-pass .vdetail{color:var(--good)}
  .verdict-review .badge{background:var(--flag)} .verdict-review .vdetail{color:var(--flag)}
  .verdict-rerun .badge{background:var(--muted)} .verdict-rerun .vdetail{color:var(--muted)}
  .tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:12px;margin:0 0 26px}
  .tile{border:1px solid var(--rule);border-radius:11px;padding:15px 14px}
  .tile .num{font-family:var(--serif);font-size:26px;font-weight:600;line-height:1;font-variant-numeric:tabular-nums}
  .tile .lab{margin-top:7px;font-size:12px;color:var(--muted)}
  .tile.good .num{color:var(--good)}
  h2{font-size:12.5px;letter-spacing:.09em;text-transform:uppercase;color:var(--ink);font-weight:700;margin:26px 0 10px;display:flex;align-items:center;gap:12px}
  h2::after{content:"";flex:1;height:1px;background:var(--rule)}
  .sub{font-size:14px;color:var(--muted);margin:0 0 8px}
  table{border-collapse:collapse;width:100%;font-size:13.5px;margin-top:4px}
  th{text-align:left;color:var(--muted);font-weight:600;padding:7px 9px;border-bottom:2px solid var(--rule)}
  td{padding:8px 9px;border-bottom:1px solid var(--rule);vertical-align:top}
  td.st{font-weight:700;white-space:nowrap} td.st.flag{color:var(--flag)}
  td.why{color:var(--muted)} td.ok{color:var(--good);font-weight:600}
  .info{font-size:13.5px;color:var(--muted);margin:2px 0 0}
  footer{margin-top:34px;padding-top:16px;border-top:1px solid var(--rule);font-size:12px;color:var(--muted);display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px}
  @media print{ .wrap{padding:0} body{font-size:12px} }
</style></head><body><div class="wrap">
  <div class="eyebrow">CV publications check</div>
  <h1>${esc(sourceName)}</h1>
  ${badge}
  <div class="tiles">${tiles}</div>

  <h2>Peer-reviewed journal articles · ${j.total}</h2>
  <p class="sub">${esc(jStat)} — the verdict above is based on these.</p>
  <table><thead><tr><th>Status</th><th>Reference</th><th>What it means</th></tr></thead>
  <tbody>${attentionRows}</tbody></table>

  <h2>Book chapters · ${a.book.total}</h2>
  <p class="info">${a.book.found} found · ${a.book.notIndexed} not indexed — normal for book chapters, and never counted as a problem.</p>

  <h2>Conference presentations / abstracts · ${a.presentation.total}</h2>
  <p class="info">Listed for the record. Conference items are rarely indexed in Crossref/PubMed, so they are not existence-checked — a missing one is not a red flag.</p>

  <footer>
    <span>Generated by citecheck (CV mode) · Crossref · PubMed · OpenAlex · DOAJ</span>
    <span>${esc(date)}</span>
  </footer>
</div></body></html>`;
}
