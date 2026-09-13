# Windows shell observations

Historical measurements from the September 12, 2026 Codex session motivated moving practical guidance to the actual shell tool. These figures describe that session, not universal per-call prices, fixed tool timeouts or platform guarantees. Preserve the reasoning when updating the implementation; remeasure before making performance claims.

## Historical turn economy

A tool call is never free, and its cost is only partly its output. Every call
replays the whole conversation to the model and again to the approvals reviewer,
so on this machine one call costs roughly 333k input tokens regardless of whether
it prints four lines or four hundred. Measured on the 2026-09-12 OpenCode
session: 1,310 tool calls, 436M input tokens — 190M on the main thread and 246M
on the `auto_review` guardian — carrying 2.7M tokens of tool output.

Output has a second, slower price. Context in that session sawtoothed from 28k to
244k eleven times, averaging 143k per call; each call added about 1,900 tokens
permanently, and every one of those is re-sent to the ~57 later calls in the same
compaction window. So a token of output costs roughly a hundred token-replays
downstream. Optimise the number of calls first, and what each call leaves behind
second.

Four rules follow from that.

Never wait across calls, and never start work that outruns the cell. Cells stop
at about 30 seconds: 81 of that session's cells hit that ceiling and 78 were
immediately followed by a poll run, 157 polls in all, 127 of them waiting a
single second — roughly 52M tokens to wait 687 seconds. Launch long work with its
output redirected to a log, let the cell end, and read the log as the first
statement of the next cell that does real work. A check that carries other work is
free; a call whose only purpose is waiting is not.

Batch everything one decision needs, with `Promise.allSettled`. One cell over
several `exec_command` calls costs one turn; the same commands one per turn cost
one turn each and tell you nothing extra. Use `allSettled` rather than bare
sequential `await`s: a cell that throws part-way discards everything the earlier
statements already earned, which is how one aborted cell re-ran two identical web
searches on 2026-09-12.

Size `max_output_tokens` to the job, and treat truncation as the expensive
outcome. 209 of that session's calls (17.6%) truncated, and in 80% of them the
same file was read again within three calls — each token withheld bought a fresh
~333k call. Simulated against the real traffic, an 8000-token budget on reads
would have avoided ~143 of those retries (~48M tokens) for ~14M in extra replay.
Use roughly 800–1200 for a probe — a status check, a grep, a `gh pr view`, where
the median output is under 750 tokens anyway — and roughly 8000 for a file you are
about to change. Above about 12000, do not raise the budget: narrow the command,
or redirect the output to a file and read the slice you need, so it never enters
context at all.

Search before reading, and write down what you learned. `rg -n '<symbol>' -C5`
over a tree costs less than `Get-Content` on one file and usually answers the
question outright. Never re-read a file this session already read: keep one
session ledger, append each finding's conclusion to it, and read that ledger once
after a compaction. In that session `verify-single-giver-installed.ts` was read 23
times, `MEMORY.md` 14 and `dev.json` 13, entirely because eleven compactions kept
erasing what had already been established.

## Output density

Turn economy says how many calls to make. This says what each one is allowed to
bring back. From the same session, 1.73M tokens of tool output:

Source code was 62% of it, 465 reads averaging 2,313 tokens, and most of it was
never used. Of 189 whole-file reads, 145 named a file that no call in the next
fifteen touched again -- roughly 417k tokens, a quarter of everything the session
read, fetched on the chance it would matter. Forty cells read two to five whole
files at once: 3% of the calls, 11% of the output. And 135 calls re-read
instruction files, clustering right after each context reset, re-orienting on
text the session already had.

So read a range or a search hit. Read a file whole only when you are about to
rewrite it. If you want it again after a compaction, that is what the session
ledger is for.

A prefix repeated once per line is the other half of this, and it is the half you
can actually delete. Print the base once and the leaves under it: run the command
from the directory so paths come back relative, `Resolve-Path -Relative` when they
do not, and `rg` from inside the tree rather than passing absolute roots. The same
holds for data we own -- a field that is always derivable from another is a prefix
in disguise. `setup/manifest.json` stored every path three times per entry:
`importedFrom` equalled `target` in all 153 entries and was read by nothing, and
`source` was `setup/files/` plus `target` in 148 of them. Storing only the five
exceptions took the file from 60,257 bytes to 32,382 with a byte-identical install
plan.

Do not try to shave the boilerplate instead. Import blocks are the visible part --
2,490 import lines reached context in that session, ~35k tokens, 4.7% of this tree --
but stripping them buys nothing, because `rg -n` charges its line-number prefixes
back at about the same rate. On `scripts/capture-setup.mjs`: 6,357 bytes whole,
6,255 with the imports filtered out, 1,134 for the one function the question was
about. Read by symbol and the preamble never arrives. For the same reason, do not
restructure code to read cheaply -- a shared prelude module or preloaded globals
trade a visible constant for indirection every later reader has to resolve.

The rest is runner noise, and it is mechanical to remove. Test output was 83k
tokens across 74 results, 18% of its lines individual `(pass)` lines with long
behavioural names that say nothing when the run is green. Installs contributed
73k tokens of resolver chatter, CI logs 38k tokens of timestamped workflow lines
(`gh run view --log-failed`, never `--log`), and colour escapes 19k. Run these to
a log and return the summary, or the failure excerpt:

```powershell
$env:NO_COLOR = '1'; $env:FORCE_COLOR = '0'
bun run check:core *> run.log
if ($LASTEXITCODE -eq 0) { Get-Content run.log -Tail 4 }
else { Get-Content run.log | Select-String -Pattern '\(fail\)|^error:|Expected' -Context 1,5 | Select-Object -First 20; Get-Content run.log -Tail 4 }
```

Last, the envelope taxes every output by about 5%. Content comes back inside a
JSON string, so each newline costs four characters as an escaped CRLF, each quote
two, each backslash two: 363k characters of escaping in that session, ~91k tokens,
of which ~31k was carriage returns alone. Strip CR before the output leaves the
cell with `(Get-Content x -Raw).Replace([string][char]13,'')`, and prefer forward
slashes so paths are not doubled.

## Historical snippets

These snippets are safe, non-interactive, and were verified with PowerShell:

```powershell
Get-ChildItem -Force | Select-Object Mode,Length,Name
```

```powershell
Get-Content -Path README.md -Head 20
```

```powershell
git show --name-only --format= HEAD
```

```powershell
bun run check:repo *> run.log
if ($LASTEXITCODE -eq 0) { Get-Content run.log -Tail 3 } else { Get-Content run.log | Select-String -Pattern '\(fail\)|^error:|Expected' -Context 1,5 | Select-Object -First 20 }
```
