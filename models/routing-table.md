# Model routing (Allbot + OpenCode)

Source of truth for *which model and which thinking level* to send a job to. Read this before dispatching.

Scores: official [DeepSWE 1.1](https://deepswe.datacurve.ai/) live artifact `artifacts/v1.1/leaderboard-live.json` (generated 2026-09-02 11:18am ET, 113 tasks, mini-swe-agent, 4 runs). There is **no public DeepSWE 2.1**. Do not invent scores. `$` is Datacurve `mean_cost_usd` API cost per task at that effort — relative burn, not Jon's invoice. The site **Best** toggle shows one row per model (usually max) and hides the rest of **65 configs**. Always read effort. Pass@1 ± is the 95% run-to-run half-interval.

Plans (live remaining lives in `model-roster.md`, not here):

| Plan | What it is | How it burns |
|---|---|---|
| ChatGPT Pro ~$100 | Codex + GPT-5.6 Terra / Sol / Luna share one weekly WHAM pool | Effort is how fast that week dies. Terra/Sol chew it. Luna max lasts. Luna medium is useless. |
| Claude Max ~$60 | Claude Code via CLIProxyAPI | Separate Fable week vs all-models week. Fable first, Opus 5 when Fable is the limiter. |
| OpenCode Go | Live list in `models/go-catalog.md` (26 documented, 34 API ids) | Dollar bars $12/5h, $30 week, $60 month. Muse 1.3 is cheap; Kimi K3 and Grok-on-Go are expensive. |
| Grok Build (CLIProxy, Yahoo/X) | `cliproxyapi/grok-4.6` | Subscription OAuth, not `xai/` API. grok.com Gmail SuperGrok is a *different* HIT meter. |
| Grok Bot ~$30 | This Allbot chat | Talk only. Never a coding runtime. |

OpenCode ids go through CLIProxyAPI (`cliproxyapi/…` on `127.0.0.1:8317`) for Claude/Codex/Grok. Go and native OpenAI stay on their own providers. OpenCode `variant` is the thinking level (low / medium / high / xhigh / max). A model without a variant is an incomplete pick.

## What DeepSWE actually measures

113 original long-horizon SWE tasks across 91 repos and 5 languages. Same thin harness (`mini-swe-agent`) for every row, so this is **model + reasoning_effort**, not Claude Code vs Codex vs OpenCode. A row is a config: harness + model + effort. Context-window failures and agent timeouts count as fails. Pass@1 is attempt pass rate over ~4 full-board runs.

Thinking levels are the vendor effort knob (`reasoning_effort` / `output_config.effort`):

| Typical set | Who uses it on this board |
|---|---|
| low, medium, high, xhigh, max | Claude, GPT-5.6 |
| low, medium, high, xhigh (no max row) | Grok 4.6 |
| often only max or xhigh tested | GLM, Kimi, Muse, DeepSeek |

Higher effort = more thinking tokens, more agent steps, more $ / more of the weekly bar, sometimes more score. **Not always more score.** Grok medium beats Grok xhigh. Fable xhigh beats Fable max. Luna medium is 11%.

## Locked effort (do not reopen per job)

| Model | Default effort | Escalate to | Never |
|---|---|---|---|
| GPT-5.6 Terra | **max** | — | xhigh and below. Terra only exists at max. |
| GPT-5.6 Sol | **xhigh** | **max** when the job is "be smart" / architecture | low, medium |
| GPT-5.6 Luna | **max** | — | high and below. medium is 11%, low is 1.5%. |
| Claude Fable 5 / 5.1 | **high** | **xhigh** if high still fails. **max** only if a wrong answer costs more than the Fable week | low. max is a cost trap. |
| Claude Opus 5 | **high** | xhigh/max only if high fails | low. max buys ~1 point for ~2x $ |
| Grok 4.6 | **medium** | high if medium is sloppy | xhigh (same score, more $). low (42%) |
| Muse Spark 1.3 | **xhigh** | 1.2 if 1.3 is blocked | 1.3 has no DeepSWE row; 1.2 xhigh was 55% |
| GLM-5.3 / Flash, Kimi K3, DeepSeek V4 | **max** | — | (only rows on the board) |

Rule: pick the **knee**, not the Best-table max. Knee = last step that still buys real points. After that, extra effort is just meter.

## Pick order (model, then the locked effort above)

1. **Talk / dispatch** — Grok Bot (this chat).
2. **Bulk / volume coding** — Luna Fast / Luna **max** (ChatGPT Pro), or Go **Muse 1.3**, or CLIProxy Grok 4.6 **medium**.
3. **Do not default Terra.** Same $100 pool as Sol/Luna. DeepSWE max 70% vs Sol 73% vs Luna 67%; Vals SWE-Verified has Terra ≈ Sol (both ~95–96%) because that board is saturated. Terra is the expensive middle. Only if Jon names it.
4. **Smart / hard design** — Sol **xhigh**, Sol **max** if we actually need the extra 3 points. This is now the ChatGPT Pro coding default, not Terra.
5. **Hard Claude** — Fable 5.1 **high** (5.1 has no DeepSWE row; Fable 5 high is 69% / $9). If Fable week is the limiter, Opus 5 **high** (73% / $6).
6. **Review / types** — Sol **xhigh** (ChatGPT Pro). Stay on Go with GLM-5.3 if needed. **Never Hy3 or Hy4.**
7. **Never** — Cursor CloudAgent. Never Hy3 / Hy4 / hy3-preview. Never `xai/grok-4.6` (bills API). Never code in this Grok Bot chat. Never Sonnet (54% / $26 at max). Never Luna below **max**. Never Terra unless named. Never Grok 4.6 *on Go* (169 req/5h) — CLIProxy instead.

Live Go names: `models/go-catalog.md` (re-fetch; lineup changes). Default Go worker is **Muse Spark 1.3** as of 2026-09-02, not 1.2.

If a cheaper lane is capped, step to the next still-open plan. Check `model-roster.md` remaining. Do not write "Jon says we still have them."

## Effort curves (our stack only)

Pass@1 and mean API $ / task from the 2026-09-02 live JSON. Blank = Datacurve has not published that level.

### GPT-5.6 Terra (ChatGPT Pro / Codex) — not a default

| Effort | Pass@1 | API $ | Out tok | Steps | Use |
|---|---:|---:|---:|---:|---|
| max | 69.6% ±3% | $4.95 | 72k | 76 | only if Jon names Terra |
| xhigh | 60.2% ±2% | $2.13 | 40k | 43 | no — dumped 9 points |
| high | 53.8% ±4% | $1.13 | 22k | 34 | no |
| medium | 35.1% ±3% | $0.58 | 12k | 25 | no |
| low | 24.1% ±1% | $0.43 | 9k | 21 | no |

Terra without max is a different, worse model. The old "no DeepSWE row" note was wrong: Best Models(20/27) hid it.

### GPT-5.6 Sol (ChatGPT Pro / Codex)

| Effort | Pass@1 | API $ | Out tok | Steps | Use |
|---|---:|---:|---:|---:|---|
| max | 72.7% ±3% | $8.39 | 60k | 61 | architecture / "be smart" |
| xhigh | 70.7% ±1% | $4.70 | 41k | 44 | **DEFAULT smart** |
| high | 69.4% ±1% | $3.47 | 28k | 37 | ok if week is tight |
| medium | 61.1% ±2% | $1.86 | 18k | 31 | no |
| low | 45.4% ±2% | $1.07 | 11k | 23 | no |

Sol is the only frontier where max still buys a real jump (~3 points). Still default xhigh; spend max on purpose.

### GPT-5.6 Luna (ChatGPT Pro)

| Effort | Pass@1 | API $ | Out tok | Steps | Use |
|---|---:|---:|---:|---:|---|
| max | 67.2% ±4% | $3.03 | 73k | 102 | **DEFAULT volume** (site Best $0.61 is a different display; we keep JSON mean) |
| xhigh | 56.9% ±2% | $1.54 | 45k | 71 | only if max is draining the week |
| high | 44.2% ±3% | $0.78 | 26k | 49 | no |
| medium | 11.3% ±1% | $0.22 | 8k | 24 | dead |
| low | 1.5% ±1% | $0.07 | 3k | 12 | dead |

Luna Fast has **no DeepSWE row**. Treat it as cheaper Luna; still run thinking **max**, not medium.

### Claude Fable 5 (Claude Max). Fable 5.1: same effort policy, no DeepSWE row yet.

| Effort | Pass@1 | API $ | Out tok | Steps | Use |
|---|---:|---:|---:|---:|---|
| xhigh | 69.9% ±3% | $13.41 | 80k | 68 | escalate; actual best score, cheaper than max |
| max | 69.7% ±4% | $21.63 | 119k | 88 | almost never — Best-table trap |
| high | 68.6% ±1% | $9.18 | 57k | 59 | **DEFAULT hard Claude** |
| medium | 65.4% ±4% | $6.09 | 40k | 48 | ok if Fable week is the limiter |
| low | 59.6% ±3% | $3.76 | 25k | 38 | no |

Max is ~2x high for ~1 point inside the error bar. High is the knee.

### Claude Opus 5 (Claude Max, when Fable week is the stop)

| Effort | Pass@1 | API $ | Out tok | Steps | Use |
|---|---:|---:|---:|---:|---|
| max | 73.6% ±4% | $11.84 | 118k | 99 | rare |
| xhigh | 73.2% ±3% | $9.07 | 92k | 89 | if high fails |
| high | 72.8% ±2% | $6.08 | 64k | 73 | **DEFAULT** |
| medium | 68.9% ±1% | $3.29 | 37k | 52 | ok if all-models week is tight |
| low | 58.1% ±2% | $1.66 | 20k | 36 | no |

### Grok 4.6 (CLIProxy Yahoo/X)

| Effort | Pass@1 | API $ | Out tok | Steps | Use |
|---|---:|---:|---:|---:|---|
| xhigh | 66.7% ±2% | $5.50 | 71k | 87 | Best-table row. Do not default here. |
| high | 65.2% ±2% | $4.38 | 61k | 79 | if medium is sloppy |
| medium | 67.5% ±2% | $3.45 | 50k | 70 | **DEFAULT — best score and cheapest of the three** |
| low | 41.6% ±2% | $1.04 | 16k | 44 | no |

No max row on the board. Medium wins. Best hid that.

### Go / others (only the published level)

| Model | Effort | Pass@1 | API $ | Role |
|---|---|---:|---:|---|
| GLM-5.3 | max | 69.0% ±3% | $3.99 | heavy Go if named |
| Kimi K3 | max | 68.5% ±5% | $4.65 | design; burns Go |
| GLM-5.3-Flash | max | 63.4% ±4% | $0.48 | tiny utility |
| DeepSeek V4 Pro | max | 62.8% ±6% | $0.24 | fallback worker |
| Muse Spark 1.2 | xhigh | 54.9% ±2% | $3.70 | cheap Go workhorse |
| DeepSeek V4 Flash | max | 53.3% ±4% | $0.10 | last-resort Go |
| Claude Sonnet 5 | max | 53.8% ±4% | $26.40 | never |

## Cost per task on *our* money

DeepSWE $ is API. Translate through the effort table:

- Luna **max** is the volume lane on the $100 week. Luna medium is not a cheaper Luna; it is a broken Luna.
- Terra **max** is the $100 workhorse. Cheaper Terra efforts are fake savings.
- Sol **xhigh** is the smart default. Sol **max** is the spendy 3-point bump.
- Fable **high** (then xhigh) is the scarce $60 resource. Fable **max** is how you torch the Fable week.
- Opus **high** is the Fable-week overflow. Cheaper than Fable at every matched level.
- Grok **medium** is the extra almost-unlimited lane. We pay Grok Build OAuth, not xAI API.
- Go Muse 1.3 is cheap on the $10 bar (45k req/5h). Not Sol-smart. 1.2 is the fallback with a DeepSWE row.



## Time and tokens (the two "useless" edges)

IQ without a clock is a trap. DeepSWE `mean_duration_seconds` is wall time to finish a long-horizon task. `tok/s` here is **output tokens / duration**, not vendor streaming TPS. A model can stream fast and still take forever if it writes a novel. A model can have high tok/s and still be worse per point if it dumps 2× the tokens at the same IQ.

Two edges we will not pick:

1. **Too slow at the score.** Kimi K3 max is 69% but **76 minutes** and 18 tok/s. GLM-5.3 max is 69% at **35 minutes**. Fable **max** is 35 minutes for the same 70% Fable **high** gets in 18 minutes. Do not spend wall-clock we do not have.
2. **Fast stream, fat transcript.** Muse 1.2 xhigh is **107 tok/s** (fastest in this set) but **99k output tokens** for 55% IQ. Sol xhigh is 51 tok/s, **41k tokens**, 71%, **13 minutes**. High TPS at 2× tokens and worse IQ is not a win. Luna max is similar: 65 tok/s but 73k tokens vs Sol xhigh 41k.

Locked-effort wall time and output (DeepSWE 2026-09-02 JSON):

| Pick | Pass@1 | Minutes | Out tok | tok/s | Read |
|---|---:|---:|---:|---:|---|
| Sol xhigh | 70.7% | 13.3 | 41k | 51 | **Default smart.** Fast enough, thin transcript. |
| Grok 4.6 medium | 67.5% | 14.9 | 50k | 56 | Volume lane that actually finishes. |
| Terra max | 69.6% | 16.9 | 72k | 71 | Faster stream than Sol, **more tokens**, not a default. |
| Fable 5 high | 68.6% | 17.7 | 57k | 54 | Hard Claude. Finish time is the tax. |
| Luna max | 67.2% | 18.7 | 73k | 65 | Volume. More tokens than Sol for less IQ; cheap on the $100 week anyway. |
| Sol max | 72.7% | 18.8 | 60k | 53 | Worth it when we mean smart. Still under 20 min. |
| Opus 5 high | 72.8% | 19.4 | 64k | 55 | Fable-week overflow. |
| Muse 1.2 xhigh | 54.9% | 15.5 | 99k | 107 | Fast stream, fat and worse. 1.3 vendor claims fewer tokens; no independent duration yet. |
| Fable 5 max | 69.7% | 34.9 | 119k | 57 | Useless extra 17 minutes. |
| GLM-5.3 max | 69.0% | 35.3 | 80k | 38 | Same IQ as Sol high, 3.5× the clock. |
| Kimi K3 max | 68.5% | 75.7 | 81k | 18 | Do not grunt. Design-only if ever. |

Rule: pick on **points per minute** and **tokens per point**, not TPS alone. If two models are within error of each other, take the one that finishes sooner with fewer output tokens.

## Other boards (how we use them)

DeepSWE stays primary because it is not saturated and it publishes effort. Everything else is a check, not a replacement.

| Board | What it is | How we use it |
|---|---|---|
| DeepSWE 1.1 | 113 original long-horizon tasks, effort-aware | **Primary pick table.** |
| Artificial Analysis Coding Agent Index v1.4 | Equal mix of DeepSWE + Terminal-Bench v2.1 (89 tasks) + SWE-Atlas-QnA (124) | Independent harness-aware composite. Use when DeepSWE and terminal/repo-Q&A might disagree. |
| Terminal-Bench v2.1 (AA / Terminus 2) | 89 agentic terminal tasks | Second board. **Fable 5.1 max 91.4%** (the independent 5.1 number). Sol xhigh 89.5%, Opus 5 max 89.1%, Grok 4.6 high 88.4%, Terra max 88.0%, Luna max 80.9%, GLM-5.3-Flash 84.3%. Official tbench 2.1 page is empty (shows TB 4.0). |
| Vals SWE-bench Verified | 500 GitHub issues, mini-swe-agent, updated 2026-09-01 | **Saturated.** Opus 5 97%, DeepSeek V4 Pro 96.4%, seven models ≥95%. Do not rank Sol vs Terra vs Fable off this. Useful detail: Luna drops on 1–4h and >4h tasks (86% / 67%) while Sol stays 98% / 100%. |
| SWE-bench Pro / Scale SEAL | Harder successor | Independent SEAL public (2026-09-02) has **none** of our stack; top is Spark 1.1 61.5%. Vendor Pro (Fable 5.1 81.2, Opus 5 79.2, Sol 64.6) is a different scaffold. Do not mix. |
| AA Intelligence Index v4.1.1 | General (not coding-only) | Fable 5.1 max **66**, Opus 5 **63**, Sol / Grok 4.6 **61**, Terra **56.6**, Luna **52.3**. |
| Vendor cards / CursorBench | Anthropic, OpenAI, Cursor | Label as vendor. Fable 5.1 DeepSWE 67.4% avg@5 (not on live JSON). CursorBench 73.4%. |

Terra vs Sol vs Luna: DeepSWE still separates them (70 / 73 / 67 at max). SWE-Verified does not. That is why Terra is not a default — it is the expensive middle of the $100 pool.

**Muse Spark 1.3** (same weights as Contributor): independent AA Intelligence Index **62** at max (AA model page, 2026-09). That sits with Sol/Opus/Grok on the general index (~61–63). Meta’s own launch card (reprinted; Meta.com HTML 400 from this box) is **vendor / Muse Code harness**: DeepSWE v1.1 **75.4**, Terminal-Bench 2.1 **88.8**, vs 1.2 vendor 59.3 / 82.9. Do not drop 75.4 onto the Datacurve JSON — independent 1.2 was 54.9 against Meta’s 59.3. 1.3 is still **not** on DeepSWE live JSON. Contributor = same checkpoint, cheaper because it trains on prompts.

**Hy3 / Hy4:** banned. No pick, no review lane, no fallback.


## Dispatcher cheat sheet

| Job | Send | Effort |
|---|---|---|
| This desk chat | Grok Bot | n/a |
| Lots of similar coding / fan-out | Luna Fast, or Go Muse 1.3, or CLIProxy Grok 4.6 | Luna **max** / Muse **xhigh** / Grok **medium** |
| One serious Codex coding session | Sol, not Terra | Sol **xhigh** (max if smart) |
| Architecture / nasty bug / "be smart" | Sol, else Fable 5.1 | Sol **xhigh** (max if needed) / Fable **high** |
| JG feel / Fable-shaped | Fable 5.1; Opus 5 if Fable week is the limiter | **high**, xhigh if high fails |
| Types, contracts, review | Sol, not Hy | Sol **xhigh** |
| Tiny ops | GLM-5.3-Flash on Go | **max** |
