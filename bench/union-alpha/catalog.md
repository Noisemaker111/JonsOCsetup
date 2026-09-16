# stealth/union-alpha — provider catalog check (2026-09-16)

Live check of the two providers Jon named, OpenRouter and OpenCode Zen. Every fact carries its
source; anything the providers do not publish is listed under **Not confirmed**. Raw captures are in
`evidence/`.

## Identity

| Fact | OpenRouter | OpenCode Zen |
|---|---|---|
| Display name | Union Alpha | Union Alpha Free |
| Exact model id | `stealth/union-alpha` | `union-alpha` (OpenCode config id `opencode/union-alpha`) |
| Endpoint | `POST https://openrouter.ai/api/v1/chat/completions` | `POST https://opencode.ai/zen/v1/messages` (`@ai-sdk/anthropic`) |
| First seen | created 2026-09-16 14:42:03Z; page says "Released Sep 16, 2026" | live list `created` 1789598446 = 2026-09-16 22:40:46Z |
| Free | yes — API pricing prompt `0`, completion `0`; FAQ: "the pricing shown on this page for Union Alpha is zero, so you are not charged for prompt or completion tokens" | yes — Zen pricing table row "Union Alpha Free | Free | Free | Free" |
| Context window | 262,144 tokens | not published on Zen's pages |
| Max output | 131,072 completion tokens | not published on Zen's pages |
| Inputs → outputs | text + image input, text output; one provider ("Stealth", tag `stealth`, uptime ≥99.98% over 5m/30m/1d) | not published |
| Parameters | `max_tokens`, `temperature`, `top_p`, `tools`, `tool_choice`, `response_format`; tool calls yes, JSON output yes without JSON-schema enforcement | not published |
| Author | anonymous third-party provider; page: "developed and operated by a third-party provider who has chosen to remain anonymous during this preview. OpenRouter routes requests to it and is not its developer, owner, or provider"; page meta creator `stealth` | provider unnamed |
| Base model | not published | not published |

Sources, all fetched 2026-09-16:

- OpenRouter model page `https://openrouter.ai/stealth/union-alpha` (FAQ quotes above).
- OpenRouter endpoints API `https://openrouter.ai/api/v1/models/stealth/union-alpha/endpoints`
  (`context_length` 262144, `max_completion_tokens` 131072, pricing 0/0, `per_request_limits` null).
- OpenRouter models API `https://openrouter.ai/api/v1/models` → `evidence/openrouter-model.json`.
- OpenCode Zen docs `https://opencode.ai/docs/zen/` (endpoint table, pricing table, stealth paragraph;
  footer "Last updated: Sep 16, 2026").
- OpenCode Zen live model list `https://opencode.ai/zen/v1/models` → `evidence/zen-models.json`
  (entry `{"id":"union-alpha","object":"model","created":1789598446,"owned_by":"opencode"}`).
- `https://models.dev/api.json` — supplementary only: this is the catalog OpenCode itself consumes,
  not a Zen publication. For `opencode/union-alpha` it lists context 262,144, output 131,072,
  text+image input, tool calling, reasoning true, open weights false, released 2026-09-16 →
  `evidence/models-dev-union-alpha.json`. It agrees with OpenRouter's published numbers.

## Terms

OpenRouter, Stealth Program End User License Agreement (linked from the model page, "Updated: September 14,
2026", `https://openrouter.ai/terms/stealth`):

- Stealth models are "free of charge for a limited period of time"; no availability guarantee, and a
  model "may be removed from our Stealth Program at any time" without notice.
- The listing, not the EULA, states training use. Union Alpha's listing: "Prompts and completions may be
  retained by the provider but are not used for training". Inputs, including any personal data in them,
  go to the stealth provider.
- Acceptable use includes a clause against "publicly disseminate confidential technical information
  regarding the performance of the Stealth Models" — relevant to how scores from this Quest may be
  published.
- No third-party key access or resale, no rate-limit bypass.

OpenCode Zen, docs page:

- "Union Alpha Free is a stealth model available on OpenCode for a limited time. Its provider follows a
  zero-retention policy and does not use your data for model training."
- Union Alpha is not listed among the Zen privacy exceptions that may train on data, consistent with
  the paragraph above. Zen publishes no separate stealth EULA.
- Retention wording differs between providers: OpenRouter says content "may be retained"; Zen says the
  provider follows a zero-retention policy. Treated as provider-level statements, not reconciled.

## Limits (rate and quota)

OpenRouter:

- No per-model rate limit is published on the model page or endpoints API (`per_request_limits` null).
- Platform free-model policy (`https://openrouter.ai/docs/api-reference/limits`): 20 requests/minute;
  50 requests/day under 10 all-time credits purchased; 1000 requests/day at 10 or more. The doc scopes
  that policy to ids ending in `:free`; `stealth/union-alpha` does not, so applicability to this id is
  unstated. Account state and the daily counter are readable at `GET /api/v1/key`.

OpenCode Zen:

- No per-model rate limit, quota, context or output figure is published on the Zen docs page or the
  live `/zen/v1/models` endpoint (the docs promise "models and their metadata", the endpoint returns
  only `id`/`object`/`created`/`owned_by`).

## Not confirmed

- Who authors or operates Union Alpha on either provider, and what base model it derives from.
- Zen context window / max output from Zen's own pages (OpenRouter publishes 262,144 / 131,072; the
  models.dev catalog repeats them).
- Zen rate limits, and whether OpenRouter's free-tier caps apply to this zero-priced id.
- Zen tool-calling and modality details from Zen's own pages.

## Verification

`bun bench/union-alpha/verify-catalog.ts` re-fetches both live listings and asserts the exact ids,
context, output and price facts recorded above; it writes `evidence/verify-output.txt` and exits
non-zero on any mismatch.
