---
name: Model routing
description: Pick the cheapest favorited model-* subagent that can do the job. Use before spawning Task workers when the right model is not obvious.
---

MODEL ROUTING — pick the cheapest favorite that can do the job.
Prices below are real list $/1M from the models.dev-backed cache, sorted by output price.
Go-quota, Sub, and Free lanes are cheap for you EVEN IF the list price looks big (Luna/Sol/Grok ride subs). Metered = pay-per-token; avoid unless named.
Flash/Pro/fast suffixes are NAMES, not speed or quality guarantees — trust the cost column and curated BEST/AVOID.
If the user names a model, use that. `general` is isolation, not a quality upgrade. `explore` is read-only search.

- model-opencode-x-preview-f-free · Free/explore · 1M ctx · $0/$0 per 1M · tools+reasoning+structured · BEST: throwaway previews, cheap second opinion · AVOID: production-critical or anything you need to trust
- model-opencode-go-muse-spark-1-2-contributor · Go-quota/codegen · 1M ctx · $0.1/$0.2 per 1M · tools+reasoning+structured · BEST: DEFAULT WORKHORSE — 90% of worker tasks: impl, tests, refactors, debugging, UI/HUD, frontend, scene/codegen, grunt, bulk edits, docs, parallel fan-out, most coding · AVOID: fail-closed types, security-sensitive, when it takes shortcuts → escalate to Grok 4.6 (grok-sub) or Kimi
- model-opencode-go-deepseek-v4-flash-vision-exp · Go-quota/worker · 1.05M ctx · $0.104/$0.207 per 1M · tools+reasoning+structured · BEST: fallback worker for vision-adjacent tasks when Muse unavailable; not default — Muse replaces it for standard coding · AVOID: default dispatch — use Muse Spark 1.2 first; also novel architecture, when it loops, fail-closed types
- model-opencode-go-glm-5-3-flash · Go-quota/utility · 1.31M ctx · $0.15/$0.5 per 1M · tools+reasoning+structured · BEST: tiny utility/ops only when explicitly requesting cheapest 1M run — NOT default; prefer Muse even for ops/grunt/bulk/docs · AVOID: default dispatch — Muse is default even for most ops; also complex multi-step debug, novel architecture
- model-grok-sub-grok-4-6 · Sub/worker · 500k ctx · $2/$6 per 1M · tools+reasoning+structured · BEST: hard debugging, long rewrites, whole-file refactors, reasoning-heavy tasks when Muse takes shortcuts — fallback, not default (grok-sub only, never xai/*) · AVOID: default dispatch, utility/ops, tiny edits — Muse is default; use Grok only for hard debugging/long rewrites/shortcut recovery
- model-openai-gpt-5-6-luna-fast · Sub/escalate · 1.05M ctx · $1/$6 per 1M · tools+reasoning+structured · BEST: when the user names it, or a cheaper model already failed · AVOID: default dispatch - sub is cheap, but no observed edge over Go workers
- model-opencode-go-kimi-k3 · Go-quota/heavy · 1.05M ctx · $3/$15 per 1M · tools+reasoning+structured · BEST: design, creativity, novel architecture, long-horizon, huge context, multimodal, hard agentic · AVOID: grunt, ops, utility runs, verifications - slow and quota-burning
- model-openai-gpt-5-6-sol · Sub/escalate · 1.05M ctx · $5/$30 per 1M · tools+reasoning+structured · BEST: when the user names it, or a cheaper model already failed - frontier reasoning, hard design, architecture · AVOID: default dispatch

DEFAULT: Muse Spark 1.2 Contributor for ~90% of tasks — impl, tests, refactors, debug, UI/HUD, frontend, scene/codegen, grunt, bulk edits, docs, parallel fan-out, most coding (also most ops). GLM Flash only for tiny utility/ops when explicitly requesting cheapest 1M run — not default. Grok 4.6 (grok-sub only, never xai/*) only for hard debugging/long rewrites/when Muse shortcuts. DeepSeek Flash not default (Muse replaces it). Design/creativity/architecture -> Kimi K3 (slow, deliberate). Review -> hy3 (luna-fast while Go capped). Escalate Luna/Sol only when named or cheaper already failed.
Curation lives in model-profiles.json; costs come from models-cache.json (auto-refreshed from models.dev). Edit profiles, then `bun favorite-agents.ts sync`.

Do not burn quota-heavy or metered favorites when a cheaper favorite fits.