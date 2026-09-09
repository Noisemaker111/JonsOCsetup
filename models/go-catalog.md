# OpenCode Go catalog (live)

Pulled 2026-09-02 9:48pm ET. Source of truth for *what Go has right now*. The lineup changes; re-fetch `https://opencode.ai/zen/go/v1/models` and [docs/go](https://opencode.ai/docs/go/) before assuming a name still exists.

Jon’s VPS `opencode-go` key returned the same 34 ids as the public catalog. Usage at that pull: 5h **0% used** (resets 2:46am ET Sep 3), week **39% used / 61% left** (resets 8:00pm ET Sep 6), month **75% used / 25% left** (resets 4:12pm ET Sep 15). Limits are dollar-value ($12 / 5h, $30 week, $60 month), not a flat request cap. Cheaper models last longer.

OpenCode id is `opencode-go/<model-id>`.

## Use these (active, documented 2026-09-02)

Quota = official estimated requests per 5h / week / month at typical Go token mix. `$in/$out` is per 1M tokens (relative burn on the $10 Go bar).

### Volume / almost-unlimited

| Model | id | 5h req | Week | Month | $in/$out | Notes |
|---|---|---:|---:|---:|---|---|
| Muse Spark 1.3 Contributor | `muse-spark-1.3-contributor` | 45,300 | 113,300 | 226,600 | $0.10/$0.20 | **DEFAULT Go workhorse.** Same weights as paid 1.3. Independent: AA Intelligence Index **62** (max). Vendor (Meta+Muse Code): DeepSWE 75.4, TB 2.1 88.8 — not the Datacurve JSON (1.2 vendor 59.3 vs independent 54.9). Trains on prompts. |
| Muse Spark 1.2 Contributor | `muse-spark-1.2-contributor` | 45,300 | 113,300 | 226,600 | $0.10/$0.20 | Fallback. DeepSWE 1.2 xhigh 55% ±2%. Same train-on-prompts deal. |
| MiMo-V2.5 | `mimo-v2.5` | 30,100 | 75,200 | 150,400 | $0.14/$0.28 | Near-unlimited grunt. Weaker than Muse/GLM-Flash. |
| LongCat-2.0 | `longcat-2.0` | 11,400 | 28,600 | 57,200 | $0.30/$1.20 | Bulk filler. |
| DeepSeek V4 Flash | `deepseek-v4-flash` | 7,600 | 18,900 | 37,800 | $0.22/$0.66 off-peak | DeepSWE max 53%. Peak hours cost 2x (01–04 and 06–10 UTC weekdays). |
| Qwen3.8 Flash | `qwen3.8-flash` | 5,400 | 13,500 | 27,000 | $0.15/$0.47 | New 2026-08-26. Cheap flash. |
| ~~Hy3~~ | `hy3` | 4,300 | 10,750 | 21,500 | $0.14/$0.58 | **NEVER. Jon ban 2026-09-02.** Still in the API dump. Do not pick. |
| Qwen3.7 Plus | `qwen3.7-plus` | 4,300 | 10,800 | 21,600 | $0.40/$1.60 | Mid flash. |
| GPT-5.6 Luna (on Go) | `gpt-5.6-luna` | 2,050 | 5,100 | 10,250 | $0.20/$1.20 | Extra Luna lane on the Go bar. Prefer ChatGPT Pro Luna **max** first so we do not double-burn. Always thinking **max**. |

### Cheap-capable (still lots of requests)

| Model | id | 5h req | $in/$out | Notes |
|---|---|---:|---|---|
| GLM-5.3-Flash | `glm-5.3-flash` | 1,580 (2× promo) | $0.15/$0.50 docs; tracker $0.07/$0.25 | DeepSWE max 63%. Mechanical work we would actually merge. |
| ~~Hy4 preview~~ | `hy4-preview` | 1,350 | $0.83/$2.50 | **NEVER. Jon ban 2026-09-02.** |
| Kimi K2.7 Code | `kimi-k2.7-code` | 1,350 | $0.95/$4.00 | Code-tuned K2. DeepSWE K2.7 was 30% — do not treat as K3. |
| DeepSeek V4 Pro | `deepseek-v4-pro` | 1,050 | $0.66/$1.98 off-peak | DeepSWE max 63%. Better than Flash, burns more. |
| MiniMax M3 | `minimax-m3` | 3,200 | $0.30/$1.20 | Fine as extra worker. |
| MiniMax M2.7 | `minimax-m2.7` | 3,400 | $0.30/$1.20 | Older MiniMax. Prefer M3. |
| MiMo-V2.5-Pro | `mimo-v2.5-pro` | 3,250 | $0.43/$0.87 | Stronger MiMo, 10x fewer requests than V2.5. |
| DeepSeek V4 Flash Vision Exp | `deepseek-v4-flash-vision-exp` | 3,800 | $0.22/$0.66 | Vision-adjacent only. |
| Kimi K2.6 | `kimi-k2.6` | 1,150 | $0.95/$4.00 | Older K2. Prefer K2.7 Code if we want this family. |
| Qwen3.6 Plus | `qwen3.6-plus` | 3,300 | $0.50/$3.00 | Older Qwen plus. Prefer 3.7/3.8 Flash. |
| GLM-5.2 / GLM-5.1 | `glm-5.2` / `glm-5.1` | 880 | $1.40/$4.40 | Superseded by 5.3. Skip unless 5.3 is down. |

### Scarce on Go (do not grunt)

| Model | id | 5h req | $in/$out | Notes |
|---|---|---:|---|---|
| GLM-5.3 | `glm-5.3` | 220 | $1.40/$4.40 | DeepSWE max 69%. Smart-on-Go when we want it. Not volume. |
| Grok 4.6 (on Go) | `grok-4.6` | 169 | $2/$6 | **Do not use on Go.** 169/5h. Same model is almost-unlimited on CLIProxy Grok Build. |
| Qwen3.8 Max | `qwen3.8-max` | 160 | $2/$6 | DeepSWE xhigh 57%. Scarce. |
| Qwen3.7 Max | `qwen3.7-max` | 170 | $2.50/$7.50 | Scarce. Prefer 3.8 Max if we spend a max slot. |
| Kimi K3 | `kimi-k3` | 110 | $3/$15 | DeepSWE max 69%. Design-only. Fastest way to empty the Go week. |

## Deprecated / do not pick (still in the 34-id API dump)

`grok-4.5`, `glm-5`, `kimi-k2.5`, `minimax-m2.5`, `qwen3.5-plus`, `mimo-v2-pro`, `mimo-v2-omni`, `hy3`, `hy3-preview`, `hy4-preview`. Hy is banned, not a fallback.

## Go routing (inside this meter)

1. Default worker — `muse-spark-1.3-contributor`. Fall back to 1.2 if 1.3 is region-blocked or dumb.
2. Mechanical / mergeable cheap — `glm-5.3-flash` (2× promo) or `qwen3.8-flash`.
3. Review / types — **not Hy.** Sol **xhigh** on ChatGPT Pro, or `glm-5.3` if we must stay on Go.
4. Smart-on-Go — `glm-5.3`, then `kimi-k3` if we really mean design. Never for fan-out.
5. Extra Luna — `gpt-5.6-luna` on Go only when the ChatGPT Pro week should be saved. Thinking **max**.
6. Never on Go — `hy3`, `hy4-preview`, `hy3-preview`, `grok-4.6` (use CLIProxy), deprecated ids, Kimi K3 grunt.

Privacy: Muse Contributor trains on prompts. Everything else on the docs table is not used for training. Grok/Luna on Go retain 30 days.
