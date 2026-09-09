# Free review for Claude Fable 5.1

You are Claude Fable 5.1. This is not a rubber-stamp. Allbot (a Grok Bot dispatcher) built a routing desk for Jon R and then asked you to look at it with a clean head. Do not inherit Allbot's conclusions. Read the files. Notice what is overfitted, internally inconsistent, missing, too slow, too expensive, or logically broken. Say so. If Allbot is right about something, say that too. Improve the repo where you are sure. Leave notes where you are not.

Working directory is this git repo: `Noisemaker111/opencode-config` on the VPS at `/home/debian/.config/opencode`. Stay inside this repo. Do not push. Do not clone other repos. Do not touch appforgutters, jgengine, or upstream OpenCode. Write your findings to `models/fable-free-review-out.md` as you go.

## Who this is for

Jon R (GitHub Noisemaker111). Westland, Michigan. Handy speech-to-text, messy transcripts. Not super-technical but learns fast. Talks only to Allbot in a 1:1 Grok Bot chat, 24/7 on purpose. He wants Allbot as a thin dispatcher, not the coding runtime. Heavy work should burn Claude / Codex / Go / Grok Build subscriptions through OpenCode 2, not the $30 Grok Bot meter.

Crew Grok Bot agents (Ops, Devr, Studio) burn the *same* Grok meter as Allbot. Keep them tiny. Quests live in the OpenCode 2 quests plugin, not on those agents. Cursor CloudAgent is banned unless Jon reverses it in the Allbot chat.

## The machine picture

- Always-on: OVH VPS `debian@51.81.85.56` (no sudo). OpenCode 2 beta on `127.0.0.1:4096`. CLIProxyAPI 7.2.147 on `127.0.0.1:8317` with OAuth for Claude (Gmail), Codex (Gmail ChatGPT Pro), Grok Build (Yahoo / X, not Gmail SuperGrok).
- This repo is the OpenCode config. Secrets stay out of git (`auth.json` copied off-git).
- Home PC Jons-pc is last resort, on-demand only.
- Cloudflare only. No Vercel. Never contribute upstream to sst/opencode. Never push/merge appforgutters unless Jon is explicit in the Allbot 1:1.

## Plans and meters (last live probes 2026-09-02 evening ET, do not treat as gospel)

- ChatGPT Pro ~$100 weekly WHAM: Terra / Sol / Luna / Codex share it. Was ~63% left.
- Claude Max ~$60: Fable week was 55% used, all-models week 29% used, reset Sat 3pm ET.
- OpenCode Go $10: 5h unused, week 61% left, month 25% left. Dollar bars $12/5h, $30 week, $60 month.
- Grok Build via CLIProxy (Yahoo/X): separate from grok.com Gmail SuperGrok (that weekly was HIT) and from Grok Bot.
- Grok Bot weekly ~95% left, resets Sep 9. Talk only.

CLIProxy `/v1/models` includes `claude-fable-5-1`, `claude-opus-5`, `gpt-5.6-sol`, `gpt-5.6-luna`, `gpt-5.6-terra`, `grok-4.6`, and more. OpenCode jsonc did not list Fable 5.1 until this turn.

## What Allbot just locked (challenge this)

Files to read first: `models/routing-table.md`, `models/go-catalog.md`, `models/benchmarks.md`, `models/model-profiles.json`, `opencode.jsonc`.

- Pick is **model + thinking level**, not a bare name. DeepSWE 1.1 live JSON is the primary board (65 configs). Best-table max is often a cost trap.
- Locked efforts Allbot chose: Terra max (but Terra is *not* a default pick), Sol xhigh (max when smart), Luna max always, Fable high (xhigh escalate, skip max), Opus high, Grok 4.6 medium, Muse 1.3 xhigh.
- Volume: Luna max, Go Muse 1.3 Contributor, CLIProxy Grok medium.
- Smart: Sol. Hard Claude: Fable 5.1. Review: Sol xhigh after Jon banned Hy3/Hy4 for everything.
- Muse 1.3: independent AA Intelligence Index 62. Vendor Meta+Muse Code DeepSWE 75.4 / TB 2.1 88.8. Not on Datacurve JSON. Contributor trains on prompts.
- Time/token edge Allbot just added: Kimi K3 is 76 minutes; Muse 1.2 is 107 tok/s but 99k output for 55%; Sol xhigh is 13 minutes / 41k tokens / 71%. High TPS with 2× tokens at worse IQ is not a win. Too-slow at the same IQ is not a win.

Jon also said: no gatekeeping, commit+push then clone, do not copy packs across machines, do not wait for a second "go."

## What we want from you

Study the connections (Allbot ↔ OpenCode 2 ↔ CLIProxy ↔ Go / Claude / Codex / Grok, plus the jsonc providers and plugins). Study the files. Study the goal: a desk that picks the right model and effort without wasting weekly bars or wall-clock.

Then make it better. That can mean edits, deletions, new files, a different pick table, a hole you found in the latency story, a wrong provider id, a quest/plugin issue, or a simpler design. You are not required to keep Allbot's table. You are not required to blow it up.

Do not optimize for agreeing. Do not optimize for a dramatic rewrite. Optimize for being correct about *this* setup.

When you are done, `models/fable-free-review-out.md` should be something Jon can read: what you noticed, what you changed, what you left, what you are unsure about. Plain language.
