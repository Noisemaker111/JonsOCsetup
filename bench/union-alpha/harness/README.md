# Coding benchmark harness — LiveCodeBench (code_generation_lite subset)

Full benchmark-selection research (all sources checked live, alternatives weighed, verification log):
`benchmark-selection-research.md`. This file summarizes the parts a harness user needs.

Scores any route this machine can call (see `bench/union-alpha/route.md`) with the same benchmark
version, task list and settings across models, so scores are comparable model-to-model. This tree
is a standalone tool: nothing under `quest/`, `usage/`, or `scripts/` imports it, and it hardcodes
no model name into production logic — routes are supplied as arguments (`bench/union-alpha/harness/route.ts`).

## Why LiveCodeBench, checked now (2026-09-17)

Picked over HumanEval/HumanEval+/MBPP/MBPP+ (contamination-saturated — llm-stats tracks only 10
models on the HumanEval+ leaderboard and 4 on MBPP+, versus 75+ on LiveCodeBench; IBM: "the number
of problems are also few enough that code generation models can perhaps memorize them all"),
BigCodeBench (1,140 tasks across 139 libraries, official path ships a Docker eval image, dropped
from 2025-2026 frontier cards), Aider's polyglot benchmark (225 exercises x 2 attempts = 450 calls,
measured 44-450s/case, a full run is 12-28h, needs 6 language toolchains locally), and SWE-bench
Verified/Lite (Docker mandatory, official guide states "at least 120GB of free storage, 16GB of
RAM, and 8 CPU cores" — not local/cheap on this machine).

LiveCodeBench (`code_generation` scenario, `code_generation_lite` dataset) is a
contamination-resistant, continuously-updated set of competitive-programming problems
(LeetCode/AtCoder/Codeforces) released after each problem's contest date, executed with real
hidden test cases rather than static canonical solutions, and it is current in 2025-2026 model
cards and leaderboards — every citation below was fetched and read directly, not recalled:

- Kimi K2 Thinking model card (Nov 2025) reports "LiveCodeBenchV6 | no tools | 83.1" —
  `https://huggingface.co/MoonshotAI/Kimi-K2-Thinking/raw/main/README.md` (verified directly,
  2026-09-17).
- Qwen3-Next-80B-A3B-Instruct model card (Sep 2025) reports "LiveCodeBench v6 (25.02-25.05) | 43.2
  ... 56.6" and no HumanEval/MBPP row at all in its Coding section —
  `https://huggingface.co/Qwen/Qwen3-Next-80B-A3B-Instruct/raw/main/README.md` (verified directly,
  2026-09-17).
- GLM-4.6 model card: "For code-related evaluation tasks (such as LCB), it is further recommended
  to set..." — `https://huggingface.co/zai-org/GLM-4.6/raw/main/README.md` (verified directly,
  2026-09-17), i.e. the vendor tunes generation settings specifically for LiveCodeBench.
- llm-stats.com (Sep 2026): "The LiveCodeBench leaderboard was last updated in September 2026 and
  currently includes 75 evaluated models" vs. 10 for HumanEval+ and 4 for MBPP+.
- pricepertoken.com (Sep 2026, Artificial Analysis data): "194 models have been evaluated on this
  benchmark."
- Official leaderboard, actively maintained: `https://livecodebench.github.io/leaderboard.html`.
- Repo: `https://github.com/LiveCodeBench/LiveCodeBench`, license MIT (verified directly,
  `https://raw.githubusercontent.com/LiveCodeBench/LiveCodeBench/main/LICENSE`, 2026-09-17; the HF
  dataset card's YAML front matter says `license: cc` while the dataset's own loader script
  declares `license="MIT License"` — a nuance worth flagging, not reconciled here).
- Honest caveat, Vals AI (updated 2026-09-01): "With the easy split effectively solved, the hard
  problems now decide the leaderboard" — and they've stopped running it on new frontier releases
  because the top end saturated; it still discriminates well in the mid/cheap-model range this
  Quest scores (their own tracked spread runs roughly 30-90% across 25 frontier models).

## Dataset and one-time download

Dataset: `livecodebench/code_generation_lite` on Hugging Face, split into date-windowed release
files (`test.jsonl` through `test6.jsonl`, cumulative by contest date). Fetched and inspected a
real range (`test6.jsonl`, first 4 MiB) directly against
`https://huggingface.co/datasets/livecodebench/code_generation_lite/resolve/main/test6.jsonl`
(2026-09-17) to confirm the record shape below without guessing from memory. No account or API key
is required for the raw file download; only an HTTP GET.

Cache once: `bench/union-alpha/harness/fetch-tasks.ts` range-downloads (`curl -L -r`, which preserves
the Range header across HF's cross-origin CDN redirect — Bun's own `fetch()` drops it, observed
directly) a candidate pool from `test6.jsonl` (the newest release slice, v6, contest dates roughly
Jan-May 2025), resolves each record's `private_test_cases` to plain JSON via
`decode-private-tests.py` (see below), caps each task to its first 12 private cases, drops any task
whose record still exceeds 60 KB after capping (a handful of competitive-programming problems carry
multi-megabyte stress-test inputs — one observed record was 16 MB even after the 12-case cap), and
writes the first 25 surviving tasks to `bench/union-alpha/harness/tasks/livecodebench-subset.jsonl`
(232 KB, committed — the subset itself is public benchmark data, not a stealth-model score). All
later runs read that cached file; no network access is needed to run the benchmark once it is
cached. The sampled subset (2026-09-17, from `test6.jsonl`) is all AtCoder stdio-style problems
(12 easy / 4 medium / 9 hard) — the leetcode "functional" problem shape was observed during
research but did not survive the size filter in this particular pull; `sandbox.py` still documents
both shapes for a future re-pull with a larger `--max-record-bytes`.

## Task record shape (as observed directly)

Each line is one JSON object:

```
{
  "question_title": str,
  "question_content": str,        # the problem statement
  "platform": "atcoder" | "leetcode" | "codeforces",
  "question_id": str,
  "difficulty": "easy" | "medium" | "hard",
  "contest_date": ISO8601 str,
  "starter_code": str,             # non-empty only for "functional" (leetcode) problems
  "public_test_cases": str,        # JSON-encoded list of {"input": str, "output": str, "testtype": str}
  "private_test_cases": str,       # as published: usually base64+zlib+pickle(json); in the CACHED
                                    # subset file this is already resolved to plain JSON by
                                    # decode-private-tests.py and capped to <=12 cases (see below)
  "metadata": str                  # JSON-encoded dict, e.g. {"func_name": "..."} for functional problems
}
```

Two task kinds, both observed directly in the sample:

- **stdio** (`testtype: "stdin"`, the majority — AtCoder/Codeforces problems): generated code is a
  full program; each case feeds `input` on stdin and compares stdout to `output` after trailing
  whitespace normalization. Maps to `sandbox.py`'s `"stdio"` test type.
- **functional** (`testtype: "functional"`, LeetCode problems with non-empty `starter_code` and a
  `func_name` in `metadata`): generated code fills in the `class Solution` method; each case's
  `input` is one Python literal per line (the method's positional args, one arg per line, evaluated
  with `ast.literal_eval`) and `output` is the literal expected return value. Maps to a
  `"lcb_functional"` test type in `sandbox.py`.

`private_test_cases`, as LiveCodeBench publishes it, decodes with a try/except exactly matching
`CodeGenerationProblem.__post_init__`: try `json.loads` directly, and on failure
`json.loads(pickle.loads(zlib.decompress(base64.b64decode(raw))))` (observed directly against
downloaded records: AtCoder problems in the sampled range carried ~40 private cases behind 3-4
public ones before capping). `decode-private-tests.py` runs that exact chain once, offline, in
Python — not reimplemented in TypeScript, since hand-rolling Python's pickle wire format in JS is
exactly the kind of subtle-bug risk this Quest should not introduce — and caps each list to 12
cases so the cached file stays small. `decode-tests.ts` at run time then just prefers the (already
plain-JSON) private cases and falls back to public-only, recording which source was used per task,
since 2-4 public examples alone are too weak a pass/fail signal for a fair pass@1.

## Runtime and cost

Execution is local Python subprocesses (`sandbox.py`, stdlib only, a `subprocess.run(..., timeout=)`
per test case — Windows-safe; LiveCodeBench's own harness uses a POSIX-only `signal.setitimer`/
`SIGALRM`, which does not run on this machine, so this project does not reuse it and implements its
own timeout instead; its own `reliability_guard()` states plainly "This function is NOT a security
sandbox" — treat generated code as untrusted and keep the subprocess isolation). The 25-task cached
subset (<=12 test cases each, 6 s timeout per case) completes its sandboxed execution in well under
a minute per model on this machine — execution cost is CPU time only, no paid API calls, no GPU, no
Docker. Per-model wall time is dominated by the model's own inference latency (one completion call
per task, run with `--concurrency` in parallel), not by scoring. 25 tasks give pass@1 a granularity
of 4 points; treat this subset for cheap A/B and regression comparisons between models, not as a
leaderboard-grade claim (LiveCodeBench's own hard split is where the field currently discriminates
best in the mid-tier this Quest scores; easy problems are close to solved for frontier models).

## Commands

```bash
# one-time: cache a subset (writes bench/union-alpha/harness/tasks/livecodebench-subset.jsonl)
bun bench/union-alpha/harness/fetch-tasks.ts --count 25

# score one route, N repeat trials, raw artifacts under .evidence/union-alpha-bench/scores/
bun bench/union-alpha/harness/run.ts --route kimi-k3 --trials 3 \
  --out .evidence/union-alpha-bench/scores

# aggregate every route's raw trials into one aligned table with deltas
bun bench/union-alpha/harness/report.ts .evidence/union-alpha-bench/scores union-alpha-go
```

`route.ts` lists the routes this run used; add a route there (or extend the CLI) to score a new
model — no code path treats any model name specially.

## Quick sanity check

`tasks/livecodebench-subset-fast8.jsonl` is the first 8 tasks of the 25-task subset (mixed
difficulty), for a fast end-to-end check of a route/model before committing to a full run:

```bash
bun bench/union-alpha/harness/run.ts --route <id> --trials 1 \
  --tasks bench/union-alpha/harness/tasks/livecodebench-subset-fast8.jsonl \
  --out .evidence/union-alpha-bench/smoke
```
