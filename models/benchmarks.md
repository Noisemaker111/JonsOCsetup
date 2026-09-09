# Coding-agent benchmark snapshot — 2026-09-02

Collected live. Cells are **—** when a primary page did not print that number. Nothing here is inferred from rounded bins or secondhand aggregators unless labeled.

## Compact comparison

Peak **independent** DeepSWE (mini-swe-agent, pass@1) and **independent** AA Terminal-Bench v2.1 unless the cell says *vendor*. AA Intelligence = Artificial Analysis Intelligence Index v4.1.1 (not the harness-mixed Coding Agent Index).

| Model | DeepSWE (effort) | Terminal-Bench v2.1 | SWE-Verified / Vals | SWE-Pro | AA Intelligence | notes |
|---|---|---|---|---|---|---|
| GPT-5.6 Sol | **72.7%** max; 70.7% xhigh; 69.4% high | **89.5%** xhigh (AA) | **96.20%** (Vals, 2026-09-01) | **64.6%** *vendor* (OpenAI, 2026-07-09; also Anthropic card) | **61** max (AA, 2026-09-01) | Independent DeepSWE matches OpenAI’s 72.7%. AA Coding Agent Index v1.4 Codex+Sol max = **65** (DeepSWE 69% / TB 83% — different harness). OpenAI also quotes older AA Coding Agent Index v1.1 = 80. |
| GPT-5.6 Luna | **67.2%** max; 56.9% xhigh; 44.2% high; 11.3% medium; 1.5% low | **80.9%** max (AA) | — | **62.7%** *vendor* (OpenAI) | **52.3** max (AA scrape 2026-09-03) | Collapses below high effort on DeepSWE. OpenAI vendor TB 2.1 = 84.7%. |
| GPT-5.6 Terra *(contrast; dropping as default)* | **69.6%** max; 60.2% xhigh; 53.8% high | **88.0%** max (AA) | — | **63.4%** *vendor* (OpenAI) | **56.6** max (AA scrape) | At locked max, DeepSWE ≈ Fable 5 and Luna; at high, **53.8%** vs Sol **69.4%** / Opus **72.8%**. OpenAI vendor TB 2.1 = 87.4%. |
| Claude Opus 5 | **73.6%** max; 73.2% xhigh; 72.8% high | **89.1%** max (AA) | **97.00%** (Vals; #1 of 88, 2026-09-01) | **79.2%** *vendor* (Anthropic Fable 5.1 card) | **63** max / xhigh (AA) | Best independent DeepSWE and Vals Verified in this set. AA Coding Agent Index v1.4 Claude Code+Opus xhigh = **68**. |
| Claude Fable 5 | **69.9%** xhigh; 69.7% max; 68.6% high | **84.6%** max (AA) | — (difficulty bins only; no overall printed) | **80%** *vendor* (OpenAI + Anthropic cards) | **62** max (AA) | Snorkel official TB 2.1 (Claude Code, 2026-06-07): 83.8% ±1.2 — stale vs AA. |
| Claude Fable 5.1 | **67.4%** *vendor* avg@5 (Anthropic card; **not on DeepSWE live JSON**) | **91.4%** max / 91.0% xhigh / 89.9% high (AA, 2026-09-01) | — (Vals dump 2026-09-01 has no 5.1 row) | **81.2%** *vendor* max (Anthropic system card 2026-09-01) | **66** max w/ default fallback; 65 xhigh; 62 high (AA) | Fallback served ~4% of Intelligence-Index output tokens. Vendor TB **4.0** = 55.8% (Mythos 5.1 60.9%) — not 2.1. CursorBench 3.2.0 = 73.4% *vendor/Cursor*. |
| Grok 4.6 | **67.5%** medium; 66.7% xhigh; 65.2% high (no `max` row) | **88.4%** high (AA) | — | — | **61** high (AA, tied with Sol) | Best DeepSWE at **medium**, not higher effort. |
| Muse Spark 1.2 | **54.9%** xhigh | **80.2%** xhigh (AA) | — | — (Scale SEAL public has Spark **1.1*** 61.50±3.10, not 1.2) | **56.8** xhigh (AA scrape) | Only Spark checkpoint on DeepSWE live JSON. |
| Muse Spark 1.3 | **75.4** *vendor* Muse Code (Meta launch card; **not on DeepSWE live JSON**) | **88.8** *vendor* Muse Code; independent AA TB cell still — | — | — | **62** max (AA Intelligence Index, independent, AA model page) | Contributor = same weights. Meta 1.2 DeepSWE was 59.3 vendor vs 54.9 independent — do not treat 75.4 as Datacurve. Register 2026-09-02: AA jump of ~4 pts, dead heat with Sol/Opus/Grok 4.6 High. |
| GLM-5.3 | **69.0%** max | **83.9%** max (AA) | — | — | **59.5** max (AA scrape) | Independent DeepSWE slightly above Z.ai’s launch 66.9 (blog fetch timed out; Flash blog did load). |
| GLM-5.3-Flash | **63.4%** max | **84.3%** (AA scrape; Z.ai vendor same 84.3 in Claude Code 2.1.207) | — | — | **57** (Z.ai citing AA) / **57.5** (AA scrape) | Independent DeepSWE 63.39% matches vendor 63.4. |
| Kimi K3 | **68.5%** max (mini-swe-agent) | **85.0%** max (AA) | **93.40%** (Vals) | — | **59.7** max (AA scrape) | Moonshot *vendor* TB 2.1 = **88.3** in Kimi Code; DeepSWE 67.5 Kimi Code / 67.3 mini-swe (README). Live JSON is 68.51% max. |
| DeepSeek V4 Pro (0813) | **62.8%** max | **78.6%** max (AA) | **96.40%** (Vals; #2) | — | **53.2** (AA scrape) | *Vendor* TB 2.1 **87.9** / DeepSWE **62.7** (DeepSeek changelog 2026-08-21, DeepSeek harness max). Vals Verified is saturated-high; DeepSWE is not. |
| DeepSeek V4 Flash (0731) | **53.3%** max | **78.6%** max (AA; tied with Pro on this scrape) | — | — | **51.8** (AA scrape) | *Vendor* TB 2.1 **82.7** / DeepSWE **54.4** (2026-07-31 changelog). |
| Hy3 | — | — | — | — | — | Not on DeepSWE JSON, Vals, Scale SEAL, or AA TB scrape. Tencent.com Hy4 launch (2026-08-28) does not print Hy3 scores. |
| Hy4 (preview) | — | — | — | — | — | Same: official Tencent page has no TB/DeepSWE table. Secondary coverage attributes vendor TB 2.1 85.4 / DeepSWE 64.3 vs Hy3 70.8 / 28.0 — **not entered here**. |
| Qwen3.8 Max | **57.5%** xhigh | **81.3%** (AA) | — | — | **58.1** (AA scrape) | Qwen launch table (qwen.ai/blog) did not render numbers in the live fetch. AA TB 81.3% is independent. |
| Qwen3.8 Flash / Flash-Next | — | **86.1%** Flash-Next (AA scrape) | — | — | **55.8** Flash-Next (AA scrape) | Flash-Next is on AA TB scrape; not on DeepSWE live JSON. qwen.ai Flash-Next page returned empty. |

Percentages on DeepSWE rounded from live `pass_at_1` in [leaderboard-live.json](https://deepswe.datacurve.ai/artifacts/v1.1/leaderboard-live.json) (`generated_at` **2026-09-02T15:18:19Z**, 113 tasks, 4 runs). Exact: Sol max 0.726667; Luna max 0.671875; Terra max 0.696231; Opus 5 max 0.736486; Fable 5 xhigh 0.699115; Grok 4.6 medium 0.674779; GLM-5.3 max 0.689579; GLM-5.3-Flash max 0.633929; Kimi K3 max 0.685144; V4 Pro max 0.628319; V4 Flash max 0.533186; Qwen3.8 Max xhigh 0.574610; Spark 1.2 xhigh 0.548673.

## DeepSWE locked-effort contrast (independent, same harness)

Do **not** dump the 65-row board. Same mini-swe-agent, pass@1:

| Effort | Opus 5 | Sol | Fable 5 | Terra | Luna | Grok 4.6 |
|---|---|---|---|---|---|---|
| max | 73.6% | 72.7% | 69.7% | 69.6% | 67.2% | — (no max row) |
| xhigh | 73.2% | 70.7% | 69.9% | 60.2% | 56.9% | 66.7% |
| high | 72.8% | 69.4% | 68.6% | 53.8% | 44.2% | 65.2% |
| medium | 68.9% | 61.1% | 65.4% | 35.1% | 11.3% | **67.5%** |
| low | 58.1% | 45.4% | 59.6% | 24.1% | 1.5% | 41.6% |

**Terra vs Sol vs Luna:** Terra is a Sol-class DeepSWE model **only at max** (69.6 vs 72.7 vs 67.2). At high it is a different product (53.8 vs 69.4 vs 44.2). Luna at medium/low is not a coding agent. **Fable 5 vs Opus 5:** Fable is ~3–4 pts behind at max/xhigh/high but **ahead at low** (59.6 vs 58.1) — Fable’s floor is higher; Opus’s ceiling is higher. Grok’s best DeepSWE is medium, not xhigh.

Fable 5.1 is **absent** from this JSON. Anthropic’s own DeepSWE (vendor, avg@5) is **67.4%**, which would sit under Fable 5 and Sol on the independent board — they also warn hidden tests punished extra-rigorous patches.

## Saturation flag — SWE-Verified

Vals (updated **2026-09-01**, independent mini-swe-agent, bash-only, 500 tasks, 88 models): “Seven of the 86 models evaluated reach **95% or better**, and the leader, Claude Opus 5 at **97.00%**, sits 3.00 percentage points from a perfect score — little room is left to separate frontier models on this benchmark alone.” Open-weight DeepSeek V4 Pro 0813 is **96.40%**, Sol **96.20%**, Kimi K3 **93.40%**. That is the 93–97% cluster. Do not route on Verified.

Scale SEAL SWE-bench Pro public (731 tasks, standardized scaffold, fetched 2026-09-02) still tops out at **Muse Spark 1.1* 61.50±3.10** and **gpt-5.4 (xHigh)* 59.10±3.56**. **None of Sol/Luna/Terra, Opus 5, Fable 5/5.1, Grok 4.6, GLM-5.3, Kimi K3, V4, Qwen3.8, Hy4 appear.** Vendor Pro (Anthropic card / OpenAI launch) is a different, harness-tuned number: Fable 5.1 81.2, Fable 5 80, Opus 5 79.2, Sol/Terra/Luna 64.6/63.4/62.7. The 80-vs-61 gap is scaffolding, not model IQ.

## Source log (live fetches)

| Source | Date / generated | Independent? | What we used |
|---|---|---|---|
| https://deepswe.datacurve.ai/artifacts/v1.1/leaderboard-live.json | 2026-09-02T15:18:19Z | independent | DeepSWE pass@1 + effort |
| https://artificialanalysis.ai/evaluations/terminalbench-v2-1 | live | independent (Terminus 2, 3×) | Fable 5.1 91.4 / 91.0 / 89.9 |
| https://temperature2.com/models/benchmarks/terminalbench_v2_1/ | “Data: Artificial Analysis · measured 2026-09-03 00:37 UTC” | AA scrape | other TB 2.1 + Intelligence Index |
| https://artificialanalysis.ai/articles/claude-fable-5-1 | 2026-09-01 | independent | Intelligence Index 66/65/63/62/61 |
| https://artificialanalysis.ai/agents/coding-agents/comparisons/claude-code-vs-codex | live, Index **v1.4** | independent, **harness-specific** | Codex Sol max 65; Claude Code Opus xhigh 68 |
| https://vals.ai/benchmarks/swebench | updated 2026-09-01 | independent | Verified overalls + saturation quote |
| https://labs.scale.com/leaderboard/swe_bench_pro_public | live | independent (SEAL) | no target models; Spark 1.1 61.5 |
| https://snorkel.ai/leaderboard/terminal-bench-2-1/ | last rows Jun–Jul 2026 | independent but **stale** | Fable 5 Claude Code 83.8% |
| https://www.tbench.ai/leaderboard/terminal-bench/2.1 | live | official 2.1 URL **now shows empty TB 4.0 table** | unused |
| https://www.anthropic.com/claude-fable-and-mythos-5-1 + system card PDF 2026-09-01 | vendor | Fable 5.1 SWE-Pro 81.2, DeepSWE 67.4, TB 4.0 55.8, CursorBench 73.4 |
| https://openai.com/index/gpt-5-6/ | 2026-07-09 (vendor) | Sol/Terra/Luna DeepSWE 72.7/69.6/67.2, TB 2.1 88.8/87.4/84.7, SWE-Pro 64.6/63.4/62.7, AA Coding Agent Index **v1.1** 80/77.4/74.6 |
| https://z.ai/blog/glm-5.3-flash | 2026-08-26 vendor | Flash TB 2.1 84.3, DeepSWE 63.4, AA Intel 57 |
| https://www.kimi.com/blog/kimi-k3 + GitHub README | vendor | TB 2.1 88.3 (Kimi Code); DeepSWE 67.5 / 67.3 mini-swe |
| https://api-docs.deepseek.com/updates/ | 2026-08-21 / 07-31 vendor | V4 Pro TB 87.9 / DeepSWE 62.7; Flash 82.7 / 54.4 |
| https://www.tencent.com/tencent-releases-and-open-sources-tencent-hy4-preview/ | 2026-08-28 | no TB/DeepSWE numbers printed |

## Which boards are actually useful for routing coding agents in 2026

**Use:** DeepSWE v1.1 on a **locked harness and locked effort** (the live JSON) — it still spreads ~1.5%–74% and is the only apples-to-apples long-horizon repo eval in this set; Terminal-Bench **v2.1 on AA/Terminus 2** still separates (91% Fable 5.1 vs ~80% Luna vs ~53% Spark 1.2 DeepSWE-class models), but TB 2.1 is **near-ceiling for frontier CLIs** and Snorkel/tbench official 2.1 is either stale or empty, so prefer AA and treat vendor “best harness” 87–89% rows as marketing; Scale SEAL SWE-Pro public if they ever run the current frontier (today they have not); AA Intelligence Index for general ranking, **AA Coding Agent Index v1.4 only with the harness named** (Claude Code Opus 68 ≠ Codex Sol 65 ≠ OpenAI’s old v1.1 80). **Ignore for routing:** SWE-bench Verified / Vals (93–97% cluster, 3 pts from perfect); vendor SWE-Pro without a shared scaffold (Fable 81 vs SEAL ~60); Terminal-Bench 4.0 vendor tables vs 2.1 (different task set; Fable 5.1 55.8% on 4.0 vs 91.4% on 2.1); Hy4/Qwen/Muse 1.3 launch charts until they land on DeepSWE JSON or AA. **Terra as default is a DeepSWE-high/xhigh regression against Sol and Opus; keep it only as a cost tier at max, not as the coding default.**
