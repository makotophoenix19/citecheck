#!/usr/bin/env node
import { createServer } from "node:http";
import { explainFromInput } from "./explain.js";
import type { ExplainInput } from "./explain-input.js";

/**
 * The Tailscale "explain service" — runs on a machine you control (e.g. the
 * QNAP NAS), holds ANTHROPIC_API_KEY, and turns the aggregate ExplainInput into
 * a leadership narrative. The citecheck CLI on any laptop reaches it over the
 * tailnet, so the API key never leaves this host.
 *
 *   POST /explain   { "input": <ExplainInput> }  ->  { "narrative": "..." }
 *   GET  /health                                  ->  { "ok": true }
 *
 * Optional shared secret: set CITECHECK_EXPLAIN_TOKEN here and on the client;
 * requests must then carry `Authorization: Bearer <token>`.
 */

const PORT = Number(process.env.PORT || process.env.CITECHECK_EXPLAIN_PORT || 8088);
const TOKEN = process.env.CITECHECK_EXPLAIN_TOKEN?.trim();
const MODEL = process.env.CITECHECK_EXPLAIN_MODEL?.trim() || undefined;

if (!process.env.ANTHROPIC_API_KEY?.trim()) {
  process.stderr.write("WARNING: ANTHROPIC_API_KEY is not set — /explain will fail until it is.\n");
}

const server = createServer((req, res) => {
  const send = (code: number, obj: unknown) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(obj));
  };

  if (req.method === "GET" && (req.url === "/health" || req.url === "/")) {
    return send(200, { ok: true, service: "citecheck-explain" });
  }
  if (req.method !== "POST" || (req.url !== "/explain" && req.url !== "/")) {
    return send(404, { error: "not found" });
  }
  if (TOKEN && req.headers.authorization !== `Bearer ${TOKEN}`) {
    return send(401, { error: "unauthorized" });
  }

  let body = "";
  req.on("data", (c) => {
    body += c;
    if (body.length > 1_000_000) req.destroy(); // 1 MB cap — the payload is tiny
  });
  req.on("end", async () => {
    try {
      const parsed = JSON.parse(body) as { input?: ExplainInput };
      if (!parsed.input) return send(400, { error: "missing 'input'" });
      const narrative = await explainFromInput(parsed.input, { model: MODEL });
      send(200, { narrative });
    } catch (e) {
      send(500, { error: (e as Error).message });
    }
  });
});

server.listen(PORT, () => {
  process.stderr.write(`citecheck explain-service listening on :${PORT}${TOKEN ? " (token required)" : ""}\n`);
});
