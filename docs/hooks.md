# Hook responsibilities

Tools are called on demand. Hooks run because a host event happened. Sharing a
usage service between tools and the HUD is appropriate; automatically narrating
that service on every turn was redundant and has been removed.

| Owner | Trigger | Effect on model context |
|---|---|---|
| models/server.ts | model HTTP response and context | Reports actual failed model HTTP responses only to the originating session; successful responses clear pending notices. Tool inputs, source files and quoted errors are never inferred to be live provider failures. |
| models/context-plugin.ts | context | Adds a recoverable task checkpoint only when one has been explicitly prepared; separate from durable MEMORY.md. |
| quest/worker-capabilities.ts | worker context and outgoing request | Enforces exact worker identity, filters read-only tools, records capability names, and adds assigned-Quest save guidance to the execute description. |
| quest/user-giver.ts | giver context | Registers/checks the persistent giver identity; no system prose. |
| harnesses/claude-code-session.ts | Claude bridge context | Prevents relaying Claude through an unintended model and removes outer tools from its bridge turn; no system prose. |
| models/access-policy.ts | outgoing request | Validates the configured model and transport; no system prose. |
| usage request/context event collectors | requests and compaction events | Record telemetry and compaction outcomes; no prompt injection. |
| quest/codex/runtime.ts | configured Codex pre/post tool hooks | Binds real host identity, protects workspace ownership, and reports recovery binding or evidence failures when relevant. These are tool-event messages, not routine every-turn usage narration. |

Removed: usage/context-summary.ts and its every-turn accounting paragraph; the
models plugin's routine quota-summary producer; the router's repeated policy
paragraph. The giver prompt and typed tool descriptions own routing instructions.
usage_status, usage_pacing, usage_experience and the HUD keep their existing data
sources. Failure notices, model access, worker identity and ownership protections
remain. MEMORY.md uses ordinary file reads and edits, with no injection hook.

This describes our plugin source. Host built-in system instructions, skill
catalogues and project instruction loading are separate host behavior. Already
running sessions keep their loaded release until explicitly reopened.
