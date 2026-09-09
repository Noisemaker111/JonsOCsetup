# Sol wrap: dead Fable desk review + visible CLIProxy quota

You are GPT-5.6 Sol at xhigh (not fast, not max unless you need it). Allbot launched this after Claude Fable 5.1 died mid-review on a CLIProxy 429. Two jobs. Stay inside this git repo (`Noisemaker111/opencode-config` at `/home/debian/.config/opencode`). Do not git push. Do not clone other repos. Do not touch appforgutters, jgengine, or upstream OpenCode. Secrets stay out of git.

Working directory is this repo. TMPDIR and TMUX_TMPDIR are `/home/debian/tmp` (debian cannot write `/tmp`).

## Who this is for

Jon R (GitHub Noisemaker111). Talks only to Allbot in a 1:1 Grok Bot chat. Allbot is a thin dispatcher. Heavy work burns Claude / Codex / Go / Grok Build through OpenCode 2 on the OVH VPS `debian@51.81.85.56` (no sudo). Cursor CloudAgent is banned.

## Job A — write the Fable review Fable never finished

Fable 5.1 high session `ses_f9af99336ffeUCUtVNkWJ2jEhQ`, title `desk-free-review`, ran 2026-09-03 02:08–02:25 UTC. About 4.1M input / 70k output. tmux `fable-review` is already killed. **Do not `--continue` that session** (too much context; Fable's 5h bar is dead until ~3:00 ET).

There is **no** `models/fable-free-review-out.md`. Fable's only leftover on disk is the dirty `usage/usage-cache.json` (do not commit it). Reconstruct the review from what Fable **actually** saw and wrote:

1. SQLite `/home/debian/.local/share/opencode/opencode.db` — live rows are in `session_v2` and `session_message` (the old `session` table is empty). Filter `session_id = 'ses_f9af99336ffeUCUtVNkWJ2jEhQ'`. `session_message.data` is JSON (user / assistant / system / agent-switched). Quote Fable, do not paraphrase it into agreement with Allbot.
2. Files Fable opened (start from `models/fable-free-review.md`, then `models/routing-table.md`, `models/go-catalog.md`, `models/benchmarks.md`, `models/model-profiles.json`, `opencode.jsonc`, plus whatever the session_message tool calls show).
3. CLIProxy request logs under `/home/debian/.cli-proxy-api/logs/` if a tool result is missing from sqlite.

A second session `ses_f9afc207cfferJCFALcjqbKALb` is also titled `desk-free-review` (earlier failed attempt). Do not mix them unless you label which is which.

**Do not invent Fable conclusions.** If Fable never stated a finding, write "Fable did not reach a conclusion on X" and then you may add a clearly labeled Sol note. Write `models/fable-free-review-out.md` as something Jon can read: what Fable noticed, what Fable changed (likely nothing on disk), what Fable left, what Fable was unsure about. Plain language.

## Job B — CLIProxy 429/quota must be a hard visible error

The usage plugin lives in `usage/` (`usage-reached.ts`, `usage-collector.ts`, `usage-plans.json`, `usage-lib.ts`, `server.ts`). It already classifies generic 429 *text* but did **not** surface this CLIProxy cooldown to Allbot, and `opencode2 run` kept retrying silently (same Fable session POSTed again at 02:26 and 02:41 UTC after the 02:25 death).

Facts to hook, not guess:

- CLIProxy 7.2.147 on `127.0.0.1:8317`. Auth `~/.cli-proxy-api/claude-jk10192000@gmail.com.json`. Claude plan doc in `usage-plans.json` says there is **no quota endpoint** — cooldown must come from the 429 body / `Retry-After` / logs.
- `KNOWN_PROVIDERS` in `usage-reached.ts` is missing `cliproxyapi`. `PROVIDER_TO_SOURCE` / `USAGE_SHORT` / `usage-plans.json` also do not name `cliproxyapi`.
- Live 429 JSON OpenCode actually received (verbatim):

Upstream (first hit, 02:25:59Z):

```json
{"type":"error","error":{"type":"rate_limit_error","message":"This request would exceed your account's rate limit. Please try again later."},"request_id":"req_011CefiNAKjikB3SMuYUqHyM"}
```

CLIProxy cooldown (next POST, 02:26:01Z) — this is the shape that must be classified as usage, not a blip:

```json
{"error":{"code":"model_cooldown","last_upstream_error":"rate_limit_error: This request would exceed your account's rate limit. Please try again later.","message":"All credentials for model claude-fable-5-1 are cooling down via provider claude (last error: rate_limit_error: This request would exceed your account's rate limit. Please try again later.)","model":"claude-fable-5-1","provider":"claude","reset_seconds":16445,"reset_time":"4h34m4s"}}
```

CLIProxy log line: `auth unavailable: 1 of 1 candidate(s) for model "claude-fable-5-1" (provider=claude) are in cooldown: [... reason=quota, remaining=4h34m4s]`. Headers included `Retry-After: 16440` and `Anthropic-Ratelimit-Unified-Reset: 1788418800` (~07:00 UTC / 3:00 ET).

Required behavior:

1. `usage-reached` must classify CLIProxy 429 JSON with `rate_limit_error` / `auth unavailable` / `reason=quota` / `model_cooldown` as **usage**, providerID `cliproxyapi` (and claude when that is what cooled down). Add tests in `test/usage-reached.test.ts` using the blobs above.
2. A 429/quota from CLIProxy is a **hard visible error**: `opencode2 run` must **exit**, not silently retry for hours. Stop the retry loop. Surface a user-visible usage-reached line (existing vocabulary: `Usage reached — cliproxyapi/...`). Do not hide this behind a generic provider dump, and do not keep POSTing the same dead session.
3. Write `usage/quota-alert.md` **or** update `usage-cache.json` with a `cliproxyapi` / claude source whose window carries the cooldown remaining (`reset_seconds` / `reset_time`). Cache writes are local runtime state — **do not commit** `usage/usage-cache.json`.
4. Keep Claude's "no quota endpoint" truth: you cannot invent a percent from nothing. Cooldown remaining from the 429 is the observation.

Stay in this repo. If a hook has to live in `plugins-active/favorite-router.ts` or `models/model-routing.ts` so a standalone `opencode2 run` actually exits, do that; do not wait for a TUI-only HUD.

## Constraints

- OpenCode 2 variants **must** stay JSON arrays (`[{"id":"xhigh","settings":{"reasoningEffort":"xhigh"}}]`). Object-shaped variants make 18965 skip the whole `cliproxyapi` provider. `opencode.jsonc` already has array variants for Fable and for Sol xhigh/max; do not regress that.
- Do not git push. Allbot will pick up the diff.
- Do not commit `usage/usage-cache.json`.
- Do not contribute upstream. Do not use Cursor CloudAgent.

When you are done, `models/fable-free-review-out.md` exists from Fable's actual session, quota errors are classified and visible, and a standalone `opencode2 run` would exit on the next CLIProxy `reason=quota` 429 instead of retrying until the cooldown ends.
