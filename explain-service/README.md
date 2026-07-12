# citecheck explain-service (Layer 2)

A tiny HTTP service that turns citecheck's deterministic analysis into a
plain-language **leadership briefing**, written by Claude. It exists so the
Anthropic API key lives in **one place you control** — your NAS — instead of on
every laptop. Any `citecheck` install on the tailnet calls it over Tailscale.

```
  laptop:  citecheck  ──(aggregate stats + flagged titles)──►  NAS :8088  ──► Claude
                      ◄──────────── narrative ─────────────────
```

**What is sent:** only aggregate counts and the **titles** of flagged references
(published, public metadata). Never the full bibliography, never the manuscript.

---

## Endpoint

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| `POST` | `/explain` | `{ "input": <ExplainInput> }` | `{ "narrative": "…" }` |
| `GET` | `/health` | — | `{ "ok": true }` |

Environment variables (set on the container, not in the image):

| Var | Required | Purpose |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | **yes** | The one place the key lives. |
| `CITECHECK_EXPLAIN_TOKEN` | no | Shared secret; if set, clients must send `Authorization: Bearer <token>`. |
| `CITECHECK_EXPLAIN_MODEL` | no | Override the model (default `claude-opus-4-8`). |
| `PORT` | no | Listen port (default `8088`). |

---

## Deploy on the QNAP via Portainer (recommended)

1. **Portainer → Stacks → Add stack.** Name it `citecheck-explain`.
2. **Build method → Repository** (or upload this `explain-service/` folder). Point
   it at your fork `https://github.com/makotophoenix19/citecheck` and set the
   compose path to `explain-service/docker-compose.yml`.
3. **Environment variables** (this is where the key goes — once, on the NAS):
   - `ANTHROPIC_API_KEY` = your new key
   - `CITECHECK_EXPLAIN_TOKEN` = any long random string (recommended)
4. **Deploy the stack.** It builds the image and starts the container on `:8088`.
5. Confirm: on the NAS, `curl http://127.0.0.1:8088/health` → `{"ok":true}`.

The container is reachable only over your LAN / tailnet — keep `:8088` off the
public internet (don't port-forward it on the router).

---

## Point citecheck at it (on your laptop)

```sh
# The NAS on your tailnet (from `tailscale status` → qnap-nas):
export CITECHECK_EXPLAIN_URL="http://100.109.255.6:8088/explain"
export CITECHECK_EXPLAIN_TOKEN="the-same-long-random-string"   # only if you set one
```

Add those two lines to your `~/.zshrc` so every session has them. Then run
`citecheck` — when a route is configured, the wizard offers **"Add a
plain-language leadership summary?"**, and the narrative is written into the
one-page report and the on-screen output.

---

## Fast local iteration (no NAS)

Before the NAS is up, you can prove the whole thing on the laptop by pointing
citecheck straight at Claude:

```sh
export ANTHROPIC_API_KEY="your-new-key"      # laptop-only, for iteration
citecheck                                     # wizard now offers the summary
```

Same code path, same output — the only difference is where the key lives. Once
the NAS service is running, unset `ANTHROPIC_API_KEY` and set
`CITECHECK_EXPLAIN_URL` instead, and the key is off the laptop for good.

> **Billing:** the Claude API is pay-as-you-go — load a little credit at
> console.anthropic.com. Each briefing costs a fraction of a cent (only a
> paragraph of stats is sent), so a few dollars lasts a very long time.
