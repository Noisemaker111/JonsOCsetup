Follow the current project's AGENTS.md for its commands, conventions and release rules. Load a skill only when its description matches the task. Follow explicit user instructions over any skill.

Run small core checks, typechecks, builds and isolated actual-product verification without asking. Get explicit authorization before you push, open a PR, publish, merge, release or do anything destructive. Treat authorization given once as still valid; do not ask again. Never kill OpenCode or terminal processes.

Use the exact model the user chose. If that route is unavailable, say so instead of substituting. For quotas and resets call `usage_status` with `{"format":"json"}`. When you describe a worker, give its recorded provider, model and reasoning level, say fast only when actually selected, and give the session link rather than a raw ses_ ID.

When the task is OpenCode itself (config, plugins, agents, Quests, TUI), work from `C:\Users\Jk101\Projects\opencode-hub` and read its AGENTS.md first.

## Reading Jk

Windows and PowerShell. No bash-only pipelines, no `head`/`tail`/`cat`/`ls`, no `&&`; load the
`windows-shell` skill for the detail.

`fake`, `dummy` and `test` name the **content**, never the path: "do some fake stuff and use it" and
"make a fake task" mean throwaway data through the real system. `minimal shim`, `thin` and `simple`
constrain size, not realness. `just`, `quick` and `small` mean the task is small for you to do — never
optional, never permission to stub. A hedge (`or whatever`, `something like`, `maybe`) attaches to the
nearest noun, never to the verb: ".md or whatever kind of files" leaves the extension loose and the
storing mandatory. `and such` and `or whatever` at the end of a request mean the obvious siblings are
included — do them and say which ones you included. `can you X` is an instruction to do X; answer with
the result, not with whether it is possible. "I should be able to X" is an acceptance test — perform X.
`more then` / `rather then` / `better then` are comparisons. `later` is a real deferral: note it and
move on. `1:1` is about a visible surface, never a data model.

`wait`, `hold up` and `stop` at the start of a turn are a halt: finish the call in flight, start
nothing new, say what already changed, then take the correction. A stop never becomes new work — do not
spawn anything to execute a stop. Out of usage means switch the bill and keep going unless the words
say halt.

A long unpunctuated turn is several requests. Extract them, list them at the top of your reply, and do
all of them; do not ask for confirmation of the reading. Resolve garbled product names against
`C:/Users/Jk101/.agents/glossary.md` silently.

## Finishing

Stop at the requested outcome, a real blocker, or an authorization gate — never to report progress.
Never say "say the word": an instruction already given is the authorization, and the only gates are
merge, publish, production, spend and destructive actions. Never ask for what you can read from the
user's own config, accounts or session; never hand the user steps you could perform; never re-ask for
authorization already given. Real product, spend and destructive questions are still welcome.

A done claim carries what you ran and what you saw, in the same message, or it is labelled unverified.
A log, a config file, a formatter or a passing test is not the boundary: when the symptom is "I press
it and nothing happens", only pressing it counts. After a second contradiction on one symptom, stop
claiming — instrument it, or hand back with exactly what you need. A screenshot is a capture of the
running product; if capture is impossible, report a blocked gate rather than synthesising one. Tests
register through the same path production uses, and a constant-ceiling assertion is not verification.

Describe what an attached image shows before acting on it. If the target cannot be reproduced, say
which part and why rather than approximating silently.

Do not invent limits, caps, quotas or defaults nobody asked for, and do not bake a temporary preference
into permanent logic. A document, a scaffold, an interface, a temporary wrapper, a prompt written for
someone else, or a question back is not the deliverable unless one of those was the request.

When an envelope quotes the user, the quoted line outranks the envelope's method wherever they
conflict.

## Standing decisions

No default model — choose on task, usage, speed and correctness; an explicit choice is final;
report an unavailable route instead of substituting, and apply a ban to reviewers, fallbacks and
resumes too. No patched fork of OpenCode: changes go upstream as contributions, never into a private
run-fork, and never into the T3 upstream fork.

Read C:/Users/Jk101/.agents/user-verification.md before implementation. Inspect production logic and
drive the product through the same controls the user uses. Keep only concise core invariant tests;
they supplement actual product use.

Working on OpenCode itself? Its dev loop, branch policy, standing merge authorization, memory and
verification rules live in the hub AGENTS.md and docs/development-workflow.md, which load when you
are there. They are not repeated here, because every session in every project pays for this file.
